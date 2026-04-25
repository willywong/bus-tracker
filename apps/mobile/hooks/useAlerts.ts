import type { ServiceAlert } from "@bus-tracker/shared";
import { useEffect, useSyncExternalStore } from "react";

import { alertsStore } from "@/services/alerts";

export interface UseAlertsOptions {
  routeCodes?: readonly string[];
  stopIds?: readonly string[];
}

export interface UseAlertsResult {
  alerts: ServiceAlert[];
  lastUpdated: number | null;
  lastError: Error | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export function useAlerts(opts: UseAlertsOptions = {}): UseAlertsResult {
  const snap = useSyncExternalStore(
    alertsStore.subscribe,
    alertsStore.getSnapshot,
    alertsStore.getSnapshot,
  );

  const routeKey = (opts.routeCodes ?? []).join(",");
  const stopKey = (opts.stopIds ?? []).join(",");

  useEffect(() => {
    alertsStore.start();
    return () => alertsStore.stop();
  }, []);

  useEffect(() => {
    alertsStore.setScope({
      routeCodes: opts.routeCodes,
      stopIds: opts.stopIds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, stopKey]);

  return {
    alerts: snap.alerts,
    lastUpdated: snap.lastUpdated,
    lastError: snap.lastError,
    isRefreshing: snap.isRefreshing,
    refresh: () => alertsStore.refresh(),
  };
}
