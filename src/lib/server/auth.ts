import "server-only";

import { cache } from "react";
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
  return { ...context, householdId: context.householdId };
}
