/**
 * KB Source Manifest
 * Tracks origins and metadata for extracted KB documents
 */

import { promises as fsPromises } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Types ────────────────────────────────────────────────────────────────

export interface SourceEntry {
  kbFile: string;
  sourceFilename: string;
  extractedAt: string;
  extractedChars: number;
  kreuzbergVersion: string;
}

// ─── Kreuzberg Version ────────────────────────────────────────────────────

let cachedKreuzbergVersion: string | null = null;

async function getKreuzbergVersion(): Promise<string> {
  if (cachedKreuzbergVersion) {
    return cachedKreuzbergVersion;
  }

  try {
    const { stdout } = await execAsync('kreuzberg --version');
    // Output is "kreuzberg X.Y.Z", extract version
    const match = stdout.match(/kreuzberg\s+([\d.]+)/);
    if (match && match[1]) {
      cachedKreuzbergVersion = match[1];
      return match[1];
    }
  } catch (err) {
    console.warn('[KB:manifest] Failed to get kreuzberg version:', err);
  }

  return 'unknown';
}

// ─── Manifest File Operations ────────────────────────────────────────────

const MANIFEST_FILENAME = '_sources.json';

/**
 * Read the _sources.json manifest from a KB directory
 * Returns empty array if file doesn't exist
 */
async function readManifest(kbDir: string): Promise<SourceEntry[]> {
  const manifestPath = path.join(kbDir, MANIFEST_FILENAME);

  try {
    const content = await fsPromises.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return data;
    }
  } catch (err: any) {
    // File doesn't exist or is malformed — treat as empty array
    if (err.code !== 'ENOENT') {
      console.warn(`[KB:manifest] Error reading ${MANIFEST_FILENAME}:`, err.message);
    }
  }

  return [];
}

/**
 * Update or append an entry in the manifest.
 * If kbFile already exists, updates all fields. Otherwise appends.
 */
export async function updateSourceManifest(opts: {
  kbDir: string;
  kbFile: string;
  sourceFilename: string;
  extractedChars: number;
}): Promise<void> {
  const entries = await readManifest(opts.kbDir);

  // Get kreuzberg version
  const version = await getKreuzbergVersion();

  // Find existing entry
  const existingIdx = entries.findIndex((e) => e.kbFile === opts.kbFile);

  const newEntry: SourceEntry = {
    kbFile: opts.kbFile,
    sourceFilename: opts.sourceFilename,
    extractedAt: new Date().toISOString(),
    extractedChars: opts.extractedChars,
    kreuzbergVersion: version,
  };

  if (existingIdx >= 0) {
    // Update existing entry
    entries[existingIdx] = newEntry;
  } else {
    // Append new entry
    entries.push(newEntry);
  }

  // Atomic write: temp file + rename
  const manifestPath = path.join(opts.kbDir, MANIFEST_FILENAME);
  const tempPath = `${manifestPath}.tmp`;

  try {
    const json = JSON.stringify(entries, null, 2);
    await fsPromises.writeFile(tempPath, json, 'utf-8');
    // Atomic rename
    await fsPromises.rename(tempPath, manifestPath);
  } catch (err) {
    // Cleanup temp file on error
    try {
      await fsPromises.unlink(tempPath);
    } catch {}
    throw err;
  }
}

/**
 * Read and return the _sources.json for a KB directory.
 * Returns empty array if manifest doesn't exist.
 */
export async function getSourceManifest(kbDir: string): Promise<SourceEntry[]> {
  return readManifest(kbDir);
}
