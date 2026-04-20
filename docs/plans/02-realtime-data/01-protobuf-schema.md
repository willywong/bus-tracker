# 02-Realtime-Data / 01 — Protobuf Schema Setup

## Context
- Phase 01 complete: static data on-device.
- GTFS Realtime endpoint returns binary protobuf. We must decode it using the canonical `gtfs-realtime.proto` schema.

## Goal
Ship the `gtfs-realtime.proto` schema inside `@bus-tracker/shared` and a typed decode helper that returns `FeedMessage` objects.

## Prerequisites
- `protobufjs` installed.

## Steps
1. Download the canonical proto: https://gtfs.org/documentation/realtime/proto/ → save to `packages/shared/src/proto/gtfs-realtime.proto`.
2. Implement `packages/shared/src/utils/protobuf.ts`:
   ```ts
   import { load, Type } from 'protobufjs';
   import path from 'node:path';
   let _FeedMessage: Type | null = null;
   export async function getFeedMessage(): Promise<Type> { /* cached load */ }
   export async function decodeFeed(buf: Uint8Array) { /* returns decoded.toJSON() shape */ }
   ```
3. For React Native, use `protobuf.parse(source)` with the proto file text imported via Metro asset (or inline the parsed JSON descriptor). Write a helper that works isomorphically.
4. Add a `__tests__` case using a real captured response bytes committed as a fixture.

## Verification
- `decodeFeed(realBytes)` produces `.entity[].vehicle.position.{latitude, longitude}` numbers.

## Handoff to next step ([02-realtime-fetcher.md](./02-realtime-fetcher.md))
- A reusable pure function decodes binary → typed vehicle positions.
