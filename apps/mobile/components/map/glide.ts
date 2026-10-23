import type { LatLng } from '@bus-tracker/shared';

/** A stretch of a glide; a straight one may not know its heading. */
export interface GlideLeg {
  to: LatLng;
  meters: number;
  bearing: number | undefined;
}

/** A leg on the clock: the marker reaches `to` at `endMs`. */
export interface GlideStep {
  to: LatLng;
  bearing: number | undefined;
  startMs: number;
  endMs: number;
}

/** Where a marker is going: from `from`, through each step in turn. Done once the last ends. */
export interface GlidePlan {
  from: LatLng;
  steps: GlideStep[];
}

/** Each leg's share of `durationMs` by its length, starting at `startMs`. */
export function planGlide(
  from: LatLng,
  legs: readonly GlideLeg[],
  startMs: number,
  durationMs: number,
): GlidePlan {
  const total = legs.reduce((sum, leg) => sum + leg.meters, 0);
  let at = startMs;
  const steps = legs.map((leg, i) => {
    const startAt = at;
    at =
      i === legs.length - 1
        ? startMs + durationMs
        : at + (total > 0 ? (durationMs * leg.meters) / total : durationMs / legs.length);
    return { to: leg.to, bearing: leg.bearing, startMs: startAt, endMs: at };
  });
  return { from, steps };
}

/** The step under way at `t`: its index, or `steps.length` once the glide is done. */
export function stepAt(plan: GlidePlan, t: number): number {
  const i = plan.steps.findIndex((s) => t < s.endMs);
  return i < 0 ? plan.steps.length : i;
}

/** Where the marker is at `t`: straight along each step, as the native marker moves it. */
export function positionAt(plan: GlidePlan, t: number): LatLng {
  const i = stepAt(plan, t);
  if (i >= plan.steps.length) return endOf(plan);
  const step = plan.steps[i];
  const from = i === 0 ? plan.from : plan.steps[i - 1].to;
  const span = step.endMs - step.startMs;
  const k = span > 0 ? Math.min(1, Math.max(0, (t - step.startMs) / span)) : 1;
  return {
    lat: from.lat + (step.to.lat - from.lat) * k,
    lng: from.lng + (step.to.lng - from.lng) * k,
  };
}

export function endOf(plan: GlidePlan): LatLng {
  return plan.steps.at(-1)?.to ?? plan.from;
}

/** Below this, a turn isn't worth redrawing the marker (the map's sprites step every 15°). */
const HEADING_STEP_DEG = 7.5;

/**
 * A marker's heading while it glides. Set at each corner it turns; only that
 * marker redraws (BusMarker subscribes), not the map screen.
 */
export interface HeadingFeed {
  get(): number | undefined;
  subscribe(onChange: () => void): () => void;
  set(bearing: number | undefined): void;
}

export function headingFeed(initial: number | undefined): HeadingFeed {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    set(bearing) {
      if (bearing === value) return;
      if (bearing != null && value != null) {
        const turn = Math.abs(((((bearing - value) % 360) + 540) % 360) - 180);
        if (turn < HEADING_STEP_DEG) return;
      }
      value = bearing;
      for (const listener of listeners) listener();
    },
  };
}

/** The native marker (react-native-maps' `MapMarker`): moves itself, no JS per frame. */
export interface MarkerMover {
  animateMarkerToCoordinate(coordinate: { latitude: number; longitude: number }, ms?: number): void;
}

/**
 * One bus's glide between fixes, driven on the native side: each leg is a
 * single native move (the marker interpolates on its own display link), and
 * a timer starts the next at each corner, turning the heading there. JS runs
 * once per corner, not once per frame.
 *
 * The marker mounts wherever the glide has got to (`at()`) and keeps that
 * coordinate prop for life, so a re-render never snaps it back; `attach`
 * picks up the leg under way.
 */
export class Glider {
  readonly heading: HeadingFeed;
  private plan: GlidePlan;
  private marker: MarkerMover | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    at: LatLng,
    bearing: number | undefined,
    private readonly clock: () => number = Date.now,
  ) {
    this.plan = { from: at, steps: [] };
    this.heading = headingFeed(bearing);
  }

  /** Where the marker is now (or at `t`). */
  at(t: number = this.clock()): LatLng {
    return positionAt(this.plan, t);
  }

  /** Where it's going: the end of the glide under way, or where it rests. */
  get target(): LatLng {
    return endOf(this.plan);
  }

  /** The marker drawing this bus, as it mounts (null as it unmounts). */
  attach(marker: MarkerMover | null) {
    this.marker = marker;
    if (marker) this.run();
  }

  /** Through `legs` in `durationMs`, from wherever it is now. */
  glide(legs: readonly GlideLeg[], durationMs: number) {
    const now = this.clock();
    this.plan = planGlide(this.at(now), legs, now, durationMs);
    this.run();
  }

  /** Straight there, no glide: to `to`, or to the end of the glide under way. */
  jump(to?: LatLng, bearing?: number) {
    const end = to ?? endOf(this.plan);
    const facing = bearing ?? this.plan.steps.findLast((s) => s.bearing != null)?.bearing;
    this.halt();
    this.plan = { from: end, steps: [] };
    if (facing != null) this.heading.set(facing);
    this.marker?.animateMarkerToCoordinate({ latitude: end.lat, longitude: end.lng }, 0);
  }

  /** Stops the corner timer; the native leg under way runs out on its own. */
  halt() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private run() {
    this.halt();
    const now = this.clock();
    const step = this.plan.steps[stepAt(this.plan, now)];
    if (!step) {
      // At rest: make sure the marker is too (a new marker, a glide's end).
      const end = endOf(this.plan);
      this.marker?.animateMarkerToCoordinate({ latitude: end.lat, longitude: end.lng }, 0);
      return;
    }
    if (step.bearing != null) this.heading.set(step.bearing);
    const ms = Math.max(0, Math.round(step.endMs - now));
    this.marker?.animateMarkerToCoordinate({ latitude: step.to.lat, longitude: step.to.lng }, ms);
    this.timer = setTimeout(() => this.run(), ms);
  }
}
