import * as SecureStore from 'expo-secure-store';

import { parseRecents, RECENTS_KEY, type RecentPlace } from './recents';

/**
 * Recents in SecureStore, like settings (no SQLite migration). Kept apart
 * from `recents.ts` so the pure merge runs under `tsx --test`.
 */
export async function loadRecents(): Promise<RecentPlace[]> {
  try {
    return parseRecents(await SecureStore.getItemAsync(RECENTS_KEY));
  } catch {
    return [];
  }
}

export async function saveRecents(list: readonly RecentPlace[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(RECENTS_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[plan] could not save recents', err);
  }
}
