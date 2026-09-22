// The cancellation record, read from either side of it.
//
// Two hooks over one table, and they are deliberately not one hook with a flag.
// The reads differ in what they are scoped by — a coach reads `trainer_id` AND
// `client_id`, a member reads their own `client_id` and nothing else — and the
// sentences on each screen differ with them, so a shared hook would have to
// carry the audience anyway and would then be one function pretending to be a
// rule. src/ui/attendance.ts and src/ui/clientAttendance.ts are split for the
// same reason and that file's header sets it out.
//
// ── What both of them refuse to do ────────────────────────────────────────
//
// · NO DEVICE CACHE. Neither of these writes to AsyncStorage. On the coach's
//   side that is the rule src/ui/clientAttendance.ts states: this is somebody
//   else's record, on a coach's phone, and the offline win is not worth leaving
//   a copy of it there after the coaching relationship ends. On the member's
//   side there is nothing to be gained — the screen it feeds is not one anybody
//   opens in a basement mid-session.
// · NO FIGURE FROM A PREFIX. `status` is 'partial' when the read came back at
//   the row cap, which every screen gates its counts on through `isWhole`. The
//   rows are still handed over, because a list of a thousand real cancellations
//   is genuinely useful and throwing it away to protect a count nobody asked
//   for takes a working screen away (src/lib/rowCap.ts, the section headed
//   "Where throwing is the wrong answer").
// · NO EMPTY LIST UNDER 'error'. `rows` is not cleared when a read fails, so
//   what was last read stays on screen under a banner saying it is not
//   confirmed current — and an empty list under 'error' means UNKNOWN, which is
//   what `emptyCancellationsLine` is for.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import {
  fetchClientCancellations, fetchMyCancellations, groupActions, tallyCancellations,
  type Cancellation, type CancelAction, type CancelTally,
} from '../lib/sessionCancellations';

const EMPTY_TALLY: CancelTally = tallyCancellations([]);

export interface CancellationsRead {
  status: LoadStatus;
  /** Newest cancellation first. Under 'error' this is whatever was on screen
   *  before the failure and is not confirmed current. */
  rows: Cancellation[];
  /** The same rows folded into the decisions that produced them. See
   *  `groupActions` in src/lib/sessionCancellations.ts for why a shared
   *  `cancelled_at` is the test and `was_series` is not. */
  actions: CancelAction[];
  /** Every count the record supports. NOT to be printed unless `isWhole`. */
  tally: CancelTally;
  reload: () => Promise<void>;
}

/**
 * The state machine both hooks share.
 *
 * `load` takes a subject key and a reader, and the key is what makes a response
 * for the previous client fail its check on arrival. A coach tapping down a
 * chip row starts a read per tap and they do not come back in the order they
 * went out; without this, tapping Amy then Ben and having Amy resolve second
 * leaves Ben's name on the header over Amy's cancellations — and a count under
 * it that belongs to neither of them. The same guard, for the same reason, as
 * `wanted` in src/ui/clientAttendance.ts.
 */
function useCancellationsRead(
  subject: string | null,
  read: (key: string) => ReturnType<typeof fetchMyCancellations>,
): CancellationsRead {
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [rows, setRows] = useState<Cancellation[]>([]);
  const [actions, setActions] = useState<CancelAction[]>([]);
  const [tally, setTally] = useState<CancelTally>(EMPTY_TALLY);

  const wanted = useRef<string | null>(null);
  // `read` is recreated on every render by both callers, so it must not be a
  // dependency of `load` — a load that changes identity every render is a load
  // an effect can never settle on, which is the shape scripts/check-provider-
  // value.mjs was written about one layer up. It is held in a ref instead and
  // the current one is called, which is always the one for the current subject
  // because the subject is checked on arrival anyway.
  const reader = useRef(read);
  reader.current = read;

  const load = useCallback(async (key: string) => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    setStatus('loading');
    try {
      const res = await reader.current(key);
      // The reader has moved on. Dropping the response is the whole of it.
      if (wanted.current !== key) return;
      if (!res.ok) {
        reportError('cancellations.read', new Error(res.reason));
        // Deliberately NOT cleared — see the header. The screen's banner says
        // what is on it is not confirmed current.
        setStatus('error');
        return;
      }
      const next = res.value.rows;
      setRows(next);
      setActions(groupActions(next));
      // Computed whether or not the read was whole, because the screens gate on
      // `isWhole` before printing any of it and a tally that was null under
      // 'partial' would force every one of them to branch twice. The rule is
      // enforced where it is read, not by withholding the object.
      setTally(tallyCancellations(next));
      setStatus(res.value.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (wanted.current !== key) return;
      reportError('cancellations.read', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Set BEFORE the read starts, so a response for the previous subject that
    // is still in flight fails its check when it lands.
    wanted.current = subject;
    if (!subject) {
      // No subject is not a subject with nothing on record. Everything is
      // cleared and the status says the app is not mid-read, so the screen
      // renders its picker rather than an empty record under somebody's name.
      setRows([]); setActions([]); setTally(EMPTY_TALLY); setStatus('ready');
      return;
    }
    // Cleared as well as re-read: the previous subject's rows would otherwise
    // stay in state until their replacement lands, under a header that has
    // already changed to the new name.
    setRows([]); setActions([]); setTally(EMPTY_TALLY);
    void load(subject);
  }, [subject, load]);

  const reload = useCallback(async () => {
    if (subject) await load(subject);
  }, [subject, load]);

  return { status, rows, actions, tally, reload };
}

/**
 * One client's cancelled hours, read by their coach.
 *
 * Both ids are required and a missing one is NOT an error state — it is the
 * "nothing selected" state, which renders as a picker. A coach whose auth has
 * not resolved yet, and a coach who has not chosen anybody, are the same thing
 * from this hook's point of view: there is nobody to read about.
 */
export function useClientCancellations(coachId: string | null, clientId: string | null): CancellationsRead {
  // One key for two ids, so a change to either restarts the read and a stale
  // response for the other pairing cannot land. Neither id contains a '|'.
  const subject = coachId && clientId ? `${coachId}|${clientId}` : null;
  return useCancellationsRead(
    subject,
    useCallback(() => fetchClientCancellations(supabase, coachId ?? '', clientId ?? ''), [coachId, clientId]),
  );
}

/** A member's own cancelled hours, whoever performed them and whichever coach
 *  they were with at the time. */
export function useMyCancellations(clientId: string | null): CancellationsRead {
  return useCancellationsRead(
    clientId,
    useCallback(() => fetchMyCancellations(supabase, clientId ?? ''), [clientId]),
  );
}
