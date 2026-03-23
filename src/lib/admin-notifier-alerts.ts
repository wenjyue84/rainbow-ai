/**
 * admin-notifier-alerts.ts — Rate limiting, cost, compliance & security alerts
 *
 * Covers: frequency cap, messaging limit, quality degradation, LLM budget,
 * rate limit, account violation/restriction, template paused, slow query,
 * injection burst, DPA expiry, flow health, data portability, breach report.
 */

import {
  notificationContext, logger, loadAdminNotificationSettings,
} from './admin-notifier-core.js';

// ─── Cooldowns ──────────────────────────────────────────────────────

const MESSAGING_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let lastMessagingLimitNotifyAt = 0;

const QUALITY_DEGRADE_COOLDOWN_MS = 30 * 60 * 1000;
const lastQualityDegradeNotifyAt = new Map<string, number>();

const ACCOUNT_VIOLATION_COOLDOWN_MS = 30 * 60 * 1000;
let lastAccountViolationNotifyAt = 0;

const ACCOUNT_RESTRICTION_COOLDOWN_MS = 30 * 60 * 1000;
let lastAccountRestrictionNotifyAt = 0;

const TEMPLATE_STATUS_COOLDOWN_MS = 10 * 60 * 1000;
const lastTemplateStatusNotifyAt = new Map<string, number>();

const SLOW_QUERY_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let lastSlowQueryAlertAt = 0;

const INJECTION_BURST_COOLDOWN = 30 * 60 * 1000; // 30 minutes per JID
const lastInjectionBurstAt = new Map<string, number>();

const FLOW_HEALTH_COOLDOWN_MS = 30 * 60 * 1000; // 30 min per flow
const lastFlowHealthNotifyAt = new Map<string, number>();

// ─── Rate & Cost Alerts ─────────────────────────────────────────────

/**
 * Send marketing frequency cap threshold alert to system admin.
 * Fires when >10% of outbound marketing messages in an hour are rejected
 * with Meta error 131049 (FREQUENCY_CAP_EXCEEDED).
 */
export async function notifyAdminFrequencyCap(
  instanceId: string,
  cappedCount: number,
  outboundCount: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send frequency cap notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const rate = outboundCount > 0
    ? `${(cappedCount / outboundCount * 100).toFixed(1)}%`
    : 'N/A';

  const message = `⚠️ *WhatsApp Frequency Cap Alert*\n\n` +
    `Instance: *${instanceId}*\n` +
    `Rejected (frequency_capped): ${cappedCount}\n` +
    `Total outbound (this hour): ${outboundCount}\n` +
    `Rejection rate: ${rate}\n` +
    `Error: 131049 — FREQUENCY_CAP_EXCEEDED\n\n` +
    `Meta limits each user to 2 marketing messages per 24h across all businesses.\n` +
    `Retrying these messages would not help and wastes quota.\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent frequency cap threshold notification', { toPhone: settings.systemAdminPhone });
  } catch (err: any) {
    logger.error('Failed to send frequency cap notification', { error: err.message });
  }
}

/**
 * Send WhatsApp portfolio messaging tier threshold alert to system admin.
 * Fires when 24-hour outbound count exceeds 80% of the portfolio tier limit.
 * Throttled to at most one notification per 6 hours.
 */
export async function notifyAdminMessagingLimit(
  used24h: number,
  limit: number | string,
  tier: string,
  percentUsed: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send messaging limit notification');
    return;
  }

  const now = Date.now();
  if (now - lastMessagingLimitNotifyAt < MESSAGING_LIMIT_COOLDOWN_MS) {
    logger.info('Messaging limit notification skipped (cooldown)');
    return;
  }
  lastMessagingLimitNotifyAt = now;

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const limitStr = limit === Infinity || limit === 'unlimited' ? 'unlimited' : String(limit);
  const message = `⚠️ *WhatsApp Messaging Limit Warning*\n\n` +
    `Portfolio Tier: *${tier}*\n` +
    `24h Outbound Messages: ${used24h} / ${limitStr}\n` +
    `Usage: *${percentUsed.toFixed(1)}%*\n\n` +
    `You are approaching your WhatsApp Business Portfolio messaging limit.\n` +
    `When the limit is reached, outbound messages will fail silently.\n\n` +
    `**Actions:**\n` +
    `1. Reduce non-critical outbound messages\n` +
    `2. Request tier upgrade from Meta Business Manager\n` +
    `3. Monitor via Rainbow Admin dashboard\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent messaging limit notification', { toPhone: settings.systemAdminPhone, percentUsed });
  } catch (err: any) {
    logger.error('Failed to send messaging limit notification', { error: err.message });
  }
}

/**
 * Send phone number quality degradation alert to system admin (US-458).
 * Fires when a phone_number_quality_update webhook reports FLAGGED, RESTRICTED,
 * or RED quality rating. Throttled to at most one per 30 minutes per profile.
 */
export async function notifyAdminQualityDegradation(
  profileId: string,
  rating: string,
  status: string,
  phoneNumber: string,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send quality degradation notification');
    return;
  }

  const now = Date.now();
  const lastAt = lastQualityDegradeNotifyAt.get(profileId) ?? 0;
  if (now - lastAt < QUALITY_DEGRADE_COOLDOWN_MS) {
    logger.info('Quality degradation notification skipped (cooldown)', { profileId });
    return;
  }
  lastQualityDegradeNotifyAt.set(profileId, now);

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const blocked = status === 'FLAGGED' || status === 'RESTRICTED';
  const message = `⚠️ *WhatsApp Phone Quality Alert*\n\n` +
    `Profile: *${profileId}*\n` +
    `Phone: ${phoneNumber}\n` +
    `Quality Rating: *${rating}*\n` +
    `Status: *${status}*\n` +
    (blocked ? `\n🚫 *Outbound business-initiated messages are now BLOCKED* for this profile.\n` +
      `Replies to user messages will still be sent.\n` +
      `Block will be automatically lifted when status returns to CONNECTED.\n` : '') +
    `\n**Actions:**\n` +
    `1. Review message quality in Meta Business Manager\n` +
    `2. Reduce outbound message volume\n` +
    `3. Ensure messages provide value and are not perceived as spam\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent quality degradation notification', { profileId, rating, status });
  } catch (err: any) {
    logger.error('Failed to send quality degradation notification', { error: err.message });
  }
}

/**
 * Send LLM global daily budget alert to system admin (US-903).
 * Fires at 80% (warning) and 100% (critical) of the configured llmDailyBudgetUsd.
 * Throttled: only one notification per severity per UTC day (handled by caller).
 */
export async function notifyAdminLLMBudgetAlert(
  severity: 'warning' | 'critical',
  currentDayUsd: number,
  budgetUsd: number,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send LLM budget alert');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const pct = budgetUsd > 0 ? ((currentDayUsd / budgetUsd) * 100).toFixed(1) : '0';
  const emoji = severity === 'critical' ? '🚨' : '⚠️';
  const label = severity === 'critical' ? 'CRITICAL' : 'WARNING';

  const rateLimitNote = severity === 'critical'
    ? `\n🛑 *Rate limiting active:* New LLM calls are limited to 1 per 30 seconds per JID until UTC midnight.\n`
    : '';

  const message = `${emoji} *LLM Daily Budget ${label}*\n\n` +
    `Daily Spend: *$${currentDayUsd.toFixed(4)}*\n` +
    `Budget: *$${budgetUsd.toFixed(2)}*\n` +
    `Usage: *${pct}%*\n` +
    rateLimitNote +
    `\n**Actions:**\n` +
    `1. Check provider usage: GET /api/rainbow/llm-costs\n` +
    `2. Review traffic for unusual spikes\n` +
    `3. Adjust budget in settings if needed\n\n` +
    `Budget resets at UTC midnight.\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info(`Sent LLM budget ${severity} notification`, { currentDayUsd, budgetUsd });
  } catch (err: any) {
    logger.error(`Failed to send LLM budget ${severity} notification`, { error: err.message });
  }
}

/**
 * Send AI provider rate limit alert to system admin
 * Notifies when a provider hits too many consecutive 429 errors
 */
export async function notifyAdminRateLimit(
  providerId: string,
  providerName: string,
  errorCount: number,
  totalErrors: number
): Promise<void> {
  if (!notificationContext) {
    console.warn('[AdminNotifier] Not initialized — cannot send rate limit notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) {
    console.log('[AdminNotifier] Admin notifications disabled in settings');
    return;
  }

  const message = `⚠️ *AI Provider Rate Limit Alert*\n\n` +
    `Provider: *${providerName}*\n` +
    `ID: ${providerId}\n` +
    `Consecutive errors: ${errorCount}\n` +
    `Total errors (lifetime): ${totalErrors}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `**What This Means:**\n` +
    `This AI provider has hit its rate limit (429 errors) multiple times. ` +
    `The system is using exponential backoff and will automatically retry after cooldown.\n\n` +
    `**Impact:**\n` +
    `✅ Other providers are still working\n` +
    `⚠️ Responses may be slower if all providers are limited\n\n` +
    `**What You Can Do:**\n` +
    `1. Check if you have API quota remaining for this provider\n` +
    `2. Consider disabling this provider temporarily\n` +
    `3. Upgrade your API plan if needed\n` +
    `4. Monitor via Rainbow Admin dashboard:\n` +
    `   http://localhost:3002/dashboard#settings\n\n` +
    `_This is an automated alert. You'll receive at most 1 per hour per provider._`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    console.log(`[AdminNotifier] ✅ Sent rate limit notification to +${settings.systemAdminPhone}`);
  } catch (err: any) {
    console.error(`[AdminNotifier] Failed to send rate limit notification:`, err.message);
  }
}

// ─── Account & Template Alerts ──────────────────────────────────────

/**
 * Send WhatsApp account policy violation alert to system admin (US-479).
 * Fires when an account_update webhook delivers an ACCOUNT_VIOLATION event.
 * Throttled to at most one notification per 30 minutes.
 */
export async function notifyAdminAccountViolation(
  phoneNumber: string,
  violationType: string,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send account violation notification');
    return;
  }

  const now = Date.now();
  if (now - lastAccountViolationNotifyAt < ACCOUNT_VIOLATION_COOLDOWN_MS) {
    logger.info('Account violation notification skipped (cooldown)', { phoneNumber, violationType });
    return;
  }
  lastAccountViolationNotifyAt = now;

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const message = `🚨 *WhatsApp Account Policy Violation*\n\n` +
    `Phone: ${phoneNumber}\n` +
    `Violation Type: *${violationType}*\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `Meta has flagged your WhatsApp Business account for a policy violation.\n\n` +
    `**Immediate Actions:**\n` +
    `1. Log into Meta Business Manager and review your account status\n` +
    `2. Check recent message campaigns for policy-violating content\n` +
    `3. Submit an appeal if you believe the violation is incorrect\n\n` +
    `_Repeated violations may result in account restriction or ban._`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent account violation notification', { phoneNumber, violationType });
  } catch (err: any) {
    logger.error('Failed to send account violation notification', { error: err.message });
  }
}

/**
 * Send WhatsApp account restriction alert to system admin (US-479).
 * Fires when an account_update webhook delivers an ACCOUNT_RESTRICTION event.
 * Throttled to at most one notification per 30 minutes.
 */
export async function notifyAdminAccountRestriction(
  phoneNumber: string,
  restrictions: Array<{ restrictionType: string; expiration: number | null }>,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send account restriction notification');
    return;
  }

  const now = Date.now();
  if (now - lastAccountRestrictionNotifyAt < ACCOUNT_RESTRICTION_COOLDOWN_MS) {
    logger.info('Account restriction notification skipped (cooldown)', { phoneNumber });
    return;
  }
  lastAccountRestrictionNotifyAt = now;

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const restrictionList = restrictions.map(r => {
    const expiry = r.expiration
      ? new Date(r.expiration * 1000).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })
      : 'indefinite';
    return `  • ${r.restrictionType} (expires: ${expiry})`;
  }).join('\n');

  const message = `⚠️ *WhatsApp Account Restriction*\n\n` +
    `Phone: ${phoneNumber}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `Active Restrictions:\n${restrictionList}\n\n` +
    `Some messaging capabilities may be limited until the restriction expires.\n\n` +
    `**Actions:**\n` +
    `1. Review your account in Meta Business Manager\n` +
    `2. Reduce message volume and ensure content policy compliance\n` +
    `3. Monitor Rainbow Admin dashboard for restriction expiry\n\n` +
    `_Restrictions lift automatically at the expiry time._`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent account restriction notification', { phoneNumber, count: restrictions.length });
  } catch (err: any) {
    logger.error('Failed to send account restriction notification', { error: err.message });
  }
}

/**
 * Send WhatsApp message template status change alert to system admin (US-831).
 * Fires when a message_template_status_update webhook reports PAUSED or DISABLED.
 * Throttled to at most one notification per 10 minutes per template.
 */
export async function notifyAdminTemplatePaused(
  templateName: string,
  newStatus: string,
  reason: string | undefined,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send template status notification');
    return;
  }

  const now = Date.now();
  const lastAt = lastTemplateStatusNotifyAt.get(templateName) ?? 0;
  if (now - lastAt < TEMPLATE_STATUS_COOLDOWN_MS) {
    logger.info('Template status notification skipped (cooldown)', { templateName });
    return;
  }
  lastTemplateStatusNotifyAt.set(templateName, now);

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const emoji = newStatus === 'DISABLED' ? '🚨' : '⚠️';
  const message = `${emoji} *WhatsApp Template ${newStatus}*\n\n` +
    `Template: *${templateName}*\n` +
    `New Status: *${newStatus}*\n` +
    (reason ? `Reason: ${reason}\n` : '') +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `**Impact:**\n` +
    `Proactive messages using this template will silently fail.\n\n` +
    `**Actions:**\n` +
    `1. Log into Meta Business Manager → Message Templates\n` +
    `2. Review the template quality and rejection reasons\n` +
    (newStatus === 'PAUSED'
      ? `3. Template will auto-resume if quality improves within the pause window\n`
      : `3. Create a new template to replace the disabled one\n`) +
    `4. Monitor via Rainbow Admin: GET /api/rainbow/analytics/template-quality`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent template status notification', { templateName, newStatus });
  } catch (err: any) {
    logger.error('Failed to send template status notification', { error: err.message });
  }
}

// ─── Operations & Security Alerts ───────────────────────────────────

/**
 * Send slow database query alert to system admin (US-515).
 * Fires when pg_stat_statements detects any query with mean_exec_time > 2000ms.
 * Throttled to at most one notification per 30 minutes.
 */
export async function notifyAdminSlowQuery(
  topQuery: string,
  meanExecTimeMs: number,
  totalCount: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send slow query notification');
    return;
  }

  const now = Date.now();
  if (now - lastSlowQueryAlertAt < SLOW_QUERY_ALERT_COOLDOWN_MS) {
    logger.info('Slow query notification skipped (cooldown)');
    return;
  }
  lastSlowQueryAlertAt = now;

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const truncated = topQuery.length > 300 ? topQuery.slice(0, 300) + '...' : topQuery;
  const message = `🐢 *Slow Database Query Detected*\n\n` +
    `Mean exec time: *${meanExecTimeMs.toFixed(0)}ms* (threshold: 2000ms)\n` +
    `Queries above threshold: ${totalCount}\n\n` +
    `Top offender:\n\`\`\`\n${truncated}\n\`\`\`\n\n` +
    `⚠️ Note: Neon resets statistics on compute suspend (scale-to-zero).\n\n` +
    `📊 View all: GET /api/rainbow/metrics/slow-queries\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent slow query alert notification', { meanExecTimeMs, totalCount });
  } catch (err: any) {
    logger.error('Failed to send slow query notification', { error: err.message });
  }
}

/**
 * Send alert when 3+ prompt injection attempts detected from the same JID within 1 hour.
 */
export async function notifyAdminInjectionBurst(
  jid: string,
  profileId: string,
  attemptCount: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send injection burst notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  // Throttle: max once per 30 minutes per JID
  const now = Date.now();
  const lastSent = lastInjectionBurstAt.get(jid) ?? 0;
  if (now - lastSent < INJECTION_BURST_COOLDOWN) return;
  lastInjectionBurstAt.set(jid, now);

  const fmtDate = (d: Date) => d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

  const message = `🛡️ *Prompt Injection Alert*\n\n` +
    `*${attemptCount}* injection attempts from the same sender in the last hour.\n\n` +
    `JID: ${jid}\n` +
    `Profile: ${profileId}\n` +
    `Time: ${fmtDate(new Date())}\n\n` +
    `📋 View all: GET /api/rainbow/security/injection-events`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent injection burst alert', { jid, attemptCount });
  } catch (err: any) {
    logger.error('Failed to send injection burst notification', { error: err.message });
  }
}

// ─── Compliance Alerts ──────────────────────────────────────────────

/**
 * Send alert when vendor DPAs are expiring within 30 days.
 */
export async function notifyAdminDpaExpiry(
  vendorName: string,
  expiryDate: Date,
  daysRemaining: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send DPA expiry notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const fmtDate = (d: Date) => d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

  const urgency = daysRemaining <= 7 ? '🔴' : '🟡';
  const message = `${urgency} *DPA Expiry Alert*\n\n` +
    `Vendor: *${vendorName}*\n` +
    `DPA expires: ${fmtDate(expiryDate)}\n` +
    `Days remaining: *${daysRemaining}*\n\n` +
    `PDPA 2024 requires signed DPAs with all data processors.\n` +
    `Penalty: Up to RM1,000,000 fine.\n\n` +
    `📋 View registry: GET /api/rainbow/pdpa/dpa-registry`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent DPA expiry alert', { vendorName, daysRemaining });
  } catch (err: any) {
    logger.error('Failed to send DPA expiry notification', { error: err.message });
  }
}

/**
 * Send alert when a WhatsApp Flow's error rate exceeds 5% over 1 hour.
 */
export async function notifyAdminFlowHealth(
  flowId: string,
  flowName: string,
  status: string,
  errorRate: number,
  errorCount: number,
  totalRequests: number,
  lastFailureReason: string | null
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send flow health notification');
    return;
  }

  const now = Date.now();
  const lastAt = lastFlowHealthNotifyAt.get(flowId) ?? 0;
  if (now - lastAt < FLOW_HEALTH_COOLDOWN_MS) {
    logger.info('Flow health notification skipped (cooldown)', { flowId });
    return;
  }
  lastFlowHealthNotifyAt.set(flowId, now);

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const statusEmoji = status === 'broken' ? '🔴' : '🟡';
  const fallbackNote = status === 'broken'
    ? `\n⚡ *Text-based fallback activated.* Guests will receive text replies instead of Flow screens until the issue is resolved.\n`
    : '';

  const message = `${statusEmoji} *WhatsApp Flow Health Alert*\n\n` +
    `Flow: *${flowName}* (${flowId})\n` +
    `Status: *${status.toUpperCase()}*\n` +
    `Error Rate: *${(errorRate * 100).toFixed(1)}%* (threshold: 5%)\n` +
    `Errors: ${errorCount} / ${totalRequests} requests (last hour)\n` +
    (lastFailureReason ? `Last Error: ${lastFailureReason}\n` : '') +
    fallbackNote +
    `\n**Actions:**\n` +
    `1. Check flow endpoint logs for errors\n` +
    `2. Verify flow private key is valid\n` +
    `3. Test flow health: GET /whatsapp-flows/health\n` +
    `4. Monitor: GET /api/rainbow/analytics/flows-health\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent flow health alert', { flowId, status, errorRate });
  } catch (err: any) {
    logger.error('Failed to send flow health notification', { error: err.message });
  }
}

/**
 * Send PDPA data portability request alert to system admin (US-019).
 * Fires when a guest sends "request my data" to Rainbow AI.
 * Includes the export link and 7-day fulfilment deadline.
 */
export async function notifyAdminDataPortabilityRequest(
  guestPhone: string,
  pushName: string | null,
  requestedAt: Date,
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send data portability notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const dueDate = new Date(requestedAt);
  dueDate.setDate(dueDate.getDate() + 7);

  const fmtDate = (d: Date) => d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
  const guestLabel = pushName ? `${pushName} (${guestPhone})` : guestPhone;
  const exportUrl = `/api/rainbow/pdpa/data-export/${encodeURIComponent(guestPhone)}`;

  const message = `📋 *PDPA Data Portability Request*\n\n` +
    `Guest: *${guestLabel}*\n` +
    `Requested: ${fmtDate(requestedAt)}\n` +
    `PDPA Deadline: *${fmtDate(dueDate)}* (7 days)\n\n` +
    `Export the guest data via:\n` +
    `GET ${exportUrl}\n\n` +
    `(Requires admin key header: x-admin-key)\n\n` +
    `Per PDPA Amendment Act 2024 Phase 3, data must be provided within 7 days.`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent data portability request notification', { guestPhone });
  } catch (err: any) {
    logger.error('Failed to send data portability notification', { error: err.message });
  }
}

export async function notifyAdminBreachReport(
  description: string,
  affectedCount: number,
  commissionerDeadline: Date,
  subjectDeadline: Date
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send breach report notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) {
    logger.info('Breach report notifications disabled in settings');
    return;
  }

  const fmtDate = (d: Date) => d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });

  const message = `🚨 *PDPA Data Breach Report*\n\n` +
    `${description}\n\n` +
    `Affected estimate: *${affectedCount}* individuals\n\n` +
    `⏰ *Commissioner Deadline:* ${fmtDate(commissionerDeadline)} (72h)\n` +
    `⏰ *Subject Deadline:* ${fmtDate(subjectDeadline)} (7 days)\n\n` +
    `📋 View all: GET /api/rainbow/security/breach-report\n\n` +
    `Time: ${fmtDate(new Date())}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent breach report notification', { affectedCount });
  } catch (err: any) {
    logger.error('Failed to send breach report notification', { error: err.message });
  }
}
