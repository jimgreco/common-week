import { NextRequest } from "next/server";
import { requireHouseholdContext } from "@/lib/server/auth";
import { query, withTransaction } from "@/lib/server/database";
import { coverageSchema, type EventCoverage } from "@/lib/coverage";
import { z } from "zod";
const columns = `calendar_preference_id as "calendarId",provider_event_id as "eventId",child_id as "childId",drop_off_user_id as "dropOffUserId",pickup_user_id as "pickupUserId",drop_off_needed as "dropOffNeeded",pickup_needed as "pickupNeeded",drop_off_confirmed as "dropOffConfirmed",pickup_confirmed as "pickupConfirmed",travel_minutes as "travelMinutes",notes,revision`;
export async function GET() {
  try {
    const c = await requireHouseholdContext();
    const rows = await query<EventCoverage>(
      `select ${columns} from event_coverage ec where household_id=$1 and exists(select 1 from calendar_preferences cp where cp.id=ec.calendar_preference_id and (cp.visibility='share' or(cp.visibility='private' and cp.user_id=$2)))`,
      [c.householdId, c.userId],
    );
    return Response.json(
      { ok: true, data: rows.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      throw new Error("Request not allowed.");
    const input = coverageSchema.parse(await request.json());
    const c = await requireHouseholdContext();
    if (c.role === "viewer")
      throw new Error("You cannot change household coverage.");
    await withTransaction(async (db) => {
      const calendar = await db.query(
        `select id from calendar_preferences where id=$1 and household_id=$2 and(visibility='share' or(visibility='private' and user_id=$3)) for update`,
        [input.calendarId, c.householdId, c.userId],
      );
      if (!calendar.rows.length) throw new Error("Calendar unavailable.");
      if (
        !(
          await db.query(
            "select id from child_profiles where id=$1 and household_id=$2",
            [input.childId, c.householdId],
          )
        ).rows.length
      )
        throw new Error("Choose a child in this household.");
      const ids = [
        ...new Set([input.dropOffUserId, input.pickupUserId].filter(Boolean)),
      ];
      const members = await db.query(
        "select user_id from household_members where household_id=$1 and user_id=any($2::uuid[]) and role<>'viewer'",
        [c.householdId, ids],
      );
      if (members.rows.length !== ids.length)
        throw new Error("Choose an adult who can plan in this household.");
      const old = (
        await db.query<EventCoverage>(
          `select ${columns} from event_coverage where calendar_preference_id=$1 and provider_event_id=$2 and child_id=$3`,
          [input.calendarId, input.eventId, input.childId],
        )
      ).rows[0];
      if ((old?.revision ?? 0) !== input.revision)
        throw new Error(
          "Coverage changed. Refresh before saving your changes.",
        );
      let drop =
        old?.dropOffUserId === input.dropOffUserId &&
        old?.dropOffNeeded === input.dropOffNeeded
          ? old.dropOffConfirmed
          : false;
      let pick =
        old?.pickupUserId === input.pickupUserId &&
        old?.pickupNeeded === input.pickupNeeded
          ? old.pickupConfirmed
          : false;
      if (input.confirmation) {
        const assigned =
          input.confirmation === "dropOff"
            ? input.dropOffUserId
            : input.pickupUserId;
        if (assigned !== c.userId)
          throw new Error("Only the assigned adult can confirm their handoff.");
        if (input.confirmation === "dropOff") drop = input.confirmed ?? true;
        else pick = input.confirmed ?? true;
      }
      await db.query(
        `insert into event_coverage(household_id,calendar_preference_id,provider_event_id,child_id,drop_off_user_id,pickup_user_id,drop_off_needed,pickup_needed,drop_off_confirmed,pickup_confirmed,travel_minutes,notes,revision) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) on conflict(calendar_preference_id,provider_event_id,child_id) do update set drop_off_user_id=$5,pickup_user_id=$6,drop_off_needed=$7,pickup_needed=$8,drop_off_confirmed=$9,pickup_confirmed=$10,travel_minutes=$11,notes=$12,revision=event_coverage.revision+1`,
        [
          c.householdId,
          input.calendarId,
          input.eventId,
          input.childId,
          input.dropOffUserId,
          input.pickupUserId,
          input.dropOffNeeded,
          input.pickupNeeded,
          drop,
          pick,
          input.travelMinutes,
          input.notes,
        ],
      );
    });
    return GET();
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  return Response.json(
    {
      ok: false,
      error:
        e instanceof z.ZodError
          ? "Check the coverage details."
          : e instanceof Error
            ? e.message
            : "Coverage could not be saved.",
    },
    { status: 400 },
  );
}
