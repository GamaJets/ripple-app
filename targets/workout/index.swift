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
