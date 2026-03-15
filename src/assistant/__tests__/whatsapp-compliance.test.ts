/**
 * Tests for US-942: WhatsApp 2026 Task-Specific Chatbot Policy Compliance
 *
 * Covers all 5 acceptance criteria:
 * AC1: System prompt scoped to defined business functions
 * AC2: Off-topic questions declined and redirected
 * AC3: Human escalation path reachable from any conversation flow
 * AC4: Bot identification includes business name and purpose
 * AC5: Compliance audit log records intent categories
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { classifyIntentCategory } from '../../lib/compliance-audit.js';

const PROJECT_ROOT = resolve(join(import.meta.dirname, '..', '..', '..'));

// ─── Load config files ──────────────────────────────────────────────

const routingJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'src', 'assistant', 'data', 'routing.json'), 'utf-8')
);

const knowledgeJson = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'src', 'assistant', 'data', 'knowledge.json'), 'utf-8')
);

// ─── AC1: System prompt scoped to business functions ────────────────

describe('AC1: System prompt scoped to defined business functions', () => {
  // Read the source file that builds the system prompt
  const kbInstanceSource = readFileSync(
    join(PROJECT_ROOT, 'src', 'assistant', 'knowledge-base-instance.ts'), 'utf-8'
  );

  test('system prompt contains TASK-SPECIFIC CHATBOT COMPLIANCE block', () => {
    expect(kbInstanceSource).toContain('WHATSAPP TASK-SPECIFIC CHATBOT COMPLIANCE');
  });

  test('system prompt lists allowed business functions', () => {
    expect(kbInstanceSource).toContain('ALLOWED BUSINESS FUNCTIONS');
    expect(kbInstanceSource).toContain('Hostel bookings, pricing, and availability');
    expect(kbInstanceSource).toContain('Check-in / check-out procedures');
    expect(kbInstanceSource).toContain('F&B ordering');
    expect(kbInstanceSource).toContain('Guest complaints, service requests');
  });

  test('system prompt declares bot is NOT general-purpose', () => {
    expect(kbInstanceSource).toContain('NOT a general-purpose AI chatbot');
    expect(kbInstanceSource).toContain('TASK-SPECIFIC assistant');
  });

  test('system prompt instructs off-topic classification', () => {
    expect(kbInstanceSource).toContain('classify the intent as "off_topic"');
  });

  test('system prompt forbids acting as general-purpose chatbot', () => {
    expect(kbInstanceSource).toContain('NEVER answer general knowledge questions');
    expect(kbInstanceSource).toContain('NEVER act as a general-purpose chatbot');
  });

  test('off-topic handling lists example categories', () => {
    expect(kbInstanceSource).toContain('general knowledge');
    expect(kbInstanceSource).toContain('coding help');
    expect(kbInstanceSource).toContain('medical advice');
  });
});

// ─── AC2: Off-topic detection and redirect ──────────────────────────

describe('AC2: Off-topic questions declined and redirected', () => {
  test('routing.json has off_topic intent', () => {
    expect(routingJson).toHaveProperty('off_topic');
  });

  test('off_topic routes to static_reply', () => {
    expect(routingJson.off_topic.action).toBe('static_reply');
  });

  test('knowledge.json has off_topic static response', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    expect(offTopicEntry).toBeDefined();
    expect(offTopicEntry.response.en).toBeTruthy();
    expect(offTopicEntry.response.ms).toBeTruthy();
    expect(offTopicEntry.response.zh).toBeTruthy();
  });

  test('off_topic response lists supported services', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    const en = offTopicEntry.response.en;
    expect(en).toContain('Bookings');
    expect(en).toContain('Check-in');
    expect(en).toContain('Facilities');
  });

  test('off_topic response redirects to hostel services', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    const en = offTopicEntry.response.en;
    expect(en).toMatch(/hostel.related/i);
  });
});

// ─── AC3: Human escalation path reachable ──────────────────────────

describe('AC3: Human escalation path reachable from any conversation', () => {
  test('routing.json has contact_staff intent with escalation workflow', () => {
    expect(routingJson).toHaveProperty('contact_staff');
    expect(routingJson.contact_staff.action).toBe('workflow');
    expect(routingJson.contact_staff.workflow_id).toBe('escalate');
  });

  test('off_topic response includes human escalation option', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    const en = offTopicEntry.response.en;
    expect(en).toMatch(/talk to staff/i);
  });

  test('off_topic response in Malay includes escalation option', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    const ms = offTopicEntry.response.ms;
    expect(ms).toMatch(/hubungi staf/i);
  });

  test('system prompt mentions human escalation availability', () => {
    const kbSource = readFileSync(
      join(PROJECT_ROOT, 'src', 'assistant', 'knowledge-base-instance.ts'), 'utf-8'
    );
    expect(kbSource).toContain('HUMAN ESCALATION');
    expect(kbSource).toContain('ALWAYS reach a human');
    expect(kbSource).toContain('declining off-topic requests, ALWAYS mention this option');
  });
});

// ─── AC4: Bot identification with business name ─────────────────────

describe('AC4: Bot identification with business name and purpose', () => {
  const kbSource = readFileSync(
    join(PROJECT_ROOT, 'src', 'assistant', 'knowledge-base-instance.ts'), 'utf-8'
  );

  test('system prompt has BOT IDENTIFICATION section', () => {
    expect(kbSource).toContain('BOT IDENTIFICATION');
  });

  test('identification includes business name', () => {
    expect(kbSource).toContain('Rainbow, the AI assistant for Pelangi Capsule Hostel');
  });

  test('identification forbids generic AI introduction', () => {
    expect(kbSource).toContain('Never introduce yourself as just "an AI assistant" without stating the business name');
  });

  test('identification includes purpose statement', () => {
    expect(kbSource).toContain('I help with bookings, check-in/out, facilities, pricing');
  });

  test('off_topic response identifies business name', () => {
    const offTopicEntry = knowledgeJson.static.find(
      (e: any) => e.intent === 'off_topic'
    );
    expect(offTopicEntry.response.en).toContain('Pelangi Capsule Hostel');
    expect(offTopicEntry.response.ms).toContain('Pelangi Capsule Hostel');
    expect(offTopicEntry.response.zh).toContain('Pelangi Capsule Hostel');
  });
});

// ─── AC5: Compliance audit log ──────────────────────────────────────

describe('AC5: Compliance audit log records intent categories', () => {
  test('classifyIntentCategory returns in_scope for business intents', () => {
    expect(classifyIntentCategory('greeting')).toBe('in_scope');
    expect(classifyIntentCategory('pricing')).toBe('in_scope');
    expect(classifyIntentCategory('booking')).toBe('in_scope');
    expect(classifyIntentCategory('checkin_info')).toBe('in_scope');
    expect(classifyIntentCategory('checkout_info')).toBe('in_scope');
    expect(classifyIntentCategory('facilities_info')).toBe('in_scope');
    expect(classifyIntentCategory('wifi')).toBe('in_scope');
    expect(classifyIntentCategory('directions')).toBe('in_scope');
    expect(classifyIntentCategory('ORDER_BROWSE')).toBe('in_scope');
    expect(classifyIntentCategory('ORDER_ITEM_ADD')).toBe('in_scope');
  });

  test('classifyIntentCategory returns off_topic for out-of-scope', () => {
    expect(classifyIntentCategory('off_topic')).toBe('off_topic');
  });

  test('classifyIntentCategory returns escalation for human handoff intents', () => {
    expect(classifyIntentCategory('contact_staff')).toBe('escalation');
    expect(classifyIntentCategory('billing_dispute')).toBe('escalation');
  });

  test('complaint intents remain in_scope (legitimate business function)', () => {
    expect(classifyIntentCategory('noise_complaint')).toBe('in_scope');
    expect(classifyIntentCategory('cleanliness_complaint')).toBe('in_scope');
    expect(classifyIntentCategory('general_complaint_in_stay')).toBe('in_scope');
  });

  test('compliance_audit_log table exists in schema', () => {
    const schemaSource = readFileSync(
      join(PROJECT_ROOT, 'shared', 'schema-tables.ts'), 'utf-8'
    );
    expect(schemaSource).toContain('compliance_audit_log');
    expect(schemaSource).toContain('intent_category');
    expect(schemaSource).toContain("'in_scope' | 'off_topic' | 'escalation'");
  });

  test('compliance audit is integrated into pipeline', () => {
    const pipelineSource = readFileSync(
      join(PROJECT_ROOT, 'src', 'assistant', 'pipeline', 'intent-classifier.ts'), 'utf-8'
    );
    expect(pipelineSource).toContain('logComplianceAudit');
    expect(pipelineSource).toContain('US-942');
  });

  test('all routing.json intents are classifiable', () => {
    const intents = Object.keys(routingJson);
    for (const intent of intents) {
      const category = classifyIntentCategory(intent, routingJson[intent].action);
      expect(['in_scope', 'off_topic', 'escalation']).toContain(category);
    }
  });
});
