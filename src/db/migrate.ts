import { readFileSync } from 'fs';
import { join } from 'path';
import { pool, testConnection } from './client';

async function migrate(): Promise<void> {
  console.log('[DB] Testing connection...');
  await testConnection();
  console.log('[DB] Connected.');

  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  console.log('[DB] Running migration...');
  await pool.query(schema);
  console.log('[DB] Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('[DB] Migration failed:', err.message);
  process.exit(1);
});
