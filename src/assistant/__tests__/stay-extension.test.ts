/**
 * Unit tests for US-021: Stay Extension Request intent
 *
 * Verifies:
 * - stay_extension intent exists in DURING_STAY phase with correct patterns
 * - routing.json maps stay_extension to extension_request workflow
 * - 'stay 2 more nights' messages route to stay_extension, NOT booking
 * - extension_request workflow exists in workflows.json with required steps
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load JSON fixtures directly — no process/network needed
const DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

const intentsData = JSON.parse(readFileSync(join(DATA_DIR, 'intents.json'), 'utf-8'));
const routingData = JSON.parse(readFileSync(join(DATA_DIR, 'routing.json'), 'utf-8'));
const workflowsData = JSON.parse(readFileSync(join(DATA_DIR, 'workflows.json'), 'utf-8'));
const keywordsData = JSON.parse(readFileSync(join(DATA_DIR, 'intent-keywords.json'), 'utf-8'));

// Helper: find intent definition across all phases
function findIntent(category: string) {
  for (const cat of intentsData.categories) {
    const found = cat.intents.find((i: { category: string }) => i.category === category);
    if (found) return { ...found, phase: cat.phase };
  }
  return null;
}

// Helper: match a message against intent patterns
function matchesIntent(message: string, patterns: string[], flags: string): boolean {
  return patterns.some(p => new RegExp(p, flags).test(message));
}

// ─── stay_extension intent ────────────────────────────────────────

describe('stay_extension intent — intents.json', () => {
  const intent = findIntent('stay_extension');

  it('exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('is in DURING_STAY phase', () => {
    expect(intent?.phase).toBe('DURING_STAY');
  });

  it('has enabled: true', () => {
    expect(intent?.enabled).toBe(true);
  });

  const extensionMessages = [
    { msg: 'extend my stay', desc: 'EN: extend my stay' },
    { msg: 'can I stay 2 more nights', desc: 'EN: 2 more nights' },
    { msg: 'I want 3 more nights', desc: 'EN: 3 more nights' },
    { msg: 'extend my booking', desc: 'EN: extend my booking' },
    { msg: 'can I add a night to my booking', desc: 'EN: add a night' },
    { msg: 'tambah malam', desc: 'MS: tambah malam' },
    { msg: '延长住宿', desc: 'ZH: 延长住宿' },
    { msg: '多住几晚', desc: 'ZH: 多住几晚' },
  ];

  it.each(extensionMessages)('matches "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── routing.json ─────────────────────────────────────────────────

describe('stay_extension routing — routing.json', () => {
  it('maps stay_extension to workflow action', () => {
    expect(routingData['stay_extension']).toBeDefined();
    expect(routingData['stay_extension'].action).toBe('workflow');
  });

  it('maps stay_extension to extension_request workflow', () => {
    expect(routingData['stay_extension'].workflow_id).toBe('extension_request');
  });
});

// ─── extension_request workflow ───────────────────────────────────

describe('extension_request workflow — workflows.json', () => {
  const workflows: Array<{ id: string; nodes?: unknown[] }> = workflowsData.workflows;
  const workflow = workflows.find(w => w.id === 'extension_request');

  it('exists in workflows.json', () => {
    expect(workflow).toBeDefined();
  });

  it('has nodes format', () => {
    expect((workflow as { format?: string })?.format).toBe('nodes');
  });

  it('has startNodeId defined', () => {
    expect((workflow as { startNodeId?: string })?.startNodeId).toBeTruthy();
  });

  it('includes admin forwarding node (whatsapp_send)', () => {
    const nodes = (workflow as { nodes?: Array<{ type: string }> })?.nodes ?? [];
    const notifyNode = nodes.find(n => n.type === 'whatsapp_send');
    expect(notifyNode).toBeDefined();
  });

  it('confirmation message contains 30 minutes expectation', () => {
    const nodes = (workflow as { nodes?: Array<{ type: string; config?: { message?: { en?: string } } }> })?.nodes ?? [];
    const confirmNode = nodes.find(
      n => n.type === 'message' && n.config?.message?.en?.includes('30 minutes')
    );
    expect(confirmNode).toBeDefined();
  });

  it('admin notification content includes guest name and phone placeholders', () => {
    const nodes = (workflow as { nodes?: Array<{ type: string; config?: { content?: { en?: string } } }> })?.nodes ?? [];
    const notifyNode = nodes.find(n => n.type === 'whatsapp_send');
    const content = (notifyNode as { config?: { content?: { en?: string } } } | undefined)?.config?.content?.en ?? '';
    expect(content).toContain('{{guest.name}}');
    expect(content).toContain('{{guest.phone}}');
  });
});

// ─── stay_extension keywords ──────────────────────────────────────

describe('stay_extension keywords — intent-keywords.json', () => {
  const entry = keywordsData.intents.find((i: { intent: string }) => i.intent === 'stay_extension');

  it('exists in intent-keywords.json', () => {
    expect(entry).toBeDefined();
  });

  it('has English keywords including "more nights" patterns', () => {
    const enKeywords: string[] = entry?.keywords?.en ?? [];
    const hasMoreNights = enKeywords.some(k => k.includes('more nights') || k.includes('2 more'));
    expect(hasMoreNights).toBe(true);
  });

  it('has Malay keywords including tambah malam', () => {
    const msKeywords: string[] = entry?.keywords?.ms ?? [];
    expect(msKeywords).toContain('tambah malam');
  });

  it('has Chinese keywords including 延长住宿', () => {
    const zhKeywords: string[] = entry?.keywords?.zh ?? [];
    expect(zhKeywords).toContain('延长住宿');
  });
});

// ─── Non-overlap with booking intent ──────────────────────────────

describe('stay_extension vs booking intent — no false overlap', () => {
  const bookingIntent = findIntent('booking');
  const extensionIntent = findIntent('stay_extension');

  it('booking intent exists', () => {
    expect(bookingIntent).not.toBeNull();
  });

  const extensionOnlyMessages = [
    'stay 2 more nights',
    'extend my stay by 3 nights',
    'I want 2 more nights please',
    'tambah malam satu lagi',
  ];

  it.each(extensionOnlyMessages)(
    '"%s" matches stay_extension but NOT booking intent',
    (msg) => {
      const matchesExtension = matchesIntent(msg, extensionIntent.patterns, extensionIntent.flags || 'i');
      const matchesBooking = bookingIntent
        ? matchesIntent(msg, bookingIntent.patterns, bookingIntent.flags || 'i')
        : false;

      expect(matchesExtension).toBe(true);
      expect(matchesBooking).toBe(false);
    }
  );
});
