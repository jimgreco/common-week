import "server-only";

import { connect } from "node:http2";
import { randomUUID } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { importPKCS8, SignJWT } from "jose";
import { addDateDays, currentWeekStart, todayInTimeZone } from "@/lib/date";
import { applicationOrigin } from "@/lib/env";
import { query } from "@/lib/server/database";
import { getPlannerData } from "@/lib/server/planner-data";
import type { NotificationPreferences, NotificationReminder } from "@/types/domain";

interface PreferenceRow {
  email_enabled: boolean;
  push_enabled: boolean;
  morning_digest_enabled: boolean;
  morning_digest_time: string;
  sunday_planning_enabled: boolean;
  sunday_planning_time: string;
  household_change_alerts: boolean;
}

interface DeliveryRow {
  id: string;
  dedupe_key: string;
  user_id: string;
  email: string;
  title: string;
  body: string;
  deep_link: string;
  email_enabled: boolean;
  push_enabled: boolean;
}

function mappedPreferences(row: PreferenceRow): NotificationPreferences {
  return {
    emailEnabled: row.email_enabled,
    pushEnabled: row.push_enabled,
    morningDigestEnabled: row.morning_digest_enabled,
    morningDigestTime: row.morning_digest_time.slice(0, 5),
    sundayPlanningEnabled: row.sunday_planning_enabled,
    sundayPlanningTime: row.sunday_planning_time.slice(0, 5),
    householdChangeAlerts: row.household_change_alerts,
  };
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  await query("insert into notification_preferences (user_id) values ($1) on conflict do nothing", [userId]);
  const result = await query<PreferenceRow>(
    `select email_enabled, push_enabled, morning_digest_enabled, morning_digest_time::text,
            sunday_planning_enabled, sunday_planning_time::text, household_change_alerts
       from notification_preferences where user_id = $1`,
    [userId],
  );
  return mappedPreferences(result.rows[0]!);
}

export async function saveNotificationPreferences(userId: string, preferences: NotificationPreferences) {
  await query(
    `insert into notification_preferences (
       user_id, email_enabled, push_enabled, morning_digest_enabled, morning_digest_time,
       sunday_planning_enabled, sunday_planning_time, household_change_alerts
     ) values ($1, $2, $3, $4, $5::time, $6, $7::time, $8)
     on conflict (user_id) do update set
       email_enabled = excluded.email_enabled,
       push_enabled = excluded.push_enabled,
       morning_digest_enabled = excluded.morning_digest_enabled,
       morning_digest_time = excluded.morning_digest_time,
       sunday_planning_enabled = excluded.sunday_planning_enabled,
       sunday_planning_time = excluded.sunday_planning_time,
       household_change_alerts = excluded.household_change_alerts`,
    [
      userId,
      preferences.emailEnabled,
      preferences.pushEnabled,
      preferences.morningDigestEnabled,
      preferences.morningDigestTime,
      preferences.sundayPlanningEnabled,
      preferences.sundayPlanningTime,
      preferences.householdChangeAlerts,
    ],
  );
}

export async function reminderForPlanningItem(userId: string, itemId: string): Promise<NotificationReminder | null> {
  const result = await query<{ id: string; remind_at: Date }>(
    `select id, remind_at from notification_reminders
      where user_id = $1 and planning_item_id = $2 and delivered_at is null`,
    [userId, itemId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, resourceKind: "planning_item", remindAt: row.remind_at.toISOString() } : null;
}

export async function reminderForCalendarEvent(
  userId: string,
  calendarPreferenceId: string,
  providerEventId: string,
): Promise<NotificationReminder | null> {
  const result = await query<{ id: string; remind_at: Date }>(
    `select id, remind_at from notification_reminders
      where user_id = $1 and calendar_preference_id = $2 and provider_event_id = $3 and delivered_at is null`,
    [userId, calendarPreferenceId, providerEventId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, resourceKind: "calendar_event", remindAt: row.remind_at.toISOString() } : null;
}

export async function queueHouseholdChange(input: {
  actorUserId: string;
  householdId: string;
  title: string;
  body: string;
  deepLink?: string;
}) {
  await query(
    `insert into notification_outbox (
       user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
     )
     select hm.user_id, hm.household_id, $3 || ':' || hm.user_id::text, 'household_change',
            $4, $5, $6, now()
       from household_members hm
       join notification_preferences np on np.user_id = hm.user_id
      where hm.household_id = $1 and hm.user_id <> $2 and np.household_change_alerts
     on conflict (dedupe_key) do nothing`,
    [input.householdId, input.actorUserId, `change:${randomUUID()}`, input.title, input.body, input.deepLink ?? "/planner"],
  );
}

export async function upsertPlanningReminder(input: {
  userId: string;
  householdId: string;
  itemId: string;
  title: string;
  remindAt: Date | null;
}): Promise<NotificationReminder | null> {
  if (!input.remindAt) {
    await query("delete from notification_reminders where user_id = $1 and planning_item_id = $2", [input.userId, input.itemId]);
    return null;
  }
  const result = await query<{ id: string; remind_at: Date }>(
    `insert into notification_reminders (
       user_id, household_id, resource_kind, planning_item_id, resource_title, remind_at
     ) values ($1, $2, 'planning_item', $3, $4, $5)
     on conflict (user_id, planning_item_id) where resource_kind = 'planning_item'
     do update set resource_title = excluded.resource_title, remind_at = excluded.remind_at,
                   delivered_at = null, updated_at = now()
     returning id, remind_at`,
    [input.userId, input.householdId, input.itemId, input.title, input.remindAt],
  );
  const row = result.rows[0]!;
  return { id: row.id, resourceKind: "planning_item", remindAt: row.remind_at.toISOString() };
}

export async function upsertCalendarReminder(input: {
  userId: string;
  householdId: string;
  calendarPreferenceId: string;
  providerEventId: string;
  title: string;
  eventStart: Date;
  remindAt: Date | null;
}): Promise<NotificationReminder | null> {
  if (!input.remindAt) {
    await query(
      "delete from notification_reminders where user_id = $1 and calendar_preference_id = $2 and provider_event_id = $3",
      [input.userId, input.calendarPreferenceId, input.providerEventId],
    );
    return null;
  }
  const result = await query<{ id: string; remind_at: Date }>(
    `insert into notification_reminders (
       user_id, household_id, resource_kind, calendar_preference_id, provider_event_id,
       resource_title, resource_start, remind_at
     ) values ($1, $2, 'calendar_event', $3, $4, $5, $6, $7)
     on conflict (user_id, calendar_preference_id, provider_event_id) where resource_kind = 'calendar_event'
     do update set resource_title = excluded.resource_title, resource_start = excluded.resource_start,
                   remind_at = excluded.remind_at, delivered_at = null, updated_at = now()
     returning id, remind_at`,
    [
      input.userId,
      input.householdId,
      input.calendarPreferenceId,
      input.providerEventId,
      input.title,
      input.eventStart,
      input.remindAt,
    ],
  );
  const row = result.rows[0]!;
  return { id: row.id, resourceKind: "calendar_event", remindAt: row.remind_at.toISOString() };
}

async function materializeReminderDeliveries() {
  await query(
    `insert into notification_outbox (
       user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
     )
     select nr.user_id, nr.household_id, 'reminder:' || nr.id::text, 'reminder',
            case when nr.resource_kind = 'calendar_event' then 'Upcoming event' else 'Household reminder' end,
            nr.resource_title,
            case when nr.resource_kind = 'calendar_event' then '/planner?reminder=' || nr.id::text else '/planner?item=' || nr.planning_item_id::text end,
            nr.remind_at
       from notification_reminders nr
      where nr.delivered_at is null and nr.remind_at <= now() + interval '1 minute'
     on conflict (dedupe_key) do nothing`,
  );
}

function summaryBody(planner: Awaited<ReturnType<typeof getPlannerData>>, date: string): string {
  const day = planner.days.find((candidate) => candidate.date === date);
  if (!day) return "Open Week of Us to see the household plan.";
  const lines = [
    ...day.events.slice(0, 5).map((event) => `• ${event.title}`),
    ...day.items.filter((item) => !item.isCompleted).slice(0, 5).map((item) => `• ${item.text}`),
    ...planner.weeklyItems.filter((item) => item.type === "task" && !item.isCompleted).slice(0, 3).map((item) => `• ${item.text}`),
  ];
  return lines.length ? lines.join("\n") : "Nothing is scheduled yet. Enjoy the open space—or add a plan together.";
}

async function materializeScheduledDigests(now: Date) {
  const rows = await query<{
    user_id: string;
    household_id: string;
    timezone: string;
    morning_digest_enabled: boolean;
    morning_digest_time: string;
    sunday_planning_enabled: boolean;
    sunday_planning_time: string;
  }>(
    `select np.user_id, hm.household_id, h.timezone, np.morning_digest_enabled,
            np.morning_digest_time::text, np.sunday_planning_enabled, np.sunday_planning_time::text
       from notification_preferences np
       join household_members hm on hm.user_id = np.user_id
       join households h on h.id = hm.household_id
      where np.morning_digest_enabled or np.sunday_planning_enabled`,
  );

  for (const row of rows.rows) {
    const localDate = formatInTimeZone(now, row.timezone, "yyyy-MM-dd");
    const localTime = formatInTimeZone(now, row.timezone, "HH:mm");
    const weekday = formatInTimeZone(now, row.timezone, "EEEE");
    if (row.morning_digest_enabled && localTime === row.morning_digest_time.slice(0, 5)) {
      const planner = await getPlannerData(
        { userId: row.user_id, householdId: row.household_id },
        currentWeekStart(row.timezone),
      );
      await query(
        `insert into notification_outbox (
           user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
         ) values ($1, $2, $3, 'morning_digest', 'Today in Week of Us', $4, '/planner', now())
         on conflict (dedupe_key) do nothing`,
        [row.user_id, row.household_id, `morning:${row.user_id}:${localDate}`, summaryBody(planner, localDate)],
      );
    }
    if (row.sunday_planning_enabled && weekday === "Sunday" && localTime === row.sunday_planning_time.slice(0, 5)) {
      const nextWeek = addDateDays(currentWeekStart(row.timezone), 7);
      await query(
        `insert into notification_outbox (
           user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
         ) values ($1, $2, $3, 'sunday_planning', 'Plan the week together',
                   'Take a few minutes to look ahead, add household tasks, and make the week visible.',
                   $4, now())
         on conflict (dedupe_key) do nothing`,
        [row.user_id, row.household_id, `sunday:${row.user_id}:${localDate}`, `/planner?week=${nextWeek}`],
      );
    }
  }
}

function privateKeyText() {
  const encoded = process.env.APNS_PRIVATE_KEY_BASE64;
  if (encoded) return Buffer.from(encoded, "base64").toString("utf8");
  return (process.env.APNS_PRIVATE_KEY || "").replaceAll("\\n", "\n");
}

let cachedApnsToken: { value: string; expiresAt: number } | null = null;

async function apnsToken(): Promise<string> {
  if (cachedApnsToken && cachedApnsToken.expiresAt > Date.now()) return cachedApnsToken.value;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID || process.env.APPLE_TEAM_ID;
  const key = privateKeyText();
  if (!keyId || !teamId || !key) throw new Error("Apple Push Notification service is not configured.");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(await importPKCS8(key, "ES256"));
  cachedApnsToken = { value, expiresAt: Date.now() + 45 * 60_000 };
  return value;
}

async function sendPush(device: { token: string; environment: string }, delivery: DeliveryRow) {
  const origin = device.environment === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
  const authorization = await apnsToken();
  const client = connect(origin);
  const topic = process.env.APNS_BUNDLE_ID || "com.jimgreco.commonweek";
  await new Promise<void>((resolve, reject) => {
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${authorization}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
    request.on("data", (chunk) => { responseBody += chunk; });
    request.on("end", () => {
      client.close();
      if (status === 200) resolve();
      else reject(new Error(`Apple Push returned ${status}${responseBody ? `: ${responseBody.slice(0, 200)}` : ""}.`));
    });
    request.on("error", (error) => { client.close(); reject(error); });
    request.end(JSON.stringify({
      aps: { alert: { title: delivery.title, body: delivery.body }, sound: "default" },
      path: delivery.deep_link,
    }));
  });
}

async function sendEmail(delivery: DeliveryRow) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM || process.env.INVITATION_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Notification email delivery is not configured.");
  const url = new URL(delivery.deep_link, applicationOrigin()).toString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `week-of-us-notification-${delivery.id}`,
    },
    body: JSON.stringify({
      from,
      to: [delivery.email],
      subject: delivery.title,
      text: `${delivery.body}\n\nOpen Week of Us: ${url}`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px"><h1 style="font-size:24px">${escapeHtml(delivery.title)}</h1><p style="white-space:pre-line">${escapeHtml(delivery.body)}</p><p><a href="${url}" style="display:inline-block;background:#18231f;color:white;padding:12px 18px;border-radius:9px;text-decoration:none">Open Week of Us</a></p></div>`,
      tags: [{ name: "message_type", value: "household_notification" }],
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Notification email returned ${response.status}.`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

async function deliverOutbox() {
  const deliveries = await query<DeliveryRow>(
    `select no.id, no.dedupe_key, no.user_id, u.email::text, no.title, no.body, no.deep_link,
            coalesce(np.email_enabled, true) as email_enabled,
            coalesce(np.push_enabled, true) as push_enabled
       from notification_outbox no
       join users u on u.id = no.user_id
       left join notification_preferences np on np.user_id = no.user_id
      where no.delivered_at is null and no.scheduled_for <= now() and no.attempts < 5
      order by no.scheduled_for
      limit 25`,
  );
  for (const delivery of deliveries.rows) {
    const devices = delivery.push_enabled
      ? await query<{ token: string; environment: string }>(
        "select device_token as token, environment from push_devices where user_id = $1",
        [delivery.user_id],
      )
      : { rows: [] as Array<{ token: string; environment: string }> };
    const attempts: Promise<unknown>[] = [];
    if (delivery.email_enabled) attempts.push(sendEmail(delivery));
    for (const device of devices.rows) attempts.push(sendPush(device, delivery));
    if (!attempts.length) {
      await query(
        `update notification_outbox
            set attempts = attempts + 1, delivered_at = now(), last_error = 'No delivery channels enabled.'
          where id = $1`,
        [delivery.id],
      );
      if (delivery.dedupe_key.startsWith("reminder:")) {
        await query(
          "update notification_reminders set delivered_at = now() where id = $1::uuid",
          [delivery.dedupe_key.slice("reminder:".length)],
        );
      }
      continue;
    }
    const results = await Promise.allSettled(attempts);
    const succeeded = results.some((result) => result.status === "fulfilled");
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    await query(
      `update notification_outbox
          set attempts = attempts + 1,
              delivered_at = case when $2 then now() else delivered_at end,
              last_error = $3
        where id = $1`,
      [delivery.id, succeeded, errors.join(" ").slice(0, 1000) || null],
    );
    if (succeeded && delivery.dedupe_key.startsWith("reminder:")) {
      await query(
        "update notification_reminders set delivered_at = now() where id = $1::uuid",
        [delivery.dedupe_key.slice("reminder:".length)],
      );
    }
  }
}

export async function processNotificationCycle(now = new Date()) {
  await materializeReminderDeliveries();
  await materializeScheduledDigests(now);
  await deliverOutbox();
}

declare global {
  var commonWeekNotificationTimer: ReturnType<typeof setInterval> | undefined;
}

export function startNotificationScheduler() {
  if (globalThis.commonWeekNotificationTimer || !process.env.DATABASE_URL) return;
  const run = () => void processNotificationCycle().catch((error) => {
    console.error("Notification cycle failed", error instanceof Error ? error.message : error);
  });
  setTimeout(run, 5_000);
  globalThis.commonWeekNotificationTimer = setInterval(run, 60_000);
}

export function schedulerDateForHousehold(timeZone: string) {
  return { today: todayInTimeZone(timeZone), weekStart: currentWeekStart(timeZone) };
}
