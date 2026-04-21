import {
  filterToT816,
  parseGtfsZip,
  type T816Bundle,
} from "@bus-tracker/shared";
import { TRAFFIC_SIGNALS } from "./data/traffic-signals.js";

const UPSTREAM_URL =
  "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder";
const TTL_MS = 24 * 60 * 60 * 1000;

function withTrafficSignals(bundle: T816Bundle): T816Bundle {
  return { ...bundle, trafficSignals: TRAFFIC_SIGNALS };
}

interface CacheEntry {
  fetchedAt: number;
  bundle: T816Bundle;
}

async function defaultFetchZip(): Promise<Uint8Array> {
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export class GtfsBundleService {
  private cache: CacheEntry | null = null;

  constructor(
    private readonly fetchZip: () => Promise<Uint8Array> = defaultFetchZip,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TTL_MS,
  ) {}

  async getBundle(): Promise<{ bundle: T816Bundle; cached: boolean }> {
    const now = this.now();
    if (this.cache && now - this.cache.fetchedAt < this.ttlMs) {
      return { bundle: this.cache.bundle, cached: true };
    }
    try {
      const zip = await this.fetchZip();
      const bundle = withTrafficSignals(
        filterToT816(parseGtfsZip(zip), undefined, this.now),
      );
      this.cache = { fetchedAt: now, bundle };
      return { bundle, cached: false };
    } catch (err) {
      if (this.cache) return { bundle: this.cache.bundle, cached: true };
      throw err;
    }
  }

  async refresh(): Promise<T816Bundle> {
    const zip = await this.fetchZip();
    const bundle = withTrafficSignals(
      filterToT816(parseGtfsZip(zip), undefined, this.now),
    );
    this.cache = { fetchedAt: this.now(), bundle };
    return bundle;
  }

  ageMs(): number | null {
    return this.cache ? this.now() - this.cache.fetchedAt : null;
  }
}

export const defaultService = new GtfsBundleService();
