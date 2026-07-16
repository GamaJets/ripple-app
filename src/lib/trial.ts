// Free-trial tracking for trainers/gyms. A 14-day trial from first launch, stored
// locally. Non-blocking: surfaces a banner + upgrade CTA (real gating switches on
// once Stripe price ids exist). Pure-ish; AsyncStorage only.
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
