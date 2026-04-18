// Simulates Uncle Lim (long-term guest renewing monthly) across 8 turns against Rainbow AI.
import fs from 'node:fs';
import path from 'node:path';

const ENDPOINT = 'http://localhost:3002/api/rainbow/preview/chat';
const sessionId = 'sim-unclelim-' + Date.now();
const startedAt = new Date().toISOString();

const turns = [
  "Hello, I stay one month already 下个月 I want to renew. Still got promotion meh?",
  "monthly rate 多少钱? Kalau pay cash boleh discount?",
  "I pay via DuitNow or Maybank transfer ok? 还是一定要TnG?",
  "Next door one very noisy lah, every night talking until 2am. 怎么办?",
  "Got laundry here right? How much per load?",
  "If I want extend another month, how I book? Need deposit?",
  "Can you help check my last month invoice?",
  "Ok thanks ah, tonight if still noisy I message you ok?"
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
  const hallucinations = [];
  let verdict = 'PASS';

  if (!reply || reply.trim().length === 0) {
    return { verdict: 'FAIL', issues: ['empty reply'], hallucinations: [] };
  }

  // Generic hallucination scan: invented monthly price like "RM 800/month", "RM1200 monthly"
  const monthlyPriceRegex = /rm\s?\d{2,4}\s?(\/|per)?\s?(month|bulan|mth|monthly)/i;
  const monthlyMatch = reply.match(monthlyPriceRegex);

  switch (turnIdx) {
    case 0: // renewal / promotion
      if (/staff|whatsapp|contact|message|check with|ask/.test(r)) {
        // good - deferring to staff
      } else {
        issues.push('did not defer renewal/promo inquiry to staff');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (/promotion|discount|special|long.?stay|monthly/.test(r)) {
        // acknowledged
      } else {
        issues.push('did not address promotion question');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (monthlyMatch) {
        hallucinations.push(`invented monthly rate: "${monthlyMatch[0]}"`);
        verdict = 'FAIL';
      }
      break;

    case 1: // monthly rate + cash discount
      if (monthlyMatch) {
        hallucinations.push(`invented monthly rate: "${monthlyMatch[0]}"`);
        verdict = 'FAIL';
      } else if (/staff|whatsapp|contact|check with|ask/.test(r)) {
        // good - deferred
      } else {
        issues.push('did not defer monthly rate to staff');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (/cash|discount/.test(r)) {
        // acknowledged
      } else {
        issues.push('did not acknowledge cash discount question');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;

    case 2: // payment methods
      const methods = ['maybank', 'duitnow', 'boost', 'grabpay', 'shopeepay', "touch", 'tng', "cash"];
      const hits = methods.filter(m => r.includes(m));
      if (hits.length >= 3) {
        // good
      } else if (hits.length >= 1) {
        issues.push(`mentioned only ${hits.length} payment method(s): ${hits.join(', ')}`);
        verdict = 'WEAK';
      } else {
        issues.push('did not list payment methods');
        verdict = 'FAIL';
      }
      // Specifically should confirm DuitNow + Maybank
      if (!r.includes('duitnow')) {
        issues.push('did not confirm DuitNow');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      if (!r.includes('maybank')) {
        issues.push('did not confirm Maybank');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      // Incorrect claim: TnG only
      if (/only.*tng|only.*touch|must.*tng|must.*touch/.test(r)) {
        hallucinations.push('claimed TnG is mandatory');
        verdict = 'FAIL';
      }
      break;

    case 3: // noise complaint
      // Should escalate, NOT promise to fix
      if (/i.?ll (handle|fix|take care|sort|stop|deal)|i will (handle|fix|take care|sort|stop|deal)|i can stop/.test(r)) {
        hallucinations.push('AI promised to personally fix the noise (should escalate)');
        verdict = 'FAIL';
      }
      if (/staff|escalat|report|inform|let.*know|pass.*on|whatsapp|contact/.test(r)) {
        // good - escalating
      } else {
        issues.push('did not offer to escalate to staff');
        verdict = 'FAIL';
      }
      if (/10 ?pm|22:00|quiet hour|after 10/.test(r)) {
        // acknowledged policy
      } else {
        issues.push('did not mention 10pm quiet hour policy');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;

    case 4: // laundry
      if (/laundry|washing|washer|wash/.test(r)) {
        // acknowledged
      } else {
        issues.push('did not address laundry');
        verdict = 'FAIL';
      }
      // Price - if invented without KB backing would be hallucination; let's look for RMxx per load patterns
      const laundryPriceRegex = /rm\s?\d{1,3}\s?(per load|\/load|\/wash|per wash)/i;
      const lpm = reply.match(laundryPriceRegex);
      if (lpm) {
        // could be valid from facilities-common.md; flag for review (not auto-fail)
        issues.push(`stated laundry price: "${lpm[0]}" — verify against KB`);
      }
      break;

    case 5: // extend + deposit
      if (/staff|whatsapp|contact|message|book|self.?service|renew/.test(r)) {
        // good
      } else {
        issues.push('did not explain how to extend');
        verdict = 'WEAK';
      }
      if (/deposit/.test(r)) {
        // acknowledged
      } else {
        issues.push('did not address deposit question');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;

    case 6: // invoice lookup
      // AI does NOT have invoice access in preview
      if (/i (can|will) (check|look|pull|find|retrieve) (your|the) (invoice|bill|statement)|let me (check|pull|look).*(invoice|bill)/.test(r)) {
        hallucinations.push('AI claimed to look up invoice (no invoice access in preview)');
        verdict = 'FAIL';
      }
      if (/staff|whatsapp|contact|reception|cannot access|don.?t have access|unable to/.test(r)) {
        // good - deferred
      } else {
        issues.push('did not defer invoice lookup to staff');
        verdict = 'WEAK';
      }
      break;

    case 7: // friendly close + noise message
      // Should politely invite re-contact via staff / WhatsApp
      if (/anytime|sure|yes|of course|feel free|message|whatsapp|staff/.test(r)) {
        // good
      } else {
        issues.push('weak closing');
        verdict = 'WEAK';
      }
      // Should NOT claim personal 24/7 availability as a human fixer
      if (/i.?ll come|i will come|i can come over/.test(r)) {
        hallucinations.push('AI implied physical presence');
        verdict = 'FAIL';
      }
      break;
  }

  return { verdict, issues, hallucinations };
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
        issues: ['server error' + (err ? ': ' + err : '')],
        hallucinations: []
      });
      continue;
    }

    const reply = resp.message;
    const { verdict, issues, hallucinations } = grade(i, reply);
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
      issues,
      hallucinations
    });

    history.push({ role: 'user', content: msg });
    history.push({ role: 'assistant', content: reply });
  }

  const pass = results.filter(r => r.verdict === 'PASS').length;
  const weak = results.filter(r => r.verdict === 'WEAK').length;
  const fail = results.filter(r => r.verdict === 'FAIL').length;
  const avgLatencyMs = latCount ? Math.round(totalLat / latCount) : null;
  const allHallucinations = results.flatMap(r => (r.hallucinations || []).map(h => `T${r.turn}: ${h}`));

  const out = {
    persona: 'unclelim-longterm',
    sessionId,
    startedAt,
    turns: results,
    summary: { pass, weak, fail, avgLatencyMs, hallucinations: allHallucinations }
  };

  const fname = `unclelim-longterm-${Date.now()}.json`;
  const dir = 'C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai/reports/guest-sims';
  const fpath = path.join(dir, fname);
  fs.writeFileSync(fpath, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE:' + fpath);
  console.log('SUMMARY:' + JSON.stringify(out.summary));
  for (const r of results) {
    console.log(`T${r.turn} [${r.verdict}] intent=${r.intent} conf=${r.confidence} lat=${r.responseTime}ms`);
    console.log(`  Q: ${r.message}`);
    console.log(`  A: ${(r.reply || '').slice(0, 500).replace(/\n/g, ' ')}`);
    if (r.issues.length) console.log(`  ISSUES: ${r.issues.join(' | ')}`);
    if ((r.hallucinations || []).length) console.log(`  HALLUC: ${r.hallucinations.join(' | ')}`);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
