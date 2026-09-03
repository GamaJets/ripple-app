// What a language model is told about the coach's currency.
//
// ── Why this is not `myCurrencyLine` ──────────────────────────────────────
//
// `myCurrencyLine` in src/lib/currencySource.ts writes the sentence a COACH
// reads on a screen: second person, addressed to them, and ending in what they
// should do about it ("you set it once in Settings"). Handing that string to a
// model as the value of a `currency` field puts an instruction to the coach
// inside a description of the coach, and the model then repeats it back at
// them as though it were advice it had formed.
//
// This writes the other half: a THIRD-person statement of what is known, for
// the context object, ending in the one thing the model must actually do.
//
// ── The bug it replaces ───────────────────────────────────────────────────
//
// Both `app/(trainer)/analytics.tsx` and `app/(trainer)/assistant.tsx` had a
// literal:
//
//     currency: gymCur ?? 'unknown — the gym has not set one, so state no amount'
//
// One string for five different reasons, four of which it describes wrongly.
// After part 940 the commonest of those reasons is a coach with NO GYM who has
// not chosen a currency yet — for whom "the gym has not set one" names an
// organisation that does not exist, and a model told that will write a
// paragraph advising them to speak to their gym owner. A failed read was
// described the same way, which turns a thirty-second outage into a business
// fact the model then reasons from.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// A code, or "unknown" plus the reason plus the instruction. Never a guess and
// never a default — there is no default currency anywhere in this app. Every
// state that is not a resolved code produces a string that begins with the word
// `unknown`, so a prompt can be scanned for it and a model cannot mistake a
// description of a gap for a currency.
import type { MyCurrency, MyCurrencyGap } from './currencySource';

/** The clause every unknown ends with. One instruction, worded once. */
const SAY_NOTHING = 'state no amount';

/**
 * The value to put in a model's context for "what is this coach priced in".
 *
 * `null` is the read that has not come back — the same thing a screen shows as
 * a spinner — and it is deliberately not folded into 'unreadable', because a
 * read in flight is not a read that failed.
 */
export function currencyForModel(cur: MyCurrency | null | undefined): string {
  const code = (cur?.currency || '').trim().toUpperCase();
  if (code) return code;
  return `unknown — ${reasonFor(cur ? cur.gap : 'reading')}, so ${SAY_NOTHING}`;
}

function reasonFor(gap: MyCurrencyGap | null): string {
  switch (gap) {
    case 'reading':
      return 'their currency has not been read yet';
    case 'unreadable':
      // The distinction that matters most here. A model told "none is set"
      // will reason about a coach who has not set one; the truth is that we
      // could not look.
      return 'their currency could not be read, which is not the same as none being set';
    case 'unavailable':
      return 'setting a currency of their own is not switched on in this deployment yet';
    case 'nowhere':
      return 'there is no coach record on this account for a currency to live on';
    case 'gym-unset':
      return 'they are in a gym and its owner has not set one';
    case 'own-unset':
      return 'they are attached to no gym and have not chosen one yet';
    // A null gap alongside no code is a contradiction — `resolveMyCurrency`
    // returns a gap whenever it returns no currency. Answered as unknown
    // rather than as anything a model could price from.
    case null:
      return 'their currency is not known';
  }
}
