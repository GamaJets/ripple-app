import Foundation
import WatchConnectivity

/// Mirror of src/lib/watchSync.ts (protocol v1). The phone is the only writer
/// of the log; this sends an intent with an idempotency key and waits for the
/// next state.
struct SessionState: Decodable {
  let exercise: String
  let exerciseIndex: Int
  let exerciseCount: Int
  let setIndex: Int
  let setCount: Int
  let targetReps: String
  let targetLoad: String?
  let restEndsAtMs: Double?
  var restEndsAt: Date? { restEndsAtMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
  enum CodingKeys: String, CodingKey {
    case exercise, exerciseIndex, exerciseCount, setIndex, setCount, targetReps, targetLoad
    case restEndsAtMs = "restEndsAt"
  }
}

final class WatchSession: NSObject, ObservableObject, WCSessionDelegate {
  @Published var state: SessionState?
  @Published var sending = false

  override init() {
    super.init()
    if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
  }

  func completeSet() {
    guard let s = state else { return }
    let msg: [String: Any] = ["v": 1, "kind": "set-done", "id": UUID().uuidString,
                              "exerciseIndex": s.exerciseIndex, "setIndex": s.setIndex, "reps": NSNull()]
    sending = true
    // transferUserInfo is queued and delivered even if the phone app is
    // backgrounded or out of range for a while; sendMessage would be lost.
    WCSession.default.transferUserInfo(msg)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.sending = false }
  }

  private func apply(_ dict: [String: Any]) {
    guard (dict["v"] as? Int) == 1, (dict["kind"] as? String) == "state" else { return }
    let session = dict["session"]
    DispatchQueue.main.async {
      if let obj = session as? [String: Any],
         let data = try? JSONSerialization.data(withJSONObject: obj) {
        self.state = try? JSONDecoder().decode(SessionState.self, from: data)
      } else { self.state = nil }
    }
  }

  func session(_ s: WCSession, activationDidCompleteWith st: WCSessionActivationState, error: Error?) {
    apply(s.receivedApplicationContext)
  }
  func session(_ s: WCSession, didReceiveApplicationContext ctx: [String: Any]) { apply(ctx) }
}
