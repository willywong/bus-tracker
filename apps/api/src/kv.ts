/**
 * Minimal KV abstraction used by the push/register endpoint and the
 * /cron/leave-now poller. Uses Upstash-compatible REST (same protocol Vercel
 * KV exposes) when `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set; otherwise
 * falls back to an in-process map so local `tsx watch` dev still works.
 *
 * Values are JSON-encoded on write and decoded on read.
 */

export interface Kv {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
}

class InMemoryKv implements Kv {
  private readonly store = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }
}

class UpstashKv implements Kv {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call(command: readonly unknown[]): Promise<{ result: unknown }> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) {
      throw new Error(`kv ${String(command[0])} ${res.status}`);
    }
    return (await res.json()) as { result: unknown };
  }

  async get<T>(key: string): Promise<T | null> {
    const { result } = await this.call(["GET", key]);
    if (result == null) return null;
    return JSON.parse(String(result)) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.call(["SET", key, JSON.stringify(value)]);
  }
}

let singleton: Kv | null = null;

export function defaultKv(): Kv {
  if (!singleton) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    singleton = url && token ? new UpstashKv(url, token) : new InMemoryKv();
  }
  return singleton;
}

export function createInMemoryKv(): Kv {
  return new InMemoryKv();
}

export function createUpstashKv(
  url: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Kv {
  return new UpstashKv(url, token, fetchFn);
}

export function resetDefaultKvForTests(): void {
  singleton = null;
}
