/**
 * Event Triggers — Multi-condition scheduled message system
 *
 * Triggers messages based on:
 * 1. A time condition (date field + offset before/after)
 * 2. Zero or more filter conditions (field value checks, AND logic)
 *
 * Data stored in data/event-triggers.json
 * Sent-tracking in data/event-trigger-sent.json
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────────

export const timeTriggerSchema = z.object({
  fieldName: z.string().min(1),
  offsetDirection: z.enum(['before', 'after']),
  offsetAmount: z.number().int().min(0),
  offsetUnit: z.enum(['minutes', 'hours', 'days']),
});
export type TimeTrigger = z.infer<typeof timeTriggerSchema>;

export const filterConditionSchema = z.object({
  fieldName: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty']),
  value: z.string().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const eventTriggerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timeTrigger: timeTriggerSchema,
  filters: z.array(filterConditionSchema),
  messageTemplate: z.string().min(1),
  enabled: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type EventTrigger = z.infer<typeof eventTriggerSchema>;

export const eventTriggersDataSchema = z.object({
  triggers: z.array(eventTriggerSchema),
});

// ─── File Paths ────────────────────────────────────────────────────

const TRIGGERS_FILE = join(process.cwd(), 'data', 'event-triggers.json');
const SENT_FILE = join(process.cwd(), 'data', 'event-trigger-sent.json');

function ensureDir(filepath: string): void {
  const dir = dirname(filepath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Data Persistence ──────────────────────────────────────────────

function loadTriggers(): EventTrigger[] {
  try {
    if (!existsSync(TRIGGERS_FILE)) return [];
    const raw = readFileSync(TRIGGERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = eventTriggersDataSchema.safeParse(parsed);
    return result.success ? result.data.triggers : [];
  } catch {
    return [];
  }
}

function saveTriggers(triggers: EventTrigger[]): void {
  ensureDir(TRIGGERS_FILE);
  const tmpPath = TRIGGERS_FILE + '.tmp';
  writeFileSync(tmpPath, JSON.stringify({ triggers }, null, 2), 'utf-8');
  renameSync(tmpPath, TRIGGERS_FILE);
}

interface SentEntry { key: string; ts: number; }
const SENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadSentEntries(): SentEntry[] {
  try {
    if (!existsSync(SENT_FILE)) return [];
    const raw = readFileSync(SENT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Migrate from old format (string[]) to new format ({key,ts}[])
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return [];
      if (typeof parsed[0] === 'string') {
        return parsed.map((k: string) => ({ key: k, ts: Date.now() }));
      }
      return parsed.filter((e: any) => e && e.key);
    }
    return [];
  } catch {
    return [];
  }
}

function saveSentEntries(entries: SentEntry[]): void {
  ensureDir(SENT_FILE);
  // Prune entries older than 30 days
  const cutoff = Date.now() - SENT_MAX_AGE_MS;
  const pruned = entries.filter(e => e.ts > cutoff);
  const tmpPath = SENT_FILE + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(pruned, null, 2), 'utf-8');
  renameSync(tmpPath, SENT_FILE);
}

function sentKeysSet(entries: SentEntry[]): Set<string> {
  return new Set(entries.map(e => e.key));
}

function generateId(): string {
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// ─── CRUD ──────────────────────────────────────────────────────────

export function listEventTriggers(): EventTrigger[] {
  return loadTriggers();
}

export function getEventTrigger(id: string): EventTrigger | undefined {
  return loadTriggers().find(t => t.id === id);
}

export function createEventTrigger(data: Omit<EventTrigger, 'id' | 'createdAt'>): EventTrigger {
  const triggers = loadTriggers();
  const trigger: EventTrigger = {
    ...data,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  triggers.push(trigger);
  saveTriggers(triggers);
  console.log(`[EventTriggers] Created trigger "${trigger.name}" (${trigger.id})`);
  return trigger;
}

export function updateEventTrigger(id: string, updates: Partial<Omit<EventTrigger, 'id' | 'createdAt'>>): EventTrigger | null {
  const triggers = loadTriggers();
  const idx = triggers.findIndex(t => t.id === id);
  if (idx === -1) return null;
  Object.assign(triggers[idx], updates);
  saveTriggers(triggers);
  return triggers[idx];
}

export function deleteEventTrigger(id: string): boolean {
  const triggers = loadTriggers();
  const idx = triggers.findIndex(t => t.id === id);
  if (idx === -1) return false;
  triggers.splice(idx, 1);
  saveTriggers(triggers);
  return true;
}

// ─── Condition Matching Engine ─────────────────────────────────────

/**
 * Calculate the actual trigger time from a contact's date field and a time trigger config.
 * Returns null if the date field is missing or invalid.
 */
export function calculateTriggerTime(contact: Record<string, any>, timeTrigger: TimeTrigger): Date | null {
  const fieldValue = contact[timeTrigger.fieldName];
  if (!fieldValue) return null;

  const baseDate = new Date(fieldValue);
  if (isNaN(baseDate.getTime())) return null;

  const offsetMs = getOffsetMs(timeTrigger.offsetAmount, timeTrigger.offsetUnit);

  if (timeTrigger.offsetDirection === 'before') {
    return new Date(baseDate.getTime() - offsetMs);
  } else {
    return new Date(baseDate.getTime() + offsetMs);
  }
}

function getOffsetMs(amount: number, unit: string): number {
  switch (unit) {
    case 'minutes': return amount * 60 * 1000;
    case 'hours': return amount * 60 * 60 * 1000;
    case 'days': return amount * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

/**
 * Evaluate all filter conditions against a contact. Returns true if ALL conditions pass (AND logic).
 */
export function evaluateFilters(contact: Record<string, any>, filters: FilterCondition[]): boolean {
  for (const filter of filters) {
    if (!evaluateSingleFilter(contact, filter)) return false;
  }
  return true;
}

function evaluateSingleFilter(contact: Record<string, any>, filter: FilterCondition): boolean {
  const rawValue = contact[filter.fieldName];
  const strValue = rawValue == null ? '' : String(rawValue);

  switch (filter.operator) {
    case 'equals':
      return strValue === (filter.value || '');
    case 'not_equals':
      return strValue !== (filter.value || '');
    case 'contains':
      return strValue.toLowerCase().includes((filter.value || '').toLowerCase());
    case 'is_empty':
      return !rawValue || strValue.trim() === '';
    case 'is_not_empty':
      return rawValue != null && strValue.trim() !== '';
    default:
      return false;
  }
}

/**
 * Resolve template variables like {{contact.name}}, {{contact.checkOut}}
 */
export function resolveMessageTemplate(template: string, contact: Record<string, any>): string {
  return template.replace(/\{\{contact\.(\w+)\}\}/g, (_match, field) => {
    const val = contact[field];
    if (val == null || val === '') return '[unknown]';
    return String(val);
  });
}

// ─── Scheduler Integration ─────────────────────────────────────────

/**
 * Called by the main scheduler every 30s.
 * Checks all enabled triggers against all contacts.
 */
export async function checkEventTriggers(): Promise<void> {
  const triggers = loadTriggers().filter(t => t.enabled);
  if (triggers.length === 0) return;

  // Load all contacts
  let contacts: Array<{ phone: string; details: Record<string, any> }>;
  try {
    const { getAllConversationsWithContacts } = await import('../assistant/conversation-logger.js');
    const conversations = await getAllConversationsWithContacts();
    contacts = conversations.map((c) => ({
      phone: c.phone,
      details: c.contactDetails || {},
    }));
  } catch (err: any) {
    console.error('[EventTriggers] Failed to load contacts:', err.message);
    return;
  }

  const sentEntries = loadSentEntries();
  const sentKeySet = sentKeysSet(sentEntries);
  const now = new Date();
  let sentChanged = false;

  for (const trigger of triggers) {
    for (const { phone, details } of contacts) {
      // 1. Calculate trigger time
      const triggerTime = calculateTriggerTime(details, trigger.timeTrigger);
      if (!triggerTime) continue;

      // 2. Check if trigger time has passed
      if (now < triggerTime) continue;

      // 3. Don't trigger if more than 24h late (stale)
      if (now.getTime() - triggerTime.getTime() > 24 * 60 * 60 * 1000) continue;

      // 4. Evaluate filter conditions
      if (!evaluateFilters(details, trigger.filters)) continue;

      // 5. Check dedup key (triggerId:phone:fieldValue)
      //    Normalize date-like values to YYYY-MM-DD so that "2026-03-25" and
      //    "2026-03-25T14:00:00" produce the same dedup key.
      let fieldValue = String(details[trigger.timeTrigger.fieldName] || '');
      if (/^\d{4}-\d{2}-\d{2}/.test(fieldValue)) {
        fieldValue = fieldValue.slice(0, 10); // keep only YYYY-MM-DD
      }
      const dedupKey = `${trigger.id}:${phone}:${fieldValue}`;
      if (sentKeySet.has(dedupKey)) continue;

      // 6. Resolve template and send
      const message = resolveMessageTemplate(trigger.messageTemplate, { ...details, phone });
      try {
        const { sendWhatsAppMessage } = await import('./baileys-client.js');
        await sendWhatsAppMessage(phone, message);

        // Log the message
        const { logMessage, getConversation } = await import('../assistant/conversation-logger.js');
        const log = await getConversation(phone);
        const pushName = log?.pushName || details.name || 'Guest';
        await logMessage(phone, pushName, 'assistant', message, {
          manual: true,
          staffName: `EventTrigger: ${trigger.name}`,
        });

        sentEntries.push({ key: dedupKey, ts: Date.now() });
        sentKeySet.add(dedupKey);
        sentChanged = true;
        console.log(`[EventTriggers] Sent "${trigger.name}" to ${phone}`);
      } catch (err: any) {
        console.error(`[EventTriggers] Failed to send "${trigger.name}" to ${phone}:`, err.message);
      }
    }
  }

  if (sentChanged) saveSentEntries(sentEntries);
}
