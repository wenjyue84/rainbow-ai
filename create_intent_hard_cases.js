import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function createTable() {
  try {
    await client.connect();
    
    const sql = `
      CREATE TABLE IF NOT EXISTS intent_hard_cases (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id TEXT NOT NULL,
        intent_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        candidate_intents JSONB,
        reason TEXT,
        profile TEXT NOT NULL DEFAULT 'pelangi',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        
        -- Indexes
        CONSTRAINT pk_intent_hard_cases PRIMARY KEY (id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_intent_hard_cases_profile ON intent_hard_cases(profile);
      CREATE INDEX IF NOT EXISTS idx_intent_hard_cases_intent_id ON intent_hard_cases(intent_id);
      CREATE INDEX IF NOT EXISTS idx_intent_hard_cases_confidence ON intent_hard_cases(confidence);
      CREATE INDEX IF NOT EXISTS idx_intent_hard_cases_created_at ON intent_hard_cases(created_at);
      CREATE INDEX IF NOT EXISTS idx_intent_hard_cases_profile_confidence ON intent_hard_cases(profile, confidence);
    `;
    
    await client.query(sql);
    console.log('✅ Table created successfully');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createTable();
