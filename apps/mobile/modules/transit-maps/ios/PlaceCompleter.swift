import ExpoModulesCore
import MapKit

/// As-you-type place suggestions from one `MKLocalSearchCompleter`.
///
/// Main-actor isolated: the completer and its delegate callbacks live on the
/// main thread. Only the latest query is kept; JS debounces (15/03).
@MainActor
final class PlaceCompleter: NSObject, MKLocalSearchCompleterDelegate {
  /// Created lazily, on the main actor, by the first `complete` or `resolve`.
  static let shared = PlaceCompleter()

  private static let maxResults = 8
  /// A query with no answer after this long rejects with `ERR_OFFLINE`, so a
  /// JS promise never hangs.
  private static let timeout: Duration = .seconds(10)

  /// Replaced after a failure or timeout, so retrying the same text searches
  /// again instead of returning the failed fragment's (empty) results.
  private var completer = PlaceCompleter.makeCompleter()
  private var pending: (queryId: Int, continuation: CheckedContinuation<CompletionBatch, Error>)?
  /// JS ids only grow (seeded from the clock, so across reloads too). Calls
  /// can reach the main actor out of order; an older one is superseded at once.
  private var latestQueryId = Int.min
  /// Completions from the last two batches only, by id (`c<queryId>-<i>`).
  private var batches: [(queryId: Int, completions: [String: MKLocalSearchCompletion])] = []

  private override init() {
    super.init()
    completer.delegate = self
  }

  private static func makeCompleter() -> MKLocalSearchCompleter {
    let completer = MKLocalSearchCompleter()
    completer.resultTypes = [.pointOfInterest, .address]
    completer.region = mapRegion(RegionRecord())
    if #available(iOS 18.0, *) {
      completer.regionPriority = .required
    }
    return completer
  }

  private func resetCompleter() {
    let region = completer.region
    completer.delegate = nil
    completer.cancel()
    completer = Self.makeCompleter()
    completer.region = region
    completer.delegate = self
  }

  // MARK: - complete

  func complete(queryId: Int, query: String, region: RegionRecord) async throws -> CompletionBatch {
    guard queryId > latestQueryId else {
      return Self.batch(queryId: queryId, results: [], superseded: true)
    }
    latestQueryId = queryId
    finishPending(superseded: true)

    let fragment = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if fragment.isEmpty {
      return Self.batch(queryId: queryId, results: [])
    }

    let mapRegion = Self.mapRegion(region)
    if !Self.sameRegion(completer.region, mapRegion) {
      completer.region = mapRegion
    }

    return try await withCheckedThrowingContinuation { continuation in
      pending = (queryId, continuation)
      if completer.queryFragment == fragment && !completer.isSearching {
        // Setting an unchanged fragment fires no callback: answer from the
        // completer's current results.
        deliverResults()
        return
      }
      completer.queryFragment = fragment
      Task { [weak self] in
        try? await Task.sleep(for: Self.timeout)
        self?.timeOut(queryId: queryId)
      }
    }
  }

  nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    onMain { $0.deliverResults() }
  }

  nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    onMain { $0.deliverFailure(error) }
  }

  // MARK: - resolve

  /// Turns a stored completion into a place via `MKLocalSearch`.
  func resolve(id: String) async throws -> PlaceRecord {
    guard let completion = batches.lazy.compactMap({ $0.completions[id] }).first else {
      throw UnknownCompletionException()
    }
    let search = MKLocalSearch(request: MKLocalSearch.Request(completion: completion))
    let response: MKLocalSearch.Response
    do {
      response = try await search.start()
    } catch {
      throw mapsException(error)
    }
    guard let item = response.mapItems.first else {
      throw NotFoundException()
    }

    let place = PlaceRecord()
    place.name = item.name ?? completion.title
    let coordinate: CLLocationCoordinate2D
    var address: String?
    if #available(iOS 26.0, *) {
      coordinate = item.location.coordinate
      address = item.address?.fullAddress
    } else {
      coordinate = item.placemark.coordinate
      address = item.placemark.title
    }
    address = address?
      .split(whereSeparator: \.isNewline)
      .joined(separator: ", ")
    if address?.isEmpty ?? true {
      address = completion.subtitle.isEmpty ? nil : completion.subtitle
    }
    place.address = address
    place.lat = coordinate.latitude
    place.lng = coordinate.longitude
    place.category = item.pointOfInterestCategory?.rawValue
    return place
  }

  // MARK: - Private

  private func deliverResults() {
    guard let (queryId, continuation) = pending else { return }
    pending = nil

    var records: [CompletionRecord] = []
    var completions: [String: MKLocalSearchCompletion] = [:]
    for (index, completion) in completer.results.prefix(Self.maxResults).enumerated() {
      let id = "c\(queryId)-\(index)"
      completions[id] = completion
      let record = CompletionRecord()
      record.id = id
      record.title = completion.title
      record.subtitle = completion.subtitle
      records.append(record)
    }
    batches.append((queryId, completions))
    if batches.count > 2 {
      batches.removeFirst(batches.count - 2)
    }
    continuation.resume(returning: Self.batch(queryId: queryId, results: records))
  }

  private func deliverFailure(_ error: Error) {
    guard let (_, continuation) = pending else { return }
    pending = nil
    resetCompleter()
    continuation.resume(throwing: mapsException(error))
  }

  private func timeOut(queryId: Int) {
    guard let (pendingId, continuation) = pending, pendingId == queryId else { return }
    pending = nil
    resetCompleter()
    continuation.resume(throwing: OfflineException())
  }

  private func finishPending(superseded: Bool) {
    guard let (queryId, continuation) = pending else { return }
    pending = nil
    continuation.resume(returning: Self.batch(queryId: queryId, results: [], superseded: superseded))
  }

  /// Delegate callbacks arrive on the main thread; hop there if they ever don't.
  private nonisolated func onMain(_ body: @escaping @MainActor @Sendable (PlaceCompleter) -> Void) {
    if Thread.isMainThread {
      MainActor.assumeIsolated { body(self) }
    } else {
      Task { @MainActor in body(self) }
    }
  }

  private static func batch(queryId: Int, results: [CompletionRecord], superseded: Bool = false) -> CompletionBatch {
    let batch = CompletionBatch()
    batch.queryId = queryId
    batch.results = results
    batch.superseded = superseded
    return batch
  }

  static func mapRegion(_ region: RegionRecord) -> MKCoordinateRegion {
    MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: region.lat, longitude: region.lng),
      span: MKCoordinateSpan(latitudeDelta: region.latDelta, longitudeDelta: region.lngDelta)
    )
  }

  private static func sameRegion(_ a: MKCoordinateRegion, _ b: MKCoordinateRegion) -> Bool {
    a.center.latitude == b.center.latitude && a.center.longitude == b.center.longitude
      && a.span.latitudeDelta == b.span.latitudeDelta && a.span.longitudeDelta == b.span.longitudeDelta
  }
}
