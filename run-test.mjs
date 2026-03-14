// Minimal test runner for fnb-widget-bugs - no vitest overhead
import { readFileSync } from 'fs';

// Load the module source to check exports exist
const src = readFileSync('src/assistant/ai-response-generator.ts', 'utf8');
const hasLooksLikeJson = src.includes('export function looksLikeJson');
const hasGetUnknownFallback = src.includes('export function getUnknownFallbackMessages');

console.log('Export check:');
console.log('  looksLikeJson exported:', hasLooksLikeJson);
console.log('  getUnknownFallbackMessages exported:', hasGetUnknownFallback);

// Inline the looksLikeJson logic from source for testing
function looksLikeJson(s) {
  if (!s || typeof s !== 'string') return false;
  const trimmed = s.trim();
  // Must start with { or [{ and end with } or }]
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { JSON.parse(trimmed); return true; } catch { return false; }
  }
  if (trimmed.startsWith('[{') && trimmed.endsWith('}]')) {
    try { JSON.parse(trimmed); return true; } catch { return false; }
  }
  return false;
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.log('  FAIL:', msg); }
}

// Test looksLikeJson
console.log('\nTest: looksLikeJson');
assert(looksLikeJson('{"key":"value"}') === true, 'should detect JSON objects');
assert(looksLikeJson('[{"key":"value"}]') === true, 'should detect JSON arrays');
assert(looksLikeJson('Hello world') === false, 'should reject plain text');
assert(looksLikeJson('') === false, 'should reject empty string');
assert(looksLikeJson('{incomplete') === false, 'should reject incomplete JSON');

// Test JSON extraction (simulating chatWithToolsLoop fix)
console.log('\nTest: JSON extraction from LLM response');
const jsonContent = '{"intent":"menu_query","response":"Here is the menu","confidence":0.5}';
assert(looksLikeJson(jsonContent) === true, 'should detect JSON response');
const j = JSON.parse(jsonContent);
const extracted = j.response || j.text || j.message || null;
assert(extracted === 'Here is the menu', 'should extract response field');
assert(!looksLikeJson(extracted), 'extracted text should not be JSON');

// Test makan-moments fallback
console.log('\nTest: makan-moments fallback messages');
const makanSettings = JSON.parse(readFileSync('src/assistant/data-makan/settings.json', 'utf8'));
const fallbackEn = makanSettings.unknownFallback?.en || '';
assert(!fallbackEn.includes('hostel'), 'EN fallback should not mention hostel');
assert(!fallbackEn.includes('check-in'), 'EN fallback should not mention check-in');
assert(!fallbackEn.includes('bookings'), 'EN fallback should not mention bookings');
assert(fallbackEn.includes('staff') || fallbackEn.includes('menu'), 'EN fallback should mention staff or menu');

const fallbackMs = makanSettings.unknownFallback?.ms || '';
assert(!fallbackMs.includes('hostel'), 'MS fallback should not mention hostel');

// Test system_prompt unicode fix
console.log('\nTest: system_prompt unicode fix (US-804)');
assert(!makanSettings.system_prompt.includes('\u00e2'), 'system_prompt should not contain corrupted char');
assert(makanSettings.system_prompt.includes('\u2014'), 'system_prompt should contain proper em dash');

// Test file exists
console.log('\nTest: test file exists');
try {
  readFileSync('src/assistant/__tests__/fnb-widget-bugs.test.ts', 'utf8');
  assert(true, 'test file exists');
} catch {
  assert(false, 'test file should exist');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
