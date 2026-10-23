import MapKit
import UIKit

/// "Ride along": the map's camera rides behind one bus marker, pitched over
/// MapKit's 3D buildings and turned to the bus's way of travel. The marker
/// already moves itself (react-native-maps' native glide), so the camera
/// follows it on its own display link: JS only starts it, turns it at each
/// corner of the route and stops it.
///
/// The map and the marker are found by looking, not passed in: the one
/// `MKMapView` on screen holding an annotation whose `identifier` (the
/// marker's `identifier` prop) is the bus's.
@MainActor
enum RideAlong {
  private static var link: CADisplayLink?
  private static weak var map: MKMapView?
  private static weak var bus: NSObject?
  private static var identifier = ""
  /// Where the bus is headed (degrees from north), and where the camera faces now.
  private static var target: CLLocationDirection = 0
  private static var heading: CLLocationDirection = 0
  /// How far ahead of the bus (metres, negative behind) the camera looks, so
  /// the bus sits at `anchor` of the map's open height above `bottomInset`.
  private static var lead: CLLocationDistance = 0
  private static var bottomInset: CGFloat = 0
  private static var lastFrame: CFTimeInterval = 0
  /// Riding (paused or not), so a resume carries on where it was.
  private static var active = false
  private static let proxy = Proxy()
  /// Told where the camera faces when it has turned `headingStep` since it
  /// was last told: often enough for the map's buses to pick their sprites
  /// (15° apart), never per frame. Set once, as the module is created, and
  /// only called on the main thread.
  nonisolated(unsafe) static var onHeading: ((CLLocationDirection) -> Void)?
  private static var toldHeading: CLLocationDirection?
  private static let headingStep: CLLocationDirection = 3

  /// The camera's distance from the bus and its tilt: close enough to read the street.
  private static let distance: CLLocationDistance = 520
  private static let pitch: CGFloat = 62
  /// The bus's height on the open map: a little below the middle, room ahead.
  private static let anchor: CGFloat = 0.62
  /// How quickly the camera turns to a new heading (per second).
  private static let turnRate = 1.8

  /// Rides along with the marker `identifier`, facing `heading`, with the
  /// bottom `bottomInset` points of the map covered (the bus bar or a sheet).
  static func start(identifier: String, heading: Double, bottomInset: Double) {
    if self.identifier != identifier { active = false }
    self.identifier = identifier
    self.bottomInset = CGFloat(bottomInset)
    target = heading
    if !active {
      self.heading = heading
      lead = 0
      map = nil
      bus = nil
      toldHeading = nil
    }
    active = true
    if link == nil {
      let link = CADisplayLink(target: proxy, selector: #selector(Proxy.step))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
      link.add(to: .main, forMode: .common)
      self.link = link
      lastFrame = 0
    }
  }

  /// The bus turned a corner.
  static func turn(_ heading: Double) {
    target = heading
  }

  /// The map's covered bottom changed (a sheet moved).
  static func inset(_ bottomInset: Double) {
    self.bottomInset = CGFloat(bottomInset)
  }

  /// Stops following while the map is out of sight; `start` carries on.
  static func pause() {
    link?.invalidate()
    link = nil
  }

  static func stop() {
    pause()
    active = false
    if let map {
      // Back to the flat map, north up, a street or two around the bus
      // (JS then frames the trip as usual).
      let center = (bus as? MKAnnotation)?.coordinate ?? map.camera.centerCoordinate
      map.setCamera(
        MKMapCamera(lookingAtCenter: center, fromDistance: 1500, pitch: 0, heading: 0), animated: true)
    }
    map = nil
    bus = nil
  }

  fileprivate static func step() {
    guard let link, resolve(), let map, let bus, let annotation = bus as? MKAnnotation else { return }
    let dt = lastFrame == 0 ? 0 : min(link.timestamp - lastFrame, 0.1)
    lastFrame = link.timestamp

    // Ease round to the bus's heading the short way.
    let turn = (target - heading + 540).truncatingRemainder(dividingBy: 360) - 180
    heading = (heading + turn * min(1, turnRate * dt) + 360).truncatingRemainder(dividingBy: 360)

    // Keep the bus at its spot on the open map: nudge how far ahead the
    // camera looks by how far off the bus was drawn last frame.
    let bounds = map.bounds
    if bounds.height > 0 {
      let open = bounds.height - bottomInset
      let wanted = open * anchor
      let drawn = map.convert(annotation.coordinate, toPointTo: map).y
      if drawn.isFinite {
        // Drawn too low: look less far ahead (the bus is nearer the camera than its target).
        lead = max(-600, min(600, lead - Double(drawn - wanted) * 0.25))
      }
    }

    let center = ahead(of: annotation.coordinate, by: lead, heading: heading)
    let camera = MKMapCamera(lookingAtCenter: center, fromDistance: distance, pitch: pitch, heading: heading)
    // Not the JS map's own move: no region events per frame.
    map.setValue(true, forKey: "ignoreRegionChanges")
    map.setCamera(camera, animated: false)

    let turned = toldHeading.map { abs((heading - $0 + 540).truncatingRemainder(dividingBy: 360) - 180) }
    if turned ?? .infinity >= headingStep {
      toldHeading = heading
      onHeading?(heading)
    }
  }

  /// The map and the bus's annotation, found once and kept while they live.
  private static func resolve() -> Bool {
    if let map, map.window != nil, let bus, map.annotations.contains(where: { $0 === bus }) {
      return true
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let scene = scene as? UIWindowScene else { continue }
      for window in scene.windows {
        for candidate in maps(in: window) {
          if let found = candidate.annotations.first(where: { has(identifier, $0) }) as? NSObject {
            map = candidate
            bus = found
            return true
          }
        }
      }
    }
    return false
  }

  private static func has(_ identifier: String, _ annotation: MKAnnotation) -> Bool {
    guard let object = annotation as? NSObject,
      object.responds(to: NSSelectorFromString("identifier"))
    else { return false }
    return object.value(forKey: "identifier") as? String == identifier
  }

  private static func maps(in view: UIView) -> [MKMapView] {
    if let map = view as? MKMapView { return [map] }
    return view.subviews.flatMap(maps(in:))
  }

  /// `metres` along `heading` from `coordinate` (flat earth: it's a few hundred metres).
  private static func ahead(
    of coordinate: CLLocationCoordinate2D, by metres: CLLocationDistance, heading: CLLocationDirection
  ) -> CLLocationCoordinate2D {
    let rad = heading * .pi / 180
    let north = metres * cos(rad)
    let east = metres * sin(rad)
    return CLLocationCoordinate2D(
      latitude: coordinate.latitude + north / 111_320,
      longitude: coordinate.longitude + east / (111_320 * cos(coordinate.latitude * .pi / 180))
    )
  }

  @MainActor private final class Proxy: NSObject {
    @objc func step() {
      RideAlong.step()
    }
  }
}
