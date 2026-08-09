#!/usr/bin/env node
/**
 * Rainbow AI ACI — Agent Computer Interface test harness
 *
 * Lets an LLM agent discover, query, and regression-test Rainbow AI through
 * structured JSON, without a browser and without touching live WhatsApp.
 *
 * Usage (from repo root):
 *   node scripts/aci/rainbow-aci.mjs describe
 *   node scripts/aci/rainbow-aci.mjs status
 *   node scripts/aci/rainbow-aci.mjs profiles
 *   node scripts/aci/rainbow-aci.mjs chat --profile=pelangi --message="hello"
 *   node scripts/aci/rainbow-aci.mjs test --suite=all
 *   node scripts/aci/rainbow-aci.mjs test --suite=config
 *   node scripts/aci/rainbow-aci.mjs gates
 *
 * Env:
 *   BASE_URL  — target an ALREADY RUNNING server instead of spawning one
 *   ACI_PORT  — port for the ephemeral server (default 3199)
 *
 * JSON goes to stdout (agents parse it); progress goes to stderr (humans watch).
 * Exit codes: 0 = pass, 1 = fail, 2 = usage error.
 */

import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const ACI_PORT = Number(process.env.ACI_PORT || 3199);
const BASE_URL = process.env.BASE_URL || null; // if set, reuse running server
const IS_WIN = process.platform === 'win32';

const DATA_DIRS = {
  default: path.join(ROOT, 'src', 'assistant', 'data'),
  southern: path.join(ROOT, 'src', 'assistant', 'data-southern'),
  makan: path.join(ROOT, 'src', 'assistant', 'data-makan'),
};

// ─── describe ────────────────────────────────────────────────────────────────

const DESCRIBE = {
  app: 'rainbow-ai',
  summary:
    'WhatsApp AI assistant (Node.js/TS Express + go-core Go pipeline) for Pelangi Capsule Hostel, ' +
    'Southern Homestay, Makan Moments and others. This ACI tests it WITHOUT WhatsApp: it spawns an ' +
    'ephemeral server with DISABLE_WHATSAPP=true and SQLITE_PATH=:memory: on port ' + ACI_PORT + '.',
  stack: 'Node 24 ESM + TypeScript (tsx), Express 5, SQLite (better-sqlite3), Baileys (skipped in ACI), go-core (Go HTTP pipeline)',
  commands: {
    describe: 'this catalog',
    status: 'environment + data-file health, no server needed',
    profiles: 'list assistant profiles from profiles.json',
    'chat --profile=<id> --message=<text> [--session=<id>]':
      'one-shot webchat message; returns the assistant reply JSON. Uses BASE_URL if set, else ephemeral server.',
    'test --suite=<name>|all': 'deterministic PASS/FAIL suites (see suites)',
    gates: "wraps the repo's deploy test gate (npm run test:regression) + go-core unit tests — the slow, authoritative path",
  },
  suites: {
    config: 'wraps scripts/validate-routing|workflows|keywords (the app\'s own config contract). No server. ~20s',
    data: 'JSON integrity of all profile data dirs + profiles.json invariants. No server. <2s',
    health: 'ephemeral server: /health + /health/ready contract. ~30s incl. boot',
    chat: 'webchat API contract: POST /api/chat/:profileId/message happy path, greeting, config, history, bad inputs. Reuses server',
    go: 'go-core unit tests (go test ./...). SKIPPED loudly if Go toolchain absent — a skip is NOT a pass',
  },
  exitCodes: { 0: 'all pass', 1: 'failures', 2: 'usage error' },
  guardrails: [
    'NEVER point BASE_URL at production (http://5.223.54.57:8080) for suites — chat suite writes conversations.',
    'NEVER start Baileys / WhatsApp from this harness. DISABLE_WHATSAPP=true is non-negotiable.',
    'The ephemeral server uses SQLITE_PATH=:memory: — it must never open data/rainbow-ai.db.',
    'Port 8080 (prod) and 3002 (default dev) belong to the user; the ACI owns ' + ACI_PORT + ' only.',
    'chat replies may route to a live LLM provider (keys in .env). Assert the CONTRACT (shape, status), never exact reply text.',
  ],
  ports: { aci: ACI_PORT, devDefault: 3002, prod: 8080 },
  authNotes: 'webchat endpoints are public; admin API (/api/rainbow) bypasses X-Admin-Key from 127.0.0.1.',
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const results = [];
const skipped = [];

function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  process.stderr.write(`  ${pass ? '✓' : '✗'} ${label}${pass ? '' : ` — ${detail}`}\n`);
  return pass;
}

function checkEqual(label, actual, expected) {
  return check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function note(msg) {
  process.stderr.write(`${msg}\n`);
}

function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
}

function usageError(msg) {
  process.stdout.write(JSON.stringify({ error: msg, hint: 'run: node scripts/aci/rainbow-aci.mjs describe' }) + '\n');
  process.exit(2);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function runSync(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    shell: IS_WIN, // npm/npx/go resolve via shell on Windows
    encoding: 'utf8',
    timeout: opts.timeout ?? 180_000,
    env: { ...process.env, ...opts.env },
  });
}

async function fetchJson(url, init = {}, timeoutMs = 45_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(t);
  }
}

// ─── ephemeral server ────────────────────────────────────────────────────────

let serverProc = null;
let serverBase = null;

async function ensureServer() {
  if (serverBase) return serverBase;
  if (BASE_URL) {
    // Reuse a running server — verify it is up, refuse prod for safety.
    if (/5\.223\.54\.57/.test(BASE_URL)) throw new Error('Refusing to run suites against production BASE_URL');
    const ping = await fetchJson(`${BASE_URL}/health`, {}, 5_000).catch(() => null);
    if (!ping || ping.status !== 200) throw new Error(`BASE_URL ${BASE_URL} is not answering /health`);
    serverBase = BASE_URL;
    note(`Using existing server at ${serverBase}`);
    return serverBase;
  }

  note(`Booting ephemeral server on :${ACI_PORT} (DISABLE_WHATSAPP, SQLITE_PATH=:memory:) ...`);
  serverProc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: ROOT,
    shell: IS_WIN,
    env: {
      ...process.env,
      DISABLE_WHATSAPP: 'true',
      NODE_ENV: 'development',
      MCP_SERVER_PORT: String(ACI_PORT),
      SQLITE_PATH: ':memory:',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  serverProc.stdout.on('data', d => { bootLog += d; });
  serverProc.stderr.on('data', d => { bootLog += d; });
  serverProc.on('exit', code => {
    if (!serverBase) note(`[server exited early, code ${code}]\n${bootLog.slice(-2000)}`);
  });

  const base = `http://127.0.0.1:${ACI_PORT}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverProc.exitCode !== null) {
      throw new Error(`server exited during boot (code ${serverProc.exitCode}). Tail:\n${bootLog.slice(-2000)}`);
    }
    const ping = await fetchJson(`${base}/health`, {}, 2_000).catch(() => null);
    if (ping && ping.status === 200) {
      // /health goes green BEFORE the post-listen init finishes (fuzzy matcher,
      // semantic matcher). Firing chat requests early hits the generic-fallback
      // path. Wait for the intents init log line before declaring ready.
      const initDeadline = Date.now() + 60_000;
      while (Date.now() < initDeadline && !/Fuzzy matcher initialized/.test(bootLog)) {
        await new Promise(r => setTimeout(r, 1_000));
      }
      if (!/Fuzzy matcher initialized/.test(bootLog)) {
        note('  ! warning: fuzzy-matcher init line not seen within 60s — chat suite may hit fallback replies');
      }
      serverBase = base;
      note('Server ready (intents initialized).');
      return serverBase;
    }
    await new Promise(r => setTimeout(r, 1_500));
  }
  throw new Error(`server did not become healthy within 120s. Tail:\n${bootLog.slice(-2000)}`);
}

function killServer() {
  if (!serverProc || serverProc.exitCode !== null) return;
  if (IS_WIN) {
    // shell-spawned tree: child.kill() leaks tsx/node — kill the whole tree
    spawnSync('taskkill', ['/pid', String(serverProc.pid), '/T', '/F'], { shell: true });
  } else {
    serverProc.kill('SIGKILL');
  }
}

// ─── suites ──────────────────────────────────────────────────────────────────

// Keyword hygiene baseline measured 2026-07-11 (validate-keywords.ts --json).
// The repo ships with these pre-existing issues; the ACI pins them so the
// suite stays green while any INCREASE fails loudly. Ideal target is 0/0.
const KEYWORD_BASELINE = { collisions: 209, crossProfileDuplicates: 1321 };

function suiteConfig() {
  note('\n-- suite: config (app\'s own validators) --');
  const validators = [
    ['validate:routing', 'scripts/validate-routing.ts'],
    ['validate:workflows', 'scripts/validate-workflows.ts'],
  ];
  for (const [name, file] of validators) {
    const r = runSync('npx', ['tsx', file]);
    const tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' | ');
    check(`${name} exits 0`, r.status === 0, `exit ${r.status}: ${tail}`);
  }
  // validate:keywords is a known-red baseline — pin it instead of requiring 0
  const kw = runSync('npx', ['tsx', 'scripts/validate-keywords.ts', '--json']);
  let summary = null;
  try {
    const jsonStart = (kw.stdout || '').indexOf('{');
    summary = JSON.parse(kw.stdout.slice(jsonStart)).summary;
  } catch { /* fall through */ }
  check('validate:keywords produced summary', !!summary, `exit ${kw.status}, could not parse --json output`);
  if (summary) {
    check(`keyword collisions <= baseline ${KEYWORD_BASELINE.collisions} (got ${summary.totalCollisions})`,
      summary.totalCollisions <= KEYWORD_BASELINE.collisions,
      'NEW within-profile keyword collisions introduced — same keyword mapped to 2+ intents');
    check(`cross-profile duplicates <= baseline ${KEYWORD_BASELINE.crossProfileDuplicates} (got ${summary.totalCrossProfileDuplicates})`,
      summary.totalCrossProfileDuplicates <= KEYWORD_BASELINE.crossProfileDuplicates,
      'NEW cross-profile keyword duplicates introduced');
    if (summary.totalCollisions > 0) {
      skipped.push({
        suite: 'config',
        reason: `known-red baseline: ${summary.totalCollisions} keyword collisions + ${summary.totalCrossProfileDuplicates} cross-profile duplicates pre-date the ACI (pinned, not fixed)`,
      });
    }
  }
}

function suiteData() {
  note('\n-- suite: data (JSON integrity) --');
  // every .json in every profile data dir must parse
  for (const [tag, dir] of Object.entries(DATA_DIRS)) {
    if (!existsSync(dir)) {
      check(`data dir ${tag} exists`, tag !== 'default', dir);
      continue;
    }
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    check(`${tag}: has json files`, files.length > 0, dir);
    for (const f of files) {
      try {
        readJson(path.join(dir, f));
        check(`${tag}/${f} parses`, true);
      } catch (e) {
        check(`${tag}/${f} parses`, false, e.message);
      }
    }
  }
  // profiles.json invariants
  try {
    const p = readJson(path.join(ROOT, 'profiles.json'));
    const ids = (p.profiles || []).map(x => x.id);
    check('profiles.json: has profiles[]', ids.length > 0, JSON.stringify(ids));
    checkEqual('profiles.json: unique ids', new Set(ids).size, ids.length);
    check('profiles.json: defaultProfileId exists in profiles', ids.includes(p.defaultProfileId),
      `default=${p.defaultProfileId}, ids=${ids.join(',')}`);
  } catch (e) {
    check('profiles.json parses', false, e.message);
  }
}

async function suiteHealth() {
  note('\n-- suite: health --');
  const base = await ensureServer();
  const h = await fetchJson(`${base}/health`);
  checkEqual('/health -> 200', h.status, 200);
  check('/health has status field', typeof h.data?.status === 'string', JSON.stringify(h.data));
  const r = await fetchJson(`${base}/health/ready`);
  checkEqual('/health/ready -> 200', r.status, 200);
  check('/health/ready status in {ready,degraded,unhealthy}',
    ['ready', 'degraded', 'unhealthy'].includes(r.data?.status), JSON.stringify(r.data?.status));
}

async function suiteChat() {
  note('\n-- suite: chat (webchat API contract) --');
  const base = await ensureServer();
  const profile = 'pelangi';

  // greeting + config are cheap deterministic reads
  const greet = await fetchJson(`${base}/api/chat/${profile}/greeting?sessionId=aci-greet-${Date.now()}`);
  check('greeting -> 200', greet.status === 200, `got ${greet.status}: ${JSON.stringify(greet.data)}`);
  const cfg = await fetchJson(`${base}/api/chat/${profile}/config`);
  check('config -> 200', cfg.status === 200, `got ${cfg.status}`);

  // happy-path message (contract only — reply text may come from an LLM)
  const send = await fetchJson(`${base}/api/chat/${profile}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' }),
  }, 60_000);
  checkEqual('POST message -> 200', send.status, 200);
  check('reply.message is non-empty string',
    typeof send.data?.message === 'string' && send.data.message.length > 0,
    JSON.stringify(send.data).slice(0, 300));
  check('reply.sessionId returned', typeof send.data?.sessionId === 'string' && send.data.sessionId.length > 0,
    JSON.stringify(send.data?.sessionId));

  // history for that session
  if (send.data?.sessionId) {
    const hist = await fetchJson(`${base}/api/chat/${profile}/history?sessionId=${encodeURIComponent(send.data.sessionId)}`);
    check('history -> 200', hist.status === 200, `got ${hist.status}`);
  }

  // Regression pin (found 2026-07-11): in DISABLE_WHATSAPP mode initIntents()
  // was never called, fuzzyMatcher stayed null, and EVERY message fell through
  // to the generic "didn't quite understand" fallback. "wifi password" is a T2
  // keyword intent with a static reply — it must classify without the LLM.
  const wifi = await fetchJson(`${base}/api/chat/${profile}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'wifi password' }),
  }, 60_000);
  checkEqual('wifi question -> 200', wifi.status, 200);
  check('wifi reply is not the generic fallback (fuzzy matcher initialized)',
    typeof wifi.data?.message === 'string' && !/didn't quite understand/i.test(wifi.data.message),
    JSON.stringify(wifi.data?.message).slice(0, 200));

  // bad inputs must be loud, not silent-empty
  const noMsg = await fetchJson(`${base}/api/chat/${profile}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  check('missing message -> 4xx', noMsg.status >= 400 && noMsg.status < 500, `got ${noMsg.status}`);

  const badProfile = await fetchJson(`${base}/api/chat/no-such-profile-xyz/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
  });
  check('unknown profile -> 4xx', badProfile.status >= 400 && badProfile.status < 500, `got ${badProfile.status}`);

  const badJson = await fetch(`${base}/api/chat/${profile}/message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
  });
  check('malformed JSON body -> 4xx', badJson.status >= 400 && badJson.status < 500, `got ${badJson.status}`);
}

function suiteGo({ explicit = false } = {}) {
  note('\n-- suite: go (go-core unit tests) --');
  const which = runSync(IS_WIN ? 'where' : 'which', ['go'], { timeout: 10_000 });
  if (which.status !== 0) {
    if (explicit) {
      check('go toolchain available', false, 'Go not installed — cannot run go-core tests');
      return;
    }
    skipped.push({ suite: 'go', reason: 'Go toolchain not installed — go-core tests NOT run (this is not a pass)' });
    note('  ! SKIPPED: Go toolchain not found. go-core is UNTESTED in this run.');
    return;
  }
  const r = spawnSync('go', ['test', './...'], {
    cwd: path.join(ROOT, 'go-core'), shell: IS_WIN, encoding: 'utf8', timeout: 300_000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const failLines = out.split('\n').filter(l => /^(FAIL|--- FAIL)/.test(l)).slice(0, 5).join(' | ');
  check('go test ./... exits 0', r.status === 0, failLines || `exit ${r.status}`);
  const okCount = (out.match(/^ok\s/gm) || []).length;
  check(`go test ran packages (${okCount} ok)`, okCount > 0, 'zero packages reported ok — silent skip?');
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const status = {
    root: ROOT,
    nodeModules: existsSync(path.join(ROOT, 'node_modules')),
    goToolchain: runSync(IS_WIN ? 'where' : 'which', ['go'], { timeout: 10_000 }).status === 0,
    goCoreBinary: existsSync(path.join(ROOT, 'go-core', 'rainbow-core.exe')) || existsSync(path.join(ROOT, 'go-core', 'rainbow-core-linux')),
    dataDirs: Object.fromEntries(Object.entries(DATA_DIRS).map(([k, d]) => [k, existsSync(d)])),
    devServerUp: null,
    aciPortFree: null,
  };
  const dev = await fetchJson('http://127.0.0.1:3002/health', {}, 2_000).catch(() => null);
  status.devServerUp = dev?.status === 200;
  const aci = await fetchJson(`http://127.0.0.1:${ACI_PORT}/health`, {}, 2_000).catch(() => null);
  status.aciPortFree = !(aci?.status === 200);
  try {
    const p = readJson(path.join(ROOT, 'profiles.json'));
    status.profiles = p.profiles.map(x => x.id);
    status.defaultProfile = p.defaultProfileId;
  } catch (e) {
    status.profilesError = e.message;
  }
  emit(status);
}

function cmdProfiles() {
  const p = readJson(path.join(ROOT, 'profiles.json'));
  emit({ defaultProfileId: p.defaultProfileId, profiles: p.profiles.map(x => ({ id: x.id, name: x.name })) });
}

async function cmdChat(flags) {
  const profile = flags.profile || 'pelangi';
  const message = flags.message;
  if (!message) usageError('chat requires --message=<text>');
  try {
    const base = await ensureServer();
    const body = { message };
    if (flags.session) body.sessionId = flags.session;
    const res = await fetchJson(`${base}/api/chat/${profile}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, 60_000);
    killServer();
    emit({ profile, request: body, status: res.status, response: res.data }, res.ok ? 0 : 1);
  } catch (e) {
    killServer();
    emit({ error: e.message }, 1);
  }
}

function cmdGates() {
  note('Running deploy gate: npm run test:regression ...');
  const reg = runSync('npm', ['run', 'test:regression'], { timeout: 600_000, env: { SQLITE_PATH: ':memory:' } });
  const regOut = ((reg.stdout || '') + (reg.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
  const passMatch = regOut.match(/(\d+) passed/);
  check('test:regression exits 0', reg.status === 0, regOut.split('\n').filter(l => /FAIL|failed/.test(l)).slice(0, 5).join(' | '));
  check('test:regression ran tests', !!passMatch && Number(passMatch[1]) > 0, 'no "N passed" found — did it run?');
  suiteGo({ explicit: false });
  summarize();
}

const SUITES = {
  config: suiteConfig,
  data: suiteData,
  health: suiteHealth,
  chat: suiteChat,
  go: (opts) => suiteGo(opts),
};

function summarize() {
  killServer();
  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;
  const verdict = {
    passed, failed, total: results.length,
    ok: failed === 0,
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
    profile: { type: 'string' },
    message: { type: 'string' },
    session: { type: 'string' },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

process.on('exit', killServer);
process.on('SIGINT', () => { killServer(); process.exit(1); });

switch (command) {
  case 'describe':
    emit(DESCRIBE);
    break;
  case 'status':
    await cmdStatus();
    break;
  case 'profiles':
    cmdProfiles();
    break;
  case 'chat':
    await cmdChat(flags);
    break;
  case 'gates':
    cmdGates();
    break;
  case 'test': {
    const name = flags.suite || 'all';
    const toRun = name === 'all' ? ['config', 'data', 'health', 'chat', 'go'] : [name];
    if (toRun.some(s => !SUITES[s])) usageError(`unknown suite "${name}". Valid: ${Object.keys(SUITES).join(', ')}, all`);
    note(`Rainbow ACI  suites=${toRun.join(',')}  port=${ACI_PORT}${BASE_URL ? `  BASE_URL=${BASE_URL}` : ''}`);
    for (const s of toRun) {
      try {
        await SUITES[s]({ explicit: name !== 'all' });
      } catch (e) {
        results.push({ label: `${s}: uncaught`, pass: false, detail: e.message });
        process.stderr.write(`  ✗ suite ${s} threw: ${e.message}\n`);
      }
    }
    summarize();
    break;
  }
  default:
    usageError(`unknown command "${command ?? ''}". Commands: describe, status, profiles, chat, test, gates`);
}
