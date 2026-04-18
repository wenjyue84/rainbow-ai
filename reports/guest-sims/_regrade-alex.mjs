// Regrade the most recent alex run with stricter fallback detection.
import fs from 'node:fs';
import path from 'node:path';

const dir = 'C:/Users/Jyue/Documents/1-projects/Software Projects/rainbow-ai/reports/guest-sims';
const files = fs.readdirSync(dir).filter(f => f.startsWith('alex-backpacker-') && f.endsWith('.json'));
files.sort();
const latest = files[files.length - 1];
const fp = path.join(dir, latest);
const data = JSON.parse(fs.readFileSync(fp, 'utf8'));

const FALLBACK = /didn.?t quite understand|could you rephrase|rephrase your question/i;

function grade(turnIdx, reply) {
  const r = (reply || '').toLowerCase();
  const issues = [];
  let verdict = 'PASS';

  if (!reply || reply.trim().length === 0) {
    return { verdict: 'FAIL', issues: ['empty reply'] };
  }

  if (FALLBACK.test(reply)) {
    return { verdict: 'FAIL', issues: ['fallback reply — bot did not understand / no KB retrieval'] };
  }

  switch (turnIdx) {
    case 0:
      if (!/pelangi|welcome|hello|hi|jb|johor|capsule/.test(r)) {
        issues.push('no welcome/acknowledgement');
        verdict = 'WEAK';
      }
      break;
    case 1:
      if (!r.includes('ilovestaycapsule')) {
        issues.push('did not provide wifi password ilovestaycapsule');
        verdict = 'FAIL';
      }
      if (!/pelangi/.test(r)) {
        issues.push('did not mention SSID Pelangi');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 2:
      if (r.includes('1270')) {
        // good
      } else if (/keypad|door code|access code|pin|self.?check/.test(r)) {
        issues.push('mentioned keypad/code but no 1270');
        verdict = 'WEAK';
      } else {
        issues.push('did not explain self-check-in/door code');
        verdict = 'FAIL';
      }
      break;
    case 3:
      if (!r.includes('1270')) {
        issues.push('did not confirm door code 1270#');
        verdict = 'WEAK';
      }
      if (!/late|1 ?am|anytime|24|self/.test(r)) {
        issues.push('did not address late arrival');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 4:
      if (/family room|private room|suite/.test(r)) {
        issues.push('mentioned room types that do not exist (capsules only)');
        verdict = 'FAIL';
        break;
      }
      if (!/assign|pod|capsule|number|whatsapp|staff|check.?in|booking/.test(r)) {
        issues.push('did not explain capsule assignment');
        verdict = 'WEAK';
      }
      break;
    case 5:
      if (/breakfast.*(included|provided|served)/.test(r) && !/not.*(included|provided|served)/.test(r)) {
        issues.push('WRONG: implied breakfast is included');
        verdict = 'FAIL';
      } else if (!/not included|no breakfast|doesn.?t include|isn.?t included|not provide/.test(r)) {
        issues.push('did not clearly state breakfast not included');
        verdict = 'WEAK';
      }
      if (!/kitchen|kopitiam|roti|mamak|nearby|restaurant|food/.test(r)) {
        issues.push('did not suggest food options');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 6:
      // Checkout is 11am (or 12pm for some rates). Bot said 12 noon.
      if (/11 ?(am|:00)/.test(r) || /12:00 ?pm|12 ?noon|noon/.test(r)) {
        // acceptable but note
        if (/12/.test(r) && !/11/.test(r)) {
          issues.push('gave 12pm only — standard checkout is 11am (12pm only for some rates)');
          verdict = 'WEAK';
        }
      } else {
        issues.push('did not state checkout time correctly');
        verdict = 'FAIL';
      }
      if (!/luggage|bag|storage|store|keep/.test(r)) {
        issues.push('did not address luggage storage');
        if (verdict === 'PASS') verdict = 'WEAK';
      } else if (/don.?t have|connect you with|no information/.test(r) && /luggage|bag|storage/.test(r)) {
        issues.push('deflected luggage storage question to staff');
        if (verdict === 'PASS') verdict = 'WEAK';
      }
      break;
    case 7:
      // Ground truth: after 10pm. Bot said 11pm-9am => WRONG.
      if (/11 ?pm|23:00|2300/.test(r) && !/10 ?pm/.test(r)) {
        issues.push('WRONG quiet-hours start: said 11pm but ground truth is 10pm');
        verdict = 'FAIL';
      } else if (/10 ?pm|22:00|2200|after 10/.test(r)) {
        // correct
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

let pass = 0, weak = 0, fail = 0;
for (const t of data.turns) {
  const { verdict, issues } = grade(t.turn - 1, t.reply);
  t.verdict = verdict;
  t.issues = issues;
  if (verdict === 'PASS') pass++;
  else if (verdict === 'WEAK') weak++;
  else fail++;
}
data.summary.pass = pass;
data.summary.weak = weak;
data.summary.fail = fail;

fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
console.log('REGRADED:' + fp);
console.log('SUMMARY:' + JSON.stringify(data.summary));
for (const r of data.turns) {
  console.log(`T${r.turn} [${r.verdict}] intent=${r.intent} conf=${r.confidence}`);
  console.log(`  Q: ${r.message}`);
  console.log(`  A: ${(r.reply || '').slice(0, 300).replace(/\n/g, ' ')}`);
  if (r.issues.length) console.log(`  ISSUES: ${r.issues.join(' | ')}`);
}
