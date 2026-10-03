import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
  throw new Error("Membership migration regression requires an explicit local empty _test database.");
}
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  assert.equal((await client.query("select to_regclass('public.households') as existing")).rows[0].existing, null, "use a fresh empty test database");
  await client.query("begin");
  const migrations = (await fs.readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations.filter((name) => name < "020")) {
    await client.query(await fs.readFile(path.join("db/migrations", name), "utf8"));
  }
  const owner = (await client.query("insert into users(email,display_name) values('migration-owner@example.invalid','Synthetic owner') returning id")).rows[0].id;
  const member = (await client.query("insert into users(email,display_name) values('migration-member@example.invalid','Synthetic member') returning id")).rows[0].id;
  const household = (await client.query("insert into households(name) values('Synthetic historical household') returning id")).rows[0].id;
  await client.query("insert into household_members(household_id,user_id) values($1,$2),($1,$3)", [household, owner, member]);
  const calendar = (await client.query("insert into calendar_preferences(household_id,user_id,google_calendar_id,calendar_name,visibility,is_selected) values($1,$2,'synthetic-history','Preserved calendar','share',true) returning id", [household, owner])).rows[0].id;
  const collaboration = (await client.query("insert into item_collaboration(household_id,calendar_preference_id,provider_event_id) values($1,$2,'historical-event') returning id", [household, calendar])).rows[0].id;
  const file = (await client.query("insert into item_collaboration_entries(household_id,collaboration_id,kind,text,created_by,file_data) values($1,$2,'file','history.txt',$3,$4) returning id", [household, collaboration, owner, Buffer.from('synthetic retained historical bytes')])).rows[0].id;
  const reminder = (await client.query("insert into notification_reminders(user_id,household_id,resource_kind,calendar_preference_id,provider_event_id,resource_title,remind_at) values($1,$2,'calendar_event',$3,'historical-event','Historical reminder',now()) returning id", [member, household, calendar])).rows[0].id;
  const outbox = (await client.query("insert into notification_outbox(user_id,household_id,dedupe_key,kind,title,body,scheduled_for) values($1,$2,$3,'reminder','Historical notification','Preserved body',now()) returning id", [member, household, `reminder:${reminder}:synthetic`])).rows[0].id;
  await client.query("insert into notification_deliveries(outbox_id,channel,status) values($1,'email','delivered'),($1,'push','pending')", [outbox]);
  await client.query("delete from household_members where household_id=$1 and user_id=$2", [household, owner]);
  await client.query(await fs.readFile("db/migrations/020_membership_privacy.sql", "utf8"));
  assert.equal((await client.query("select visibility from calendar_preferences where id=$1", [calendar])).rows[0].visibility, "hide");
  assert.deepEqual((await client.query("select created_by,file_data from item_collaboration_entries where id=$1", [file])).rows[0], { created_by: owner, file_data: Buffer.from('synthetic retained historical bytes') });
  assert.equal((await client.query("select resource_title,membership_revoked_at is not null as revoked from notification_reminders where id=$1", [reminder])).rows[0].revoked, true);
  assert.deepEqual((await client.query("select body,membership_revoked_at is not null as revoked from notification_outbox where id=$1", [outbox])).rows[0], { body: "Preserved body", revoked: true });
  assert.deepEqual((await client.query("select channel,status from notification_deliveries where outbox_id=$1 order by channel", [outbox])).rows, [{ channel: "email", status: "delivered" }, { channel: "push", status: "skipped" }]);
  assert.equal((await client.query("select 1 from notification_reminders where id=$1 and delivered_at is null and remind_at <= now() + interval '1 minute'", [reminder])).rowCount, 1, "legacy worker selection would include the retained revoked reminder, so old workers are not rollback-compatible");
  assert.equal((await client.query("select 1 from notification_reminders where id=$1 and membership_revoked_at is null and delivered_at is null and remind_at <= now() + interval '1 minute'", [reminder])).rowCount, 0, "compatible worker selection excludes it");
  process.stdout.write("Preexisting orphan migration preserves ownership, collaboration/file bytes, reminder/outbox content and delivered history while revoking future access/delivery.\n");
} finally {
  await client.query("rollback");
  await client.end();
}
