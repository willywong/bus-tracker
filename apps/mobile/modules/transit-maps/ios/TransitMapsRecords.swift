import ExpoModulesCore

// Records crossing the JS boundary. Each is a value type whose stored
// properties are `Field` wrappers (Sendable), so they can hop between the
// main actor and the module's nonisolated async functions.

/// A map region; defaults to the Klang Valley box (spec §3.1).
struct RegionRecord: Record, Sendable {
  @Field var lat: Double = 3.10
  @Field var lng: Double = 101.60
  @Field var latDelta: Double = 0.75
  @Field var lngDelta: Double = 0.70
}

struct PointRecord: Record, Sendable {
  @Field var lat: Double = 0
  @Field var lng: Double = 0
}

struct CompletionRecord: Record, Sendable {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var subtitle: String = ""
}

struct CompletionBatch: Record, Sendable {
  @Field var queryId: Int = 0
  @Field var results: [CompletionRecord] = []
  /// A newer query replaced this one before results came back; JS ignores it.
  @Field var superseded: Bool = false
}

struct PlaceRecord: Record, Sendable {
  @Field var name: String = ""
  @Field var address: String?
  @Field var lat: Double = 0
  @Field var lng: Double = 0
  /// `MKPointOfInterestCategory.rawValue`, or nil for an address.
  @Field var category: String?
}

struct WalkRecord: Record, Sendable {
  @Field var seconds: Double = 0
  @Field var meters: Double = 0
  /// `[lat, lng]` pairs, at most 200.
  @Field var coords: [[Double]] = []
}
