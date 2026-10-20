/**
 * Optional BusBuddy backend (apps/api). The app reads GTFS straight from
 * data.gov.my and works without it; a backend is only needed for
 * server-sent "leave now" push notifications. Unset = no backend.
 */
export const API_BASE_URL: string | null =
  process.env.EXPO_PUBLIC_API_BASE_URL || null;
