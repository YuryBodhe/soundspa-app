// scripts/init-db.ts
// Simple SQLite initializer for Sound Spa
// Run: npx tsx scripts/init-db.ts

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// __dirname аналог для ES-модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'soundspa.sqlite');
const SCHEMA_PATH = path.join(ROOT, 'db', 'schema.sql');

function main() {
  console.log('▶ SoundSpa DB init');
  console.log('  DB:     ', DB_PATH);
  console.log('  Schema: ', SCHEMA_PATH);

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('❌ schema.sql not found at', SCHEMA_PATH);
    process.exit(1);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('BEGIN;');
    db.exec(sql);
    db.exec('COMMIT;');
    console.log('✅ DB initialized / updated successfully');
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('🚨 Init failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
