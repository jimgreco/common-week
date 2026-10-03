import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), on: vi.fn(), release: vi.fn(), transactionQuery: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({ default: {
  Pool: class {
    query = mocks.query;
    connect = mocks.connect;
    on = mocks.on;
  },
  types: { setTypeParser: vi.fn() },
} }));

import { getPool, postgresErrorCode, query, withTransaction } from "@/lib/server/database";

const privateValue = "synthetic-private-household-note";
const databaseError = () => Object.assign(new Error(`Failed row: ${privateValue}`), {
  code: "23505", detail: `Key (text)=(${privateValue}) already exists`,
  query: `insert into items values ('${privateValue}')`, parameters: [privateValue],
});

describe("database failure privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.commonWeekPool = undefined;
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/synthetic_test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connect.mockResolvedValue({ query: mocks.transactionQuery, release: mocks.release });
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("does not log or propagate SQL, parameters, row details or original errors", async () => {
    const original = databaseError();
    mocks.query.mockRejectedValueOnce(original);
    const failure = await query("insert into items(text) values ($1)", [privateValue]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(original);
    expect(postgresErrorCode(failure)).toBe("23505");
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    expect(String(failure)).not.toContain(privateValue);
    expect(failure).not.toHaveProperty("cause");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateValue);
    expect(console.error).toHaveBeenCalledWith("Database query failed:", failure);
  });

  it("sanitizes transaction query errors, rolls back and releases the connection", async () => {
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("insert")) throw databaseError();
      return { rows: [], rowCount: 0 };
    });
    const failure = await withTransaction(async (database) => {
      await database.query("insert into items(text) values ($1)", [privateValue]);
    }).catch((error: unknown) => error);
    expect(postgresErrorCode(failure)).toBe("23505");
    expect(String(failure)).not.toContain(privateValue);
    expect(JSON.stringify(failure)).not.toContain(privateValue);
    expect(mocks.transactionQuery).toHaveBeenLastCalledWith("rollback");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("preserves application validation failures even if rollback also fails", async () => {
    const applicationError = new Error("Choose another household member.");
    mocks.transactionQuery.mockImplementation(async (sql: string) => {
      if (sql === "rollback") throw databaseError();
      return { rows: [], rowCount: 0 };
    });
    await expect(withTransaction(async () => { throw applicationError; })).rejects.toBe(applicationError);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateValue);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith(true);
  });

  it("commits successful transactions and returns their results", async () => {
    const result = { rows: [{ id: "synthetic-id" }], rowCount: 1 };
    mocks.transactionQuery.mockResolvedValue(result);
    await expect(withTransaction(async (database) => database.query("select id from items"))).resolves.toEqual(result);
    expect(mocks.transactionQuery).toHaveBeenLastCalledWith("commit");
    expect(mocks.release).toHaveBeenCalledWith(false);
  });

  it("sanitizes connection failures and idle-pool errors", async () => {
    mocks.connect.mockRejectedValueOnce(databaseError());
    await expect(withTransaction(async () => undefined)).rejects.toThrow("The database operation could not be completed");
    getPool();
    const callback = mocks.on.mock.calls.find(([event]) => event === "error")![1];
    callback(databaseError());
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(privateValue);
  });
});
