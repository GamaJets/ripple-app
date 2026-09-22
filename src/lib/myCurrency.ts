// The two reads behind a coach's currency, and the one write that can set it.
//
// The impure half of src/lib/currencySource.ts, which holds the precedence rule
// and every decision this file makes about what an empty answer means. The
// split is the one every tested module in src/lib follows: `currencySource.ts`
// imports nothing and is run by `npm test`; this file imports the Supabase
// client and therefore cannot be.
//
// ── What it replaces, and why not just widen `myTenantCurrency` ───────────
//
// `myTenantCurrency()` in src/lib/subscriptions.ts answers one question —
// what does the gym on `profiles.tenant_id` charge in — and it answers it
// correctly, including the part that matters most: `{ currency: null, error:
// null }` for a coach with no gym, because "no gym is not a failure, and it is
// not a currency either".
//
// It is left exactly as it is. Widening it in place would have changed the
// meaning of a function five screens already call, silently, in the direction
// of "there is always an answer" — and two of those callers are outside this
// change. A new function that says what it returns is the smaller edit and the
// louder one.
//
// ── The one thing this must never do ──────────────────────────────────────
//
// Fall through to the coach's own column on a FAILED gym read. A refused
// `profiles` select gives no tenant_id, which is indistinguishable from a coach
// who has none — and a coach in a gym who is offered a currency picker on the
// strength of it can write a currency onto an account that already has one, or
// price their packages differently from the coach at the next desk. So the
// failure is carried, `resolveMyCurrency` checks it before it checks emptiness,
// and every screen gets 'unreadable' rather than a plausible answer.
import { supabase } from './supabase';
import { USE_SUPABASE } from './config';
import { reportError } from './reportError';
import { classifySetCoachCurrencyError, isCurrencyCode, isMissingColumn, readSetCurrency, type SetCurrencyOutcome, type SetCurrencyReply } from './coachCurrency';
import { resolveMyCurrency, type GymCurrencyRead, type MyCurrency, type OwnCurrencyRead } from './currencySource';

const NO_GYM: GymCurrencyRead = { hasGym: false, currency: null, failed: false };
const NO_ROW: OwnCurrencyRead = { hasRow: false, currency: null, failed: false, unavailable: false };

/**
 * What this coach is priced in, where it came from, and — when it is missing —
 * which of six things is missing.
 *
 * Two reads at most, never three, and never both halves: the gym is asked
 * first and the coach's own row is only read when there is provably no gym.
 * That is the precedence rule made physical — a screen cannot prefer the wrong
 * one because the wrong one was never fetched.
 */
export async function fetchMyCurrency(): Promise<MyCurrency> {
  // A build with no server is not a coach with no currency and not a failed
  // read. There is nowhere for one to live, which is what 'nowhere' says.
  if (!USE_SUPABASE) return resolveMyCurrency(NO_GYM, NO_ROW);
  try {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    // No session is a read we could not make, not a gym with no currency —
    // the same call src/lib/currencyGap.ts makes about `Not signed in.`
    if (authErr || !uid) {
      if (authErr) reportError('myCurrency.auth', authErr);
      return resolveMyCurrency({ hasGym: false, currency: null, failed: true }, NO_ROW);
    }

    const { data: prof, error: profErr } = await supabase.from('profiles').select('tenant_id').eq('id', uid).maybeSingle();
    if (profErr) {
      reportError('myCurrency.profile', profErr);
      return resolveMyCurrency({ hasGym: false, currency: null, failed: true }, NO_ROW);
    }
    const tid = (prof as { tenant_id: string | null } | null)?.tenant_id ?? null;

    if (tid) {
      const { data: ten, error: tenErr } = await supabase.from('tenants').select('currency').eq('id', tid).maybeSingle();
      if (tenErr) {
        reportError('myCurrency.tenant', tenErr);
        return resolveMyCurrency({ hasGym: true, currency: null, failed: true }, NO_ROW);
      }
      // A tenant_id that resolves to no readable row is still a gym — the
      // profile names one. It is a gym whose currency we do not have, which is
      // 'unreadable' rather than 'gym-unset', because RLS hiding the row and
      // the owner never choosing look identical from here and only one of them
      // is fixed by an owner.
      if (!ten) return resolveMyCurrency({ hasGym: true, currency: null, failed: true }, NO_ROW);
      return resolveMyCurrency(
        { hasGym: true, currency: (ten as { currency: string | null }).currency, failed: false },
        NO_ROW,
      );
    }

    // No gym. Only now is the coach's own column consulted.
    const { data: tr, error: trErr } = await supabase.from('trainers').select('currency').eq('id', uid).maybeSingle();
    if (trErr) {
      // An unapplied part 940 is a deploy step and must not reach a coach as
      // a failed read they can retry for ever.
      if (isMissingColumn(trErr)) return resolveMyCurrency(NO_GYM, { ...NO_ROW, unavailable: true });
      reportError('myCurrency.trainer', trErr);
      return resolveMyCurrency(NO_GYM, { ...NO_ROW, failed: true });
    }
    // `trainers_self_rw` is `for all using (auth.uid() = id)`, so a coach can
    // always see their own row. No row here is genuinely no row, not RLS.
    if (!tr) return resolveMyCurrency(NO_GYM, NO_ROW);
    return resolveMyCurrency(NO_GYM, { hasRow: true, currency: (tr as { currency: string | null }).currency, failed: false, unavailable: false });
  } catch (e) {
    reportError('myCurrency.fetch', e);
    return resolveMyCurrency({ hasGym: false, currency: null, failed: true }, NO_ROW);
  }
}

/**
 * The coach's own currency, named once.
 *
 * `set_my_coach_currency()` (part 940) is security definer and owns all three
 * refusals — you are in a gym, there is no record here, it is already set — so
 * this function does not restate any of them. The one thing checked before the
 * call is the SHAPE of the code, because a caller that is not the picker is the
 * only way a bad one gets here and a round trip to be told so is a round trip
 * wasted.
 *
 * Nothing is queued on a failure. Unlike a check-in this is a settings write
 * with nothing to lose by being tapped again, and a queued currency applied
 * hours later from another screen is precisely the silent reprice part 940
 * refuses.
 */
export async function setMyCoachCurrency(code: string): Promise<SetCurrencyOutcome> {
  if (!isCurrencyCode(code)) return 'bad-code';
  if (!USE_SUPABASE) return 'unsent';
  try {
    const { data, error } = await supabase.rpc('set_my_coach_currency', { p_currency: code });
    if (error) {
      const out = classifySetCoachCurrencyError(error as { code?: string | null; status?: number | null; message?: string | null });
      // An unapplied migration is not an error worth a report — it is the same
      // fact on every device until somebody runs the part.
      if (out !== 'no-column') reportError('myCurrency.setOwn', error);
      return out;
    }
    return readSetCurrency(data as SetCurrencyReply | null);
  } catch (e) {
    reportError('myCurrency.setOwn', e);
    return 'unsent';
  }
}
