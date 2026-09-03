// Coach · reading the eight things the first-run list is about.
//
// The sibling of src/lib/coachFirstRun.ts, which holds the rules and the words
// and is tested without a database. This half is the reads, and it is here for
// the reason src/ui/nudges.ts states about its own four: every one of them can
// LIE BY SUCCEEDING.
//
// supabase-js resolves on a database error. `const { data } = await …; return
// (data ?? []).length > 0` turns a refused read into a confident false, and a
// confident false on this screen is the app telling a coach they have not
// connected Stripe, have not set a rate, and have no clients — to a coach with
// forty clients and a live payout account. The next thing that coach does is go
// and "fix" a working account.
//
// So each read here answers `boolean | null`, null meaning the read did not
// come back. src/lib/coachFirstRun.ts draws those as a dash, counts them
// neither way, and refuses to call the list finished while any of them stands.
//
// ── Why eight separate reads and not one view ─────────────────────────────
//
// They fail independently and they must be allowed to. A refused
// `connect_accounts` read has nothing to say about whether the coach has set a
// currency, and folding them into one query would let the strictest policy on
// the list blank the other seven. `Promise.allSettled` rather than
// `Promise.all` for exactly that: one rejection must not take the other seven
// down with it.
//
// ── What each read is actually asking ─────────────────────────────────────
//
// Every one is `select id … limit 1` or a single-row read. None of them counts,
// because none of the questions is "how many" — "has this coach got at least
// one package" needs one row, and asking for a page of them is a bigger read
// that can be truncated, which would add a third answer nobody wants.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { useAuthRevision } from './authRevision';
import { fetchMyCurrency } from '../lib/myCurrency';
import { currencyStepDone } from '../lib/currencyStep';
import type { MyCurrency } from '../lib/currencySource';
import type { LoadStatus } from './loadStatus';
import type { CoachSetupFacts } from '../lib/coachFirstRun';

/** Nothing established. The honest starting point and the honest answer to a
 *  signed-out session — not a row of falses. */
export const UNKNOWN_SETUP: CoachSetupFacts = {
  mode: null, currency: null, rate: null, client: null, availability: null,
  package: null, stripe: null, code: null, document: null,
};

export interface CoachSetupRead {
  facts: CoachSetupFacts;
  /** 'loading' until the first pass lands; 'ready' once it has, whatever the
   *  individual answers were. There is no 'error' state for the whole read
   *  because the eight are independent — a screen-level error banner over
   *  seven good answers would hide them. The per-fact nulls carry the failure,
   *  which is the point of the shape. */
  status: LoadStatus;
  reload: () => Promise<void>;
}

/**
 * True when the query returned at least one row, null when it did not answer.
 *
 * `error` is checked first and separately from `data`: on a refusal both a null
 * data and an error are present, and reading data first is exactly how a
 * refusal becomes "there are none".
 *
 * Takes the ALREADY-BUILT query rather than a table name and a callback. The
 * earlier shape passed the table as a string, which made every read in this
 * file invisible to scripts/check-schema.mjs — it reports `.from(table) — the
 * table is a variable` and then checks none of the columns. A file whose whole
 * job is asking eight questions of eight tables is the last place to hide the
 * table names from the gate that verifies they exist.
 */
async function anyRow(label: string, q: any): Promise<boolean | null> {
  try {
    const { data, error } = await q.limit(1);
    if (error) { reportError('coachSetup.' + label, error); return null; }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    reportError('coachSetup.' + label, e);
    return null;
  }
}

export function useCoachSetup(): CoachSetupRead {
  const authRev = useAuthRevision();
  const [facts, setFacts] = useState<CoachSetupFacts>(UNKNOWN_SETUP);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setFacts(UNKNOWN_SETUP); setStatus('ready'); return; }
    // getSession and not getUser: getUser REJECTS when nobody is signed in,
    // which would latch this screen into eight dashes forever on a build that
    // has simply not logged in yet. The same choice src/ui/nudges.ts makes.
    let uid: string | null = null;
    try {
      const { data: sess } = await supabase.auth.getSession();
      uid = sess?.session?.user?.id ?? null;
    } catch (e) { reportError('coachSetup.session', e); }
    if (!uid) { setFacts(UNKNOWN_SETUP); setStatus('ready'); return; }

    const settled = await Promise.allSettled([
      // 1 · the currency. `fetchMyCurrency` and NOT `myTenantCurrency`, which
      //     asks about a gym: since part 940 a coach with no gym has a currency
      //     of their own on `trainers.currency`, and the gym-only read answered
      //     "not set" for them whatever they had chosen — so this step could
      //     never tick for an independent coach, however many times they went
      //     to Settings and set one. The resolver applies the precedence rule
      //     (gym first, always; the coach's own column only when there is
      //     provably no gym) and names WHICH of six things is missing, which is
      //     what lets a failed read stay a dash instead of becoming a nag. See
      //     src/lib/currencyStep.ts.
      fetchMyCurrency(),
      // 2 · the rate, AND how they coach. Two facts, one row, one read: both
      //     live on `trainers` and asking twice would let the same row answer
      //     one question and fail the other. `session_fee` is nullable and 0 is
      //     a rate a coach may really charge, so `!= null` is the test and
      //     never truthiness. `delivery_mode` (part 410) is nullable too, and
      //     ITS null is the coach not having answered — which is a real
      //     answer, and is why a refused read on this row has to blank both
      //     facts rather than report an unanswered question.
      supabase.from('trainers').select('session_fee, delivery_mode').eq('id', uid).maybeSingle(),
      // 3 · somebody on the book. Two tables, because a coach who has written
      //     down forty people by hand has a book: `clients` is people with a
      //     Repple account, `coach_clients` is people the coach typed in.
      anyRow('clients', supabase.from('clients').select('id').eq('trainer_id', uid)),
      anyRow('coach_clients', supabase.from('coach_clients').select('id').eq('trainer_id', uid)),
      // 4 · hours on offer.
      anyRow('trainer_availability', supabase.from('trainer_availability').select('id').eq('trainer_id', uid)),
      // 5 · something to sell. Active only — a coach whose only package is
      //     deactivated has nothing purchasable, which is the state this row is
      //     about.
      anyRow('trainer_packages', supabase.from('trainer_packages').select('id').eq('trainer_id', uid).eq('active', true)),
      // 6 · Stripe. `charges_enabled` and not the presence of a row: an
      //     onboarding that was started and abandoned leaves a row behind, and
      //     ticking it would tell a coach they can take money when they cannot.
      supabase.from('connect_accounts').select('charges_enabled').eq('trainer_id', uid).maybeSingle(),
      // 7 · a NAMED code. `trainers.join_code` is the default code and every
      //     coach has one, so it cannot be what this row asks about — the item
      //     is about being able to tell one channel from another, which is what
      //     `coach_join_codes` is for. Revoked codes still count: they named a
      //     channel and their attribution still resolves.
      anyRow('coach_join_codes', supabase.from('coach_join_codes').select('id').eq('trainer_id', uid)),
      // 8 · paperwork. Retired documents still count for the same reason: the
      //     coach has done the thing this row is asking them to do.
      anyRow('coach_documents', supabase.from('coach_documents').select('id').eq('coach_id', uid)),
    ]);

    const val = <T,>(i: number): T | null =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value) : null;

    const cur = val<MyCurrency>(0);
    const rateRow = val<{ data: any; error: any }>(1);
    const linked = val<boolean | null>(2);
    const written = val<boolean | null>(3);
    const conn = val<{ data: any; error: any }>(6);

    // A book exists if EITHER source found somebody. Both unread is unknown;
    // one unread and the other holding a row is still a book, because a true
    // here is proof and a false is only the absence of proof in one place.
    const client: boolean | null =
      linked === true || written === true ? true
        : linked === null || written === null ? null
          : false;

    setFacts({
      // A refused read is null, not false. `trainers.delivery_mode` holds NULL
      // for a coach who has not been asked and for one who skipped, and both of
      // those are genuinely "not answered" — but only when the read itself came
      // back. Reading the data before the error is exactly how a refusal
      // becomes a nag to answer a question they already answered.
      mode: rateRow == null || rateRow.error ? null : (rateRow.data?.delivery_mode ?? null) != null,
      currency: currencyStepDone(cur),
      rate: rateRow == null || rateRow.error ? null : (rateRow.data?.session_fee ?? null) != null,
      client,
      availability: val<boolean | null>(4),
      package: val<boolean | null>(5),
      stripe: conn == null || conn.error ? null : conn.data?.charges_enabled === true,
      code: val<boolean | null>(7),
      document: val<boolean | null>(8),
    });
    setStatus('ready');
  }, []);

  useEffect(() => { void load(); }, [load, authRev]);

  return { facts, status, reload: load };
}
