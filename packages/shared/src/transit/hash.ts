/** Bytes hashed per step of {@link fnv1a32HexSteps}: about a millisecond on Hermes. */
export const HASH_STEP_BYTES = 64 * 1024;

/**
 * FNV-1a (32-bit) of `bytes`, as 8 lowercase hex digits. A cheap content
 * hash for a downloaded feed zip that came without an ETag: enough to tell
 * "same file as last time" apart from "new file", not a security hash.
 * A generator that yields every {@link HASH_STEP_BYTES} (drive it with
 * `runSteps`), since a 2 MB zip takes tens of ms on Hermes in one go.
 */
export function* fnv1a32HexSteps(bytes: Uint8Array): Generator<void, string, void> {
  let h = 0x811c9dc5;
  for (let start = 0; start < bytes.length; start += HASH_STEP_BYTES) {
    const end = Math.min(bytes.length, start + HASH_STEP_BYTES);
    for (let i = start; i < end; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    if (end < bytes.length) yield;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** {@link fnv1a32HexSteps} in one go, for small inputs, tests and scripts. */
export function fnv1a32Hex(bytes: Uint8Array): string {
  const steps = fnv1a32HexSteps(bytes);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
