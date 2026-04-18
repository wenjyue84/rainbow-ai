// Import the ACTUAL translator used in production
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/config-db.ts', 'utf-8');
const m = src.match(/pool\.query\(`([\s\S]*?)`\)/);
const raw = m[1];

// Replicate the exact translator from src/lib/db.ts
function translatePgToSqlite(sql) {
  let out = sql;
  out = out.replace(/\$(\d+)/g, '?');
  out = out.replace(/::[a-zA-Z_][a-zA-Z0-9_]*(\s*\[\s*\])?/g, '');
  out = out.replace(/\bILIKE\b/gi, 'LIKE');
  out = out.replace(
    /\bgen_random_uuid\s*\(\s*\)/gi,
    "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random())%4+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))",
  );
  out = out.replace(/\bBIGSERIAL\b/gi, 'INTEGER');
  out = out.replace(/\bSERIAL\b/gi, 'INTEGER');
  out = out.replace(/\bTIMESTAMPTZ\b/gi, 'TEXT');
  out = out.replace(/\bTIMESTAMP\s+WITH\s+TIME\s+ZONE\b/gi, 'TEXT');
  out = out.replace(/\bJSONB\b/gi, 'TEXT');
  out = out.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  out = out.replace(/\bVARCHAR\b/gi, 'TEXT');
  out = out.replace(/\bUUID\b/gi, 'TEXT');
  out = out.replace(/\bBOOLEAN\b/gi, 'INTEGER');
  out = out.replace(/\bNOW\s*\(\s*\)/gi, "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  out = out.replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, 'ADD COLUMN');
  out = out.replace(/\bCREATE\s+INDEX\s+CONCURRENTLY\b/gi, 'CREATE INDEX');
  out = out.replace(/\bCREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY\b/gi, 'CREATE UNIQUE INDEX');
  out = out.replace(/\bALTER\s+TABLE\s+\S+\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\S+\s*;?/gi, '-- (dropped)');
  out = out.replace(
    /\bALTER\s+TABLE\s+(\w+)\s+((?:ADD\s+COLUMN\s+[^;]+?)(?:\s*,\s*ADD\s+COLUMN\s+[^;]+?)+)\s*(;|$)/gi,
    (_m, table, clauses, term) => {
      const parts = clauses.split(/\s*,\s*(?=ADD\s+COLUMN\b)/i);
      return parts.map(p => `ALTER TABLE ${table} ${p.trim()}`).join(';\n') + term;
    },
  );
  return out;
}

const translated = translatePgToSqlite(raw);

console.log('--- TRANSLATED (ALTER lines only) ---');
translated.split('\n').forEach((line, i) => {
  if (/ALTER\s+TABLE/i.test(line)) console.log(String(i).padStart(4), line.trim());
});

console.log('\n--- SPLIT RESULT ---');
const statements = translated.split(/;\s*(?=\S|$)/).map(s => s.trim()).filter(s => s.length > 0 && !/^--/.test(s));
console.log('Total:', statements.length);
statements.forEach((s, i) => {
  console.log(`\n=== STMT ${i} (${s.length} chars) ===`);
  console.log(s.slice(0, 300));
});
