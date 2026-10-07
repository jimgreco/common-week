import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

const adminURL = new URL(process.env.ROLE_TEST_ADMIN_DATABASE_URL || "postgresql://invalid/invalid");
if (!["localhost", "127.0.0.1", "[::1]"].includes(adminURL.hostname) || !adminURL.pathname.endsWith("_test")) {
  throw new Error("An explicit local _test ROLE_TEST_ADMIN_DATABASE_URL is required. Never use a production database.");
}
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const owner = `planner_owner_${suffix}`, outsider = `planner_other_${suffix}`, databaseName = `planner_roles_${suffix}_test`;
const admin = new pg.Client({ connectionString: adminURL.toString(), application_name: "recovery-role-fixture-admin" });
const dbURL = new URL(adminURL); dbURL.pathname = "/" + databaseName; dbURL.username = owner; dbURL.password = "";
let databaseCreated = false, ownerCreated = false, outsiderCreated = false, app;
async function run(script, url, args = [], expectedCode = 0) {
  const env = { ...process.env, DATABASE_URL: url.toString(), PGSSL: "false" };
  delete env.OFFLINE_RECOVERY_TEST_BASE_URL;
  const child = spawn(process.execPath, [script, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code !== expectedCode) { process.stderr.write(output); throw new Error(`${script} failed with exit ${code}`); }
  process.stdout.write(output);
}
await admin.connect();
try {
  // All role/database mutations in this test are confined to this disposable local cluster.
  await admin.query(`create role ${owner} login nosuperuser nobypassrls nocreatedb nocreaterole inherit`); ownerCreated = true;
  await admin.query(`create role ${outsider} login nosuperuser nobypassrls nocreatedb nocreaterole noinherit`); outsiderCreated = true;
  await admin.query(`create database ${databaseName} owner ${owner}`); databaseCreated = true;
  await run("scripts/migrate.mjs", dbURL);
  app = new pg.Client({ connectionString: dbURL.toString(), application_name: "recovery-role-owner-check" }); await app.connect();
  // Rehearse the upgrade boundary with all pre-022 tables intact and the new
  // receipt table absent. Only this fresh synthetic table/ledger row is removed.
  await app.query("drop table offline_draft_recoveries");
  await app.query("delete from app_schema_migrations where name='022_offline_draft_recovery.sql'");
  await run("scripts/check-offline-recovery-role.mjs", dbURL, ["--before-migration"]);
  await run("scripts/check-offline-recovery-role.mjs", dbURL, ["--require-compatible"], 1);
  await run("scripts/migrate.mjs", dbURL);
  const role = (await app.query("select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
  assert.equal(role.name, owner); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  const shape = (await app.query(`select pg_get_userbyid(relowner) as owner,relrowsecurity,relforcerowsecurity,row_security_active(oid) as active
    from pg_class where oid='offline_draft_recoveries'::regclass`)).rows[0];
  assert.deepEqual(shape, { owner, relrowsecurity: true, relforcerowsecurity: false, active: false });
  process.stdout.write("Matched live role shape: dedicated non-superuser database/table owner, no BYPASSRLS, RLS enabled without FORCE.\n");
  // The actual production-built HTTP app and its synthetic fixtures use this same
  // restricted owner login. No superuser participates in migrations or recovery.
  await run("scripts/check-offline-recovery-role.mjs", dbURL, ["--require-compatible"]);
  await run("scripts/test-offline-recovery.mjs", dbURL);

  const user = randomUUID(), household = randomUUID(), source = randomUUID(), item = randomUUID();
  await app.query("insert into users(id,email,display_name) values($1,$2,'Synthetic role owner')", [user, `${user}@example.invalid`]);
  await app.query("insert into households(id,name) values($1,'Synthetic role owner')", [household]);
  await app.query("insert into offline_draft_recoveries(user_id,source_mutation_id,household_id,source_digest,draft_digest,item_id) values($1,$2,$3,$4,$4,$5)", [user, source, household, "a".repeat(64), item]);
  const otherURL = new URL(dbURL); otherURL.username = outsider;
  const other = new pg.Client({ connectionString: otherURL.toString(), application_name: "recovery-role-denial-check" }); await other.connect();
  try {
    await assert.rejects(other.query("select * from offline_draft_recoveries"), { code: "42501" });
    // Even table-scoped SELECT/INSERT alone cannot bypass the no-policy RLS gate.
    // These grants affect only this synthetic table and role, never production.
    await app.query(`grant select,insert on offline_draft_recoveries to ${outsider}`);
    const rows = await other.query("select user_id from offline_draft_recoveries");
    assert.equal(rows.rowCount, 0, "non-owner must not read the owner's receipt");
    assert.equal((await other.query("select row_security_active('offline_draft_recoveries'::regclass) as active")).rows[0].active, true);
    await run("scripts/check-offline-recovery-role.mjs", otherURL, ["--before-migration"], 1);
    await run("scripts/check-offline-recovery-role.mjs", otherURL, ["--require-compatible"], 1);
    await assert.rejects(other.query("insert into offline_draft_recoveries(user_id,source_mutation_id,household_id,source_digest,draft_digest,item_id) values($1,$2,$3,$4,$4,$5)", [user, randomUUID(), household, "b".repeat(64), randomUUID()]), { code: "42501" });
    await app.query(`revoke select,insert on offline_draft_recoveries from ${outsider}`);
    await assert.rejects(other.query("select * from offline_draft_recoveries"), { code: "42501" });
  } finally { await other.end(); }
  assert.equal((await app.query("select * from offline_draft_recoveries where source_mutation_id=$1", [source])).rowCount, 1);
  process.stdout.write("Separate-role denial passed: no privilege by default; table-scoped grants alone reveal zero receipts and still reject inserts; owner receipt unchanged.\n");
} finally {
  await app?.end().catch(() => {});
  if (databaseCreated) await admin.query(`drop database ${databaseName} with (force)`);
  if (outsiderCreated) await admin.query(`drop role ${outsider}`);
  if (ownerCreated) await admin.query(`drop role ${owner}`);
  await admin.end();
}
