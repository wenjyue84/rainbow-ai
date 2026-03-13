/**
 * knowledge-base.ts — Backward-compatible wrapper
 *
 * Delegates to the default profile's KnowledgeBaseInstance.
 * New code should use profileRegistry.resolveProfile(instanceId).kb instead.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { configStore } from './config-store.js';
import {
  KnowledgeBaseInstance,
  getTodayDate as _getTodayDate,
  getYesterdayDate as _getYesterdayDate,
  getMYTTimestamp as _getMYTTimestamp,
  getTimeContext as _getTimeContext,
} from './knowledge-base-instance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default instance for backward compatibility (Pelangi profile)
const RAINBOW_KB_DIR = process.env.RAINBOW_KB_DIR || resolve(__dirname, '..', '..', '.rainbow-kb');
const DEFAULT_DATA_DIR = resolve(__dirname, 'data');

const defaultInstance = new KnowledgeBaseInstance('pelangi', RAINBOW_KB_DIR, DEFAULT_DATA_DIR);

// Re-export timezone helpers (stateless, shared across profiles)
export const getTodayDate = _getTodayDate;
export const getYesterdayDate = _getYesterdayDate;
export const getMYTTimestamp = _getMYTTimestamp;
export const getTimeContext = _getTimeContext;

// ─── Delegating exports ─────────────────────────────────────────────

export function guessTopicFiles(text: string): string[] {
  return defaultInstance.guessTopicFiles(text);
}

export function getMemoryDir(): string {
  return defaultInstance.getMemoryDir();
}

export function getDurableMemory(): string {
  return defaultInstance.getDurableMemory();
}

export function listMemoryDays(): string[] {
  return defaultInstance.listMemoryDays();
}

export function reloadKBFile(filename: string): void {
  defaultInstance.reloadKBFile(filename);
}

export function reloadAllKB(): void {
  defaultInstance.reloadAllKB();
}

export async function initKBFromDB(): Promise<void> {
  await defaultInstance.initKBFromDB();
}

export function initKnowledgeBase(): void {
  defaultInstance.init(configStore);
}

export async function checkKBStaleness(): Promise<void> {
  await defaultInstance.checkKBStaleness();
}

export function getKnowledgeMarkdown(): string {
  return defaultInstance.getKnowledgeMarkdown();
}

export function setKnowledgeMarkdown(content: string): void {
  console.warn('[KnowledgeBase] setKnowledgeMarkdown called — this is a legacy no-op in progressive mode');
}

export function invalidateSystemPromptCache(): void {
  defaultInstance.invalidateSystemPromptCache();
}

export function buildSystemPrompt(basePersona: string, topicFiles: string[] = []): string {
  return defaultInstance.buildSystemPrompt(basePersona, topicFiles, configStore);
}

/** Expose the default instance for direct access */
export function getDefaultKBInstance(): KnowledgeBaseInstance {
  return defaultInstance;
}
