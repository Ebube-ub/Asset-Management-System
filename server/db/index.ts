import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.PGLITE_DIR ?? path.resolve(process.cwd(), 'data', 'pglite');

fs.mkdirSync(path.dirname(dataDir), { recursive: true });

export const pg = new PGlite(dataDir);

let ready: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const candidates = [
        path.resolve(process.cwd(), 'server', 'db', 'schema.sql'),
        path.resolve(here, 'schema.sql'),
      ];
      const schemaPath = candidates.find((p) => fs.existsSync(p));
      if (!schemaPath) throw new Error('Could not locate server/db/schema.sql');
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pg.exec(sql);
      await pg.exec('create table if not exists _migration (id text primary key, applied_at timestamptz not null default now())');
    })();
  }
  return ready;
}

export type Params = unknown[];

/** Parameterised query helper. Values are always bound, never interpolated. */
export async function query<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
  const result = await pg.query<T>(sql, params as never[]);
  return result.rows;
}

/** Run one or more statements with no bound parameters (schema and migrations). */
export async function exec(sql: string): Promise<void> {
  await pg.exec(sql);
}

export async function one<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return pg.transaction(async (t) => fn(new Tx(t)));
}

class Tx {
  constructor(private t: { query: typeof pg.query }) {}

  async query<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
    const r = await this.t.query<T>(sql, params as never[]);
    return r.rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

export type { Tx };
