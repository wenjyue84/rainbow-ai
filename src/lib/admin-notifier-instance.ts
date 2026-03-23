/**
 * admin-notifier-instance.ts — WhatsApp instance lifecycle & server notifications
 *
 * Covers: disconnect, unlink, reconnect, server startup, config corruption,
 * config error, failover activation/deactivation, auth state corruption.
 */

import {
  notificationContext, logger, getTodayKL, loadAdminNotificationSettings,
} from './admin-notifier-core.js';

// ─── Cooldowns ──────────────────────────────────────────────────────

/** Cooldown: only one reconnect notification per instance per 10 minutes */
const RECONNECT_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const lastReconnectNotifyAt = new Map<string, number>();

/** Max server startup notifications per number per calendar day (Asia/Kuala_Lumpur) */
const MAX_SERVER_STARTUP_PER_DAY = 3;
const serverStartupSendCount = new Map<string, { date: string; count: number }>();

// ─── WhatsApp Instance Notifications ────────────────────────────────

/**
 * Send WhatsApp instance disconnection alert to system admin
 */
export async function notifyAdminDisconnection(
  instanceId: string,
  instanceLabel: string,
  reason: string
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send disconnect notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled || !settings.notifyOnDisconnect) {
    logger.info('Disconnect notifications disabled in settings');
    return;
  }

  const message = `⚠️ *WhatsApp Instance Disconnected*\n\n` +
    `Instance: *${instanceLabel}*\n` +
    `ID: ${instanceId}\n` +
    `Reason: ${reason}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `Please check the Rainbow Admin dashboard:\n` +
    `http://localhost:3002/dashboard`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent disconnect notification', { toPhone: settings.systemAdminPhone });
  } catch (err: any) {
    logger.error('Failed to send disconnect notification', { error: err.message, stack: err.stack });
  }
}

/**
 * Send WhatsApp instance unlink alert to system admin
 */
export async function notifyAdminUnlink(
  instanceId: string,
  instanceLabel: string,
  instancePhone: string
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send unlink notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled || !settings.notifyOnUnlink) {
    logger.info('Unlink notifications disabled in settings');
    return;
  }

  const message = `🚨 *WhatsApp Instance Unlinked*\n\n` +
    `Your WhatsApp instance *"${instanceLabel}"* (${instancePhone}) has been unlinked from WhatsApp.\n\n` +
    `This usually means someone logged out from WhatsApp > Linked Devices, or the session expired.\n\n` +
    `To reconnect:\n` +
    `1. Visit: http://localhost:3002/dashboard\n` +
    `2. Click "Pair QR" next to the instance\n` +
    `3. Scan with WhatsApp > Linked Devices > Link a Device\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent unlink notification', { toPhone: settings.systemAdminPhone });
  } catch (err: any) {
    logger.error('Failed to send unlink notification', { error: err.message, stack: err.stack });
  }
}

/**
 * Send MCP server reconnection alert to system admin.
 * Throttled to at most one notification per instance per 10 minutes.
 */
export async function notifyAdminReconnect(
  instanceId: string,
  instanceLabel: string,
  instancePhone: string
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send reconnect notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled || !settings.notifyOnReconnect) {
    logger.info('Reconnect notifications disabled in settings');
    return;
  }

  const now = Date.now();
  const lastAt = lastReconnectNotifyAt.get(instanceId) ?? 0;
  if (now - lastAt < RECONNECT_NOTIFY_COOLDOWN_MS) {
    logger.info('Reconnect notification skipped (cooldown)', { instanceId });
    return;
  }
  lastReconnectNotifyAt.set(instanceId, now);

  const message = `✅ *WhatsApp Instance Reconnected*\n\n` +
    `Instance: *${instanceLabel}*\n` +
    `Phone: ${instancePhone}\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `The Rainbow AI assistant is now active and monitoring guest messages.`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent reconnect notification', { toPhone: settings.systemAdminPhone });
  } catch (err: any) {
    logger.error('Failed to send reconnect notification', { error: err.message, stack: err.stack });
  }
}

/**
 * Send MCP server startup alert to system admin.
 * Limited to 3 sends per number per calendar day (Asia/Kuala_Lumpur).
 * On the 3rd send, informs the user they will not receive this message again until 12am.
 */
export async function notifyAdminServerStartup(): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send startup notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled || !settings.notifyOnReconnect) {
    console.log('[AdminNotifier] Server startup notifications disabled in settings');
    return;
  }

  const phone = settings.systemAdminPhone;
  const today = getTodayKL();
  let entry = serverStartupSendCount.get(phone);
  if (!entry || entry.date !== today) {
    entry = { date: today, count: 0 };
    serverStartupSendCount.set(phone, entry);
  }

  if (entry.count >= MAX_SERVER_STARTUP_PER_DAY) {
    console.log(`[AdminNotifier] Server startup notification skipped (max ${MAX_SERVER_STARTUP_PER_DAY}/day for +${phone})`);
    return;
  }

  entry.count += 1;
  const isLastOfDay = entry.count === MAX_SERVER_STARTUP_PER_DAY;

  let message = `🔄 *Rainbow MCP Server Started*\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `The MCP server has restarted successfully.\n` +
    `WhatsApp instances are initializing...\n\n` +
    `Dashboard: http://localhost:3002/dashboard`;
  if (isLastOfDay) {
    message += `\n\n_You will not receive this message again until 12am today._`;
  }

  try {
    await notificationContext.sendMessage(phone, message);
    console.log(`[AdminNotifier] Sent server startup notification to +${phone} (${entry.count}/${MAX_SERVER_STARTUP_PER_DAY} today)`);
  } catch (err: any) {
    entry.count -= 1; // rollback on failure so they can still get up to 3
    console.error(`[AdminNotifier] Failed to send startup notification:`, err.message);
  }
}

// ─── Config & Failover Notifications ────────────────────────────────

/**
 * Send config corruption alert to system admin
 * Notifies when JSON config files fail to load and system falls back to defaults
 */
export async function notifyAdminConfigCorruption(corruptedFiles: string[]): Promise<void> {
  if (!notificationContext) {
    console.warn('[AdminNotifier] Not initialized — cannot send config corruption notification');
    return;
  }

  if (corruptedFiles.length === 0) {
    return; // Nothing to notify
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) {
    console.log('[AdminNotifier] Admin notifications disabled in settings');
    return;
  }

  const fileList = corruptedFiles.map(f => `  • ${f}`).join('\n');
  const message = `⚠️ *Configuration Error Detected*\n\n` +
    `The following config files failed to load:\n${fileList}\n\n` +
    `**Action Taken:**\n` +
    `✅ Server started with safe default configs\n` +
    `✅ Rainbow AI is operational in safe mode\n` +
    `⚠️ Some features may be limited\n\n` +
    `**What You Need to Do:**\n` +
    `1. Check the config files for JSON syntax errors\n` +
    `2. Fix any malformed JSON or missing required fields\n` +
    `3. Restart the server to reload configs\n\n` +
    `💡 *Tip:* Use the Rainbow Admin dashboard to edit configs:\n` +
    `http://localhost:3002/dashboard\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    console.log(`[AdminNotifier] ✅ Sent config corruption notification to +${settings.systemAdminPhone}`);
  } catch (err: any) {
    console.error(`[AdminNotifier] Failed to send config corruption notification:`, err.message);
  }
}

/**
 * Send general configuration error alert to system admin.
 *
 * Use this for runtime config validation failures (missing routes, invalid workflows, etc.).
 * Implements 5-minute cooldown per unique message to prevent spam.
 */
export async function notifyAdminConfigError(message: string): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send config error notification');
    return;
  }

  // Deduplicate rapid notifications (same message within 5 minutes)
  const COOLDOWN_MS = 5 * 60 * 1000;
  const now = Date.now();
  const cacheKey = `config_error:${message}`;
  const lastTime = lastReconnectNotifyAt.get(cacheKey) || 0;

  if (now - lastTime < COOLDOWN_MS) {
    logger.info('Config error notification skipped (cooldown)', { messageHash: message.slice(0, 50) });
    return;
  }
  lastReconnectNotifyAt.set(cacheKey, now);

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) {
    logger.info('Config error notifications disabled in settings');
    return;
  }

  const notification =
    `🔧 *Rainbow Config Error*\n\n${message}\n\n` +
    `📊 Check dashboard: http://localhost:3002/admin/rainbow\n\n` +
    `🕐 Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, notification);
    logger.info('Sent config error notification', { toPhone: settings.systemAdminPhone });
  } catch (err: any) {
    logger.error('Failed to send config error notification', { error: err.message });
    // Don't throw - notification failure should not block guest responses
  }
}

/**
 * Send failover activation alert to system admin.
 * Called when standby server takes over because primary went silent.
 */
export async function notifyAdminFailoverActivated(): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send failover activation notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const role = process.env.RAINBOW_ROLE || 'unknown';
  const message = `🔄 *Rainbow AI Failover Activated*\n\n` +
    `Server role: *${role}* → now ACTIVE\n` +
    `Reason: Primary server heartbeat lost\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `This server is now handling all WhatsApp messages.\n` +
    `Check primary server status and restart if needed.`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent failover activation notification');
  } catch (err: any) {
    logger.error('Failed to send failover activation notification', { error: err.message });
  }
}

/**
 * Send failover deactivation alert to system admin.
 * Called when primary server resumes and standby hands back.
 */
export async function notifyAdminFailoverDeactivated(): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send failover deactivation notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) return;

  const role = process.env.RAINBOW_ROLE || 'unknown';
  const message = `✅ *Rainbow AI Failover Deactivated*\n\n` +
    `Server role: *${role}* → now STANDBY\n` +
    `Reason: Primary server heartbeat resumed\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
    `Primary server is back in control. This server is monitoring.`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent failover deactivation notification');
  } catch (err: any) {
    logger.error('Failed to send failover deactivation notification', { error: err.message });
  }
}

/**
 * Send auth state corruption cleared notification to system admin (US-842).
 */
export async function notifyAdminAuthStateCorruption(
  instanceId: string,
  clearedRows: number
): Promise<void> {
  if (!notificationContext) {
    logger.warn('Not initialized — cannot send auth state corruption notification');
    return;
  }

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled) {
    logger.info('Auth state corruption notifications disabled in settings');
    return;
  }

  const message = `⚠️ *WhatsApp Auth State Corrupted & Cleared*\n\n` +
    `Instance: *${instanceId}*\n` +
    `Cleared rows: ${clearedRows}\n\n` +
    `The stored Baileys credentials were corrupted (unparseable JSON or missing required fields). ` +
    `They have been cleared automatically.\n\n` +
    `*Action required:* Please re-scan the QR code to re-pair this instance.\n\n` +
    `1. Visit: http://localhost:3002/dashboard\n` +
    `2. Click "Pair QR" next to *${instanceId}*\n` +
    `3. Scan with WhatsApp > Linked Devices > Link a Device\n\n` +
    `Time: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`;

  try {
    await notificationContext.sendMessage(settings.systemAdminPhone, message);
    logger.info('Sent auth state corruption notification', { instanceId, clearedRows });
  } catch (err: any) {
    logger.error('Failed to send auth state corruption notification', { error: err.message });
  }
}
