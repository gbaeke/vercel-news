import { Pool, types } from 'pg';

// Keep timestamp columns as raw strings (matches the `Article` type's `string`
// fields) instead of pg's default of parsing them into Date objects — the
// review UI and public site render these values directly.
types.setTypeParser(types.builtins.TIMESTAMPTZ, (val: string) => val);
types.setTypeParser(types.builtins.TIMESTAMP, (val: string) => val);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
    // node-postgres emits errors from idle clients on the Pool itself. Without
    // a listener, a transient Neon disconnect becomes an uncaught process
    // error even when the request that noticed it has an error boundary.
    pool.on('error', (error) => {
      console.error('[db] idle Postgres client failed', error);
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}
