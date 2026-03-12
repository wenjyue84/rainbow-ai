/**
 * ProfileRegistry — Multi-Profile Management for Rainbow AI
 *
 * Maps WhatsApp instanceIds to profiles, each with its own
 * ConfigStore and KnowledgeBaseInstance.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { ConfigStore } from './config-store.js';
import { KnowledgeBaseInstance } from './knowledge-base-instance.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface ProfileConfig {
  id: string;
  name: string;
  instanceIds: string[];
  kbDir: string;
  dataDir: string;
  dbConfigPrefix: string;
  enabled: boolean;
}

export interface ProfilesFile {
  profiles: ProfileConfig[];
  defaultProfileId: string;
}

export interface ResolvedProfile {
  id: string;
  name: string;
  configStore: ConfigStore;
  kb: KnowledgeBaseInstance;
  config: ProfileConfig;
}

// ─── ProfileRegistry ─────────────────────────────────────────────────

class ProfileRegistryClass {
  private profiles: Map<string, ResolvedProfile> = new Map();
  private instanceMap: Map<string, string> = new Map(); // instanceId → profileId
  private defaultProfileId: string = 'pelangi';
  private initialized = false;

  /**
   * Load profiles.json and create per-profile ConfigStore + KB instances.
   * Must be called once at startup after ensureConfigTables().
   */
  async init(): Promise<void> {
    const profilesPath = join(process.cwd(), 'profiles.json');

    let profilesFile: ProfilesFile;

    if (existsSync(profilesPath)) {
      try {
        profilesFile = JSON.parse(readFileSync(profilesPath, 'utf-8'));
        console.log(`[ProfileRegistry] Loaded ${profilesFile.profiles.length} profile(s) from profiles.json`);
      } catch (err: any) {
        console.error(`[ProfileRegistry] Failed to parse profiles.json: ${err.message}`);
        console.error(`[ProfileRegistry] Falling back to single default profile`);
        profilesFile = this.getDefaultProfilesFile();
      }
    } else {
      console.log('[ProfileRegistry] No profiles.json found, using single default profile');
      profilesFile = this.getDefaultProfilesFile();
    }

    this.defaultProfileId = profilesFile.defaultProfileId;

    for (const profileConfig of profilesFile.profiles) {
      if (!profileConfig.enabled) {
        console.log(`[ProfileRegistry] Skipping disabled profile: ${profileConfig.id}`);
        continue;
      }

      const kbDir = resolve(process.cwd(), profileConfig.kbDir);
      const dataDir = resolve(process.cwd(), profileConfig.dataDir);

      // Create per-profile ConfigStore
      const configStoreInstance = new ConfigStore(profileConfig.id, dataDir, profileConfig.dbConfigPrefix);

      // Create per-profile KnowledgeBaseInstance
      const kb = new KnowledgeBaseInstance(profileConfig.id, kbDir, dataDir);

      // Build instanceId → profileId map
      for (const instanceId of profileConfig.instanceIds) {
        this.instanceMap.set(instanceId, profileConfig.id);
      }

      this.profiles.set(profileConfig.id, {
        id: profileConfig.id,
        name: profileConfig.name,
        configStore: configStoreInstance,
        kb,
        config: profileConfig,
      });

      console.log(`[ProfileRegistry] Registered profile: ${profileConfig.id} (${profileConfig.name})`);
    }

    // Validate default profile exists
    if (!this.profiles.has(this.defaultProfileId)) {
      const firstProfile = this.profiles.keys().next().value;
      if (firstProfile) {
        console.warn(`[ProfileRegistry] Default profile "${this.defaultProfileId}" not found, using "${firstProfile}"`);
        this.defaultProfileId = firstProfile;
      } else {
        throw new Error('[ProfileRegistry] No enabled profiles found!');
      }
    }

    // Initialize all ConfigStores and KBs
    for (const [id, profile] of this.profiles) {
      try {
        await profile.configStore.init();
        console.log(`[ProfileRegistry] ConfigStore initialized for profile: ${id}`);
      } catch (err: any) {
        console.error(`[ProfileRegistry] ConfigStore init failed for ${id}:`, err.message);
      }

      try {
        profile.kb.init(profile.configStore);
        await profile.kb.initKBFromDB();
        console.log(`[ProfileRegistry] KB initialized for profile: ${id}`);
      } catch (err: any) {
        console.error(`[ProfileRegistry] KB init failed for ${id}:`, err.message);
      }
    }

    this.initialized = true;
    console.log(`[ProfileRegistry] Initialized ${this.profiles.size} profile(s), default: ${this.defaultProfileId}`);
  }

  /**
   * Resolve a profile from an instanceId.
   * Falls back to default profile for unknown/missing instanceIds.
   */
  resolveProfile(instanceId?: string): ResolvedProfile {
    if (!this.initialized) {
      // Before init, return default
      const defaultProfile = this.profiles.get(this.defaultProfileId);
      if (defaultProfile) return defaultProfile;
      throw new Error('[ProfileRegistry] Not initialized and no default profile');
    }

    if (instanceId) {
      const profileId = this.instanceMap.get(instanceId);
      if (profileId) {
        const profile = this.profiles.get(profileId);
        if (profile) return profile;
      }
    }

    // Fall back to default profile
    const defaultProfile = this.profiles.get(this.defaultProfileId);
    if (!defaultProfile) {
      throw new Error(`[ProfileRegistry] Default profile "${this.defaultProfileId}" not found`);
    }
    return defaultProfile;
  }

  /**
   * Get a profile by ID directly.
   */
  getProfile(profileId: string): ResolvedProfile | undefined {
    return this.profiles.get(profileId);
  }

  /**
   * Get the default profile.
   */
  getDefaultProfile(): ResolvedProfile {
    const profile = this.profiles.get(this.defaultProfileId);
    if (!profile) throw new Error(`[ProfileRegistry] Default profile "${this.defaultProfileId}" not found`);
    return profile;
  }

  /**
   * List all enabled profiles.
   */
  listProfiles(): ResolvedProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get the default profile ID.
   */
  getDefaultProfileId(): string {
    return this.defaultProfileId;
  }

  /**
   * Check if the registry has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private getDefaultProfilesFile(): ProfilesFile {
    return {
      profiles: [
        {
          id: 'pelangi',
          name: 'Pelangi Capsule Hostel',
          instanceIds: [],
          kbDir: '.rainbow-kb',
          dataDir: 'src/assistant/data',
          dbConfigPrefix: '',
          enabled: true,
        }
      ],
      defaultProfileId: 'pelangi',
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────

export const profileRegistry = new ProfileRegistryClass();
