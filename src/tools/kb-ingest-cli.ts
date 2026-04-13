#!/usr/bin/env tsx
/**
 * kb-ingest-cli.ts — CLI for KB document ingestion via kreuzberg (US-539/US-542)
 *
 * Extracts markdown from a document file and writes it to the KB directory for
 * the specified profile. After writing, signals the KB instance to reindex.
 *
 * Usage:
 *   npm run kb:ingest -- --file <path> --profile <pelangi|southern|makan> [--topic <slug>] [--ocr]
 *
 * Exit codes:
 *   0 — Success
 *   1 — Error (file not found, invalid profile, extraction failed)
 */

import { promises as fsPromises } from 'fs';
import path from 'path';
import { resolve } from 'path';
import dotenv from 'dotenv';
import { extractToMarkdown, KBExtractorError } from '../lib/kb-extractor.js';
import { updateSourceManifest } from '../lib/kb-source-manifest.js';
import { KnowledgeBaseInstance } from '../assistant/knowledge-base-instance.js';

dotenv.config();

// ─── Profile → KB Directory mapping ─────────────────────────────────────

const PROFILE_KB_DIRS: Record<string, string> = {
  pelangi: '.rainbow-kb',
  southern: '.rainbow-kb-southern',
  makan: '.rainbow-kb-makan',
};

// ─── Argument Parsing ────────────────────────────────────────────────────

interface CliArgs {
  file: string | undefined;
  profile: string | undefined;
  topic: string | undefined;
  ocr: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let file: string | undefined;
  let profile: string | undefined;
  let topic: string | undefined;
  let ocr = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' && args[i + 1]) {
      file = args[++i];
    } else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
    } else if (arg === '--profile' && args[i + 1]) {
      profile = args[++i];
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg === '--topic' && args[i + 1]) {
      topic = args[++i];
    } else if (arg.startsWith('--topic=')) {
      topic = arg.slice('--topic='.length);
    } else if (arg === '--ocr') {
      ocr = true;
    }
  }

  return { file, profile, topic, ocr };
}

// ─── Filename Sanitization ───────────────────────────────────────────────

function sanitizeFilename(input: string): string {
  let sanitized = input.trim();
  // Remove file extension
  sanitized = sanitized.replace(/\.(md|pdf|docx|xlsx|txt|png|jpg|jpeg|gif|webp)$/i, '');
  // Lowercase and replace spaces with hyphens
  sanitized = sanitized.toLowerCase().replace(/\s+/g, '-');
  // Keep only alphanumeric and hyphens
  sanitized = sanitized.replace(/[^a-z0-9\-]/g, '');
  // Collapse consecutive hyphens
  sanitized = sanitized.replace(/\-+/g, '-');
  // Strip leading/trailing hyphens
  sanitized = sanitized.replace(/^\-+|\-+$/g, '');
  if (!sanitized) sanitized = 'untitled';
  return `${sanitized}.md`;
}

// ─── Main ────────────────────────────────────────────────────────────────

export async function ingestDocument(opts: {
  file: string;
  profile: string;
  topic?: string;
  ocr?: boolean;
}): Promise<{ kbFile: string; extractedChars: number }> {
  const kbDirRelative = PROFILE_KB_DIRS[opts.profile];
  if (!kbDirRelative) {
    throw new Error(`Invalid profile: ${opts.profile}. Must be one of: pelangi, southern, makan`);
  }

  // Validate file exists
  try {
    await fsPromises.access(opts.file);
  } catch {
    throw new Error(`File not found: ${opts.file}`);
  }

  // Determine KB filename from --topic or source filename
  const kbFilename = opts.topic
    ? sanitizeFilename(opts.topic)
    : sanitizeFilename(path.basename(opts.file));

  const kbDir = resolve(process.cwd(), kbDirRelative);
  const kbFilePath = path.join(kbDir, kbFilename);

  // Extract markdown via kreuzberg
  const markdown = await extractToMarkdown(opts.file, { ocr: opts.ocr ?? false });

  // Ensure KB directory exists and write the extracted file
  await fsPromises.mkdir(kbDir, { recursive: true });
  await fsPromises.writeFile(kbFilePath, markdown, 'utf-8');

  // Track in manifest (US-540)
  try {
    await updateSourceManifest({
      kbDir,
      kbFile: kbFilename,
      sourceFilename: path.basename(opts.file),
      extractedChars: markdown.length,
    });
  } catch (manifestErr: any) {
    console.warn(`[KB:ingest] Failed to update manifest: ${manifestErr.message}`);
    // Don't fail ingestion if manifest update fails
  }

  // Reload KB file and trigger reindex on a standalone instance
  const dataDir = resolve(process.cwd(), 'src/assistant/data');
  const kb = new KnowledgeBaseInstance(opts.profile, kbDir, dataDir);
  kb.reloadKBFile(kbFilename);

  // reindexKB() rebuilds if retriever is already initialized (running server context);
  // in standalone CLI mode the retriever is not initialized so this is a no-op,
  // but the server file-watcher will pick up the change.
  await kb.reindexKB();

  return { kbFile: kbFilePath, extractedChars: markdown.length };
}

async function main() {
  const { file, profile, topic, ocr } = parseArgs(process.argv);

  if (!file) {
    process.stderr.write('Error: --file <path> is required\n');
    process.stderr.write('Usage: npm run kb:ingest -- --file <path> --profile <pelangi|southern|makan> [--topic <slug>] [--ocr]\n');
    process.exit(1);
  }

  if (!profile) {
    process.stderr.write('Error: --profile <pelangi|southern|makan> is required\n');
    process.stderr.write('Usage: npm run kb:ingest -- --file <path> --profile <pelangi|southern|makan> [--topic <slug>] [--ocr]\n');
    process.exit(1);
  }

  try {
    const { kbFile, extractedChars } = await ingestDocument({ file, profile, topic, ocr });
    console.log(`Extracted ${extractedChars} chars → ${kbFile}`);
    console.log('RAG index rebuilt.');
  } catch (err: any) {
    const message = err instanceof KBExtractorError
      ? err.message
      : `Error: ${err.message}`;
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  (process.argv[1].endsWith('kb-ingest-cli.ts') ||
    process.argv[1].endsWith('kb-ingest-cli.js'));

if (isMain) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
