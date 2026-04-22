import { useEffect } from "react";
import { realtimeStore } from "@/services/realtime";
import { useSettings } from "@/hooks/useSettings";

/**
 * Syncs the singleton realtime poller with the user's current favorites.
 * Mount once near the app root, inside `SettingsProvider`.
 */
export function useRealtimeRoutes(): void {
  const { favoritedRoutes } = useSettings();
  const key = favoritedRoutes.join(",");

  useEffect(() => {
    realtimeStore.setRouteCodes(favoritedRoutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
