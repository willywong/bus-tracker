import ExpoModulesCore

/// The 3D bus on the bus detail sheet: a RealityKit view, no JS per frame.
/// JS sends only what the bus shows (route, destination, the sheet's paper)
/// and whether it may spin on its own.
public class BusModelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BusModel")

    Constant("hasModel") {
      BusAsset.assetURL(.feeder) != nil && BusAsset.assetURL(.rapid) != nil
    }

    // Each keyed by bus kind ("feeder", "rapid").
    Constant("mapSprites") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.map {
        ($0.rawValue, BusAsset.mapSpriteURLs($0).map(\.absoluteString))
      })
    }

    Constant("pillIcons") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.compactMap { kind in
        BusAsset.pillIconURL(kind).map { (kind.rawValue, $0.absoluteString) }
      })
    }

    // The same, lit for the night; empty where the build has none.
    Constant("nightSprites") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.map {
        ($0.rawValue, BusAsset.mapSpriteURLs($0, night: true).map(\.absoluteString))
      })
    }

    Constant("nightPillIcons") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.compactMap { kind in
        BusAsset.pillIconURL(kind, night: true).map { (kind.rawValue, $0.absoluteString) }
      })
    }

    // Ride along's, seen from low behind as the tilted map sees the bus.
    Constant("rideSprites") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.map {
        ($0.rawValue, BusAsset.mapSpriteURLs($0, ride: true).map(\.absoluteString))
      })
    }

    Constant("rideNightSprites") {
      Dictionary(uniqueKeysWithValues: BusKind.allCases.map {
        ($0.rawValue, BusAsset.mapSpriteURLs($0, night: true, ride: true).map(\.absoluteString))
      })
    }

    // Stop shelters, rail stations and the MRT landmark, by name.
    Constant("landmarks") {
      BusAsset.landmarkURLs().mapValues(\.absoluteString)
    }

    // The pill's bus, at this frame in window points, flying into the sheet
    // that's about to open.
    AsyncFunction("launch") { (x: Double, y: Double, width: Double, height: Double, kind: String) in
      MainActor.assumeIsolated {
        BusFlight.launch(
          from: CGRect(x: x, y: y, width: width, height: height), kind: BusKind(rawValue: kind) ?? .feeder)
      }
    }.runOnQueue(.main)

    // The sheet going down: its bus flies back into the pill's bus at this frame.
    AsyncFunction("home") { (x: Double, y: Double, width: Double, height: Double, kind: String) in
      MainActor.assumeIsolated {
        BusFlight.home(
          to: CGRect(x: x, y: y, width: width, height: height), kind: BusKind(rawValue: kind) ?? .feeder)
      }
    }.runOnQueue(.main)

    // Where ride along's camera faces as it turns (degrees from north), so
    // the map's buses are drawn facing the right way on the turned map.
    Events("onRideHeading")

    OnCreate {
      RideAlong.onHeading = { [weak self] heading in
        self?.sendEvent("onRideHeading", ["heading": heading])
      }
    }

    // Ride along: the map camera follows the bus marker with this identifier.
    AsyncFunction("rideAlong") { (identifier: String, heading: Double, bottomInset: Double) in
      MainActor.assumeIsolated {
        RideAlong.start(identifier: identifier, heading: heading, bottomInset: bottomInset)
      }
    }.runOnQueue(.main)

    AsyncFunction("rideAlongTurn") { (heading: Double) in
      MainActor.assumeIsolated { RideAlong.turn(heading) }
    }.runOnQueue(.main)

    AsyncFunction("rideAlongInset") { (bottomInset: Double) in
      MainActor.assumeIsolated { RideAlong.inset(bottomInset) }
    }.runOnQueue(.main)

    AsyncFunction("rideAlongPause") {
      MainActor.assumeIsolated { RideAlong.pause() }
    }.runOnQueue(.main)

    AsyncFunction("rideAlongStop") {
      MainActor.assumeIsolated { RideAlong.stop() }
    }.runOnQueue(.main)

    View(BusModelView.self) {
      Prop("routeCode") { (view, code: String) in
        view.routeCode = code
      }

      Prop("kind") { (view, kind: String?) in
        view.kind = kind.flatMap(BusKind.init(rawValue:)) ?? .feeder
      }

      Prop("destination") { (view, destination: String?) in
        view.destination = destination
      }

      Prop("paper") { (view, paper: UIColor?) in
        view.paper = paper ?? .systemBackground
      }

      Prop("spins") { (view, spins: Bool?) in
        view.spins = spins ?? true
      }

      OnViewDidUpdateProps { view in
        view.apply()
      }
    }
  }
}
