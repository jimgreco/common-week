import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { currentSessionIdentity, type SessionIdentity } from "@/lib/server/session";

export type UserContext = SessionIdentity;

export const getUserContext = cache(async (): Promise<UserContext | null> => currentSessionIdentity());

export async function requireUserContext(): Promise<UserContext> {
  const context = await getUserContext();
  if (!context) throw new Error("Authentication required.");
  return context;
}

export async function requireHouseholdContext(): Promise<UserContext & { householdId: string }> {
  const context = await requireUserContext();
  if (!context.householdId) throw new Error("Household setup is required.");
  const requestHeaders = await headers();
  const expectedUser = requestHeaders.get("x-week-of-us-user");
  const expectedHousehold = requestHeaders.get("x-week-of-us-household");
  // An offline draft keeps its original identity even if the app's bearer token
  // or household membership changes between its preflight and this request.
  if ((expectedUser !== null || expectedHousehold !== null)
    && (expectedUser !== context.userId || expectedHousehold !== context.householdId)) {
    throw new Error("Your account or household changed. This offline change is still saved on your device for review.");
  }
  return { ...context, householdId: context.householdId };
}
