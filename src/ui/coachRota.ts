// The two reads behind a coach's own rota.
//
// The impure half of src/lib/coachRota.ts, which holds every decision about
// what an empty answer means. Same split as coachPayTerms and coachKit: that
// file imports nothing and is run by `npm test`; this one reaches Supabase.
//
// ── The read, and why it is not `fetchShifts` ─────────────────────────────
//
// `fetchShifts` in src/lib/gymRota.ts reads a WEEK OF ONE GYM: every trainer's
// shifts, with a `profiles` join to name them and every row's `rate_cents` on
// it. That is the owner's question. This one asks a coach's — `.eq('trainer_id',
// uid)` beside the tenant filter — which needs no name join at all, because the
// only person on the list is the person reading it.
//
// The filter restates what `gym_shifts_staff_r` already allows rather than
// relying on it. That policy admits a trainer to the WHOLE gym's rota
// (`tenant_id = my_tenant() and my_role() in ('trainer', 'owner')`), which is
// deliberate and is the owner's grid working; it is not a licence for a screen
// headed "your shifts" to fetch everybody's and filter in the client, where a
// row cap could quietly drop the coach's own Saturday off the end of somebody
// else's fortnight.
//
// ── The window ────────────────────────────────────────────────────────────
//
// Today at the gym, and the thirteen days after it. Bounded on the GYM's
// midnight through `rotaInstant`, which falls back to the reader's when there
// is no zone and says so through `zoneKnown` — src/lib/rotaClock.ts's own
// contract. A rota read on the phone's midnight at a gym four hours ahead shows
// a coach a fortnight that starts yesterday.
//
// Like every other window in this app the query opens on `ends_at`, so a shift
// that started before the window and runs into it is still a shift the coach is
// working. `fetchShifts` makes the same choice and states the same reason.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sessionUid } from '../lib/sessionUid';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { assertWhole, capLimit } from '../lib/rowCap';
import type { Shift, ShiftRole, ShiftStatus } from '../lib/gymRota';
import { fetchGymZone } from '../lib/gymZone';
import { rotaToday, rotaInstant, addCalendarDays } from '../lib/rotaClock';
import { coachRotaView, type CoachRotaView } from '../lib/coachRota';
import type { GymLink } from '../lib/coachPayTerms';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useToday } from './today';
import { useAuthRevision } from './authRevision';

/**
 * How far ahead the coach's rota looks.
 *
 * A fortnight: long enough that a shift at the far end can still be planned
 * around, short enough that the list stays something a thumb gets to the end
 * of. Stated once here so the query and the "no shifts in the next N days"
 * sentence cannot come to disagree about what the screen looked at — which
 * would be a claim about a span nobody read.
 */
export const ROTA_WINDOW_DAYS = 14;

export interface MyRota {
  status: LoadStatus;
  /** The whole section, already decided. Never rows a caller must interpret. */
  view: CoachRotaView;
  /** How many days ahead this looked, for the sentence that names it. */
  windowDays: number;
  /** Whether the days and clock labels are the GYM's. False means they are the
   *  reader's, because the gym has set no timezone or it could not be read —
   *  and a screen naming a shift time must say so rather than imply the gym's. */
  zoneKnown: boolean;
  refresh: () => void;
}

/** The columns a coach's own shift needs. No `trainer_id` join: there is one
 *  person on this list and they are holding the phone. */
const SHIFT_COLS = 'id, starts_at, ends_at, role, status, note, rate_cents, currency';

/** A `role` this build understands, or the floor. An unrecognised value is not
 *  silently a fifth role: the column is checked to five values, so anything
 *  else is a database ahead of this binary, and 'floor' is the schema's own
 *  default and the least specific claim available. */
function roleOf(v: unknown): ShiftRole {
  return v === 'classes' || v === 'pt' || v === 'desk' || v === 'admin' ? v : 'floor';
}

/** A `status` this build understands. Anything unrecognised is read as still
 *  scheduled rather than as pulled: telling a coach their shift was dropped
 *  when it was not is the direction that costs somebody a shift. */
function statusOf(v: unknown): ShiftStatus {
  return v === 'cancelled' ? 'cancelled' : 'scheduled';
}

/**
 * The signed-in coach's own shifts in the window.
 *
 * Throws on a refused read rather than answering [], because the caller turns
 * this into a list somebody plans a fortnight around and an empty one reads as
 * "you are not on". `assertWhole` turns PostgREST's silent thousand-row stop
 * into the failure it is — a fortnight of one person's shifts will not reach a
 * thousand, which is exactly why a read that does has lost a filter.
 */
async function fetchMyShifts(
  tenantId: string, trainerId: string, fromIso: string, toIso: string,
): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('gym_shifts')
    .select(SHIFT_COLS)
    .eq('tenant_id', tenantId)
    .eq('trainer_id', trainerId)
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso)
    .order('starts_at', { ascending: true })
    .limit(capLimit());
  if (error) throw error;
  const rows = assertWhole(data as any[] | null, 'your shifts in this fortnight');
  return rows.map((r: any) => ({
    id: r.id,
    trainerId,
    // The reader. Left null rather than filled with their own name: nothing on
    // this screen prints it, and a name here would be the one field on the row
    // that did not come out of `gym_shifts`.
    trainerName: null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    role: roleOf(r.role),
    status: statusOf(r.status),
    note: r.note ?? null,
    rateCents: typeof r.rate_cents === 'number' ? r.rate_cents : null,
    // Trimmed and upper-cased on the way in, so 'gbp' and ' GBP ' cannot become
    // two pots in `shiftPay`. The same normalising `fetchShifts` performs.
    currency: (r.currency ?? '').toString().trim().toUpperCase() || null,
  }));
}

/**
 * What the gym has this coach down for.
 *
 * Costs no reads for the account with no gym — which is every coach live on
 * this product today. There is no gym to have written a rota, and
 * `coachRotaView` answers 'no_gym' from the link before it looks at a row.
 */
export function useMyRota(): MyRota {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  // The window starts at today, so it has to move when today does. This screen
  // is registered `href: null` in app/(trainer)/_layout.tsx — mounted once and
  // never torn down — so without this a coach who left the app open over a
  // night would be reading yesterday's fortnight.
  const today = useToday();
  const [zone, setZone] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [readStatus, setReadStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown', which is what stops "your gym has you on no shifts"
  // being said to an employed coach whose profile read timed out.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  // Re-derived whenever the day moves. `today` is in the dependency list for
  // that and nothing else — it is the value that changes at midnight, which is
  // when the answer to "which fortnight" changes.
  const bounds = useMemo(() => {
    const start = rotaToday(zone, Date.now());
    const end = addCalendarDays(start, ROTA_WINDOW_DAYS);
    const fromIso = rotaInstant(start, 0, zone);
    const toIso = rotaInstant(end, 0, zone);
    return fromIso && toIso ? { fromIso, toIso } : null;
  }, [zone, today]); // eslint-disable-line react-hooks/exhaustive-deps -- `today` is the clock this must re-run on; see src/ui/today.ts

  const fromIso = bounds?.fromIso ?? null;
  const toIso = bounds?.toIso ?? null;

  const loadZone = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE || !tenantId) { setZone(null); return; }
    const z = await fetchGymZone(supabase, tenantId);
    if (cancelled()) return;
    // Reported, not swallowed, and not fatal: with no usable zone the window and
    // the clock labels fall back to the reader's and `zoneKnown` says so.
    if (z.error) reportError('coachRota.zone', z.error);
    setZone(z.zone);
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    void loadZone(() => cancelled);
    return () => { cancelled = true; };
  }, [loadZone, authRev, tick]);

  useEffect(() => {
    if (!USE_SUPABASE) { setReadStatus('ready'); return; }
    if (!tenantId) {
      // Nothing to read and nothing unknown: with no gym there is no rota that
      // could exist. The view is a sentence and needs no rows to say it.
      setShifts(null);
      setReadStatus(tenantStatus === 'ready' ? 'ready' : 'loading');
      return;
    }
    if (!fromIso || !toIso) { setShifts(null); setReadStatus('error'); return; }

    let cancelled = false;
    setReadStatus('loading');
    // Cleared first, so the previous window's shifts cannot sit under the new
    // window's heading while the read is in flight.
    setShifts(null);

    void (async () => {
      try {
        // ── who is asking, and why the error beside it had to be read ──────
        //
        // getSession and not getUser, which stays true and is the deliberate
        // choice: getSession answers from device storage, so a coach checking
        // their shifts on a gym floor with no signal still gets an answer. The
        // reason written beside it was not true — it said getUser REJECTS with
        // nobody signed in. It does not; src/lib/authReadFate.ts quotes the
        // installed auth-js, where every AuthError RESOLVES, and `getSession()`
        // resolves with `{ data: { session: null }, error }` the moment a
        // stored access token has expired and the refresh cannot reach the
        // server.
        //
        // `error` was not named here, so that outage arrived as `uid === null`
        // and this hook answered 'error' — the cautious status, so no coach was
        // ever told "your gym has you on no shifts" over a timeout. What it did
        // do was leave the outage with nowhere to be seen: no report, and the
        // same status as a refusal. `sessionUid` names the error, classifies it
        // once, and reports the unreadable half under this hook's own key.
        const who = await sessionUid('coachRota.whoAmI');
        if (cancelled) return;
        // Both fates stay 'error'. A fortnight is a thing a coach plans around,
        // and neither "nobody is signed in" nor "we could not ask" is a
        // fortnight with no shifts in it — `coachRotaView` is handed a status
        // that is not 'ready' and says so rather than drawing an empty rota.
        // Told apart by `fate`, never by `!who.uid`: `string` includes '', so
        // `!who.uid` does not narrow the union.
        if (who.fate !== null) { setReadStatus('error'); return; }
        const uid = who.uid;
        const rows = await fetchMyShifts(tenantId, uid, fromIso, toIso);
        if (cancelled) return;
        setShifts(rows);
        setReadStatus('ready');
      } catch (e) {
        // A refusal, or a read past the cap. Either way nothing about this
        // coach's fortnight may be stated, and an empty rota is not what
        // happened.
        reportError('coachRota.shifts', e);
        if (!cancelled) { setShifts(null); setReadStatus('error'); }
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId, tenantStatus, fromIso, toIso, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const status = worstStatus(tenantStatus, readStatus);

  return useMemo<MyRota>(() => ({
    status,
    view: coachRotaView(link, status, shifts, zone, ROTA_WINDOW_DAYS),
    windowDays: ROTA_WINDOW_DAYS,
    zoneKnown: !!zone,
    refresh,
  }), [status, link, shifts, zone, refresh]);
}
