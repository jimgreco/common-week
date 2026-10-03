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
    console.error("Unexpected database pool error:", databaseFailure(error));
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
    // PostgreSQL errors can include complete rows, credentials, and query values.
    // Strip them before logging or passing the failure to action/route handlers.
    const failure = databaseFailure(error);
    console.error("Database query failed:", failure);
    throw failure;
  });
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect().catch((error: unknown) => { throw databaseFailure(error); });
  // Wrap only database operations; application validation errors keep their useful messages.
  const database = new Proxy(client, {
    get(target, property) {
      if (property === "query") {
        return (...args: Parameters<PoolClient["query"]>) => {
          try {
            return Promise.resolve(Reflect.apply(target.query, target, args)).catch((error: unknown) => {
              throw databaseFailure(error);
            });
          } catch (error) {
            throw databaseFailure(error);
          }
        };
      }
      return Reflect.get(target, property);
    },
  });
  let discardConnection = false;
  try {
    await database.query("begin");
    const result = await work(database);
    await database.query("commit");
    return result;
  } catch (error) {
    try {
      await database.query("rollback");
    } catch (rollbackError) {
      discardConnection = true;
      console.error("Database rollback failed:", databaseFailure(rollbackError));
    }
    throw error;
  } finally {
    client.release(discardConnection);
  }
}

function databaseFailure(error: unknown): Error & { code?: string } {
  const code = postgresErrorCode(error);
  const safeCode = code && (/^[0-9A-Z]{5}$/.test(code)
    || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE"].includes(code)) ? code : undefined;
  return Object.assign(new Error("The database operation could not be completed. Please try again."), {
    name: "DatabaseOperationError",
    ...(safeCode ? { code: safeCode } : {}),
  });
}

export function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
