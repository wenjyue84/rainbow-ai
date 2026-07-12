#!/usr/bin/env node
/**
 * rainbow-go-aci.mjs — Agent Computer Interface for Rainbow AI go-core
 *
 * Lets an LLM agent discover, gap-analyse, and regression-test the Go admin
 * binary (go-core/rainbow-core.exe) through structured JSON — without a browser
 * and without touching the production box (5.223.54.57:3003).
 *
 * Usage (from repo root):
 *   node scripts/aci/rainbow-go-aci.mjs describe
 *   node scripts/aci/rainbow-go-aci.mjs status
 *   node scripts/aci/rainbow-go-aci.mjs worklist
 *   node scripts/aci/rainbow-go-aci.mjs test --suite=all
 *   node scripts/aci/rainbow-go-aci.mjs test --suite=implemented
 *   node scripts/aci/rainbow-go-aci.mjs test --suite=contract
 *
 * Env:
 *   ACI_PORT   — port for the ephemeral go-core instance (default 9099)
 *   BASE_URL   — target an ALREADY RUNNING go-core instead of spawning one
 *
 * JSON goes to stdout (agents parse it); progress goes to stderr (humans watch).
 * Exit codes: 0 = pass, 1 = fail, 2 = usage error.
 */

import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const GO_CORE   = path.join(ROOT, 'go-core');
const ACI_PORT  = Number(process.env.ACI_PORT  || 9099);
const BASE_URL  = process.env.BASE_URL || null;
const IS_WIN    = process.platform === 'win32';
const ADMIN_KEY = 'aci-test-key';

// Binary name differs by OS
const BINARY = IS_WIN
  ? path.join(GO_CORE, 'rainbow-core.exe')
  : path.join(GO_CORE, 'rainbow-core-linux');

// Temp SQLite file created fresh per run, deleted in finally.
const TEMP_DB = path.join(tmpdir(), `rainbow-go-aci-${Date.now()}.db`);

// The implemented endpoints and the key field to assert in each body. This is the
// regression guard for every fatal dashboard-tab load endpoint ported into go-core.
const IMPLEMENTED = [
  { path: '/api/rainbow/status',                              keyField: 'servers'        },
  { path: '/api/rainbow/stats',                               keyField: 'messages'       },
  { path: '/api/rainbow/conversations',                       keyField: 'conversations'  },
  { path: '/api/rainbow/settings',                            keyField: 'ai'             }, // structured settings.json (not the old KV wrapper)
  { path: '/api/rainbow/routing',                             keyField: null             }, // JSON file pass-through, no fixed key
  { path: '/api/rainbow/conversations/any-phone/messages',    keyField: 'messages'       },
  // Fatal per-tab load endpoints ported 2026-07-12 (config passthrough + stubs).
  { path: '/api/rainbow/intents',                             keyField: 'categories'     },
  { path: '/api/rainbow/knowledge',                           keyField: 'static'         },
  { path: '/api/rainbow/templates',                           keyField: null             }, // dynamic top-level keys
  { path: '/api/rainbow/workflows',                           keyField: 'workflows'      },
  { path: '/api/rainbow/workflow',                            keyField: 'escalation'     },
  { path: '/api/rainbow/admin-notifications',                 keyField: 'operators'      },
  { path: '/api/rainbow/intent-manager/keywords',             keyField: 'intents'        },
  { path: '/api/rainbow/intent-manager/examples',             keyField: 'intents'        },
  { path: '/api/rainbow/profiles',                            keyField: 'profiles'       },
  { path: '/api/rainbow/profiles/active',                     keyField: 'id'             },
  { path: '/api/rainbow/feedback/stats',                      keyField: 'stats'          },
  { path: '/api/rainbow/intent/accuracy',                     keyField: 'accuracy'       },
];

// ─── describe ────────────────────────────────────────────────────────────────

const DESCRIBE = {
  app: 'rainbow-go-aci',
  summary:
    'Deterministic ACI for the Rainbow AI go-core admin binary. ' +
    'Spawns rainbow-core.exe on a throwaway SQLite DB (port ' + ACI_PORT + '), ' +
    'tests its 6 implemented /api/rainbow/* endpoints, and computes the gap to ' +
    'the full ~40-endpoint surface the admin SPA expects. ' +
    'NEVER touches the production box (5.223.54.57:3003).',
  stack: 'Go binary (go-core/rainbow-core.exe), SQLite temp DB, no Node deps',
  commands: {
    describe:
      'this catalog — start here',
    status:
      'build binary if missing, spawn go-core, GET /health, report version info, kill',
    worklist:
      'gap analysis: parse all /api/rainbow/* paths from src/public/js, probe each against ' +
      'a live go-core instance, output JSON {implemented, missing, counts} to stdout and a ' +
      'per-tab table to stderr',
    'test --suite=<name>|all':
      'deterministic PASS/FAIL (suites: implemented, contract, all)',
  },
  suites: {
    implemented:
      'The 6 implemented endpoints each return 200 with key; assert a key field in each body. ~15s',
    contract:
      '/health 200 unauth; each implemented endpoint returns 401 without key; malformed key → 401. ~15s',
  },
  exitCodes: { 0: 'all pass', 1: 'failures', 2: 'usage error' },
  guardrails: [
    'NEVER point BASE_URL at production (5.223.54.57:3003) — write endpoints are not tested but read endpoints may expose data.',
    'Uses a throwaway SQLite temp file in os.tmpdir(), deleted in finally.',
    'Port 3003 (prod) and 8090 (default go-core dev) belong to the user; the ACI owns ' + ACI_PORT + ' only.',
    'Does NOT modify any go-core source or other files except the temp SQLite DB.',
    'The MISSING endpoint list is the known-red worklist — those endpoints are NOT test failures.',
    'Binary: go-core/rainbow-core.exe (Windows) — built with `go build -o rainbow-core.exe ./cmd/rainbow-core` from go-core/.',
  ],
  ports: {
    aci:        ACI_PORT,
    goCoreDev:  8090,
    prod:       3003,
  },
  dataDir: 'src/assistant/data (relative to repo root)',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const results  = [];
const skipped  = [];

function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  process.stderr.write(`  ${pass ? '✓' : '✗'} ${label}${pass ? '' : ` — ${detail}`}\n`);
  return pass;
}

function checkEqual(label, actual, expected) {
  return check(label, actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function note(msg) {
  process.stderr.write(`${msg}\n`);
}

function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
}

function usageError(msg) {
  process.stdout.write(JSON.stringify({
    error: msg,
    hint: 'run: node scripts/aci/rainbow-go-aci.mjs describe',
  }) + '\n');
  process.exit(2);
}

async function fetchJSON(url, init = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(t);
  }
}

// ─── ephemeral go-core server ────────────────────────────────────────────────

let serverProc = null;
let serverBase = null;

/**
 * Seed the temp SQLite file with the tables go-core needs.
 * Uses better-sqlite3 (already in rainbow-ai node_modules) via spawnSync
 * from ROOT so node_modules resolves correctly.
 */
function seedTempDb() {
  const ddl = `
CREATE TABLE IF NOT EXISTS rainbow_conversations (
  phone TEXT PRIMARY KEY NOT NULL,
  bsuid TEXT,
  push_name TEXT DEFAULT '' NOT NULL,
  instance_id TEXT,
  profile_id TEXT DEFAULT 'pelangi',
  pinned INTEGER DEFAULT 0 NOT NULL,
  favourite INTEGER DEFAULT 0 NOT NULL,
  last_read_at INTEGER,
  response_mode TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  contact_details_json TEXT,
  context_summary TEXT,
  context_summary_at INTEGER,
  referral_ctwa_clid TEXT,
  referral_source_id TEXT,
  referral_source_type TEXT,
  referral_headline TEXT,
  referral_body TEXT,
  referral_json TEXT,
  opt_in_method TEXT,
  opt_in_at INTEGER,
  opt_in_channel TEXT,
  whatsapp_opted_in INTEGER DEFAULT 0 NOT NULL,
  whatsapp_opted_in_at INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS rainbow_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  intent TEXT,
  confidence REAL,
  action TEXT,
  manual INTEGER,
  source TEXT,
  model TEXT,
  response_time_ms INTEGER,
  kb_files_json TEXT,
  message_type TEXT,
  routed_action TEXT,
  workflow_id TEXT,
  step_id TEXT,
  usage_json TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  staff_name TEXT,
  transcribed INTEGER,
  media_url TEXT,
  local_media_url TEXT,
  faithfulness_score REAL,
  profile_id TEXT DEFAULT 'pelangi',
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS rainbow_conversation_state (
  phone TEXT PRIMARY KEY NOT NULL,
  push_name TEXT NOT NULL,
  language TEXT DEFAULT 'en' NOT NULL,
  booking_state_json TEXT,
  workflow_state_json TEXT,
  active_flow_json TEXT,
  unknown_count INTEGER DEFAULT 0 NOT NULL,
  last_intent TEXT,
  last_intent_confidence REAL,
  last_intent_timestamp INTEGER,
  slots_json TEXT,
  repeat_count INTEGER DEFAULT 0 NOT NULL,
  profile_id TEXT DEFAULT 'pelangi',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_active_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_user_message_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
`;
  const script = `
const db = require('better-sqlite3')(${JSON.stringify(TEMP_DB)});
db.pragma('journal_mode = WAL');
db.exec(${JSON.stringify(ddl)});
db.close();
console.log('seeded');
`.replace(/\n/g, ' ');

  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (r.status !== 0) {
    throw new Error(`DB seed failed: ${r.stderr || r.stdout}`);
  }
}

function ensureBinary() {
  if (existsSync(BINARY)) return true;
  note(`Binary not found at ${BINARY} — building …`);
  const out = IS_WIN ? 'rainbow-core.exe' : 'rainbow-core-linux';
  const r = spawnSync('go', ['build', '-o', out, './cmd/rainbow-core'], {
    cwd: GO_CORE,
    shell: IS_WIN,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    throw new Error(`go build failed (exit ${r.status}) — is Go installed?`);
  }
  return existsSync(BINARY);
}

async function ensureServer() {
  if (serverBase) return serverBase;

  if (BASE_URL) {
    if (/5\.223\.54\.57/.test(BASE_URL)) {
      throw new Error('Refusing to run against production BASE_URL (5.223.54.57)');
    }
    const ping = await fetchJSON(`${BASE_URL}/health`, {}, 3_000).catch(() => null);
    if (!ping || ping.status !== 200) {
      throw new Error(`BASE_URL ${BASE_URL} is not answering /health`);
    }
    serverBase = BASE_URL;
    note(`Reusing existing server at ${serverBase}`);
    return serverBase;
  }

  ensureBinary();

  const dataDir = path.join(ROOT, 'src', 'assistant', 'data');

  note(`Seeding temp SQLite at ${TEMP_DB} …`);
  seedTempDb();

  note(`Booting go-core on :${ACI_PORT} (temp DB: ${TEMP_DB}) …`);
  serverProc = spawn(BINARY, [], {
    cwd: GO_CORE,
    env: {
      ...process.env,
      CORE_PORT:         String(ACI_PORT),
      RAINBOW_ADMIN_KEY: ADMIN_KEY,
      RAINBOW_DATA_DIR:  dataDir,
      SQLITE_PATH:       TEMP_DB,
      BRIDGE_URL:        'http://127.0.0.1:1',   // unused — no real bridge
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bootLog = '';
  serverProc.stdout.on('data', d => { bootLog += d; });
  serverProc.stderr.on('data', d => { bootLog += d; });
  serverProc.on('exit', code => {
    if (!serverBase) note(`[go-core exited early, code ${code}]\n${bootLog.slice(-2000)}`);
  });

  const base     = `http://127.0.0.1:${ACI_PORT}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    // Detect fatal bind errors immediately from log
    if (/bind:.*address.*in use|only one usage.*socket|bind:.*permission/i.test(bootLog)) {
      throw new Error(
        `go-core failed to bind :${ACI_PORT} — port in use or permission denied.\n` +
        `Kill the occupant or set ACI_PORT=<free port>.\nTail:\n${bootLog.slice(-2000)}`
      );
    }
    if (serverProc.exitCode !== null) {
      throw new Error(
        `go-core exited during boot (code ${serverProc.exitCode}). Tail:\n${bootLog.slice(-2000)}`
      );
    }
    // Require BOTH the log line AND a successful HTTP ping — log line alone is
    // not enough because the server may exit immediately after logging it
    // (e.g. another process was already on the port and the bind failed).
    if (/listening on/i.test(bootLog)) {
      const ping = await fetchJSON(`${base}/health`, {}, 2_000).catch(() => null);
      if (ping && ping.status === 200) {
        serverBase = base;
        note('go-core ready.');
        return serverBase;
      }
    } else {
      const ping = await fetchJSON(`${base}/health`, {}, 1_000).catch(() => null);
      if (ping && ping.status === 200) {
        serverBase = base;
        note('go-core ready (HTTP ping).');
        return serverBase;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`go-core did not become healthy within 30s. Tail:\n${bootLog.slice(-2000)}`);
}

function killServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(serverProc.pid), '/T', '/F'], { shell: true });
  } else {
    serverProc.kill('SIGKILL');
  }
}

function cleanupTemp() {
  try { if (existsSync(TEMP_DB)) rmSync(TEMP_DB); } catch { /* best-effort */ }
}

// ─── worklist: gap analysis ──────────────────────────────────────────────────

/**
 * Parse every distinct /api/rainbow/<path> from src/public/js/**\/*.js.
 * The JS uses window.api(relPath) where relPath is a string like '/status',
 * '/conversations', '/intents', etc. These get prefixed with /api/rainbow.
 * We collect both the full /api/rainbow/… strings and the relative-path
 * window.api() arguments (prefixing the latter).
 *
 * Normalisation rules:
 *   - strip query strings (?...)
 *   - collapse template-literal dynamic segments (/${...} → /{id})
 *   - strip trailing slash
 *   - dedupe
 */
function parseSpaEndpoints() {
  const jsDir = path.join(ROOT, 'src', 'public', 'js');
  if (!existsSync(jsDir)) return [];

  const files = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.js')) files.push(full);
    }
  }
  walk(jsDir);

  const raw = new Set();

  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }

    // 1. Literal /api/rainbow/... strings in source
    for (const m of src.matchAll(/\/api\/rainbow\/[A-Za-z0-9/_\-]+/g)) {
      raw.add(m[0]);
    }

    // 2. window.api('/relative') or api('/relative') calls — prefix with /api/rainbow
    for (const m of src.matchAll(/\bapi\s*\(\s*'(\/[^']+)'/g)) {
      raw.add('/api/rainbow' + m[1]);
    }
    for (const m of src.matchAll(/\bapi\s*\(\s*"(\/[^"]+)"/g)) {
      raw.add('/api/rainbow' + m[1]);
    }

    // 3. loadMultipleConfigs(['name', ...]) — each name → /api/rainbow/<name>
    for (const m of src.matchAll(/loadMultipleConfigs\s*\(\s*\[([^\]]+)\]/g)) {
      const inner = m[1];
      for (const nm of inner.matchAll(/'([^']+)'/g)) {
        raw.add('/api/rainbow/' + nm[1]);
      }
      for (const nm of inner.matchAll(/"([^"]+)"/g)) {
        raw.add('/api/rainbow/' + nm[1]);
      }
    }
  }

  // Normalise
  const seen = new Set();
  const out = [];
  for (const p of raw) {
    let n = p;
    // strip query strings
    n = n.replace(/\?.*$/, '');
    // collapse template-literal dynamic segments: /${...}/rest → /{id}/rest
    n = n.replace(/\/\$\{[^}]*\}/g, '/{id}');
    // strip trailing slash
    n = n.replace(/\/+$/, '');
    if (!n || n === '/api/rainbow') continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort();
}

/**
 * Map an endpoint path to the closest dashboard tab keyword.
 */
function tabFor(ep) {
  const p = ep.toLowerCase();
  if (/\/conversations|\/real-chat|\/webchat|\/whatsapp/.test(p)) return 'conversations';
  if (/\/intent-manager/.test(p))                                   return 'intent-manager';
  if (/\/intents|\/intent\//.test(p))                               return 'intents';
  if (/\/knowledge|\/kb/.test(p))                                    return 'knowledge';
  if (/\/templates|\/responses/.test(p))                            return 'responses';
  if (/\/settings|\/providers|\/mcp/.test(p))                       return 'settings';
  if (/\/analytics|\/performance|\/feedback/.test(p))               return 'performance';
  if (/\/testing|\/autotest|\/test/.test(p))                        return 'testing';
  if (/\/workflow/.test(p))                                         return 'workflow';
  if (/\/dashboard|\/status|\/stats/.test(p))                       return 'dashboard';
  if (/\/routing/.test(p))                                          return 'settings';
  if (/\/admin\//.test(p))                                          return 'other';
  if (/\/activity/.test(p))                                         return 'dashboard';
  if (/\/understanding/.test(p))                                    return 'understanding';
  return 'other';
}

async function cmdWorklist() {
  note('Parsing SPA endpoints from src/public/js/**/*.js …');
  const allEndpoints = parseSpaEndpoints();
  note(`  Found ${allEndpoints.length} distinct normalised endpoints.`);

  note(`Spawning go-core on :${ACI_PORT} for gap probe …`);
  let base;
  try {
    base = await ensureServer();
  } catch (e) {
    emit({ error: e.message }, 1);
  }

  const implementedList = [];
  const missingList     = [];
  const otherList       = [];

  for (const ep of allEndpoints) {
    const url = base + ep;
    let result;
    try {
      result = await fetchJSON(url, { headers: { 'X-Admin-Key': ADMIN_KEY } }, 5_000);
    } catch {
      result = { status: -1 };
    }
    const s = result.status;
    if (s === 200 || s === 401) {
      // 401 here means auth guard fired → endpoint exists (implemented)
      implementedList.push(ep);
    } else if (s === 404) {
      missingList.push({ endpoint: ep, tab: tabFor(ep) });
    } else {
      otherList.push({ endpoint: ep, status: s });
    }
  }

  killServer();

  // per-tab breakdown
  const byTab = {};
  for (const m of missingList) {
    if (!byTab[m.tab]) byTab[m.tab] = [];
    byTab[m.tab].push(m.endpoint);
  }

  // stderr human-readable table
  note('\n── Missing endpoints by tab ──────────────────────────────────────────');
  const tabs = Object.keys(byTab).sort();
  for (const tab of tabs) {
    note(`\n  [${tab}]`);
    for (const ep of byTab[tab]) {
      note(`    • ${ep}`);
    }
  }
  if (otherList.length) {
    note('\n  [unexpected status (not 200/401/404)]');
    for (const x of otherList) note(`    • ${x.endpoint}  → HTTP ${x.status}`);
  }
  note('\n─────────────────────────────────────────────────────────────────────');
  note(`  Implemented: ${implementedList.length}  Missing: ${missingList.length}  Total: ${allEndpoints.length}`);

  emit({
    implemented: implementedList,
    missing:     missingList,
    other:       otherList,
    counts: {
      implemented: implementedList.length,
      missing:     missingList.length,
      total:       allEndpoints.length,
    },
  });
}

// ─── suites ──────────────────────────────────────────────────────────────────

async function suiteImplemented() {
  note('\n-- suite: implemented (6 endpoints → 200 + key field) --');
  const base = await ensureServer();

  for (const { path: ep, keyField } of IMPLEMENTED) {
    const url  = base + ep;
    const res  = await fetchJSON(url, { headers: { 'X-Admin-Key': ADMIN_KEY } }, 10_000)
      .catch(e => ({ status: -1, data: null, error: e.message }));

    checkEqual(`GET ${ep} → 200`, res.status, 200);
    if (keyField !== null) {
      check(
        `GET ${ep} body has "${keyField}" field`,
        res.data != null && keyField in res.data,
        `body: ${JSON.stringify(res.data).slice(0, 200)}`
      );
    }
  }
}

async function suiteContract() {
  note('\n-- suite: contract (health unauth; 401 without key; malformed key → 401) --');
  const base = await ensureServer();

  // /health must be 200 with NO key
  const health = await fetchJSON(`${base}/health`, {}, 5_000)
    .catch(e => ({ status: -1, error: e.message }));
  checkEqual('/health → 200 (unauthenticated)', health.status, 200);

  // each implemented endpoint must return 401 WITHOUT the key
  for (const { path: ep } of IMPLEMENTED) {
    const res = await fetchJSON(base + ep, {}, 5_000)
      .catch(e => ({ status: -1, error: e.message }));
    checkEqual(`GET ${ep} without key → 401`, res.status, 401);
  }

  // malformed / wrong key must also return 401
  for (const { path: ep } of IMPLEMENTED.slice(0, 2)) {
    const res = await fetchJSON(base + ep, {
      headers: { 'X-Admin-Key': 'wrong-key-xyz' },
    }, 5_000).catch(e => ({ status: -1, error: e.message }));
    checkEqual(`GET ${ep} with wrong key → 401`, res.status, 401);
  }

  // MISSING endpoints are the known-red worklist — surface them but do NOT fail
  const allEndpoints  = parseSpaEndpoints();
  const knownPaths    = new Set(IMPLEMENTED.map(x => x.path));
  const missingEps    = allEndpoints.filter(ep => !knownPaths.has(ep));
  if (missingEps.length) {
    skipped.push({
      suite:  'contract',
      reason: `${missingEps.length} SPA endpoints not yet ported to go-core (known worklist — not failures)`,
      worklist: missingEps.slice(0, 10).concat(missingEps.length > 10 ? ['…'] : []),
    });
    note(`  (worklist: ${missingEps.length} missing endpoints not tested — run "worklist" command for details)`);
  }
}

// ─── status command ───────────────────────────────────────────────────────────

async function cmdStatus() {
  const goToolchain = spawnSync(IS_WIN ? 'where' : 'which', ['go'],
    { shell: IS_WIN, encoding: 'utf8', timeout: 5_000 }).status === 0;

  const binaryExists = existsSync(BINARY);
  const dataDir = path.join(ROOT, 'src', 'assistant', 'data');

  const status = {
    root:          ROOT,
    binary:        BINARY,
    binaryExists,
    goToolchain,
    dataDir,
    dataDirExists: existsSync(dataDir),
    aciPort:       ACI_PORT,
    prodPortFree:  null,
    health:        null,
  };

  // Is port 3003 (prod) in use? (just informational)
  const prod = await fetchJSON('http://127.0.0.1:3003/health', {}, 1_500).catch(() => null);
  status.prodPortFree = !(prod?.status === 200);

  let spawnedHere = false;
  try {
    const base = await ensureServer();
    spawnedHere = !BASE_URL;
    const h = await fetchJSON(`${base}/health`, {}, 5_000);
    status.health = h.data;
    status.up     = h.status === 200;
  } catch (e) {
    status.up    = false;
    status.error = e.message;
  } finally {
    if (spawnedHere) killServer();
  }

  emit(status, status.up ? 0 : 1);
}

// ─── summarize ───────────────────────────────────────────────────────────────

function summarize() {
  killServer();
  cleanupTemp();
  const passed  = results.filter(r => r.pass).length;
  const failed  = results.length - passed;
  const verdict = {
    passed, failed, total: results.length,
    ok:       failed === 0,
    skipped,
    failures: results.filter(r => !r.pass).map(r => ({ label: r.label, detail: r.detail })),
  };
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  process.exit(failed === 0 ? 0 : 1);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    suite: { type: 'string' },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

process.on('exit',   () => { killServer(); cleanupTemp(); });
process.on('SIGINT', () => { killServer(); cleanupTemp(); process.exit(1); });

const SUITES = {
  implemented: suiteImplemented,
  contract:    suiteContract,
};

switch (command) {
  case 'describe':
    emit(DESCRIBE);
    break;

  case 'status':
    await cmdStatus();
    break;

  case 'worklist':
    await cmdWorklist();
    break;

  case 'test': {
    const name   = flags.suite || 'all';
    const toRun  = name === 'all' ? Object.keys(SUITES) : [name];
    if (toRun.some(s => !SUITES[s])) {
      usageError(`unknown suite "${name}". Valid: ${Object.keys(SUITES).join(', ')}, all`);
    }
    note(`rainbow-go-aci  suites=${toRun.join(',')}  port=${ACI_PORT}${BASE_URL ? `  BASE_URL=${BASE_URL}` : ''}`);
    for (const s of toRun) {
      try {
        await SUITES[s]();
      } catch (e) {
        results.push({ label: `${s}: uncaught`, pass: false, detail: e.message });
        process.stderr.write(`  ✗ suite ${s} threw: ${e.message}\n`);
      }
    }
    summarize();
    break;
  }

  default:
    usageError(
      `unknown command "${command ?? ''}". Commands: describe, status, worklist, test`
    );
}
