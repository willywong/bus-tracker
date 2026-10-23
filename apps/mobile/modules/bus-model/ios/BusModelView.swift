import Combine
import ExpoModulesCore
import RealityKit
import UIKit

/// The bus on a slow turntable over the sheet's paper. It rests at a
/// three-quarter view of the front and kerb side; a sideways drag turns it,
/// a flick spins it, and it eases back into its idle turn (no idle turn when
/// `spins` is off, for Reduce Motion). Vertical drags pass through to the
/// sheet. Renders only while on screen.
final class BusModelView: ExpoView {
  var routeCode = ""
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

  private let arView = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
  private let anchor = AnchorEntity(world: .zero)
  private let turntable = Entity()
  private let camera = PerspectiveCamera()
  private var headsign: ModelEntity?
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

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = paper

    arView.alpha = 0
    // Touches go to this view's own pan, so vertical drags reach the sheet.
    arView.isUserInteractionEnabled = false
    arView.renderOptions = [
      .disableMotionBlur, .disableDepthOfField, .disableCameraGrain, .disableGroundingShadows,
    ]
    arView.environment.background = .color(paper)

    let key = DirectionalLight()
    key.light.intensity = 2600
    key.look(at: .zero, from: [-4, 7, 5], relativeTo: nil)
    camera.camera.fieldOfViewInDegrees = Self.fieldOfView
    anchor.addChild(turntable)
    anchor.addChild(camera)
    anchor.addChild(key)
    arView.scene.addAnchor(anchor)
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])

    still.isHidden = true
    still.isUserInteractionEnabled = false
    addSubview(still)

    addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(pan(_:))))

    BusAsset.load { [weak self] bus in
      self?.show(bus)
    }
  }

  func apply() {
    backgroundColor = paper
    arView.environment.background = .color(paper)
    if !spins, !dragging {
      spin = 0
    }
    drawSign()
  }

  private func show(_ bus: Entity?) {
    guard let bus else { return }
    turntable.addChild(bus)
    let bounds = bus.visualBounds(relativeTo: turntable)
    sweep = simd_length(SIMD2(bounds.extents.x, bounds.extents.z)) / 2
    height = bounds.extents.y
    if let shadow = BusAsset.contactShadow(width: bounds.extents.x, length: bounds.extents.z) {
      turntable.addChild(shadow)
    }
    headsign = BusAsset.headsign(in: bus)
    drawSign()
    aim()
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.35) {
      self.arView.alpha = 1
    }
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
    arView.frame = bounds
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

  /// Sheets keep the view mounted below their edge or scrolled out of sight;
  /// a cheap check four times a second detaches the scene there, which stops
  /// RealityKit drawing, and re-attaches it a view's height before it comes
  /// back into view. A still of the last frame covers the gap either way.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    visibility?.invalidate()
    visibility = nil
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
      guard arView.superview == nil else { return }
      arView.frame = bounds
      insertSubview(arView, at: 0)
      framesSinceAttach = 0
      frames = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        MainActor.assumeIsolated {
          self?.tick(Float(event.deltaTime))
        }
      }
    } else if arView.alpha == 0 {
      // Nothing drawn yet, so nothing to keep.
      detach()
    } else {
      arView.snapshot(saveToHDR: false) { [weak self] image in
        Task { @MainActor in
          guard let self, !self.rendering else { return }
          self.still.image = image
          self.still.isHidden = image == nil
          self.detach()
        }
      }
    }
  }

  private func detach() {
    frames?.cancel()
    frames = nil
    arView.removeFromSuperview()
  }

  private func tick(_ dt: Float) {
    // The update before a frame: two in, the scene is on screen again.
    framesSinceAttach += 1
    if framesSinceAttach == 3 {
      still.isHidden = true
    }
    guard !dragging else { return }
    let target = spins ? Self.idleSpin : 0
    spin += (target - spin) * (1 - exp(-dt / Self.settle))
    guard abs(spin) > 0.0001 else { return }
    yaw += spin * dt
    turntable.orientation = simd_quatf(angle: yaw, axis: [0, 1, 0])
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
