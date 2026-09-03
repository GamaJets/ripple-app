// The HRV a device measured, kept, so the figure has something to mean.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// src/lib/hrvTrend.ts holds the rules and the argument; supabase/parts/720 is
// the table. This is the wire between them: read what is kept, write what a
// device measured tonight, and hand a screen a trend rather than a bare number.
//
// It is a hook rather than a provider because exactly one screen prints HRV —
// app/(client)/devices.tsx — and a provider wrapping the whole app to serve one
// list row is a mount cost every launch pays for a screen most members never
// open. If Recovery ever prints it too, this becomes a provider and the two
// screens read the same one, the way src/ui/deviceSleep.tsx already works;
// what must not happen is a second copy of these rules on the second screen.
//
// ── The order, which is the same order sleep settled on ───────────────────
//
// The kept nights are read FIRST and separately, so the baseline is on screen
// while the providers are still being walked, and so it is still on screen when
// one of them cannot be reached at all. `status` says which is being looked at:
// under 'error' an empty list means we could not find out what this member's
// history is, never that they have none.
//
// ── Ahead of the migration ────────────────────────────────────────────────
//
// Part 720 has not been applied. A read against a table that does not exist
// comes back 42P01, which lands in the `error` branch below — so today the
// screen shows tonight's figure with no trend beside it and says the history
// could not be read, which is honest and is roughly what a member's first week
// looks like anyway. Nothing here throws and nothing renders a baseline of
// zero.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { PROVIDERS } from '../lib/wearables/registry';
import { recentNights } from '../lib/sleepMerge';
import {
  BASELINE_NIGHTS, hrvBaseline, hrvNightToRow, hrvTrendOf, rowToHrvNight,
  type HrvBaseline, type HrvNight, type HrvTrend,
} from '../lib/hrvTrend';
import type { ProviderId } from '../lib/wearables/types';
import type { LoadStatus } from './loadStatus';
import { useWearables } from './wearables';
import { useAuthRevision } from './authRevision';

export interface DeviceHrvValue {
  /** What a connected device reported for the most recent night, or null when
   *  none did. One device's figure, named — never an average of two. */
  tonight: HrvNight | null;
  /** The nights already kept for this account, newest first. */
  nights: HrvNight[];
  /** Of the KEPT nights. 'error' means the history could not be read, which is
   *  not the same as the member not having one. */
  status: LoadStatus;
  baseline: HrvBaseline | null;
  /** Where tonight sits against that baseline. Null whenever either half is
   *  missing — never a 'typical' standing in for "we do not know". */
  trend: HrvTrend | null;
  /** How many kept nights are behind the baseline, for the sentence a member
   *  without one is shown. */
  nightsKept: number;
  /** Read the kept nights again. A real re-read of `hrv_nights` — the status
   *  goes back through whatever the server says — so the one screen that
   *  prints HRV can refresh the baseline and the trend along with everything
   *  else on it. */
  reload: () => Promise<void>;
}

/**
 * Which device's figure to print, when more than one answers.
 *
 * Registry order, and the first that reported one. Deliberately not an average
 * and not a maximum: app/(client)/devices.tsx promises, about sleep, that the
 * app "never averages them into a number no device recorded", and there is no
 * reason for HRV to keep a different promise on the same screen. A maximum
 * would be a quiet way of always reporting the member's best strap, which is a
 * verdict rather than a measurement.
 */
function tonightFrom(
  states: Record<string, string>,
  metrics: Record<string, { date: string; hrv: number | null } | null>,
): HrvNight | null {
  for (const p of PROVIDERS) {
    if (states[p.meta.id] !== 'connected') continue;
    const m = metrics[p.meta.id];
    const ms = m?.hrv;
    if (m == null || ms == null || !Number.isFinite(ms) || ms <= 0) continue;
    const night = /^\d{4}-\d{2}-\d{2}$/.test(String(m.date)) ? String(m.date) : recentNights(1)[0];
    return { night, ms: Math.round(ms * 10) / 10, provider: p.meta.id as ProviderId, sourceName: p.meta.name };
  }
  return null;
}

export function useDeviceHrv(): DeviceHrvValue {
  const wear = useWearables();
  const authRev = useAuthRevision();
  const [nights, setNights] = useState<HrvNight[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  // What has already been sent, so a re-render does not re-send it. Keyed by
  // night AND figure, because a REVISED night must go up again — WHOOP
  // re-scores a night once its processing catches up, and pinning the first
  // figure we saw would leave the app disagreeing with the vendor's own screen.
  const sentRef = useRef<Set<string>>(new Set());

  const tonight = useMemo(
    () => tonightFrom(wear.states as Record<string, string>, wear.metrics as any),
    [wear.states, wear.metrics],
  );

  const load = useCallback(async () => {
    let id: string | null = null;
    try {
      // getSession() reads local storage rather than the network, and REJECTS
      // for nobody signed in — which is a true answer, not a failed read.
      const { data: sess } = await supabase.auth.getSession();
      id = sess?.session?.user?.id ?? null;
    } catch { /* no local session; treated as signed out below */ }
    sentRef.current = new Set();
    // Signed out, or a build with no backend: there is no history to read and
    // no absent server to misreport. 'ready' with nothing in it.
    if (!id || !USE_SUPABASE) { setUid(null); setNights([]); setStatus('ready'); return; }
    setUid(id);
    const floor = recentNights(BASELINE_NIGHTS).slice(-1)[0] ?? '';
    const { data, error } = await supabase.from('device_hrv_nights')
      .select('night, hrv_ms, provider, source_name')
      .eq('user_id', id)
      .gte('night', floor)
      .order('night', { ascending: false });
    if (error) {
      // The kept nights stay as they were and `status` records that they were
      // not checked. Clearing them here would take the member's baseline off
      // the screen, which is the disappearance the table exists to stop.
      reportError('deviceHrv.stored', error);
      setStatus('error');
      return;
    }
    setNights((data ?? []).map(rowToHrvNight).filter((n): n is HrvNight => n != null));
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  // ── Keeping what was measured ────────────────────────────────────────────
  //
  // Only after a read that actually succeeded — writing before we know what is
  // there is how a revision gets sent on every render — and only a figure a
  // named device really reported.
  useEffect(() => {
    if (!USE_SUPABASE || !uid || status !== 'ready' || !tonight) return;
    const key = `${tonight.night}:${tonight.ms}`;
    if (sentRef.current.has(key)) return;
    let cancelled = false;
    (async () => {
      const { error } = await supabase.from('device_hrv_nights')
        .upsert([hrvNightToRow(uid, tonight)], { onConflict: 'user_id,night' });
      if (error) {
        // Not fatal and not silent. Tonight's figure is correct on screen
        // either way; what is lost is its durability, and the next launch that
        // reaches the server tries again because `sentRef` was never marked.
        reportError('deviceHrv.keep', error);
        return;
      }
      if (cancelled) return;
      sentRef.current.add(key);
      // Held locally rather than re-read. A second read would be a second
      // answer to a question we have just answered, and the two can disagree
      // for a moment while PostgREST catches up.
      setNights((prev) => [tonight, ...prev.filter((n) => n.night !== tonight.night)]);
    })();
    return () => { cancelled = true; };
  }, [uid, status, tonight]);

  const baseline = useMemo(
    () => hrvBaseline(nights, tonight?.night ?? recentNights(1)[0]),
    [nights, tonight],
  );
  const trend = useMemo(() => hrvTrendOf(tonight?.ms ?? null, baseline), [tonight, baseline]);
  // The count behind the baseline, excluding tonight — the same set
  // `hrvBaseline` looks at, so the sentence about "3 of 7 nights" cannot
  // disagree with the reason there is no trend.
  const nightsKept = useMemo(() => {
    const t = tonight?.night ?? recentNights(1)[0];
    return new Set(nights.filter((n) => n.night !== t).map((n) => n.night)).size;
  }, [nights, tonight]);

  return { tonight, nights, status, baseline, trend, nightsKept, reload: load };
}
