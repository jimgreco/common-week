import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

// This suite exercises real sessions, HTTP handlers, and PostgreSQL together.
// It creates isolated households and removes only its own fixtures afterward.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for family planning integration tests.");
const baseURL = process.env.FAMILY_TEST_BASE_URL ?? "http://127.0.0.1:3098";
const base = new URL(baseURL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Family planning integration tests must use a local application server.");
}
const client = new pg.Client({ connectionString, application_name: "family-planning-integration-tests" });
let server;
let serverLog = "";
const householdIds = [];
const userIds = [];
const suffix = randomBytes(6).toString("hex");
const today = new Date().toISOString().slice(0, 10);
const addDays = (date, days) => {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};
const currentMonday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
const week = addDays(currentMonday, 7);

async function api(token, path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`${baseURL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { status: response.status, ...result };
}
async function family(token, requested = week) {
  const result = await api(token, `/api/ios/family-planning?week=${requested}`);
  assert.equal(result.ok, true, result.error);
  return result.data;
}
async function change(token, input, requested = week) {
  const result = await api(token, "/api/ios/family-planning", { weekStart: requested, ...input });
  assert.equal(result.ok, true, result.error);
  return result.data;
}
async function rejected(token, input, label) {
  const result = await api(token, "/api/ios/family-planning", { weekStart: week, ...input });
  assert.equal(result.ok, false, label);
  assert.ok(result.status >= 400, label);
}
async function planner(token, requested = week) {
  const result = await api(token, `/api/ios/planner?week=${requested}`);
  assert.equal(result.ok, true, result.error);
  return result.data.planner;
}
const items = (data) => [...data.weeklyItems, ...data.days.flatMap((day) => day.items)];
async function makeUser(householdId, role, name) {
  const userId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await client.query("insert into users (id,email,display_name) values ($1,$2,$3)", [userId, `${role}-${userId}@example.com`, name]);
  userIds.push(userId);
  await client.query("insert into household_members (household_id,user_id,role) values ($1,$2,$3)", [householdId, userId, role]);
  await client.query("insert into auth_sessions (token_hash,user_id,expires_at) values ($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest(), userId]);
  return { userId, token };
}

await client.connect();
try {
  if (!process.env.FAMILY_TEST_BASE_URL) {
    server = spawn(process.execPath, ["scripts/start-smoke.mjs"], {
      env: { ...process.env, ENABLE_DEMO: "false", NEXT_PUBLIC_APP_URL: baseURL, SESSION_COOKIE_SECURE: "false", NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: base.port },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-12000); });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${serverLog}`);
      try { ready = (await fetch(`${baseURL}/api/health`)).ok; } catch { /* Server is starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, `Test server did not start: ${serverLog}`);
  }

  for (const name of ["Family A", "Family B"]) {
    const row = await client.query("insert into households (name,timezone) values ($1,'UTC') returning id", [`${name} ${suffix}`]);
    householdIds.push(row.rows[0].id);
  }
  const owner = await makeUser(householdIds[0], "owner", "Alex");
  const partner = await makeUser(householdIds[0], "member", "Sam");
  const viewer = await makeUser(householdIds[0], "viewer", "Viewer");
  const outsider = await makeUser(householdIds[1], "owner", "Outside");
  assert.equal((await api(null, `/api/ios/family-planning?week=${week}`)).status, 401);

  const child = { id: randomUUID(), name: "Miriam", color: "#678D76", calendarPreferenceIds: [] };
  await change(owner.token, { action: "saveChild", child });
  await change(owner.token, { action: "saveChild", child });
  assert.equal((await family(partner.token)).children.length, 1, "child profile is shared and retries are idempotent");
  assert.equal((await family(outsider.token)).children.length, 0, "children do not cross households");
  await rejected(viewer.token, { action: "saveChild", child: { ...child, name: "Changed" } }, "viewers cannot edit profiles");
  await rejected(outsider.token, { action: "deleteChild", id: child.id }, "a foreign household cannot delete a child");

  const privateCalendar = randomUUID();
  const foreignCalendar = randomUUID();
  const hiddenCalendar = randomUUID();
  for (const [id, householdId, userId, visibility] of [
    [privateCalendar, householdIds[0], owner.userId, "private"],
    [hiddenCalendar, householdIds[0], owner.userId, "hide"],
    [foreignCalendar, householdIds[1], outsider.userId, "private"],
  ]) {
    await client.query("insert into calendar_preferences(id,household_id,user_id,google_calendar_id,calendar_name,visibility,is_selected) values($1,$2,$3,$4,'Child schedule',$5,false)", [id, householdId, userId, `${id}@example.com`, visibility]);
  }
  await change(owner.token, { action: "saveChild", child: { ...child, calendarPreferenceIds: [privateCalendar] } });
  assert.deepEqual((await family(partner.token)).children[0].calendarPreferenceIds, [], "linking a child's calendar does not expose another adult's private calendar");
  await change(partner.token, { action: "saveChild", child: { ...child, name: "Miriam revised" } });
  assert.deepEqual((await family(owner.token)).children[0].calendarPreferenceIds, [privateCalendar], "another adult's profile edit preserves private calendar links");
  await rejected(owner.token, { action: "saveChild", child: { ...child, calendarPreferenceIds: [foreignCalendar] } }, "foreign calendars cannot be linked");
  await rejected(owner.token, { action: "saveChild", child: { ...child, calendarPreferenceIds: [hiddenCalendar] } }, "hidden calendars cannot be linked");

  const sharedCalendar = randomUUID();
  await client.query("insert into calendar_preferences(id,household_id,user_id,google_calendar_id,calendar_name,visibility,is_selected) values($1,$2,$3,$4,'Shared family calendar','share',true)", [sharedCalendar,householdIds[0],owner.userId,`${sharedCalendar}@example.com`]);
  const adult = async (token, userId) => (await family(token)).adults.find((entry) => entry.userId === userId);
  assert.ok((await adult(owner.token,owner.userId)).calendarPreferenceIds.includes(sharedCalendar), "new calendars initially belong to the connected adult");
  const adultMutation = { action: "saveAdultCalendars", userId: partner.userId, calendarPreferenceIds: [privateCalendar,sharedCalendar] };
  await change(owner.token, adultMutation);
  await change(owner.token, adultMutation);
  assert.deepEqual((await adult(partner.token,partner.userId)).calendarPreferenceIds, [sharedCalendar], "assignments do not expose another person's private calendar");
  await change(partner.token, { ...adultMutation, calendarPreferenceIds: [sharedCalendar] });
  assert.deepEqual((await adult(owner.token,partner.userId)).calendarPreferenceIds.sort(), [privateCalendar,sharedCalendar].sort(), "editing a visible subset preserves private links");
  await rejected(viewer.token, adultMutation, "viewers cannot edit adult assignments");
  await rejected(owner.token, { ...adultMutation, userId: outsider.userId }, "foreign adults cannot be assigned calendars");
  await rejected(owner.token, { ...adultMutation, calendarPreferenceIds: [foreignCalendar] }, "foreign calendars cannot be assigned to adults");
  await rejected(partner.token, { ...adultMutation, calendarPreferenceIds: [privateCalendar] }, "another person's private calendar cannot be assigned");
  await rejected(owner.token, { ...adultMutation, calendarPreferenceIds: [hiddenCalendar] }, "hidden calendars cannot be assigned");
  await assert.rejects(client.query("insert into adult_calendar_links values($1,$2,$3)", [householdIds[0],outsider.userId,sharedCalendar]), { code: "23503" });
  await assert.rejects(client.query("insert into adult_calendar_links values($1,$2,$3)", [householdIds[0],owner.userId,foreignCalendar]), { code: "23503" });
  await change(owner.token, { ...adultMutation, calendarPreferenceIds: [] });
  assert.deepEqual((await adult(owner.token,partner.userId)).calendarPreferenceIds, [], "all visible assignments can be explicitly cleared");
  assert.ok((await adult(owner.token,owner.userId)).calendarPreferenceIds.includes(sharedCalendar), "removing one adult's assignment preserves another adult's assignment");

  const taskId = randomUUID();
  const taskDraft = { id: taskId, text: "Bring library books", type: "task", weekStartDate: week, planningDate: week, childId: child.id };
  assert.equal((await api(owner.token, "/api/ios/planning-items", taskDraft)).ok, true);
  assert.equal((await api(viewer.token, "/api/ios/planning-items", { ...taskDraft, text: "Viewer edit" }, "PATCH")).ok, false, "viewers cannot edit shared tasks");
  await assert.rejects(client.query("insert into planning_items(household_id,created_by,week_start_date,type,text,child_id) values($1,$2,$3::date,'task','Foreign child',$4)", [householdIds[1], outsider.userId, week, child.id]), { code: "23503" }, "storage rejects cross-household child references");
  await assert.rejects(client.query("insert into child_calendar_links(child_id,calendar_preference_id) values($1,$2)", [child.id, foreignCalendar]), { code: "23514" }, "storage rejects cross-household calendar links");
  const { childId: omitted, ...olderClientDraft } = taskDraft;
  void omitted;
  assert.equal((await api(partner.token, "/api/ios/planning-items", { ...olderClientDraft, text: "Bring both library books" }, "PATCH")).ok, true);
  assert.equal(items(await planner(owner.token)).find((item) => item.id === taskId)?.childId, child.id, "older clients preserve child associations");
  const foreignTask = await api(outsider.token, "/api/ios/planning-items", { ...taskDraft, id: randomUUID() });
  assert.equal(foreignTask.ok, false, "foreign child IDs are rejected");
  await rejected(outsider.token, { action: "assignChild", itemId: taskId, childId: null }, "foreign items cannot be reassigned");

  const routine = { id: randomUUID(), text: "Pack school bag", childId: child.id, frequency: "daily", interval: 1, weekdays: [0, 1, 2, 3, 4], startsOn: week, endsOn: null, active: true };
  await change(owner.token, { action: "saveRoutine", routine });
  const firstIds = items(await planner(owner.token)).filter((item) => item.routineId === routine.id).map((item) => item.id).sort();
  await change(owner.token, { action: "saveRoutine", routine });
  assert.deepEqual(items(await planner(owner.token)).filter((item) => item.routineId === routine.id).map((item) => item.id).sort(), firstIds, "retrying a routine save preserves existing occurrence identities");
  await Promise.all(Array.from({ length: 4 }, () => planner(partner.token)));
  let generated = items(await planner(owner.token)).filter((item) => item.routineId === routine.id);
  assert.equal(generated.length, 5, "concurrent week loads create each weekday occurrence once");
  assert.equal(new Set(generated.map((item) => item.id)).size, 5);
  assert.ok(generated.every((item) => item.childId === child.id));
  const completedId = generated[0].id;
  assert.equal((await api(partner.token, "/api/ios/planning-items", { action: "toggle", id: completedId, completed: true }, "PATCH")).ok, true);
  const deletedId = generated[1].id;
  assert.equal((await api(owner.token, "/api/ios/planning-items", { id: deletedId }, "DELETE")).ok, true);
  generated = items(await planner(owner.token)).filter((item) => item.routineId === routine.id);
  assert.equal(generated.length, 4, "deleting an occurrence does not recreate it on refresh");
  assert.equal(generated.find((item) => item.id === completedId)?.isCompleted, true, "completed occurrences remain completed");
  const nextWeek = addDays(week, 7);
  const nextOccurrences = items(await planner(owner.token, nextWeek)).filter((item) => item.routineId === routine.id);
  assert.equal(nextOccurrences.length, 5, "the next week receives fresh occurrences");
  assert.ok(nextOccurrences.every((item) => !item.isCompleted));

  const reminded = nextOccurrences[0];
  const moved = nextOccurrences[1];
  const remindAt = `${reminded.planningDate}T08:00:00.000Z`;
  assert.equal((await api(owner.token, "/api/ios/planning-items", { id: reminded.id, text: reminded.text, type: "task", weekStartDate: nextWeek, planningDate: reminded.planningDate, remindAt }, "PATCH")).ok, true);
  assert.equal((await api(owner.token, "/api/ios/planning-items", { id: moved.id, text: moved.text, type: "task", weekStartDate: nextWeek, planningDate: addDays(moved.planningDate, 1) }, "PATCH")).ok, true);
  const revisedRoutine = { ...routine, text: "Pack school bag and lunch" };
  await change(owner.token, { action: "saveRoutine", routine: revisedRoutine });
  const revisedOccurrence = items(await planner(owner.token, nextWeek)).find((item) => item.id === reminded.id);
  assert.equal(revisedOccurrence?.text, revisedRoutine.text, "routine edits preserve the identity of matching future occurrences");
  assert.equal(revisedOccurrence?.reminder?.remindAt, remindAt, "routine edits retain existing reminders");
  assert.equal(items(await planner(owner.token, nextWeek)).find((item) => item.id === moved.id)?.planningDate, addDays(moved.planningDate, 1), "routine edits preserve an intentionally rescheduled task");

  const alternate = { id: randomUUID(), text: "Change bed sheets", childId: null, frequency: "weekly", interval: 2, weekdays: [], startsOn: week, endsOn: null, active: true };
  await change(owner.token, { action: "saveRoutine", routine: alternate });
  const weeklyOccurrences = items(await planner(owner.token)).filter((item) => item.routineId === alternate.id);
  assert.equal(weeklyOccurrences.length, 1);
  assert.equal(weeklyOccurrences[0].planningDate, null, "weekly routines retain undated weekly placement");
  assert.equal(items(await planner(owner.token, nextWeek)).filter((item) => item.routineId === alternate.id).length, 0);
  assert.equal(items(await planner(owner.token, addDays(week, 14))).filter((item) => item.routineId === alternate.id).length, 1);
  await change(owner.token, { action: "saveRoutine", routine: { ...revisedRoutine, active: false } });
  assert.equal(items(await planner(owner.token, addDays(week, 21))).filter((item) => item.routineId === routine.id).length, 0, "paused routines stop generating new occurrences");
  assert.ok(items(await planner(owner.token, nextWeek)).some((item) => item.id === moved.id), "stopping a routine keeps an intentionally rescheduled occurrence");
  await rejected(outsider.token, { action: "deleteRoutine", id: alternate.id }, "routine deletion is household scoped");

  const adopted = { id: randomUUID(), text: "Bring both library books", childId: child.id, frequency: "weekly", interval: 1, weekdays: [0], startsOn: week, endsOn: null, active: true };
  await change(owner.token, { action: "saveRoutine", sourceItemId: taskId, routine: adopted });
  const firstAdopted = items(await planner(owner.token)).filter((item) => item.routineId === adopted.id);
  assert.equal(firstAdopted.length, 1, "repeating an existing task does not duplicate its first occurrence");
  assert.equal(firstAdopted[0].id, taskId, "the source task keeps its identity when made recurring");
  await change(owner.token, { action: "saveRoutine", sourceItemId: taskId, routine: adopted });
  assert.deepEqual(items(await planner(owner.token)).filter((item) => item.routineId === adopted.id).map((item) => item.id), [taskId], "retrying source-task adoption does not duplicate it");

  // Templates copy only one-off plans/tasks. Recurring tasks continue through
  // their schedules and must not be duplicated by a template application.
  const templateNoteId = randomUUID();
  assert.equal((await api(owner.token, "/api/ios/planning-items", { id: templateNoteId, text: "Quiet Saturday afternoon", type: "note", weekStartDate: week, planningDate: addDays(week, 5), childId: child.id })).ok, true);

  const templateRequestId = randomUUID();
  let state = await change(owner.token, { action: "saveTemplate", id: templateRequestId, name: `School week ${suffix}` });
  await change(owner.token, { action: "saveTemplate", id: templateRequestId, name: `School week ${suffix}` });
  const template = state.templates.find((entry) => entry.name === `School week ${suffix}`);
  assert.ok(template?.items.length, "saved templates contain the week's plans");
  assert.equal(template.items.length, 1, "templates exclude tasks that already have a repeating schedule");
  assert.equal((await family(owner.token)).templates.length, 1, "template creation retries preserve one template");
  const templateWeek = addDays(week, 28);
  await change(owner.token, { action: "applyTemplate", id: template.id }, templateWeek);
  const appliedCount = items(await planner(owner.token, templateWeek)).length;
  await change(partner.token, { action: "applyTemplate", id: template.id }, templateWeek);
  assert.equal(items(await planner(owner.token, templateWeek)).length, appliedCount, "template retries cannot duplicate a week");
  assert.equal((await family(owner.token, templateWeek)).templates.find((entry) => entry.id === template.id)?.appliedToWeek, true);
  await rejected(outsider.token, { action: "applyTemplate", id: template.id }, "foreign templates cannot be applied");

  state = await family(owner.token);
  const revision = state.review.revision;
  await change(owner.token, { action: "saveReview", priorities: "Keep Friday free", meals: "Pasta Monday", logistics: "School bag ready Sunday", revision });
  await rejected(partner.token, { action: "saveReview", priorities: "Stale edit", meals: "", logistics: "", revision }, "stale review edits cannot silently overwrite shared notes");
  await rejected(partner.token, { action: "markReviewed", reviewed: true, revision }, "an adult cannot acknowledge an outdated version of the plan");
  state = await change(owner.token, { action: "markReviewed", reviewed: true });
  assert.ok(state.review.reviewedBy.some((entry) => entry.userId === owner.userId));
  state = await change(partner.token, { action: "markReviewed", reviewed: true });
  assert.equal(state.review.reviewedBy.length, 2, "adults independently acknowledge the weekly plan");
  state = await change(owner.token, { action: "saveReview", priorities: "Friday plans changed", meals: state.review.meals, logistics: state.review.logistics, revision: state.review.revision });
  assert.equal(state.review.reviewedBy.length, 0, "changed shared notes require a fresh review");
  assert.equal((await family(outsider.token)).review.priorities, "", "weekly notes remain household private");
  await rejected(viewer.token, { action: "markReviewed", reviewed: true }, "viewers cannot acknowledge for household planners");

  await change(owner.token, { action: "deleteChild", id: child.id });
  const retainedTask = items(await planner(owner.token)).find((item) => item.id === taskId);
  assert.ok(retainedTask, "removing a profile keeps the household's task");
  assert.equal(retainedTask.childId ?? null, null);
  console.log("Family planning integration passed: sessions, household isolation, child profiles, recurring occurrences, deletion/retry safety, templates, and shared review conflicts.");
} catch (error) {
  if (serverLog) console.error(serverLog);
  throw error;
} finally {
  try {
    if (householdIds.length) await client.query("delete from households where id = any($1::uuid[])", [householdIds]);
    if (userIds.length) await client.query("delete from users where id = any($1::uuid[])", [userIds]);
  } finally {
    await client.end();
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
    }
  }
}
