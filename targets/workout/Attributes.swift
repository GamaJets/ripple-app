import ActivityKit
import Foundation

/// What the lock screen is told about a workout in progress.
///
/// `startedAt` and not an elapsed count, deliberately. The same decision
/// `useLiveVitals` makes in app/(client)/workouts.tsx and for the same reason:
/// a counter stops when the process does, and iOS suspends this app the moment
/// the phone locks — which is precisely when this view is on screen. A DATE is
/// a fact the widget can subtract from `now` on its own, so the clock keeps
/// time whether or not anything is running.
///
/// `pausedMs` is carried so a session paused for a phone call does not come
/// back forty minutes longer. It is the same figure `pausedMsRef` holds.
struct WorkoutAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Wall-clock start, seconds since epoch.
    var startedAt: Double
    /// Milliseconds already banked as paused.
    var pausedMs: Double
    /// True while the member has the session paused.
    var paused: Bool
  }

  /// The activity's own name — "Cycling", "Push · Pull · Legs". Fixed for the
  /// life of the Activity, which is why it is an attribute and not state.
  var activity: String
}
