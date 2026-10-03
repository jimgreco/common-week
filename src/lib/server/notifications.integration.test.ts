import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({ query: mocks.query }));
vi.mock("@/lib/server/planner-data", () => ({ getPlannerData: vi.fn() }));

import {
  getNotificationInbox,
  processNotificationCycle,
  reminderForCalendarEvent,
  upsertCalendarReminder,
  upsertPlanningReminder,
} from "@/lib/server/notifications";

// Explicit opt-in: real SQL against a disposable migrated local database only.
// Provider traffic is replaced by a mock and every fixture is rolled back.
const connectionString = process.env.NOTIFICATION_TEST_DATABASE_URL;
describe.skipIf(!connectionString)("notification revocation with PostgreSQL", () => {
  let client: pg.Client;
  let owner: string;
  let recipient: string;
  let household: string;
  let calendar: string;
  let item: string;
  const sent = vi.fn();
  const dueAt = () => new Date(Date.now() - 10_000);

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.includes("test")) {
      throw new Error("Notification integration tests require a disposable local test database.");
    }
    client = new pg.Client({ connectionString, application_name: "notification-revocation-test" });
    await client.connect();
    vi.stubEnv("RESEND_API_KEY", "synthetic-test-credential");
    vi.stubEnv("NOTIFICATION_EMAIL_FROM", "test@example.invalid");
    vi.stubGlobal("fetch", sent);
  });

  beforeEach(async () => {
    await client.query("begin");
    sent.mockReset().mockResolvedValue({ ok: true, status: 200 });
    mocks.query.mockReset().mockImplementation((sql: string, values?: unknown[]) => client.query(sql, values));
    [owner, recipient, household, calendar, item] = Array.from({ length: 5 }, () => randomUUID());
    await client.query("insert into users(id,email,display_name) values($1,$2,'Owner'),($3,$4,'Recipient')",
      [owner, `${owner}@example.invalid`, recipient, `${recipient}@example.invalid`]);
    await client.query("insert into households(id,name) values($1,'Synthetic notification household')", [household]);
    await client.query("insert into household_members(household_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')",
      [household, owner, recipient]);
    await client.query("insert into calendar_preferences(id,household_id,user_id,google_calendar_id,calendar_name,color,visibility,is_selected) values($1,$2,$3,'synthetic-calendar','Synthetic calendar','#123456','share',true)",
      [calendar, household, owner]);
    await client.query("insert into planning_items(id,household_id,created_by,week_start_date,type,text) values($1,$2,$3,'2026-09-28','task','Synthetic task')",
      [item, household, owner]);
  });

  afterEach(async () => { await client.query("rollback"); });
  afterAll(async () => { await client?.end(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function calendarReminder(userId = recipient, remindAt = dueAt()) {
    return upsertCalendarReminder({ userId, householdId: household, calendarPreferenceId: calendar,
      providerEventId: "synthetic-event", title: "Preserved event title", eventStart: new Date(), remindAt });
  }

  it("keeps an owner's private reminder usable but denies another member", async () => {
    await client.query("update calendar_preferences set visibility='private',is_selected=false where id=$1", [calendar]);
    await expect(calendarReminder(recipient)).rejects.toThrow("no longer available");
    const reminder = await calendarReminder(owner);
    expect(reminder).not.toBeNull();
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await getNotificationInbox(owner)).items).toHaveLength(1);
    expect((await getNotificationInbox(recipient)).items).toEqual([]);
  });

  it("reuses an existing legacy outbox after interrupted reminder materialization", async () => {
    const originalTime = dueAt();
    const reminder = await calendarReminder(recipient, originalTime);
    await client.query(`insert into notification_outbox(user_id,household_id,dedupe_key,kind,title,body,scheduled_for)
      values($1,$2,$3,'reminder','Upcoming event','Preserved event title',$4)`,
    [recipient, household, `reminder:${reminder!.id}:${originalTime.toISOString()}`, originalTime]);
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(1);
    await calendarReminder(recipient, originalTime);
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await client.query("select delivery_version from notification_reminders where id=$1", [reminder!.id])).rows[0].delivery_version).toBeNull();
    expect((await client.query("select id from notification_outbox where household_id=$1", [household])).rowCount).toBe(1);
  });

  it("keeps revoked history inactive after rejoin and requires explicit reminder consent", async () => {
    const originalTime = dueAt();
    const oldReminder = await calendarReminder(recipient, originalTime);
    await processNotificationCycle();
    const oldInbox = await getNotificationInbox(recipient);
    expect(oldInbox.items).toHaveLength(1);
    await client.query("delete from household_members where household_id=$1 and user_id=$2", [household, owner]);
    expect((await getNotificationInbox(recipient)).items).toEqual([]);
    expect(await reminderForCalendarEvent(recipient, calendar, "synthetic-event")).toBeNull();
    expect((await client.query("select body,membership_revoked_at from notification_outbox where id=$1", [oldInbox.items[0].id])).rows[0])
      .toMatchObject({ body: "Preserved event title", membership_revoked_at: expect.any(Date) });
    await client.query("insert into household_members(household_id,user_id,role) values($1,$2,'owner')", [household, owner]);
    await expect(calendarReminder()).rejects.toThrow("no longer available");
    await client.query("update calendar_preferences set visibility='share',is_selected=true where id=$1", [calendar]);
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(1);
    expect((await getNotificationInbox(recipient)).items).toEqual([]);
    const restored = await calendarReminder(recipient, originalTime);
    expect(restored?.id).toBe(oldReminder?.id);
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(2);
    expect((await getNotificationInbox(recipient)).items).toHaveLength(1);
    expect((await client.query("select membership_revoked_at from notification_outbox where id=$1", [oldInbox.items[0].id])).rows[0].membership_revoked_at)
      .toBeInstanceOf(Date);
    expect((await client.query("select delivery_version from notification_reminders where id=$1", [restored!.id])).rows[0].delivery_version)
      .toEqual(expect.any(String));
  });

  it.each(["recipient", "calendar owner"])("rechecks %s departure after selecting a delivery", async (departing) => {
    const reminder = await calendarReminder();
    let revoked = false;
    mocks.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      const result = await client.query(sql, values);
      if (!revoked && sql.includes("select nd.id, nd.outbox_id") && result.rowCount) {
        revoked = true;
        await client.query("delete from household_members where household_id=$1 and user_id=$2",
          [household, departing === "recipient" ? recipient : owner]);
      }
      return result;
    });
    await processNotificationCycle();
    expect(revoked).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    expect((await getNotificationInbox(recipient)).items).toEqual([]);
    expect((await client.query("select resource_title,membership_revoked_at from notification_reminders where id=$1", [reminder!.id])).rows[0])
      .toMatchObject({ resource_title: "Preserved event title", membership_revoked_at: expect.any(Date) });
    expect((await client.query("select nd.status from notification_deliveries nd join notification_outbox no on no.id=nd.outbox_id where no.household_id=$1", [household])).rows)
      .toEqual([{ status: "skipped" }, { status: "skipped" }]);
  });

  it("reactivates a retained planning reminder only through a current authorized upsert", async () => {
    const input = { userId: recipient, householdId: household, itemId: item, title: "Preserved task title", remindAt: dueAt() };
    const reminder = await upsertPlanningReminder(input);
    await client.query("delete from household_members where household_id=$1 and user_id=$2", [household, recipient]);
    await expect(upsertPlanningReminder(input)).rejects.toThrow("no longer available");
    await client.query("insert into household_members(household_id,user_id,role) values($1,$2,'member')", [household, recipient]);
    await processNotificationCycle();
    expect(sent).not.toHaveBeenCalled();
    expect((await upsertPlanningReminder(input))?.id).toBe(reminder?.id);
    await processNotificationCycle();
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
