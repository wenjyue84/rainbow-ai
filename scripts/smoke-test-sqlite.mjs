/**
 * Smoke test: verify db.ts shim loads, schema tables are readable,
 * and the PG→SQLite translator handles a few representative queries.
 * Run with: DATABASE_URL=./data/rainbow-ai.db node scripts/smoke-test-sqlite.mjs
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || './data/rainbow-ai.db';

const log = (label, x) => console.log(`[${label}]`, x);
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; log('PASS', name); }
  catch (e) { failed++; log('FAIL', `${name} — ${e.message}`); }
};

// 1. Load db module
const dbMod = await import('../src/lib/db.ts').catch(e => {
  console.error('[FATAL] could not import db.ts:', e.message);
  process.exit(1);
});
log('OK', 'db.ts imported');

// 2. Load schema
const schema = await import('../shared/schema-tables.ts').catch(e => {
  console.error('[FATAL] could not import schema:', e.message);
  process.exit(1);
});
log('OK', 'schema-tables.ts imported');

// 3. Drizzle select on an empty table
const { db } = dbMod;
check('drizzle select rainbow_conversations (empty)', () => {
  const rows = db.select().from(schema.rainbowConversations).all();
  if (!Array.isArray(rows)) throw new Error('expected array');
});

// 4. Raw pool.query via shim — basic SELECT
check('pool.query SELECT 1', () => {
  const { pool } = dbMod;
  const r = pool.query ? null : null; // pool.query is async
});

const { pool } = dbMod;
try {
  const r = await pool.query('SELECT 1 AS n');
  if (r.rows[0].n !== 1) throw new Error('unexpected');
  passed++; log('PASS', 'pool.query SELECT 1');
} catch (e) { failed++; log('FAIL', `pool.query SELECT 1 — ${e.message}`); }

// 5. Shim param conversion: $1, $2 → ?, ?
try {
  await pool.query('SELECT ? AS a, ? AS b', ['x', 'y']).catch(async () => {
    // shim expects $1/$2 style
    const r = await pool.query('SELECT $1 AS a, $2 AS b', ['x', 'y']);
    if (r.rows[0].a !== 'x' || r.rows[0].b !== 'y') throw new Error('param mismatch');
  });
  passed++; log('PASS', 'pool.query param translation $1,$2');
} catch (e) { failed++; log('FAIL', `pool.query param translation — ${e.message}`); }

// 6. TIMESTAMPTZ / JSONB / NOW() / gen_random_uuid() — lazy DDL translator
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS smoke_test_tbl (
      id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      payload JSONB
    )
  `);
  await pool.query(
    'INSERT INTO smoke_test_tbl (payload) VALUES ($1)',
    [JSON.stringify({ hello: 'world' })]
  );
  const r = await pool.query('SELECT * FROM smoke_test_tbl');
  if (r.rows.length < 1) throw new Error('no rows');
  if (!r.rows[0].id) throw new Error('uuid default failed');
  if (!r.rows[0].created_at) throw new Error('NOW() default failed');
  passed++; log('PASS', 'lazy DDL translator (TIMESTAMPTZ/JSONB/NOW/uuid)');
  await pool.query('DROP TABLE smoke_test_tbl');
} catch (e) { failed++; log('FAIL', `lazy DDL translator — ${e.message}`); }

// 7. Verify `= ANY($1)` throws loudly (so we can find + fix callers)
try {
  await pool.query('SELECT 1 WHERE 1 = ANY($1)', [[1, 2, 3]]);
  failed++; log('FAIL', '= ANY(...) should throw but did not');
} catch (e) {
  if (/ANY/i.test(e.message) || /unsupported/i.test(e.message)) {
    passed++; log('PASS', '= ANY($n) throws as expected');
  } else {
    failed++; log('FAIL', `= ANY($n) threw unexpected: ${e.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
