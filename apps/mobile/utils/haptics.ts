import * as Haptics from 'expo-haptics';

/**
 * One haptic per user decision or meaningful moment, fired in the same frame
 * as the visual change. Never on refreshes or countdown ticks.
 *
 * expo-haptics is a native module; in dev clients built before it was added
 * the calls throw or reject, so every call is guarded.
 */
function guard(run: () => Promise<void> | void): void {
  try {
    const p = run();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Haptics unavailable — ignore.
  }
}

export const haptics = {
  /** Route switched, option picked. */
  selection: () => guard(() => Haptics.selectionAsync()),
  /** Started following a bus, favourite saved. */
  success: () =>
    guard(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    ),
  /** The leave-now window opened while following. */
  warning: () =>
    guard(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
    ),
  /** An action failed. */
  error: () =>
    guard(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    ),
  /** The followed bus is arriving at your stop. */
  arriving: () =>
    guard(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Light confirmation for small toggles (recenter, stop following). */
  light: () =>
    guard(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
