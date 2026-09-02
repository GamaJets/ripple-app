// One client's attendance, read by their coach.
//
// The member's own copy of this is src/ui/attendance.ts and the two are
// deliberately not one hook. Three things differ, and each of them is a rule
// rather than a preference:
//
//   · The SUBJECT is an argument. A coach moves between clients, so the read is
//     keyed on whoever is selected and a response for somebody else must not be
//     allowed to land — see `wanted` below, which is the guard
//     app/(trainer)/checklists.tsx carries for the same reason and for the same
//     bug: one client's rows rendered under another client's name.
//   · There is NO device cache. `src/ui/attendance.ts` writes the member's own
//     history to AsyncStorage so they can read it in a gym with no signal, and
//     that argument does not transfer: this is somebody else's attendance
//     record, on a coach's phone, and the offline win is not worth leaving a
//     copy of it there after the coaching relationship ends.
//   · An empty result is not necessarily an answer. The coach reaches these
//     rows as gym staff and RLS is tenant-scoped, so a coach with no gym is
//     handed zero rows and no error. `staffScopeNote` in src/lib/attendance.ts
//     is what the screen says instead, and this hook does not attempt to guess
//     it from the row count.
//
// Everything below `status` means what src/ui/loadStatus.ts says it means, and
// the one that matters here is 'error': an empty `events` under it is UNKNOWN.
// The screen must not turn that into a sentence about the client.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { LoadStatus } from './loadStatus';
import { RHYTHM_WEEKS } from './attendance';
import {
  fetchClientAttendance, mergeAttendance, attendedDays, rhythm, localDay,
  type AttendanceEvent, type Rhythm,
} from '../lib/attendance';

const EMPTY_RHYTHM: Rhythm = { weeks: [], firstDay: null, countedWeeks: 0, perWeek: null };

export interface ClientAttendance {
  status: LoadStatus;
  /** Newest first. Under 'error' this is whatever was on screen before the
   *  failure, and is not confirmed current. */
  events: AttendanceEvent[];
  /** Events with no readable date — rule 3 in src/lib/attendance.ts. Never
   *  folded into `events`, never dropped. */
  undated: AttendanceEvent[];
  /** Distinct local days the record proves this client was at a gym. */
  days: string[];
  /** The weekly picture. `perWeek` is null unless the read was whole. */
  rhythm: Rhythm;
  /** False when at least one class row did not come back, so an event on screen
   *  has no title. The screen says which rather than showing a blank. */
  classesComplete: boolean;
  reload: () => Promise<void>;
}

export function useClientAttendance(clientId: string | null): ClientAttendance {
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [undated, setUndated] = useState<AttendanceEvent[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [rh, setRh] = useState<Rhythm>(EMPTY_RHYTHM);
  const [classesComplete, setClassesComplete] = useState(true);

  /* Whose answer is allowed to land.
   *
   * A coach tapping down a chip row starts a read per tap and they do not come
   * back in the order they went out. Without this, tapping A then B and having
   * A resolve second leaves B's name on the header over A's attendance — and,
   * worse, A's days under `rhythm` at full confidence, which is a rate about a
   * fortnight that happened to neither of them. */
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    if (!USE_SUPABASE) { setStatus('ready'); return; }
    setStatus('loading');
    try {
      const res = await fetchClientAttendance(supabase, id);
      // The coach has moved on. Dropping the response is the whole of it: the
      // read for whoever is selected now will set the state.
      if (wanted.current !== id) return;
      if (!res.ok) {
        reportError('clientAttendance.read', new Error(res.reason));
        // Deliberately NOT cleared. What was last read beats replacing somebody's
        // training history with nothing, and the screen's banner says it is not
        // confirmed current.
        setStatus('error');
        return;
      }
      const now = new Date();
      const { events: ev, undated: un } = mergeAttendance(
        res.value.bookings, res.value.visits, res.value.classes, now,
      );
      const d = attendedDays(ev);
      const today = localDay(now.toISOString());
      setEvents(ev);
      setUndated(un);
      setDays(d);
      // `whole` is the read's own answer and never a guess from the row count:
      // a truncated read yields a list and no rate (src/lib/rowCap.ts).
      setRh(rhythm(d, today ?? '', RHYTHM_WEEKS, !res.value.truncated));
      setClassesComplete(res.value.classesComplete);
      setStatus(res.value.truncated ? 'partial' : 'ready');
    } catch (e) {
      if (wanted.current !== id) return;
      reportError('clientAttendance.read', e);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Set before the read starts, so a response for the previous client that is
    // still in flight fails its check on arrival.
    wanted.current = clientId;
    if (!clientId) {
      // No client selected is not a client with no attendance. Everything is
      // cleared and the status says the app is not mid-read, so the screen
      // renders its picker rather than an empty history under somebody's name.
      setEvents([]); setUndated([]); setDays([]); setRh(EMPTY_RHYTHM);
      setClassesComplete(true); setStatus('ready');
      return;
    }
    // Cleared as well as re-read: the previous client's rows stay in state
    // until their replacement lands, and the header has already changed.
    setEvents([]); setUndated([]); setDays([]); setRh(EMPTY_RHYTHM); setClassesComplete(true);
    void load(clientId);
  }, [clientId, load]);

  const reload = useCallback(async () => {
    if (clientId) await load(clientId);
  }, [clientId, load]);

  return { status, events, undated, days, rhythm: rh, classesComplete, reload };
}
