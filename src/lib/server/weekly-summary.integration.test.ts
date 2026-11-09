import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({ query: mocks.query }));

import { collectPlannerSummary } from "@/lib/server/weekly-summary";

// Explicit opt-in: real SQL against a disposable migrated local database only.
// Fixtures mirror weekly-review's test/fixtures/seed.mjs and are rolled back.
//   WEEKLY_SUMMARY_TEST_DATABASE_URL=postgresql://admin@127.0.0.1:5432/common_week_test \
//     npm run test:run -- src/lib/server/weekly-summary.integration.test.ts
const connectionString = process.env.WEEKLY_SUMMARY_TEST_DATABASE_URL;
const week = { start: "2026-10-26", end: "2026-11-01" };
const next = { start: "2026-11-02", end: "2026-11-08" };

describe.skipIf(!connectionString)("weekly summary with PostgreSQL", () => {
  let client: pg.Client;
  let email: string;
  let writes: string[];

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("test")) {
      throw new Error("Weekly summary integration tests require a disposable local test database.");
    }
    client = new pg.Client({ connectionString, application_name: "weekly-summary-test" });
    await client.connect();
  });

  beforeEach(async () => {
    await client.query("begin");
    writes = [];
    mocks.query.mockReset().mockImplementation((sql: string, values?: unknown[]) => {
      if (!/^\s*select\b/i.test(sql)) writes.push(sql);
      return client.query(sql, values);
    });
    email = `tester-${randomUUID()}@example.invalid`;
    const user = (await client.query("insert into users (email, display_name) values ($1, 'Tester') returning id", [email])).rows[0].id;
    const household = (await client.query("insert into households (name) values ('Test home') returning id")).rows[0].id;
    await client.query("insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')", [household, user]);
    const task = (text: string, weekStart: string, done: boolean, extra: { original?: string; carry?: number; deadline?: string; mine?: boolean; date?: string; backlog?: boolean } = {}) => client.query(
      `insert into planning_items (household_id, created_by, type, text, week_start_date, original_week_start_date,
         is_completed, carryover_count, deadline, responsible_member_id, planning_date, is_backlog)
       values ($1,$2,'task',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [household, user, text, weekStart, extra.original ?? weekStart, done, extra.carry ?? 0, extra.deadline ?? null,
        extra.mine ? user : null, extra.date ?? null, extra.backlog ?? false],
    );
    await task("Book pediatrician", "2026-10-26", true, { mine: true, date: "2026-10-27" });
    await task("Return library books", "2026-10-26", true);
    await task("Fix bathroom fan", "2026-10-26", false, { carry: 3, original: "2026-10-05" });
    await task("Renew passport", "2026-10-26", false, { deadline: "2026-10-30" });
    await task("Order Halloween costume", "2026-11-02", false, { deadline: "2026-11-04", mine: true });
    await task("Schedule HVAC service", "2026-11-02", false);
    // Backlog items are excluded from the current week's counts.
    await task("Someday: repaint shed", "2026-10-26", false, { backlog: true });
    await client.query(
      `insert into weekly_reviews (household_id, week_start_date, priorities, meals, logistics)
       values ($1, '2026-11-02', 'Finish passport renewal', 'Tacos Tue, pasta Thu', 'Grandparents visit Sat')`,
      [household],
    );

    // Another household's data must never appear.
    const other = (await client.query("insert into users (email, display_name) values ($1, 'Other') returning id", [`other-${randomUUID()}@example.invalid`])).rows[0].id;
    const otherHousehold = (await client.query("insert into households (name) values ('Other home') returning id")).rows[0].id;
    await client.query("insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')", [otherHousehold, other]);
    await client.query(
      "insert into planning_items (household_id, created_by, type, text, week_start_date, deadline) values ($1, $2, 'task', 'Foreign task', '2026-10-26', '2026-10-27')",
      [otherHousehold, other],
    );
  });

  afterEach(async () => { await client.query("rollback"); });
  afterAll(async () => { await client?.end(); });

  it("matches weekly-review's collectPlanner expectations", async () => {
    const result = await collectPlannerSummary(email, week, next);

    expect(writes).toEqual([]);
    expect(result).toEqual({
      status: "ok",
      household: "Test home",
      current: {
        taskCount: 4,
        doneCount: 2,
        openCount: 2,
        done: [
          { text: "Book pediatrician", responsible: "Tester", deadline: null, date: "2026-10-27", carryovers: 0 },
          { text: "Return library books", responsible: null, deadline: null, date: null, carryovers: 0 },
        ],
        stuck: [{ text: "Fix bathroom fan", responsible: null, deadline: null, date: null, carryovers: 3 }],
        notes: null,
      },
      nextWeek: {
        tasks: [
          { text: "Order Halloween costume", responsible: "Tester", deadline: "2026-11-04", date: null, carryovers: 0 },
          { text: "Schedule HVAC service", responsible: null, deadline: null, date: null, carryovers: 0 },
        ],
        notes: { priorities: "Finish passport renewal", meals: "Tacos Tue, pasta Thu", logistics: "Grandparents visit Sat" },
      },
      overdue: [{ text: "Renew passport", responsible: null, deadline: "2026-10-30", date: null, carryovers: 0 }],
    });
  });

  it("matches the email case-insensitively and reports unknown users as no-account", async () => {
    expect((await collectPlannerSummary(email.toUpperCase(), week, next)).status).toBe("ok");
    expect(await collectPlannerSummary("nobody@example.invalid", week, next)).toEqual({ status: "no-account" });
    expect(writes).toEqual([]);
  });
});
