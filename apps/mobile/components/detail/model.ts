import type { FactTile } from '@/components/trip/Facts';
import { mins, type HeroValue } from '@/components/trip/model';

/**
 * View models for the map-selection sheets: a stop or a bus tapped on the
 * map (or a stop tapped in the sheet). Pure, so the wording is testable; the
 * hooks in hooks/useMapDetail.ts gather the inputs.
 */

export type DetailSource = 'live' | 'scheduled';

export interface DetailModel {
  title: string;
  /** Second header line: where this sits relative to your trip. */
  subtitle: string | null;
  hero: HeroValue | null;
  /** Small line under the hero: "Live · 2 stops away", "Scheduled". */
  source: DetailSource | null;
  line: string[];
  /** Stops a live bus has before it gets here (or to your stop), for the peek rail. */
  stopsAhead: number | null;
  facts: FactTile[];
  /** Peek strip text: the one thing worth knowing. */
  peek: string;
  /** VoiceOver summary of the hero. */
  accessibilityLabel: string;
}

// ---------------------------------------------------------------- stop

export interface StopDetailInput {
  stopName: string;
  routeCode: string;
  /** Position of this stop and of yours in route order (0-based), null if unknown. */
  stopIndex: number | null;
  userStopIndex: number | null;
  stopCount: number;
  /** The nearest live bus approaching this stop. */
  live: { minutes: number; stopsAway: number } | null;
  /** Upcoming scheduled departures here, epoch ms, ascending. */
  scheduled: number[];
  now: number;
  formatClock: (epochMs: number) => string;
  /** Other route codes that call here (this route excluded). */
  otherRoutes: string[];
  /** GTFS wheelchair_boarding: 1 accessible, 2 not, else unknown. */
  wheelchair: number | null;
}

export function buildStopDetail(input: StopDetailInput): DetailModel {
  const relation = stopRelation(input.stopIndex, input.userStopIndex, input.stopCount);
  const position =
    input.stopIndex != null && input.stopCount > 0
      ? `Stop ${input.stopIndex + 1} of ${input.stopCount}`
      : null;
  const subtitle = [position, relation].filter(Boolean).join(' · ') || null;

  const firstSched = input.scheduled.find((ms) => ms >= input.now) ?? null;
  let hero: HeroValue | null = null;
  let source: DetailSource | null = null;
  const line: string[] = [];
  let peek = 'No more buses today';
  let a11y = 'No more buses here today';

  if (input.live) {
    const m = Math.max(0, Math.round(input.live.minutes));
    hero =
      m < 1
        ? { text: 'Due', unit: null, kind: 'word' }
        : { text: String(m), unit: m === 1 ? 'min' : 'mins', kind: 'minutes' };
    source = 'live';
    line.push(stopsAwayText(input.live.stopsAway, true));
    peek = m < 1 ? `Next ${input.routeCode} is due` : `Next ${input.routeCode} in ${mins(m)}`;
    a11y =
      m < 1
        ? `Next ${input.routeCode} bus is due, live`
        : `Next ${input.routeCode} bus in ${m} minutes, live`;
  } else if (firstSched != null) {
    const m = Math.max(0, Math.floor((firstSched - input.now) / 60_000));
    const clock = input.formatClock(firstSched);
    hero =
      m >= 60
        ? { text: clock, unit: null, kind: 'clock' }
        : m < 1
          ? { text: 'Due', unit: null, kind: 'word' }
          : { text: String(m), unit: m === 1 ? 'min' : 'mins', kind: 'minutes' };
    source = 'scheduled';
    if (m < 60) line.push(`Departs ${clock}`);
    peek = `Next ${input.routeCode} at ${clock}`;
    a11y = `Next ${input.routeCode} bus at ${clock}, scheduled`;
  }

  const facts: FactTile[] = [];
  const after = input.scheduled.filter((ms) => ms >= input.now)[input.live ? 0 : 1];
  if (after != null) {
    facts.push({
      id: 'next',
      label: input.live ? 'Next scheduled' : 'Bus after',
      value: input.formatClock(after),
      caption: null,
    });
  }
  if (input.wheelchair === 1 || input.wheelchair === 2) {
    facts.push({
      id: 'access',
      label: 'Wheelchair',
      value: input.wheelchair === 1 ? 'Step-free' : 'Not step-free',
      caption: null,
    });
  } else if (input.otherRoutes.length > 0) {
    facts.push({
      id: 'routes',
      label: 'Routes here',
      value: `${input.otherRoutes.length + 1} routes`,
      caption: `Also ${input.otherRoutes.slice(0, 3).join(', ')}`,
    });
  }

  return {
    title: input.stopName,
    subtitle,
    hero,
    source,
    line,
    stopsAhead: input.live?.stopsAway ?? null,
    facts,
    peek,
    accessibilityLabel: a11y,
  };
}

/** "3 stops before yours" / "2 stops after yours" / "Your stop", on a loop. */
export function stopRelation(
  stopIndex: number | null,
  userIndex: number | null,
  count: number,
): string | null {
  if (stopIndex == null || userIndex == null || count <= 0) return null;
  const before = (userIndex - stopIndex + count) % count;
  if (before === 0) return 'Your stop';
  const after = count - before;
  if (before <= after) return `${before} ${before === 1 ? 'stop' : 'stops'} before yours`;
  return `${after} ${after === 1 ? 'stop' : 'stops'} after yours`;
}

function stopsAwayText(n: number, capitalised = false): string {
  if (n <= 0) return capitalised ? 'Next stop' : 'next stop';
  return n === 1 ? '1 stop away' : `${n} stops away`;
}

// ----------------------------------------------------------------- bus

export interface BusDetailInput {
  routeCode: string;
  headsign: string | null;
  /** Still in the live feed. */
  reporting: boolean;
  /** The bus your trip is following. */
  isYourBus: boolean;
  speedKmh: number | null;
  /** "Stopped at a traffic light", when not simply moving. */
  motionLabel: string | null;
  observedAt: number | null;
  now: number;
  formatClock: (epochMs: number) => string;
  nearStopName: string | null;
  /** On its way to your stop: minutes, stops and metres along the route. */
  toYourStop: {
    minutes: number;
    stopsAway: number | null;
    meters: number;
  } | null;
  /** Already gone past your stop on this lap. */
  passed: boolean;
  /** Your stop's name, for the copy. */
  yourStopName: string | null;
}

export function buildBusDetail(input: BusDetailInput): DetailModel {
  const title = input.headsign ? `To ${input.headsign}` : `${input.routeCode} bus`;
  const subtitle = input.isYourBus
    ? 'Your bus'
    : input.nearStopName
      ? `Near ${input.nearStopName}`
      : null;

  if (!input.reporting) {
    return {
      title,
      subtitle,
      hero: null,
      source: null,
      line: [
        input.observedAt != null
          ? `Stopped reporting · last seen ${input.formatClock(input.observedAt)}`
          : 'Stopped reporting',
      ],
      stopsAhead: null,
      facts: [],
      peek: 'This bus stopped reporting',
      accessibilityLabel: 'This bus stopped reporting its position',
    };
  }

  const line: string[] = [];
  const motion = input.motionLabel ?? movingText(input.speedKmh);
  if (motion) line.push(motion);
  const age = input.observedAt != null ? Math.floor((input.now - input.observedAt) / 1000) : null;
  if (age != null && age >= 90) line.push(`Updated ${mins(Math.floor(age / 60))} ago`);

  let hero: HeroValue | null = null;
  let peek: string;
  let a11y: string;
  const facts: FactTile[] = [];
  const yours = input.yourStopName ?? 'your stop';

  if (input.toYourStop && !input.passed) {
    const m = Math.max(0, Math.round(input.toYourStop.minutes));
    hero =
      m < 1
        ? { text: 'Due', unit: null, kind: 'word' }
        : { text: String(m), unit: m === 1 ? 'min' : 'mins', kind: 'minutes' };
    peek = m < 1 ? `Due at ${yours}` : `${mins(m)} to ${yours}`;
    a11y = m < 1 ? `Due at ${yours}, live` : `${m} minutes to ${yours}, live`;
    facts.push({
      id: 'yours',
      label: 'To your stop',
      value:
        input.toYourStop.stopsAway == null
          ? formatDistance(input.toYourStop.meters)
          : stopsAwayText(input.toYourStop.stopsAway, true),
      caption: input.yourStopName,
    });
    if (input.toYourStop.stopsAway != null) {
      facts.push({
        id: 'distance',
        label: 'Distance',
        value: formatDistance(input.toYourStop.meters),
        caption: 'Along the route',
      });
    }
  } else {
    peek = input.passed ? `Passed ${yours}` : 'On the route';
    a11y = input.passed ? `This bus has passed ${yours}` : 'Bus on the route, live';
    if (input.passed) line.unshift(`Passed ${yours}`);
  }

  return {
    title,
    subtitle,
    hero,
    source: 'live',
    line,
    stopsAhead: input.toYourStop && !input.passed ? input.toYourStop.stopsAway : null,
    facts,
    peek,
    accessibilityLabel: a11y,
  };
}

function movingText(speedKmh: number | null): string | null {
  if (speedKmh == null) return null;
  if (speedKmh < 1) return 'Stopped';
  return `Moving · ${Math.round(speedKmh)} km/h`;
}

export function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
