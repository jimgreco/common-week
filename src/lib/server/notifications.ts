import "server-only";

import { connect } from "node:http2";
import { randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { addDateDays, currentWeekStart, isDateOnly, todayInTimeZone, weekStartForDate } from "@/lib/date";
import { applicationOrigin } from "@/lib/env";
import { scheduledNotificationOccurrences } from "@/lib/notification-schedule";
import {
  notificationDeliveryDeepLink,
  plannerNotificationDeepLink,
  plannerNotificationTarget,
  type PlannerNotificationTarget,
  type ResolvedPlannerNotificationTarget,
} from "@/lib/notification-links";
import { query } from "@/lib/server/database";
import { getPlannerData } from "@/lib/server/planner-data";
import type {
  NotificationChannelState,
  NotificationDeliveryStatus,
  NotificationInbox,
  NotificationInboxItem,
  NotificationPreferences,
  NotificationReminder,
} from "@/types/domain";

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
  outbox_id: string;
  user_id: string;
  email: string;
  title: string;
  body: string;
  deep_link: string;
  channel: "email" | "push";
  attempts: number;
  unread_count: number;
}

interface InboxRow {
  id: string;
  kind: NotificationInboxItem["kind"];
  title: string;
  body: string;
  deep_link: string;
  scheduled_for: Date;
  created_at: Date;
  read_at: Date | null;
  deliveries: Partial<Record<"email" | "push", {
    status: NotificationDeliveryStatus;
    attempts: number;
    deliveredAt: string | null;
    lastError: string | null;
  }>> | null;
  resource_kind: "planning_item" | "calendar_event" | null;
  planning_item_id: string | null;
  calendar_preference_id: string | null;
  provider_event_id: string | null;
  target_week_start: string | null;
  unread_count: number;
}

const pendingChannelState = (): NotificationChannelState => ({
  status: "pending",
  attempts: 0,
  deliveredAt: null,
  lastError: null,
});

// These fixed SQL predicates are shared by history, scheduling, and the final
// delivery claim. Membership restoration alone must not reactivate old work.
const reminderAccessSql = `nr.membership_revoked_at is null
  and exists (
    select 1 from household_members recipient
     where recipient.household_id = nr.household_id and recipient.user_id = nr.user_id
  )
  and (
    (nr.resource_kind = 'planning_item' and exists (
      select 1 from planning_items item
       where item.id = nr.planning_item_id and item.household_id = nr.household_id
    ))
    or (nr.resource_kind = 'calendar_event' and exists (
      select 1 from calendar_preferences calendar
      join household_members calendar_owner
        on calendar_owner.household_id = calendar.household_id and calendar_owner.user_id = calendar.user_id
       where calendar.id = nr.calendar_preference_id and calendar.household_id = nr.household_id
         and (calendar.visibility = 'share' or (calendar.visibility = 'private' and calendar.user_id = nr.user_id))
    ))
  )`;

const outboxAccessSql = `no.membership_revoked_at is null
  and exists (
    select 1 from household_members recipient
     where recipient.household_id = no.household_id and recipient.user_id = no.user_id
  )
  and (no.kind <> 'reminder' or exists (
    select 1 from notification_reminders nr
     where split_part(no.dedupe_key, ':', 1) = 'reminder'
       and split_part(no.dedupe_key, ':', 2) = nr.id::text
       and nr.user_id = no.user_id and nr.household_id = no.household_id
       and ${reminderAccessSql}
  ))`;

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

export async function getNotificationInbox(userId: string, limit = 25): Promise<NotificationInbox> {
  const result = await query<InboxRow>(
    `select no.id, no.kind, no.title, no.body, no.deep_link, no.scheduled_for,
            no.created_at, no.read_at,
            coalesce((
              select jsonb_object_agg(
                nd.channel,
                jsonb_build_object(
                  'status', nd.status,
                  'attempts', nd.attempts,
                  'deliveredAt', nd.delivered_at,
                  'lastError', nd.last_error
                )
              )
                from notification_deliveries nd
               where nd.outbox_id = no.id
            ), '{}'::jsonb) as deliveries,
            nr.resource_kind, nr.planning_item_id, nr.calendar_preference_id,
            nr.provider_event_id,
            coalesce(
              pi.week_start_date::text,
              case when nr.resource_start is not null
                then to_char(date_trunc('week', nr.resource_start at time zone h.timezone), 'YYYY-MM-DD')
              end
            ) as target_week_start,
            count(*) filter (where no.read_at is null) over ()::integer as unread_count
       from notification_outbox no
       join households h on h.id = no.household_id
       left join notification_reminders nr
         on split_part(no.dedupe_key, ':', 1) = 'reminder'
        and split_part(no.dedupe_key, ':', 2) = nr.id::text
       left join planning_items pi on pi.id = nr.planning_item_id
      where no.user_id = $1 and ${outboxAccessSql}
      order by no.created_at desc
      limit $2`,
    [userId, Math.max(1, Math.min(limit, 100))],
  );

  const items = result.rows.map((row): NotificationInboxItem => {
    const linkUrl = new URL(row.deep_link, "https://weekofus.invalid");
    const linkTarget = plannerNotificationTarget(Object.fromEntries(linkUrl.searchParams));
    const linkWeek = linkUrl.searchParams.get("week");
    const weekStart = row.target_week_start
      ?? linkTarget?.weekStart
      ?? (linkWeek && isDateOnly(linkWeek) ? weekStartForDate(linkWeek) : null);
    const target = row.resource_kind === "planning_item" && row.planning_item_id && weekStart
      ? { kind: "planning_item" as const, weekStart, planningItemId: row.planning_item_id }
      : row.resource_kind === "calendar_event" && row.calendar_preference_id && row.provider_event_id && weekStart
        ? {
            kind: "calendar_event" as const,
            weekStart,
            calendarPreferenceId: row.calendar_preference_id,
            providerEventId: row.provider_event_id,
          }
        : weekStart
          ? { kind: "planner" as const, weekStart }
          : null;
    const email = row.deliveries?.email;
    const push = row.deliveries?.push;
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      scheduledFor: row.scheduled_for.toISOString(),
      createdAt: row.created_at.toISOString(),
      readAt: row.read_at?.toISOString() ?? null,
      channels: {
        email: email ? { ...email, deliveredAt: email.deliveredAt ? new Date(email.deliveredAt).toISOString() : null } : pendingChannelState(),
        push: push ? { ...push, deliveredAt: push.deliveredAt ? new Date(push.deliveredAt).toISOString() : null } : pendingChannelState(),
      },
      target,
    };
  });
  return { items, unreadCount: result.rows[0]?.unread_count ?? 0 };
}

export async function markNotificationRead(userId: string, notificationId?: string): Promise<void> {
  if (notificationId) {
    await query(
      `update notification_outbox no set read_at = coalesce(read_at, now())
        where id = $1 and user_id = $2 and ${outboxAccessSql}`,
      [notificationId, userId],
    );
    return;
  }
  await query(
    `update notification_outbox no set read_at = now()
      where user_id = $1 and read_at is null and ${outboxAccessSql}`,
    [userId],
  );
}

export async function resolvePlannerNotificationTarget(
  context: { userId: string; householdId: string },
  target: PlannerNotificationTarget,
): Promise<ResolvedPlannerNotificationTarget | null> {
  if (target.kind === "planning_item") {
    const result = await query<{ id: string; week_start: string }>(
      `select pi.id, pi.week_start_date::text as week_start
         from planning_items pi
         join household_members hm on hm.household_id = pi.household_id
        where pi.id = $1 and pi.household_id = $2 and hm.user_id = $3`,
      [target.id, context.householdId, context.userId],
    );
    const row = result.rows[0];
    return row ? { kind: "planning_item", id: row.id, weekStart: row.week_start } : null;
  }

  const result = await query<{
    calendar_preference_id: string;
    provider_event_id: string;
    week_start: string;
  }>(
    `select nr.calendar_preference_id, nr.provider_event_id,
            to_char(date_trunc('week', nr.resource_start at time zone h.timezone), 'YYYY-MM-DD') as week_start
       from notification_reminders nr
       join households h on h.id = nr.household_id
       join household_members hm on hm.household_id = nr.household_id
      where nr.id = $1 and nr.user_id = $2 and nr.household_id = $3
        and hm.user_id = $2 and nr.resource_kind = 'calendar_event'
        and ${reminderAccessSql}`,
    [target.id, context.userId, context.householdId],
  );
  const row = result.rows[0];
  return row ? {
    kind: "calendar_event",
    calendarPreferenceId: row.calendar_preference_id,
    providerEventId: row.provider_event_id,
    weekStart: row.week_start,
  } : null;
}

export async function reminderForPlanningItem(userId: string, itemId: string): Promise<NotificationReminder | null> {
  const result = await query<{ id: string; remind_at: Date }>(
    `select nr.id, nr.remind_at from notification_reminders nr
      where nr.user_id = $1 and nr.planning_item_id = $2 and nr.delivered_at is null
        and ${reminderAccessSql}`,
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
    `select nr.id, nr.remind_at from notification_reminders nr
      where nr.user_id = $1 and nr.calendar_preference_id = $2 and nr.provider_event_id = $3 and nr.delivered_at is null
        and ${reminderAccessSql}`,
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
     ) select $1, $2, 'planning_item', $3, $4, $5
         from household_members hm
         join planning_items pi on pi.household_id = hm.household_id and pi.id = $3
        where hm.user_id = $1 and hm.household_id = $2
        for key share of hm
     on conflict (user_id, planning_item_id) where resource_kind = 'planning_item'
     do update set resource_title = excluded.resource_title, remind_at = excluded.remind_at,
                   delivery_version = case when notification_reminders.membership_revoked_at is not null
                     then gen_random_uuid() else notification_reminders.delivery_version end,
                   delivered_at = null, membership_revoked_at = null, updated_at = now()
     returning id, remind_at`,
    [input.userId, input.householdId, input.itemId, input.title, input.remindAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error("This reminder is no longer available in your household.");
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
     ) select $1, $2, 'calendar_event', $3, $4, $5, $6, $7
         from household_members hm
         join calendar_preferences cp on cp.household_id = hm.household_id and cp.id = $3
         join household_members calendar_owner
           on calendar_owner.household_id = cp.household_id and calendar_owner.user_id = cp.user_id
        where hm.user_id = $1 and hm.household_id = $2
          and (cp.visibility = 'share' or (cp.visibility = 'private' and cp.user_id = $1))
        for key share of hm, calendar_owner
     on conflict (user_id, calendar_preference_id, provider_event_id) where resource_kind = 'calendar_event'
     do update set resource_title = excluded.resource_title, resource_start = excluded.resource_start,
                   delivery_version = case when notification_reminders.membership_revoked_at is not null
                     then gen_random_uuid() else notification_reminders.delivery_version end,
                   remind_at = excluded.remind_at, delivered_at = null, membership_revoked_at = null, updated_at = now()
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
  const row = result.rows[0];
  if (!row) throw new Error("This reminder is no longer available in your household.");
  return { id: row.id, resourceKind: "calendar_event", remindAt: row.remind_at.toISOString() };
}

async function materializeReminderDeliveries() {
  const reminders = await query<{
    id: string;
    user_id: string;
    household_id: string;
    resource_kind: "planning_item" | "calendar_event";
    planning_item_id: string | null;
    resource_title: string;
    remind_at: Date;
    delivery_version: string | null;
    week_start: string;
  }>(
    `select nr.id, nr.user_id, nr.household_id, nr.resource_kind, nr.planning_item_id,
            nr.resource_title, nr.remind_at, nr.delivery_version,
            coalesce(
              pi.week_start_date::text,
              to_char(date_trunc('week', nr.resource_start at time zone h.timezone), 'YYYY-MM-DD')
            ) as week_start
       from notification_reminders nr
       join households h on h.id = nr.household_id
       left join planning_items pi on pi.id = nr.planning_item_id
      where nr.delivered_at is null and nr.remind_at <= now() + interval '1 minute'
        and ${reminderAccessSql}`,
  );
  for (const reminder of reminders.rows) {
    // Preserve legacy dedupe keys until a revoked reminder is explicitly
    // restored. Restoration needs a fresh delivery without reviving its history.
    const dedupeKey = `reminder:${reminder.id}:${reminder.remind_at.toISOString()}${reminder.delivery_version ? `:${reminder.delivery_version}` : ""}`;
    const deepLink = reminder.resource_kind === "planning_item"
      ? plannerNotificationDeepLink({ kind: "planning_item", id: reminder.planning_item_id!, weekStart: reminder.week_start })
      : plannerNotificationDeepLink({ kind: "calendar_reminder", id: reminder.id, weekStart: reminder.week_start });
    await query(
      `insert into notification_outbox (
         user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
       ) select $1, $2, $3, 'reminder', $4, $5, $6, $7
           from notification_reminders nr
          where nr.id = $8 and nr.remind_at = $7 and nr.delivered_at is null
            and nr.delivery_version is not distinct from $9::uuid
            and ${reminderAccessSql}
       on conflict (dedupe_key) do nothing`,
      [
        reminder.user_id,
        reminder.household_id,
        dedupeKey,
        reminder.resource_kind === "calendar_event" ? "Upcoming event" : "Household reminder",
        reminder.resource_title,
        deepLink,
        reminder.remind_at,
        reminder.id,
        reminder.delivery_version,
      ],
    );
    await query(
      `update notification_reminders nr set delivered_at = coalesce(delivered_at, now())
        where nr.id = $1 and nr.remind_at = $2 and ${reminderAccessSql}
          and nr.delivery_version is not distinct from $4::uuid
          and exists (select 1 from notification_outbox no where no.dedupe_key = $3 and no.membership_revoked_at is null)`,
      [reminder.id, reminder.remind_at, dedupeKey, reminder.delivery_version],
    );
  }
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

async function materializeScheduledDigests(now: Date, since: Date) {
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
    const occurrences = scheduledNotificationOccurrences({
      now,
      since,
      timeZone: row.timezone,
      morningDigestEnabled: row.morning_digest_enabled,
      morningDigestTime: row.morning_digest_time,
      sundayPlanningEnabled: row.sunday_planning_enabled,
      sundayPlanningTime: row.sunday_planning_time,
    });
    for (const occurrence of occurrences) {
      if (occurrence.kind === "morning_digest") {
        const planner = await getPlannerData(
          { userId: row.user_id, householdId: row.household_id },
          weekStartForDate(occurrence.localDate),
        );
        await query(
          `insert into notification_outbox (
             user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
           ) values ($1, $2, $3, 'morning_digest', 'Today in Week of Us', $4, $5, $6)
           on conflict (dedupe_key) do nothing`,
          [
            row.user_id,
            row.household_id,
            `morning:${row.user_id}:${occurrence.localDate}`,
            summaryBody(planner, occurrence.localDate),
            `/planner?week=${weekStartForDate(occurrence.localDate)}`,
            occurrence.scheduledFor,
          ],
        );
      } else {
        const nextWeek = addDateDays(weekStartForDate(occurrence.localDate), 7);
        await query(
          `insert into notification_outbox (
             user_id, household_id, dedupe_key, kind, title, body, deep_link, scheduled_for
           ) values ($1, $2, $3, 'sunday_planning', 'Plan the week together',
                     'Review unfinished tasks, prepare your routines, and make a shared plan for the week.',
                     $4, $5)
           on conflict (dedupe_key) do nothing`,
          [
            row.user_id,
            row.household_id,
            `sunday:${row.user_id}:${occurrence.localDate}`,
            `/planner?week=${nextWeek}&review=1`,
            occurrence.scheduledFor,
          ],
        );
      }
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
  const link = new URL(delivery.deep_link, applicationOrigin());
  const itemId = link.searchParams.get("task") ?? link.searchParams.get("item");
  const task = itemId && /^[0-9a-f-]{36}$/i.test(itemId) ? await query(
    `select 1 from planning_items p join household_members hm on hm.household_id=p.household_id where p.id=$1 and p.type='task' and hm.user_id=$2`, [itemId, delivery.user_id],
  ) : null;
  const category = task?.rows.length ? "FAMILY_TASK" : "FAMILY_REMINDER";

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
      aps: { alert: { title: delivery.title, body: delivery.body }, sound: "default", badge: delivery.unread_count, category },
      path: notificationDeliveryDeepLink(delivery.deep_link, delivery.outbox_id),
    }));
  });
}

async function sendEmail(delivery: DeliveryRow) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM || process.env.INVITATION_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Notification email delivery is not configured.");
  const url = new URL(
    notificationDeliveryDeepLink(delivery.deep_link, delivery.outbox_id),
    applicationOrigin(),
  ).toString();
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
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px"><h1 style="font-size:24px">${escapeHtml(delivery.title)}</h1><p style="white-space:pre-line">${escapeHtml(delivery.body)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#18231f;color:white;padding:12px 18px;border-radius:9px;text-decoration:none">Open Week of Us</a></p></div>`,
      tags: [{ name: "message_type", value: "household_notification" }],
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Notification email returned ${response.status}.`);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

async function materializeChannelDeliveries() {
  await query(
    `insert into notification_deliveries (
       outbox_id, channel, status, next_attempt_at, last_error
     )
     select no.id, 'email',
            case when coalesce(np.email_enabled, true) then 'pending' else 'skipped' end,
            no.scheduled_for,
            case when coalesce(np.email_enabled, true) then null else 'Email is disabled in notification preferences.' end
       from notification_outbox no
       left join notification_preferences np on np.user_id = no.user_id
      where no.scheduled_for <= now() and ${outboxAccessSql}
     on conflict (outbox_id, channel) do nothing`,
  );
  await query(
    `insert into notification_deliveries (
       outbox_id, channel, status, next_attempt_at, last_error
     )
     select no.id, 'push',
            case
              when not coalesce(np.push_enabled, true) then 'skipped'
              when not exists (select 1 from push_devices pd where pd.user_id = no.user_id) then 'skipped'
              else 'pending'
            end,
            no.scheduled_for,
            case
              when not coalesce(np.push_enabled, true) then 'Push is disabled in notification preferences.'
              when not exists (select 1 from push_devices pd where pd.user_id = no.user_id) then 'No iPhone is registered for push.'
              else null
            end
       from notification_outbox no
       left join notification_preferences np on np.user_id = no.user_id
      where no.scheduled_for <= now() and ${outboxAccessSql}
     on conflict (outbox_id, channel) do nothing`,
  );
}

async function syncAggregateDeliveryState(outboxId: string) {
  await query(
    `update notification_outbox no
        set attempts = states.attempts,
            delivered_at = coalesce(no.delivered_at, states.delivered_at),
            last_error = states.last_error
       from (
         select outbox_id, coalesce(sum(attempts), 0)::integer as attempts,
                min(delivered_at) as delivered_at,
                nullif(string_agg(last_error, ' ' order by channel) filter (where last_error is not null), '') as last_error
           from notification_deliveries
          where outbox_id = $1
          group by outbox_id
       ) states
      where no.id = states.outbox_id`,
    [outboxId],
  );
}

async function deliverOutbox() {
  const deliveries = await query<DeliveryRow>(
    `select nd.id, nd.outbox_id, no.user_id, u.email::text, no.title, no.body,
            no.deep_link, nd.channel, nd.attempts,
            (select count(*)::integer from notification_outbox unread
              where unread.user_id = no.user_id and unread.read_at is null
                and exists (select 1 from notification_outbox no where no.id = unread.id and ${outboxAccessSql})) as unread_count
       from notification_deliveries nd
       join notification_outbox no on no.id = nd.outbox_id
       join users u on u.id = no.user_id
      where ${outboxAccessSql} and (
        (nd.status in ('pending', 'failed') and nd.next_attempt_at <= now() and nd.attempts < 5)
        or (nd.status = 'sending' and nd.updated_at < now() - interval '5 minutes' and nd.attempts < 5)
      )
      order by nd.next_attempt_at, nd.created_at
      limit 50`,
  );
  for (const delivery of deliveries.rows) {
    const claimed = await query<{ attempts: number }>(
      `update notification_deliveries nd
          set status = 'sending', attempts = nd.attempts + 1, last_attempt_at = now()
         from notification_outbox no
        where nd.id = $1 and no.id = nd.outbox_id and ${outboxAccessSql} and (
          (nd.status in ('pending', 'failed') and nd.next_attempt_at <= now() and nd.attempts < 5)
          or (nd.status = 'sending' and nd.updated_at < now() - interval '5 minutes' and nd.attempts < 5)
        )
        returning nd.attempts`,
      [delivery.id],
    );
    const attempt = claimed.rows[0]?.attempts;
    if (!attempt) continue;

    let results: PromiseSettledResult<unknown>[];
    if (delivery.channel === "email") {
      results = await Promise.allSettled([sendEmail(delivery)]);
    } else {
      const devices = await query<{ token: string; environment: string }>(
        "select device_token as token, environment from push_devices where user_id = $1",
        [delivery.user_id],
      );
      if (!devices.rowCount) {
        await query(
          `update notification_deliveries
              set status = 'skipped', last_error = 'No iPhone is registered for push.'
            where id = $1`,
          [delivery.id],
        );
        await syncAggregateDeliveryState(delivery.outbox_id);
        continue;
      }
      results = await Promise.allSettled(devices.rows.map((device) => sendPush(device, delivery)));
    }

    const succeeded = results.some((result) => result.status === "fulfilled");
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    if (succeeded) {
      await query(
        `update notification_deliveries
            set status = 'delivered', delivered_at = now(), last_error = $2
          where id = $1`,
        [delivery.id, errors.join(" ").slice(0, 1000) || null],
      );
    } else {
      const retryAt = new Date(Date.now() + Math.min(2 ** attempt * 60_000, 60 * 60_000));
      await query(
        `update notification_deliveries
            set status = 'failed', next_attempt_at = $2, last_error = $3
          where id = $1`,
        [delivery.id, retryAt, errors.join(" ").slice(0, 1000) || "Delivery failed."],
      );
    }
    await syncAggregateDeliveryState(delivery.outbox_id);
  }
}

export async function processNotificationCycle(now = new Date()) {
  const state = await query<{ last_processed_at: Date }>(
    "select last_processed_at from notification_scheduler_state where singleton = true",
  );
  const since = state.rows[0]?.last_processed_at ?? new Date(now.getTime() - 60_000);
  await materializeReminderDeliveries();
  await materializeScheduledDigests(now, since > now ? now : since);
  await query(
    `update notification_scheduler_state
        set last_processed_at = greatest(last_processed_at, $1)
      where singleton = true`,
    [now],
  );
  await materializeChannelDeliveries();
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
