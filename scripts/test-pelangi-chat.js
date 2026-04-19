#!/usr/bin/env node
/**
 * test-pelangi-chat.js
 *
 * Tests Rainbow AI's Pelangi profile via the preview API.
 * Run after modifying intents, routing, or action-dispatch.
 *
 * Usage:
 *   node scripts/test-pelangi-chat.js
 *   node scripts/test-pelangi-chat.js --port 3002
 *   node scripts/test-pelangi-chat.js --verbose
 */

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '3002';
const VERBOSE = process.argv.includes('--verbose');
const BASE = `http://localhost:${PORT}/api/rainbow/preview/chat`;
const PROFILE = 'pelangi';

const TESTS = [
  // ── Unit Assignment Query (new intent) ─────────────────────────────
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'EN — primary phrase',
    msg: 'which capsule should i check in',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'EN — "what is my capsule"',
    msg: 'what is my capsule',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'EN — "capsule number please"',
    msg: 'capsule number please',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'EN — "which unit is mine"',
    msg: 'which unit is mine',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'MS — "capsule saya berapa"',
    msg: 'capsule saya berapa',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'MS — "kapsul mana saya"',
    msg: 'kapsul mana saya',
    expect: { intent: 'unit_assignment_query' },
  },
  {
    category: 'UNIT_ASSIGNMENT',
    name: 'ZH — "我的舱位号码"',
    msg: '我的舱位号码',
    expect: { intent: 'unit_assignment_query' },
  },

  // ── Regression: check_in_arrival must still match ──────────────────
  {
    category: 'REGRESSION',
    name: 'check_in_arrival — "i want to check in"',
    msg: 'i want to check in',
    expect: { intent: 'check_in_arrival' },
  },
  {
    category: 'REGRESSION',
    name: 'check_in_arrival — "i have arrived"',
    msg: 'i have arrived',
    expect: { intent: 'check_in_arrival' },
  },
  {
    category: 'REGRESSION',
    name: 'check_in_arrival — "im here"',
    msg: 'im here',
    expect: { intent: 'check_in_arrival' },
  },

  // ── Regression: other critical intents ────────────────────────────
  {
    category: 'REGRESSION',
    name: 'greeting — "hello"',
    msg: 'hello',
    expect: { intent: 'greeting' },
  },
  {
    category: 'REGRESSION',
    name: 'wifi — "wifi password"',
    msg: 'wifi password',
    expect: { intent: 'wifi' },
  },
  {
    category: 'REGRESSION',
    name: 'pricing — "how much per night"',
    msg: 'how much per night',
    expect: { intent: 'pricing' },
  },
  {
    category: 'REGRESSION',
    name: 'lower_deck_preference — "which capsule is lower deck"',
    msg: 'which capsule is lower deck',
    expect: { intent: 'lower_deck_preference' },
  },
  {
    category: 'REGRESSION',
    name: 'checkout_info — "what time check out"',
    msg: 'what time check out',
    expect: { intent: 'checkout_info' },
  },
];

async function runTest(test) {
  const start = Date.now();
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-profile-id': PROFILE,
      },
      body: JSON.stringify({ message: test.msg, history: [] }),
    });
    const data = await res.json();
    const elapsed = Date.now() - start;

    const intentOk = !test.expect.intent || data.intent === test.expect.intent;
    const responseOk = data.message && data.message.length > 0;
    const timeOk = elapsed < 12000;

    const pass = intentOk && responseOk && timeOk;

    return {
      ...test,
      pass,
      actual: {
        intent: data.intent,
        routedAction: data.routedAction,
        source: data.source,
        confidence: data.confidence,
        responseTime: elapsed,
        message: data.message?.slice(0, 80),
      },
      issues: [
        !intentOk && `intent mismatch: got "${data.intent}", expected "${test.expect.intent}"`,
        !responseOk && 'empty response',
        !timeOk && `slow response: ${elapsed}ms`,
      ].filter(Boolean),
    };
  } catch (err) {
    return {
      ...test,
      pass: false,
      actual: { error: err.message },
      issues: [`fetch error: ${err.message}`],
    };
  }
}

async function main() {
  console.log(`\n🧪 Rainbow AI — Pelangi Chat Tests`);
  console.log(`   Endpoint: ${BASE}`);
  console.log(`   Profile:  ${PROFILE}`);
  console.log(`   Tests:    ${TESTS.length}\n`);

  // Check server is up
  try {
    await fetch(`http://localhost:${PORT}/health`);
  } catch {
    console.error(`❌ Server not reachable at http://localhost:${PORT}`);
    console.error(`   Run /rainbow-ai-start first\n`);
    process.exit(1);
  }

  const results = [];
  const categories = [...new Set(TESTS.map(t => t.category))];

  for (const cat of categories) {
    console.log(`\n── ${cat} ──`);
    const catTests = TESTS.filter(t => t.category === cat);
    for (const test of catTests) {
      const result = await runTest(test);
      results.push(result);
      const icon = result.pass ? '✅' : '❌';
      console.log(`  ${icon} ${result.name}`);
      if (!result.pass || VERBOSE) {
        console.log(`     intent=${result.actual.intent} | action=${result.actual.routedAction} | ${result.actual.responseTime}ms`);
        if (result.actual.message) console.log(`     response: "${result.actual.message}"`);
        if (result.issues.length) result.issues.forEach(i => console.log(`     ⚠ ${i}`));
      }
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  const passRate = Math.round((passed / results.length) * 100);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  Result: ${passed}/${results.length} passed (${passRate}%)`);
  if (failed > 0) {
    console.log(`\n  Failed tests:`);
    results.filter(r => !r.pass).forEach(r => {
      console.log(`    ❌ [${r.category}] ${r.name}`);
      r.issues.forEach(i => console.log(`       → ${i}`));
    });
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main();
