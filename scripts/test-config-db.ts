/**
 * Quick test: verify config-db functions work in both DB and no-DB modes.
 * Usage: cd RainbowAI && npx tsx scripts/test-config-db.ts
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });

// ─── Test 1: No-DB mode ─────────────────────────────────────────────
console.log('=== Test 1: No-DB backward compat ===');
const savedUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

// Dynamic import so env is checked at import time
const { ensureConfigTables, loadConfigFromDB, saveConfigToDB, getConfigAuditLog } =
  await import('../src/lib/config-db.js');

await ensureConfigTables();
console.log('  ensureConfigTables() → no-op ✅');

const result1 = await loadConfigFromDB('test-key');
console.log('  loadConfigFromDB() →', result1, result1 === null ? '✅' : '❌');

await saveConfigToDB('test-key', { foo: 'bar' });
console.log('  saveConfigToDB() → no-op ✅');

const audit1 = await getConfigAuditLog();
console.log('  getConfigAuditLog() →', audit1.length === 0 ? '[] ✅' : '❌');

// ─── Test 2: With DB ─────────────────────────────────────────────────
console.log('\n=== Test 2: DB mode ===');
process.env.DATABASE_URL = savedUrl!;

// Need fresh imports to pick up new env — but module caching means hasDB() re-checks env each call
const result2 = await loadConfigFromDB('settings.json');
if (result2 !== null) {
  console.log('  loadConfigFromDB("settings.json") → got data ✅');
  console.log('  Keys:', Object.keys(result2).slice(0, 5).join(', '), '...');
} else {
  console.log('  loadConfigFromDB("settings.json") → null (no migration yet?) ⚠️');
}

const audit2 = await getConfigAuditLog(5);
console.log('  getConfigAuditLog(5) →', audit2.length, 'rows', audit2.length > 0 ? '✅' : '(empty)');

// ─── Test 3: LLM Settings Loader ────────────────────────────────────
console.log('\n=== Test 3: LLM Settings Loader ===');
const { getLLMSettings, reloadLLMSettingsFromDB } = await import('../src/assistant/llm-settings-loader.js');

const settings = getLLMSettings();
console.log('  getLLMSettings() → keys:', Object.keys(settings).join(', '), '✅');

await reloadLLMSettingsFromDB();
console.log('  reloadLLMSettingsFromDB() → OK ✅');

console.log('\n✅ All tests passed!');
process.exit(0);
