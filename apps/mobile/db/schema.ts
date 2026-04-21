export const SCHEMA_VERSION = 3;

export const DDL = [
  `CREATE TABLE IF NOT EXISTS routes (
    route_id TEXT PRIMARY KEY NOT NULL,
    code TEXT NOT NULL,
    long_name TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS traffic_signals (
    route_code TEXT NOT NULL,
    osm_id INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    PRIMARY KEY (route_code, osm_id)
  );`,
  `CREATE INDEX IF NOT EXISTS traffic_signals_route_idx
    ON traffic_signals(route_code);`,
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
  `CREATE TABLE IF NOT EXISTS stop_times (
    trip_id TEXT NOT NULL,
    stop_sequence INTEGER NOT NULL,
    stop_id TEXT NOT NULL,
    arrival_seconds INTEGER,
    departure_seconds INTEGER,
    PRIMARY KEY (trip_id, stop_sequence)
  );`,
  `CREATE INDEX IF NOT EXISTS stop_times_stop_idx
    ON stop_times(stop_id, departure_seconds);`,
  `CREATE INDEX IF NOT EXISTS stop_times_trip_stop_idx
    ON stop_times(trip_id, stop_id);`,
  `CREATE TABLE IF NOT EXISTS calendar (
    service_id TEXT PRIMARY KEY NOT NULL,
    monday INTEGER NOT NULL,
    tuesday INTEGER NOT NULL,
    wednesday INTEGER NOT NULL,
    thursday INTEGER NOT NULL,
    friday INTEGER NOT NULL,
    saturday INTEGER NOT NULL,
    sunday INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL
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
