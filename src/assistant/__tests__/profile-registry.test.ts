import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock heavy dependencies before imports ────────────────────────────
// ConfigStore and KnowledgeBaseInstance hit DB/filesystem — mock them entirely.

vi.mock('../config-store.js', () => {
  class MockConfigStore {
    readonly profileId: string;
    constructor(profileId: string = 'pelangi', _dataDir?: string, _prefix?: string) {
      this.profileId = profileId;
    }
    async init() {}
    on() { return this; }
  }
  return {
    ConfigStore: MockConfigStore,
    configStore: new MockConfigStore('pelangi'),
  };
});

vi.mock('../knowledge-base-instance.js', () => {
  class MockKB {
    readonly profileId: string;
    constructor(profileId: string) { this.profileId = profileId; }
    init() {}
    async initKBFromDB() {}
  }
  return { KnowledgeBaseInstance: MockKB };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// ─── Imports (after mocks) ─────────────────────────────────────────────

import { existsSync, readFileSync } from 'fs';
import type { ProfilesFile } from '../profile-registry.js';

// We need a fresh ProfileRegistry for each test, but the module exports a singleton.
// Use resetModules to get a clean instance each time.

function makeProfilesJson(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: [
      {
        id: 'pelangi',
        name: 'Pelangi Capsule Hostel',
        instanceIds: ['instance-pelangi-1', 'instance-pelangi-2'],
        kbDir: '.rainbow-kb',
        dataDir: 'src/assistant/data',
        dbConfigPrefix: '',
        enabled: true,
      },
      {
        id: 'southern',
        name: 'Southern Homestay',
        instanceIds: ['instance-southern-1'],
        kbDir: '.rainbow-kb-southern',
        dataDir: 'src/assistant/data-southern',
        dbConfigPrefix: 'southern_',
        enabled: true,
      },
    ],
    defaultProfileId: 'pelangi',
    ...overrides,
  };
}

// ─── ProfileRegistry tests ─────────────────────────────────────────────

describe('ProfileRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadFreshRegistry() {
    const mod = await import('../profile-registry.js');
    return mod.profileRegistry;
  }

  function setupProfilesJson(data: ProfilesFile) {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));
  }

  it('resolveProfile with known instanceId returns correct profile', async () => {
    const data = makeProfilesJson();
    setupProfilesJson(data);

    const registry = await loadFreshRegistry();
    await registry.init();

    const profile = registry.resolveProfile('instance-southern-1');
    expect(profile.id).toBe('southern');
    expect(profile.name).toBe('Southern Homestay');
  });

  it('resolveProfile with second instanceId for same profile works', async () => {
    const data = makeProfilesJson();
    setupProfilesJson(data);

    const registry = await loadFreshRegistry();
    await registry.init();

    const profile1 = registry.resolveProfile('instance-pelangi-1');
    const profile2 = registry.resolveProfile('instance-pelangi-2');
    expect(profile1.id).toBe('pelangi');
    expect(profile2.id).toBe('pelangi');
    expect(profile1).toBe(profile2); // Same reference
  });

  it('resolveProfile with unknown instanceId returns default profile', async () => {
    const data = makeProfilesJson();
    setupProfilesJson(data);

    const registry = await loadFreshRegistry();
    await registry.init();

    const profile = registry.resolveProfile('unknown-instance-xyz');
    expect(profile.id).toBe('pelangi');
  });

  it('resolveProfile with undefined instanceId returns default profile', async () => {
    const data = makeProfilesJson();
    setupProfilesJson(data);

    const registry = await loadFreshRegistry();
    await registry.init();

    const profile = registry.resolveProfile(undefined);
    expect(profile.id).toBe('pelangi');
  });

  it('skips disabled profiles', async () => {
    const data = makeProfilesJson();
    data.profiles[1].enabled = false;
    setupProfilesJson(data);

    const registry = await loadFreshRegistry();
    await registry.init();

    // Southern disabled — its instanceId should resolve to default
    const profile = registry.resolveProfile('instance-southern-1');
    expect(profile.id).toBe('pelangi');

    expect(registry.listProfiles()).toHaveLength(1);
  });

  it('falls back to single default profile when profiles.json missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const registry = await loadFreshRegistry();
    await registry.init();

    const profile = registry.resolveProfile(undefined);
    expect(profile.id).toBe('pelangi');
    expect(registry.listProfiles()).toHaveLength(1);
  });
});

// ─── Conversation key scoping tests ────────────────────────────────────

describe('Conversation key scoping (convoKey via getOrCreate)', () => {
  beforeEach(() => {
    vi.resetModules();

    // Mock state-persistence so conversations module doesn't hit DB
    vi.mock('../state-persistence.js', () => ({
      initStatePersistence: vi.fn().mockResolvedValue(undefined),
      loadActiveStates: vi.fn().mockResolvedValue([]),
      schedulePersist: vi.fn(),
      deletePersistedState: vi.fn().mockResolvedValue(undefined),
    }));

    // Mock formatter since detectLanguage may have external deps
    vi.mock('../formatter.js', () => ({
      detectLanguage: vi.fn().mockReturnValue('en'),
    }));
  });

  async function loadConversation() {
    return await import('../conversation.js');
  }

  it('pelangi profile uses plain phone as key (backward compatible)', async () => {
    const convo = await loadConversation();

    const state1 = convo.getOrCreate('60123456789', 'Alice', 'pelangi');
    expect(state1.phone).toBe('60123456789');

    // Creating with same phone but no profileId should return same conversation
    const state2 = convo.getOrCreate('60123456789', 'Alice');
    expect(state2).toBe(state1);
  });

  it('non-default profile scopes key as profileId:phone', async () => {
    const convo = await loadConversation();

    // Create conversations for same phone, different profiles
    const pelangiState = convo.getOrCreate('60123456789', 'Alice', 'pelangi');
    const southernState = convo.getOrCreate('60123456789', 'Alice', 'southern');

    // They should be separate conversation states
    expect(pelangiState).not.toBe(southernState);
    expect(pelangiState.phone).toBe('60123456789');
    expect(southernState.phone).toBe('60123456789');
  });

  it('empty profileId uses plain phone (same as pelangi)', async () => {
    const convo = await loadConversation();

    const state1 = convo.getOrCreate('60123456789', 'Alice', '');
    const state2 = convo.getOrCreate('60123456789', 'Alice', 'pelangi');
    expect(state1).toBe(state2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

// ─── getStore(res) tests ───────────────────────────────────────────────

describe('getStore(res)', () => {
  it('returns profile-specific ConfigStore when res.locals.profileConfigStore is set', async () => {
    const { getStore } = await import('../../routes/admin/http-utils.js');
    const { ConfigStore } = await import('../config-store.js');

    const mockProfileStore = new ConfigStore('southern');
    const mockRes = {
      locals: { profileConfigStore: mockProfileStore },
    } as any;

    const store = getStore(mockRes);
    expect(store).toBe(mockProfileStore);
    expect(store.profileId).toBe('southern');
  });

  it('returns default configStore when no profile header is set', async () => {
    const { getStore } = await import('../../routes/admin/http-utils.js');

    const mockRes = {
      locals: {},
    } as any;

    const store = getStore(mockRes);
    expect(store.profileId).toBe('pelangi');
  });

  it('returns default configStore when profileConfigStore is undefined', async () => {
    const { getStore } = await import('../../routes/admin/http-utils.js');

    const mockRes = {
      locals: { profileConfigStore: undefined },
    } as any;

    const store = getStore(mockRes);
    expect(store.profileId).toBe('pelangi');
  });
});
