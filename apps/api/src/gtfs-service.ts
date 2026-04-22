import {
  T816_TARGET_CODES,
  filterToRoutes,
  parseGtfsZip,
  type ParsedGtfs,
  type T816Bundle,
} from "@bus-tracker/shared";
import { TRAFFIC_SIGNALS } from "./data/traffic-signals.js";

const UPSTREAM_URL =
  "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder";
const TTL_MS = 24 * 60 * 60 * 1000;

export function withTrafficSignals(bundle: T816Bundle): T816Bundle {
  return { ...bundle, trafficSignals: TRAFFIC_SIGNALS };
}

interface BundleCache {
  fetchedAt: number;
  bundle: T816Bundle;
}

interface ParsedCache {
  fetchedAt: number;
  parsed: ParsedGtfs;
}

async function defaultFetchZip(): Promise<Uint8Array> {
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export class GtfsBundleService {
  private bundleCache: BundleCache | null = null;
  private parsedCache: ParsedCache | null = null;

  constructor(
    private readonly fetchZip: () => Promise<Uint8Array> = defaultFetchZip,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TTL_MS,
  ) {}

  private async fetchParsed(): Promise<ParsedGtfs> {
    const zip = await this.fetchZip();
    const parsed = parseGtfsZip(zip);
    this.parsedCache = { fetchedAt: this.now(), parsed };
    return parsed;
  }

  async getBundle(): Promise<{ bundle: T816Bundle; cached: boolean }> {
    const now = this.now();
    if (this.bundleCache && now - this.bundleCache.fetchedAt < this.ttlMs) {
      return { bundle: this.bundleCache.bundle, cached: true };
    }
    try {
      const parsed =
        this.parsedCache && now - this.parsedCache.fetchedAt < this.ttlMs
          ? this.parsedCache.parsed
          : await this.fetchParsed();
      const bundle = withTrafficSignals(
        filterToRoutes(parsed, T816_TARGET_CODES, this.now),
      );
      this.bundleCache = { fetchedAt: now, bundle };
      return { bundle, cached: false };
    } catch (err) {
      if (this.bundleCache) return { bundle: this.bundleCache.bundle, cached: true };
      throw err;
    }
  }

  async getParsed(): Promise<{ parsed: ParsedGtfs; cached: boolean }> {
    const now = this.now();
    if (this.parsedCache && now - this.parsedCache.fetchedAt < this.ttlMs) {
      return { parsed: this.parsedCache.parsed, cached: true };
    }
    try {
      const parsed = await this.fetchParsed();
      return { parsed, cached: false };
    } catch (err) {
      if (this.parsedCache) return { parsed: this.parsedCache.parsed, cached: true };
      throw err;
    }
  }

  async refresh(): Promise<T816Bundle> {
    const parsed = await this.fetchParsed();
    const bundle = withTrafficSignals(
      filterToRoutes(parsed, T816_TARGET_CODES, this.now),
    );
    this.bundleCache = { fetchedAt: this.now(), bundle };
    return bundle;
  }

  ageMs(): number | null {
    return this.bundleCache ? this.now() - this.bundleCache.fetchedAt : null;
  }
}

export const defaultService = new GtfsBundleService();
