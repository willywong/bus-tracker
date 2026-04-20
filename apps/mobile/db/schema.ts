export const SCHEMA_VERSION = 1;

export const DDL = [
  `CREATE TABLE IF NOT EXISTS routes (
    route_id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    long_name TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS stops (
    stop_id TEXT PRIMARY KEY NOT NULL,
    stop_name TEXT NOT NULL,
    stop_lat REAL NOT NULL,
    stop_lon REAL NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS trips (
    trip_id TEXT PRIMARY KEY NOT NULL,
    route_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    shape_id TEXT,
    direction_id INTEGER
  );`,
  `CREATE INDEX IF NOT EXISTS trips_route_id_idx ON trips(route_id);`,
  `CREATE TABLE IF NOT EXISTS shape_points (
    shape_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    PRIMARY KEY (shape_id, seq)
  );`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,
] as const;

export const META_KEYS = {
  fetchedAt: "fetchedAt",
  schemaVersion: "schemaVersion",
  generatedAt: "generatedAt",
} as const;
