import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests.");

const client = new Client({
  connectionString,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  application_name: "common-week-database-tests",
});

await client.connect();
await client.query("begin");
try {
  const categoryTable = await client.query("select to_regclass('public.categories') as table_name");
  assert.equal(categoryTable.rows[0].table_name, null, "the retired category catalog is absent");
  const categoryColumn = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'planning_items' and column_name = 'category_id'`,
  );
  assert.equal(categoryColumn.rowCount, 0, "planning items no longer store a category");

  const suffix = randomBytes(6).toString("hex");
  const userA = (await client.query(
    `insert into users (google_subject, email, display_name)
     values ($1, $2, 'Household A') returning id`,
    [`google-a-${suffix}`, `a-${suffix}@example.com`],
  )).rows[0].id;
  const userB = (await client.query(
    `insert into users (google_subject, email, display_name)
     values ($1, $2, 'Household B') returning id`,
    [`google-b-${suffix}`, `b-${suffix}@example.com`],
  )).rows[0].id;
  const householdA = (await client.query("insert into households (name) values ('A') returning id")).rows[0].id;
  const householdB = (await client.query("insert into households (name) values ('B') returning id")).rows[0].id;
  await client.query(
    "insert into household_members (household_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')",
    [householdA, userA, householdB, userB],
  );

  const locationA = (await client.query(
    `insert into locations (household_id, name, latitude, longitude, timezone)
     values ($1, 'A Home', 40, -73, 'America/New_York') returning id`,
    [householdA],
  )).rows[0].id;
  const locationB = (await client.query(
    `insert into locations (household_id, name, latitude, longitude, timezone)
     values ($1, 'B Home', 41, -72, 'America/New_York') returning id`,
    [householdB],
  )).rows[0].id;
  const itemA = (await client.query(
    `insert into planning_items (household_id, created_by, week_start_date, planning_date, type, text)
     values ($1, $2, '2026-08-10', '2026-08-11', 'task', 'Private A task') returning id`,
    [householdA, userA],
  )).rows[0].id;

  const ownRead = await client.query("select id from planning_items where household_id = $1", [householdA]);
  const foreignRead = await client.query("select id from planning_items where household_id = $1", [householdB]);
  assert.equal(ownRead.rowCount, 1, "household A can read its item");
  assert.equal(foreignRead.rowCount, 0, "household B query cannot read household A item");

  const foreignUpdate = await client.query(
    "update planning_items set text = 'tampered' where id = $1 and household_id = $2",
    [itemA, householdB],
  );
  assert.equal(foreignUpdate.rowCount, 0, "a foreign household cannot update an item by ID");

  const foreignLocation = await client.query(
    "select 1 from locations where id = $1 and household_id = $2",
    [locationB, householdA],
  );
  const ownLocation = await client.query(
    "select 1 from locations where id = $1 and household_id = $2",
    [locationA, householdA],
  );
  assert.equal(foreignLocation.rowCount, 0, "foreign locations are rejected");
  assert.equal(ownLocation.rowCount, 1, "own locations are accepted");

  const hiddenEvent = (await client.query(
    `insert into hidden_calendar_events (
       household_id, event_id, title, calendar_name, event_start, hidden_by
     ) values ($1, 'family:event-1', 'Private family event', 'Family', '2026-08-15T19:00:00-04:00', $2)
     returning id`,
    [householdA, userA],
  )).rows[0].id;
  const ownHiddenEvent = await client.query(
    "select id from hidden_calendar_events where id = $1 and household_id = $2",
    [hiddenEvent, householdA],
  );
  const foreignHiddenEvent = await client.query(
    "select id from hidden_calendar_events where id = $1 and household_id = $2",
    [hiddenEvent, householdB],
  );
  assert.equal(ownHiddenEvent.rowCount, 1, "a household can manage its hidden events");
  assert.equal(foreignHiddenEvent.rowCount, 0, "hidden events cannot cross household boundaries");

  const calendarPreference = (await client.query(
    `insert into calendar_preferences (
       household_id, user_id, google_calendar_id, calendar_name, color
     ) values ($1, $2, 'family@example.com', 'Family', '#123456')
     returning id, section_group, access_role, is_selected, visibility`,
    [householdA, userA],
  )).rows[0];
  assert.equal(calendarPreference.section_group, "critical", "new calendars default to the critical section");
  assert.equal(calendarPreference.access_role, "reader", "new calendars default to a non-writable access role");
  assert.equal(calendarPreference.is_selected, false, "new calendars are not shared by default");
  assert.equal(calendarPreference.visibility, "hide", "new calendars are hidden by default");
  const privateCalendarVisibility = await client.query(
    `update calendar_preferences set visibility = 'private'
      where id = $1 and household_id = $2 and user_id = $3
      returning visibility, is_selected`,
    [calendarPreference.id, householdA, userA],
  );
  assert.equal(privateCalendarVisibility.rows[0].visibility, "private", "owners can keep calendars visible only to themselves");
  assert.equal(privateCalendarVisibility.rows[0].is_selected, false, "private calendars are not marked as shared");
  const sharedCalendarVisibility = await client.query(
    `update calendar_preferences set visibility = 'share', is_selected = true
      where id = $1 and household_id = $2 and user_id = $3
      returning visibility, is_selected`,
    [calendarPreference.id, householdA, userA],
  );
  assert.equal(sharedCalendarVisibility.rows[0].visibility, "share", "owners can share calendars with the household");
  assert.equal(sharedCalendarVisibility.rows[0].is_selected, true, "shared calendars retain the compatibility flag");
  const foreignCalendarGroupUpdate = await client.query(
    `update calendar_preferences set section_group = 'supplemental'
      where id = $1 and household_id = $2 and user_id = $3`,
    [calendarPreference.id, householdB, userB],
  );
  assert.equal(foreignCalendarGroupUpdate.rowCount, 0, "calendar groups cannot be changed across households");
  const ownCalendarGroupUpdate = await client.query(
    `update calendar_preferences set section_group = 'supplemental'
      where id = $1 and household_id = $2 and user_id = $3
      returning section_group`,
    [calendarPreference.id, householdA, userA],
  );
  assert.equal(ownCalendarGroupUpdate.rows[0].section_group, "supplemental", "a member can group their own calendar");

  await client.query("savepoint invalid_calendar_group");
  let rejectedInvalidCalendarGroup = false;
  try {
    await client.query(
      "update calendar_preferences set section_group = 'untrusted' where id = $1",
      [calendarPreference.id],
    );
  } catch (error) {
    rejectedInvalidCalendarGroup = error?.code === "23514";
    await client.query("rollback to savepoint invalid_calendar_group");
  }
  assert.equal(rejectedInvalidCalendarGroup, true, "calendar groups reject unknown values");

  const ownCalendarAccessUpdate = await client.query(
    `update calendar_preferences set access_role = 'writer'
      where id = $1 and household_id = $2 and user_id = $3
      returning access_role`,
    [calendarPreference.id, householdA, userA],
  );
  assert.equal(ownCalendarAccessUpdate.rows[0].access_role, "writer", "Google writable access roles are persisted");
  const foreignCalendarAccessUpdate = await client.query(
    `update calendar_preferences set access_role = 'owner'
      where id = $1 and household_id = $2 and user_id = $3`,
    [calendarPreference.id, householdB, userB],
  );
  assert.equal(foreignCalendarAccessUpdate.rowCount, 0, "calendar write access cannot be changed across households");
  await client.query("savepoint invalid_calendar_access");
  let rejectedInvalidCalendarAccess = false;
  try {
    await client.query("update calendar_preferences set access_role = 'editor' where id = $1", [calendarPreference.id]);
  } catch (error) {
    rejectedInvalidCalendarAccess = error?.code === "23514";
    await client.query("rollback to savepoint invalid_calendar_access");
  }
  assert.equal(rejectedInvalidCalendarAccess, true, "calendar access rejects unknown roles");

  const sessionToken = randomBytes(32).toString("base64url");
  const sessionHash = createHash("sha256").update(sessionToken).digest();
  await client.query(
    "insert into auth_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 day')",
    [sessionHash, userA],
  );
  const sessionIdentity = await client.query(
    `select u.id, hm.household_id
       from auth_sessions s join users u on u.id = s.user_id
       left join household_members hm on hm.user_id = u.id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sessionHash],
  );
  assert.equal(sessionIdentity.rows[0].id, userA, "opaque session resolves to the correct user");
  assert.equal(sessionIdentity.rows[0].household_id, householdA, "session receives only its own membership");

  await client.query("savepoint invalid_date");
  let rejectedInvalidDate = false;
  try {
    await client.query(
      `insert into planning_items (household_id, created_by, week_start_date, planning_date, type, text)
       values ($1, $2, '2026-08-10', '2026-08-18', 'note', 'Wrong week')`,
      [householdA, userA],
    );
  } catch (error) {
    rejectedInvalidDate = error?.code === "23514";
    await client.query("rollback to savepoint invalid_date");
  }
  assert.equal(rejectedInvalidDate, true, "date-only week constraints reject an item outside its week");

  await client.query("update planning_items set is_completed = true where id = $1", [itemA]);
  const carryoverRows = await client.query(
    `insert into planning_items (
       household_id, created_by, week_start_date, planning_date, type, text, is_completed
     ) values
       ($1, $2, '2026-08-24', '2026-08-24', 'task', 'Open daily task', false),
       ($1, $2, '2026-08-10', null, 'task', 'Open weekly task', false),
       ($1, $2, '2026-08-17', '2026-08-23', 'task', 'Sunday task', false),
       ($1, $2, '2026-08-17', '2026-08-18', 'task', 'Completed daily task', true),
       ($1, $2, '2026-08-17', '2026-08-18', 'note', 'Old plan', false),
       ($1, $2, '2026-08-24', '2026-08-28', 'task', 'Future task', false),
       ($3, $4, '2026-08-17', '2026-08-18', 'task', 'Foreign open task', false)
     returning id, text`,
    [householdA, userA, householdB, userB],
  );
  const carryoverId = (text) => carryoverRows.rows.find((row) => row.text === text).id;
  const carryoverReminder = (await client.query(
    `insert into notification_reminders (
       user_id, household_id, resource_kind, planning_item_id, resource_title, remind_at
     ) values ($1, $2, 'planning_item', $3, 'Open daily task', '2026-08-24T13:00:00Z')
     returning id`,
    [userA, householdA, carryoverId("Open daily task")],
  )).rows[0].id;
  const carriedAt = "2026-08-27T12:00:00.000Z";
  const firstCarryover = await client.query(
    "select carry_over_open_tasks($1, '2026-08-27', '2026-08-24', $2) as count",
    [householdA, carriedAt],
  );
  assert.equal(firstCarryover.rows[0].count, 3, "daily and weekly open tasks carry in one atomic operation");

  const carriedDaily = (await client.query(
    `select id, planning_date::text, week_start_date::text,
            original_planning_date::text, original_week_start_date::text,
            carryover_count, last_carried_at
       from planning_items where id = $1`,
    [carryoverId("Open daily task")],
  )).rows[0];
  assert.equal(carriedDaily.id, carryoverId("Open daily task"), "daily carryover preserves task identity");
  assert.equal(carriedDaily.planning_date, "2026-08-27", "daily carryover advances to today");
  assert.equal(carriedDaily.week_start_date, "2026-08-24", "daily carryover belongs to today's week");
  assert.equal(carriedDaily.original_planning_date, "2026-08-24", "daily carryover preserves its original date");
  assert.equal(carriedDaily.original_week_start_date, "2026-08-24", "daily carryover preserves its original week");
  assert.equal(carriedDaily.carryover_count, 3, "daily carryover counts every skipped day");
  assert.equal(carriedDaily.last_carried_at.toISOString(), carriedAt, "daily carryover records when it ran");
  const preservedReminder = (await client.query(
    "select id, planning_item_id, remind_at, delivered_at from notification_reminders where id = $1",
    [carryoverReminder],
  )).rows[0];
  assert.equal(preservedReminder.planning_item_id, carriedDaily.id, "carryover keeps reminders attached to the same task");
  assert.equal(preservedReminder.remind_at.toISOString(), "2026-08-24T13:00:00.000Z", "carryover does not silently reschedule reminders");
  assert.equal(preservedReminder.delivered_at, null, "carryover does not mark reminders delivered");

  const carriedWeekly = (await client.query(
    `select planning_date::text, week_start_date::text,
            original_planning_date::text, original_week_start_date::text, carryover_count
       from planning_items where id = $1`,
    [carryoverId("Open weekly task")],
  )).rows[0];
  assert.equal(carriedWeekly.planning_date, null, "weekly tasks remain weekly");
  assert.equal(carriedWeekly.week_start_date, "2026-08-24", "weekly carryover advances to the current week");
  assert.equal(carriedWeekly.original_planning_date, null, "weekly origin does not acquire a daily date");
  assert.equal(carriedWeekly.original_week_start_date, "2026-08-10", "weekly carryover preserves its original week");
  assert.equal(carriedWeekly.carryover_count, 2, "weekly carryover counts every skipped week");

  const sundayTask = (await client.query(
    "select planning_date::text, week_start_date::text, carryover_count from planning_items where id = $1",
    [carryoverId("Sunday task")],
  )).rows[0];
  assert.equal(sundayTask.planning_date, "2026-08-27", "a Sunday task crosses into the next week");
  assert.equal(sundayTask.week_start_date, "2026-08-24", "Sunday-to-Monday carryover updates its week");
  assert.equal(sundayTask.carryover_count, 4, "cross-week daily carryover counts calendar days");

  const unchangedRows = await client.query(
    `select text, planning_date::text, week_start_date::text
       from planning_items where id = any($1::uuid[]) order by text`,
    [[
      carryoverId("Completed daily task"),
      carryoverId("Old plan"),
      carryoverId("Future task"),
      carryoverId("Foreign open task"),
    ]],
  );
  assert.deepEqual(unchangedRows.rows, [
    { text: "Completed daily task", planning_date: "2026-08-18", week_start_date: "2026-08-17" },
    { text: "Foreign open task", planning_date: "2026-08-18", week_start_date: "2026-08-17" },
    { text: "Future task", planning_date: "2026-08-28", week_start_date: "2026-08-24" },
    { text: "Old plan", planning_date: "2026-08-18", week_start_date: "2026-08-17" },
  ], "completed tasks, plans, future tasks, and other households do not carry");

  const repeatedCarryover = await client.query(
    "select carry_over_open_tasks($1, '2026-08-27', '2026-08-24', $2) as count",
    [householdA, "2026-08-27T12:01:00.000Z"],
  );
  assert.equal(repeatedCarryover.rows[0].count, 0, "repeating carryover is idempotent");

  await client.query("update planning_items set is_completed = false where id = $1", [carryoverId("Completed daily task")]);
  const reopenedCarryover = await client.query(
    "select carry_over_open_tasks($1, '2026-08-27', '2026-08-24', $2) as count",
    [householdA, "2026-08-27T12:02:00.000Z"],
  );
  assert.equal(reopenedCarryover.rows[0].count, 1, "reopening an old completed task makes it eligible again");
  const reopenedTask = (await client.query(
    "select planning_date::text, carryover_count from planning_items where id = $1",
    [carryoverId("Completed daily task")],
  )).rows[0];
  assert.deepEqual(reopenedTask, { planning_date: "2026-08-27", carryover_count: 9 }, "reopened tasks continue carrying by date");

  await client.query(
    "insert into notification_preferences (user_id, email_enabled, push_enabled) values ($1, false, true)",
    [userA],
  );
  const inboxNotification = (await client.query(
    `insert into notification_outbox (
       user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
     ) values ($1, $2, $3, 'reminder', 'Reminder', 'Private A task', '/planner?week=2026-08-24', now())
     returning id, read_at`,
    [userA, householdA, `database-test:${suffix}`],
  )).rows[0];
  assert.equal(inboxNotification.read_at, null, "new inbox notifications begin unread");
  await client.query(
    `insert into notification_deliveries (outbox_id, channel, status, attempts, last_error)
     values ($1, 'email', 'skipped', 0, 'Email is disabled.'),
            ($1, 'push', 'failed', 2, 'Push unavailable.')`,
    [inboxNotification.id],
  );
  const channelStates = await client.query(
    `select channel, status, attempts from notification_deliveries
      where outbox_id = $1 order by channel`,
    [inboxNotification.id],
  );
  assert.deepEqual(channelStates.rows, [
    { channel: "email", status: "skipped", attempts: 0 },
    { channel: "push", status: "failed", attempts: 2 },
  ], "email and push retain independent delivery state");
  const foreignInboxRead = await client.query(
    "update notification_outbox set read_at = now() where id = $1 and user_id = $2",
    [inboxNotification.id, userB],
  );
  assert.equal(foreignInboxRead.rowCount, 0, "another user cannot mark inbox history read");
  const ownInboxRead = await client.query(
    "update notification_outbox set read_at = now() where id = $1 and user_id = $2 returning read_at",
    [inboxNotification.id, userA],
  );
  assert.ok(ownInboxRead.rows[0].read_at, "the owning user can mark inbox history read");
  const schedulerState = await client.query(
    "select last_processed_at from notification_scheduler_state where singleton = true",
  );
  assert.equal(schedulerState.rowCount, 1, "the notification catch-up checkpoint is durable");

  await client.query("savepoint invalid_carryover_target");
  let rejectedInvalidCarryoverTarget = false;
  try {
    await client.query(
      "select carry_over_open_tasks($1, '2026-08-27', '2026-08-25', now())",
      [householdA],
    );
  } catch (error) {
    rejectedInvalidCarryoverTarget = error?.code === "P0001";
    await client.query("rollback to savepoint invalid_carryover_target");
  }
  assert.equal(rejectedInvalidCarryoverTarget, true, "carryover rejects a non-Monday target week");

  process.stdout.write("Database migration, household isolation, notification delivery, date constraints, and task carryover passed.\n");
} finally {
  await client.query("rollback");
  await client.end();
}
