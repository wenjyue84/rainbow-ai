/**
 * schema-drizzle.ts — Drizzle Kit schema entry point (CommonJS-compatible)
 *
 * This file is used by drizzle-kit (which runs in CJS mode) and cannot use
 * the `.js` extension imports that the ESM runtime requires. It re-exports
 * from the same table modules but without `.js` extensions.
 *
 * Do NOT import this file from the application — use schema-tables.ts instead.
 */
export * from './tables/core';
export * from './tables/intent-analytics';
export * from './tables/conversations';
export * from './tables/messaging';
export * from './tables/compliance';
export * from './tables/admin';
export * from './tables/bookings';
