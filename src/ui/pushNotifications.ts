// Push + local notifications. Native modules (expo-notifications / expo-device)
// only exist in a build that included them, so every access is defensively
// wrapped — on the current build (before the notifications rebuild) this file
// no-ops instead of crashing, and lights up automatically once rebuilt.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

let Notifications: any = null;
let Device: any = null;
try { Notifications = require('expo-notifications'); } catch { /* not in this build yet */ }
try { Device = require('expo-device'); } catch { /* optional */ }

export const pushAvailable = () => !!Notifications;

if (Notifications?.setNotificationHandler) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
        shouldShowBanner: true, shouldShowList: true,
      }),
    });
  } catch { /* ignore */ }
}

/** Request permission, get the Expo push token, and save it for this user. */
export async function registerForPush(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    if (Device && Device.isDevice === false) return null;
    let status = (await Notifications.getPermissionsAsync())?.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync())?.status;
    if (status !== 'granted') return null;
    const token = (await Notifications.getExpoPushTokenAsync())?.data ?? null;
    if (token && USE_SUPABASE) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (uid) await supabase.from('push_tokens').upsert({ user_id: uid, token, platform: 'expo' }, { onConflict: 'token' });
      } catch { /* best-effort */ }
    }
    return token;
  } catch { return null; }
}

/** Schedule a local reminder (e.g. a booked session) at a future date. */
export async function scheduleLocal(title: string, body: string, date: Date): Promise<void> {
  if (!Notifications) return;
  try {
    if (date.getTime() <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: { type: 'date', date } });
  } catch { /* ignore */ }
}
