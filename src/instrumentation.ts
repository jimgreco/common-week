export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startNotificationScheduler } = await import("@/lib/server/notifications");
    startNotificationScheduler();
  }
}
