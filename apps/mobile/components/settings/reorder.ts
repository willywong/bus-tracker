/**
 * SwiftUI's `onMove` result applied to an array (`Array.move(fromOffsets:toOffset:)`).
 * `destination` counts positions before the moved items are removed, so it
 * can equal `items.length`.
 */
export function moveItems<T>(items: readonly T[], sources: number[], destination: number): T[] {
  const picked = new Set(sources.filter((i) => i >= 0 && i < items.length));
  if (picked.size === 0) return [...items];
  const moving = items.filter((_, i) => picked.has(i));
  const rest = items.filter((_, i) => !picked.has(i));
  const before = [...picked].filter((i) => i < destination).length;
  const at = Math.min(Math.max(destination - before, 0), rest.length);
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}
