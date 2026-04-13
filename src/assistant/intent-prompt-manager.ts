/**
 * intent-prompt-manager.ts — Load and manage per-intent custom system prompts
 * (Single Responsibility: manage intent-specific system prompt overrides)
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

interface IntentPromptConfig {
  system_prompt: string;
  language?: string;
}

interface IntentPromptsData {
  [intentType: string]: IntentPromptConfig;
}

class IntentPromptManager {
  private prompts: IntentPromptsData = {};
  private readonly dataDir: string;
  private readonly filePath: string;

  constructor(dataDir: string = join(process.cwd(), 'src', 'assistant', 'data')) {
    this.dataDir = dataDir;
    this.filePath = join(this.dataDir, 'intent-prompts.json');
    this.load();
  }

  /**
   * Load intent prompts from intent-prompts.json
   * Fails gracefully if file doesn't exist
   */
  private load(): void {
    try {
      if (!existsSync(this.filePath)) {
        console.warn('[IntentPromptManager] intent-prompts.json not found, using empty config');
        this.prompts = {};
        return;
      }

      const content = readFileSync(this.filePath, 'utf8');
      this.prompts = JSON.parse(content);
      console.log(`[IntentPromptManager] ✅ Loaded ${Object.keys(this.prompts).length} custom intent prompts`);
    } catch (error) {
      console.warn('[IntentPromptManager] Failed to load intent-prompts.json:', error instanceof Error ? error.message : error);
      this.prompts = {};
    }
  }

  /**
   * Get custom system prompt for an intent, or undefined if not configured
   */
  getCustomPrompt(intentType: string): string | undefined {
    const config = this.prompts[intentType];
    return config?.system_prompt;
  }

  /**
   * Get system prompt with fallback to default
   * @param intentType The intent category (e.g. 'booking', 'pricing')
   * @param defaultPrompt Default system prompt if intent not configured
   * @returns Either custom prompt or default
   */
  getPrompt(intentType: string, defaultPrompt: string): string {
    const customPrompt = this.getCustomPrompt(intentType);
    return customPrompt || defaultPrompt;
  }

  /**
   * Update custom system prompt for an intent
   * Atomically writes to intent-prompts.json
   */
  setPrompt(intentType: string, systemPrompt: string): void {
    // Validate input
    if (!intentType || typeof intentType !== 'string') {
      throw new Error('Invalid intent type');
    }
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      throw new Error('System prompt must be a non-empty string');
    }

    // Update in-memory config
    this.prompts[intentType] = {
      system_prompt: systemPrompt
    };

    // Write atomically to file (write to temp, then rename)
    try {
      const tempPath = this.filePath + '.tmp';
      writeFileSync(tempPath, JSON.stringify(this.prompts, null, 2));
      // In Node.js, renameSync is atomic on most filesystems
      const fs = require('fs');
      fs.renameSync(tempPath, this.filePath);
      console.log(`[IntentPromptManager] ✅ Updated prompt for intent: ${intentType}`);
    } catch (error) {
      console.error('[IntentPromptManager] Failed to write intent-prompts.json:', error);
      throw error;
    }
  }

  /**
   * Get all configured intent prompts
   */
  getAllPrompts(): IntentPromptsData {
    return { ...this.prompts };
  }

  /**
   * Reload prompts from disk (useful for admin changes)
   */
  reload(): void {
    this.load();
  }
}

// Singleton instance
export const intentPromptManager = new IntentPromptManager();
