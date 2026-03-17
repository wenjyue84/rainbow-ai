/**
 * Unit tests for US-025: PDPA Cross-Border Transfer Impact Assessment Report Endpoint
 *
 * Tests:
 *  1. resolveProviderJurisdiction — Ollama/localhost returns MY adequate
 *  2. resolveProviderJurisdiction — NVIDIA NIM returns US, no adequacy, warning=true
 *  3. resolveProviderJurisdiction — Groq returns US, no adequacy, requires_scc=true
 *  4. resolveProviderJurisdiction — OpenRouter returns US, no adequacy, warning=true
 *  5. resolveProviderJurisdiction — Google Gemini returns US, no adequacy
 *  6. resolveProviderJurisdiction — Moonshot AI returns CN, no adequacy, warning=true
 *  7. resolveProviderJurisdiction — unknown URL returns XX, warning=true
 *  8. buildTransferImpactReport — only enabled providers appear in report
 *  9. buildTransferImpactReport — each entry has last_reviewed and next_review_due
 * 10. buildTransferImpactReport — each entry includes personal_data_categories_transmitted
 * 11. buildTransferImpactReport — each entry includes legal_basis_for_transfer
 * 12. buildTransferImpactReport — summary counts local vs cross-border providers
 * 13. buildTransferImpactReport — summary.providers_with_warnings counts flagged providers
 * 14. buildTransferImpactReport — overall_status is action_required when warnings exist
 * 15. buildTransferImpactReport — overall_status is compliant when all providers are MY
 * 16. buildTransferImpactReport — US providers have warning indicator in report
 * 17. buildTransferImpactReport — providers_with_warnings = 0 for all-local config
 * 18. buildTransferImpactReport — report includes recommendations array
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
}));

vi.mock('../assistant/config-store.js', () => ({
  configStore: { getSettings: mockGetSettings },
}));

vi.mock('../lib/security-event-log.js', () => ({
  logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/pii-encryption.js', () => ({
  isPiiEncryptionEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('../lib/rbac.js', () => ({
  checkRole: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  resolveProviderJurisdiction,
  buildTransferImpactReport,
} from '../routes/admin/pdpa-security.js';


// ─── Provider fixture factory ─────────────────────────────────────────────────

function makeProvider(overrides: {
  id?: string; name?: string; type?: string;
  base_url?: string; model?: string; enabled?: boolean; priority?: number;
}) {
  return {
    id: overrides.id ?? 'test-provider',
    name: overrides.name ?? 'Test Provider',
    type: overrides.type ?? 'openai-compatible',
    base_url: overrides.base_url ?? 'https://example.com/v1',
    model: overrides.model ?? 'test-model',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 0,
  };
}

function setupSettings(providers: ReturnType<typeof makeProvider>[]) {
  mockGetSettings.mockReturnValue({ ai: { providers } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('US-025: PDPA Transfer Impact Assessment Report', () => {

  describe('resolveProviderJurisdiction', () => {
    it('Ollama type returns MY, adequate, no warning', () => {
      const result = resolveProviderJurisdiction('http://localhost:11434/v1', 'ollama');
      expect(result.jurisdiction).toBe('MY');
      expect(result.pdpa_adequacy).toBe('adequate');
      expect(result.warning).toBe(false);
      expect(result.requires_scc).toBe(false);
    });

    it('NVIDIA NIM base_url returns US, no_adequacy_decision, warning=true', () => {
      const result = resolveProviderJurisdiction('https://integrate.api.nvidia.com/v1', 'openai-compatible');
      expect(result.jurisdiction).toBe('US');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.warning).toBe(true);
      expect(result.requires_scc).toBe(true);
    });

    it('Groq base_url returns US, no_adequacy_decision, requires_scc=true', () => {
      const result = resolveProviderJurisdiction('https://api.groq.com/openai/v1', 'groq');
      expect(result.jurisdiction).toBe('US');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.requires_scc).toBe(true);
      expect(result.warning).toBe(true);
    });

    it('OpenRouter base_url returns US, no_adequacy_decision, warning=true', () => {
      const result = resolveProviderJurisdiction('https://openrouter.ai/api/v1', 'openai-compatible');
      expect(result.jurisdiction).toBe('US');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.warning).toBe(true);
    });

    it('Google Gemini base_url returns US, no_adequacy_decision', () => {
      const result = resolveProviderJurisdiction('https://generativelanguage.googleapis.com/v1beta', 'google-gemini');
      expect(result.jurisdiction).toBe('US');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.warning).toBe(true);
    });

    it('Moonshot AI base_url returns CN, no_adequacy_decision, warning=true', () => {
      const result = resolveProviderJurisdiction('https://api.moonshot.ai/v1', 'openai-compatible');
      expect(result.jurisdiction).toBe('CN');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.warning).toBe(true);
      expect(result.requires_scc).toBe(true);
    });

    it('Unknown URL returns XX, no_adequacy_decision, warning=true', () => {
      const result = resolveProviderJurisdiction('https://some-unknown-provider.example.com/api', 'openai-compatible');
      expect(result.jurisdiction).toBe('XX');
      expect(result.pdpa_adequacy).toBe('no_adequacy_decision');
      expect(result.warning).toBe(true);
    });
  });

  describe('buildTransferImpactReport', () => {
    beforeEach(() => {
      setupSettings([
        makeProvider({ id: 'nvidia', name: 'NVIDIA NIM', type: 'openai-compatible', base_url: 'https://integrate.api.nvidia.com/v1', enabled: true }),
        makeProvider({ id: 'groq', name: 'Groq Llama', type: 'groq', base_url: 'https://api.groq.com/openai/v1', enabled: true }),
        makeProvider({ id: 'ollama', name: 'Local Ollama', type: 'ollama', base_url: 'http://localhost:11434/v1', enabled: true }),
        makeProvider({ id: 'disabled', name: 'Disabled Provider', type: 'groq', base_url: 'https://api.groq.com/openai/v1', enabled: false }),
      ]);
    });

    it('only enabled providers appear in the report', () => {
      const report = buildTransferImpactReport();
      expect(report.providers).toHaveLength(3); // 3 enabled, 1 disabled
      expect(report.providers.map(p => p.provider_id)).not.toContain('disabled');
    });

    it('each entry has last_reviewed and next_review_due fields', () => {
      const report = buildTransferImpactReport();
      for (const p of report.providers) {
        expect(p.last_reviewed).toBeTruthy();
        expect(p.next_review_due).toBeTruthy();
        // 12-month cycle
        const reviewed = new Date(p.last_reviewed);
        const nextDue = new Date(p.next_review_due);
        const monthsDiff = (nextDue.getFullYear() - reviewed.getFullYear()) * 12
          + nextDue.getMonth() - reviewed.getMonth();
        expect(monthsDiff).toBe(12);
      }
    });

    it('each entry includes personal_data_categories_transmitted', () => {
      const report = buildTransferImpactReport();
      for (const p of report.providers) {
        expect(Array.isArray(p.personal_data_categories_transmitted)).toBe(true);
        expect(p.personal_data_categories_transmitted.length).toBeGreaterThan(0);
        // Must include conversation context
        expect(p.personal_data_categories_transmitted.some((c: string) => c.includes('conversation'))).toBe(true);
      }
    });

    it('each entry includes legal_basis_for_transfer', () => {
      const report = buildTransferImpactReport();
      for (const p of report.providers) {
        expect(typeof p.legal_basis_for_transfer).toBe('string');
        expect(p.legal_basis_for_transfer.length).toBeGreaterThan(10);
      }
    });

    it('summary counts local vs cross-border providers correctly', () => {
      const report = buildTransferImpactReport();
      expect(report.summary.total_enabled_providers).toBe(3);
      expect(report.summary.local_providers).toBe(1);   // ollama is MY
      expect(report.summary.cross_border_providers).toBe(2); // nvidia + groq are US
    });

    it('summary.providers_with_warnings counts non-adequate providers', () => {
      const report = buildTransferImpactReport();
      expect(report.summary.providers_with_warnings).toBe(2); // nvidia + groq
    });

    it('overall_status is action_required when US/non-adequate providers exist', () => {
      const report = buildTransferImpactReport();
      expect(report.summary.overall_status).toBe('action_required');
    });

    it('overall_status is compliant when all providers are local/MY', () => {
      setupSettings([
        makeProvider({ id: 'ollama1', name: 'Local Ollama 1', type: 'ollama', base_url: 'http://localhost:11434/v1', enabled: true }),
        makeProvider({ id: 'ollama2', name: 'Local Ollama 2', type: 'ollama', base_url: 'http://127.0.0.1:11434/v1', enabled: true }),
      ]);
      const report = buildTransferImpactReport();
      expect(report.summary.overall_status).toBe('compliant');
    });

    it('US providers have warning=true in their report entries', () => {
      const report = buildTransferImpactReport();
      const usProviders = report.providers.filter(p => p.data_centre_jurisdiction === 'US');
      expect(usProviders.length).toBeGreaterThan(0);
      for (const p of usProviders) {
        expect(p.warning).toBe(true);
        expect(p.pdpa_adequacy_status).toBe('no_adequacy_decision');
      }
    });

    it('providers_with_warnings is 0 for all-local config', () => {
      setupSettings([
        makeProvider({ id: 'local', name: 'Local', type: 'ollama', base_url: 'http://localhost:11434/v1', enabled: true }),
      ]);
      const report = buildTransferImpactReport();
      expect(report.summary.providers_with_warnings).toBe(0);
    });

    it('report includes recommendations array', () => {
      const report = buildTransferImpactReport();
      expect(Array.isArray(report.recommendations)).toBe(true);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });
});
