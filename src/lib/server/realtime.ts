import "server-only";

import pg, { type Notification } from "pg";
import { databaseClientConfig } from "@/lib/server/database";

const { Client } = pg;
type ChangeListener = (table: string | undefined) => void;

class PostgreSqlRealtimeHub {
  private listeners = new Map<string, Set<ChangeListener>>();
  private client: InstanceType<typeof Client> | null = null;
  private connecting: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  async subscribe(householdId: string, listener: ChangeListener): Promise<() => void> {
    const householdListeners = this.listeners.get(householdId) ?? new Set<ChangeListener>();
    householdListeners.add(listener);
    this.listeners.set(householdId, householdListeners);
    const unsubscribe = () => {
      householdListeners.delete(listener);
      if (!householdListeners.size) this.listeners.delete(householdId);
    };
    try {
      await this.ensureConnected();
      return unsubscribe;
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client || this.connecting || !this.listeners.size) return;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    await this.connecting;
  }

  private async connect(): Promise<void> {
    const client = new Client(databaseClientConfig("common-week-realtime"));
    const disconnected = () => this.handleDisconnect(client);
    client.on("notification", (notification: Notification) => this.handleNotification(notification));
    client.on("error", disconnected);
    client.on("end", disconnected);
    try {
      await client.connect();
      await client.query("listen common_week_changes");
      this.client = client;
    } catch {
      try { await client.end(); } catch {}
      this.scheduleReconnect();
      throw new Error("PostgreSQL realtime listener could not connect.");
    }
  }

  private handleNotification(notification: Notification) {
    if (!notification.payload) return;
    try {
      const payload = JSON.parse(notification.payload) as { householdId?: string; table?: string };
      if (!payload.householdId) return;
      for (const listener of this.listeners.get(payload.householdId) ?? []) listener(payload.table);
    } catch {
      // Only notifications matching the trigger payload shape are forwarded.
    }
  }

  private handleDisconnect(client: InstanceType<typeof Client>) {
    if (this.client !== client) return;
    this.client = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.retryTimer || !this.listeners.size) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.ensureConnected().catch(() => {
        // A failed reconnect schedules the next bounded retry in connect().
      });
    }, 2_000);
  }
}

declare global {
  var commonWeekRealtimeHub: PostgreSqlRealtimeHub | undefined;
}

export function getRealtimeHub(): PostgreSqlRealtimeHub {
  if (!globalThis.commonWeekRealtimeHub) globalThis.commonWeekRealtimeHub = new PostgreSqlRealtimeHub();
  return globalThis.commonWeekRealtimeHub;
}
