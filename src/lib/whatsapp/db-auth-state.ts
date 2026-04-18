/**
 * db-auth-state.ts — PostgreSQL-backed Baileys auth state (US-480)
 *
 * Replaces useMultiFileAuthState with atomic DB persistence.
 * Signal key writes are batched (100 ms buffer, single transaction).
 */
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap, SignalDataSet } from '@whiskeysockets/baileys';
import { pool } from '../db.js';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Serialize a value to JSON using Baileys' BufferJSON (handles Buffer/Uint8Array). */
function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

/** Deserialize a JSON string back to its original form. */
function deserialize<T>(json: string): T {
  return JSON.parse(json, BufferJSON.reviver) as T;
}

// ─── SQL ────────────────────────────────────────────────────────────────

const ENSURE_TABLE = `
  CREATE TABLE IF NOT EXISTS baileys_auth_state (
    id SERIAL PRIMARY KEY,
    profile_id TEXT NOT NULL,
    key_type VARCHAR(64) NOT NULL,
    key_id VARCHAR(256) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_baileys_auth_profile_type_id UNIQUE (profile_id, key_type, key_id)
  );
  CREATE INDEX IF NOT EXISTS idx_baileys_auth_profile ON baileys_auth_state (profile_id);
`;

const UPSERT = `
  INSERT INTO baileys_auth_state (profile_id, key_type, key_id, value, updated_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (profile_id, key_type, key_id)
  DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
`;

const SELECT_ONE = `
  SELECT value FROM baileys_auth_state
  WHERE profile_id = $1 AND key_type = $2 AND key_id = $3
`;

const SELECT_MANY = `
  SELECT key_id, value FROM baileys_auth_state
  WHERE profile_id = $1 AND key_type = $2 AND key_id = ANY($3)
`;

const DELETE_ONE = `
  DELETE FROM baileys_auth_state
  WHERE profile_id = $1 AND key_type = $2 AND key_id = $3
`;

// ─── Validation ─────────────────────────────────────────────────────────

/** Required top-level fields that indicate a valid Baileys credential record. */
const REQUIRED_CREDS_FIELDS = ['noiseKey', 'signedIdentityKey', 'registrationId', 'advSecretKey'];

export interface AuthStateValidationResult {
  healthy: boolean;
  credentialsPresent: boolean;
  credentialsValid: boolean;
  signalKeyCount: number;
  corruptedKeys: string[];
  clearedRows: number;
}

/**
 * Validate the stored DB auth state for a given instanceId.
 *
 * - Checks that `creds` row is present and JSON-parseable.
 * - Verifies required Baileys credential fields.
 * - Checks all signal key rows for JSON parse errors.
 * - If corrupted rows are found and `dryRun` is false, deletes them and returns clearedRows > 0.
 * - If `dryRun` is true, reports corruption without deleting anything.
 */
export async function validateAuthState(instanceId: string, dryRun = false): Promise<AuthStateValidationResult> {
  // Ensure table exists first
  await pool.query(ENSURE_TABLE);

  const SELECT_ALL = `SELECT key_type, key_id, value FROM baileys_auth_state WHERE profile_id = $1`;
  const DELETE_ALL = `DELETE FROM baileys_auth_state WHERE profile_id = $1`;

  const rows = await pool.query(SELECT_ALL, [instanceId]);

  if (rows.rows.length === 0) {
    // No rows — fresh state, healthy (will init on first connect)
    console.info(`[DbAuth:${instanceId}] Auth state healthy: no rows (fresh instance)`);
    return { healthy: true, credentialsPresent: false, credentialsValid: false, signalKeyCount: 0, corruptedKeys: [], clearedRows: 0 };
  }

  const corruptedKeys: string[] = [];
  let credentialsPresent = false;
  let credentialsValid = false;
  let signalKeyCount = 0;

  for (const row of rows.rows) {
    const label = `${row.key_type}:${row.key_id}`;
    let parsed: unknown;

    try {
      parsed = JSON.parse(row.value);
    } catch {
      corruptedKeys.push(label);
      continue;
    }

    if (row.key_type === 'creds' && row.key_id === 'creds') {
      credentialsPresent = true;
      const obj = parsed as Record<string, unknown>;
      const missingFields = REQUIRED_CREDS_FIELDS.filter(f => !(f in obj));
      if (missingFields.length > 0) {
        corruptedKeys.push(`${label} (missing: ${missingFields.join(', ')})`);
      } else {
        credentialsValid = true;
      }
    } else {
      signalKeyCount++;
    }
  }

  if (corruptedKeys.length > 0) {
    if (!dryRun) {
      // Delete all rows for this instance — corrupted session needs full re-pair
      await pool.query(DELETE_ALL, [instanceId]);
      const clearedRows = rows.rows.length;
      console.warn(`[DbAuth:${instanceId}] Auth state corrupted — cleared ${clearedRows} rows. Corrupted: ${corruptedKeys.join(', ')}`);
      return { healthy: false, credentialsPresent, credentialsValid, signalKeyCount, corruptedKeys, clearedRows };
    } else {
      console.warn(`[DbAuth:${instanceId}] Auth state corrupted (dry-run, not cleared). Corrupted: ${corruptedKeys.join(', ')}`);
      return { healthy: false, credentialsPresent, credentialsValid, signalKeyCount, corruptedKeys, clearedRows: 0 };
    }
  }

  console.info(`[DbAuth:${instanceId}] Auth state healthy: creds OK, ${signalKeyCount} signal keys`);
  return { healthy: true, credentialsPresent, credentialsValid, signalKeyCount, corruptedKeys: [], clearedRows: 0 };
}

// ─── Main ───────────────────────────────────────────────────────────────

/**
 * Creates a DB-backed Baileys auth state for a given WhatsApp profile.
 *
 * - Credentials are read/written with immediate upserts.
 * - Signal keys are batched: accumulated for 100 ms and written in a single transaction.
 * - On crash recovery, restores from DB without requiring QR re-scan.
 */
export async function useDbAuthState(profileId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Ensure the table exists (idempotent)
  await pool.query(ENSURE_TABLE);

  // ─── Load or init credentials ───────────────────────────────────────

  const credsRow = await pool.query(SELECT_ONE, [profileId, 'creds', 'creds']);
  let creds: AuthenticationCreds;

  if (credsRow.rows.length > 0) {
    creds = deserialize<AuthenticationCreds>(credsRow.rows[0].value);
    console.log(`[DbAuthState:${profileId}] Loaded credentials from database`);
  } else {
    creds = initAuthCreds();
    console.log(`[DbAuthState:${profileId}] Initialized fresh credentials`);
  }

  // ─── saveCreds — persist credentials immediately ────────────────────

  const saveCreds = async (): Promise<void> => {
    await pool.query(UPSERT, [profileId, 'creds', 'creds', serialize(creds)]);
  };

  // ─── Batched key writer (100 ms coalescing) ─────────────────────────

  let pendingOps: Array<{ type: string; id: string; value: unknown | null }> = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPendingKeys = async (): Promise<void> => {
    batchTimer = null;
    if (pendingOps.length === 0) return;

    const ops = pendingOps;
    pendingOps = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const op of ops) {
        if (op.value != null) {
          await client.query(UPSERT, [profileId, op.type, op.id, serialize(op.value)]);
        } else {
          await client.query(DELETE_ONE, [profileId, op.type, op.id]);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[DbAuthState:${profileId}] Batch write failed (${ops.length} ops):`, (err as Error).message);
    } finally {
      client.release();
    }
  };

  const scheduleBatch = (): void => {
    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        flushPendingKeys().catch(err => {
          console.error(`[DbAuthState:${profileId}] Flush error:`, err.message);
        });
      }, 100);
    }
  };

  // ─── SignalKeyStore implementation ──────────────────────────────────

  const keys = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};

      if (ids.length === 0) return data;

      const result = await pool.query(SELECT_MANY, [profileId, type, ids]);

      for (const row of result.rows) {
        let value = deserialize<SignalDataTypeMap[T]>(row.value);
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as any) as any;
        }
        data[row.key_id] = value;
      }

      return data;
    },

    set: async (data: SignalDataSet): Promise<void> => {
      for (const category in data) {
        const categoryData = data[category as keyof SignalDataSet];
        if (!categoryData) continue;
        for (const id in categoryData) {
          const value = categoryData[id];
          pendingOps.push({ type: category, id, value: value ?? null });
        }
      }
      scheduleBatch();
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
  };
}

/**
 * Delete all auth state rows for a given instance.
 * Called after a loggedOut disconnect so the next start() generates a fresh QR.
 */
export async function clearAuthState(instanceId: string): Promise<void> {
  await pool.query('DELETE FROM baileys_auth_state WHERE profile_id = $1', [instanceId]);
  console.log(`[DbAuth:${instanceId}] Auth state cleared — ready for QR re-pair`);
}
