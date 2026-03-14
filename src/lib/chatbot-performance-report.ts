/**
 * Chatbot Performance Report (US-825)
 *
 * Generates and sends a daily WhatsApp summary of Rainbow AI performance:
 *   - Total conversations in last 24h
 *   - AI resolution rate %
 *   - Human handoff count
 *   - Top 3 intents
 *   - Fallback rate
 *
 * Scheduled via node-cron at a configurable time (default 08:00 MYT).
 * Only sent if ≥1 conversation occurred in the last 24 hours.
 * Delivery log persisted to data/chatbot-report-log.json.
 */

import cron from 'node-cron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { db } from './db.js';
import { rainbowConversations, rainbowMessages, escalationEvents, intentPredictions } from '../../shared/schema.js';
import { sql, gte, eq, and, desc } from 'drizzle-orm';
import { sendWhatsAppMessage, getWhatsAppStatus } from './baileys-client.js';
import { configStore } from '../assistant/config-store.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatbotReportSettings {
  enabled: boolean;
  recipient_phone: string;
  send_time: string;   // HH:MM
  profile_id: string;  // empty = cross-profile
  description?: string;
}

export interface ChatbotReportLogEntry {
  id: string;
  sentAt: string;
  profileId: string | null;
  recipientPhone: string;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  conversationCount?: number;
}

interface ReportData {
  totalConversations: number;
  resolvedByAI: number;
  humanHandoffs: number;
  resolutionRate: number | null;
  fallbackRate: number | null;
  topIntents: Array<{ intent: string; count: number }>;
}

// ─── Log Persistence ────────────────────────────────────────────────

const LOG_FILE = join(process.cwd(), 'data', 'chatbot-report-log.json');
const MAX_LOG_ENTRIES = 90;

function loadLog(): ChatbotReportLogEntry[] {
  try {
    if (!existsSync(LOG_FILE)) return [];
    const raw = readFileSync(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendLog(entry: ChatbotReportLogEntry): void {
  const entries = loadLog();
  entries.unshift(entry);
  // Keep only the last MAX_LOG_ENTRIES
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.length = MAX_LOG_ENTRIES;
  }
  const dir = dirname(LOG_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = LOG_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  renameSync(tmp, LOG_FILE);
}

export function getReportLog(): ChatbotReportLogEntry[] {
  return loadLog();
}

// ─── Report Data Query ──────────────────────────────────────────────

async function queryReportData(profileId: string | null, since: Date): Promise<ReportData> {
  const profileFilter = profileId
    ? eq(rainbowConversations.profileId, profileId)
    : sql`true`;

  const profileMsgFilter = profileId
    ? eq(rainbowMessages.profileId, profileId)
    : sql`true`;

  const profileEscFilter = profileId
    ? eq(escalationEvents.profileId, profileId)
    : sql`true`;

  // 1. Total conversations active in last 24h
  const [convResult] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(rainbowConversations)
    .where(and(gte(rainbowConversations.updatedAt, since), profileFilter));

  const totalConversations = convResult?.total ?? 0;

  // 2. Escalations (human handoffs) in last 24h — unique conversations escalated
  const [escResult] = await db
    .select({ uniqueJids: sql<number>`count(distinct jid)::int` })
    .from(escalationEvents)
    .where(and(gte(escalationEvents.createdAt, since), profileEscFilter));

  const humanHandoffs = escResult?.uniqueJids ?? 0;

  // 3. Fallback rate from messages (unknown intent vs total user messages)
  const [fallbackResult] = await db
    .select({
      totalUserMessages: sql<number>`count(*) filter (where role = 'user')::int`,
      unknownMessages: sql<number>`count(*) filter (where role = 'user' and (intent = 'unknown' or intent = 'unknown_intent'))::int`,
    })
    .from(rainbowMessages)
    .where(and(gte(rainbowMessages.timestamp, since), profileMsgFilter));

  const totalUserMessages = fallbackResult?.totalUserMessages ?? 0;
  const unknownMessages = fallbackResult?.unknownMessages ?? 0;

  // 4. Top intents from intent_predictions in last 24h
  const profilePredFilter = profileId
    ? sql`phone_number in (select phone from rainbow_conversations where profile_id = ${profileId})`
    : sql`true`;

  const topIntentsRaw = await db
    .select({
      intent: intentPredictions.predictedIntent,
      count: sql<number>`count(*)::int`,
    })
    .from(intentPredictions)
    .where(and(
      gte(intentPredictions.createdAt, since),
      profilePredFilter,
      sql`predicted_intent not in ('unknown', 'unknown_intent')`,
    ))
    .groupBy(intentPredictions.predictedIntent)
    .orderBy(desc(sql`count(*)`))
    .limit(3);

  const topIntents = topIntentsRaw.map(r => ({ intent: r.intent, count: r.count }));

  const resolvedByAI = Math.max(0, totalConversations - humanHandoffs);
  const resolutionRate = totalConversations > 0
    ? Math.round((resolvedByAI / totalConversations) * 100)
    : null;
  const fallbackRate = totalUserMessages > 0
    ? Math.round((unknownMessages / totalUserMessages) * 100)
    : null;

  return {
    totalConversations,
    resolvedByAI,
    humanHandoffs,
    resolutionRate,
    fallbackRate,
    topIntents,
  };
}

// ─── Report Formatting ───────────────────────────────────────────────

function formatReport(data: ReportData, profileId: string | null): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const profileLabel = profileId ? ` — ${profileId}` : '';

  const lines: string[] = [
    `📊 *Rainbow AI Daily Report${profileLabel}*`,
    `📅 ${dateStr} | ${timeStr} MYT`,
    '',
    `💬 *Conversations (24h)*`,
    `Total: ${data.totalConversations}`,
    `AI Resolved: ${data.resolvedByAI}${data.resolutionRate !== null ? ` (${data.resolutionRate}%)` : ''}`,
    `Human Handoffs: ${data.humanHandoffs}`,
    `Fallback Rate: ${data.fallbackRate !== null ? `${data.fallbackRate}%` : 'N/A'}`,
  ];

  if (data.topIntents.length > 0) {
    lines.push('', `🎯 *Top Intents*`);
    data.topIntents.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.intent} — ${item.count}`);
    });
  }

  // Alerts
  const alerts: string[] = [];
  if (data.resolutionRate !== null && data.resolutionRate < 60) {
    alerts.push(`⚠️ Resolution rate below 60% threshold`);
  }
  if (data.fallbackRate !== null && data.fallbackRate > 20) {
    alerts.push(`⚠️ Fallback rate above 20% — review intent coverage`);
  }
  if (alerts.length > 0) {
    lines.push('', `🚨 *Alerts*`, ...alerts);
  }

  lines.push('', `🤖 _Rainbow AI_`);

  return lines.join('\n');
}

// ─── Send Report ─────────────────────────────────────────────────────

export async function buildAndSendChatbotReport(
  settings: ChatbotReportSettings,
): Promise<{ success: boolean; reason?: string; conversationCount?: number }> {
  const profileId = settings.profile_id || null;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let data: ReportData;
  try {
    data = await queryReportData(profileId, since);
  } catch (err: any) {
    return { success: false, reason: `DB query failed: ${err.message}` };
  }

  // AC: only send if at least 1 conversation in last 24h
  if (data.totalConversations < 1) {
    const entry: ChatbotReportLogEntry = {
      id: `report-${Date.now()}`,
      sentAt: new Date().toISOString(),
      profileId,
      recipientPhone: settings.recipient_phone,
      status: 'skipped',
      reason: 'No conversations in last 24h',
      conversationCount: 0,
    };
    appendLog(entry);
    console.log('[ChatbotReport] Skipped — no conversations in last 24h');
    return { success: true, reason: 'No conversations — skipped', conversationCount: 0 };
  }

  // Check WhatsApp connection
  const waStatus = getWhatsAppStatus();
  if (waStatus.state !== 'open') {
    const entry: ChatbotReportLogEntry = {
      id: `report-${Date.now()}`,
      sentAt: new Date().toISOString(),
      profileId,
      recipientPhone: settings.recipient_phone,
      status: 'failed',
      reason: 'WhatsApp not connected',
      conversationCount: data.totalConversations,
    };
    appendLog(entry);
    return { success: false, reason: 'WhatsApp not connected' };
  }

  const message = formatReport(data, profileId);

  try {
    await sendWhatsAppMessage(settings.recipient_phone, message);
    const entry: ChatbotReportLogEntry = {
      id: `report-${Date.now()}`,
      sentAt: new Date().toISOString(),
      profileId,
      recipientPhone: settings.recipient_phone,
      status: 'sent',
      conversationCount: data.totalConversations,
    };
    appendLog(entry);
    console.log(`[ChatbotReport] Sent to ${settings.recipient_phone} (${data.totalConversations} conversations)`);
    return { success: true, conversationCount: data.totalConversations };
  } catch (err: any) {
    const entry: ChatbotReportLogEntry = {
      id: `report-${Date.now()}`,
      sentAt: new Date().toISOString(),
      profileId,
      recipientPhone: settings.recipient_phone,
      status: 'failed',
      reason: err.message,
      conversationCount: data.totalConversations,
    };
    appendLog(entry);
    console.error('[ChatbotReport] Send failed:', err.message);
    return { success: false, reason: err.message };
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

function getChatbotReportSettings(): ChatbotReportSettings | null {
  try {
    const settings = (configStore.getSettings() as any);
    if (settings?.chatbot_report) {
      return settings.chatbot_report as ChatbotReportSettings;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start the chatbot performance report scheduler.
 * Reads send_time from settings at schedule time (so config changes take effect after restart).
 * Call this after WhatsApp is connected.
 */
export function startChatbotReportScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  const settings = getChatbotReportSettings();
  if (!settings) {
    console.log('[ChatbotReport] No chatbot_report settings found — scheduler not started');
    return;
  }

  if (!settings.enabled) {
    console.log('[ChatbotReport] Disabled in settings — scheduler not started');
    return;
  }

  if (!settings.recipient_phone) {
    console.warn('[ChatbotReport] recipient_phone not configured — scheduler not started');
    return;
  }

  // Parse HH:MM
  const [hourStr, minuteStr] = settings.send_time.split(':');
  const hour = parseInt(hourStr ?? '8', 10);
  const minute = parseInt(minuteStr ?? '0', 10);

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.warn(`[ChatbotReport] Invalid send_time "${settings.send_time}" — using default 08:00`);
  }

  const h = isNaN(hour) ? 8 : hour;
  const m = isNaN(minute) ? 0 : minute;
  const cronExpr = `${m} ${h} * * *`;

  cronTask = cron.schedule(cronExpr, async () => {
    console.log('[ChatbotReport] Running scheduled chatbot performance report...');
    const currentSettings = getChatbotReportSettings();
    if (!currentSettings?.enabled || !currentSettings.recipient_phone) {
      console.log('[ChatbotReport] Skipped — disabled or no recipient in current settings');
      return;
    }
    await buildAndSendChatbotReport(currentSettings);
  }, { timezone: 'Asia/Kuala_Lumpur' });

  console.log(`[ChatbotReport] Scheduled for ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} MYT daily`);
}

export function stopChatbotReportScheduler(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[ChatbotReport] Scheduler stopped');
  }
}
