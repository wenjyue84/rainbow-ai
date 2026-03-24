const fs = require('fs');
// Read original schema from stdin
let orig = '';
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { orig += chunk; });
process.stdin.on('end', () => run(orig));

function run(src) {
  function extractTableBlock(src, varName) {
    const marker = `export const ${varName} = pgTable(`;
    const start = src.indexOf(marker);
    if (start === -1) { process.stderr.write('Not found: ' + varName + '\n'); return ''; }
    let depth = 0;
    let i = start;
    let inPgTable = false;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '`') { i++; while (i < src.length && src[i] !== '`') i++; }
      else if (ch === '"' || ch === "'") {
        const q = ch; i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === '\\') i++;
          i++;
        }
      } else if (ch === '(') { depth++; if (!inPgTable) inPgTable = true; }
      else if (ch === ')') {
        depth--;
        if (inPgTable && depth === 0) { i++; if (src[i] === ';') i++; break; }
      }
      i++;
    }
    return src.substring(start, i);
  }

  function extractTypes(src, tableVar) {
    const results = [];
    const regex = new RegExp(`export type (\\w+) = typeof ${tableVar}\\.\\$infer(Select|Insert);`, 'g');
    let m;
    while ((m = regex.exec(src)) !== null) results.push(m[0]);
    return results;
  }

  function buildModule(header, tableNames) {
    let content = header;
    for (const t of tableNames) {
      const block = extractTableBlock(src, t);
      content += block + '\n\n';
      const hasInline = block.includes('export type') && block.includes('$infer');
      if (!hasInline) {
        const types = extractTypes(src, t);
        if (types.length > 0) content += types.join('\n') + '\n\n';
      }
    }
    return content;
  }

  // conversations.ts
  const convoTables = ['rainbowConversationState','rainbowConversations','rainbowMessages','conversationAudit','messageDeliveryStatus','escalationEvents','conversationTraces','messageQualityMetrics'];
  const convoHdr = '/**\n * conversations.ts — Conversation state, messages, delivery, and escalation tables\n */\nimport { sql } from "drizzle-orm";\nimport { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";\n\n';
  const convoContent = buildModule(convoHdr, convoTables);
  fs.writeFileSync('shared/tables/conversations.ts', convoContent);
  console.log('conversations.ts:', convoContent.split('\n').length, 'lines');

  // messaging.ts
  const msgTables = ['optOuts','llmCostDaily','whatsappCostDaily','baileysAuthState','utteranceGaps','templateQualityEvents','whatsappTemplates','serviceRequests','orderWebhookQueue','scheduledMessagesDb','webhookRawEvents','orderAccuracyEvents','festiveStickers','stickerIntents','campaignPacingEvents','deadLetterQueue'];
  const msgHdr = '/**\n * messaging.ts — Costs, scheduling, templates, stickers, campaigns, and DLQ tables\n */\nimport { sql } from "drizzle-orm";\nimport { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";\n\n';
  const msgContent = buildModule(msgHdr, msgTables);
  fs.writeFileSync('shared/tables/messaging.ts', msgContent);
  console.log('messaging.ts:', msgContent.split('\n').length, 'lines');

  // compliance.ts
  const compTables = ['experimentMetrics','webchatConsentLog','vectorAccessLogs','marketingSubscriptions','mmLiteSends','dpiaRecords','tiaRecords','aiDecisionAudit','promptInjectionEvents','dpaRegistry','einvoiceQueue','profileIsolationViolations','profileIsolationRepairs'];
  const compHdr = '/**\n * compliance.ts — PDPA/GDPR, DPIA, TIA, profile isolation, and security audit tables\n */\nimport { sql } from "drizzle-orm";\nimport { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";\n\n';
  const compContent = buildModule(compHdr, compTables);
  fs.writeFileSync('shared/tables/compliance.ts', compContent);
  console.log('compliance.ts:', compContent.split('\n').length, 'lines');

  // Verify all wrote correctly
  ['conversations','messaging','compliance'].forEach(f => {
    const c = fs.readFileSync(`shared/tables/${f}.ts`, 'utf8');
    const firstTable = (c.match(/export const (\w+) = pgTable/) || ['','?'])[1];
    console.log(`OK ${f}.ts: ${c.split('\n').length} lines, first table: ${firstTable}`);
  });
}
