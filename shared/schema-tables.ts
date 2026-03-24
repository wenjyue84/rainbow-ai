/**
 * schema-tables.ts — Drizzle ORM table definitions for Rainbow AI
 *
 * Tables are split into domain modules under shared/tables/.
 * This file re-exports everything for backwards compatibility —
 * all 75 importers continue to work unchanged.
 *
 * Module layout:
 *   core.ts            — appSettings, intentDetectionSettings, rainbowFeedback, intentPredictions
 *   intent-analytics.ts — intent classification analytics and ML monitoring
 *   conversations.ts   — conversation state, messages, delivery, escalation events
 *   messaging.ts       — costs, scheduling, templates, stickers, campaigns, DLQ
 *   compliance.ts      — PDPA/GDPR, DPIA, TIA, profile isolation, security audit
 *   admin.ts           — admin users, RBAC, audit logs, operational monitoring
 *   bookings.ts        — booking workflows, reservations, execution audits
 */
export * from './tables/core.js';
export * from './tables/intent-analytics.js';
export * from './tables/conversations.js';
export * from './tables/messaging.js';
export * from './tables/compliance.js';
export * from './tables/admin.js';
export * from './tables/bookings.js';
