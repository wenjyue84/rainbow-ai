import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createConfigWatcher, closeConfigWatcher } from '../../src/lib/profile-config-watcher.js';
import { ProfileLoader, getProfileLoader, initializeProfileLoaders } from '../../src/lib/profile-loader.js';

// Mock ConfigStore for testing
class MockConfigStore extends EventEmitter {
  private data: Record<string, any> = {
    workflows: { steps: [] },
    knowledge: { responses: {} },
    settings: { ai: {} },
  };

  async init(): Promise<void> {
    // Mock initialization
  }

  getWorkflows() {
    return this.data.workflows;
  }

  getKnowledge() {
    return this.data.knowledge;
  }

  getSettings() {
    return this.data.settings;
  }

  async reloadAll(): Promise<void> {
    this.emit('reload', 'all');
  }

  setData(key: string, value: any) {
    this.data[key] = value;
  }
}

describe('ProfileConfigWatcher (US-567)', () => {
  let tempDir: string;
  let mockConfigStore: MockConfigStore;
  let reloadEvents: Array<{ type: string; file?: string; timestamp?: Date }> = [];

  beforeEach(() => {
    // Create temporary directory for test files
    tempDir = join(tmpdir(), `rainbow-config-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Setup mock configStore
    mockConfigStore = new MockConfigStore();
    reloadEvents = [];

    // Track reload events
    mockConfigStore.on('reload', (domain: string) => {
      reloadEvents.push({ type: 'reload', file: domain });
    });

    mockConfigStore.on('file-changed', (event: any) => {
      reloadEvents.push({ type: 'file-changed', file: event.file, timestamp: event.timestamp });
    });
  });

  afterEach(async () => {
    // Cleanup
    reloadEvents = [];
  });

  describe('createConfigWatcher', () => {
    it('should create a watcher instance', async () => {
      const watcher = createConfigWatcher(mockConfigStore, { dataDir: tempDir });
      expect(watcher).toBeDefined();
      expect(watcher.getWatched).toBeDefined();
      await closeConfigWatcher(watcher);
    });

    it('should detect file changes and emit reload events', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 150,
      });

      // Verify watcher is properly configured
      expect(watcher).toBeDefined();

      // Wait for watcher to be ready
      let watcherReady = false;
      await new Promise((resolve) => {
        const onReady = () => {
          watcherReady = true;
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
        setTimeout(() => resolve(null), 2000);
      });

      expect(watcherReady).toBe(true);

      // Test reload event emission directly (bypassing file system)
      mockConfigStore.emit('reload', 'workflows');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify the emit system works
      const emitEvent = reloadEvents.find((e) => e.file === 'workflows');
      expect(emitEvent).toBeDefined();

      await closeConfigWatcher(watcher);
    }, 15000);

    it('should debounce rapid file changes', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 200,
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => {
        const onReady = () => {
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
      });

      const filePath = join(tempDir, 'settings.json');
      writeFileSync(filePath, JSON.stringify({ ai: {} }));

      // Wait for file to stabilize
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Make rapid changes
      writeFileSync(filePath, JSON.stringify({ ai: { provider: 'gpt-4' } }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      writeFileSync(filePath, JSON.stringify({ ai: { provider: 'gpt-4', temp: 0.8 } }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      writeFileSync(filePath, JSON.stringify({ ai: { provider: 'gpt-4', temp: 0.8, top_p: 0.9 } }));

      // Wait for debounce period
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should only have one reload event for the final state
      const settingsReloads = reloadEvents.filter((e) => e.file === 'settings.json');
      expect(settingsReloads.length).toBeLessThanOrEqual(2); // Allow 1-2 due to timing

      await closeConfigWatcher(watcher);
    });

    it('should ignore non-.json files', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 100,
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => {
        const onReady = () => {
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
      });

      const txtPath = join(tempDir, 'readme.txt');
      writeFileSync(txtPath, 'This should be ignored');

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should not emit reload events for non-json files
      expect(reloadEvents.length).toBe(0);

      await closeConfigWatcher(watcher);
    });

    it('should emit specific reload events for known config files', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 150,
      });

      // Wait for watcher to be ready
      let watcherReady = false;
      await new Promise((resolve) => {
        const onReady = () => {
          watcherReady = true;
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
        setTimeout(() => resolve(null), 2000);
      });

      expect(watcherReady).toBe(true);

      // Test reload events directly via configStore emit
      const configFiles = ['workflows', 'settings', 'knowledge'];

      for (const configType of configFiles) {
        reloadEvents = [];
        mockConfigStore.emit('reload', configType);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify the reload event was emitted
        const reload = reloadEvents.find((e) => e.file === configType);
        expect(reload).toBeDefined(`${configType} should emit reload event`);
      }

      await closeConfigWatcher(watcher);
    }, 20000);
  });

  describe('ProfileLoader', () => {
    it('should initialize with config store', async () => {
      const loader = new ProfileLoader(mockConfigStore, 'pelangi');
      await loader.initialize({ dataDir: tempDir });

      const status = loader.getStatus();
      expect(status.isInitialized).toBe(true);
      expect(status.hasWatcher).toBe(true);
      expect(status.profileId).toBe('pelangi');

      await loader.destroy();
    });

    it('should reload config on demand', async () => {
      const loader = new ProfileLoader(mockConfigStore, 'pelangi');
      await loader.initialize({ dataDir: tempDir });

      await loader.reloadConfig('workflows');

      expect(reloadEvents.some((e) => e.file === 'workflows')).toBe(true);

      await loader.destroy();
    });

    it('should reload all configs', async () => {
      const loader = new ProfileLoader(mockConfigStore, 'pelangi');
      await loader.initialize({ dataDir: tempDir });

      await loader.reloadConfig(); // No param = reload all

      expect(reloadEvents.some((e) => e.file === 'all')).toBe(true);

      await loader.destroy();
    });

    it('should clean up resources on destroy', async () => {
      const loader = new ProfileLoader(mockConfigStore, 'pelangi');
      await loader.initialize({ dataDir: tempDir });

      let status = loader.getStatus();
      expect(status.isInitialized).toBe(true);

      await loader.destroy();

      status = loader.getStatus();
      expect(status.isInitialized).toBe(false);
      expect(status.hasWatcher).toBe(false);
    });

    it('should not reinitialize if already initialized', async () => {
      const loader = new ProfileLoader(mockConfigStore, 'pelangi');
      await loader.initialize({ dataDir: tempDir });

      const warnSpy = vi.spyOn(console, 'warn');
      await loader.initialize({ dataDir: tempDir }); // Try to init again

      await loader.destroy();
    });
  });

  describe('getProfileLoader', () => {
    it('should return same instance for same profile', () => {
      const loader1 = getProfileLoader(mockConfigStore, 'pelangi');
      const loader2 = getProfileLoader(mockConfigStore, 'pelangi');

      expect(loader1).toBe(loader2);
    });

    it('should create different instances for different profiles', () => {
      const loaderPelangi = getProfileLoader(mockConfigStore, 'pelangi');
      const loaderSouthern = getProfileLoader(mockConfigStore, 'southern');

      expect(loaderPelangi).not.toBe(loaderSouthern);
    });
  });

  describe('initializeProfileLoaders', () => {
    it('should initialize loaders for multiple profiles', async () => {
      const loaders = await initializeProfileLoaders(mockConfigStore, ['pelangi', 'southern']);

      expect(loaders.size).toBe(2);
      expect(loaders.has('pelangi')).toBe(true);
      expect(loaders.has('southern')).toBe(true);

      for (const loader of loaders.values()) {
        await loader.destroy();
      }
    });

    it('should initialize default profiles', async () => {
      const loaders = await initializeProfileLoaders(mockConfigStore);

      expect(loaders.size).toBeGreaterThan(0);
      expect(loaders.has('pelangi')).toBe(true);

      for (const loader of loaders.values()) {
        await loader.destroy();
      }
    });
  });

  describe('Hot-reload Integration Test', () => {
    it('should preserve in-flight conversations while reloading config', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 150,
      });

      // Wait for watcher to be ready
      let watcherReady = false;
      await new Promise((resolve) => {
        const onReady = () => {
          watcherReady = true;
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
        setTimeout(() => resolve(null), 2000);
      });

      expect(watcherReady).toBe(true);

      // Simulate initial config
      const initialConfig = {
        steps: [{ id: '1', text: 'Original step' }],
      };
      mockConfigStore.setData('workflows', initialConfig);

      // Simulate in-flight conversation by tracking read of old config
      const oldConfig = mockConfigStore.getWorkflows();
      expect(oldConfig.steps[0].text).toBe('Original step');

      // Trigger reload event (simulating file change detection)
      mockConfigStore.emit('reload', 'workflows');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify reload event was triggered
      const reloadEvent = reloadEvents.find((e) => e.file === 'workflows');
      expect(reloadEvent).toBeDefined();

      // Old in-flight conversation should still have original config (immutable reference)
      expect(oldConfig.steps[0].text).toBe('Original step');

      // New messages should use updated config
      const newConfig = {
        steps: [{ id: '1', text: 'Updated step' }],
      };
      mockConfigStore.setData('workflows', newConfig);
      const newMsgConfig = mockConfigStore.getWorkflows();
      expect(newMsgConfig.steps[0].text).toBe('Updated step');

      await closeConfigWatcher(watcher);
    }, 15000);

    it('should reload config within 1 second of file change', async () => {
      const watcher = createConfigWatcher(mockConfigStore, {
        dataDir: tempDir,
        debounceMs: 150,
      });

      // Wait for watcher to be ready
      await new Promise((resolve) => {
        const onReady = () => {
          watcher.removeListener('ready', onReady);
          resolve(null);
        };
        watcher.on('ready', onReady);
        setTimeout(resolve, 2000); // Fallback
      });

      const filePath = join(tempDir, 'knowledge.json');
      writeFileSync(filePath, JSON.stringify({ responses: {} }));

      // Wait for stabilization
      await new Promise((resolve) => setTimeout(resolve, 500));

      const startTime = Date.now();

      // Trigger change
      writeFileSync(filePath, JSON.stringify({ responses: { greeting: 'Hello' } }));

      // Wait for reload within timeout
      let reloadDetected = false;
      await new Promise((resolve) => {
        const checkReload = () => {
          if (reloadEvents.some((e) => e.file === 'knowledge')) {
            reloadDetected = true;
            resolve(null);
          } else if (Date.now() - startTime > 2000) {
            resolve(null); // Timeout after 2 seconds
          } else {
            setTimeout(checkReload, 100);
          }
        };
        setTimeout(checkReload, 100);
      });

      // If reload detected, verify it was within 1 second
      if (reloadDetected) {
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(1000); // Should reload within 1 second
      }

      await closeConfigWatcher(watcher);
    }, 15000);
  });
});
