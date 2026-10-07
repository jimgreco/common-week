import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { spawn } from "node:child_process";

const databaseURL = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
const baseURL = new URL(process.env.OFFLINE_RECOVERY_TEST_BASE_URL || "http://127.0.0.1:3099");
const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
if (!local(databaseURL) || !databaseURL.pathname.endsWith("_test") || !local(baseURL)) throw new Error("Recovery tests require local _test DATABASE_URL and OFFLINE_RECOVERY_TEST_BASE_URL.");
const db = new pg.Client({ connectionString: databaseURL.toString(), application_name: "offline-recovery-synthetic-test" });
const users = [], households = [];
await db.connect();
let server;
try {
  if (!process.env.OFFLINE_RECOVERY_TEST_BASE_URL) {
    server = spawn(process.execPath, ["scripts/start-smoke.mjs"], {
      env: { ...process.env, ENABLE_DEMO: "false", HOSTNAME: "127.0.0.1", PORT: baseURL.port,
        NEXT_PUBLIC_APP_URL: baseURL.origin, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore",
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error("Synthetic recovery server exited before readiness.");
      try { if ((await fetch(new URL("/api/health", baseURL))).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("Synthetic recovery server did not become ready.");
  }
  async function account(role = "owner", householdId = randomUUID()) {
    const id = randomUUID(), token = randomBytes(32).toString("base64url");
    users.push(id);
    if (!households.includes(householdId)) {
      households.push(householdId);
      await db.query("insert into households(id,name,timezone) values($1,'Synthetic recovery','UTC')", [householdId]);
    }
    await db.query("insert into users(id,email,display_name) values($1,$2,'Synthetic recovery')", [id, `${id}@example.invalid`]);
    await db.query("insert into household_members(household_id,user_id,role) values($1,$2,$3)", [householdId, id, role]);
    await db.query("insert into auth_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest(), id]);
    return { id, token, householdId };
  }
  const a = await account(), b = await account(), viewer = await account("viewer", a.householdId);
  const draft = () => ({ action: "review", originalUserId: a.id, originalHouseholdId: a.householdId, sourceMutationId: randomUUID(), sourceDigest: "a".repeat(64), draft: { id: randomUUID(), text: "Synthetic recovery text", type: "note", planningDate: null, weekStartDate: "2026-10-05" } });
  async function request(user, body, headers = {}) {
    const response = await fetch(new URL("/api/ios/offline-recovery", baseURL), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}`, "X-Week-Of-Us-User": body.originalUserId, "X-Week-Of-Us-Household": body.originalHouseholdId, ...headers }, body: JSON.stringify(body) });
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, ...(await response.json()) };
  }
  const input = draft();
  assert.equal((await request(a, input)).data.status, "ready");
  assert.equal((await db.query("select 1 from planning_items where id=$1", [input.draft.id])).rowCount, 0, "review/cancel must not create anything");
  for (const changed of [b, viewer]) assert.equal((await request(changed, input)).status, 409);
  assert.equal((await request(a, input, { "X-Week-Of-Us-Household": "" })).status, 409);
  assert.equal((await request(a, { ...input, originalHouseholdId: b.householdId })).status, 409);
  const badDate = draft(); badDate.draft.planningDate = "2026-02-30";
  assert.equal((await request(a, badDate)).status, 400);
  const oldAssignments = draft(); oldAssignments.draft.assignedMemberIds = [b.id];
  assert.equal((await request(a, oldAssignments)).status, 400, "old assignments/reminders cannot enter recovery");
  const oversized = draft(); oversized.draft.text = "x".repeat(17000);
  assert.equal((await request(a, oversized)).status, 413);
  const viewerInput = { ...draft(), action: "recover", originalUserId: viewer.id };
  assert.equal((await request(viewer, viewerInput)).status, 409);

  const attempts = await Promise.all(Array.from({ length: 5 }, () => request(a, { ...input, action: "recover" })));
  attempts.forEach((result) => assert.equal(result.data.status, "recovered"));
  assert.equal((await db.query("select 1 from planning_items where id=$1", [input.draft.id])).rowCount, 1);
  assert.equal((await db.query("select 1 from offline_draft_recoveries where source_mutation_id=$1", [input.sourceMutationId])).rowCount, 1);
  const saved = (await db.query("select * from planning_items where id=$1", [input.draft.id])).rows[0];
  assert.equal(saved.household_id, a.householdId); assert.equal(saved.created_by, a.id);
  assert.deepEqual(saved.assigned_member_ids, []); assert.equal(saved.child_id, null); assert.equal(saved.planning_date, null);
  assert.equal((await db.query("select 1 from notification_reminders where household_id=any($1::uuid[])", [households])).rowCount, 0);
  assert.equal((await db.query("select 1 from notification_outbox where household_id=any($1::uuid[])", [households])).rowCount, 0);
  assert.equal((await request(a, { ...input, sourceDigest: "b".repeat(64) })).data.status, "conflict");
  assert.equal((await request(a, { ...input, draft: { ...input.draft, text: "changed bytes" } })).data.status, "conflict");
  await db.query("delete from planning_items where id=$1", [input.draft.id]);
  assert.equal((await request(a, { ...input, action: "recover" })).data.status, "recovered");
  assert.equal((await db.query("select 1 from planning_items where id=$1", [input.draft.id])).rowCount, 0, "retry cannot resurrect a deleted recovery");

  const conflict = draft();
  await db.query("insert into planning_items(id,household_id,created_by,text,type,week_start_date) values($1,$2,$3,'Newer household text','note','2026-10-05')", [conflict.draft.id, a.householdId, a.id]);
  for (const action of ["review", "recover"]) {
    const result = await request(a, { ...conflict, action });
    assert.equal(result.data.status, "existing"); assert.equal(result.data.item.text, "Newer household text");
  }
  // A hidden collision returns no other household's item details and is never overwritten.
  const hidden = draft();
  await db.query("insert into planning_items(id,household_id,created_by,text,type,week_start_date) values($1,$2,$3,'Other household private text','note','2026-10-05')", [hidden.draft.id, b.householdId, b.id]);
  const hiddenResult = await request(a, { ...hidden, action: "recover" });
  assert.equal(hiddenResult.data.status, "conflict"); assert.equal(hiddenResult.data.item, undefined);

  // Switch only synthetic membership after the client reviewed the draft.
  const stale = draft(); assert.equal((await request(a, stale)).data.status, "ready");
  await db.query("delete from household_members where user_id=$1", [a.id]);
  await db.query("insert into household_members(household_id,user_id,role) values($1,$2,'member')", [b.householdId, a.id]);
  assert.equal((await request(a, { ...stale, action: "recover" })).status, 409);
  assert.equal((await db.query("select 1 from planning_items where id=$1", [stale.draft.id])).rowCount, 0);
  const rebound = { ...input, action: "recover", originalHouseholdId: b.householdId };
  assert.equal((await request(a, rebound)).data.status, "conflict", "receipt cannot be rebound to another household");
  process.stdout.write("Offline recovery: identity and role guards, cancellation, malformed input, conflicts, concurrent retries, receipt retention, no notifications and membership changes passed.\n");
} finally {
  server?.kill();
  await db.query("delete from households where id=any($1::uuid[])", [households]);
  await db.query("delete from users where id=any($1::uuid[])", [users]);
  await db.end();
}
