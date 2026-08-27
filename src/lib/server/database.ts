import "server-only";

import pg, { type ClientConfig, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const { Pool, types } = pg;

// Keep date-only values as YYYY-MM-DD strings so JavaScript timezone conversion
// can never move a plan or assignment onto a neighboring date.
types.setTypeParser(1082, (value) => value);

declare global {
  var commonWeekPool: InstanceType<typeof Pool> | undefined;
}

export function databaseClientConfig(applicationName = "common-week"): ClientConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  return {
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.PGSSL === "true"
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" }
      : false,
  };
}

function createPool() {
  const pool = new Pool({
    ...databaseClientConfig(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
  });
  
  pool.on("error", (error) => {
    console.error("Unexpected database pool error:", error);
  });
  
  return pool;
}

export function getPool() {
  if (!globalThis.commonWeekPool) globalThis.commonWeekPool = createPool();
  return globalThis.commonWeekPool;
}

export function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, values).catch((error) => {
    console.error("Database query failed:", { text, values, error });
    throw error;
  });
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
