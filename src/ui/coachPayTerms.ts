// The two reads behind a coach's own pay terms.
//
// The impure half of src/lib/coachPayTerms.ts, which holds every decision about
// what an empty answer means. The split is the one every tested module in
// src/lib follows: that file imports nothing and is run by `npm test`; this one
// reaches Supabase and therefore cannot be.
//
// ── What is read, and why the gym half is one row ─────────────────────────
//
//   · `gym_trainer_pay` — the standing rate this gym agreed with THIS coach.
//     Readable by them since supabase/parts/183: `gym_trainer_pay_self_r` is
//     `trainer_id = (select auth.uid())`, and nothing in the coach app had ever
//     selected it. The filter here restates that policy rather than trusting
//     it, because a read scoped only by RLS is a read whose correctness lives
//     in another file.
//
//   · the gym's own row, through `fetchGymProfile` — for `session_pay_policy`,
//     `currency` and `session_fee` TOGETHER. One read rather than three,
//     deliberately: those three facts are shown as one paragraph (what a
//     session with no rate of its own is worth, in what money, and which
//     outcomes carry one at all), and taking them from two reads a moment apart
//     is how a screen comes to print a fee from before a change beside a policy
//     from after it. `useTenant` already holds two of the three and not the
//     policy; widening that provider would have put a coach-only column on the
//     one read every owner screen in the app depends on.
//
// ── A failed read is not "nothing is set" ─────────────────────────────────
//
// Both halves carry their failure into `status`, and `worstStatus` folds them,
// so a card is only ever built from two reads that both landed. src/lib's
// `rateCard` refuses anything that is not 'ready' — which is the house rule,
// and here it is the difference between "your gym has agreed no rate with you"
// and "we could not ask". The first sentence, said to an employed coach over a
// timeout, is the worst thing this screen could print.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { sessionUid } from '../lib/sessionUid';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { fetchGymProfile } from '../lib/gymPolicy';
import {
  rateCard, policyView, type AgreedPay, type GymLink, type RateCard, type PolicyView, type StandingFee,
} from '../lib/coachPayTerms';
import type { ClassPayKind } from '../lib/gymPay';
import { worstStatus, type LoadStatus } from './loadStatus';
import { useTenant } from './tenant';
import { useAuthRevision } from './authRevision';

export interface PayTerms {
  /** The worse of the two reads, and of the tenant read they both hang off. */
  status: LoadStatus;
  card: RateCard;
  policy: PolicyView;
  refresh: () => void;
}

const NO_FEE: StandingFee = { fee: null, currency: null };

/** A `class_pay_kind` this build understands, or null. An unrecognised value is
 *  not one of the two — an amount whose counting rule we cannot read is an
 *  amount that must not be described, for the reason part 183 gives about "80
 *  per class" and "8 per head" being the same digits. */
function classKindOf(v: unknown): ClassPayKind | null {
  return v === 'per_class' || v === 'per_attendee' ? v : null;
}

/** A numeric column that PostgREST may hand back as a string, as a number —
 *  and anything unparseable as null rather than as a figure beside a currency
 *  code. The same reading `fetchGymProfile` performs on `session_fee`. */
function centsOf(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * What this coach's gym has agreed to pay them, and which outcomes it pays for.
 *
 * Returns 'no_gym' answers — not empty ones — for the account with no tenant,
 * which is most of the coaches on this product. That case costs no reads at
 * all: there is no gym row to ask about and no rate that could exist, since
 * `gym_trainer_pay_owner` is the only policy that may write one.
 */
export function useMyPayTerms(): PayTerms {
  const { tenant, status: tenantStatus } = useTenant();
  const authRev = useAuthRevision();
  const [pay, setPay] = useState<AgreedPay | null>(null);
  const [standing, setStanding] = useState<StandingFee>(NO_FEE);
  const [policy, setPolicy] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState<LoadStatus>('loading');
  const [tick, setTick] = useState(0);

  const tenantId = tenant?.id ?? null;

  // 'none' only once the tenant read has ANSWERED. Under 'loading' and 'error'
  // this is 'unknown', which is what stops "there is no gym attached to this
  // account" being said to a coach whose profile read timed out — the exact
  // substitution src/lib/currencySource.ts was written to prevent.
  const link: GymLink = tenantStatus === 'ready'
    ? (tenantId ? 'gym' : 'none')
    : 'unknown';

  const load = useCallback(async (cancelled: () => boolean) => {
    if (!USE_SUPABASE) { setReadStatus('ready'); return; }
    // Nothing to read, and nothing unknown either: with no gym there is no row
    // that could hold a rate. 'ready' is the honest status for a question that
    // has an answer without asking.
    if (!tenantId) { setPay(null); setStanding(NO_FEE); setPolicy(null); setReadStatus(tenantStatus === 'ready' ? 'ready' : 'loading'); return; }
    setReadStatus('loading');
    try {
      // ── who is asking, and why the error beside it had to be read ───────
      //
      // getSession and not getUser, which stays true and is the deliberate
      // choice: getSession answers from device storage and therefore answers
      // offline. The reason written beside it was not true — it said getUser
      // REJECTS with nobody signed in. It does not; src/lib/authReadFate.ts
      // quotes the installed auth-js, where every AuthError RESOLVES, and
      // `getSession()` resolves with `{ data: { session: null }, error }` the
      // moment a stored access token has expired and the refresh cannot reach
      // the server.
      //
      // `error` was not named here, so that outage arrived as `uid === null`
      // and this hook answered 'error' — which happens to be the cautious
      // status, so this site never printed "your gym has agreed no rate with
      // you" over a timeout. What it did do was give the outage nowhere to be
      // seen: no report, and the same status as a refusal. `sessionUid` names
      // the error, classifies it once, and reports the unreadable half under
      // this hook's own key.
      const who = await sessionUid('coachPayTerms.load');
      if (cancelled()) return;
      // Both fates stay 'error', and deliberately: this is the money paragraph
      // a coach reads to learn what their gym pays them, and neither "nobody is
      // signed in" nor "we could not ask" is a rate. `rateCard` refuses
      // anything that is not 'ready', so neither one can be printed as terms.
      // Told apart by `fate`, never by `!who.uid` — `string` includes '', so
      // `!who.uid` does not narrow the union.
      if (who.fate !== null) { setReadStatus('error'); return; }
      const uid = who.uid;

      const [rate, gym] = await Promise.all([
        supabase.from('gym_trainer_pay')
          .select('session_rate_cents, class_pay_kind, class_rate_cents, currency, updated_at')
          .eq('tenant_id', tenantId).eq('trainer_id', uid).maybeSingle(),
        fetchGymProfile(supabase, tenantId),
      ]);
      if (cancelled()) return;

      // `error` first and separately from `data`. On a refusal both a null data
      // and an error are present, and reading data first is precisely how a
      // refusal becomes "your gym has set no rate for you".
      if (rate.error) { reportError('coachPayTerms.rate', rate.error); setReadStatus('error'); return; }
      if (gym.error) { reportError('coachPayTerms.gym', gym.error); setReadStatus('error'); return; }

      const r = rate.data as Record<string, unknown> | null;
      setPay(r ? {
        sessionRateCents: centsOf(r.session_rate_cents),
        classPayKind: classKindOf(r.class_pay_kind),
        classRateCents: centsOf(r.class_rate_cents),
        currency: (r.currency as string | null) ?? null,
        updatedAt: (r.updated_at as string | null) ?? null,
      } : null);
      setStanding({ fee: gym.profile?.sessionFee ?? null, currency: gym.profile?.currency ?? null });
      setPolicy(gym.profile?.payPolicy ?? null);
      setReadStatus('ready');
    } catch (e) {
      // A throw out of the fetch is nobody answering, never a refusal — and
      // never an absence of terms.
      reportError('coachPayTerms.load', e);
      if (!cancelled()) setReadStatus('error');
    }
  }, [tenantId, tenantStatus]);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load, authRev, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Both halves or nothing. The card describes a rate AND what a session with
  // no rate is worth, so it is only as complete as the worse of the two reads
  // it is built from — and of the tenant read that decides whether there is a
  // gym at all.
  const status = worstStatus(tenantStatus, readStatus);

  return useMemo<PayTerms>(() => ({
    status,
    card: rateCard(link, pay, status, standing),
    policy: policyView(link, status, policy),
    refresh,
  }), [status, link, pay, standing, policy, refresh]);
}
