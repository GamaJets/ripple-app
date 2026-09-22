// Whether "Set Your Currency" on the first-run list may be ticked.
//
// ── Three answers, not two ────────────────────────────────────────────────
//
// src/lib/coachFirstRun.ts takes `boolean | null` for every one of its eight
// facts and its header says why: a refused read turned into a confident `false`
// tells a coach they have not done something they have done, and the next thing
// that coach does is go and "fix" a working setting. Null is drawn as a dash,
// counted neither way, and stops the list calling itself finished.
//
// ── What was wrong here ───────────────────────────────────────────────────
//
// The step read `myTenantCurrency()`, which answers about a GYM:
//
//     currency: cur == null ? null : cur.currency ? true : cur.error ? null : false
//
// Correct for what it asked, and the wrong question since part 940. A coach
// with no gym gets `{ currency: null, error: null }` — "no gym is not a failure,
// and it is not a currency either" — which lands on `false`. So the step read
// NOT DONE, permanently: the coach followed it to Settings, set a currency of
// their own on `trainers.currency`, came back, and it still read not done,
// because the thing being asked was about a gym they do not have. A checklist
// item that can never tick is worse than one that is absent — it is the app
// insisting a coach has not done the thing they just did.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// Only the two gaps where a currency is genuinely UNSET are `false`. Everything
// else that is not a resolved code is `null` — because in each of those states
// the honest sentence is "we do not know", not "you have not done this":
//
//   'reading'     the read has not come back.
//   'unreadable'  it failed. Emphatically not a setting nobody made.
//   'unavailable' part 940 is not applied on this deployment. Tapping through
//                 to Settings would show a picker that cannot write, so the
//                 step must not ask them to.
//   'nowhere'     there is no `trainers` row for a currency to live on. There
//                 is nothing the coach can do about it from the checklist.
//
// 'gym-unset' IS false even though the coach cannot fix it themselves — the
// currency genuinely is not set, every money figure in the app genuinely is
// withheld, and the step's own copy sends them somewhere that explains it. The
// checklist reports the state of the account, not the division of labour.
import type { MyCurrency } from './currencySource';

/**
 * The first-run fact for the currency step.
 *
 * `null` in means the read itself did not come back — `Promise.allSettled`
 * rejected — which is the same unknown as a failed resolve.
 */
export function currencyStepDone(cur: MyCurrency | null | undefined): boolean | null {
  if (!cur) return null;
  if ((cur.currency || '').trim()) return true;
  return cur.gap === 'gym-unset' || cur.gap === 'own-unset' ? false : null;
}
