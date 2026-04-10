/**
 * config-sync.ts — Background poller for live config sync across servers.
 *
 * Both local dev and Lightsail share the same Neon Postgres DB. When settings
 * are updated on one server (via admin API), the other picks up the change
 * within POLL_INTERVAL_MS by comparing DB version numbers against in-memory
 * knownVersions on each ConfigStore.
 *
 * Cost: one lightweight SELECT per interval (~42 rows, primary-key indexed).
 */

import { profileRegistry } from '../assistant/profile-registry.js';
import { configStore } from '../assistant/config-store.js';
import { getConfigVersions } from './config-db.js';

const POLL_INTERVAL_MS = 60_000;  // 60 seconds
const STARTUP_DELAY_MS = 30_000;  // wait for init to settle

let pollTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function startConfigSync(): void {
  if (pollTimer) return; // already running

  startupTimer = setTimeout(() => {
    pollTimer = setInterval(pollForChanges, POLL_INTERVAL_MS);
    console.log('[ConfigSync] Background config version polling started (60s interval)');
    startupTimer = null;
  }, STARTUP_DELAY_MS);
}

export function stopConfigSync(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[ConfigSync] Background config version polling stopped');
  }
}

async function pollForChanges(): Promise<void> {
  try {
    // Single DB query for all version numbers
    const versions = await getConfigVersions();
    if (versions.size === 0) return; // DB unavailable or empty

    // Check each profile's ConfigStore
    for (const profile of profileRegistry.listProfiles()) {
      const changed = await profile.configStore.checkForUpdates(versions);
      if (changed) {
        console.log(`[ConfigSync] Config changes detected for profile "${profile.id}" — reloaded from DB`);
      }
    }

    // Also check the default singleton
    const defaultChanged = await configStore.checkForUpdates(versions);
    if (defaultChanged) {
      console.log('[ConfigSync] Config changes detected for default configStore — reloaded from DB');
    }
  } catch (err: any) {
    console.error('[ConfigSync] Poll failed:', err.message);
  }
}
