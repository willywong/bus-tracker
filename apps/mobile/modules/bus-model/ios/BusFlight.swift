import UIKit

/// The pill's bus on its way into the trip sheet. Tapping the pill lifts its
/// picture into a pass-through window above everything (the bar unmounts and
/// the sheet rises under it), and the sheet's 3D bus, once it's drawing,
/// claims the flight and flies its own scene up from there
/// (`BusModelView.fly`). Unclaimed after a moment (no bus in the sheet, or
/// it's out of sight), the picture fades where it is.
@MainActor
final class BusFlight {
  /// The launched flight waiting for a sheet's bus to claim it.
  private(set) static var pending: BusFlight?

  /// Where the pill drew its bus, in window points.
  let origin: CGRect
  /// The bus's own outline within `origin` (the picture has margins).
  let busRect: CGRect
  let picture: UIImageView
  /// Everything the flight draws, above the sheet; it never takes touches.
  let stage: UIView
  private weak var claimant: BusModelView?
  private var expiry: Timer?

  /// How long a launched flight waits to be claimed and start.
  private static let patience: TimeInterval = 1.0

  private init(origin: CGRect, image: UIImage, outline: CGRect, stage: UIView) {
    self.origin = origin
    self.stage = stage
    busRect = CGRect(
      x: origin.minX + outline.minX * origin.width,
      y: origin.minY + outline.minY * origin.height,
      width: outline.width * origin.width,
      height: outline.height * origin.height
    )
    picture = UIImageView(image: image)
    picture.frame = origin
    // As the pill draws it: a shadow hugging the bus.
    picture.layer.shadowColor = UIColor.black.cgColor
    picture.layer.shadowOpacity = 0.25
    picture.layer.shadowRadius = 1.5
    picture.layer.shadowOffset = CGSize(width: 0, height: 1)
    stage.addSubview(picture)
  }

  /// From the pill's bus at `frame` (window points). Not under Reduce Motion:
  /// the sheet's bus then just fades in where it sits.
  static func launch(from frame: CGRect, kind: BusKind = .feeder) {
    guard !UIAccessibility.isReduceMotionEnabled, frame.width > 0, frame.height > 0,
      let picture = picture(kind), let window = Overlay.shared.window
    else { return }
    pending?.end(animated: false)
    // Have the model ready by the time the sheet's bus asks for it.
    BusAsset.load(kind) { _ in }
    window.isHidden = false
    let flight = BusFlight(origin: frame, image: picture.image, outline: picture.outline, stage: window.stage)
    flight.expiry = Timer.scheduledTimer(withTimeInterval: patience, repeats: false) { _ in
      MainActor.assumeIsolated {
        flight.claimant?.arrivalMissed()
        flight.end(animated: true)
      }
    }
    pending = flight
  }

  /// Down from the sheet into the pill: as long as the sheet's own fall,
  /// leaving with it (UIKit starts the dismissal a beat after it's asked).
  static let homeDelay: CFTimeInterval = 0.1
  static let homeDuration: CFTimeInterval = 0.5
  /// The pill shows its own bus again once the flight has landed (JS waits
  /// `homeDelay + homeDuration`); the picture holds a moment past that, so
  /// the pill never shows bare.
  private static let homeHold: TimeInterval = homeDelay + homeDuration + 0.15

  /// The sheet going down: its bus flies back into the pill's bus at `frame`
  /// (window points), where the pill's picture takes over. With no bus on
  /// screen to fly, or under Reduce Motion, the picture just appears there
  /// as the sheet clears it.
  static func home(to frame: CGRect, kind: BusKind = .feeder) {
    guard frame.width > 0, frame.height > 0, let picture = picture(kind),
      let window = Overlay.shared.window
    else { return }
    pending?.end(animated: false)
    window.isHidden = false
    let flight = BusFlight(origin: frame, image: picture.image, outline: picture.outline, stage: window.stage)
    flight.picture.alpha = 0
    let flying =
      !UIAccessibility.isReduceMotionEnabled && (BusModelView.onScreen()?.flyHome(flight) ?? false)
    if !flying {
      UIView.animate(withDuration: 0.15, delay: homeDelay + homeDuration - 0.15) {
        flight.picture.alpha = 1
      }
    }
    Timer.scheduledTimer(withTimeInterval: homeHold, repeats: false) { _ in
      MainActor.assumeIsolated { flight.end(animated: false) }
    }
  }

  /// A sheet's bus taking the flight; it starts flying once it's drawing.
  static func claim(by view: BusModelView) -> BusFlight? {
    guard let flight = pending, flight.claimant == nil else { return nil }
    flight.claimant = view
    return flight
  }

  /// The bus has taken off: no more waiting.
  func departed() {
    expiry?.invalidate()
    expiry = nil
    if BusFlight.pending === self { BusFlight.pending = nil }
  }

  /// Done, landed or not: the picture goes, and the overlay with it.
  func end(animated: Bool) {
    departed()
    let picture = picture
    let finish = {
      picture.removeFromSuperview()
      Overlay.shared.hideIfEmpty()
    }
    guard animated, picture.alpha > 0 else {
      finish()
      return
    }
    UIView.animate(
      withDuration: 0.18, delay: 0, options: [.curveEaseOut, .beginFromCurrentState],
      animations: {
        picture.alpha = 0
        picture.transform = picture.transform.scaledBy(x: 0.96, y: 0.96)
      },
      completion: { _ in MainActor.assumeIsolated { finish() } }
    )
  }

  // MARK: The pill's picture

  private static var pictures: [String: (image: UIImage, outline: CGRect)] = [:]

  /// The pill's icon for this bus (lit in dark mode, as the pill draws it)
  /// and the bus's outline in it, read once.
  private static func picture(_ kind: BusKind) -> (image: UIImage, outline: CGRect)? {
    let night = UITraitCollection.current.userInterfaceStyle == .dark
    let key = "\(kind.rawValue)\(night ? "-night" : "")"
    if let picture = pictures[key] { return picture }
    let url = (night ? BusAsset.pillIconURL(kind, night: true) : nil) ?? BusAsset.pillIconURL(kind)
    guard let image = url.flatMap({ UIImage(contentsOfFile: $0.path) }) else { return nil }
    let picture = (image: image, outline: outline(of: image))
    pictures[key] = picture
    return picture
  }

  /// The bus's outline in the picture, as fractions of it: the opaque pixels' bounds.
  private static func outline(of picture: UIImage) -> CGRect {
    guard let image = picture.cgImage else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
    let w = image.width
    let h = image.height
    var alpha = [UInt8](repeating: 0, count: w * h)
    let drawn = alpha.withUnsafeMutableBytes { bytes -> Bool in
      guard
        let context = CGContext(
          data: bytes.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.alphaOnly.rawValue)
      else { return false }
      context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard drawn else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
    var minX = w, minY = h, maxX = -1, maxY = -1
    for y in 0..<h {
      for x in 0..<w where alpha[y * w + x] > 24 {
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
    guard maxX >= minX, maxY >= minY else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
    return CGRect(
      x: CGFloat(minX) / CGFloat(w), y: CGFloat(minY) / CGFloat(h),
      width: CGFloat(maxX - minX + 1) / CGFloat(w), height: CGFloat(maxY - minY + 1) / CGFloat(h))
  }
}

/// A window over the app's own (and its sheets), passing every touch through.
@MainActor
final class Overlay {
  static let shared = Overlay()

  final class Window: UIWindow {
    let stage = UIView()

    override init(windowScene: UIWindowScene) {
      super.init(windowScene: windowScene)
      backgroundColor = .clear
      isUserInteractionEnabled = false
      windowLevel = .normal + 1
      rootViewController = UIViewController()
      rootViewController?.view.backgroundColor = .clear
      rootViewController?.view.isUserInteractionEnabled = false
      stage.frame = bounds
      stage.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      rootViewController?.view.addSubview(stage)
    }

    required init?(coder: NSCoder) { nil }
  }

  private var made: Window?

  var window: Window? {
    if let made { return made }
    guard
      let scene = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive })
    else { return nil }
    let window = Window(windowScene: scene)
    window.isHidden = true
    made = window
    return window
  }

  func hideIfEmpty() {
    guard let made, made.stage.subviews.isEmpty else { return }
    made.stage.layer.mask = nil
    made.isHidden = true
  }
}

/// A CSS-style cubic Bézier easing, solved for y at a given x.
struct Easing {
  private let cx, bx, ax, cy, by, ay: Double

  init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
    cx = 3 * x1
    bx = 3 * (x2 - x1) - cx
    ax = 1 - cx - bx
    cy = 3 * y1
    by = 3 * (y2 - y1) - cy
    ay = 1 - cy - by
  }

  /// The iOS sheet's own curve: the bus rides up with the sheet.
  static let sheet = Easing(0.32, 0.72, 0, 1)
  /// A strong ease-out: the turn spends itself early and settles.
  static let out = Easing(0.23, 1, 0.32, 1)

  func callAsFunction(_ x: Double) -> Double {
    let x = min(1, max(0, x))
    var t = x
    for _ in 0..<8 {
      let error = sampleX(t) - x
      if abs(error) < 1e-6 { return sampleY(t) }
      let slope = (3 * ax * t + 2 * bx) * t + cx
      if abs(slope) < 1e-6 { break }
      t -= error / slope
    }
    var lo = 0.0
    var hi = 1.0
    t = x
    for _ in 0..<32 {
      let value = sampleX(t)
      if abs(value - x) < 1e-6 { break }
      if value < x { lo = t } else { hi = t }
      t = (lo + hi) / 2
    }
    return sampleY(t)
  }

  private func sampleX(_ t: Double) -> Double { ((ax * t + bx) * t + cx) * t }
  private func sampleY(_ t: Double) -> Double { ((ay * t + by) * t + cy) * t }
}
