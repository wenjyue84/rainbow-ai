/**
 * Tests for US-480 / US-941: DB-backed Baileys auth state.
 *
 * Uses an in-memory mock of the pg pool to verify:
 * - Credential save followed by reload returns the same creds
 * - Signal key set/get round-trips correctly
 * - Null values (deletes) are handled
 * - Baileys v7 key types (lid-mapping, device-list, tctoken) stored correctly (US-941 AC2)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock the pg pool ────────────────────────────────────────────────────

const store = new Map<string, string>(); // "profileId|keyType|keyId" → JSON value

function storeKey(profileId: string, keyType: string, keyId: string): string {
  return `${profileId}|${keyType}|${keyId}`;
}

const mockClient = {
  query: vi.fn(async (sql: string, params?: any[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return;
    // Handle UPSERT
    if (sql.includes('INSERT INTO baileys_auth_state')) {
      const [profileId, keyType, keyId, value] = params!;
      store.set(storeKey(profileId, keyType, keyId), value);
      return;
    }
    // Handle DELETE
    if (sql.includes('DELETE FROM baileys_auth_state')) {
      const [profileId, keyType, keyId] = params!;
      store.delete(storeKey(profileId, keyType, keyId));
      return;
    }
  }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn(async (sql: string, params?: any[]) => {
    // CREATE TABLE — no-op
    if (sql.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
    // SELECT single
    if (sql.includes('WHERE profile_id = $1 AND key_type = $2 AND key_id = $3') && !sql.includes('ANY')) {
      const [profileId, keyType, keyId] = params!;
      const val = store.get(storeKey(profileId, keyType, keyId));
      return { rows: val ? [{ value: val }] : [] };
    }
    // SELECT many (ANY)
    if (sql.includes('ANY')) {
      const [profileId, keyType, ids] = params!;
      const rows = (ids as string[])
        .map(id => {
          const val = store.get(storeKey(profileId, keyType, id));
          return val ? { key_id: id, value: val } : null;
        })
        .filter(Boolean);
      return { rows };
    }
    // UPSERT
    if (sql.includes('INSERT INTO baileys_auth_state')) {
      const [profileId, keyType, keyId, value] = params!;
      store.set(storeKey(profileId, keyType, keyId), value);
      return { rows: [] };
    }
    // DELETE
    if (sql.includes('DELETE FROM baileys_auth_state')) {
      const [profileId, keyType, keyId] = params!;
      store.delete(storeKey(profileId, keyType, keyId));
      return { rows: [] };
    }
    return { rows: [] };
  }),
  connect: vi.fn(async () => mockClient),
};

vi.mock('../../lib/db.js', () => ({
  pool: mockPool,
}));

// Import AFTER mocking
const { useDbAuthState } = await import('../../lib/whatsapp/db-auth-state.js');

// ─── Tests ───────────────────────────────────────────────────────────────

describe('useDbAuthState (US-480 / US-941)', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('initializes fresh credentials when none exist in DB', async () => {
    const { state } = await useDbAuthState('test-profile');

    expect(state.creds).toBeDefined();
    expect(state.creds.registrationId).toBeDefined();
    expect(state.creds.signedPreKey).toBeDefined();
    expect(state.creds.signedIdentityKey).toBeDefined();
    expect(state.creds.noiseKey).toBeDefined();
  });

  it('credential save then reload returns identical creds', async () => {
    // First session: init + save
    const { state: state1, saveCreds: save1 } = await useDbAuthState('roundtrip');
    const originalRegId = state1.creds.registrationId;
    await save1();

    // Second session: reload from DB
    const { state: state2 } = await useDbAuthState('roundtrip');

    expect(state2.creds.registrationId).toBe(originalRegId);
    expect(state2.creds.signedPreKey.keyId).toBe(state1.creds.signedPreKey.keyId);
  });

  it('signal key set/get round-trips correctly', async () => {
    const { state } = await useDbAuthState('signal-test');

    // Set a pre-key
    const testKey = { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5, 6]) };
    await state.keys.set({ 'pre-key': { 'key-1': testKey } });

    // Flush the batch timer
    await vi.advanceTimersByTimeAsync(150);

    // Get it back
    const result = await state.keys.get('pre-key', ['key-1']);

    expect(result['key-1']).toBeDefined();
    // BufferJSON reviver converts Uint8Array to Buffer — compare byte contents
    expect(Buffer.from(result['key-1'].public)).toEqual(Buffer.from(testKey.public));
    expect(Buffer.from(result['key-1'].private)).toEqual(Buffer.from(testKey.private));
  });

  it('signal key delete (null value) removes the key', async () => {
    const { state } = await useDbAuthState('delete-test');

    // Set then delete a key
    const testKey = { public: new Uint8Array([7, 8]), private: new Uint8Array([9, 10]) };
    await state.keys.set({ 'pre-key': { 'del-key': testKey } });
    await vi.advanceTimersByTimeAsync(150);

    // Verify it's there
    const before = await state.keys.get('pre-key', ['del-key']);
    expect(before['del-key']).toBeDefined();

    // Delete it
    await state.keys.set({ 'pre-key': { 'del-key': null as any } });
    await vi.advanceTimersByTimeAsync(150);

    // Verify it's gone
    const after = await state.keys.get('pre-key', ['del-key']);
    expect(after['del-key']).toBeUndefined();
  });

  it('batches multiple key writes into a single transaction', async () => {
    const { state } = await useDbAuthState('batch-test');

    // Set multiple keys without flushing
    await state.keys.set({
      'pre-key': { 'a': { public: new Uint8Array([1]), private: new Uint8Array([2]) } },
      'session': { 'b': new Uint8Array([3, 4, 5]) },
    });
    await state.keys.set({
      'sender-key': { 'c': new Uint8Array([6, 7]) },
    });

    // Before flush — connect should not have been called yet for this batch
    const connectCallsBefore = mockPool.connect.mock.calls.length;

    // Flush
    await vi.advanceTimersByTimeAsync(150);

    // Should have used exactly ONE transaction (one connect call for this batch)
    const connectCallsAfter = mockPool.connect.mock.calls.length;
    expect(connectCallsAfter - connectCallsBefore).toBe(1);

    // Verify BEGIN and COMMIT were called
    const clientQueries = mockClient.query.mock.calls.map(c => c[0]);
    expect(clientQueries).toContain('BEGIN');
    expect(clientQueries).toContain('COMMIT');
  });

  it('different profiles have isolated auth state', async () => {
    const { state: s1, saveCreds: save1 } = await useDbAuthState('profile-a');
    await save1();
    const regId1 = s1.creds.registrationId;

    const { state: s2, saveCreds: save2 } = await useDbAuthState('profile-b');
    await save2();
    const regId2 = s2.creds.registrationId;

    // Different profiles get different credentials
    // (extremely unlikely to have the same registration ID)
    // Reload each and verify isolation
    const { state: r1 } = await useDbAuthState('profile-a');
    const { state: r2 } = await useDbAuthState('profile-b');

    expect(r1.creds.registrationId).toBe(regId1);
    expect(r2.creds.registrationId).toBe(regId2);
  });

  // ─── US-941 AC2: Baileys v7 key types ────────────────────────────────

  it('stores and retrieves lid-mapping keys (Baileys v7)', async () => {
    const { state } = await useDbAuthState('v7-lid');

    const lidMapping = { phone: '60123456789', lid: '12345678' };
    await state.keys.set({ 'lid-mapping': { 'lid-1': lidMapping } });
    await vi.advanceTimersByTimeAsync(150);

    const result = await state.keys.get('lid-mapping', ['lid-1']);
    expect(result['lid-1']).toBeDefined();
    expect(result['lid-1'].phone).toBe('60123456789');
    expect(result['lid-1'].lid).toBe('12345678');
  });

  it('stores and retrieves device-list keys (Baileys v7)', async () => {
    const { state } = await useDbAuthState('v7-device');

    const deviceList = [{ id: 'device-0', keyIndex: 0 }, { id: 'device-1', keyIndex: 1 }];
    await state.keys.set({ 'device-list': { 'my-devices': deviceList } });
    await vi.advanceTimersByTimeAsync(150);

    const result = await state.keys.get('device-list', ['my-devices']);
    expect(result['my-devices']).toBeDefined();
    expect(Array.isArray(result['my-devices'])).toBe(true);
    expect(result['my-devices']).toHaveLength(2);
    expect(result['my-devices'][0].id).toBe('device-0');
  });

  it('stores and retrieves tctoken keys (Baileys v7)', async () => {
    const { state } = await useDbAuthState('v7-tctoken');

    const tctoken = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE]);
    await state.keys.set({ 'tctoken': { 'token-1': tctoken } });
    await vi.advanceTimersByTimeAsync(150);

    const result = await state.keys.get('tctoken', ['token-1']);
    expect(result['token-1']).toBeDefined();
    expect(Buffer.from(result['token-1'])).toEqual(Buffer.from(tctoken));
  });

  it('handles all v7 key types in a single batch write', async () => {
    const { state } = await useDbAuthState('v7-batch');
    const connectCallsBefore = mockPool.connect.mock.calls.length;

    await state.keys.set({
      'lid-mapping': { 'lid-a': { phone: '601', lid: '001' } },
      'device-list': { 'dev-a': [{ id: 'd0' }] },
      'tctoken': { 'tok-a': new Uint8Array([1, 2, 3]) },
    });
    await vi.advanceTimersByTimeAsync(150);

    // All three key types written in a single transaction
    const connectCallsAfter = mockPool.connect.mock.calls.length;
    expect(connectCallsAfter - connectCallsBefore).toBe(1);

    // Verify all retrievable
    const lids = await state.keys.get('lid-mapping', ['lid-a']);
    const devs = await state.keys.get('device-list', ['dev-a']);
    const toks = await state.keys.get('tctoken', ['tok-a']);

    expect(lids['lid-a']).toBeDefined();
    expect(devs['dev-a']).toBeDefined();
    expect(toks['tok-a']).toBeDefined();
  });
});
