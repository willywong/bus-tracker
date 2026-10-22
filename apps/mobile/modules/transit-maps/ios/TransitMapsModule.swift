import ExpoModulesCore
import MapKit
import UIKit

/// Keyless Apple MapKit services (spec §5): place suggestions, place lookup,
/// walking paths, Look Around photos and map snapshots. Every failure reaches
/// JS as a typed exception (`ERR_OFFLINE`, `ERR_THROTTLED`, `ERR_NOT_FOUND`).
public class TransitMapsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TransitMaps")

    OnCreate {
      Task.detached(priority: .background) {
        TransitMapsCache.sweep()
      }
    }

    AsyncFunction("complete") { (queryId: Int, query: String, region: RegionRecord) async throws -> CompletionBatch in
      do {
        return try await PlaceCompleter.shared.complete(queryId: queryId, query: query, region: region)
      } catch {
        throw mapsException(error)
      }
    }

    AsyncFunction("resolve") { (id: String) async throws -> PlaceRecord in
      do {
        return try await PlaceCompleter.shared.resolve(id: id)
      } catch {
        throw mapsException(error)
      }
    }

    AsyncFunction("walk") { (from: PointRecord, to: PointRecord) async throws -> WalkRecord in
      let key = [from.lat, from.lng, to.lat, to.lng].map(TransitMapsCache.dp5).joined(separator: ",")
      if let hit = await WalkCache.shared.get(key) {
        return hit.record
      }
      do {
        let path = try await MapKitRequests.walk(from: from, to: to)
        await WalkCache.shared.put(key, path)
        return path.record
      } catch {
        throw mapsException(error)
      }
    }

    AsyncFunction("lookAround") { (lat: Double, lng: Double, w: Double, h: Double) async throws -> String? in
      let base = "lookaround/\(TransitMapsCache.dp5(lat))_\(TransitMapsCache.dp5(lng))_\(Int(w))x\(Int(h))"
      if let hit = TransitMapsCache.fresh(base + ".jpg") {
        return hit.absoluteString
      }
      if TransitMapsCache.fresh(base + ".none", maxAge: TransitMapsCache.noneMaxAge) != nil {
        return nil
      }
      do {
        guard let image = try await MapKitRequests.lookAround(lat: lat, lng: lng, size: CGSize(width: w, height: h)) else {
          // No coverage here: remember it for 7 days. The only cached miss.
          _ = try? TransitMapsCache.write(Data(), key: base + ".none")
          return nil
        }
        guard let data = image.jpegData(compressionQuality: 0.8) else {
          throw NotFoundException()
        }
        return try TransitMapsCache.write(data, key: base + ".jpg").absoluteString
      } catch {
        throw mapsException(error)
      }
    }

    AsyncFunction("snapshot") { (region: RegionRecord, w: Double, h: Double, dark: Bool) async throws -> String in
      let id = [region.lat, region.lng, region.latDelta, region.lngDelta].map(TransitMapsCache.dp5).joined(separator: ",")
        + ",\(Int(w))x\(Int(h))"
      let key = "snapshot/\(TransitMapsCache.hash(id))-\(dark ? "dark" : "light").png"
      if let hit = TransitMapsCache.fresh(key) {
        return hit.absoluteString
      }
      do {
        let image = try await MapKitRequests.snapshot(region: region, size: CGSize(width: w, height: h), dark: dark)
        guard let data = image.pngData() else {
          throw NotFoundException()
        }
        return try TransitMapsCache.write(data, key: key).absoluteString
      } catch {
        throw mapsException(error)
      }
    }

    // QA only: wipes the image cache and the walk LRU.
    AsyncFunction("clearCache") { () async -> Void in
      TransitMapsCache.clear()
      await WalkCache.shared.clear()
    }
  }
}

/// MapKit requests, run on the main actor where MapKit delivers its
/// callbacks. Only Sendable values (`WalkPath`, `UIImage`) leave.
@MainActor
enum MapKitRequests {
  static let maxWalkPoints = 200

  static func walk(from: PointRecord, to: PointRecord) async throws -> WalkPath {
    let request = MKDirections.Request()
    request.source = mapItem(lat: from.lat, lng: from.lng)
    request.destination = mapItem(lat: to.lat, lng: to.lng)
    request.transportType = .walking
    request.requestsAlternateRoutes = false

    let response = try await MKDirections(request: request).calculate()
    guard let route = response.routes.first else {
      throw NotFoundException()
    }
    let polyline = route.polyline
    var coordinates = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: polyline.pointCount)
    polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))
    return WalkPath(
      seconds: route.expectedTravelTime,
      meters: route.distance,
      coords: thin(coordinates, to: maxWalkPoints).map { [$0.latitude, $0.longitude] }
    )
  }

  /// A Look Around photo near the point, or nil where Apple has no coverage.
  static func lookAround(lat: Double, lng: Double, size: CGSize) async throws -> UIImage? {
    let request = MKLookAroundSceneRequest(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng))
    let scene: MKLookAroundScene?
    do {
      scene = try await request.scene
    } catch where mapsException(error) is NotFoundException {
      scene = nil
    }
    guard let scene else { return nil }
    let options = MKLookAroundSnapshotter.Options()
    options.size = size
    return try await MKLookAroundSnapshotter(scene: scene, options: options).snapshot.image
  }

  static func snapshot(region: RegionRecord, size: CGSize, dark: Bool) async throws -> UIImage {
    let options = MKMapSnapshotter.Options()
    options.region = PlaceCompleter.mapRegion(region)
    options.size = size
    options.mapType = .mutedStandard
    options.pointOfInterestFilter = .excludingAll
    let style: UIUserInterfaceStyle = dark ? .dark : .light
    if #available(iOS 17.0, *) {
      options.traitCollection = options.traitCollection.modifyingTraits { $0.userInterfaceStyle = style }
    } else {
      options.traitCollection = UITraitCollection(traitsFrom: [
        options.traitCollection, UITraitCollection(userInterfaceStyle: style),
      ])
    }
    return try await MKMapSnapshotter(options: options).start().image
  }

  private static func mapItem(lat: Double, lng: Double) -> MKMapItem {
    if #available(iOS 26.0, *) {
      return MKMapItem(location: CLLocation(latitude: lat, longitude: lng), address: nil)
    } else {
      return MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)))
    }
  }

  /// Evenly samples at most `limit` points, keeping both ends.
  private static func thin(_ points: [CLLocationCoordinate2D], to limit: Int) -> [CLLocationCoordinate2D] {
    guard points.count > limit, limit >= 2 else { return points }
    let step = Double(points.count - 1) / Double(limit - 1)
    return (0..<limit).map { points[Int((Double($0) * step).rounded())] }
  }
}
