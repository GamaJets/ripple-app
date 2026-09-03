// A coach's own exercise names, kept between programs.
//
// Raised by a tester: typing a name into the builder's Add exercise sheet put
// it in that one program and nowhere else. The client receiving the program
// saw it; the coach retyped it next time.
//
// Scope is the coach, not the gym and not the platform. The existing
// `exercises` table has no tenant_id and no coach_id — it is a global
// catalogue the exercise-video library writes to — so a custom name written
// there would appear in every other gym's picker. `coach_exercises` is per
// coach, exactly as `program_templates` already is.
//
// Three states, never two: not loaded, loaded and empty, and could-not-load.
// A failed read must not render as "you have saved none", which is the shape
// of bug this codebase keeps finding.
import { useCallback, useEffect, useState } from 'react';
import { useAuthRevision } from './authRevision';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';

import { mergeExerciseLists, type CoachExercise } from '../lib/coachExerciseList';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import { writeFailure } from '../lib/wroteRows';

export { mergeExerciseLists, type CoachExercise };

/**
 * The same vocabulary as every other provider, aliased rather than restated.
 *
 * It was its own three-member union, which was fine until `LoadStatus` grew a
 * fourth: a picker that cannot say "these are some of your saved names" is
 * exactly the surface this whole change exists for, and a private copy of the
 * type would have quietly opted out of it.
 */
export type CoachExerciseStatus = LoadStatus;

export interface CoachExercisesApi {
  /** The coach's saved names, alphabetical. Empty while loading or on failure. */
  saved: CoachExercise[];
  status: CoachExerciseStatus;
  /**
   * Remember a name. Resolves true when it reached the database, false when it
   * did not — the caller keeps it in the program either way, because the
   * program is the thing the coach asked for and this is the convenience.
   */
  remember: (name: string, group?: string) => Promise<boolean>;
  forget: (name: string) => Promise<boolean>;
  /** Read the saved names again. Under 'error' the list is empty because the
   *  read failed, not because the coach has saved nothing — the picker says
   *  so, and this is how it stops saying it. */
  reload: () => void;
}

const byName = (a: CoachExercise, b: CoachExercise) => a.name.localeCompare(b.name);

export function useCoachExercises(): CoachExercisesApi {
  const authRev = useAuthRevision();
  const [saved, setSaved] = useState<CoachExercise[]>([]);
  const [status, setStatus] = useState<CoachExerciseStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [uid, setUid] = useState<string | null>(null);
  // Bumped by `reload`, beside `authRev` in the read below.
  const [nonce, setNonce] = useState(0);

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
        // Signed out is not a failure — there is simply nobody to have saved
        // anything. The built-in list stands on its own.
        if (!id) { setStatus('ready'); return; }
        setUid(id);
        // Ordered as well as capped. The list is re-sorted by name below, so the
        // order here is purely about WHICH names survive the ceiling — and left
        // to the server that answer changes between launches, which in a picker
        // reads as exercises the coach saved going missing at random.
        const { data, error } = await supabase
          .from('coach_exercises')
          .select('name, muscle_group')
          .eq('coach_id', id)
          .order('name', { ascending: true })
          .limit(capLimit());
        if (cancelled) return;
        // Not `if (error || !data)`. A read that failed and a coach who has
        // saved nothing are different facts and the picker says so.
        if (error) { setStatus('error'); return; }
        const page = capped(data);
        setSaved(page.rows.map((r: any) => ({ name: r.name, group: r.muscle_group || '' })).sort(byName));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; };
  }, [authRev, nonce]);

  /** A name the coach typed a moment ago is held optimistically and is NOT
   *  merged by the read below — it assigns — so a refresh drops an optimistic
   *  name whose write never landed. That is the honest outcome: the name was
   *  never saved, and the list is supposed to be what the server holds. */
  const reload = useCallback(() => {
    if (USE_SUPABASE) setStatus('loading');
    setNonce((n) => n + 1);
  }, []);

  const remember = useCallback(async (name: string, group = ''): Promise<boolean> => {
    const nm = name.trim();
    if (!nm) return false;
    // Optimistic locally, so the name is in the list the moment it is typed
    // even if the write is still in flight or never lands.
    setSaved((p) => (p.some((x) => x.name.toLowerCase() === nm.toLowerCase()) ? p : [...p, { name: nm, group }].sort(byName)));
    if (!USE_SUPABASE || !uid) return false;
    try {
      // upsert, because a coach retyping a name they already have should be a
      // no-op rather than a duplicate-key error surfaced at them.
      const { error } = await supabase
        .from('coach_exercises')
        .upsert({ coach_id: uid, name: nm, muscle_group: group }, { onConflict: 'coach_id,name' });
      return !error;
    } catch { return false; }
  }, [uid]);

  const forget = useCallback(async (name: string): Promise<boolean> => {
    setSaved((p) => p.filter((x) => x.name !== name));
    if (!USE_SUPABASE || !uid) return false;
    try {
      // COUNTED, and put back when the server did not confirm. The row is
      // dropped from state above before the request goes out, and PostgREST
      // answers a DELETE that matched nothing with a 204 and `error: null` —
      // so `!error` was `true` for a refusal, and the movement vanished from
      // the coach's own list while the row stayed on the server and came back
      // at the next load.
      const del = await supabase.from('coach_exercises')
        .delete({ count: 'exact' }).eq('coach_id', uid).eq('name', name);
      if (writeFailure('That movement', del)) {
        // Re-read rather than reinstate from memory. `reload` is what this
        // hook already treats as the truth about what the server holds, and a
        // row put back by hand would be this device's guess at a row it has
        // just been told it did not delete.
        reload();
        return false;
      }
      return true;
    } catch { reload(); return false; }
  }, [uid, reload]);

  return { saved, status, remember, forget, reload };
}
