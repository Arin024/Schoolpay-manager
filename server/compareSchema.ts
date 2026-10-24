import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

const sqliteDb = new DatabaseSync('data/schoolpay.db');
const envLocal = fs.existsSync('.env.local') ? dotenv.parse(fs.readFileSync('.env.local')) : {};
const pool = new pg.Pool({ connectionString: envLocal.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function compare() {
  const client = await pool.connect();
  try {
    const tables = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[];
    for (const t of tables) {
      const sqliteCols = (sqliteDb.prepare(`PRAGMA table_info(${t.name})`).all() as any[]).map(c => c.name);
      const pgColsRes = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [t.name]
      );
      const pgCols = pgColsRes.rows.map(r => r.column_name);
      const missingInPg = sqliteCols.filter(c => !pgCols.includes(c));
      if (missingInPg.length > 0) {
        console.log(`Table "${t.name}" missing in PG:`, missingInPg);
      }
    }
    console.log('Comparison complete!');
  } finally {
    client.release();
    await pool.end();
  }
}
compare().catch(console.error);
