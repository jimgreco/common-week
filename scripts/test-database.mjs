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
     returning id, section_group, access_role, is_selected`,
    [householdA, userA],
  )).rows[0];
  assert.equal(calendarPreference.section_group, "critical", "new calendars default to the critical section");
  assert.equal(calendarPreference.access_role, "reader", "new calendars default to a non-writable access role");
  assert.equal(calendarPreference.is_selected, false, "new calendars stay private until their owner selects them");
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

  process.stdout.write("Database migration, household isolation, session, and date constraints passed.\n");
} finally {
  await client.query("rollback");
  await client.end();
}
