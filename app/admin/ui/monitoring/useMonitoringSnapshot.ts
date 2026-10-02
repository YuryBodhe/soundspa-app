"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MonitoringSnapshotV1 } from "../../../../db/v2/monitoringSnapshotModel";
import { createMonitoringAutoRefresh } from "./monitoringAutoRefresh";

export function useMonitoringSnapshot(initialSnapshot: MonitoringSnapshotV1) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refresher = useRef<ReturnType<typeof createMonitoringAutoRefresh> | null>(null);

  useEffect(() => {
    const current = createMonitoringAutoRefresh({
      fetchSnapshot: async (signal) => {
        const response = await fetch("/api/v2/admin/monitoring", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        });
        if (!response.ok) throw new Error("Monitoring snapshot refresh failed.");
        return await response.json() as MonitoringSnapshotV1;
      },
      onSnapshot: (next) => { setSnapshot(next); setRefreshError(false); },
      onError: () => setRefreshError(true),
      onRefreshing: setRefreshing,
    });
    refresher.current = current;
    current.start();
    return () => {
      current.stop();
      if (refresher.current === current) refresher.current = null;
    };
  }, []);

  const refresh = useCallback(() => refresher.current?.refresh(), []);
  return { snapshot, refreshing, refreshError, refresh };
}
