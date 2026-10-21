// Runs the db/ modules under Node: expo-sqlite (which pulls in react-native)
// is swapped for a stub, and tests hand the code a node:sqlite database
// behind the slice of the expo-sqlite API it uses.
import { registerHooks } from "node:module";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { Db } from "../database";
import { DDL } from "../schema";

const STUB_URL = "node:expo-sqlite-stub";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-sqlite") return { url: STUB_URL, format: "commonjs", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === STUB_URL) {
      return {
        format: "commonjs",
        source: "exports.openDatabaseAsync = () => { throw new Error('pass a db to the code under test'); };",
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});

type Params = SQLInputValue[];

function flat(params: unknown[]): Params {
  return (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as Params;
}

/** An in-memory database with the app's schema. */
export function createTestDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(DDL.join("\n"));
  const db = {
    raw,
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const r = raw.prepare(sql).run(...flat(params));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).all(...flat(params));
    },
    async getFirstAsync(sql: string, ...params: unknown[]) {
      return raw.prepare(sql).get(...flat(params)) ?? null;
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      raw.exec("BEGIN;");
      try {
        await fn();
        raw.exec("COMMIT;");
      } catch (err) {
        raw.exec("ROLLBACK;");
        throw err;
      }
    },
    async prepareAsync(sql: string) {
      const stmt = raw.prepare(sql);
      return {
        async executeAsync(...params: unknown[]) {
          stmt.run(...flat(params));
        },
        async finalizeAsync() {},
      };
    },
  };
  return db as unknown as Db & { raw: DatabaseSync };
}

/** Number of rows in `table`. */
export function count(db: { raw: DatabaseSync }, table: string): number {
  return Number((db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table};`).get() as { n: number }).n);
}
