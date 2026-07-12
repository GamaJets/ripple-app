// Haptic feedback. expo-haptics is a native module — only present in a build
// that included it — so every call is defensively wrapped and no-ops on the
// current build, lighting up after the notifications/haptics rebuild.
let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch { /* not in this build yet */ }

export function tapLight() {
  try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light); } catch { /* ignore */ }
}
export function tapMedium() {
  try { Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium); } catch { /* ignore */ }
}
export function notifySuccess() {
  try { Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType.Success); } catch { /* ignore */ }
}
