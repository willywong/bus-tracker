import ExpoModulesCore
import MapKit

// Typed errors: JS reads `error.code` and decides what to show. Every
// failure that leaves the module is one of these, never a raw NSError.

final class OfflineException: Exception, @unchecked Sendable {
  override var code: String { "ERR_OFFLINE" }
  override var reason: String { "Apple Maps is unreachable" }
}

final class ThrottledException: Exception, @unchecked Sendable {
  override var code: String { "ERR_THROTTLED" }
  override var reason: String { "Apple Maps is throttling requests" }
}

final class NotFoundException: Exception, @unchecked Sendable {
  override var code: String { "ERR_NOT_FOUND" }
  override var reason: String { "Apple Maps found nothing" }
}

/// The completion id is older than the last two batches (or from a previous
/// launch). Shares `ERR_NOT_FOUND` so JS handles it like an empty search.
final class UnknownCompletionException: Exception, @unchecked Sendable {
  override var code: String { "ERR_NOT_FOUND" }
  override var reason: String { "That suggestion has expired; search again" }
}

/// Maps any MapKit, URL or file error to one of the typed exceptions above.
func mapsException(_ error: Error) -> Exception {
  if let exception = error as? Exception {
    return exception
  }
  let nsError = error as NSError
  if nsError.domain == NSURLErrorDomain {
    return OfflineException().causedBy(error)
  }
  if nsError.domain == MKError.errorDomain {
    switch MKError.Code(rawValue: UInt(nsError.code)) {
    case .loadingThrottled:
      return ThrottledException().causedBy(error)
    case .serverFailure:
      return OfflineException().causedBy(error)
    case .directionsNotFound, .placemarkNotFound:
      return NotFoundException().causedBy(error)
    default:
      // `.unknown` usually wraps a network failure.
      if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError,
        underlying.domain == NSURLErrorDomain
      {
        return OfflineException().causedBy(error)
      }
      return NotFoundException().causedBy(error)
    }
  }
  return NotFoundException().causedBy(error)
}
