#!/usr/bin/env node
/**
 * Tier Ablation Test — compares Rainbow routing quality across configurations.
 *
 * Tests:
 *   1. Baseline  — current config (all tiers enabled)
 *   2. No-T1     — disable T1 regex; see which messages fall to T2/T4
 *   3. No-T2     — disable T2 fuzzy; see which messages fall to T3/T4
 *   4. Threshold — sweep T2 fuzzy confidence threshold
 *
 * Usage (from rainbow-ai repo root):
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/tier-ablation.mjs
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/tier-ablation.mjs --mode=baseline
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/tier-ablation.mjs --mode=t1
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/tier-ablation.mjs --mode=t2
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/tier-ablation.mjs --mode=threshold
 *
 * Requires: go-core /chat response includes "source" + "confidence" fields.
 *   (Added in go-core cmd/rainbow-core/main.go 2026-07-26)
 *
 * Output: JSON to stdout, progress to stderr.
 * Exit: 0 = complete, 1 = error.
 *
 * Tier toggle API  : PUT /api/rainbow/intent-manager/tiers
 *   body: { tiers: { tier1_emergency: { enabled: false } } }
 * Threshold API    : PUT /api/rainbow/intent-manager/llm-settings
 *   body: { thresholds: { fuzzy: 0.7 } }
 * Chat API         : POST /chat
 *   body: { message, sessionId, profile }
 *   response: { ok, reply, intent, action, language, source, confidence }
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
const PROFILE  = process.env.PROFILE   || 'pelangi';

// SSH host for pm2 restart after config changes (required — go-core has no hot-reload).
const SSH_HOST = process.env.SSH_HOST || 'deploy@5.223.54.57';

// Default T2 fuzzy threshold read from go-core config defaults (0.80).
// We restore to this after the threshold sweep.
const DEFAULT_FUZZY_THRESHOLD = 0.80;

const { values: args } = parseArgs({
  options: { mode: { type: 'string', default: 'all' } },
  allowPositionals: false,
});

// ─── Gold-standard test cases ──────────────────────────────────────────────────
// expectedTier: which tier SHOULD handle the message
// expectedIntent: expected intent slug ('' = skip intent check)
const TEST_CASES = [
  // T1 regex — direct priority keyword matches
  { message: 'FIRE!!',                              expectedTier: 'T1', expectedIntent: 'emergency' },
  { message: 'fire in the room',                    expectedTier: 'T1', expectedIntent: 'emergency' },
  { message: 'what is the wifi password',           expectedTier: 'T1', expectedIntent: 'wifi' },
  { message: 'check out time please',               expectedTier: 'T1', expectedIntent: 'checkout_time' },
  { message: 'can I check in early',                expectedTier: 'T1', expectedIntent: 'early_checkin' },
  { message: 'my air con is not cold',              expectedTier: 'T1', expectedIntent: 'maintenance_request' },
  { message: 'I need to cancel my booking',        expectedTier: 'T1', expectedIntent: 'cancel_policy' },
  { message: 'no problem!',                         expectedTier: 'T1', expectedIntent: 'thanks' },

  // T2 fuzzy — natural-language variants that T1 regex won't catch
  { message: 'how do I connect to internet',        expectedTier: 'T2', expectedIntent: 'wifi' },
  { message: 'when can we leave the room',          expectedTier: 'T2', expectedIntent: 'checkout_time' },
  { message: 'is there parking available',          expectedTier: 'T2', expectedIntent: 'parking' },
  { message: 'do you have lockers for my bags',    expectedTier: 'T2', expectedIntent: 'luggage_storage' },
  { message: 'charge my phone',                     expectedTier: 'T2', expectedIntent: 'extra_amenity_request' },

  // Mixed — T1 late-arrival regex is narrow (midnight-6am only)
  { message: 'I am arriving at midnight, is that okay', expectedTier: 'T1', expectedIntent: 'late_arrival_checkin' },

  // T4 — open-ended, no keyword match expected
  { message: 'can you recommend good food nearby',  expectedTier: 'T4', expectedIntent: '' },
];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_KEY || '';

async function adminPut(path, body) {
  const url = BASE_URL + '/api/rainbow' + path;
  const headers = { 'Content-Type': 'application/json' };
  if (ADMIN_KEY) headers['X-Admin-Key'] = ADMIN_KEY;
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PUT ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function chat(message) {
  const sessionId = 'ablation-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const res = await fetch(BASE_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, profile: PROFILE }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /chat → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
  // response: { ok, reply, intent, action, language, source, confidence }
}

// ─── Tier helpers ─────────────────────────────────────────────────────────────

function deriveTier(source) {
  if (!source) return 'unknown';
  const s = source.toLowerCase();
  if (s === 'regex')                          return 'T1';
  if (s.startsWith('fuzzy'))                  return 'T2';
  if (s.startsWith('semantic'))               return 'T3';
  return 'T4';
}

// go-core reads config at startup only — must restart after every toggle.
async function restartCore() {
  process.stderr.write('  [restart] pm2 restart rainbow-core-go…\n');
  const r = spawnSync('ssh', [
    SSH_HOST,
    'export PATH=/home/deploy/.nvm/versions/node/v24.15.0/bin:$PATH && pm2 restart rainbow-core-go --update-env',
  ], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) throw new Error('pm2 restart failed: ' + (r.stderr || r.stdout).slice(0, 300));
  // Wait for go-core to be healthy again.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL + '/health');
      if (res.ok) { process.stderr.write('  [restart] healthy\n'); return; }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1_500));
  }
  throw new Error('go-core did not come back healthy after restart');
}

async function setTierEnabled(tierKey, enabled) {
  await adminPut('/intent-manager/tiers', { tiers: { [tierKey]: { enabled } } });
  await restartCore();
}

async function setFuzzyThreshold(threshold) {
  await adminPut('/intent-manager/llm-settings', { thresholds: { fuzzy: threshold } });
  await restartCore();
}

// ─── Test runner ──────────────────────────────────────────────────────────────

async function runCases(label) {
  process.stderr.write(`\n[ablation] ${label} — ${TEST_CASES.length} cases\n`);
  const results = [];
  for (const tc of TEST_CASES) {
    try {
      const r = await chat(tc.message);
      const actualTier   = deriveTier(r.source);
      const actualIntent = r.intent || '';
      const tierMatch    = actualTier === tc.expectedTier;
      const intentMatch  = !tc.expectedIntent || actualIntent === tc.expectedIntent;
      const pass         = tierMatch && intentMatch;
      results.push({
        message:        tc.message,
        expectedTier:   tc.expectedTier,
        actualTier,
        expectedIntent: tc.expectedIntent,
        actualIntent,
        source:         r.source || '',
        confidence:     r.confidence ?? null,
        tierMatch,
        intentMatch,
        pass,
      });
      const icon = pass ? '✓' : tierMatch ? '~' : '✗';
      process.stderr.write(`  ${icon} [${actualTier}/${actualIntent || '-'}] "${tc.message.slice(0, 55)}"\n`);
    } catch (err) {
      results.push({ message: tc.message, error: err.message, pass: false });
      process.stderr.write(`  ! ERROR: ${err.message}\n`);
    }
  }
  const passed = results.filter(r => r.pass).length;
  process.stderr.write(`  → ${passed}/${results.length} pass (score ${(passed / results.length * 100).toFixed(0)}%)\n`);
  return { label, results, passed, total: results.length, score: passed / results.length };
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

function diffRuns(runA, runB) {
  return runA.results.map((a, i) => {
    const b = runB.results[i];
    if (!b) return null;
    const changed = a.actualTier !== b.actualTier || a.actualIntent !== b.actualIntent;
    return {
      message:           a.message,
      [runA.label]:      { tier: a.actualTier, intent: a.actualIntent, pass: a.pass },
      [runB.label]:      { tier: b.actualTier, intent: b.actualIntent, pass: b.pass },
      changed,
    };
  }).filter(Boolean);
}

// ─── Modes ────────────────────────────────────────────────────────────────────

async function runT1Ablation() {
  const base = await runCases('T1-on');
  process.stderr.write('\n[ablation] Disabling T1 (tier1_emergency)…\n');
  await setTierEnabled('tier1_emergency', false).catch(e =>
    process.stderr.write(`  WARNING: ${e.message}\n`));
  const noT1 = await runCases('T1-off');
  process.stderr.write('\n[ablation] Restoring T1…\n');
  await setTierEnabled('tier1_emergency', true).catch(() => {});
  return { baseline: base, noT1, diff: diffRuns(base, noT1) };
}

async function runT2Ablation() {
  const base = await runCases('T2-on');
  process.stderr.write('\n[ablation] Disabling T2 (tier2_keywords)…\n');
  await setTierEnabled('tier2_fuzzy', false).catch(e =>
    process.stderr.write(`  WARNING: ${e.message}\n`));
  const noT2 = await runCases('T2-off');
  process.stderr.write('\n[ablation] Restoring T2…\n');
  await setTierEnabled('tier2_fuzzy', true).catch(() => {});
  return { baseline: base, noT2, diff: diffRuns(base, noT2) };
}

async function runThresholdSweep() {
  const thresholds = [0.3, 0.5, 0.65, 0.75, 0.85, 0.95];
  const runs = [];
  for (const t of thresholds) {
    process.stderr.write(`\n[ablation] Setting T2 fuzzy threshold → ${t}…\n`);
    await setFuzzyThreshold(t).catch(e => process.stderr.write(`  WARNING: ${e.message}\n`));
    const run = await runCases(`threshold-${t}`);
    runs.push({ threshold: t, ...run });
  }
  process.stderr.write(`\n[ablation] Restoring default threshold ${DEFAULT_FUZZY_THRESHOLD}…\n`);
  await setFuzzyThreshold(DEFAULT_FUZZY_THRESHOLD).catch(() => {});
  const best = runs.reduce((a, b) => (a.score >= b.score ? a : b));
  return { runs, bestThreshold: best.threshold, bestScore: best.score };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const mode = args.mode;
process.stderr.write(`[ablation] mode=${mode}  profile=${PROFILE}  base=${BASE_URL}\n`);

let output;
try {
  if (mode === 'baseline') {
    output = await runCases('baseline');
  } else if (mode === 't1') {
    output = await runT1Ablation();
  } else if (mode === 't2') {
    output = await runT2Ablation();
  } else if (mode === 'threshold') {
    output = await runThresholdSweep();
  } else if (mode === 'all') {
    const baseline = await runCases('baseline');
    const t1       = await runT1Ablation();
    const t2       = await runT2Ablation();
    const thr      = await runThresholdSweep();
    output = {
      baseline,
      t1Ablation:     t1,
      t2Ablation:     t2,
      thresholdSweep: thr,
      summary: {
        baselineScore:    baseline.score,
        t1OffScore:       t1.noT1.score,
        t2OffScore:       t2.noT2.score,
        bestThreshold:    thr.bestThreshold,
        bestThreshScore:  thr.bestScore,
        keepT1:           baseline.score > t1.noT1.score,
        keepT2:           baseline.score > t2.noT2.score,
        recommendation: [
          baseline.score > t1.noT1.score
            ? 'T1 on improves accuracy — keep enabled'
            : 'T1 off matches or beats baseline — consider disabling for fewer false-positives',
          baseline.score > t2.noT2.score
            ? 'T2 on improves accuracy — keep enabled'
            : 'T2 off matches or beats baseline',
          `Best fuzzy threshold: ${thr.bestThreshold} (score ${(thr.bestScore * 100).toFixed(0)}%)`,
        ].join('; '),
      },
    };
  } else {
    process.stderr.write(`Unknown mode: ${mode}. Use all|baseline|t1|t2|threshold\n`);
    process.exit(2);
  }
} catch (err) {
  process.stderr.write(`[ablation] FATAL: ${err.message}\n`);
  process.exit(1);
}

console.log(JSON.stringify(output, null, 2));
