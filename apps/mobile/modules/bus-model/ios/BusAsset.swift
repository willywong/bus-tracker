import Combine
import RealityKit
import UIKit

/// Which bus the app draws: the MRT feeder bus on MRT feeder routes, the
/// rapidKL city bus (which also works the LRT feeders) everywhere else.
enum BusKind: String, CaseIterable, Sendable {
  case feeder
  case rapid

  /// The asset names, as the build scripts write them.
  var model: String { self == .feeder ? "RapidBus" : "RapidKLBus" }
  var sprite: String { self == .feeder ? "map-bus" : "map-rapid" }
  var icon: String { self == .feeder ? "pill-bus" : "pill-rapid" }
  /// The same, lit for the night (headlamps, a glowing sign, beams on the road).
  var nightSprite: String { "\(sprite)-night" }
  var nightIcon: String { "\(icon)-night" }
}

/// The bus models, each loaded once and cloned per view (clones share meshes
/// and textures), plus the textures the app draws itself: the headsign and
/// the soft contact shadow under the bus.
///
/// Each asset follows the contract in `scripts/build-feeder-bus.py`: Y-up,
/// metres, ground at y = 0, centred, front facing +Z, and a quad named
/// `Headsign` for the destination sign.
@MainActor
enum BusAsset {
  private static var templates: [BusKind: Entity] = [:]
  private static var waiting: [BusKind: [(Entity?) -> Void]] = [:]
  private static var requests: [BusKind: AnyCancellable] = [:]
  private static var failed: Set<BusKind> = []

  /// Calls back on the main thread with a fresh clone, or nil if the asset is
  /// missing or unreadable (the view then stays plain paper).
  static func load(_ kind: BusKind = .feeder, _ done: @escaping (Entity?) -> Void) {
    if let template = templates[kind] {
      done(template.clone(recursive: true))
      return
    }
    if failed.contains(kind) {
      done(nil)
      return
    }
    waiting[kind, default: []].append(done)
    guard requests[kind] == nil else { return }
    guard let url = assetURL(kind) else {
      finish(kind, nil)
      return
    }
    requests[kind] = Entity.loadAsync(contentsOf: url).sink(
      receiveCompletion: { completion in
        if case .failure = completion {
          MainActor.assumeIsolated { finish(kind, nil) }
        }
      },
      receiveValue: { entity in
        MainActor.assumeIsolated { finish(kind, entity) }
      }
    )
  }

  private static func finish(_ kind: BusKind, _ entity: Entity?) {
    templates[kind] = entity
    if entity == nil { failed.insert(kind) }
    requests[kind] = nil
    let callbacks = waiting[kind] ?? []
    waiting[kind] = nil
    for callback in callbacks {
      callback(entity?.clone(recursive: true))
    }
  }

  /// The bundled model; nil in a build without it, and JS then shows nothing
  /// (`hasModel`).
  nonisolated static func assetURL(_ kind: BusKind = .feeder) -> URL? {
    assets()?.url(forResource: kind.model, withExtension: "usdz")
  }

  /// The map's tiny buses rendered from the model, one per 15° of heading
  /// (frame k heads k × 15° clockwise from north); empty unless all are there.
  nonisolated static func mapSpriteURLs(_ kind: BusKind = .feeder, night: Bool = false) -> [URL] {
    guard let assets = assets() else { return [] }
    let prefix = night ? kind.nightSprite : kind.sprite
    let urls = (0..<24).compactMap {
      assets.url(forResource: String(format: "\(prefix)-%02d", $0), withExtension: "png")
    }
    return urls.count == 24 ? urls : []
  }

  /// The bus pill's icon: the bus three-quarters on, 44 × 36 pt.
  nonisolated static func pillIconURL(_ kind: BusKind = .feeder, night: Bool = false) -> URL? {
    assets()?.url(forResource: night ? kind.nightIcon : kind.icon, withExtension: "png")
  }

  /// The map's landmarks, rendered by `scripts/build-map-landmarks.py`: name
  /// to file URL, for those in the build. Each is square with its ground
  /// point at 50% across and 70% down.
  nonisolated static let landmarks = [
    "shelter", "shelter-night", "your-stop", "your-stop-night", "mrt-station",
    "mrt-station-night", "station", "station-band", "station-night",
  ]

  nonisolated static func landmarkURLs() -> [String: URL] {
    guard let assets = assets() else { return [:] }
    return landmarks.reduce(into: [:]) { urls, name in
      urls[name] = assets.url(forResource: "map-\(name)", withExtension: "png")
    }
  }

  nonisolated private static func assets() -> Bundle? {
    for bundle in [Bundle.main, Bundle(for: BusModelView.self)] {
      if let url = bundle.url(forResource: "BusModelAssets", withExtension: "bundle"),
        let assets = Bundle(url: url)
      {
        return assets
      }
    }
    return nil
  }

  /// The model entity drawing the destination sign, if the asset has one.
  static func headsign(in bus: Entity) -> ModelEntity? {
    guard let sign = bus.findEntity(named: "Headsign") else { return nil }
    return firstModel(in: sign)
  }

  /// The headlamps' model entity, if the asset has one (both scripts name it `Headlamps`).
  static func headlamps(in bus: Entity) -> ModelEntity? {
    guard let lamps = bus.findEntity(named: "Headlamps") else { return nil }
    return firstModel(in: lamps)
  }

  /// Lit headlamps for the night: unlit warm white, so they glow whatever the light.
  static let litLamp: UnlitMaterial = {
    var material = UnlitMaterial()
    material.color = .init(tint: UIColor(red: 1, green: 0.96, blue: 0.84, alpha: 1))
    return material
  }()

  /// Two soft beams on the road ahead of the bus, for the night: a plane
  /// `width` wide and `length` long, its near edge at the bus's front.
  static func headlightBeams(width: Float, length: Float) -> ModelEntity? {
    guard let image = beamsImage(), let texture = texture(image) else { return nil }
    var material = UnlitMaterial()
    material.color = .init(tint: .white, texture: .init(texture))
    material.blending = .transparent(opacity: .init(floatLiteral: 1))
    let plane = ModelEntity(mesh: .generatePlane(width: width, depth: length), materials: [material])
    plane.position.y = 0.006
    return plane
  }

  private static func beamsImage() -> CGImage? {
    let size = CGSize(width: 128, height: 256)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      let cg = context.cgContext
      // The bus is at the bottom edge; each beam widens and fades up the road.
      let colors =
        [
          UIColor(red: 1, green: 0.93, blue: 0.7, alpha: 0.55).cgColor,
          UIColor(red: 1, green: 0.93, blue: 0.7, alpha: 0).cgColor,
        ] as CFArray
      guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])
      else { return }
      for x in [size.width * 0.3, size.width * 0.7] {
        cg.saveGState()
        let beam = UIBezierPath()
        beam.move(to: CGPoint(x: x - 6, y: size.height))
        beam.addLine(to: CGPoint(x: x + 6, y: size.height))
        beam.addLine(to: CGPoint(x: x + 30, y: 0))
        beam.addLine(to: CGPoint(x: x - 30, y: 0))
        beam.close()
        beam.addClip()
        cg.drawLinearGradient(
          gradient, start: CGPoint(x: x, y: size.height), end: CGPoint(x: x, y: 0), options: [])
        cg.restoreGState()
      }
    }
    return image.cgImage
  }

  private static func firstModel(in entity: Entity) -> ModelEntity? {
    if let model = entity as? ModelEntity, model.model != nil { return model }
    for child in entity.children {
      if let model = firstModel(in: child) { return model }
    }
    return nil
  }

  /// The sign as RapidKL's LED boards show it: the route in red, the
  /// destination in amber, lit dots on a black board. Unlit, so it glows the
  /// same whichever way the bus faces.
  static func headsignMaterial(route: String, destination: String) -> UnlitMaterial? {
    guard let image = headsignImage(route: route, destination: destination),
      let texture = texture(image)
    else { return nil }
    var material = UnlitMaterial()
    material.color = .init(tint: .white, texture: .init(texture))
    return material
  }

  private static let ledRed = UIColor(red: 1, green: 0.16, blue: 0.1, alpha: 1)
  private static let ledAmber = UIColor(red: 1, green: 0.82, blue: 0.1, alpha: 1)

  /// 1024×112, the sign quad's 9:1. Text shrinks to fit before it would clip.
  private static func headsignImage(route: String, destination: String) -> CGImage? {
    let size = CGSize(width: 1024, height: 112)
    let margin: CGFloat = 36
    let gap: CGFloat = 40
    let route = route.uppercased()
    let destination = destination.uppercased()

    func attributes(_ fontSize: CGFloat, _ color: UIColor) -> [NSAttributedString.Key: Any] {
      [
        .font: UIFont.systemFont(ofSize: fontSize, weight: .heavy, width: .condensed),
        .foregroundColor: color,
        .kern: fontSize * 0.04,
      ]
    }
    var fontSize: CGFloat = 76
    var routeSize = (route as NSString).size(withAttributes: attributes(fontSize, ledRed))
    var destinationSize = (destination as NSString).size(withAttributes: attributes(fontSize, ledAmber))
    while routeSize.width + gap + destinationSize.width > size.width - margin * 2, fontSize > 28 {
      fontSize -= 2
      routeSize = (route as NSString).size(withAttributes: attributes(fontSize, ledRed))
      destinationSize = (destination as NSString).size(withAttributes: attributes(fontSize, ledAmber))
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      let cg = context.cgContext
      UIColor(white: 0.03, alpha: 1).setFill()
      cg.fill(CGRect(origin: .zero, size: size))

      // The route at the left, the destination centred in what's left.
      let y = (size.height - routeSize.height) / 2
      let routeOrigin = CGPoint(x: margin, y: y)
      let left = margin + routeSize.width + gap
      let destinationOrigin = CGPoint(
        x: left + max(0, (size.width - margin - left - destinationSize.width) / 2),
        y: (size.height - destinationSize.height) / 2
      )
      for (text, origin, color) in [
        (route, routeOrigin, ledRed), (destination, destinationOrigin, ledAmber),
      ] {
        cg.setShadow(offset: .zero, blur: 12, color: color.withAlphaComponent(0.85).cgColor)
        (text as NSString).draw(at: origin, withAttributes: attributes(fontSize, color))
      }

      // The LED matrix: dark gaps between the dots.
      cg.setShadow(offset: .zero, blur: 0, color: nil)
      UIColor(white: 0.03, alpha: 0.9).setFill()
      let pitch: CGFloat = 6
      for x in stride(from: CGFloat(0), to: size.width, by: pitch) {
        cg.fill(CGRect(x: x, y: 0, width: 1.6, height: size.height))
      }
      for y in stride(from: CGFloat(0), to: size.height, by: pitch) {
        cg.fill(CGRect(x: 0, y: y, width: size.width, height: 1.6))
      }
    }
    return image.cgImage
  }

  /// A soft dark footprint under the bus: cheaper than a shadow map, and it
  /// turns with the bus. Sized from the bus's own bounds.
  static func contactShadow(width: Float, length: Float) -> ModelEntity? {
    guard let image = shadowImage(), let texture = texture(image) else { return nil }
    var material = UnlitMaterial()
    material.color = .init(tint: .white, texture: .init(texture))
    material.blending = .transparent(opacity: .init(floatLiteral: 1))
    let plane = ModelEntity(
      mesh: .generatePlane(width: width * 1.3, depth: length * 1.1),
      materials: [material]
    )
    plane.position.y = 0.004
    return plane
  }

  private static func shadowImage() -> CGImage? {
    let size = CGSize(width: 96, height: 256)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      // Stacked translucent rounded rects: dark in the middle, fading out.
      let steps = 18
      for step in 0..<steps {
        let t = CGFloat(step) / CGFloat(steps)
        let inset = CGSize(width: size.width * (0.04 + 0.2 * t), height: size.height * (0.02 + 0.07 * t))
        let rect = CGRect(origin: .zero, size: size).insetBy(dx: inset.width, dy: inset.height)
        UIColor(white: 0, alpha: 0.05).setFill()
        UIBezierPath(roundedRect: rect, cornerRadius: rect.width * 0.35).fill()
      }
      _ = context
    }
    return image.cgImage
  }

  private static func texture(_ image: CGImage) -> TextureResource? {
    if #available(iOS 18.0, *) {
      return try? TextureResource(image: image, options: .init(semantic: .color))
    }
    return try? TextureResource.generate(from: image, options: .init(semantic: .color))
  }
}
