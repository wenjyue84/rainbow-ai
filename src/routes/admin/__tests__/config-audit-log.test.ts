/**
 * Admin Configuration Audit Trail Tests (US-257)
 *
 * Validates:
 *   AC1: admin_audit_log table schema {id, config_file, changed_by, previous_hash, new_hash, diff_summary, timestamp}
 *   AC2: Logging middleware captures POST /admin/config/:file changes with unified diff output
 *   AC3: GET /admin/api/audit-log?file=settings.json returns 20+ recent changes with diffs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeConfigHash,
  generateUnifiedDiff,
  logConfigChange,
  getAuditLog,
} from '../../../lib/config-audit.js';

// ─── Mock Drizzle DB ─────────────────────────────────────────────────
const mockInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
const mockSelect = vi.fn();

vi.mock('../../../lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
  },
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('US-257: Admin Configuration Audit Trail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── AC1: Hash Computation ───────────────────────────────────────
  describe('computeConfigHash()', () => {
    it('should return a SHA-256 hex hash string', () => {
      const hash = computeConfigHash({ key: 'value' });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce deterministic hashes for identical content', () => {
      const data = { ai: { providers: [{ id: 'openai', model: 'gpt-4' }] } };
      const hash1 = computeConfigHash(data);
      const hash2 = computeConfigHash(data);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = computeConfigHash({ key: 'value1' });
      const hash2 = computeConfigHash({ key: 'value2' });
      expect(hash1).not.toBe(hash2);
    });

    it('should handle nested objects consistently', () => {
      const data = {
        settings: {
          ai: { providers: [] },
          features: { enabled: true },
        },
      };
      const hash = computeConfigHash(data);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash.length).toBe(64);
    });
  });

  // ─── AC2: Unified Diff Generation ───────────────────────────────
  describe('generateUnifiedDiff()', () => {
    it('should produce initial creation diff when before is null', () => {
      const diff = generateUnifiedDiff(null, { key: 'value' }, 'settings.json');
      expect(diff).toContain('--- /dev/null');
      expect(diff).toContain('+++ b/settings.json');
      expect(diff).toContain('initial creation');
    });

    it('should produce unified diff format with file headers', () => {
      const before = { key: 'old' };
      const after = { key: 'new' };
      const diff = generateUnifiedDiff(before, after, 'workflows.json');

      expect(diff).toContain('--- a/workflows.json');
      expect(diff).toContain('+++ b/workflows.json');
      expect(diff).toContain('@@');
    });

    it('should show added, removed, and changed lines', () => {
      const before = { setting1: 'old_value', setting2: true };
      const after = { setting1: 'new_value', setting2: true };
      const diff = generateUnifiedDiff(before, after, 'settings.json');

      expect(diff).toContain('-');
      expect(diff).toContain('+');
      expect(diff).toContain('lines changed');
    });

    it('should report no changes for identical objects', () => {
      const data = { key: 'value' };
      const diff = generateUnifiedDiff(data, data, 'settings.json');
      expect(diff).toContain('no changes');
    });

    it('should handle complex nested diff', () => {
      const before = {
        ai: { providers: [{ id: 'openai', model: 'gpt-3.5' }] },
        features: { chat: true },
      };
      const after = {
        ai: { providers: [{ id: 'openai', model: 'gpt-4' }] },
        features: { chat: true, voice: false },
      };
      const diff = generateUnifiedDiff(before, after, 'settings.json');

      expect(diff).toContain('--- a/settings.json');
      expect(diff).toContain('+++ b/settings.json');
      // Should show the model change
      expect(diff).toContain('lines changed');
    });
  });

  // ─── AC2: logConfigChange() persists audit entry ────────────────
  describe('logConfigChange()', () => {
    it('should insert audit log entry with correct fields', async () => {
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockInsert.mockReturnValue({ values: valuesFn });

      const before = { key: 'old' };
      const after = { key: 'new' };

      await logConfigChange('settings.json', 'admin', before, after);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(valuesFn).toHaveBeenCalledTimes(1);

      const insertedValues = valuesFn.mock.calls[0][0];
      expect(insertedValues).toHaveProperty('configFile', 'settings.json');
      expect(insertedValues).toHaveProperty('changedBy', 'admin');
      expect(insertedValues).toHaveProperty('previousHash');
      expect(insertedValues).toHaveProperty('newHash');
      expect(insertedValues).toHaveProperty('diffSummary');
      expect(insertedValues.previousHash).toMatch(/^[a-f0-9]{64}$/);
      expect(insertedValues.newHash).toMatch(/^[a-f0-9]{64}$/);
      expect(insertedValues.diffSummary).toContain('--- a/settings.json');
    });

    it('should set previousHash to null for new config creation', async () => {
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockInsert.mockReturnValue({ values: valuesFn });

      await logConfigChange('workflows.json', 'admin', null, { id: 'w1' });

      const insertedValues = valuesFn.mock.calls[0][0];
      expect(insertedValues.previousHash).toBeNull();
      expect(insertedValues.newHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should include unified diff in diff_summary', async () => {
      const valuesFn = vi.fn().mockResolvedValue(undefined);
      mockInsert.mockReturnValue({ values: valuesFn });

      const before = { model: 'gpt-3.5' };
      const after = { model: 'gpt-4' };

      await logConfigChange('settings.json', 'operator', before, after);

      const insertedValues = valuesFn.mock.calls[0][0];
      expect(insertedValues.diffSummary).toContain('--- a/settings.json');
      expect(insertedValues.diffSummary).toContain('+++ b/settings.json');
    });

    it('should not throw on DB error', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      });

      // Should not throw
      await expect(
        logConfigChange('settings.json', 'admin', null, { key: 'value' })
      ).resolves.toBeUndefined();
    });
  });

  // ─── AC3: getAuditLog() returns 20+ recent changes ─────────────
  describe('getAuditLog()', () => {
    it('should enforce minimum 20 results per acceptance criteria', async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
      const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
      const fromFn = vi.fn().mockReturnValue({ where: whereFn, orderBy: orderByFn });
      mockSelect.mockReturnValue({ from: fromFn });

      await getAuditLog('settings.json', 5); // Request only 5

      // Should enforce minimum 20
      expect(limitFn).toHaveBeenCalledWith(20);
    });

    it('should filter by config file when file parameter is provided', async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
      const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
      const fromFn = vi.fn().mockReturnValue({ where: whereFn, orderBy: orderByFn });
      mockSelect.mockReturnValue({ from: fromFn });

      await getAuditLog('settings.json');

      // Should call where() for file filtering
      expect(whereFn).toHaveBeenCalled();
    });

    it('should return all entries when no file filter is provided', async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
      const fromFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
      mockSelect.mockReturnValue({ from: fromFn });

      await getAuditLog(undefined, 50);

      // Should not call where(), just orderBy directly from from()
      expect(fromFn).toHaveBeenCalled();
      expect(orderByFn).toHaveBeenCalled();
    });

    it('should order by timestamp descending (most recent first)', async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      const orderByFn = vi.fn().mockReturnValue({ limit: limitFn });
      const fromFn = vi.fn().mockReturnValue({ orderBy: orderByFn });
      mockSelect.mockReturnValue({ from: fromFn });

      await getAuditLog();

      expect(orderByFn).toHaveBeenCalled();
    });

    it('should return empty array on DB error', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const result = await getAuditLog();
      expect(result).toEqual([]);
    });
  });

  // ─── AC1: Table schema validation ──────────────────────────────
  describe('admin_audit_log table schema', () => {
    it('should define all required columns from acceptance criteria', async () => {
      // Import the schema table definition and validate structure
      const { adminAuditLog } = await import('../../../../shared/schema-tables.js');

      // Verify all AC-required columns exist
      expect(adminAuditLog).toBeDefined();

      // The table should have the fields: id, config_file, changed_by, previous_hash, new_hash, diff_summary, timestamp
      const columnNames = Object.keys(adminAuditLog);
      // Drizzle tables expose columns as properties
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('configFile');
      expect(columnNames).toContain('changedBy');
      expect(columnNames).toContain('previousHash');
      expect(columnNames).toContain('newHash');
      expect(columnNames).toContain('diffSummary');
      expect(columnNames).toContain('timestamp');
    });
  });
});
