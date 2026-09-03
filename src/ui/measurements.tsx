// Body measurements (cm) the client logs over time, complementing InBody scans.
// Persists to Supabase `measurements` (one row per body-part per date) with a
// hydrate-only: an empty result is an empty history, never a cue to seed.
//
// That rule was right and stays. What was missing is that a FAILED read reached
// the same `entries: []` by a different route, and the measurements screen then
// showed its "log your first measurement" empty state to a client with months of
// history — inviting them to start again from nothing and lose the trend the
// screen exists to show. `status` separates the two.
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { classifyWrite } from '../lib/offlineQueue';
// The id each measurement row carries, minted on the device so that a queued
// insert offered twice cannot become two mornings with a tape. See
// `entryToRows`.
import { newRowId } from '../lib/outbox';
// The half of an optimistic insert that was missing: taking the row back when
// the account refuses it.
import { settleOptimistic } from '../lib/optimisticList';
import { useOutbox } from './outbox';
import { useAuthRevision } from './authRevision';
import { dateParts } from '../lib/localDate';

export interface MeasureEntry {
  id: string; at: string;
  waist?: number; chest?: number; arm?: number; thigh?: number; hips?: number;
  armL?: number; armR?: number; thighL?: number; thighR?: number;
  calf?: number; neck?: number; shoulders?: number;
}

/**
 * The sites a member can record, in the order their screen lists them.
 *
 * ── Why `arm` and `thigh` survive alongside `armL` and `armR` ──────────────
 *
 * Five sites shipped originally — waist, chest, arm, thigh, hips — with no side
 * on the two that have one. Anybody who has been taping a bicep for a year has
 * it filed under `arm` with no record of which arm it was, and `kind` is a bare
 * text column so those rows are simply the string 'arm'.
 *
 * Renaming or folding them is the tempting tidy-up and it is the destructive
 * one: an existing `arm` row has no side, we cannot invent one, and assigning
 * it to the right arm because most people are right-handed would silently put a
 * year of somebody's left-arm measurements onto the wrong limb's chart. So the
 * unqualified sites stay, labelled as what they are, and the sided ones are new
 * rows a member starts when they want the distinction. A member who never wants
 * it goes on using the row they always used.
 *
 * Nothing here has a check constraint behind it — `measurements.kind` is plain
 * text (supabase/parts/02) — so adding a site needs no migration, and the
 * mirror in src/lib/clientMeasurements.ts is kept in step by hand for the
 * reason its own comment gives.
 */
export type MetricKey = keyof Omit<MeasureEntry, 'id' | 'at'>;

export const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'neck', label: 'Neck' },
  { key: 'hips', label: 'Hips' },
  { key: 'arm', label: 'Arm' },
  { key: 'armL', label: 'Left Arm' },
  { key: 'armR', label: 'Right Arm' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'thighL', label: 'Left Thigh' },
  { key: 'thighR', label: 'Right Thigh' },
  { key: 'calf', label: 'Calf' },
];

let SEQ = 1;

/**
 * The LOCAL calendar day a measurement belongs to.
 *
 * This was `iso.slice(0, 10)`, which takes the first ten characters of a UTC
 * timestamp minted by `new Date().toISOString()` — so a member in Dubai taping
 * at 02:00 was filed under yesterday, and one in New York taping at 20:00 was
 * filed under tomorrow. `measurements.taken_at` is a bare postgres DATE and
 * app/(client)/measurements.tsx reads it back through `localDate` precisely
 * because a bare date means a calendar day in the reader's own life. The write
 * side has to mean the same thing, or the read renders the wrong day faithfully
 * and "vs 3 Aug" on the change row is measured from the wrong baseline.
 *
 * `dateParts` returns a MONTH INDEX, hence the +1.
 */
const dateOf = (iso: string): string => {
  const p = dateParts(iso);
  if (!p) return String(iso).slice(0, 10);
  return `${p[0]}-${String(p[1] + 1).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
};
// group flat rows [{taken_at, kind, value}] into MeasureEntry per date
function rowsToEntries(rows: any[]): MeasureEntry[] {
  const byDate: Record<string, MeasureEntry> = {};
  for (const r of rows) {
    const d = r.taken_at as string;
    byDate[d] = byDate[d] || { id: 'm-' + d, at: d };
    (byDate[d] as any)[r.kind] = Number(r.value);
  }
  return Object.values(byDate).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
/**
 * The rows one tape measurement becomes — one per site, each carrying its own
 * id.
 *
 * ── Why the id is minted here rather than by the server ──────────────────
 *
 * `measurements` has a uuid primary key and NO unique index on
 * (user_id, taken_at, kind) — supabase/parts/02, and it is right not to have
 * one, because a member correcting a figure on the same day is an ordinary
 * thing to do. The consequence is that nothing at all makes this write
 * idempotent, and this is a QUEUED write: the insert reaches Postgres, the rows
 * are written, and the response is lost on the way back. `classifyWrite`
 * correctly calls that 'unsent', the measurement stays in the outbox, and the
 * next flush offers it again — filing a second set of rows for one morning with
 * a tape.
 *
 * They are invisible, which is the part that makes this worth fixing rather
 * than tolerating: `rowsToEntries` groups by `taken_at` and the last row of a
 * kind wins, so the screen draws one entry either way and nobody can see the
 * duplicate to delete it. It eats the read's cap, and an edit of that day has
 * two rows to choose between.
 *
 * The id costs nothing on the way in and makes the second offer a 23505 on the
 * primary key, which the handler reads for what it is. Same fix, same reason,
 * as `ScanIntent` and `GlucoseIntent`.
 */
function entryToRows(uid: string, e: MeasureEntry) {
  const rows: any[] = [];
  for (const { key } of METRICS) { const v = e[key]; if (typeof v === 'number') rows.push({ id: newRowId(), user_id: uid, taken_at: dateOf(e.at), kind: key, value: v }); }
  return rows;
}

/**
 * What became of a tape measurement.
 *
 * 'stored'   the rows are on the server.
 * 'queued'   nobody answered. The measurement is on this phone, in the outbox,
 *            and it goes up when there is signal — under the timestamp it was
 *            TAKEN, not the one it is sent at, which is what stops a Tuesday
 *            measurement landing on Thursday's chart.
 * 'refused'  the server read it and declined, or there was nothing to write, or
 *            this device could not keep it. Nothing is waiting and the caller
 *            has to say so.
 */
export type MeasureOutcome = 'stored' | 'queued' | 'refused';

interface MeasureValue {
  entries: MeasureEntry[];
  /** Whether `entries` is the server's answer. Under 'error' an empty list
   *  means the history could not be read, not that there is none. */
  status: LoadStatus;
  /**
   * Read again from the server.
   *
   * A real re-read, not a state reset: it bumps the key the load effect below
   * is keyed on, so the same query runs and `status` goes back through
   * 'loading' to whatever the server answers this time. Nothing local is
   * cleared and nothing pending is dropped, so a refused re-read leaves what is
   * on screen exactly where it was with the status saying it is not confirmed.
   *
   * Added for the pull-to-refresh gesture on the screens this provider feeds:
   * without it those screens could show a failed read for the whole session
   * with no way to ask again.
   */
  reload: () => void;
  /**
   * Correct one figure on one day.
   *
   * ── Why this exists ───────────────────────────────────────────────────
   *
   * `addEntry` and `reload` were the whole of this provider's surface. A tape
   * measurement is the hero figure of its screen, the baseline every "since"
   * is computed against, a row in the summary a member hands a clinician, and
   * one of the things a coach programmes from — and a waist typed as 8.4
   * instead of 84 was permanent. The member's only options were to leave it or
   * to log a second wrong figure to average it out. The scans screen next door
   * has had `updateScan` and `deleteScan` all along.
   *
   * The DATE is preserved, because that is the whole point: re-logging puts a
   * corrected figure on today and leaves the trend bent around the day the
   * mistake was actually made.
   *
   * Resolves false when the write did not land, so no caller can report a
   * correction the server does not hold.
   */
  updateMetric: (at: string, key: MetricKey, cm: number) => Promise<boolean>;
  /**
   * Take one figure off one day.
   *
   * Per METRIC and not per day: a member correcting a slipped decimal on their
   * waist must not lose the chest and hips they measured in the same minute.
   */
  removeMetric: (at: string, key: MetricKey) => Promise<boolean>;
  /**
   * Record a measurement.
   *
   * Three answers, not two. Before the outbox there were two states — on the
   * server, or on this phone until the next launch and then gone — and a member
   * taping themselves in a changing room with no signal got the second one with
   * a sentence telling them to try again later, by which time the numbers were
   * off the screen and they would have to re-measure. 'queued' is the state
   * that did not exist.
   */
  addEntry: (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>) => Promise<MeasureOutcome>;
}

const Ctx = createContext<MeasureValue | null>(null);

export function MeasurementsProvider({ children }: { children: ReactNode }) {
  const authRev = useAuthRevision();
  /** Bumped by `reload`. A counter, so two pulls are two reads. */
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((n) => n + 1), []);
  const [entries, setEntries] = useState<MeasureEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const outbox = useOutbox();

  /**
   * Send the measurements this device is holding.
   *
   * Registered here rather than at the root, unlike the message handler: this
   * provider is mounted for the whole app (app/_layout.tsx), so there is no
   * state in which a queued measurement has nobody to send it.
   *
   * The rows carry their own `taken_at`, so a measurement queued on Tuesday and
   * sent on Thursday is filed on Tuesday — the trend on this screen is the
   * whole point of it, and a date that slides is a trend that lies.
   */
  useEffect(() => {
    if (!outbox) return;
    return outbox.registerHandler('measurement', async (item) => {
      const rows = (item.payload as any)?.rows;
      // A payload nothing can send. 'refused' takes it out rather than leaving
      // it to be retried on every reconnect for the life of the install.
      if (!Array.isArray(rows) || !rows.length) return 'refused';
      try {
        const { data, error } = await supabase.from('measurements').insert(rows).select('id');
        // ── The one refusal that is not a refusal ────────────────────────
        //
        // The rows carry the ids `entryToRows` minted, so an insert whose rows
        // landed and whose answer was lost comes back 23505 on the second
        // offer. `classifyWrite` reads that as 'refused', which is right for a
        // write that failed and wrong here: the measurement is in the table.
        // One INSERT is one statement, so a 23505 means the whole batch is
        // already there rather than half of it — there is no partial landing to
        // reason about. Same as `sendScan` and `sendGlucose`; nothing else in
        // the 23 class is reinterpreted.
        //
        // Only when every row actually carries an id. A payload queued by a
        // build that had none would be colliding on something else, and reading
        // that as 'stored' would be inventing a measurement.
        if (error && (error as { code?: string }).code === '23505'
          && rows.every((r: any) => typeof r?.id === 'string' && r.id)) return 'stored';
        return classifyWrite(error as any, data ? data.length : 0);
      } catch { return 'unsent'; }
    });
  }, [outbox]);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        // No session is a true answer, not a failed check. getUser() REJECTS
        // when nobody is signed in, and treating that as an error latched this
        // provider into 'error' on the first tick — before anybody had signed
        // in — where it stayed, because the effect never ran a second time.
        const { data: sess } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!sess?.session) { setStatus('ready'); return; }
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (cancelled) return;
        if (authErr) { setStatus('error'); return; }
        const id = auth?.user?.id;
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // One row per tape measurement per site, so a client measuring eight
        // sites weekly writes four hundred rows a year and reaches the ceiling
        // without ever feeling like a heavy user. Newest-first, because the
        // change since last time is the question this screen answers.
        const { data, error } = await supabase.from('measurements').select('*')
          .eq('user_id', id)
          // `taken_at` is a DATE, so a client who measures eight sites writes
          // eight rows carrying the same value. An order with ties in it is not
          // an order: at the cap the server breaks them however it likes, and it
          // may break them differently on the next launch — a chest measurement
          // that was on the chart yesterday is simply gone today. The id settles
          // them. Every capped read below does the same for the same reason.
          .order('taken_at', { ascending: false }).order('id', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        // Same rule as check-ins and the workout log: an empty result is an empty
        // history, not a cue to write fabricated measurements into Supabase.
        setEntries(page.rows.length ? rowsToEntries(page.rows) : []);
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev, readTick]);

  const addEntry = async (vals: Partial<Omit<MeasureEntry, 'id' | 'at'>>): Promise<MeasureOutcome> => {
    const clean: Partial<MeasureEntry> = {};
    for (const { key } of METRICS) { const v = vals[key]; if (typeof v === 'number' && !isNaN(v) && v > 0) clean[key] = v; }
    // Nothing to write. 'refused' is the one answer of the three that cannot
    // become a false "saved" or a false "waiting".
    if (Object.keys(clean).length === 0) return 'refused';
    const entry: MeasureEntry = { id: 'm' + SEQ++, at: new Date().toISOString(), ...clean };
    setEntries((p) => [entry, ...p].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
    /**
     * The other half of the optimistic insert above, which did not exist.
     *
     * A row drawn before the server answered has to be taken back when the
     * answer is a refusal. Nothing did that: the screen raised the honest alert
     * ("could not be sent to your account, so they will be gone at the next
     * launch") and left the row in place, where it stayed `latest` — the hero
     * waist figure, the "Measured …" line, the change since last time, part of
     * the entry count — until the app was killed. `app/(client)/scans.tsx`
     * hands the same list to `clientReportDoc`, so a figure this account
     * refused to store was printed in the summary a physiotherapist reads.
     *
     * 'queued' and 'unsent' rows stay: those are unreachable, not refused, and
     * the outbox intends to send them. See src/lib/optimisticList.ts.
     */
    const settle = (out: MeasureOutcome): MeasureOutcome => {
      setEntries((p) => settleOptimistic(p, entry.id, out));
      return out;
    };
    if (!USE_SUPABASE || !uid) return settle('refused');
    const rows = entryToRows(uid, entry);
    /** Keep it for the next time this phone can reach us. */
    const keep = async (): Promise<MeasureOutcome> => {
      if (!outbox) return settle('refused');
      // `at` is the moment it was TAKEN. The rows already carry their own
      // `taken_at` date, so the send cannot drift; this is what orders the
      // outbox and what a screen would show it under.
      const { result } = await outbox.enqueue('measurement', { rows }, { at: entry.at });
      return settle(result === 'queued' ? 'queued' : 'refused');
    };
    try {
      // `.select('id')` and a row COUNT, not just `error`. An insert PostgREST
      // narrows to zero rows under a policy does not fail — it succeeds having
      // written nothing — and reading only `error` reported that as saved. This
      // read was `return !error`.
      const { data, error } = await supabase.from('measurements').insert(rows).select('id');
      const out = classifyWrite(error as any, data ? data.length : 0);
      if (out === 'stored') return settle('stored');
      // A refusal offered again gets the same refusal, so it is not kept — and
      // it does not stay on the screen either.
      if (out === 'refused') return settle('refused');
      return keep();
    } catch { return keep(); }
  };

  /**
   * The two corrections, sharing one shape.
   *
   * Optimistic like the insert above and settled the same way: the row on
   * screen is put back exactly as it was when the server does not confirm,
   * because a figure a member watched disappear and then saw return has been
   * told two different things about their own record.
   *
   * `.select('id')` on both, and the COUNT is what is read. An update or a
   * delete that PostgREST narrows to zero rows under a policy does not fail —
   * it succeeds having changed nothing — so `!error` is not evidence that
   * anything happened. Same rule as src/lib/wroteRows.ts.
   *
   * `.eq('user_id', uid)` alongside the date and kind: RLS already scopes this
   * to the signed-in account, so it permits nothing new. It is there so a bug
   * handing this somebody else's row matches nothing rather than leaving the
   * policy as the only thing in the way.
   */
  const writeMetric = async (at: string, key: MetricKey, cm: number | null): Promise<boolean> => {
    const day = dateOf(at);
    const before = entries;
    const target = before.find((e) => dateOf(e.at) === day);
    // Nothing on screen to correct. Not an error, and not a success either: a
    // caller must not report a change to a row this device does not have.
    if (!target || target[key] == null) return false;
    if (cm != null && (!Number.isFinite(cm) || cm <= 0)) return false;

    const applied = before
      .map((e) => (dateOf(e.at) === day ? { ...e, [key]: cm ?? undefined } : e))
      // A day whose last figure has been taken off is not a day with no
      // measurements on it — it is a day that is no longer in the history.
      .filter((e) => METRICS.some(({ key: k }) => e[k] != null));
    setEntries(applied);
    const undo = () => { setEntries(before); return false; };

    if (!USE_SUPABASE || !uid) return undo();
    try {
      const { data, error } = cm == null
        ? await supabase.from('measurements').delete()
            .eq('user_id', uid).eq('taken_at', day).eq('kind', key).select('id')
        : await supabase.from('measurements').update({ value: cm })
            .eq('user_id', uid).eq('taken_at', day).eq('kind', key).select('id');
      if (error || !data || data.length === 0) return undo();
      return true;
    } catch { return undo(); }
  };

  const updateMetric = (at: string, key: MetricKey, cm: number) => writeMetric(at, key, cm);
  const removeMetric = (at: string, key: MetricKey) => writeMetric(at, key, null);

  return <Ctx.Provider value={{ entries, status, addEntry, updateMetric, removeMetric, reload }}>{children}</Ctx.Provider>;
}

export function useMeasurements(): MeasureValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMeasurements must be used inside <MeasurementsProvider>');
  return v;
}
