import pg from 'pg';
import 'dotenv/config';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();

const createTableSQL = `
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  guest_id varchar(64) NOT NULL,
  body text NOT NULL,
  failure_reason text NOT NULL,
  failed_at timestamp NOT NULL DEFAULT now(),
  retry_count integer NOT NULL DEFAULT 0,
  profile text NOT NULL DEFAULT 'pelangi',
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_guest_id ON dead_letter_queue(guest_id);
CREATE INDEX IF NOT EXISTS idx_dlq_profile ON dead_letter_queue(profile);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON dead_letter_queue(failed_at);
CREATE INDEX IF NOT EXISTS idx_dlq_expires_at ON dead_letter_queue(expires_at);
`;

try {
  console.log('Creating dead_letter_queue table...');
  const result = await client.query(createTableSQL);
  console.log('✓ Table created successfully');
} catch (err) {
  console.error('Error creating table:', err.message);
}

await client.end();
