// The stretches the routine builder may draw on, read from the catalogue.
//
// ── Why this is not `useExerciseCatalogue` with a filter ──────────────────
//
// That hook exists next door in src/ui/exerciseDetail.ts and it reads every row
// in the table — 615 of them, with two muscle arrays, a synonym array and an
// image path each — because a library screen is a list of all of them and has
// to be. The Train tab is not that screen. It wants the 58 rows that need no
// equipment, and it wants four scalars off each: what part of the body it is
// for, whether it is done on each side, whether it moves, and its first muscle.
//
// So this is its own read with its own WHERE clause, and the clause is the
// point. `category = 'stretching'` and `equipment is null` are two indexed
// equalities Postgres answers over 615 rows far more cheaply than we could over
// the ones it sent, and they cut the answer to under a tenth of the rows before
// a byte leaves the server. src/lib/stretchBuilder.ts owns the narrowings a
// query cannot express readably — the Pilates exclusion and the body_part
// vocabulary — and this file owns nothing but the read.
//
// ── The three answers, kept apart ─────────────────────────────────────────
//
// Loading, unreadable and genuinely empty are three different sentences, and
// before the columns existed this feature had none of them: the catalogue was a
// constant in stretchBuilder.ts, so there was no read and nothing to be honest
// about. There is now, so the caller gets `status` and it gets `signedOut`, for
// exactly the reason useExerciseCatalogue carries one: the read policy on
// `exercises` is `to authenticated`, and a session that has not restored is
// handed nought rows and no error at all. "We have no stretches" is a false
// statement about our own catalogue, and it is the one this flag exists to stop
// anybody making.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { useAuthRevision } from './authRevision';
import { stretchCandidates, type StretchCandidate } from '../lib/stretchBuilder';
import type { LoadStatus } from './loadStatus';

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/**
 * Whether anybody is signed in.
 *
 * The same guard, for the same reason and with the same "could not tell means
 * assume signed in" answer, as the one in src/ui/exerciseDetail.ts. Duplicated
 * rather than exported from there because that module pulls in the translation
 * hooks and the display-name machinery, none of which this read wants — and
 * because the whole of it is a session lookup out of local storage.
 */
async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return true;
  }
}

export function useStretchCatalogue() {
  const authRev = useAuthRevision();
  const [candidates, setCandidates] = useState<StretchCandidate[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, body_part, is_unilateral, force, equipment, primary_muscles')
        // Both halves of "a stretch somebody can start with nothing". The
        // second is a real filter and not a tidy-up: eleven of these rows want
        // a resistance band and ten want a flat bench, and a routine built for
        // ten spare minutes that opens with "you will need a band" is one most
        // people cannot begin.
        .eq('category', 'stretching')
        .is('equipment', null)
        // Alphabetical, so the builder's rotation starts from the same place
        // every time. It seeds its variety deliberately — see BuildRequest.seed
        // — and a list arriving in whatever order Postgres felt like would make
        // "the same routine every time" quietly false.
        .order('name', { ascending: true })
        .limit(capLimit());
      if (error) { reportError('stretchCatalogue.read', error); setStatus('error'); return; }
      const page = capped(data);
      // Cleared as well as set, exactly as the library hook does it: the re-read
      // that follows a sign-in returns the rows, and a flag left standing from
      // the read before it would keep telling a signed-in member to sign in.
      setSignedOut(page.rows.length ? false : !(await signedIn()));
      setCandidates(stretchCandidates(page.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        bodyPart: typeof r.body_part === 'string' && r.body_part ? r.body_part : null,
        // The column is `not null default false`, so this is a boolean on every
        // row we will ever read. Coerced anyway, because the cost of being
        // wrong is a member holding a stretch on one leg and calling it done.
        isUnilateral: r.is_unilateral === true,
        force: typeof r.force === 'string' && r.force ? r.force : null,
        // Selected and passed through rather than assumed null. The query
        // already required it to be null, so this is belt and braces — but the
        // narrowing lives in stretchCandidates() and it must be able to do its
        // job on whatever it is handed, including rows from a caller that
        // forgot the clause.
        equipment: typeof r.equipment === 'string' && r.equipment ? r.equipment : null,
        primaryMuscles: strs(r.primary_muscles),
      }))));
      // 'partial' rather than 'ready' at the cap, for the reason src/lib/rowCap.ts
      // gives. Nowhere near it today — 58 rows against a cap of 1000 — and the
      // line stays because a builder silently drawing on a prefix of the
      // catalogue is indistinguishable, on screen, from one drawing on all of it.
      setStatus(page.truncated ? 'partial' : 'ready');
    } catch (e) {
      reportError('stretchCatalogue.read', e);
      setStatus('error');
    }
    // Re-armed on sign-in. The providers mount before the session is restored,
    // so the one run an empty dependency array allowed would happen while
    // signed out, come back with nought rows and no error, and never run again
    // — leaving the Train tab saying we have no stretches for the life of the
    // app. See src/ui/authRevision.tsx.
  }, [authRev]);

  useEffect(() => { void load(); }, [load]);

  return { candidates, status, signedOut, reload: load };
}
