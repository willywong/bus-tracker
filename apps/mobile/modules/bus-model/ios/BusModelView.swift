import Combine
import ExpoModulesCore
import RealityKit
import UIKit

/// The bus on a slow turntable over the sheet's paper. It rests at a
/// three-quarter view of the front and kerb side; a sideways drag turns it,
/// a flick spins it, and it eases back into its idle turn. With `spins` off
/// it eases to a stop instead (while the real bus is stopped), or stops at
/// once under Reduce Motion. Vertical drags pass through to the
/// sheet. Renders only while on screen, and holds a RealityKit view only
/// then. Opened from the bus pill, it flies up out of the pill, turning into
/// place (see `BusFlight`).
final class BusModelView: ExpoView {
  var routeCode = ""
  /// Which bus to draw; the model loads (or swaps) on the next `apply`.
  var kind: BusKind = .feeder
  var destination: String?
  var paper: UIColor = .systemBackground
  var spins = true

  /// Front and kerb (left) side toward the camera.
  private static let restYaw: Float = -0.62
  /// A full turn every 45 s.
  private static let idleSpin: Float = 2 * .pi / 45
  /// How quickly a flick settles back to the idle turn.
  private static let settle: Float = 0.9
  private static let fieldOfView: Float = 24
  /// Camera height above the bus's midline, as an angle.
  private static let elevation: Float = 0.15
  /// The pill's picture: front and off side toward the camera
  /// (build-feeder-bus.py's ICON_YAW, 38°).
  private static let pillYaw: Float = 38 * .pi / 180
  /// Up from the pill: as long as the sheet's own rise, a little more for the turn.
  private static let flightDuration: CFTimeInterval = 0.62

  /// Only while the bus is drawn. An ARView has no pause: one taken out of
  /// the window keeps rendering, costing CPU and starving any other ARView
  /// (the bus opened full screen) of frames. So it's let go and made again,
  /// the scene's anchor moving across; after the first, one takes ~10 ms.
  private var arView: ARView?
  /// The bus has been shown here, so a remade view needn't fade it in.
  private var revealed = false
  private let anchor = AnchorEntity(world: .zero)
  private let turntable = Entity()
  private let camera = PerspectiveCamera()
  private var bus: Entity?
  private var shownKind: BusKind?
  private var shadow: ModelEntity?
  private var headsign: ModelEntity?
  /// Night (dark mode): headlamps lit and beams on the road ahead.
  private var headlamps: ModelEntity?
  private var dayLamps: [any RealityKit.Material] = []
  private var beams: ModelEntity?
  private var shownNight: Bool?
  private var shownSign: String?
  private var frames: Cancellable?
  private var visibility: Timer?
  /// The last frame, shown while the scene is detached and until it has drawn
  /// again, so scrolling back never finds an empty box.
  private let still = UIImageView()
  private var rendering = false
  private var framesSinceAttach = 0
  private var yaw = BusModelView.restYaw
  private var spin: Float = 0
  private var dragging = false
  /// Half the footprint's diagonal (what the turn sweeps) and the height, in metres.
  private var sweep: Float = 5.6
  private var height: Float = 3.1
  /// A flight from the pill this view has claimed, and its course once flying.
  private var arrival: BusFlight?
  private var flightLink: CADisplayLink?
  private var flightStart: CFTimeInterval = 0
  /// The bus's outline in the scene at the pill's pose, in this view's points.
  private var flightOutline: CGRect = .zero
  private var flightMask: CALayer?

  private let key = DirectionalLight()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = paper

    key.light.intensity = 2600
    key.look(at: .zero, from: [-4, 7, 5], relativeTo: nil)
    camera.camera.fieldOfViewInDegrees = Self.fieldOfView
    anchor.addChild(turntable)
    anchor.addChild(camera)
    anchor.addChild(key)
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])

    still.isHidden = true
    still.isUserInteractionEnabled = false
    addSubview(still)

    addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(pan(_:))))
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: BusModelView, _) in
        view.drawNight()
      }
    }
  }

  func apply() {
    loadBus()
    backgroundColor = paper
    arView?.environment.background = .color(paper)
    if !spins, !dragging, UIAccessibility.isReduceMotionEnabled {
      spin = 0
    }
    drawSign()
    drawNight()
  }

  /// The bus for `kind`, replacing one of another kind already shown.
  private func loadBus() {
    guard shownKind != kind else { return }
    shownKind = kind
    BusAsset.load(kind) { [weak self, kind] bus in
      guard let self, self.kind == kind else { return }
      self.show(bus)
    }
  }

  private func show(_ bus: Entity?) {
    guard let bus else { return }
    self.bus?.removeFromParent()
    shadow?.removeFromParent()
    shownSign = nil
    self.bus = bus
    turntable.addChild(bus)
    let bounds = bus.visualBounds(relativeTo: turntable)
    sweep = simd_length(SIMD2(bounds.extents.x, bounds.extents.z)) / 2
    height = bounds.extents.y
    shadow = BusAsset.contactShadow(width: bounds.extents.x, length: bounds.extents.z)
    if let shadow {
      turntable.addChild(shadow)
    }
    headsign = BusAsset.headsign(in: bus)
    headlamps = BusAsset.headlamps(in: bus)
    dayLamps = headlamps?.model?.materials ?? []
    beams?.removeFromParent()
    // Its near edge at the front of the bus, reaching a bus-length ahead.
    let reach = bounds.extents.z
    beams = BusAsset.headlightBeams(width: bounds.extents.x * 1.6, length: reach)
    if let beams {
      beams.position.z = bounds.max.z + reach / 2
      beams.isEnabled = false
      turntable.addChild(beams)
    }
    shownNight = nil
    drawSign()
    drawNight()
    aim()
    // Arriving from the pill, it shows itself when it takes off.
    guard arrival == nil, !revealed else { return }
    revealed = true
    // In place before the first frame (a cached bus), it's simply there.
    guard let arView else { return }
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.35) {
      arView.alpha = 1
    }
  }

  /// In dark mode the bus has its lights on: lit headlamps, beams on the
  /// road and a dimmer key light, so the LED sign glows against it.
  private func drawNight() {
    let night = traitCollection.userInterfaceStyle == .dark
    guard night != shownNight, bus != nil else { return }
    shownNight = night
    key.light.intensity = night ? 1400 : 2600
    beams?.isEnabled = night
    guard let headlamps, var model = headlamps.model, !dayLamps.isEmpty else { return }
    model.materials = night ? Array(repeating: BusAsset.litLamp, count: dayLamps.count) : dayLamps
    headlamps.model = model
  }

  private func drawSign() {
    guard let headsign, var model = headsign.model else { return }
    let destination = destination ?? "rapidKL"
    let key = "\(routeCode)\n\(destination)"
    guard key != shownSign,
      let material = BusAsset.headsignMaterial(route: routeCode, destination: destination)
    else { return }
    shownSign = key
    model.materials = Array(repeating: material, count: max(1, model.materials.count))
    headsign.model = model
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Mid-flight it's in the overlay, sized and moved by the flight.
    if flightLink == nil {
      arView?.frame = bounds
    }
    still.frame = bounds
    aim()
  }

  /// Fits the cylinder the bus sweeps as it turns, so no angle clips: an end
  /// swung toward the camera is nearer, so larger and lower. For each edge
  /// point, the distance that puts it just inside the frame is solved
  /// directly; the aim height is the one that lets the camera come closest.
  private func aim() {
    let w = Float(bounds.width)
    let h = Float(bounds.height)
    guard w > 0, h > 0 else { return }
    let margin: Float = 1.06
    let tanV = tan(Self.fieldOfView * .pi / 360) / margin
    let tanH = tan(Self.fieldOfView * .pi / 360) * w / h / margin
    let back = SIMD3<Float>(0, sin(Self.elevation), cos(Self.elevation))
    let right = SIMD3<Float>(1, 0, 0)
    let up = simd_cross(back, right)
    var edge: [SIMD3<Float>] = []
    for step in 0..<24 {
      let a = Float(step) / 24 * 2 * .pi
      edge.append([sweep * cos(a), 0, sweep * sin(a)])
      edge.append([sweep * cos(a), height, sweep * sin(a)])
    }

    var best: (distance: Float, target: SIMD3<Float>)?
    for share in stride(from: Float(0.2), through: 0.7, by: 0.05) {
      let target = SIMD3<Float>(0, height * share, 0)
      var distance: Float = 0
      for point in edge {
        let p = point - target
        let need = max(abs(simd_dot(p, right)) / tanH, abs(simd_dot(p, up)) / tanV) + simd_dot(p, back)
        distance = max(distance, need)
      }
      if best == nil || distance < best!.distance {
        best = (distance, target)
      }
    }
    guard let best else { return }
    camera.look(at: best.target, from: best.target + best.distance * back, relativeTo: nil)
  }

  // MARK: Rendering only while seen

  /// Sheets keep the view mounted below their edge or scrolled out of sight,
  /// and a screen over the sheet takes it out of the window; a cheap check
  /// four times a second lets the ARView go there, which stops RealityKit
  /// drawing, and makes one a view's height before it comes back into view.
  /// A still of the last frame covers the gap either way.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    visibility?.invalidate()
    visibility = nil
    if window == nil, arrival != nil {
      // The sheet went before the bus landed.
      land()
    }
    if window != nil, arrival == nil, let flight = BusFlight.claim(by: self) {
      // Hidden here, and posed as the pill drew it, until it takes off.
      arrival = flight
      arView?.layer.removeAllAnimations()
      arView?.alpha = 0
      yaw = Self.pillYaw
      spin = 0
      turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
    }
    if window != nil {
      visibility = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.checkVisibility()
        }
      }
    }
    checkVisibility()
  }

  private func checkVisibility() {
    guard flightLink == nil else { return }
    guard let window, !isHidden else {
      render(false)
      return
    }
    let near = window.bounds.insetBy(dx: 0, dy: -bounds.height)
    render(convert(bounds, to: window).intersects(near))
  }

  private func render(_ on: Bool) {
    guard on != rendering else { return }
    rendering = on
    if on {
      // Still there if the last still never came back.
      guard arView == nil else { return }
      let view = makeARView()
      arView = view
      insertSubview(view, at: 0)
      framesSinceAttach = 0
      frames = view.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        MainActor.assumeIsolated {
          self?.tick(Float(event.deltaTime))
        }
      }
    } else if let arView, revealed {
      arView.snapshot(saveToHDR: false) { [weak self] image in
        Task { @MainActor in
          guard let self, !self.rendering else { return }
          self.still.image = image
          self.still.isHidden = image == nil
          self.detach()
        }
      }
    } else {
      // Nothing drawn yet, so nothing to keep.
      detach()
    }
  }

  private func makeARView() -> ARView {
    let view = ARView(frame: bounds, cameraMode: .nonAR, automaticallyConfigureSession: false)
    view.alpha = revealed && arrival == nil ? 1 : 0
    // Touches go to this view's own pan, so vertical drags reach the sheet.
    view.isUserInteractionEnabled = false
    view.renderOptions = [
      .disableMotionBlur, .disableDepthOfField, .disableCameraGrain, .disableGroundingShadows,
    ]
    view.environment.background = .color(paper)
    view.scene.addAnchor(anchor)
    return view
  }

  private func detach() {
    frames?.cancel()
    frames = nil
    guard let arView else { return }
    arView.scene.removeAnchor(anchor)
    arView.removeFromSuperview()
    self.arView = nil
  }

  private func tick(_ dt: Float) {
    // The update before a frame: two in, the scene is on screen again.
    framesSinceAttach += 1
    if framesSinceAttach == 3 {
      still.isHidden = true
    }
    // Drawn twice in place, it has a frame to fly with.
    if arrival != nil, flightLink == nil, framesSinceAttach >= 2, bus != nil {
      takeOff()
    }
    guard flightLink == nil, !dragging else { return }
    let target = spins ? Self.idleSpin : 0
    spin += (target - spin) * (1 - exp(-dt / Self.settle))
    guard abs(spin) > 0.0001 else { return }
    yaw += spin * dt
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
  }

  // MARK: Arriving from the pill

  /// Called when a claimed flight gave up waiting: show up here as usual.
  func arrivalMissed() {
    guard arrival != nil, flightLink == nil else { return }
    arrival = nil
    guard bus != nil else { return }
    revealed = true
    UIView.animate(withDuration: 0.35) {
      self.arView?.alpha = 1
    }
  }

  /// Lifts the scene into the overlay at the pill's size and place, if there's
  /// enough of this view in sight to land in.
  private func takeOff() {
    guard let flight = arrival, let bus, let arView else { return }
    let target = convert(bounds, to: nil)
    let shown = target.intersection(sheetClip())
    guard shown.height >= target.height * 0.25, let outline = outline(of: bus) else {
      flight.end(animated: true)
      arrivalMissed()
      return
    }
    flight.departed()
    flightOutline = outline
    // Clear while it flies over the map; paper again once it lands.
    arView.environment.background = .color(.clear)
    arView.backgroundColor = .clear
    flight.stage.insertSubview(arView, belowSubview: flight.picture)
    arView.bounds = CGRect(origin: .zero, size: bounds.size)
    let mask = CALayer()
    mask.backgroundColor = UIColor.black.cgColor
    mask.frame = flight.stage.bounds
    flight.stage.layer.mask = mask
    flightMask = mask
    flightStart = CACurrentMediaTime()
    let link = CADisplayLink(target: self, selector: #selector(flightFrame))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    flightLink = link
    flightFrame()
  }

  /// One frame of the flight. The bus's outline moves from the pill's bus to
  /// its place here on the sheet's own curve, growing to full size, while it
  /// turns most of a turn the way it idles and settles at rest. The pill's
  /// picture rides along for the first frames, crossfading into the scene.
  @objc private func flightFrame() {
    guard let flight = arrival, let arView else { return }
    let p = min(1, (CACurrentMediaTime() - flightStart) / Self.flightDuration)
    let move = CGFloat(Easing.sheet(p))
    let turn = Float(Easing.out(p))

    yaw = Self.pillYaw + (Self.restYaw + 2 * .pi - Self.pillYaw) * turn
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])

    // Read each frame: the sheet's content can still settle as it rises.
    let target = convert(bounds, to: nil)
    let center = CGPoint(x: target.midX, y: target.midY)
    let offset = CGPoint(x: flightOutline.midX - bounds.midX, y: flightOutline.midY - bounds.midY)
    let pill = CGPoint(x: flight.busRect.midX, y: flight.busRect.midY)
    let startScale = flight.busRect.width / max(flightOutline.width, 1)
    let scale = startScale + (1 - startScale) * move
    let shift = CGPoint(
      x: (pill.x - center.x - startScale * offset.x) * (1 - move),
      y: (pill.y - center.y - startScale * offset.y) * (1 - move))
    arView.center = center
    arView.transform = CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: shift.x, ty: shift.y)

    let fade = CGFloat(min(1, p / 0.12))
    arView.alpha = fade
    let busNow = CGPoint(x: center.x + scale * offset.x + shift.x, y: center.y + scale * offset.y + shift.y)
    flight.picture.alpha = 1 - fade
    flight.picture.transform = CGAffineTransform(translationX: busNow.x - pill.x, y: busNow.y - pill.y)
      .scaledBy(x: scale / startScale, y: scale / startScale)

    // Unclipped at the pill, clipped to the sheet by the time it lands.
    let full = flight.stage.bounds
    let clip = sheetClip()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    flightMask?.frame = CGRect(
      x: full.minX + (clip.minX - full.minX) * move,
      y: full.minY + (clip.minY - full.minY) * move,
      width: full.width + (clip.width - full.width) * move,
      height: full.height + (clip.height - full.height) * move)
    CATransaction.commit()

    if p >= 1 { land() }
  }

  /// Back into this view, at rest, easing into its idle turn.
  private func land() {
    flightLink?.invalidate()
    flightLink = nil
    let flight = arrival
    arrival = nil
    revealed = true
    if let arView {
      arView.transform = .identity
      arView.alpha = 1
      arView.environment.background = .color(paper)
      arView.backgroundColor = nil
      if rendering {
        if arView.superview !== self {
          insertSubview(arView, at: 0)
        }
        arView.frame = bounds
      } else {
        detach()
      }
    }
    yaw = Self.restYaw
    spin = 0
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
    flight?.stage.layer.mask = nil
    flightMask = nil
    flight?.end(animated: false)
  }

  /// What the sheet shows of its content: the nearest scroll view's visible
  /// rect, in window points.
  private func sheetClip() -> CGRect {
    var view = superview
    while let current = view {
      if let scroll = current as? UIScrollView {
        return scroll.convert(scroll.bounds, to: nil)
      }
      view = current.superview
    }
    return window?.bounds ?? bounds
  }

  /// The bus's box as the camera sees it now, in this view's points.
  private func outline(of bus: Entity) -> CGRect? {
    let box = bus.visualBounds(relativeTo: bus)
    var points: [CGPoint] = []
    for x in [box.min.x, box.max.x] {
      for y in [box.min.y, box.max.y] {
        for z in [box.min.z, box.max.z] {
          if let point = arView?.project(bus.convert(position: [x, y, z], to: nil)) {
            points.append(point)
          }
        }
      }
    }
    guard points.count == 8 else { return nil }
    let xs = points.map(\.x)
    let ys = points.map(\.y)
    return CGRect(
      x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
  }

  // MARK: Gestures

  /// A drag across the whole view turns the bus half a turn.
  private var radiansPerPoint: Float {
    .pi / Float(max(bounds.width, 1))
  }

  @objc private func pan(_ gesture: UIPanGestureRecognizer) {
    switch gesture.state {
    case .began:
      dragging = true
      spin = 0
    case .changed:
      yaw += Float(gesture.translation(in: self).x) * radiansPerPoint
      gesture.setTranslation(.zero, in: self)
      turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
    default:
      dragging = false
      spin = max(-8, min(8, Float(gesture.velocity(in: self).x) * radiansPerPoint))
    }
  }

  /// Only sideways drags turn the bus; vertical ones scroll and drag the sheet.
  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard let pan = gestureRecognizer as? UIPanGestureRecognizer, pan.view === self else {
      return super.gestureRecognizerShouldBegin(gestureRecognizer)
    }
    let velocity = pan.velocity(in: self)
    return abs(velocity.x) > abs(velocity.y) * 1.2
  }
}
