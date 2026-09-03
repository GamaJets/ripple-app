// The three answers behind the coach's own calorie target, read and written.
//
// The rules are in src/lib/coachMacros.ts, where they run under `npm test`;
// the storage is `coach_prefs.own_goal / own_diet / own_activity`
// (supabase/parts/1020). What is here is the part with a network in it.
//
// ── Why this is not on `useClientData` ────────────────────────────────────
//
// Because that provider reads `clients`, and `provision_profile()` gives a
// role='trainer' signup a `trainers` row and no `clients` row. Its goal, diet
// and activity are therefore constructed defaults for every coach in the
// product — 'muscle', 'meat' and a literal 1.5 — and
// app/(trainer)/my-nutrition.tsx built a day's calories out of them and counted
// the coach down against it.
//
// ── The status is not decoration ──────────────────────────────────────────
//
// A failed read and an unanswered question both arrive as three nulls, and only
// one of them means "ask". `macroGate` takes the status for exactly that
// reason: a coach who HAS answered must never be asked again on the strength of
// a dropped connection, because answering again is how a target quietly moves.
import { useCallback, useEffect, useState } from 'react';
import { fetchOwnMacroInputs, saveCoachPrefs } from '../lib/coachPrefsStore';
import type { OwnMacroInputs } from '../lib/coachMacros';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface MyMacroInputs {
  inputs: OwnMacroInputs;
  status: LoadStatus;
  /** Write one or more of the three. Returns whether the SERVER confirmed it —
   *  `saveCoachPrefs` counts the rows it changed — so a screen can say "not
   *  saved" instead of assuming. */
  save: (patch: Partial<OwnMacroInputs>) => Promise<boolean>;
  reload: () => void;
}

const NONE: OwnMacroInputs = { goal: null, diet: null, activity: null };

export function useMyMacroInputs(): MyMacroInputs {
  const authRev = useAuthRevision();
  const [inputs, setInputs] = useState<OwnMacroInputs>(NONE);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    (async () => {
      // Its own read, not `fetchCoachPrefs`: these three columns arrive with
      // supabase/parts/1020, and a column PostgREST cannot find fails the whole
      // SELECT — so sharing a read would take the class rate and the monthly
      // targets down with this feature until that part is applied.
      const r = await fetchOwnMacroInputs();
      if (!live) return;
      // Under 'error' the three stay null and the STATUS is what says they are
      // unknown rather than unanswered. Assigning the nulls anyway would be
      // harmless today and is the shape that goes wrong the moment somebody
      // reads the inputs without the status beside them.
      if (r.status === 'ready') setInputs({ goal: r.goal, diet: r.diet, activity: r.activity });
      setStatus(r.status);
    })();
    return () => { live = false; };
  }, [authRev, nonce]);

  const save = useCallback(async (patch: Partial<OwnMacroInputs>): Promise<boolean> => {
    const ok = await saveCoachPrefs({
      ...('goal' in patch ? { ownGoal: patch.goal ?? null } : null),
      ...('diet' in patch ? { ownDiet: patch.diet ?? null } : null),
      ...('activity' in patch ? { ownActivity: patch.activity ?? null } : null),
    });
    // Only on a confirmed write. A screen that moved its own state first would
    // show a target built from an answer the server refused, which is the same
    // class of lie as the defaults this replaces.
    if (ok) setInputs((p) => ({ ...p, ...patch }));
    return ok;
  }, []);

  return { inputs, status, save, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
