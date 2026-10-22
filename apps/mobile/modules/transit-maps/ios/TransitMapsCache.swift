import Foundation

/// Image cache under `Caches/transit-maps/` (iOS may purge it). Files expire
/// after 30 days; Look Around's `.none` "no coverage" markers after 7.
/// Stateless and FileManager-only, so it is safe from any thread.
enum TransitMapsCache {
  static let maxAge: TimeInterval = 30 * 24 * 60 * 60
  static let noneMaxAge: TimeInterval = 7 * 24 * 60 * 60

  static let root: URL = FileManager.default
    .urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("transit-maps", isDirectory: true)

  /// The cached file for `key` if it exists and is younger than `maxAge`.
  static func fresh(_ key: String, maxAge: TimeInterval = maxAge) -> URL? {
    let url = root.appendingPathComponent(key)
    guard
      let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
      let modified = attributes[.modificationDate] as? Date,
      Date().timeIntervalSince(modified) < maxAge
    else { return nil }
    return url
  }

  @discardableResult
  static func write(_ data: Data, key: String) throws -> URL {
    let url = root.appendingPathComponent(key)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
    return url
  }

  /// Deletes expired files. Run off the main thread.
  static func sweep() {
    let keys: [URLResourceKey] = [.contentModificationDateKey, .isRegularFileKey]
    guard
      let files = FileManager.default.enumerator(
        at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
    else { return }
    let now = Date()
    for case let url as URL in files {
      guard
        let values = try? url.resourceValues(forKeys: Set(keys)),
        values.isRegularFile == true,
        let modified = values.contentModificationDate
      else { continue }
      let limit = url.pathExtension == "none" ? noneMaxAge : maxAge
      if now.timeIntervalSince(modified) >= limit {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }

  static func clear() {
    try? FileManager.default.removeItem(at: root)
  }

  /// Stable across launches (unlike `Hasher`): 64-bit FNV-1a, as hex.
  static func hash(_ string: String) -> String {
    var value: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in string.utf8 {
      value ^= UInt64(byte)
      value &*= 0x0000_0100_0000_01b3
    }
    return String(value, radix: 16)
  }

  /// Coordinates rounded to 5 dp (about 1 m) for cache keys.
  static func dp5(_ value: Double) -> String {
    String(format: "%.5f", value)
  }
}

/// A walking path with plain values, kept in the in-memory LRU.
struct WalkPath: Sendable {
  let seconds: Double
  let meters: Double
  let coords: [[Double]]

  var record: WalkRecord {
    let record = WalkRecord()
    record.seconds = seconds
    record.meters = meters
    record.coords = coords
    return record
  }
}

/// In-memory LRU of the last 32 walking paths, keyed by both ends at 5 dp.
actor WalkCache {
  static let shared = WalkCache()
  private static let capacity = 32

  private var entries: [String: WalkPath] = [:]
  /// Least recently used first.
  private var order: [String] = []

  func get(_ key: String) -> WalkPath? {
    guard let path = entries[key] else { return nil }
    touch(key)
    return path
  }

  func put(_ key: String, _ path: WalkPath) {
    entries[key] = path
    touch(key)
    while order.count > Self.capacity {
      entries.removeValue(forKey: order.removeFirst())
    }
  }

  func clear() {
    entries.removeAll()
    order.removeAll()
  }

  private func touch(_ key: String) {
    order.removeAll { $0 == key }
    order.append(key)
  }
}
