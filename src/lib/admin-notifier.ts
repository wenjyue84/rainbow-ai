/**
 * admin-notifier.ts — Barrel re-export
 *
 * Preserves existing import paths. All implementations live in:
 * - admin-notifier-core.ts     (shared state, init, interface)
 * - admin-notifier-instance.ts (WhatsApp instance & server lifecycle)
 * - admin-notifier-alerts.ts   (rate/cost/compliance/security alerts)
 */

// Core
export type { NotificationContext } from './admin-notifier-core.js';
export { initAdminNotifier } from './admin-notifier-core.js';

// WhatsApp instance & server lifecycle
export {
  notifyAdminDisconnection,
  notifyAdminUnlink,
  notifyAdminReconnect,
  notifyAdminServerStartup,
  notifyAdminConfigCorruption,
  notifyAdminConfigError,
  notifyAdminFailoverActivated,
  notifyAdminFailoverDeactivated,
  notifyAdminAuthStateCorruption,
} from './admin-notifier-instance.js';

// Rate, cost, compliance & security alerts
export {
  notifyAdminFrequencyCap,
  notifyAdminMessagingLimit,
  notifyAdminQualityDegradation,
  notifyAdminLLMBudgetAlert,
  notifyAdminRateLimit,
  notifyAdminAccountViolation,
  notifyAdminAccountRestriction,
  notifyAdminTemplatePaused,
  notifyAdminSlowQuery,
  notifyAdminInjectionBurst,
  notifyAdminDpaExpiry,
  notifyAdminFlowHealth,
  notifyAdminDataPortabilityRequest,
  notifyAdminBreachReport,
} from './admin-notifier-alerts.js';
