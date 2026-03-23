/**
 * admin-notifier-core.ts — Shared state for admin notification sub-modules
 *
 * Exports the NotificationContext, logger, and initialization function.
 * Sub-modules import these via ESM live bindings.
 */

import { loadAdminNotificationSettings } from './admin-notification-settings.js';
import { createModuleLogger } from './logger.js';

export const logger = createModuleLogger('AdminNotifications');

export interface NotificationContext {
  sendMessage: (phone: string, text: string, instanceId?: string) => Promise<any>;
  getConnectedInstance?: () => { id: string; state: string } | null;
}

export let notificationContext: NotificationContext | null = null;

/**
 * Initialize the admin notifier with WhatsApp send capabilities.
 * Must be called once at server startup after WhatsApp instances are ready.
 */
export function initAdminNotifier(context: NotificationContext): void {
  notificationContext = context;
  logger.info('✅ Initialized');
}

export function getTodayKL(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); // YYYY-MM-DD
}

export { loadAdminNotificationSettings };
