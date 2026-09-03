// Blood glucose: reading it, importing it, and who is allowed to see it.
//
// Two callers, one hook. The client app passes no `personId` and gets their
// own readings plus the controls that go with owning them (import, type one
// in, delete, and the consent switch). The coach app passes a client's id and
// gets a read-only view that returns NOTHING unless that client has turned
// sharing on — which is enforced in the database, not here (see
// supabase/parts/102-glucose.sql). This hook cannot grant itself access it does
// not have; at most it can fail to ask.
//
// LoadStatus discipline applies with unusual force here. An empty list means
// "no readings" only under 'ready'. Under 'error' it means the read did not
// answer, and a screen that renders those the same way tells somebody wearing a
// CGM that their sensor recorded nothing — which is the one thing they would
// actually act on.
//
// ── A reading typed with no signal used to be a reading that never happened ─
//
// `addManual` caught the failure, returned false, and app/(client)/glucose.tsx
// said "that reading could not be saved". True, and the end of it: the number
// was gone, and a monitor reading is a thing somebody has exactly once. A typed
// reading passes `src/lib/outbox.ts`'s own admission rule — it is a write about
// the member's own record, nobody else can take it, it costs nothing and it
// carries no file — so it is now kept and sent on the reconnect, as 'glucose'.
// See src/lib/recordQueue.ts for why the health-store IMPORT is deliberately
// not queued alongside it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../lib/brands';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { worstStatus, type LoadStatus } from './loadStatus';
import {
  pairMeals, summarise, unsaved,
  type GlucoseReadStatus, type GlucoseReading, type GlucoseSummary, type MealGlucose, type MealRef,
} from '../lib/glucose';
import { glucoseSource } from '../lib/wearables/glucoseSource';
import { classifyWrite, type WriteOutcome } from '../lib/offlineQueue';
// `newRowId` is the id the row carries, minted on the device so that an insert
// whose answer was lost can be offered again without becoming a second reading.
import { newRowId } from '../lib/outbox';
import { keptOnPhoneNote, notKeptNote } from '../lib/recordQueue';
import { useOutbox } from './outbox';
import { useToast } from './toast';

/** How far back the screens look, and how far back the import reads. */
export const WINDOW_DAYS = 14;

/** PostgREST stops at 1000 rows without saying so — see src/lib/rowCap.ts. */
const ROW_CAP = 1000;

export interface GlucoseData {
  status: LoadStatus;
  readings: GlucoseReading[];
  summary: GlucoseSummary;
  /** Whether this person's coach may see these. Null while unknown. */
  sharedWithCoach: boolean | null;
  /**
   * Each meal in the window with the readings around it.
   *
   * Only as trustworthy as BOTH reads — a meal list that failed would show
   * readings with nothing to attribute them to, which reads as "you ate
   * nothing and spiked anyway". `pairedStatus` is the worse of the two.
   */
  paired: MealGlucose[];
  pairedStatus: LoadStatus;
  /** Re-read from the server. */
  refresh: () => Promise<void>;
  /**
   * Pull anything new out of the phone's health store and save it. Own
   * readings only.
   *
   * `status` is carried out alongside the count because "nothing was added" has
   * four different causes and the screen says a different thing for each — a
   * store this build cannot read ('unsupported'), a person who declined
   * ('denied'), a step that did not answer ('error', whether that was the
   * store or the save), and a window that genuinely holds nothing new
   * ('ready'). Returning only a count and a sentence made the first three look
   * like the fourth.
   */
  importFromHealth: () => Promise<{ added: number; status: GlucoseReadStatus; reason?: string }>;
  /**
   * Store one reading somebody typed. mmol/L.
   *
   * True once the row is on the server, and also true once it has been kept on
   * this phone to be sent later — both mean the reading was not lost, which is
   * what the screen's alert is about. A queued reading is SAID through the toast
   * rather than drawn on the chart: see the implementation.
   */
  addManual: (mmol: number, at?: string) => Promise<boolean>;
  /** Remove one. Only the owner can, and the database agrees. */
  remove: (id: string) => Promise<boolean>;
  /** Turn coach visibility on or off. Owner only; a coach calling this is refused. */
  setShared: (on: boolean) => Promise<boolean>;
  /** True when this hook is looking at somebody else's readings. */
  readOnly: boolean;
}

interface Row {
  id: string;
  taken_at: string;
  mmol_l: number | string;
  external_id: string | null;
  source: string;
}

function toReading(r: Row): GlucoseReading {
  return {
    id: r.id,
    at: r.taken_at,
    mmol: Number(r.mmol_l),
    externalId: r.external_id,
    // The writing app's name is not stored — it is the health store's, not
    // ours to keep — so a stored reading says only that it came from one.
    //
    // NOT 'Apple Health', which is what this said until Health Connect landed.
    // The column records that a reading came from the phone's health store and
    // not WHICH store, so naming Apple on a row a Pixel imported out of Health
    // Connect would have been the screen inventing a provenance — and a coach
    // reading a shared history sees these rows too, on whatever phone they
    // happen to be holding.
    sourceName: r.source === 'health' ? 'Health' : null,
  };
}

/**
 * @param personId whose readings to read. Undefined means the signed-in
 *   account's own — which is the only case that may write.
 */
export function useGlucose(personId?: string): GlucoseData {
  const [uid, setUid] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [shared, setShared] = useState<boolean | null>(null);
  const [meals, setMeals] = useState<MealRef[]>([]);
  const [mealsStatus, setMealsStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const readOnly = !!personId;
  // The device's queue, for the one write here that is allowed to wait. Null
  // when there is no provider above the screen, which is a real state and not an
  // error — see `useOutbox`.
  const outbox = useOutbox();
  // The quiet channel. A queued reading has to be SAID, because it is the one
  // outcome the screen cannot show: the chart is the evidence and the reading is
  // not on the server yet, so without a line the member is left looking at a
  // table that has not changed. `useToast` returns a working no-op outside a
  // provider, so this is safe on every screen that calls this hook.
  const { say } = useToast();

  // Who "their own readings" means, settled before any read is attempted.
  //
  // This was a bare `supabase.auth.getUser()`. That call goes to the NETWORK to
  // revalidate the token, and with no signal it does not throw — it resolves
  // with `user: null` behind an AuthRetryableFetchError. So `uid` stayed null,
  // `target` stayed null, and all three refreshers below returned at their
  // `if (!target)` guard without ever writing a status. Both statuses start at
  // 'loading', this effect has no retry, and the screen has no pull-to-refresh,
  // so Blood Sugar sat on "Still loading." for the entire session — on the one
  // screen where "we could not read this" and "your sensor recorded nothing"
  // must never look the same, shown to somebody wearing a CGM.
  //
  // getSession() reads the session already stored on the device and answers
  // offline, which is why every other provider in this folder fronts getUser()
  // with it — see foodLog.tsx, habits.tsx and coachNutrition.tsx. foodLog takes
  // the id straight off that session rather than round-tripping for it, and so
  // does this: the id only ever picks which rows to ask for, and which rows the
  // account may actually have is decided by row-level security, not here.
  //
  // A coach reading a client (personId set) never needed this — `target` is the
  // id they were handed — so the effect leaves their statuses to the reads.
  useEffect(() => {
    if (personId) return;
    let alive = true;
    (async () => {
      let session: { user?: { id?: string } } | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        session = (data?.session as { user?: { id?: string } } | null) ?? null;
      } catch { /* no session on this device; handled as signed out below */ }
      if (!alive) return;
      const id = session?.user?.id ?? null;
      setUid(id);
      // Nobody is signed in, or the backend is off. There is no account whose
      // readings could have been withheld, so an empty list here is the whole
      // truth rather than a read that failed — and a status left on 'loading'
      // is a screen that spins for ever, which is the failure this replaces.
      if (!id || !USE_SUPABASE) { setStatus('ready'); setMealsStatus('ready'); }
    })();
    return () => { alive = false; };
  }, [personId]);

  const target = personId ?? uid;

  const refresh = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);
    const { data, error } = await supabase
      .from('glucose_readings')
      .select('id, taken_at, mmol_l, external_id, source')
      .eq('client_id', target)
      .gte('taken_at', since.toISOString())
      .order('taken_at', { ascending: false })
      .limit(ROW_CAP);

    if (error) {
      // The rows we already had are kept — they were real — but the status says
      // they are no longer confirmed current. It does NOT become an empty list.
      setStatus('error');
      return;
    }
    setRows((data ?? []) as Row[]);
    // A full page is indistinguishable from a truncated one, so it is reported
    // as partial: the list may be shown, an average over it may not.
    setStatus((data ?? []).length >= ROW_CAP ? 'partial' : 'ready');
  }, [target]);

  // The consent flag. Read for both callers, because the coach screen needs to
  // say "they have not shared this" rather than "there are no readings" — two
  // sentences that would otherwise be the same empty list.
  const refreshShared = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const { data, error } = await supabase
      .from('clients')
      .select('glucose_shared')
      .eq('id', target)
      .maybeSingle();
    // maybeSingle, not single: a coach reading their own row has none, and
    // PGRST116 on a missing row is what put the whole coach app into 'error'
    // once already.
    if (error) { setShared(null); return; }
    setShared(data ? !!data.glucose_shared : null);
  }, [target]);

  // The meals the readings are lined up against. The coach's copy of this read
  // is governed by `food_trainer_read`, which is NOT conditional on the glucose
  // consent — a coach has always been able to see their client's food log. The
  // consent gates the readings, and without readings the pairing shows meals
  // with nothing beside them, which is the correct outcome rather than a leak.
  const refreshMeals = useCallback(async () => {
    if (!USE_SUPABASE || !target) return;
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);
    const { data, error } = await supabase
      .from('food_logs')
      .select('id, name, logged_at, carbs')
      .eq('client_id', target)
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false })
      .limit(ROW_CAP);
    if (error) { setMealsStatus('error'); return; }
    setMeals((data ?? []).map((m: any) => ({
      id: String(m.id), name: String(m.name), loggedAt: String(m.logged_at),
      carbs: m.carbs == null ? null : Number(m.carbs),
    })));
    setMealsStatus((data ?? []).length >= ROW_CAP ? 'partial' : 'ready');
  }, [target]);

  useEffect(() => { void refresh(); void refreshShared(); void refreshMeals(); }, [refresh, refreshShared, refreshMeals]);

  const readings = useMemo(() => rows.map(toReading), [rows]);
  const summary = useMemo(() => summarise(readings), [readings]);
  const paired = useMemo(() => pairMeals(meals, readings), [meals, readings]);
  const pairedStatus = useMemo(() => worstStatus(status, mealsStatus), [status, mealsStatus]);

  const importFromHealth = useCallback(async (): Promise<{ added: number; status: GlucoseReadStatus; reason?: string }> => {
    if (readOnly) return { added: 0, status: 'unsupported', reason: 'These are not your readings to import.' };
    if (!target) return { added: 0, status: 'error', reason: 'Not signed in.' };

    // No platform branch here any more, and that is the change rather than a
    // simplification: iOS reads Apple Health, Android reads Health Connect,
    // and both hand back the same GlucoseRead. `glucoseSource()` is the one
    // place that knows which is which — see src/lib/wearables/glucoseSource.ts.
    const read = await glucoseSource().fetchGlucose(WINDOW_DAYS);
    if (read.status !== 'ready') return { added: 0, status: read.status, reason: read.reason };

    const fresh = unsaved(read.readings, rows.map((r) => r.external_id).filter((x): x is string => !!x));
    if (fresh.length === 0) return { added: 0, status: 'ready' };

    // `{ count: 'exact' }`, and the count is what is reported.
    //
    // This used to return `fresh.length` — the number of rows it TRIED to write
    // — and treat a 23505 as a partial success, on the reasoning that "the
    // colliding rows are already stored". That reasoning is wrong about
    // Postgres: an insert of many rows is ONE statement, so a single collision
    // with `glucose_external_once` aborts the whole batch and NOTHING lands.
    // The member was then shown "Imported — 40 readings added." over a table
    // that had gained nothing, and with `glucose_readings` empty an import is
    // the only way anything ever reaches this screen, so that alert was the
    // entire evidence they had. `remove` and `setSharedFlag` twenty lines below
    // have counted their rows since they were written; this was the one write
    // in the file that asked the server nothing.
    const { error, count } = await supabase.from('glucose_readings').insert(
      fresh.map((r) => ({ client_id: target, taken_at: r.at, mmol_l: r.mmol, external_id: r.externalId, source: 'health' })),
      { count: 'exact' },
    );
    if (error) {
      // A collision means these readings are already here — which is a fine
      // outcome and not a fault, but it is not "added" either, and saying so is
      // what stops somebody importing again and again to fix a number that was
      // never going to move.
      if (error.code === '23505') {
        await refresh();
        return { added: 0, status: 'ready', reason: `Those readings are already in ${BRAND.label}, so nothing new was added.` };
      }
      return { added: 0, status: 'error', reason: 'Those readings could not be saved. Try again in a moment.' };
    }
    await refresh();
    // A null count is "nobody counted", not "none" — the same rule
    // src/lib/wroteRows.ts states for updates and deletes.
    if (count == null) {
      return { added: 0, status: 'error', reason: 'They were sent, but the server did not say how many it stored. Pull down to refresh and check before importing again.' };
    }
    return { added: count, status: 'ready' };
  }, [readOnly, target, rows, refresh]);

  /**
   * One reading somebody typed.
   *
   * True once the row is on the server OR once the write has been kept on this
   * phone to be sent later. The two are one answer to the screen — the reading
   * was not lost — and `say` is what tells them apart, because a queued reading
   * deliberately does NOT appear on the chart yet: the chart is the evidence,
   * and a reading drawn on it before the server has it is the app showing
   * somebody a record that does not exist.
   *
   * `taken_at` is carried, so a reading typed in a basement and sent an hour
   * later sits against the meal it actually followed rather than the one it was
   * sent after.
   */
  const addManual = useCallback(async (mmol: number, at?: string): Promise<boolean> => {
    if (readOnly || !target) return false;
    const taken = at ?? new Date().toISOString();
    /**
     * The row's own id, chosen here and used by BOTH writes below.
     *
     * That is the whole of the fix and the reason it has to be one id rather
     * than one per attempt. The failure is at-least-once delivery: the insert
     * below reaches Postgres, the row is written, and the response is lost on
     * the way back — a tunnel, a handover, the app backgrounded mid-request.
     * The catch calls that 'unsent', correctly, and the reading is queued; the
     * queue then offers it again and the member gets two points on the chart
     * for one finger-prick.
     *
     * `glucose_external_once` cannot catch it: it is partial on
     * `external_id is not null`, and supabase/parts/102 is explicit that a
     * hand-typed reading may repeat freely — which is right for somebody typing
     * and wrong for a replay. The primary key is what tells the two apart, so
     * the second offer of THIS row collides on it and `sendGlucose` reads the
     * 23505 for what it is.
     */
    const rowId = newRowId();
    let out: WriteOutcome;
    try {
      // `.select('id')` and a counted outcome. An insert PostgREST narrows to
      // zero rows under RLS does not fail — it succeeds having done nothing —
      // and this was the one write in this file still reading only `error`,
      // which is the bug `remove` and `setSharedFlag` were already written
      // against.
      const { data, error } = await supabase.from('glucose_readings').insert({
        id: rowId, client_id: target, taken_at: taken, mmol_l: mmol, external_id: null, source: 'manual',
      }).select('id');
      out = classifyWrite(error as any, data ? data.length : 0);
    } catch { out = 'unsent'; }
    if (out === 'stored') { await refresh(); return true; }
    // 'refused' is the server having read the row and declined it. Offering the
    // same bytes again gets the same answer, so it is not queued and the screen
    // says it was not saved.
    if (out === 'refused') return false;
    if (!outbox) return false;
    // The SAME id the insert above offered. A different one here would be a
    // different row and the replay would duplicate exactly as before.
    const { result } = await outbox.enqueue('glucose', { id: rowId, mmol, at: taken });
    if (result !== 'queued') { say(notKeptNote('reading', result === 'full' ? 'full' : 'unavailable')); return false; }
    say(keptOnPhoneNote('reading'));
    return true;
  }, [readOnly, target, refresh, outbox, say]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    if (readOnly || !target) return false;
    // An UPDATE or DELETE that matches zero rows is not an error in PostgREST,
    // so the count is checked rather than the absence of an error object —
    // this is the bug class that has bitten every write in this codebase.
    const { error, count } = await supabase
      .from('glucose_readings').delete({ count: 'exact' })
      .eq('id', id).eq('client_id', target);
    if (error || !count) return false;
    await refresh();
    return true;
  }, [readOnly, target, refresh]);

  const setSharedFlag = useCallback(async (on: boolean): Promise<boolean> => {
    if (readOnly || !target) return false;
    const { error, count } = await supabase
      .from('clients').update({ glucose_shared: on }, { count: 'exact' })
      .eq('id', target);
    if (error || !count) return false;
    setShared(on);
    return true;
  }, [readOnly, target]);

  return {
    status, readings, summary, sharedWithCoach: shared, paired, pairedStatus,
    refresh, importFromHealth, addManual, remove, setShared: setSharedFlag, readOnly,
  };
}
