/**
 * US-275: Startup validation entry point for keyword scope checks.
 *
 * Re-exports the startup validation hook from keyword-scope-validator
 * so that it can be imported as `src/lib/startup-validation.ts` (per AC3).
 *
 * Usage in index.ts or similar:
 *   import { validateKeywordScopeOnStartup } from './lib/startup-validation.js';
 *   validateKeywordScopeOnStartup();
 */

export { validateKeywordScopeOnStartup } from '../tools/keyword-scope-validator.js';
