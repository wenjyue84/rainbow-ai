/**
 * KnowledgeBaseInstance — Per-profile Knowledge Base
 *
 * Encapsulates all KB state (cache, system prompt, patterns) per profile.
 * The module-level knowledge-base.ts delegates to the default profile instance
 * for backward compatibility.
 */

import { readFileSync, readdirSync, existsSync, watch, mkdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { ConfigStore } from './config-store.js';
import { notifyAdminConfigError } from '../lib/admin-notifier.js';
import { PROFILE_TYPES } from '../lib/config.js';
import { loadAllKBFromDB, saveKBFileToDB, getKBFilesHealth } from '../lib/config-db.js';
import { HybridRetriever } from './rag/hybrid-retriever.js';
import type { RetrievalResult } from './rag/hybrid-retriever.js';
import { runAccessGuard } from './rag/vector-access-guard.js';
import type { VectorQueryContext } from './rag/vector-access-guard.js';
import { defaultKBScorer } from '../lib/kb-relevance-scorer.js';

const DURABLE_MEMORY_FILE = 'memory.md';

// ─── KB Pattern Config ────────────────────────────────────────────────

interface KBPatternEntry {
  comment: string;
  regex: string;
  files: string[];
}

interface KBPatternsConfig {
  description?: string;
  coreFiles: string[];
  defaultFallback: string;
  patterns: KBPatternEntry[];
}

// ─── Timezone Helpers (shared, stateless) ─────────────────────────────

export function getTodayDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
}

export function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
}

export function getMYTTimestamp(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function getTimeContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  return `CURRENT DATE AND TIME (Malaysia, Asia/Kuala_Lumpur): ${dateStr}, ${timeStr}. Use this when answering questions about check-in times, check-out times, early arrival, or late checkout.`;
}

// ─── KnowledgeBaseInstance ─────────────────────────────────────────────

export class KnowledgeBaseInstance {
  readonly profileId: string;
  readonly kbDir: string;
  private readonly memoryDir: string;
  private readonly dataDir: string;

  // Per-instance state
  private kbCache: Map<string, string> = new Map();
  private kbPatternsConfig: KBPatternsConfig | null = null;
  private compiledTopicPatterns: Array<{ pattern: RegExp; files: string[] }> | null = null;

  // US-912/US-966: Hybrid RAG retriever (BM25 + vector + cross-encoder)
  // Scoped to this property via propertyId for namespace isolation (OWASP LLM06)
  private hybridRetriever = new HybridRetriever();
  private ragInitPromise: Promise<void> | null = null;

  // System prompt cache
  private systemPromptCacheVersion = 0;
  private systemPromptCache: {
    basePrompt: string;
    persona: string;
    dateBuilt: string;
    version: number;
  } | null = null;

  constructor(profileId: string, kbDir: string, dataDir: string) {
    this.profileId = profileId;
    this.kbDir = kbDir;
    this.memoryDir = join(kbDir, 'memory');
    this.dataDir = dataDir;
  }

  // ─── KB Patterns ──────────────────────────────────────────────────

  private loadKBPatterns(): KBPatternsConfig {
    if (this.kbPatternsConfig) return this.kbPatternsConfig;
    try {
      const configPath = resolve(this.dataDir, 'kb-patterns.json');
      const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
      this.kbPatternsConfig = {
        coreFiles: parsed.coreFiles || ['AGENTS.md', 'soul.md'],
        defaultFallback: parsed.defaultFallback || 'faq.md',
        patterns: parsed.patterns || [],
      };
      console.log(`[KB:${this.profileId}] Loaded ${this.kbPatternsConfig!.patterns.length} topic patterns from kb-patterns.json`);
      return this.kbPatternsConfig!;
    } catch (err: any) {
      console.warn(`[KB:${this.profileId}] Failed to load kb-patterns.json: ${err.message} — using empty pattern map`);
      this.kbPatternsConfig = {
        coreFiles: ['AGENTS.md', 'soul.md'],
        defaultFallback: 'faq.md',
        patterns: []
      };
      return this.kbPatternsConfig;
    }
  }

  private getCompiledTopicPatterns(): Array<{ pattern: RegExp; files: string[] }> {
    if (this.compiledTopicPatterns) return this.compiledTopicPatterns;
    const config = this.loadKBPatterns();
    this.compiledTopicPatterns = config.patterns.map(entry => ({
      pattern: new RegExp(entry.regex, 'i'),
      files: entry.files
    }));
    console.log(`[KB:${this.profileId}] Compiled ${this.compiledTopicPatterns.length} topic regex patterns`);
    return this.compiledTopicPatterns;
  }

  private getCoreFiles(): string[] {
    return this.loadKBPatterns().coreFiles;
  }

  private getDefaultFallback(): string {
    return this.loadKBPatterns().defaultFallback;
  }

  // ─── Public API ────────────────────────────────────────────────────

  guessTopicFiles(text: string): string[] {
    const compiledPatterns = this.getCompiledTopicPatterns();
    const files = new Set<string>();
    for (const { pattern, files: fileList } of compiledPatterns) {
      if (pattern.test(text)) {
        fileList.forEach(f => files.add(f));
      }
    }
    if (files.size === 0) files.add(this.getDefaultFallback());
    return Array.from(files);
  }

  getMemoryDir(): string {
    return this.memoryDir;
  }

  getDurableMemory(): string {
    return this.kbCache.get(DURABLE_MEMORY_FILE) || '';
  }

  listMemoryDays(): string[] {
    if (!existsSync(this.memoryDir)) return [];
    return readdirSync(this.memoryDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => f.replace('.md', ''))
      .sort()
      .reverse();
  }

  // ─── Loading & Caching ───────────────────────────────────────────

  reloadKBFile(filename: string): void {
    if (filename.startsWith('memory/') || filename.startsWith('memory\\')) {
      const normalizedName = filename.replace(/\\/g, '/');
      const filePath = join(this.kbDir, filename);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const mtime = statSync(filePath).mtime;
        this.kbCache.set(normalizedName, content);
        saveKBFileToDB(normalizedName, content, mtime, this.profileId).catch(() => {});
        console.log(`[KB:${this.profileId}] Reloaded ${filename}`);
        this.invalidateSystemPromptCache();
      }
      return;
    }
    const filePath = join(this.kbDir, filename);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      const mtime = statSync(filePath).mtime;
      this.kbCache.set(filename, content);
      saveKBFileToDB(filename, content, mtime, this.profileId).catch(() => {});
      console.log(`[KB:${this.profileId}] Reloaded ${filename}`);
      const CORE_FILES = this.getCoreFiles();
      if (CORE_FILES.includes(filename) || filename === DURABLE_MEMORY_FILE) {
        this.invalidateSystemPromptCache();
      }
    }
  }

  reloadAllKB(): void {
    if (!existsSync(this.kbDir)) {
      console.warn(`[KB:${this.profileId}] KB dir not found at ${this.kbDir}`);
      return;
    }
    const files = readdirSync(this.kbDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = join(this.kbDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const mtime = statSync(filePath).mtime;
      this.kbCache.set(file, content);
      saveKBFileToDB(file, content, mtime, this.profileId).catch(() => {});
    }

    if (existsSync(this.memoryDir)) {
      const today = getTodayDate();
      const yesterday = getYesterdayDate();
      for (const date of [today, yesterday]) {
        const memFile = join(this.memoryDir, `${date}.md`);
        if (existsSync(memFile)) {
          this.kbCache.set(`memory/${date}.md`, readFileSync(memFile, 'utf-8'));
        }
      }
    }

    this.invalidateSystemPromptCache();
    console.log(`[KB:${this.profileId}] Loaded ${this.kbCache.size} KB files from ${this.kbDir}`);
  }

  watchKBDirectory(): void {
    if (!existsSync(this.kbDir)) return;
    try {
      watch(this.kbDir, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
          console.log(`[KB:${this.profileId}] File changed: ${filename}, reloading...`);
          this.reloadKBFile(filename);
        }
      });
      console.log(`[KB:${this.profileId}] Watching ${this.kbDir} for changes`);
    } catch (err: any) {
      console.warn(`[KB:${this.profileId}] Could not watch KB dir: ${err.message}`);
    }

    if (!existsSync(this.memoryDir)) {
      try { mkdirSync(this.memoryDir, { recursive: true }); } catch {}
    }
    try {
      watch(this.memoryDir, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
          console.log(`[KB:${this.profileId}] Memory file changed: ${filename}, reloading...`);
          this.reloadKBFile(`memory/${filename}`);
        }
      });
      console.log(`[KB:${this.profileId}] Watching ${this.kbDir}/memory/ for changes`);
    } catch (err: any) {
      console.warn(`[KB:${this.profileId}] Could not watch memory/: ${err.message}`);
    }
  }

  async initKBFromDB(): Promise<void> {
    try {
      const dbKB = await loadAllKBFromDB(this.profileId);
      if (dbKB && dbKB.size > 0) {
        for (const [filename, content] of dbKB) {
          this.kbCache.set(filename, content);
        }
        this.invalidateSystemPromptCache();
        console.log(`[KB:${this.profileId}] Loaded ${dbKB.size} KB files from DB`);
        return;
      }
    } catch (err: any) {
      console.warn(`[KB:${this.profileId}] DB KB load failed:`, err.message);
    }
    console.log(`[KB:${this.profileId}] No KB files in DB, using local files`);
  }

  async checkKBStaleness(): Promise<void> {
    try {
      const files = await getKBFilesHealth();
      const staleFiles = files.filter(f => f.stale);
      if (staleFiles.length > 0) {
        console.warn(`[KB:${this.profileId}] ⚠ ${staleFiles.length} stale KB file(s):`);
        for (const f of staleFiles) {
          const daysAgo = f.last_modified_at
            ? Math.floor((Date.now() - new Date(f.last_modified_at).getTime()) / 86400000)
            : 'unknown';
          console.warn(`  - ${f.filename} (last modified ${daysAgo} days ago, threshold: ${f.stale_threshold_days} days)`);
        }
      } else if (files.length > 0) {
        console.log(`[KB:${this.profileId}] All ${files.length} KB files are fresh`);
      }
    } catch (err: any) {
      console.warn(`[KB:${this.profileId}] Staleness check failed:`, err.message);
    }
  }

  // ─── US-912: Hybrid RAG Retrieval ───────────────────────────────

  /**
   * Initialize the hybrid RAG retriever (async, non-blocking).
   * Chunks all KB files, builds BM25 index, computes embeddings.
   * Core files (AGENTS.md, soul.md) are excluded from chunking since they're
   * always included in the system prompt.
   */
  async initRAG(): Promise<void> {
    if (this.ragInitPromise) return this.ragInitPromise;
    const coreFiles = new Set(this.getCoreFiles());
    coreFiles.add(DURABLE_MEMORY_FILE);
    coreFiles.add('README.md');
    // US-966: Pass profileId as namespace for OWASP LLM06 chunk tagging
    this.ragInitPromise = this.hybridRetriever.initialize(this.kbCache, coreFiles, this.profileId);
    return this.ragInitPromise;
  }

  /**
   * Retrieve relevant KB chunks for a user query using hybrid search.
   * Falls back to regex-based topic selection if retriever isn't ready.
   *
   * @param query - User message text
   * @returns Retrieval result with scored chunks
   */
  async retrieveContext(query: string): Promise<RetrievalResult> {
    if (!this.hybridRetriever.isReady) {
      return { chunks: [], hasRelevantContext: false, latencyMs: 0 };
    }
    const result = await this.hybridRetriever.retrieve(query);

    // US-966: Run OWASP LLM06 access guard on retrieval results
    if (result.chunks.length > 0) {
      const guardContext: VectorQueryContext = {
        propertyId: this.profileId,
        serviceIdentity: 'rainbow-ai',
      };
      const guardResult = await runAccessGuard(
        guardContext,
        query,
        result.chunks,
        result.latencyMs
      );

      // Filter out cross-namespace chunks if any leaked through
      if (guardResult.crossNamespaceDetected) {
        result.chunks = result.chunks.filter(
          sc => sc.chunk.propertyId === undefined || sc.chunk.propertyId === this.profileId
        );
        result.hasRelevantContext = result.chunks.length > 0;
      }
    }

    return result;
  }

  /** Whether the hybrid retriever is initialized and ready */
  get ragReady(): boolean {
    return this.hybridRetriever.isReady;
  }

  /**
   * US-966: Expose the retriever for namespace audit (ns-audit.ts).
   * Returns the internal HybridRetriever so the audit can inspect indexed chunks.
   */
  getHybridRetriever(): HybridRetriever {
    return this.hybridRetriever;
  }

  /**
   * US-538/US-542: Rebuild RAG index after KB document ingestion.
   * Public API for triggering RAG reindexing when KB files are uploaded via admin API.
   * Called by kb-upload route after writing extracted markdown file.
   */
  async reindexKB(): Promise<void> {
    await this.rebuildRAGIndex();
  }

  /**
   * Rebuild RAG index (called when KB files change).
   */
  private async rebuildRAGIndex(): Promise<void> {
    if (!this.hybridRetriever.isReady) return;
    const coreFiles = new Set(this.getCoreFiles());
    coreFiles.add(DURABLE_MEMORY_FILE);
    coreFiles.add('README.md');
    await this.hybridRetriever.rebuild(this.kbCache, coreFiles);
  }

  init(configStore: ConfigStore): void {
    this.reloadAllKB();
    this.watchKBDirectory();

    // US-912: Initialize RAG retriever in background (non-blocking)
    this.initRAG().catch(err => {
      console.warn(`[KB:${this.profileId}] RAG initialization failed:`, err.message);
    });

    configStore.on('reload', (domain: string) => {
      if (domain === 'knowledgeBase' || domain === 'all') {
        this.reloadAllKB();
        console.log(`[KB:${this.profileId}] Reloaded all KB files (config event)`);
      }
      if (domain === 'routing' || domain === 'settings') {
        this.invalidateSystemPromptCache();
        console.log(`[KB:${this.profileId}] System prompt cache invalidated (${domain} config changed)`);
      }
    });
  }

  // ─── Legacy compat ──────────────────────────────────────────────

  getKnowledgeMarkdown(): string {
    return Array.from(this.kbCache.values()).join('\n\n---\n\n');
  }

  /** US-899: Get raw content for specific KB files (for faithfulness checking) */
  getFilesContent(filenames: string[]): string {
    return filenames
      .map(f => this.kbCache.get(f) || '')
      .filter(Boolean)
      .join('\n\n---\n\n');
  }

  // ─── Conversation Context (US-401) ─────────────────────────────────

  /**
   * Extract the last N conversation turns for benchmarking context window sizes.
   * Used by context-window-benchmark.ts to test classification accuracy with varying history lengths.
   *
   * @param history Full conversation history
   * @param count Number of most recent turns to include
   * @returns Sliced history with at most `count` most recent messages
   */
  getConversationContext(history: Array<{ role: string; content: string; timestamp?: number }>, count: number): Array<{ role: string; content: string; timestamp?: number }> {
    if (count <= 0) return [];
    if (history.length <= count) return history;
    return history.slice(-count);
  }

  // ─── System Prompt Cache ────────────────────────────────────────

  invalidateSystemPromptCache(): void {
    this.systemPromptCacheVersion++;
    this.systemPromptCache = null;
    console.log(`[KB:${this.profileId}] System prompt cache invalidated (v${this.systemPromptCacheVersion})`);
  }

  private getOrBuildBasePrompt(basePersona: string, configStore: ConfigStore): string {
    const today = getTodayDate();

    if (
      this.systemPromptCache &&
      this.systemPromptCache.version === this.systemPromptCacheVersion &&
      this.systemPromptCache.persona === basePersona &&
      this.systemPromptCache.dateBuilt === today
    ) {
      return this.systemPromptCache.basePrompt;
    }

    const routing = configStore.getRouting();
    const intents = Object.keys(routing);

    const staticIntents = intents.filter(i => routing[i]?.action === 'static_reply');
    const llmIntents = intents.filter(i => routing[i]?.action === 'llm_reply');
    const specialIntents = intents.filter(i => !['static_reply', 'llm_reply'].includes(routing[i]?.action));

    const routingLines = intents.map(i => `  - "${i}" → ${routing[i].action}`).join('\n');

    const isHostelProfile = PROFILE_TYPES[this.profileId] === 'hostel';

    const CORE_FILES = this.getCoreFiles();
    const missingCoreFiles = CORE_FILES.filter(f => !this.kbCache.get(f));
    if (missingCoreFiles.length > 0) {
      console.warn(`[KB:${this.profileId}] Missing core KB files: ${missingCoreFiles.join(', ')}`);
      notifyAdminConfigError(
        `Missing core knowledge base files: ${missingCoreFiles.join(', ')}\n\n` +
        `Profile: ${this.profileId}\n` +
        `Location: ${this.kbDir}\n` +
        `AI responses will be degraded without these files.`
      ).catch(() => {});
    }

    const coreContent = CORE_FILES
      .map(f => this.kbCache.get(f) || '')
      .filter(Boolean)
      .join('\n\n---\n\n');

    const memoryParts: string[] = [];
    const durableMemory = this.kbCache.get(DURABLE_MEMORY_FILE);
    if (durableMemory) {
      memoryParts.push(durableMemory);
    }
    const yesterday = getYesterdayDate();
    const todayLog = this.kbCache.get(`memory/${today}.md`);
    if (todayLog) {
      memoryParts.push(`--- TODAY (${today}) — HIGH PRIORITY ---\n${todayLog}`);
    }
    const yesterdayLog = this.kbCache.get(`memory/${yesterday}.md`);
    if (yesterdayLog) {
      memoryParts.push(`--- Yesterday (${yesterday}) ---\n${yesterdayLog}`);
    }

    const memoryContent = memoryParts.length > 0
      ? `\n\n<operational_memory>
MEMORY PRIORITY: Today's entries are MOST relevant. Give them highest attention when answering.
Yesterday's entries provide continuity. Durable memory contains permanent facts.
If a guest's issue was logged today, reference it naturally (e.g., "I see we had a report about X earlier").

${memoryParts.join('\n\n')}
</operational_memory>`
      : '';

    const basePrompt = `${basePersona}

INTENT CLASSIFICATION:
You must classify the guest's message into exactly ONE of these intents:
${intents.map(i => `"${i}"`).join(', ')}

ROUTING RULES (admin-controlled):
${routingLines}

RESPONSE INSTRUCTIONS:
- For intents routed to "static_reply" (${staticIntents.join(', ')}): STILL generate a helpful response. The system may use it as a fallback if the pre-written reply isn't appropriate for the guest's situation (e.g., when the guest reports a problem rather than asking for info).
- For intents routed to "llm_reply" (${llmIntents.join(', ')}): Generate a helpful response using the Knowledge Base below.
- For intents routed to "start_booking", "escalate", or "forward_payment" (${specialIntents.map(i => i).join(', ')}): Generate an appropriate response AND the system will trigger the corresponding workflow.

⚠️ CRITICAL KNOWLEDGE CONSTRAINTS - READ THIS FIRST ⚠️

YOU ARE STRICTLY LIMITED TO THE KNOWLEDGE BASE BELOW. THIS IS ABSOLUTE.

MANDATORY RULES:
1. **ONLY use information explicitly stated in the Knowledge Base**
2. **If the answer is NOT in the Knowledge Base, you MUST say: "I don't have that information. Let me connect you with our team."**
3. **DO NOT provide tangentially related information when the specific answer isn't available**
4. **DO NOT guess, infer, or use external knowledge**
5. **DO NOT use common sense to fill gaps in the Knowledge Base**
6. **When in doubt, ALWAYS say "I don't know" rather than risk providing incorrect information**

Examples of CORRECT behavior:
- Question: "Do you have a swimming pool?" → If not in KB: "I don't have that information. Let me connect you with our team."
- Question: "Do you serve breakfast?" → If not in KB: "I don't have that information. Let me connect you with our team."
- Question: "Do you have group discounts?" → If not in KB: "I don't have that information. Let me connect you with our team."

Examples of INCORRECT behavior (NEVER do this):
- ❌ Providing facility list when asked about specific facility not listed
- ❌ Providing general prices when asked about specific discount not in KB
- ❌ Providing location when asked about specific transport not in KB
- ❌ Answering "yes" or "no" based on assumptions

GENERAL RULES:
- Respond in the same language the guest uses (English, Malay, Chinese, or any other language)
- Be warm, concise, and helpful (under 500 chars unless details are needed)
${isHostelProfile ? '- Sign off as "— Rainbow 🌈" (only for llm_reply intents)\n' : ''}- NEVER invent prices, availability, or policies
${isHostelProfile ? '- Do not provide info about other hotels or hostels\n' : ''}
- Use operational memory for context about current operations, known issues, and staff notes
- CONVERSATION MEMORY: Always use the conversation history to recall guest details (name, booking dates, capsule number, previous requests). If the guest told you their name earlier, remember and use it. The KB constraint applies to hostel facts and policies, NOT to information the guest has shared in this conversation.

CONFIDENCE SCORING:
- Include a confidence score (0.0-1.0) for your response
- Set confidence < 0.5 if: answer is partial, information is incomplete, or you're not sure
- Set confidence < 0.7 if: answer requires interpretation or combines multiple KB sections
- Set confidence >= 0.7 if: answer is directly stated in KB and complete
- Set confidence >= 0.9 if: answer is exact quote from KB with no ambiguity

Return JSON: { "intent": "<one of the defined intents>", "action": "<routing action>", "response": "<your response or empty for static_reply>", "confidence": 0.0-1.0 }

<knowledge_base>
${coreContent}${memoryContent}`;

    this.systemPromptCache = {
      basePrompt,
      persona: basePersona,
      dateBuilt: today,
      version: this.systemPromptCacheVersion,
    };

    console.log(`[KB:${this.profileId}] System prompt base cached (v${this.systemPromptCacheVersion}, ${basePrompt.length} chars)`);

    return basePrompt;
  }

  /**
   * Filter topic files by relevance to an intent (US-634)
   * Scores KB documents against intent keywords and filters based on threshold (0.7)
   *
   * @param intent - Intent name (e.g., "booking_inquiry")
   * @param topicFiles - List of topic file names to filter
   * @returns Filtered list of relevant topic files and skipped files with debug info
   */
  filterTopicFilesByIntent(
    intent: string,
    topicFiles: string[]
  ): { filteredFiles: string[]; skipped: Array<{ docId: string; score: number }> } {
    // Build map of document ID -> content for files to filter
    const documentsMap = new Map<string, string>();
    for (const file of topicFiles) {
      const content = this.kbCache.get(file);
      if (content) {
        documentsMap.set(file, content);
      }
    }

    if (documentsMap.size === 0) {
      return { filteredFiles: topicFiles, skipped: [] };
    }

    // Score documents against intent
    const scoringResult = defaultKBScorer.scoreDocumentsByIntent(
      intent,
      documentsMap,
      this.profileId
    );

    // Log skipped documents for debugging
    for (const doc of scoringResult.skipped) {
      console.log(
        `[KB:${this.profileId}] [${intent}] Skipped doc="${doc.docId}" score=${doc.score.toFixed(3)} reason=below_threshold`
      );
    }

    return {
      filteredFiles: scoringResult.documents.map(d => d.docId),
      skipped: scoringResult.skipped,
    };
  }

  buildSystemPrompt(basePersona: string, topicFiles: string[], configStore: ConfigStore): string {
    const basePrompt = this.getOrBuildBasePrompt(basePersona, configStore);

    const missingTopicFiles = topicFiles.filter(f => !this.kbCache.get(f));
    if (missingTopicFiles.length > 0) {
      console.warn(`[KB:${this.profileId}] Missing topic files: ${missingTopicFiles.join(', ')} — responses may lack detail`);
    }

    const topicContent = topicFiles
      .map(f => this.kbCache.get(f) || '')
      .filter(Boolean)
      .join('\n\n---\n\n');

    return `${basePrompt}${topicContent ? `\n\n---\n\n${topicContent}` : ''}
</knowledge_base>`;
  }
}
