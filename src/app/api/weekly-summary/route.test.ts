import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demo: false,
  query: vi.fn(),
  sessionIdentityForToken: vi.fn(),
  currentSessionIdentity: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  get isDemoMode() { return mocks.demo; },
}));
vi.mock("@/lib/server/database", () => ({ query: (...args: unknown[]) => mocks.query(...args) }));
// The route must never consult user sessions; these spies prove it.
vi.mock("@/lib/server/session", () => ({
  SESSION_COOKIE: "common_week_session",
  sessionIdentityForToken: (...args: unknown[]) => mocks.sessionIdentityForToken(...args),
  currentSessionIdentity: (...args: unknown[]) => mocks.currentSessionIdentity(...args),
}));

import { GET } from "@/app/api/weekly-summary/route";

const TOKEN = "synthetic-weekly-summary-token";
const TOKEN_SHA256 = createHash("sha256").update(TOKEN).digest("hex");
const EMAIL = "tester@example.com";

function request(week: string | null, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) {
  const url = new URL("https://weekofus.com/api/weekly-summary");
  if (week !== null) url.searchParams.set("week", week);
  return new NextRequest(url, { headers });
}

const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length });
const task = (text: string, extra: Record<string, unknown> = {}) => ({
  id: text, text, is_completed: false, planning_date: null, week_start_date: "2026-10-26",
  deadline: null, carryover_count: 0, is_backlog: false, responsible: null, ...extra,
});

describe("GET /api/weekly-summary", () => {
  beforeEach(() => {
    mocks.demo = false;
    mocks.query.mockReset();
    mocks.sessionIdentityForToken.mockReset().mockResolvedValue({ userId: "user-a", householdId: "household-a" });
    mocks.currentSessionIdentity.mockReset().mockResolvedValue({ userId: "user-a", householdId: "household-a" });
    vi.stubEnv("WEEKLY_SUMMARY_TOKEN_SHA256", TOKEN_SHA256);
    vi.stubEnv("WEEKLY_SUMMARY_EMAIL", EMAIL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    expect(mocks.sessionIdentityForToken).not.toHaveBeenCalled();
    expect(mocks.currentSessionIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ["token hash", "WEEKLY_SUMMARY_TOKEN_SHA256"],
    ["email", "WEEKLY_SUMMARY_EMAIL"],
  ])("is a 404 when the %s variable is unset or empty", async (_label, name) => {
    vi.stubEnv(name, "");
    const response = await GET(request("2026-10-26"));
    expect(response.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("is a 404 in demo mode", async () => {
    mocks.demo = true;
    expect((await GET(request("2026-10-26"))).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["wrong", { Authorization: "Bearer not-the-token" }],
    ["non-bearer", { Authorization: `Basic ${TOKEN}` }],
    ["the hash itself", { Authorization: `Bearer ${TOKEN_SHA256}` }],
  ])("is a 404 for a %s token", async (_label, headers) => {
    const response = await GET(request("2026-10-26", headers as Record<string, string>));
    expect(response.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not accept a real user session bearer or cookie", async () => {
    for (const headers of <Record<string, string>[]>[
      { Authorization: "Bearer real-user-session-token" },
      { Cookie: "common_week_session=real-user-session-token" },
    ]) {
      const response = await GET(request("2026-10-26", headers));
      expect(response.status).toBe(404);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("checks auth before validating the week", async () => {
    expect((await GET(request("2026-10-27", {}))).status).toBe(404);
  });

  it.each(["2026-10-27", "2026-11-01", "2026-02-30", "26-10-26", "", null])("is a 400 for week=%s", async (week) => {
    const response = await GET(request(week));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "week must be a Monday (YYYY-MM-DD)" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns the planner summary envelope with no-store", async () => {
    mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes("FROM users u")) {
        expect(values).toEqual([EMAIL]);
        return rows([{ id: "household-a", name: "Test home", timezone: "America/New_York" }]);
      }
      if (sql.includes("FROM weekly_reviews")) {
        expect(values).toEqual(["household-a", "2026-10-26", "2026-11-02"]);
        return rows([{ week_start_date: "2026-11-02", priorities: "Finish passport renewal", meals: "Tacos Tue, pasta Thu", logistics: "" }]);
      }
      if (sql.includes("LIMIT 25")) {
        expect(values).toEqual(["household-a", "2026-11-02", "2026-11-08"]);
        return rows([task("Order Halloween costume", { week_start_date: "2026-11-02", deadline: "2026-11-04", responsible: "Tester" })]);
      }
      if (sql.includes("LIMIT 10")) {
        expect(values).toEqual(["household-a", "2026-11-02"]);
        return rows([task("Renew passport", { deadline: "2026-10-30" })]);
      }
      expect(values).toEqual(["household-a", "2026-10-26"]);
      return rows([
        task("Book pediatrician", { is_completed: true, planning_date: "2026-10-27", responsible: "Tester" }),
        task("Return library books", { is_completed: true }),
        task("Fix bathroom fan", { carryover_count: 3 }),
        task("Renew passport", { deadline: "2026-10-30" }),
      ]);
    });

    const response = await GET(request("2026-10-26"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["version", "app", "week", "generatedAt", "data"]);
    expect(body).toMatchObject({ version: 1, app: "planner", week: { start: "2026-10-26", end: "2026-11-01" } });
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect(body.data).toEqual({
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
        tasks: [{ text: "Order Halloween costume", responsible: "Tester", deadline: "2026-11-04", date: null, carryovers: 0 }],
        notes: { priorities: "Finish passport renewal", meals: "Tacos Tue, pasta Thu", logistics: null },
      },
      overdue: [{ text: "Renew passport", responsible: null, deadline: "2026-10-30", date: null, carryovers: 0 }],
    });
    for (const [sql] of mocks.query.mock.calls) expect(String(sql).trim()).toMatch(/^SELECT/i);
  });

  it("accepts an uppercase stored hash", async () => {
    vi.stubEnv("WEEKLY_SUMMARY_TOKEN_SHA256", TOKEN_SHA256.toUpperCase());
    mocks.query.mockResolvedValue(rows([]));
    expect((await GET(request("2026-10-26"))).status).toBe(200);
  });

  it("reports an unknown email as no-account with HTTP 200", async () => {
    mocks.query.mockResolvedValue(rows([]));
    const response = await GET(request("2026-10-26"));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ status: "no-account" });
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("hides database failures behind a generic 500", async () => {
    mocks.query.mockRejectedValue(new Error("relation planning_items does not exist; SELECT secret"));
    const response = await GET(request("2026-10-26"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
  });
});
