"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ActionResult, PlannerSourcePayload } from "@/types/domain";

export function usePlannerSource(source: "calendar" | "weather", week: string, dependencyKey: string, enabled: boolean, onResult: (result: ActionResult<PlannerSourcePayload>) => void) {
  const receive = useRef(onResult);
  useEffect(() => { receive.current = onResult; }, [onResult]);
  const request = useRef<AbortController | null>(null);
  const key = `${week}:${dependencyKey}`;
  const refresh = useCallback(async () => {
    if (!enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch(`/api/planner/sources?source=${source}&week=${encodeURIComponent(week)}`, {
        signal: controller.signal, cache: "no-store",
      });
      const payload: ActionResult<PlannerSourcePayload> = await response.json().catch(() => ({ ok: false, error: response.status === 401 ? "Your session expired. Sign in again to refresh." : `${source === "calendar" ? "Calendar" : "Weather"} could not be refreshed. Try again.` }));
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? `${source === "calendar" ? "Calendar" : "Weather"} could not be refreshed. Try again.`);
      if (!controller.signal.aborted) receive.current(payload);
    } catch (error) {
      if (!controller.signal.aborted) receive.current({ ok: false, error: error instanceof TypeError ? "Connection interrupted. Check your connection and try again." : error instanceof Error ? error.message : "Could not refresh. Try again." });
    }
  }, [enabled, source, week]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [key, refresh]);
  return refresh;
}
