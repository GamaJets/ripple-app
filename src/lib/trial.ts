// Free-trial tracking for trainers/gyms, ON THIS DEVICE.
//
// A 14-day trial from first launch, kept under one AsyncStorage key. Delete the
// app and reinstall it, clear its storage, or sign in on a second phone, and it
// starts again from zero — which is why THIS IS NO LONGER THE AUTHORITY ON
// ANYTHING. Part 191 records `trainers.trial_started_at` on the account,
// immutable once set, and src/lib/trialGate.ts is the arithmetic on top of it.
//
// What survives here is the cheap, offline, no-round-trip banner figure, and
// one other use: app/(trainer)/billing.tsx reads both and SAYS when they
// disagree, because the gap between them is exactly the leak the account-wide
// record closes, and a coach who has reinstalled twice is entitled to see that
// the app noticed.
//
// Nothing is gated on either figure today. Non-blocking: it surfaces a banner
// and an upgrade CTA, and real gating switches on once Stripe price ids exist —
// but the account-level record had to be in place BEFORE that day, because a
// gate added afterwards cannot tell a coach who has had six months of free
// trial from one who installed yesterday.
//
// Pure-ish; AsyncStorage only. The pure half is trialGate.ts, which is where
// the tests are, because this file cannot be imported under plain node.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'repple.trialStart';
export const TRIAL_DAYS = 14;

export interface TrialInfo { daysLeft: number; active: boolean; expired: boolean }

export async function trialInfo(): Promise<TrialInfo> {
  try {
    let s = await AsyncStorage.getItem(KEY);
    if (!s) { s = String(Date.now()); await AsyncStorage.setItem(KEY, s); }
    const start = parseInt(s, 10);
    const elapsed = Math.floor((Date.now() - start) / 86_400_000);
    const daysLeft = Math.max(0, TRIAL_DAYS - elapsed);
    return { daysLeft, active: daysLeft > 0, expired: daysLeft <= 0 };
  } catch { return { daysLeft: TRIAL_DAYS, active: true, expired: false }; }
}
