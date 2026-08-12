"use server";

import { redirect } from "next/navigation";
import { deleteCurrentSession } from "@/lib/server/session";

export async function signInWithGoogle() {
  redirect("/auth/google");
}

export async function signOut() {
  await deleteCurrentSession();
  redirect("/");
}
