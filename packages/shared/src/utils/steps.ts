import { Unzip, UnzipInflate } from "fflate";

/**
 * Chunked-work building blocks. Long jobs (inflating a feed, scanning its
 * stop_times) are written as generators that `yield` every few ms of work;
 * {@link runSteps} drives one to the end without freezing the JS thread.
 */

/** Runs `steps` to the end, pausing for a macrotask whenever a slice has run `sliceMs`. */
export async function runSteps<T>(steps: Generator<void, T, void>, sliceMs = 8): Promise<T> {
  let sliceStart = Date.now();
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    if (Date.now() - sliceStart >= sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      sliceStart = Date.now();
    }
  }
}

/** Compressed bytes pushed through the inflater per step: a few ms on Hermes. */
export const UNZIP_STEP_BYTES = 16 * 1024;

/**
 * Inflates just the `names` files of a zip, as a generator that yields after
 * every 16 KB of it. Each file comes out as the chunks it inflated in.
 */
export function* unzipSteps(
  zip: Uint8Array,
  names: ReadonlySet<string>,
): Generator<void, Map<string, Uint8Array[]>, void> {
  // The streaming reader would take any bytes (an error page, a cut-off
  // download) as a zip with no files; insist on the central directory end,
  // as unzipSync does.
  if (!hasZipEnd(zip)) throw new Error("invalid zip data");
  const files = new Map<string, Uint8Array[]>();
  const unzip = new Unzip((file) => {
    if (!names.has(file.name)) return;
    const chunks: Uint8Array[] = [];
    files.set(file.name, chunks);
    file.ondata = (err, data) => {
      if (err) throw err;
      if (data.length > 0) chunks.push(data);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < zip.length; i += UNZIP_STEP_BYTES) {
    unzip.push(zip.subarray(i, i + UNZIP_STEP_BYTES), i + UNZIP_STEP_BYTES >= zip.length);
    yield;
  }
  return files;
}

/** Whether `zip` ends with an end-of-central-directory record. */
export function hasZipEnd(zip: Uint8Array): boolean {
  // The record is 22 bytes plus a comment of up to 64 KB.
  const last = zip.length - 22;
  for (let i = last; i >= 0 && last - i <= 0xffff; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

/** Hands out `chunks` one by one, letting go of each as it goes. */
export function* drain(chunks: Uint8Array[]): Generator<Uint8Array, void, void> {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    chunks[i] = EMPTY;
    yield chunk;
  }
}
const EMPTY = new Uint8Array(0);
