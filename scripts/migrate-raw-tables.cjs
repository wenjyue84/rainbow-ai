const pg = require('pg');
const oldPool = new pg.Pool({ connectionString: process.env.OLD_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const newPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrateTable(tableName) {
  const { rows } = await oldPool.query('SELECT * FROM ' + tableName);
  if (rows.length === 0) { console.log(tableName + ': 0 rows'); return; }
  const cols = Object.keys(rows[0]);
  const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
  const sql = 'INSERT INTO ' + tableName + ' (' + cols.map(c => '"' + c + '"').join(', ') + ') VALUES (' + ph + ') ON CONFLICT DO NOTHING';
  let ins = 0;
  for (const row of rows) {
    try { const r = await newPool.query(sql, cols.map(c => row[c])); ins += r.rowCount || 0; } catch (e) { console.warn(tableName + ' error: ' + e.message); }
  }
  console.log(tableName + ': ' + ins + '/' + rows.length + ' rows migrated');
}

async function main() {
  await migrateTable('rainbow_configs');
  await migrateTable('rainbow_kb_files');
  await migrateTable('rainbow_config_audit');
  console.log('Done');
  await oldPool.end();
  await newPool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
