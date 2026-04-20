import type { Kv } from "./kv.js";
import { defaultKv } from "./kv.js";

/**
 * Subset of `Settings` from the mobile app that the backend needs to evaluate
 * `shouldNotify`. Kept here (not imported from the mobile package) so this
 * service stays free of React Native dependencies.
 */
export interface PushSettings {
  walkMinutes: number;
  notifBufferMin: number;
  preferredStopId: string;
  quietStartMin: number;
  quietEndMin: number;
}

export interface PushRegistration {
  deviceId: string;
  token: string;
  settings: PushSettings;
  registeredAt: number;
}

export interface RegisterPushBody {
  deviceId?: unknown;
  token?: unknown;
  settings?: unknown;
}

/** Single-user app: one record lives under this key. */
export const PRIMARY_KEY = "bt:push:primary";

export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

export function parseRegisterBody(
  body: unknown,
  now: () => number = Date.now,
): PushRegistration {
  if (!body || typeof body !== "object") {
    throw new InvalidPayloadError("expected JSON object body");
  }
  const raw = body as RegisterPushBody;

  if (typeof raw.deviceId !== "string" || raw.deviceId.length === 0) {
    throw new InvalidPayloadError("deviceId must be a non-empty string");
  }
  if (typeof raw.token !== "string" || !raw.token.startsWith("ExponentPushToken[")) {
    throw new InvalidPayloadError(
      'token must be a string starting with "ExponentPushToken["',
    );
  }

  const settings = parseSettings(raw.settings);

  return {
    deviceId: raw.deviceId,
    token: raw.token,
    settings,
    registeredAt: now(),
  };
}

function parseSettings(input: unknown): PushSettings {
  if (!input || typeof input !== "object") {
    throw new InvalidPayloadError("settings must be an object");
  }
  const s = input as Record<string, unknown>;
  const walkMinutes = finiteNumber(s.walkMinutes, "walkMinutes");
  const notifBufferMin = finiteNumber(s.notifBufferMin, "notifBufferMin");
  const quietStartMin = finiteNumber(s.quietStartMin, "quietStartMin");
  const quietEndMin = finiteNumber(s.quietEndMin, "quietEndMin");
  if (typeof s.preferredStopId !== "string" || s.preferredStopId.length === 0) {
    throw new InvalidPayloadError("preferredStopId must be a non-empty string");
  }
  return {
    walkMinutes,
    notifBufferMin,
    preferredStopId: s.preferredStopId,
    quietStartMin,
    quietEndMin,
  };
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidPayloadError(`${name} must be a finite number`);
  }
  return value;
}

export async function savePushRegistration(
  registration: PushRegistration,
  kv: Kv = defaultKv(),
): Promise<void> {
  await kv.set(PRIMARY_KEY, registration);
}

export async function loadPushRegistration(
  kv: Kv = defaultKv(),
): Promise<PushRegistration | null> {
  return kv.get<PushRegistration>(PRIMARY_KEY);
}
