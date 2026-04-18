import fs from "node:fs";
const file = "C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai/reports/guest-sims/rizwan-visarun-1776420697302.json";
const j = JSON.parse(fs.readFileSync(file, "utf8"));

const FALLBACK = /i'?m sorry, i didn't quite understand|could you rephrase/i;

for (const t of j.turns) {
  const r = (t.assistant || "").toLowerCase();
  const issues = [...(t.issues || [])];
  let grade = t.grade;

  if (FALLBACK.test(t.assistant)) {
    grade = "WEAK";
    if (!issues.includes("fallback 'didn't understand' - no answer provided")) {
      issues.push("fallback 'didn't understand' - no answer provided");
    }
  }

  // Turn 1: claims "almost always available" and says "we should definitely have a capsule"
  // Without checking inventory - this is a soft hallucination of availability
  if (t.turn === 1 && /almost always available|definitely have a capsule/i.test(t.assistant)) {
    grade = "WEAK";
    if (!issues.includes("asserts availability without checking dates/inventory")) {
      issues.push("asserts availability without checking dates/inventory");
    }
  }

  // Turn 4: claims "Late checkout is free" - KB says typically extra fee
  if (t.turn === 4 && /late checkout is free/i.test(t.assistant)) {
    grade = "FAIL";
    if (!issues.includes("claims 'late checkout is free' - contradicts KB (typically extra fee)")) {
      issues.push("claims 'late checkout is free' - contradicts KB (typically extra fee)");
    }
  }

  t.grade = grade;
  t.issues = issues;
}

const pass = j.turns.filter(x => x.grade === "PASS").length;
const weak = j.turns.filter(x => x.grade === "WEAK").length;
const fail = j.turns.filter(x => x.grade === "FAIL").length;
j.summary.pass = pass; j.summary.weak = weak; j.summary.fail = fail;

fs.writeFileSync(file, JSON.stringify(j, null, 2), "utf8");
console.log(`PASS=${pass} WEAK=${weak} FAIL=${fail}`);
for (const t of j.turns) console.log(`T${t.turn} ${t.grade} :: ${t.issues.join("; ") || "ok"}`);
