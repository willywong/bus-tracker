import ExpoModulesCore

/// The 3D bus on the bus detail sheet: a RealityKit view, no JS per frame.
/// JS sends only what the bus shows (route, destination, the sheet's paper)
/// and whether it may spin on its own.
public class BusModelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BusModel")

    Constant("hasModel") {
      BusAsset.assetURL() != nil
    }

    Constant("mapSprites") {
      BusAsset.mapSpriteURLs().map(\.absoluteString)
    }

    Constant("pillIcon") {
      BusAsset.pillIconURL()?.absoluteString
    }

    View(BusModelView.self) {
      Prop("routeCode") { (view, code: String) in
        view.routeCode = code
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
