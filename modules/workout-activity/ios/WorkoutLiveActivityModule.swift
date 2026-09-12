import ActivityKit
import ExpoModulesCore

/// Start, update and end the workout Live Activity.
///
/// The whole surface is three calls, and every one of them is allowed to do
/// nothing: a device below iOS 16.1, a member who has turned Live Activities
/// off in Settings, or a system that has run out of slots all reach here and
/// must leave the WORKOUT unaffected. A session is a health record; a decoration
/// on the lock screen is not, and it does not get to fail one.
///
/// So nothing here throws into JS. `isSupported` answers honestly and the rest
/// are best-effort — which is why the runner never branches on their result.
public class WorkoutLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WorkoutLiveActivity")

    /// Whether a Live Activity can be started AT ALL right now — the OS version
    /// and the member's own setting, asked together, because a caller cannot
    /// act differently on the two and a screen must not imply it can.
    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    /// Begin one. Ends any existing activity first: a member who starts a
    /// second workout without finishing the first should see the one they are
    /// doing, not the one they abandoned.
    AsyncFunction("start") { (activity: String, startedAt: Double, pausedMs: Double) -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      await Self.endAll()
      let attrs = WorkoutAttributes(activity: activity)
      let state = WorkoutAttributes.ContentState(startedAt: startedAt, pausedMs: pausedMs, paused: false)
      do {
        _ = try Activity.request(attributes: attrs, content: .init(state: state, staleDate: nil))
        return true
      } catch {
        // A refusal here is ordinary — too many activities, or the setting
        // changed between the check and the request. The workout carries on.
        return false
      }
    }

    /// Move the clock. Called when a session is paused or resumed, and NOT on a
    /// tick: the widget counts from a date on its own, so there is nothing to
    /// push every second and pushing it would wake this app once a second for a
    /// figure the system is already drawing.
    AsyncFunction("update") { (startedAt: Double, pausedMs: Double, paused: Bool) -> Void in
      guard #available(iOS 16.2, *) else { return }
      let state = WorkoutAttributes.ContentState(startedAt: startedAt, pausedMs: pausedMs, paused: paused)
      for activity in Activity<WorkoutAttributes>.activities {
        await activity.update(.init(state: state, staleDate: nil))
      }
    }

    /// Take it off the lock screen. `.immediate` because the session is over
    /// and a clock that lingers is a clock that is wrong.
    AsyncFunction("end") { () -> Void in
      guard #available(iOS 16.2, *) else { return }
      await Self.endAll()
    }
  }

  @available(iOS 16.2, *)
  private static func endAll() async {
    for activity in Activity<WorkoutAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
