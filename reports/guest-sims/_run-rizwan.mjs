// Simulates Rizwan - visa run guest - 8 turns against Rainbow AI preview endpoint
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "http://localhost:3002/api/rainbow/preview/chat";
const ts = Date.now();
const sessionId = `sim-rizwan-${ts}`;
const persona = "rizwan-visarun";
const outDir = "C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai/reports/guest-sims";
const outFile = path.join(outDir, `rizwan-visarun-${ts}.json`);

const turns = [
  "I'm doing a visa run to Singapore tomorrow, staying 1 night. Do you have anything available?",
  "How close are you to JB Sentral / the CIQ checkpoint to Singapore?",
  "Can I check out late, like 2pm, so I can go Singapore in the morning and come back for my bag?",
  "What does late checkout cost?",
  "Can I leave my bag after checkout and pick it up in the evening?",
  "Grab to JB Sentral — cheap or walkable?",
  "Anything I should know about the Causeway for a visa run?",
  "Cool, how do I check in if I arrive at 11pm?",
];

async function callOnce(message, history) {
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, sessionId }),
  });
  const latency = Date.now() - started;
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, latency, body };
}

async function callWithRetry(message, history) {
  try {
    const r = await callOnce(message, history);
    if (r.ok && r.body && (r.body.reply || r.body.message || r.body.response || r.body.text)) return r;
    // retry once
    const r2 = await callOnce(message, history);
    return r2;
  } catch (e) {
    try {
      const r2 = await callOnce(message, history);
      return r2;
    } catch (e2) {
      return { ok: false, status: 0, latency: 0, body: { error: String(e2) } };
    }
  }
}

function extractReply(body) {
  if (!body) return "";
  return body.reply || body.message || body.response || body.text || body.answer || JSON.stringify(body).slice(0, 500);
}

function gradeTurn(idx, userMsg, reply) {
  const r = (reply || "").toLowerCase();
  const issues = [];
  let grade = "PASS";

  // Turn-specific checks
  if (idx === 0) {
    // Availability: should respond about 1-night availability/booking help; should not fabricate live inventory confirmations
    if (!r.length) { grade = "FAIL"; issues.push("empty reply"); }
    if (/\bconfirmed\b.*\bbook/.test(r) || /i[' ]?ve booked/.test(r)) { grade = "WEAK"; issues.push("implies a booking was placed"); }
  }
  if (idx === 1) {
    // Distance to JB Sentral / CIQ - should be walkable / a few minutes (KB typical: ~5-10 min)
    const mentionsWalk = /walk|minute|min\b|near|close/.test(r);
    if (!mentionsWalk) { grade = "WEAK"; issues.push("does not describe walking distance"); }
    // hallucination: should NOT say hostel is in Singapore / Woodlands
    if (/woodlands/.test(r) && !/across|singapore side/.test(r)) { grade = "FAIL"; issues.push("places hostel near Woodlands (wrong side)"); }
    // hallucination: claiming extreme distance
    if (/hour|hours|far away|\b[3-9]0\s*min/.test(r) && !/taxi|drive/.test(r)) { grade = "WEAK"; issues.push("unusually long walking time"); }
  }
  if (idx === 2) {
    // Late checkout possibility - should say subject to availability / extra fee, not a flat free yes
    if (/sure[,.!]?\s*no problem/.test(r) && !/fee|charge|avail/.test(r)) { grade = "WEAK"; issues.push("late checkout promised without mentioning fee/availability"); }
  }
  if (idx === 3) {
    // Late checkout cost - should not invent a specific exact price not in KB; acceptable to say contact front desk / depends
    if (/\brm\s?\d+/.test(r) && !/approx|around|typically|subject|depends|may|contact/.test(r)) {
      issues.push("states a specific late checkout fee - verify against KB");
      grade = "WEAK";
    }
  }
  if (idx === 4) {
    // Luggage storage after checkout - should allow
    if (/cannot|not allowed|no storage|we do not offer/.test(r)) { grade = "WEAK"; issues.push("denies luggage storage which contradicts KB"); }
  }
  if (idx === 5) {
    // Grab cost - cheap/walkable
    if (!/walk|grab|taxi|rm|cheap|few|short/.test(r)) { grade = "WEAK"; issues.push("no transport cost/option guidance"); }
    if (/rm\s?[3-9]0|rm\s?\d{3}/.test(r)) { grade = "WEAK"; issues.push("quoted Grab fare seems too high"); }
  }
  if (idx === 6) {
    // Causeway tips - should not invent specific rules; OK to give peak hours advice
    if (/visa on arrival|visa required|passport not required/.test(r)) { grade = "FAIL"; issues.push("invents visa/border rules"); }
  }
  if (idx === 7) {
    // Late 11pm check-in - should describe self check-in / 24h / contact info
    if (!/24|self|code|contact|whatsapp|front desk|check[- ]?in/.test(r)) { grade = "WEAK"; issues.push("no clear 11pm check-in guidance"); }
  }

  if (!r.length) { grade = "FAIL"; if (!issues.length) issues.push("empty reply"); }
  return { grade, issues };
}

(async () => {
  const history = [];
  const results = [];
  let totalLatency = 0;
  let okCount = 0;

  for (let i = 0; i < turns.length; i++) {
    const userMsg = turns[i];
    const r = await callWithRetry(userMsg, history);
    const reply = extractReply(r.body);
    const g = gradeTurn(i, userMsg, reply);
    totalLatency += r.latency || 0;
    if (r.ok) okCount++;
    results.push({
      turn: i + 1,
      user: userMsg,
      assistant: reply,
      latencyMs: r.latency,
      httpStatus: r.status,
      grade: g.grade,
      issues: g.issues,
    });
    // Accumulate history (user + assistant pair)
    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: reply });
    process.stdout.write(`T${i + 1} [${g.grade}] ${r.latency}ms\n`);
  }

  const pass = results.filter(t => t.grade === "PASS").length;
  const weak = results.filter(t => t.grade === "WEAK").length;
  const fail = results.filter(t => t.grade === "FAIL").length;
  const avgLatencyMs = Math.round(totalLatency / results.length);

  const report = {
    persona,
    sessionId,
    startedAt: new Date(ts).toISOString(),
    turns: results,
    summary: { pass, weak, fail, avgLatencyMs },
  };

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWROTE ${outFile}`);
  console.log(`PASS=${pass} WEAK=${weak} FAIL=${fail} avg=${avgLatencyMs}ms`);
})();
