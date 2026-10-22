import type { TransitNetwork } from "./network.js";

interface Lookups {
  stops: Map<string, number>;
  stations: Map<string, number>;
  /** Per station: its stops, ascending. */
  members: number[][];
}

const cache = new WeakMap<TransitNetwork, Lookups>();

/** Built on first use and kept per network; the network must not change afterwards. */
function lookups(net: TransitNetwork): Lookups {
  let l = cache.get(net);
  if (!l) {
    const stops = new Map<string, number>();
    for (let s = 0; s < net.stops.count; s++) stops.set(net.stops.id[s], s);
    const stations = new Map<string, number>();
    net.stations.forEach((st, i) => stations.set(st.id, i));
    const members: number[][] = net.stations.map(() => []);
    for (let s = 0; s < net.stops.count; s++) {
      const st = net.stops.station[s];
      if (st >= 0 && st < members.length) members[st].push(s);
    }
    cache.set(net, (l = { stops, stations, members }));
  }
  return l;
}

/** Index of the stop with namespaced id `id`, or -1. */
export function stopIndexById(net: TransitNetwork, id: string): number {
  return lookups(net).stops.get(id) ?? -1;
}

/** Index into `net.stations` of the station with slug `id` (`RailStation.id`), or -1. */
export function stationIndexById(net: TransitNetwork, id: string): number {
  return lookups(net).stations.get(id) ?? -1;
}

/** The stops whose `stops.station` is `station`, ascending; empty for -1. Do not mutate. */
export function stationMembers(net: TransitNetwork, station: number): number[] {
  return lookups(net).members[station] ?? [];
}
