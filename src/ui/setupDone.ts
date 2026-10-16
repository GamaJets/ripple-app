import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

/** The phone's own mark that setup is finished. Set once, never cleared. */
export const ONBOARD_KEY = 'repple.onboarded';

/**
 * Has this member finished first-run setup — on this phone OR on the account?
 *
 * The phone's mark answers at once. Without it, `clients.onboarded_at`
 * (part 3570) is asked; when that is set the phone's mark is written so the
 * next read is local. Every client who existed at the migration was stamped,
 * so a reinstall never offers a finished setup again.
 *
 * Null when neither could be read: callers treat that as "don't nag".
 */
export async function readSetupDone(): Promise<boolean | null> {
  let local: string | null = null;
  try { local = await AsyncStorage.getItem(ONBOARD_KEY); } catch { /* fall through to the account */ }
  if (local) return true;
  if (!USE_SUPABASE) return false;
  try {
    const { data: u, error: authErr } = await supabase.auth.getUser();
    if (authErr || !u.user) return null;
    const { data, error } = await supabase.from('clients').select('onboarded_at').eq('id', u.user.id).maybeSingle();
    if (error) return null;
    const done = !!(data as { onboarded_at: string | null } | null)?.onboarded_at;
    if (done) AsyncStorage.setItem(ONBOARD_KEY, '1').catch(() => {});
    return done;
  } catch { return null; }
}
