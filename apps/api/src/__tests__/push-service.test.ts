import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryKv } from "../kv.js";
import {
  InvalidPayloadError,
  PRIMARY_KEY,
  loadPushRegistration,
  parseRegisterBody,
  savePushRegistration,
  type PushRegistration,
} from "../push-service.js";

const VALID_BODY = Object.freeze({
  deviceId: "device-abc",
  token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  settings: {
    walkMinutes: 10,
    notifBufferMin: 1,
    preferredStopId: "HOTEL_LISA_DE_INN",
    quietStartMin: 22 * 60,
    quietEndMin: 6 * 60,
  },
});

test("parseRegisterBody: accepts a valid payload", () => {
  const now = () => 42;
  const parsed = parseRegisterBody(VALID_BODY, now);
  assert.equal(parsed.deviceId, "device-abc");
  assert.equal(parsed.token, VALID_BODY.token);
  assert.equal(parsed.registeredAt, 42);
  assert.equal(parsed.settings.walkMinutes, 10);
  assert.equal(parsed.settings.preferredStopId, "HOTEL_LISA_DE_INN");
});

test("parseRegisterBody: rejects missing deviceId", () => {
  assert.throws(
    () => parseRegisterBody({ ...VALID_BODY, deviceId: "" }),
    InvalidPayloadError,
  );
});

test("parseRegisterBody: rejects non-Expo token", () => {
  assert.throws(
    () => parseRegisterBody({ ...VALID_BODY, token: "not-an-expo-token" }),
    InvalidPayloadError,
  );
});

test("parseRegisterBody: rejects non-finite settings values", () => {
  assert.throws(
    () =>
      parseRegisterBody({
        ...VALID_BODY,
        settings: { ...VALID_BODY.settings, walkMinutes: Number.NaN },
      }),
    InvalidPayloadError,
  );
});

test("parseRegisterBody: rejects non-object body", () => {
  assert.throws(() => parseRegisterBody(null), InvalidPayloadError);
  assert.throws(() => parseRegisterBody("string"), InvalidPayloadError);
});

test("savePushRegistration / loadPushRegistration roundtrip via KV", async () => {
  const kv = createInMemoryKv();
  const registration: PushRegistration = {
    ...parseRegisterBody(VALID_BODY, () => 100),
  };
  await savePushRegistration(registration, kv);

  const loaded = await loadPushRegistration(kv);
  assert.deepEqual(loaded, registration);

  const raw = await kv.get<PushRegistration>(PRIMARY_KEY);
  assert.equal(raw?.deviceId, "device-abc");
});
