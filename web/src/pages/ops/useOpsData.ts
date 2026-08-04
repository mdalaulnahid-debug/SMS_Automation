import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { OpsOverview, OpsActivityEvent } from "./types";

// Ported from public/app.js's refreshOps()/boot() — same two endpoints,
// same 15s poll interval.
export function useOpsData() {
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [activity, setActivity] = useState<OpsActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [overviewRes, activityRes] = await Promise.all([
        apiFetch("/api/ops/overview"),
        apiFetch("/api/ops/activity"),
      ]);
      const overviewBody = (await overviewRes.json()) as OpsOverview;
      const activityBody = (await activityRes.json()) as { activity?: OpsActivityEvent[] };
      setOverview(overviewBody);
      setActivity(activityBody.activity || []);
    } catch (error) {
      console.error("Failed to refresh operations data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { overview, activity, loading, refresh };
}
