import type chokidar from 'chokidar';
import { createConfigWatcher, closeConfigWatcher } from './profile-config-watcher.js';
import { createModuleLogger } from './logger.js';
import type { ConfigStore } from '../assistant/config-store.js';

const logger = createModuleLogger('ProfileLoader');

export interface ProfileLoaderConfig {
  dataDir?: string;
  debounceMs?: number;
}

/**
 * Manages profile configuration loading with file watcher integration.
 * Enables hot-reload of JSON configs without server restart.
 *
 * US-567: Implements hot-reload for profile configurations.
 * Preserves in-flight conversations while updating cached config references.
 */
export class ProfileLoader {
  private configStore: ConfigStore;
  private profileId: string;
  private watcher: chokidar.FSWatcher | null = null;
  private isInitialized = false;

  constructor(configStore: ConfigStore, profileId: string = 'pelangi') {
    this.configStore = configStore;
    this.profileId = profileId;
  }

  /**
   * Initializes the profile loader with config store and starts file watcher.
   * Must be called after configStore.init().
   */
  async initialize(config?: ProfileLoaderConfig): Promise<void> {
    if (this.isInitialized) {
      logger.warn(`[${this.profileId}] ProfileLoader already initialized`);
      return;
    }

    try {
      // Create file watcher that emits to the configStore
      this.watcher = createConfigWatcher(this.configStore, {
        dataDir: config?.dataDir,
        debounceMs: config?.debounceMs,
        profileId: this.profileId,
      });

      // Listen to file-changed events from watcher
      this.configStore.on('file-changed', (event: any) => {
        logger.info(
          `[${this.profileId}] File change detected for ${event.file}, reloading config...`
        );
      });

      // Listen to reload events to log what was reloaded
      this.configStore.on('reload', (domain: string) => {
        logger.info(`[${this.profileId}] Config reloaded: ${domain}`);
      });

      this.isInitialized = true;
      logger.info(`[${this.profileId}] ProfileLoader initialized with hot-reload`);
    } catch (error: any) {
      logger.error(`[${this.profileId}] Failed to initialize ProfileLoader:`, error);
      throw error;
    }
  }

  /**
   * Explicitly reloads a specific configuration or all configurations.
   * Called when a file change is detected by the watcher.
   */
  async reloadConfig(configName?: string): Promise<void> {
    if (!this.isInitialized) {
      logger.warn(`[${this.profileId}] ProfileLoader not initialized, skipping reload`);
      return;
    }

    try {
      if (configName) {
        // Reload specific config by emitting reload event
        this.configStore.emit('reload', configName);
        logger.info(`[${this.profileId}] Reloaded specific config: ${configName}`);
      } else {
        // Force reload all configs
        await this.configStore.reloadAll();
        logger.info(`[${this.profileId}] Reloaded all configs`);
      }
    } catch (error: any) {
      logger.error(`[${this.profileId}] Failed to reload config:`, error);
      throw error;
    }
  }

  /**
   * Closes the file watcher and cleans up resources.
   * Should be called during application shutdown.
   */
  async destroy(): Promise<void> {
    if (this.watcher) {
      await closeConfigWatcher(this.watcher);
      this.watcher = null;
    }
    this.isInitialized = false;
    logger.info(`[${this.profileId}] ProfileLoader destroyed`);
  }

  /**
   * Gets the current status of the ProfileLoader.
   */
  getStatus(): { isInitialized: boolean; hasWatcher: boolean; profileId: string } {
    return {
      isInitialized: this.isInitialized,
      hasWatcher: this.watcher !== null,
      profileId: this.profileId,
    };
  }
}

// Export singleton instances for each profile
const loaderInstances = new Map<string, ProfileLoader>();

/**
 * Gets or creates a ProfileLoader instance for a given profile.
 */
export function getProfileLoader(
  configStore: ConfigStore,
  profileId: string = 'pelangi'
): ProfileLoader {
  const key = `${profileId}:loader`;
  if (!loaderInstances.has(key)) {
    loaderInstances.set(key, new ProfileLoader(configStore, profileId));
  }
  return loaderInstances.get(key)!;
}

/**
 * Initializes all profile loaders with hot-reload capability.
 */
export async function initializeProfileLoaders(
  configStore: ConfigStore,
  profileIds: string[] = ['pelangi', 'southern', 'makan']
): Promise<Map<string, ProfileLoader>> {
  const loaders = new Map<string, ProfileLoader>();

  for (const profileId of profileIds) {
    const loader = getProfileLoader(configStore, profileId);
    try {
      await loader.initialize();
      loaders.set(profileId, loader);
    } catch (error) {
      logger.error(`[${profileId}] Failed to initialize ProfileLoader:`, error);
    }
  }

  logger.info(`Initialized ${loaders.size}/${profileIds.length} ProfileLoaders`);
  return loaders;
}
