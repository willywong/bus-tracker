/*
 * Where the map faces (degrees clockwise from north): 0 on the north-up
 * map, the camera's heading while riding along or after the map is turned
 * by hand. The bus sprites are drawn for a heading on the screen, so each
 * marker picks its sprite by its bearing less this. One feed for the map;
 * only markers whose sprite changes redraw.
 */
let heading = 0;
const listeners = new Set<() => void>();

export const mapHeading = {
  get: () => heading,
  subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  },
  set(next: number) {
    const value = ((next % 360) + 360) % 360;
    if (!Number.isFinite(value) || value === heading) return;
    heading = value;
    for (const listener of listeners) listener();
  },
};
