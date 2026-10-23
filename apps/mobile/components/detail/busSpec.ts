import type { BusKind } from '@/modules/bus-model';

/** What a 3D bus stands for: the bus that usually works its routes. */
export interface BusSpec {
  /** "MRT feeder bus". */
  name: string;
  /** "Volvo B7RLE". */
  chassis: string;
  /** "Gemilang". */
  body: string;
  /** "10.5 m". */
  length: string;
  /** "Rapid Bus". */
  operator: string;
}

/**
 * From the build scripts' notes (modules/bus-model/scripts): the feed names
 * the bus by plate only, so these describe the kind of bus on the route, not
 * the one at this plate.
 */
export const BUS_SPECS: Record<BusKind, BusSpec> = {
  feeder: {
    name: 'MRT feeder bus',
    chassis: 'Volvo B7RLE',
    body: 'Gemilang',
    length: '10.5 m',
    operator: 'Rapid Bus',
  },
  rapid: {
    name: 'rapidKL city bus',
    chassis: 'Scania K250UB',
    body: 'Gemilang',
    length: '12 m',
    operator: 'Rapid Bus',
  },
};

/**
 * A vehicle id as its number plate, "VH4652" → "VH 4652", or null when it
 * isn't one (the feed falls back to a trip id when a bus has no plate).
 */
export function formatPlate(vehicleId: string): string | null {
  const id = vehicleId.replace(/^[a-z]+:/, '').trim();
  const match = /^([A-Z]{1,3})\s*(\d{1,4})\s*([A-Z]?)$/i.exec(id);
  if (!match) return null;
  const [, letters, digits, suffix] = match;
  return `${letters.toUpperCase()} ${digits}${suffix.toUpperCase()}`;
}
