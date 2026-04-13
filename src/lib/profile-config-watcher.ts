import chokidar from 'chokidar';
import { join } from 'path';
import type { EventEmitter } from 'events';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ProfileConfigWatcher');

export interface ConfigWatcherOptions {
  dataDir?: string;
  debounceMs?: number;
  profileId?: string;
}

/**
 * Creates a file watcher for profile configuration JSON files.
 * Monitors src/assistant/data/*.json and emits change events to the provided emitter.
 *
 * US-567: Watches profile config directories and triggers reload on file change.
 * Implements <1s trigger time (debounce prevents rapid successive reloads).
 */
export function createConfigWatcher(
  configEmitter: EventEmitter,
  options: ConfigWatcherOptions = {}
): chokidar.FSWatcher {
  const {
    dataDir = join(process.cwd(), 'src', 'assistant', 'data'),
    debounceMs = 500, // 500ms debounce for <1s trigger
    profileId = 'pelangi',
  } = options;

  // Track pending changes per file to debounce rapid changes
  const pendingReloads = new Map<string, NodeJS.Timeout>();

  const watcher = chokidar.watch(dataDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  watcher.on('change', (filePath: string) => {
    // Only process .json files
    if (!filePath.endsWith('.json')) {
      return;
    }

    const fileName = filePath.split(/[/\\]/).pop() || '';

    // Clear any pending reload for this file
    const existingTimeout = pendingReloads.get(fileName);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Debounce: wait 500ms before reloading
    const timeout = setTimeout(() => {
      logger.info(`[${profileId}] Config file changed: ${fileName}, reloading...`);

      // Emit reload event to configStore
      configEmitter.emit('file-changed', {
        file: fileName,
        timestamp: new Date(),
        profileId,
      });

      // Also emit specific config reload if the file matches known types
      if (fileName === 'workflows.json') {
        configEmitter.emit('reload', 'workflows');
      } else if (fileName === 'knowledge.json') {
        configEmitter.emit('reload', 'knowledge');
      } else if (fileName === 'settings.json') {
        configEmitter.emit('reload', 'settings');
      } else if (fileName === 'intents.json') {
        configEmitter.emit('reload', 'intents');
      } else if (fileName === 'routing.json') {
        configEmitter.emit('reload', 'routing');
      } else if (fileName === 'templates.json') {
        configEmitter.emit('reload', 'templates');
      }

      pendingReloads.delete(fileName);
    }, debounceMs);

    pendingReloads.set(fileName, timeout);
  });

  watcher.on('error', (error: Error) => {
    logger.error(`[${profileId}] Watcher error:`, error);
  });

  watcher.on('ready', () => {
    logger.info(`[${profileId}] Config file watcher ready, monitoring: ${dataDir}`);
  });

  return watcher;
}

/**
 * Closes the file watcher and cleans up resources.
 */
export async function closeConfigWatcher(watcher: chokidar.FSWatcher): Promise<void> {
  await watcher.close();
  logger.info('Config file watcher closed');
}
