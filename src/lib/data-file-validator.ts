/**
 * Profile data file JSON schema validator with hot-reload (US-484).
 *
 * Validates routing.json, workflows.json, fallback-responses.json, and settings.json
 * against strict Zod schemas on startup. Watches for file changes via chokidar and
 * hot-reloads valid changes; keeps the previous version when a change is invalid.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

/** routing.json — map of intent -> action config */
const routingEntrySchema = z.union([
  z.object({
    action: z.literal('workflow'),
    workflow_id: z.string().min(1, 'workflow_id must be non-empty'),
  }).passthrough(),
  z.object({
    action: z.enum(['static_reply', 'llm_reply']),
  }).passthrough(),
]);

export const routingSchema = z
  .record(z.string(), routingEntrySchema)
  .refine((val) => Object.keys(val).length > 0, {
    message: 'routing.json must contain at least one intent mapping',
  });

/** workflows.json — { workflows: [...] } */
const workflowStepSchema = z.object({
  id: z.string().min(1),
}).passthrough();

const workflowSchema = z.object({
  id: z.string().min(1),
  steps: z.array(workflowStepSchema),
}).passthrough();

export const workflowsSchema = z.object({
  workflows: z.array(workflowSchema).min(1, 'workflows array must not be empty'),
}).passthrough();

/** fallback-responses.json — must have schema_version */
export const fallbackResponsesSchema = z.object({
  schema_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'schema_version must be a semver string like "1.0.0"'),
}).passthrough();

/** settings.json — must have ai and routing_mode sections */
export const settingsSchema = z.object({
  ai: z.record(z.unknown()),
  routing_mode: z.record(z.unknown()),
}).passthrough();

// ─── File Registry ────────────────────────────────────────────────────────────

type DataFileName =
  | 'routing.json'
  | 'workflows.json'
  | 'fallback-responses.json'
  | 'settings.json';

interface FileEntry {
  name: DataFileName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<any>;
  required: boolean;
}

const DATA_FILES: FileEntry[] = [
  { name: 'routing.json', schema: routingSchema, required: true },
  { name: 'workflows.json', schema: workflowsSchema, required: true },
  { name: 'fallback-responses.json', schema: fallbackResponsesSchema, required: false },
  { name: 'settings.json', schema: settingsSchema, required: true },
];

// ─── Validation Helpers ───────────────────────────────────────────────────────

export interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

/**
 * Parse and validate a single data file against its Zod schema.
 */
export function validateDataFile(filePath: string, schema: z.ZodType<unknown>): ValidationResult {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  if (!existsSync(filePath)) {
    return { file: fileName, valid: false, errors: [`File not found: ${filePath}`] };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { file: fileName, valid: false, errors: [`Cannot read file: ${msg}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { file: fileName, valid: false, errors: [`Invalid JSON: ${msg}`] };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `  [${issue.path.join('.') || '<root>'}] ${issue.message}`
    );
    return { file: fileName, valid: false, errors };
  }

  return { file: fileName, valid: true, errors: [], data: result.data };
}

// ─── Startup Validation ───────────────────────────────────────────────────────

/**
 * Validate all registered data files against their schemas.
 *
 * - Missing optional files are skipped (logged as a warning).
 * - Missing required files are counted as failures.
 * - On any failure, throws with a full list of violations so startup can abort.
 */
export function validateDataFilesOnStartup(dataDir: string): void {
  const failures: string[] = [];

  for (const entry of DATA_FILES) {
    const filePath = join(dataDir, entry.name);

    if (!existsSync(filePath)) {
      if (entry.required) {
        failures.push(`${entry.name}: required file not found at ${filePath}`);
      } else {
        console.warn(`[DataValidator] Optional file not found, skipping: ${entry.name}`);
      }
      continue;
    }

    const result = validateDataFile(filePath, entry.schema);
    if (!result.valid) {
      failures.push(`${entry.name}:\n${result.errors.join('\n')}`);
    } else {
      console.log(`[DataValidator] ✓ ${entry.name}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `[DataValidator] FATAL: ${failures.length} data file(s) failed schema validation:\n\n` +
        failures.map((f, i) => `(${i + 1}) ${f}`).join('\n\n')
    );
  }
}

// ─── Hot-Reload Watcher ───────────────────────────────────────────────────────

/** Cache of last-known-good parsed data per filename. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastValidCache = new Map<string, any>();

/**
 * Start a chokidar file watcher on the data directory.
 * On change: re-validates. If valid, updates the in-memory cache (hot-reload).
 * If invalid, logs detailed errors and retains the previous good version.
 *
 * Returns the watcher instance so the caller can close it on shutdown.
 */
export async function startDataFileWatcher(dataDir: string): Promise<import('chokidar').FSWatcher> {
  // Lazy import chokidar so that startup validation works even if chokidar is absent.
  const { default: chokidar } = await import('chokidar');

  const watchedNames = new Set(DATA_FILES.map((e) => e.name));

  // Pre-populate cache with the current valid state.
  for (const entry of DATA_FILES) {
    const filePath = join(dataDir, entry.name);
    if (existsSync(filePath)) {
      const result = validateDataFile(filePath, entry.schema);
      if (result.valid) {
        lastValidCache.set(entry.name, result.data);
      }
    }
  }

  const watcher = chokidar.watch(dataDir, {
    ignored: /(^|[/\\])\../, // skip dotfiles
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', (changedPath: string) => {
    const fileName = changedPath.split(/[\\/]/).pop() ?? changedPath;

    if (!fileName.endsWith('.json') || !watchedNames.has(fileName as DataFileName)) {
      return; // only watch registered JSON files
    }

    const entry = DATA_FILES.find((e) => e.name === fileName);
    if (!entry) return;

    console.log(`[DataValidator] Detected change: ${fileName} — re-validating…`);

    const result = validateDataFile(changedPath, entry.schema);
    if (result.valid) {
      lastValidCache.set(fileName, result.data);
      console.log(`[DataValidator] ✓ Hot-reloaded: ${fileName}`);
    } else {
      console.error(
        `[DataValidator] ✗ Schema violation in ${fileName} — keeping prior version:\n` +
          result.errors.join('\n')
      );
    }
  });

  watcher.on('error', (err: unknown) => {
    console.error('[DataValidator] Watcher error:', err);
  });

  console.log(`[DataValidator] Watching ${dataDir} for data file changes`);
  return watcher;
}

/**
 * Retrieve the last-known-good parsed data for a given filename.
 * Returns undefined if the file was never successfully loaded.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLastValidData(fileName: DataFileName): any | undefined {
  return lastValidCache.get(fileName);
}
