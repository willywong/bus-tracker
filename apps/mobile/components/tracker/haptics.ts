import * as Haptics from 'expo-haptics';

/**
 * expo-haptics depends on a native module. In dev clients that haven't been rebuilt
 * after adding the dep, calling Haptics.* throws (or rejects) with
 * "not available on ios". Swallow both sync throws and async rejections so haptics
 * never gate interaction or crash the app.
 */
export function safeImpact(style: Haptics.ImpactFeedbackStyle): void {
  try {
    const p = Haptics.impactAsync(style);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Haptics unavailable — ignore.
  }
}

export function safeNotification(type: Haptics.NotificationFeedbackType): void {
  try {
    const p = Haptics.notificationAsync(type);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Haptics unavailable — ignore.
  }
}

export function safeSelection(): void {
  try {
    const p = Haptics.selectionAsync();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Haptics unavailable — ignore.
  }
}
