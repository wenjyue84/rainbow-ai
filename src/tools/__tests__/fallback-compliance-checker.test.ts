/**
 * Tests for US-461: Fallback Response Compliance Checker
 */
import { describe, it, expect } from 'vitest';
import {
  loadBusinessRules,
  checkCompliance,
  type BusinessRulesConfig,
  type KnowledgeEntry,
} from '../fallback-compliance-checker.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const testConfig: BusinessRulesConfig = {
  profiles: {
    pelangi: {
      rules: [
        {
          rule_id: 'contact_info_required',
          applies_to: ['billing_dispute', 'escalation_fallback'],
          check: 'must_contain_contact',
          severity: 'critical',
          description: 'Must contain contact info',
        },
        {
          rule_id: 'no_unauthorized_discounts',
          applies_to: ['pricing', 'payment'],
          check: 'no_discount_promise',
          severity: 'critical',
          description: 'No discount promises',
        },
        {
          rule_id: 'appropriate_tone',
          applies_to: ['all'],
          check: 'appropriate_tone',
          severity: 'warning',
          description: 'Professional tone required',
        },
        {
          rule_id: 'no_competitor_mention',
          applies_to: ['all'],
          check: 'no_competitor',
          severity: 'critical',
          description: 'No competitor mentions',
        },
      ],
    },
  },
  checks: {
    must_contain_contact: {
      description: 'Must contain phone/email/contact directive',
      patterns: [
        '\\+?6?01[0-9]{8,9}',
        '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
        'contact us',
        'whatsapp',
        'call us',
        'our team',
      ],
      suggested_fix: 'Add contact information such as phone number or email.',
    },
    no_discount_promise: {
      description: 'No discount promises',
      forbidden_patterns: [
        'special discount',
        'exclusive discount',
        'give you discount',
        'better price',
      ],
      suggested_fix: 'Remove discount promises and reference official pricing.',
    },
    appropriate_tone: {
      description: 'Professional tone',
      forbidden_patterns: [
        'cannot help you',
        'not our problem',
        'go away',
        'deal with it',
      ],
      suggested_fix: 'Replace dismissive language with helpful alternatives.',
    },
    no_competitor: {
      description: 'No competitor mentions',
      forbidden_patterns: ['airbnb', 'booking.com', 'agoda', 'expedia'],
      suggested_fix: 'Remove competitor mentions and direct to own booking channels.',
    },
  },
};

// ---------------------------------------------------------------------------
// loadBusinessRules
// ---------------------------------------------------------------------------

describe('loadBusinessRules', () => {
  it('loads the real business-rules.json without error', () => {
    const config = loadBusinessRules();
    expect(config).toBeDefined();
    expect(config.profiles).toBeDefined();
    expect(config.checks).toBeDefined();
  });

  it('has pelangi and southern profiles', () => {
    const config = loadBusinessRules();
    expect(config.profiles).toHaveProperty('pelangi');
    expect(config.profiles).toHaveProperty('southern');
  });

  it('each profile has rules with required fields', () => {
    const config = loadBusinessRules();
    for (const [, profile] of Object.entries(config.profiles)) {
      expect(profile.rules.length).toBeGreaterThan(0);
      for (const rule of profile.rules) {
        expect(rule).toHaveProperty('rule_id');
        expect(rule).toHaveProperty('applies_to');
        expect(rule).toHaveProperty('check');
        expect(rule).toHaveProperty('severity');
        expect(['critical', 'warning']).toContain(rule.severity);
      }
    }
  });

  it('each rule references an existing check definition', () => {
    const config = loadBusinessRules();
    for (const [, profile] of Object.entries(config.profiles)) {
      for (const rule of profile.rules) {
        expect(config.checks).toHaveProperty(rule.check);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// checkCompliance — clean entries (no violations)
// ---------------------------------------------------------------------------

describe('checkCompliance - clean entries', () => {
  it('passes when billing response contains contact info', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'billing_dispute',
        response: {
          en: 'Please contact us via WhatsApp for billing help.',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.passed).toBe(true);
    expect(report.total_violations).toBe(0);
  });

  it('passes when pricing response has no discount language', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'pricing',
        response: {
          en: 'Our standard rate is RM50 per night. Please check our website for current pricing.',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.passed).toBe(true);
  });

  it('returns correct total_responses_checked count', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'greeting',
        response: { en: 'Hello!', ms: 'Hai!' },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.total_responses_checked).toBe(2);
  });

  it('returns empty report for unknown profile', () => {
    const entries: KnowledgeEntry[] = [
      { intent: 'test', response: { en: 'Test response' } },
    ];
    const report = checkCompliance('nonexistent', entries, testConfig);
    expect(report.passed).toBe(true);
    expect(report.total_responses_checked).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkCompliance — violations
// ---------------------------------------------------------------------------

describe('checkCompliance - violations', () => {
  it('detects missing contact info in billing response', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'billing_dispute',
        response: {
          en: 'We apologize for the inconvenience. We will look into this.',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.passed).toBe(false);
    expect(report.critical_violations).toBeGreaterThan(0);
    const contactViolation = report.violations.find(
      (v) => v.failed_rule === 'contact_info_required',
    );
    expect(contactViolation).toBeDefined();
    expect(contactViolation!.severity).toBe('critical');
    expect(contactViolation!.response_id).toBe('billing_dispute:en');
  });

  it('detects unauthorized discount promises', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'pricing',
        response: {
          en: 'We can give you a special discount if you book directly!',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.passed).toBe(false);
    const discountViolation = report.violations.find(
      (v) => v.failed_rule === 'no_unauthorized_discounts',
    );
    expect(discountViolation).toBeDefined();
  });

  it('detects inappropriate tone', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'greeting',
        response: {
          en: 'We cannot help you with that. Deal with it yourself.',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.warning_violations).toBeGreaterThan(0);
    const toneViolation = report.violations.find(
      (v) => v.failed_rule === 'appropriate_tone',
    );
    expect(toneViolation).toBeDefined();
    expect(toneViolation!.severity).toBe('warning');
  });

  it('detects competitor mentions', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'booking',
        response: {
          en: 'You can also find us on Airbnb and Booking.com for convenience.',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report.passed).toBe(false);
    const competitorViolation = report.violations.find(
      (v) => v.failed_rule === 'no_competitor_mention',
    );
    expect(competitorViolation).toBeDefined();
    expect(competitorViolation!.severity).toBe('critical');
  });

  it('violation includes suggested_fix', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'escalation_fallback',
        response: { en: 'Sorry, nothing we can do.' },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    for (const v of report.violations) {
      expect(v.suggested_fix).toBeTruthy();
      expect(v.suggested_fix.length).toBeGreaterThan(10);
    }
  });

  it('truncates long response_text to 120 chars', () => {
    const longText = 'A'.repeat(200) + ' cannot help you';
    const entries: KnowledgeEntry[] = [
      { intent: 'faq', response: { en: longText } },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    const violation = report.violations.find(
      (v) => v.failed_rule === 'appropriate_tone',
    );
    expect(violation).toBeDefined();
    expect(violation!.response_text.length).toBeLessThanOrEqual(123); // 120 + '...'
  });
});

// ---------------------------------------------------------------------------
// checkCompliance — severity filtering
// ---------------------------------------------------------------------------

describe('checkCompliance - severity filtering', () => {
  const mixedEntries: KnowledgeEntry[] = [
    {
      intent: 'billing_dispute',
      response: { en: 'Go away, not our problem. Check Airbnb instead.' },
    },
  ];

  it('filters to critical-only violations', () => {
    const report = checkCompliance('pelangi', mixedEntries, testConfig, 'critical');
    expect(report.violations.length).toBeGreaterThan(0);
    for (const v of report.violations) {
      expect(v.severity).toBe('critical');
    }
  });

  it('filters to warning-only violations', () => {
    const report = checkCompliance('pelangi', mixedEntries, testConfig, 'warning');
    for (const v of report.violations) {
      expect(v.severity).toBe('warning');
    }
  });

  it('critical filter still marks passed=false when critical violations exist', () => {
    const report = checkCompliance('pelangi', mixedEntries, testConfig, 'critical');
    expect(report.passed).toBe(false);
  });

  it('warning filter marks passed=true (no critical violations counted)', () => {
    const report = checkCompliance('pelangi', mixedEntries, testConfig, 'warning');
    expect(report.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkCompliance — multi-language
// ---------------------------------------------------------------------------

describe('checkCompliance - multi-language', () => {
  it('checks all language variants', () => {
    const entries: KnowledgeEntry[] = [
      {
        intent: 'billing_dispute',
        response: {
          en: 'Sorry for the issue.',
          ms: 'Maaf atas masalah ini.',
          zh: '???????????',
        },
      },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    // All 3 languages should fail contact_info_required
    const contactViolations = report.violations.filter(
      (v) => v.failed_rule === 'contact_info_required',
    );
    expect(contactViolations.length).toBe(3);
    const langs = contactViolations.map((v) => v.language);
    expect(langs).toContain('en');
    expect(langs).toContain('ms');
    expect(langs).toContain('zh');
  });
});

// ---------------------------------------------------------------------------
// Report structure
// ---------------------------------------------------------------------------

describe('ComplianceReport structure', () => {
  it('has all required fields', () => {
    const entries: KnowledgeEntry[] = [
      { intent: 'greeting', response: { en: 'Hello!' } },
    ];
    const report = checkCompliance('pelangi', entries, testConfig);
    expect(report).toHaveProperty('profile');
    expect(report).toHaveProperty('total_responses_checked');
    expect(report).toHaveProperty('total_violations');
    expect(report).toHaveProperty('critical_violations');
    expect(report).toHaveProperty('warning_violations');
    expect(report).toHaveProperty('violations');
    expect(report).toHaveProperty('passed');
    expect(report.profile).toBe('pelangi');
  });
});
