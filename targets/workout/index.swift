import ActivityKit
import SwiftUI
import WidgetKit

/// The workout clock, on the lock screen and in the Dynamic Island.
///
/// ── Why the clock is a `Text(timerInterval:)` and not a number ────────────
///
/// Because nothing here runs. A Live Activity's view is rendered by the system,
/// not by this app, and the app is suspended the moment the phone locks — which
/// is the only time this view matters. A widget that drew an elapsed figure it
/// had been handed would freeze at whatever second it was given.
///
/// `Text(timerInterval:)` is the system's own counting text: it is given a date
/// range and WidgetKit advances it. The same reasoning as the wall-clock
/// elapsed in app/(client)/workouts.tsx, one layer down — count from a fact,
/// never from a tick somebody has to keep delivering.
///
/// ── Paused ───────────────────────────────────────────────────────────────
///
/// A paused session shows the elapsed it had reached and stops. There is no
/// way to freeze `timerInterval`, so the paused case renders a plain figure —
/// which is correct precisely because it is not moving.
/// Where tapping the Live Activity should land, read from the app that contains
/// this extension.
///
/// ── the bug ───────────────────────────────────────────────────────────────
///
/// Reported: "the timer works on the locked screen. however when you tap it and
/// open the phone the timed session is lost and the app opens on the home
/// screen." Both halves are one cause. Without `.widgetURL` a Live Activity tap
/// simply launches the containing app, which opens on its default route — the
/// home tab — and the session is not "lost" at all: nothing asked the workout
/// screen to restore it, because nothing went to the workout screen.
///
/// ── why this is read and not written down ─────────────────────────────────
///
/// The obvious fix is `URL(string: "repple://…")`. This product is white-label:
/// `src/lib/brands.ts` gives every brand its own scheme, and a hard-coded one
/// would send a tap on a branded build into an app that does not exist — or, if
/// the brand's scheme were registered by something else on the phone, into
/// somebody else's app.
///
/// An extension's `Bundle.main` is the EXTENSION. The containing app is two
/// directories up — `Repple.app/PlugIns/WorkoutActivity.appex` — so the app's
/// own `CFBundleURLSchemes` is readable at runtime, which is true for every
/// brand without anything being injected at build time.
///
/// Every failure returns nil, and a nil `widgetURL` is exactly the behaviour
/// this had before: the app opens. A tap that lands on the home screen is a
/// disappointment; a tap that opens the wrong app is a bug.
private func containingAppURL(path: String) -> URL? {
  let appBundleURL = Bundle.main.bundleURL
    .deletingLastPathComponent()   // PlugIns
    .deletingLastPathComponent()   // <App>.app
  guard let app = Bundle(url: appBundleURL),
        let types = app.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]]
  else { return nil }
  for type in types {
    guard let schemes = type["CFBundleURLSchemes"] as? [String] else { continue }
    // The first registered scheme, which is the app's own. Expo writes exactly
    // one for `scheme` in the app config; a brand with several would still put
    // its own first.
    if let scheme = schemes.first(where: { !$0.isEmpty }) {
      return URL(string: "\(scheme)://\(path)")
    }
  }
  return nil
}

struct WorkoutActivityView: View {
  let context: ActivityViewContext<WorkoutAttributes>

  /// When this session started, with the pauses it has already banked taken
  /// off — so the interval the system counts is TRAINING time, not wall time.
  private var effectiveStart: Date {
    Date(timeIntervalSince1970: context.state.startedAt + (context.state.pausedMs / 1000))
  }

  private var elapsedText: String {
    let secs = max(0, Int(Date().timeIntervalSince(effectiveStart)))
    return String(format: "%d:%02d", secs / 60, secs % 60)
  }

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.activity)
          .font(.caption)
          .foregroundStyle(.secondary)
        if context.state.paused {
          Text(elapsedText).font(.title2).monospacedDigit().bold()
        } else {
          Text(timerInterval: effectiveStart...Date.distantFuture, countsDown: false)
            .font(.title2).monospacedDigit().bold()
        }
      }
      Spacer()
      Text(context.state.paused ? "Paused" : "Recording")
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .activityBackgroundTint(nil)
    // Straight to the screen that is running the session, not to the app. The
    // triple slash is deliberate and is how expo-router reads an absolute
    // route: `<scheme>:///(client)/workouts`. The workout screen restores a
    // session in progress on mount — src/lib/liveSession.ts — so landing there
    // IS the restore.
    .widgetURL(containingAppURL(path: "/(client)/workouts"))
  }
}

struct WorkoutActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutAttributes.self) { context in
      WorkoutActivityView(context: context)
    } dynamicIsland: { context in
      let start = Date(timeIntervalSince1970: context.state.startedAt + (context.state.pausedMs / 1000))
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(context.attributes.activity).font(.caption).foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.state.paused {
            Text("Paused").font(.caption2).foregroundStyle(.secondary)
          } else {
            Text(timerInterval: start...Date.distantFuture, countsDown: false)
              .font(.title3).monospacedDigit()
          }
        }
      } compactLeading: {
        Image(systemName: "figure.run")
      } compactTrailing: {
        if context.state.paused {
          Image(systemName: "pause.fill")
        } else {
          Text(timerInterval: start...Date.distantFuture, countsDown: false)
            .font(.caption2).monospacedDigit().frame(maxWidth: 44)
        }
      } minimal: {
        Image(systemName: "figure.run")
      }
    }
  }
}

@main
struct WorkoutActivityBundle: WidgetBundle {
  var body: some Widget {
    WorkoutActivityWidget()
  }
}
