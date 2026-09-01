// Pausing a standing appointment, from the client's phone.
//
// The reads and the two writes for supabase/parts/244. Every sentence a member
// sees is in src/lib/reschedule.ts instead, so it can be asserted under
// `npm test` without a device; nothing here composes copy.
//
// ── What a pause is ──────────────────────────────────────────────────────
//
// A HOLE in the arrangement: a date range this series does not run. Several may
// exist at once — a fortnight in June and a week in September are two holes,
// not a status that gets overwritten — which is why they are rows and not two
// columns on the series.
//
// The hole is read by the materialiser, so it survives part 135's daily run.
// Without that half, a member's cancelled fortnight quietly re-books itself the
// next morning, which is the whole reason pausing could not be built out of the
// cancellation that already existed.
//
// ── What it costs, and why none of that is decided here ─────────────────
//
// Removing an already-booked occurrence IS a cancellation and is priced like
// one. `pause_my_session_series` calls `cancel_my_session` per occurrence, so
// the coach's notice window, the fee, the currency snapshot and the waitlist
// promotion all happen exactly once, in the one place in this database that
// knows about any of them. This module reports what that came to and decides
// nothing about it.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';
import type { PauseReport } from '../lib/reschedule';

/** One hole, as the screen holds it. Dates are LOCAL dates in the series' own
 *  zone (`YYYY-MM-DD`), never instants — a range stored as instants would move
 *  by an hour twice a year and take a Tuesday with it. */
export interface SeriesPause {
  id: string;
  seriesId: string;
  fromOn: string;
  toOn: string;
  reason: string | null;
}

/**
 * Every pause on every arrangement this member is part of.
 *
 * Read whole rather than per series: a member has one or two standing
 * appointments and at most a handful of holes, and one read the screen can
 * report a single status for beats N reads it cannot.
 *
 * `status` is the point. An empty list under 'error' means UNKNOWN, and a
 * screen that reads it as "nothing is paused" would show a member their
 * Tuesdays as running while they are away.
 */
export function useSeriesPauses(): { pauses: SeriesPause[]; status: LoadStatus; reload: () => Promise<void> } {
  const authRev = useAuthRevision();
  const [pauses, setPauses] = useState<SeriesPause[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async () => {
    // With no server there are no arrangements and therefore no pauses. 'ready'
    // with an empty list is the complete answer, not a fabricated one.
    if (!USE_SUPABASE) { setPauses([]); setStatus('ready'); return; }
    try {
      const { data, error } = await supabase
        .from('session_series_skips')
        .select('id, series_id, from_on, to_on, reason')
        .order('from_on', { ascending: true });
      if (error) { reportError('seriesPause.load', error); setStatus('error'); return; }
      setPauses(((data ?? []) as any[]).map((r) => ({
        id: String(r.id),
        seriesId: String(r.series_id),
        fromOn: String(r.from_on),
        toOn: String(r.to_on),
        reason: typeof r.reason === 'string' && r.reason ? r.reason : null,
      })));
      setStatus('ready');
    } catch (e) {
      reportError('seriesPause.load', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  return { pauses, status, reload: load };
}

/** The server's report, read once. Split out because two entry points return
 *  the same jsonb and a second copy of this is a second place for a fee to be
 *  read wrong. */
function readPauseReport(data: unknown): PauseReport {
  const r = data as any;
  return {
    skipId: r?.skip_id ? String(r.skip_id) : null,
    fromOn: r?.from_on ? String(r.from_on) : null,
    toOn: r?.to_on ? String(r.to_on) : null,
    freed: Number(r?.freed) || 0,
    charged: Number(r?.charged) || 0,
    // Postgres `numeric` arrives as a string through PostgREST often enough
    // that Number(null) === 0 is a live hazard here: this is a fee, and a 0
    // printed for "we could not read it" is the whole class of bug this
    // codebase keeps finding.
    fees: r?.fees == null ? null : (Number.isFinite(Number(r.fees)) ? Number(r.fees) : null),
    currency: typeof r?.currency === 'string' ? r.currency : null,
    mixedCurrencies: !!r?.mixed_currencies,
    notFreed: Number(r?.not_freed) || 0,
  };
}

/**
 * Pause one arrangement for a range of local dates.
 *
 * Resolves null when the call did not land at all, which is different from a
 * pause that happened and cost nothing — the caller must not print an outcome
 * for a write it cannot confirm. Every other refusal comes back as a raised
 * exception from the function, which is caught here and reported as null for
 * the same reason.
 */
export async function pauseSeries(
  seriesId: string,
  fromOn: string,
  toOn: string,
  reason: string | null,
): Promise<{ report: PauseReport | null; error: string | null }> {
  if (!USE_SUPABASE) {
    return { report: null, error: 'This build has no server, so nothing can be paused on it.' };
  }
  try {
    const { data, error } = await supabase.rpc('pause_my_session_series', {
      p_series: seriesId,
      p_from: fromOn,
      p_to: toOn,
      p_reason: reason && reason.trim() ? reason.trim() : null,
    });
    if (error || !data) {
      reportError('seriesPause.pause', error ?? new Error('pause_my_session_series returned nothing'));
      return {
        report: null,
        error: error?.message
          || 'That did not save, so nothing has been paused and your sessions are still booked.',
      };
    }
    return { report: readPauseReport(data), error: null };
  } catch (e: any) {
    reportError('seriesPause.pause', e);
    return { report: null, error: e?.message || 'That did not reach the server, so nothing has been paused.' };
  }
}

/**
 * Lift one pause, and write the arrangement back out at once.
 *
 * `resumed: false` from the server is a refusal, not a failure: the pause is
 * not this member's, or it has already been lifted somewhere else. PostgREST
 * reports a delete that matched nothing as a success, which is how "resumed"
 * gets printed over a pause that is still in place, so the function counts and
 * this reads its answer rather than the absence of an error.
 */
export async function resumeSeries(skipId: string): Promise<{ resumed: boolean; created: number; error: string | null }> {
  if (!USE_SUPABASE) {
    return { resumed: false, created: 0, error: 'This build has no server, so there is nothing to resume on it.' };
  }
  try {
    const { data, error } = await supabase.rpc('resume_my_session_series', { p_skip: skipId });
    if (error || !data) {
      reportError('seriesPause.resume', error ?? new Error('resume_my_session_series returned nothing'));
      return { resumed: false, created: 0, error: 'That did not save, so those dates are still paused.' };
    }
    const r = data as any;
    if (!r.resumed) {
      return {
        resumed: false, created: 0,
        error: 'Nothing was resumed. Open this screen again — that pause may already have been lifted somewhere else.',
      };
    }
    return { resumed: true, created: Number(r.created) || 0, error: null };
  } catch (e) {
    reportError('seriesPause.resume', e);
    return { resumed: false, created: 0, error: 'That did not reach the server, so those dates are still paused.' };
  }
}

/**
 * Pause for N days from today, letting the SERVER decide which dates those are.
 *
 * The dates are deliberately not computed here. "Today" for a standing
 * appointment is today IN THE ARRANGEMENT'S OWN ZONE — the zone `occurrence_on`
 * is a date in — and a member on holiday in Sydney pausing a London Tuesday
 * would send Sydney's date and pause the wrong dates at both ends. The device
 * cannot get that right without knowing the series' zone, and the server
 * already does (`pause_my_session_series_for`, supabase/parts/244).
 */
export async function pauseSeriesForDays(
  seriesId: string,
  days: number,
  reason: string | null,
): Promise<{ report: PauseReport | null; error: string | null }> {
  if (!USE_SUPABASE) {
    return { report: null, error: 'This build has no server, so nothing can be paused on it.' };
  }
  try {
    const { data, error } = await supabase.rpc('pause_my_session_series_for', {
      p_series: seriesId,
      p_days: days,
      p_reason: reason && reason.trim() ? reason.trim() : null,
    });
    if (error || !data) {
      reportError('seriesPause.pauseForDays', error ?? new Error('pause_my_session_series_for returned nothing'));
      return {
        report: null,
        error: error?.message
          || 'That did not save, so nothing has been paused and your sessions are still booked.',
      };
    }
    return { report: readPauseReport(data), error: null };
  } catch (e: any) {
    reportError('seriesPause.pauseForDays', e);
    return { report: null, error: e?.message || 'That did not reach the server, so nothing has been paused.' };
  }
}
