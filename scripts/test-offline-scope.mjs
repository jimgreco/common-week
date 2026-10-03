import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const databaseURL = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
const baseURL = new URL(process.env.OFFLINE_SCOPE_TEST_BASE_URL || "http://invalid");
const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!local(databaseURL) || !databaseURL.pathname.endsWith("_test") || !local(baseURL)) {
  throw new Error("Offline scope tests require explicit local _test DATABASE_URL and OFFLINE_SCOPE_TEST_BASE_URL.");
}
const database = new pg.Client({ connectionString: databaseURL.toString(), application_name: "offline-household-scope-test" });
const userIds = [], householdIds = [];
const date = new Date();
date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
const week = date.toISOString().slice(0, 10);
const scopeHeaders = (user, household = user.householdId) => ({
  "X-Week-Of-Us-User": user.id, "X-Week-Of-Us-Household": household,
});
await database.connect();
try {
  async function account() {
    const id = randomUUID(), householdId = randomUUID(), locationId = randomUUID();
    userIds.push(id); householdIds.push(householdId);
    const token = randomBytes(32).toString("base64url");
    await database.query("insert into users(id,email,display_name) values($1,$2,'Synthetic offline scope')", [id, `${id}@example.invalid`]);
    await database.query("insert into households(id,name,timezone) values($1,'Synthetic scope','UTC')", [householdId]);
    await database.query("insert into household_members(household_id,user_id,role) values($1,$2,'owner')", [householdId, id]);
    await database.query("insert into auth_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest(), id]);
    await database.query("insert into locations(id,household_id,name,latitude,longitude,timezone) values($1,$2,'Synthetic location',0,0,'UTC')", [locationId, householdId]);
    return { id, householdId, locationId, token };
  }
  async function request(user, path, method, body, headers) {
    const response = await fetch(new URL(path, baseURL), {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}`, ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const first = await account(), second = await account();
  const mismatches = [
    { ...scopeHeaders(first), "X-Week-Of-Us-User": second.id },
    { ...scopeHeaders(first), "X-Week-Of-Us-Household": second.householdId },
    { "X-Week-Of-Us-User": first.id },
    { "X-Week-Of-Us-Household": first.householdId },
  ];
  const draft = () => ({ id: randomUUID(), text: "Synthetic held offline note", type: "note", weekStartDate: week });
  const location = { startDate: week, locationId: first.locationId, scope: "day" };
  for (const headers of mismatches) {
    const created = await request(first, "/api/ios/planning-items", "POST", draft(), headers);
    const assigned = await request(first, "/api/ios/locations", "PATCH", location, headers);
    for (const result of [created, assigned]) {
      assert.equal(result.status, 400, "mismatched or partial identity preconditions must reject before writing");
      assert.equal(result.body.ok, false);
      assert.match(result.body.error, /account or household changed/);
    }
  }
  assert.equal((await database.query("select 1 from planning_items where household_id=any($1::uuid[])", [householdIds])).rowCount, 0);
  assert.equal((await database.query("select 1 from daily_member_settings where household_id=any($1::uuid[])", [householdIds])).rowCount, 0);
  for (const headers of [scopeHeaders(first), {}]) {
    assert.equal((await request(first, "/api/ios/planning-items", "POST", draft(), headers)).status, 200, "matching scopes and legacy clients without preconditions remain compatible");
    assert.equal((await request(first, "/api/ios/locations", "PATCH", location, headers)).status, 200);
  }

  // Change only synthetic membership after the native device's preflight.
  await database.query("delete from household_members where user_id=$1", [first.id]);
  await database.query("insert into household_members(household_id,user_id,role) values($1,$2,'member')", [second.householdId, first.id]);
  const stale = draft();
  assert.equal((await request(first, "/api/ios/planning-items", "POST", stale, scopeHeaders(first))).status, 400, "membership change after preflight cannot redirect a pending create");
  assert.equal((await request(first, "/api/ios/locations", "PATCH", { ...location, locationId: second.locationId }, scopeHeaders(first))).status, 400);
  assert.equal((await database.query("select 1 from planning_items where id=$1", [stale.id])).rowCount, 0, "rejected replay has no cross-household side effect");
  assert.equal((await request(second, "/api/ios/planning-items", "POST", draft(), scopeHeaders(first, second.householdId))).status, 400, "switching bearer accounts in one household cannot change draft authorship");
  process.stdout.write("Offline replay user/household preconditions, no-side-effect rejection, membership changes and legacy compatibility passed.\n");
} finally {
  await database.query("delete from households where id=any($1::uuid[])", [householdIds]);
  await database.query("delete from users where id=any($1::uuid[])", [userIds]);
  await database.end();
}
