import SwiftUI

@main
struct RepleWatchApp: App {
  @StateObject private var session = WatchSession()
  var body: some Scene {
    WindowGroup { SetView().environmentObject(session) }
  }
}

/// The whole companion: the current exercise and set, and one button.
struct SetView: View {
  @EnvironmentObject var session: WatchSession
  var body: some View {
    if let s = session.state {
      VStack(alignment: .leading, spacing: 6) {
        Text("Exercise \(s.exerciseIndex + 1) of \(s.exerciseCount)")
          .font(.caption2).foregroundStyle(.secondary)
        Text(s.exercise).font(.headline).lineLimit(2)
        Text("Set \(s.setIndex + 1) of \(s.setCount) · \(s.targetReps)\(s.targetLoad.map { " · \($0)" } ?? "")")
          .font(.caption).monospacedDigit()
        if let end = s.restEndsAt, end > Date() {
          Text(timerInterval: Date()...end, countsDown: true).font(.title3).monospacedDigit()
        }
        Button("Complete Set") { session.completeSet() }
          .tint(Color(red: 0.18, green: 0.89, blue: 0.48))
          .disabled(session.sending)
      }
    } else {
      Text("Start a workout on your phone").multilineTextAlignment(.center)
    }
  }
}
