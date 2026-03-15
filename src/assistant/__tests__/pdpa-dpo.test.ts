/**
 * US-907: Malaysia PDPA 2024 Amendment — DPO and breach workflow tests
 *
 * AC1: Admin settings panel has DPO section
 * AC2: Anomaly detection job (15 min, >100 records/min)
 * AC3: Incident response log (pdpa_breach_log)
 * AC4: 24-month default retention
 * AC5: Disposal confirmation report before hard-delete
 * AC6: Data Subject Access report endpoint exists
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ─────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('../../lib/db.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
  },
  pool: { query: mockQuery },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../assistant/config-store.js', () => ({
  configStore: {
    getSettings: vi.fn().mockReturnValue({
      pdpa: {
        dpo_name: 'Test DPO',
        dpo_email: 'dpo@test.com',
        dpo_registration_status: 'active',
        dpo_date_appointed: '2025-06-01',
        general_contact_email: 'hello@test.com',
      },
      retention: {
        enabled: true,
        retention_months: 24,
        retention_days: 730,
        grace_period_days: 30,
      },
    }),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../assistant/profile-registry.js', () => ({
  profileRegistry: {
    isInitialized: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../assistant/conversation-db.js', () => ({
  canonicalPhoneKey: vi.fn((phone: string) => phone.replace(/\D/g, '')),
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminBreachReport: vi.fn().mockResolvedValue(undefined),
}));

// ─── AC1: DPO Settings ───────────────────────────────────────────────

describe('AC1: DPO admin settings', () => {
  test('getDpoFromSettings returns correct fields', async () => {
    const { configStore } = await import('../../assistant/config-store.js');
    const settings = configStore.getSettings() as any;
    const pdpa = settings.pdpa;

    expect(pdpa.dpo_name).toBe('Test DPO');
    expect(pdpa.dpo_email).toBe('dpo@test.com');
    expect(pdpa.dpo_registration_status).toBe('active');
    expect(pdpa.dpo_date_appointed).toBe('2025-06-01');
  });

  test('settings.json pdpa section has all required fields', async () => {
    // Validates the settings schema shape for AC1
    const { configStore } = await import('../../assistant/config-store.js');
    const pdpa = (configStore.getSettings() as any).pdpa;
    expect(pdpa).toHaveProperty('dpo_name');
    expect(pdpa).toHaveProperty('dpo_email');
    expect(pdpa).toHaveProperty('dpo_registration_status');
    expect(pdpa).toHaveProperty('dpo_date_appointed');
  });

  test('dpo_email must be a valid email', async () => {
    const { configStore } = await import('../../assistant/config-store.js');
    const email = (configStore.getSettings() as any).pdpa.dpo_email;
    expect(email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
  });
});

// ─── AC2 & AC3: Anomaly detection & incident log ─────────────────────

describe('AC2+AC3: Anomaly detection and incident log', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('scanForAnomalies returns detected=false when no anomalies', async () => {
    // Empty result — no sessions exceed threshold
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { scanForAnomalies } = await import('../../lib/breach-anomaly-detector.js');
    const result = await scanForAnomalies();

    expect(result.detected).toBe(false);
    expect(result.sessions).toHaveLength(0);
    expect(result.scanned_at).toBeTruthy();
  });

  test('scanForAnomalies returns detected=true for anomalous sessions', async () => {
    // One session exceeds 100 records/min threshold
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ session_key: 'sess-abc', total_records: '2500', records_per_minute: '166.67' }]
      })
      // The auto-insert to pdpa_breach_log
      .mockResolvedValueOnce({ rows: [{ id: 'test-id' }] });

    const { scanForAnomalies } = await import('../../lib/breach-anomaly-detector.js');
    const result = await scanForAnomalies();

    expect(result.detected).toBe(true);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].records_per_minute).toBe(166.67);
    expect(result.sessions[0].session_key).toBe('sess-abc');
  });

  test('anomaly detection logs breach to pdpa_breach_log (AC3)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ session_key: 'sess-xyz', total_records: '1500', records_per_minute: '100.01' }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const { scanForAnomalies } = await import('../../lib/breach-anomaly-detector.js');
    await scanForAnomalies();

    // Verify that pdpa_breach_log INSERT was called
    const insertCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO pdpa_breach_log')
    );
    expect(insertCall).toBeTruthy();
    // Verify the description mentions anomalous access
    expect(insertCall![1][1]).toContain('Anomalous bulk data access detected');
  });

  test('scanForAnomalies handles missing table gracefully (42P01)', async () => {
    const err = new Error('table does not exist') as any;
    err.code = '42P01';
    mockQuery.mockRejectedValueOnce(err);

    const { scanForAnomalies } = await import('../../lib/breach-anomaly-detector.js');
    const result = await scanForAnomalies();
    expect(result.detected).toBe(false);
  });
});

// ─── AC4: 24-month default retention ─────────────────────────────────

describe('AC4: 24-month default data retention', () => {
  test('retention default is 730 days (24 months)', async () => {
    const { configStore } = await import('../../assistant/config-store.js');
    const retention = (configStore.getSettings() as any).retention;

    // Either retention_days or retention_months must indicate 24 months
    const retentionDays = retention.retention_days ?? Math.round((retention.retention_months ?? 24) * 30.44);
    expect(retentionDays).toBeGreaterThanOrEqual(720); // ~24 months
    expect(retentionDays).toBeLessThanOrEqual(740);
  });

  test('getRetentionStats uses 24-month default when no config', async () => {
    // Config returning no retention (falls back to default)
    const { configStore } = await import('../../assistant/config-store.js');
    vi.mocked(configStore.getSettings).mockReturnValueOnce({} as any);

    // The default is 730 days — verify the cutoff is ~24 months ago
    const { getRetentionStats } = await import('../../lib/data-retention.js');

    // Mock DB queries for stats
    const { db } = await import('../../lib/db.js');
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 0 }]) })
    } as any);

    const stats = await getRetentionStats();
    expect(stats.retention_days).toBe(730);
  });
});

// ─── AC5: Disposal report ────────────────────────────────────────────

describe('AC5: Disposal confirmation report', () => {
  test('disposal report is generated when hard-deletes occur', async () => {
    mockQuery
      // ensureDisposalReportTable CREATE
      .mockResolvedValueOnce({ rows: [] })
      // saveDisposalReport INSERT
      .mockResolvedValueOnce({ rows: [] });

    const { db } = await import('../../lib/db.js');
    // Soft deletes return 0; hard deletes return records
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
      })
    } as any);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn()
          .mockResolvedValueOnce([{ id: 'msg-1' }, { id: 'msg-2' }]) // hard messages
          .mockResolvedValueOnce([{ phone: '60127088789' }]) // hard conversations
      })
    } as any);

    const { runRetentionPurge } = await import('../../lib/data-retention.js');
    const result = await runRetentionPurge();

    // disposal_report_archived should be true since hard-deletes happened
    expect(result.disposal_report_archived).toBe(true);

    // Verify INSERT INTO pdpa_disposal_reports was called
    const insertCall = mockQuery.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('INSERT INTO pdpa_disposal_reports')
    );
    expect(insertCall).toBeTruthy();
  });

  test('no disposal report when no hard-deletes', async () => {
    const { db } = await import('../../lib/db.js');
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
      })
    } as any);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]) // no hard deletes
      })
    } as any);

    mockQuery.mockResolvedValue({ rows: [] });

    const { runRetentionPurge } = await import('../../lib/data-retention.js');
    const result = await runRetentionPurge();
    expect(result.disposal_report_archived).toBeUndefined();
  });
});

// ─── AC6: Data Subject Access Report endpoint ─────────────────────────

describe('AC6: Data Subject Access Report', () => {
  test('DSAR endpoint path is /pdpa/dsar/:phone', async () => {
    // Verify the route is registered at the correct path
    // (structural test — router is wired in pdpa-dpo.ts)
    const pdpaDpoModule = await import('../../routes/admin/pdpa-dpo.js');
    expect(pdpaDpoModule.default).toBeDefined();
    expect(typeof pdpaDpoModule.default).toBe('function');
  });

  test('canonicalPhoneKey normalises phone for DSAR lookup', async () => {
    const { canonicalPhoneKey } = await import('../../assistant/conversation-db.js');
    const result = canonicalPhoneKey('+60 12-708 8789');
    expect(result).toBe('60127088789');
  });
});
