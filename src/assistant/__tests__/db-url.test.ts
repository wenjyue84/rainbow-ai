import { describe, it, expect } from 'vitest';
import { resolveMigrationUrl, checkPoolerWarning } from '../../lib/db-url.js';

describe('resolveMigrationUrl', () => {
  it('prefers DATABASE_DIRECT_URL when both are set', () => {
    const result = resolveMigrationUrl({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb',
      DATABASE_DIRECT_URL: 'postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb',
    });
    expect(result.url).toBe('postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb');
    expect(result.warnings).toHaveLength(0);
  });

  it('uses DATABASE_DIRECT_URL alone when DATABASE_URL is absent', () => {
    const result = resolveMigrationUrl({
      DATABASE_DIRECT_URL: 'postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb',
    });
    expect(result.url).toBe('postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb');
    expect(result.warnings).toHaveLength(0);
  });

  it('falls back to DATABASE_URL with pooler warning when direct URL is missing', () => {
    const result = resolveMigrationUrl({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb',
    });
    expect(result.url).toBe('postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('pooled connection');
    expect(result.warnings[0]).toContain('DATABASE_DIRECT_URL');
  });

  it('falls back to DATABASE_URL with generic warning for non-pooler URLs', () => {
    const result = resolveMigrationUrl({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb',
    });
    expect(result.url).toBe('postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('falling back to DATABASE_URL');
  });

  it('detects pgbouncer in URL as a pooler connection', () => {
    const result = resolveMigrationUrl({
      DATABASE_URL: 'postgresql://user:pass@pgbouncer.example.com/neondb',
    });
    expect(result.warnings[0]).toContain('pooled connection');
  });

  it('throws when neither URL is set', () => {
    expect(() => resolveMigrationUrl({})).toThrow('DATABASE_URL or DATABASE_DIRECT_URL is required');
  });
});

describe('checkPoolerWarning', () => {
  it('returns null when DATABASE_URL is not set', () => {
    expect(checkPoolerWarning({})).toBeNull();
  });

  it('returns null when DATABASE_DIRECT_URL is set', () => {
    expect(checkPoolerWarning({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb',
      DATABASE_DIRECT_URL: 'postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb',
    })).toBeNull();
  });

  it('returns null for non-pooler DATABASE_URL without direct URL', () => {
    expect(checkPoolerWarning({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb',
    })).toBeNull();
  });

  it('returns warning for pooler DATABASE_URL without direct URL', () => {
    const warning = checkPoolerWarning({
      DATABASE_URL: 'postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb',
    });
    expect(warning).toContain('-pooler.');
    expect(warning).toContain('DATABASE_DIRECT_URL');
  });

  it('returns warning for pgbouncer DATABASE_URL without direct URL', () => {
    const warning = checkPoolerWarning({
      DATABASE_URL: 'postgresql://user:pass@pgbouncer.internal:6432/neondb',
    });
    expect(warning).not.toBeNull();
  });
});
