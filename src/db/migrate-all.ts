/**
 * Runs all migrations in order: base schema + phase migrations.
 * Safe to re-run — all DDL uses IF NOT EXISTS / IF NOT EXISTS patterns.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { pool, testConnection } from './client';

const MIGRATIONS = [
  join(__dirname, 'schema.sql'),
  join(__dirname, 'migrations', '002_phase2.sql'),
  join(__dirname, 'migrations', '003_phase3.sql'),
  join(__dirname, 'migrations', '004_phase4.sql'),
];

async function migrateAll(): Promise<void> {
  console.log('[DB] Testing connection...');
  await testConnection();
  console.log('[DB] Connected.');

  for (const filePath of MIGRATIONS) {
    const name = filePath.split('/').slice(-2).join('/');
    console.log(`[DB] Running: ${name}`);
    const sql = readFileSync(filePath, 'utf-8');
    await pool.query(sql);
    console.log(`[DB] ✓ ${name}`);
  }

  console.log('[DB] All migrations complete.');
  await pool.end();
}

migrateAll().catch((err) => {
  console.error('[DB] Migration failed:', err.message);
  process.exit(1);
});
