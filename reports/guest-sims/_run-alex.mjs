// Simulates Alex (Western solo backpacker) across 8 turns against Rainbow AI.
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'http://localhost:3002/api/rainbow/preview/chat';
const sessionId = 'sim-alex-' + Date.now();
const startedAt = new Date().toISOString();

const turns = [
  "Hi! Just arrived in JB. I have a booking at Pelangi Capsule Hostel for tonight.",
  "What's the WiFi password?",
  "How do I get in? Is there someone at reception?",
  "Cool — so just type 1270# on the keypad? What if I'm late, like 1am?",
  "Which capsule is mine — how do I know?",
  "Is breakfast included or do I need to go out? Any good roti canai nearby?",
  "What time is checkout tomorrow? Can I leave my bag after?",
  "Any noise rules? I might come back late from the night market."
];

async function send(message, history) {
  const body = JSON.stringify({ message, history, sessionId });
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json;
}

function grade(turnIdx, reply) {
  const r = (reply || '').toLowerCase();
  const issues = [];
  let verdict = 'PASS';

  if (!reply || reply.trim().length === 0) {
    return { verdict: 'FAIL', issues: ['empty reply'] };
  }

  switch (turnIdx) {
    case 0: // arrival greeting
      if (!/pelangi|welcome|hello|hi|jb|johor|capsule/.test(r)) {
        issues.push('no welcome/acknowledgement');
        verdict = 'WEAK';
      }
      break;
    case 1: // wifi
      if (r.includes('ilovestaycapsule')) {
        // good
      } else {
        issues.push('did not provide wifi password ilovestaycapsule');
        verdict = 'FAIL';
      }
      if (!/pelangi/.test(r)) {
        issues.push('did not mention SSID Pelangi');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 2: // how to get in
      if (r.includes('1270')) {
        // good - gave door code
      } else if (/keypad|door code|access code|pin/.test(r)) {
        issues.push('mentioned keypad/code but no 1270');
        verdict = 'WEAK';
      } else {
        issues.push('did not explain self-check-in/door code');
        verdict = 'FAIL';
      }
      // Check for reception claim - should be self-check-in
      if (/reception.*(24|always|staffed)|front desk.*24/.test(r)) {
        issues.push('may have implied 24h reception — hostel is self-check-in');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 3: // late arrival confirm 1270#
      if (r.includes('1270')) {
        // confirmed
      } else {
        issues.push('did not confirm door code 1270#');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (/late|1 ?am|anytime|24|self/.test(r)) {
        // good
      } else {
        issues.push('did not address late arrival');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 4: // which capsule
      if (/assign|pod|capsule|number|whatsapp|staff|check.?in|booking/.test(r)) {
        // reasonable
      } else {
        issues.push('did not explain capsule assignment');
        verdict = 'WEAK';
      }
      if (/family room|private room|suite/.test(r)) {
        issues.push('mentioned room types that do not exist (capsules only)');
        verdict = 'FAIL';
      }
      break;
    case 5: // breakfast + roti canai
      if (/not included|no breakfast|doesn.?t include|isn.?t included|not provide/.test(r)) {
        // good
      } else if (/breakfast.*(included|provide|serve)/.test(r) && !/not/.test(r)) {
        issues.push('WRONG: implied breakfast is included');
        verdict = 'FAIL';
      } else {
        issues.push('did not clearly state breakfast not included');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (/kitchen|kopitiam|roti|mamak|nearby|restaurant|food/.test(r)) {
        // good
      } else {
        issues.push('did not suggest food options');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 6: // checkout
      if (r.includes('11') || r.includes('12') || /noon|am/.test(r)) {
        // good
      } else {
        issues.push('did not state checkout time');
        verdict = 'FAIL';
      }
      if (/luggage|bag|storage|store|keep/.test(r)) {
        // good
      } else {
        issues.push('did not address luggage storage');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 7: // quiet hours
      if (/10 ?pm|22:00|2200|quiet hour|after 10/.test(r)) {
        // good
      } else if (/quiet|noise|respect/.test(r)) {
        issues.push('mentioned quiet but no 10pm specific');
        verdict = 'WEAK';
      } else {
        issues.push('did not address quiet hours / 10pm rule');
        verdict = 'FAIL';
      }
      break;
  }

  return { verdict, issues };
}

(async () => {
  const history = [];
  const results = [];
  let totalLat = 0, latCount = 0;

  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i];
    let resp = null, err = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await send(msg, history);
        if (resp && resp.message) break;
      } catch (e) {
        err = e.message;
      }
    }

    if (!resp || !resp.message) {
      results.push({
        turn: i + 1,
        message: msg,
        reply: '',
        intent: null, confidence: null, model: null, source: null,
        kbFiles: null, responseTime: null, detectedLanguage: null,
        verdict: 'FAIL',
        issues: ['server error' + (err ? ': ' + err : '')]
      });
      continue;
    }

    const reply = resp.message;
    const { verdict, issues } = grade(i, reply);
    if (typeof resp.responseTime === 'number') {
      totalLat += resp.responseTime; latCount++;
    }

    results.push({
      turn: i + 1,
      message: msg,
      reply,
      intent: resp.intent ?? null,
      confidence: resp.confidence ?? null,
      model: resp.model ?? null,
      source: resp.source ?? null,
      kbFiles: resp.kbFiles ?? null,
      responseTime: resp.responseTime ?? null,
      detectedLanguage: resp.detectedLanguage ?? null,
      verdict,
      issues
    });

    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: reply });
  }

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const weak = results.filter(r => r.verdict === 'WEAK').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const avgLatencyMs = latCount ? Math.round(totalLat / latCount) : null;

  const out = {
    persona: 'alex-backpacker',
    sessionId,
    startedAt,
    turns: results,
    summary: { pass, weak, fail, avgLatencyMs }
  };

  const fname = `alex-backpacker-${Date.now()}.json`;
  const dir = 'C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai/reports/guest-sims';
  const fpath = path.join(dir, fname);
  fs.writeFileSync(fpath, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE:' + fpath);
  console.log('SUMMARY:' + JSON.stringify(out.summary));
  for (const r of results) {
    console.log(`T${r.turn} [${r.verdict}] intent=${r.intent} conf=${r.confidence} lat=${r.responseTime}ms`);
    console.log(`  Q: ${r.message}`);
    console.log(`  A: ${(r.reply || '').slice(0, 400).replace(/\n/g, ' ')}`);
    if (r.issues.length) console.log(`  ISSUES: ${r.issues.join(' | ')}`);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
