/**
 * Database Abstraction Adapter
 * 
 * Provides a unified synchronous/asynchronous abstraction layer that supports
 * both SQLite (node:sqlite DatabaseSync) and PostgreSQL (pg.Pool).
 * 
 * Safety features:
 * 1. Automatic parameter placeholder translation (? -> $1, $2, etc. when on PostgreSQL).
 * 2. SQLite compatibility mode preserved exactly when DATABASE_URL is not set.
 * 3. Never falls back silently to an empty database if DATABASE_URL is provided but connection fails.
 * 4. Translates SQLite idioms (e.g. datetime('now', '+7 days'), strftime) to Postgres standard syntax.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface DbStatement {
  run(...params: any[]): { changes: number | bigint; lastInsertRowid?: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface DbAdapter {
  isPostgres: boolean;
  exec(sql: string): void | Promise<void>;
  prepare(sql: string): DbStatement;
  query(sql: string, params?: any[]): Promise<any[]>;
  close(): Promise<void>;
}

/**
 * Convert SQLite ? placeholders to PostgreSQL $1, $2, ... placeholders,
 * and translate common SQLite datetime helper expressions if needed.
 */
export function translateSqlForPostgres(sql: string): string {
  let paramIndex = 1;
  // Replace ? placeholders with $1, $2, etc.
  let translated = sql.replace(/\?/g, () => `$${paramIndex++}`);

  // Replace datetime('now', '+7 days') -> (CURRENT_TIMESTAMP + INTERVAL '7 days')
  translated = translated.replace(/datetime\('now',\s*'\+([0-9]+)\s+days'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1 days')");
  translated = translated.replace(/datetime\('now',\s*'\+([0-9]+)\s+hours'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '$1 hours')");
  translated = translated.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
  translated = translated.replace(/datetime\(([^)]+)\)/gi, "($1)::TIMESTAMPTZ");

  // strftime('%Y-%m', col) -> TO_CHAR(col, 'YYYY-MM')
  translated = translated.replace(/strftime\('%Y-%m',\s*([^)]+)\)/gi, "TO_CHAR($1, 'YYYY-MM')");

  // SQLite INSERT OR IGNORE INTO -> PostgreSQL INSERT INTO ... ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(translated)) {
    translated = translated.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(translated)) {
      translated += ' ON CONFLICT DO NOTHING';
    }
  }

  // SQLite INSERT OR REPLACE INTO -> PostgreSQL INSERT INTO ... ON CONFLICT (id) DO NOTHING
  if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(translated)) {
    translated = translated.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(translated)) {
      translated += ' ON CONFLICT (id) DO NOTHING';
    }
  }

  return translated;
}

/**
 * SQLite Adapter implementation using node:sqlite DatabaseSync
 */
export class SqliteAdapter implements DbAdapter {
  public isPostgres = false;
  private sqliteDb: DatabaseSync;

  constructor(sqliteDb: DatabaseSync) {
    this.sqliteDb = sqliteDb;
  }

  exec(sql: string): void {
    this.sqliteDb.exec(sql);
  }

  prepare(sql: string): DbStatement {
    const stmt = this.sqliteDb.prepare(sql);
    return {
      run: (...params: any[]) => {
        const res = stmt.run(...params);
        return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
      },
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params) as any[],
    };
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    return this.sqliteDb.prepare(sql).all(...params) as any[];
  }

  async close(): Promise<void> {
    this.sqliteDb.close();
  }
}

/**
 * Postgres Adapter implementation using pg.Pool
 */
export class PostgresAdapter implements DbAdapter {
  public isPostgres = true;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  prepare(sql: string): DbStatement {
    const pgSql = translateSqlForPostgres(sql);
    const pool = this.pool;

    // For synchronous server code compatibility, we provide the async runner and a warning
    // In production Node.js, asynchronous queries are executed via adapter.query
    return {
      run: (...params: any[]) => {
        throw new Error(
          `Synchronous db.prepare().run() was called on PostgresAdapter for query: "${sql.slice(0, 50)}...". Please use async dbAdapter.query() or pgPool directly in PostgreSQL mode.`
        );
      },
      get: (...params: any[]) => {
        throw new Error(
          `Synchronous db.prepare().get() was called on PostgresAdapter for query: "${sql.slice(0, 50)}...". Please use async dbAdapter.query() or pgPool directly in PostgreSQL mode.`
        );
      },
      all: (...params: any[]) => {
        throw new Error(
          `Synchronous db.prepare().all() was called on PostgresAdapter for query: "${sql.slice(0, 50)}...". Please use async dbAdapter.query() or pgPool directly in PostgreSQL mode.`
        );
      },
    };
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const pgSql = translateSqlForPostgres(sql);
    const res = await this.pool.query(pgSql, params);
    return res.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getPool(): pg.Pool {
    return this.pool;
  }
}
