// Reading and writing `notify_channel_prefs` — which categories of
// notification a coach has turned off.
//
// The rules are in src/lib/coachNotify.ts and are under test; this half touches
// supabase and so is deliberately not.
//
// ── Why this is a server table and not AsyncStorage ───────────────────────
//
// Because nothing on this device sends any of the notifications it governs.
// Every coach-directed push is remote — sent by another person's handset, by a
// trigger, or by an edge function — so a device-local preference would be a
// switch that reads "off" while the banner keeps arriving. The whole argument
// is in the header of src/lib/coachNotify.ts; the consequence here is that the
// write has to LAND before the switch may claim anything, which is why
// `setChannel` returns a boolean the caller must act on.
//
// ── An empty read is not "everything on" ──────────────────────────────────
//
// `{ rows: [], status: 'ready' }` genuinely means the coach has muted nothing.
// `{ rows: [], status: 'error' }` means we do not know, and `channelState`
// renders every switch as unread rather than as on. This file's only job in
// that distinction is to never return 'ready' for a read that did not happen.
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import { useCallback, useEffect, useState } from 'react';
import type { LoadStatus } from './loadStatus';
import { mutedFromRows, type CoachChannel, type MutedChannels } from '../lib/coachNotify';

export interface ChannelPrefsRead {
  muted: MutedChannels;
  status: LoadStatus;
}

/** Which channels this coach has turned off. */
export async function fetchChannelPrefs(): Promise<ChannelPrefsRead> {
  if (!USE_SUPABASE) return { muted: new Set(), status: 'ready' };
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return { muted: new Set(), status: 'ready' };
    const { data, error } = await supabase
      .from('notify_channel_prefs')
      .select('channel, enabled')
      .eq('user_id', uid);
    if (error) {
      // Includes 42P01 on a database that has not had this part applied. Both
      // that and a refusal are 'error', and 'error' shows five unread switches
      // rather than five switches in the on position.
      reportError('coachNotify.read', error);
      return { muted: new Set(), status: 'error' };
    }
    return { muted: mutedFromRows(data as any[]), status: 'ready' };
  } catch (e) {
    reportError('coachNotify.read', e);
    return { muted: new Set(), status: 'error' };
  }
}

/**
 * Turn one channel on or off.
 *
 * An upsert with the uid in the payload, so the row is created on first write
 * and the RLS `with check (user_id = auth.uid())` is what decides it may exist.
 *
 * Returns whether the server took it. A settings screen that cannot say "not
 * saved" will say "saved", and this is a switch whose whole purpose is to stop
 * a phone buzzing at 11pm — a coach who believes they muted chat and did not
 * concludes the switch does nothing and turns the master switch off instead,
 * which is the state this feature exists to get them out of.
 */
export async function setChannel(channel: CoachChannel, enabled: boolean): Promise<boolean> {
  if (!USE_SUPABASE) return false;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false;
    const { data, error } = await supabase
      .from('notify_channel_prefs')
      .upsert({ user_id: uid, channel, enabled }, { onConflict: 'user_id,channel' })
      .select('channel');
    if (error) { reportError('coachNotify.write', error); return false; }
    // `.select()` rather than trusting the absence of an error: PostgREST
    // resolves a write that matched and changed nothing without complaint, and
    // "saved" over a write that did nothing is the failure this return value
    // exists to prevent.
    return !!(data && data.length);
  } catch (e) {
    reportError('coachNotify.write', e);
    return false;
  }
}

/** The hook. Re-reads on a sign-in change, and on demand after a write. */
export function useChannelPrefs(): ChannelPrefsRead & { reload: () => Promise<void> } {
  const rev = useAuthRevision();
  const [read, setRead] = useState<ChannelPrefsRead>({ muted: new Set(), status: 'loading' });
  const reload = useCallback(async () => { setRead(await fetchChannelPrefs()); }, []);
  useEffect(() => {
    let alive = true;
    setRead({ muted: new Set(), status: 'loading' });
    void fetchChannelPrefs().then((r) => { if (alive) setRead(r); });
    return () => { alive = false; };
  }, [rev]);
  return { ...read, reload };
}
