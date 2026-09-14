#!/usr/bin/env node
// A figure never states a currency, or a unit, that nobody chose.
//
// This is the bug this codebase has now produced twice, and both times it
// reached disk before anybody saw it on a screen.
//
// `money()` in src/lib/gymRecord.ts was declared `(cents, currency = 'AED')`.
// 33 call sites across ten console pages called it bare, and TWO OF THEM WROTE
// THE RESULT TO DISK: every settlement a non-UAE gym ever made was stored as
// dirhams and read back as fact by the accounting and month-end screens.
// Separately, the Members payment form had its LABEL corrected to the gym's own
// currency while the WRITE beside it was left alone, so a GBP gym's owner read
// "Amount (GBP)", typed 50, and 50 dirhams went permanently into the ledger.
//
// Both were fixed by hand. Hand-fixing does not hold a line — the second bug
// was created by the person fixing the first one, in the same file, on the same
// evening. This does hold it.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// `tenants.currency` is nullable ON PURPOSE, and setup.sql says why in as many
// words: NULL means the gym has not set one — render a dash and ask, never
// assume. `clients.weight_unit` and `clients.length_unit` are nullable for
// exactly the same reason: NULL means never chosen, not kilograms.
//
// So a figure whose currency (or unit) is unknown is WITHHELD. It is not
// printed bare — "6,300.00" beside a Pay button is read in whatever money the
// reader happens to be thinking in, which is the same wrong number with fewer
// clues — and it is not printed in a guess, because a guess that renders
// cleanly looks considered and nobody goes and fixes the setting.
//
// ── what this looks for ───────────────────────────────────────────────────
//
//  1. AN INVENTED CURRENCY. An ISO code as a fallback or a default:
//     `?? 'AED'`, `|| 'GBP'`, `currency = 'AED'`. This is the exact shape of
//     both bugs above. The database columns WERE `not null default 'AED'`,
//     which is what made the fallback invisible at every layer once it had been
//     written — the schema answered with the same guess the code did, so
//     nothing ever disagreed. supabase/parts/150 dropped those defaults (the
//     columns stay NOT NULL), so an omitted currency now fails the write with
//     23502 instead. That closes the storage half and not this one: a fallback
//     in the app still produces a currency nobody chose, and now it also
//     satisfies the NOT NULL and gets filed. This check is what stops it.
//
//  2. A BARE money() CALL. One argument, in a file that imports `money` from
//     gymRecord. `money()`'s currency parameter is `currency?:` rather than
//     `currency:` for one reason only — see the header on it — and this is
//     what makes it required in practice.
//
//  3. A HARDCODED SYMBOL OR CODE BESIDE A FIGURE. `$${total}`, `AED ${n}`,
//     `<Text>£{price}</Text>`, `label="Price ($)"`. A wrong symbol in front of
//     a number is not a cosmetic problem, it is a different amount.
//
//  4. A HARDCODED WEIGHT UNIT BESIDE A FIGURE. `${kg} kg`, `{weight} lb`.
//     Same rule, same reason: the client chose a unit or they did not.
//
//  5. AN INVENTED UNIT. `weightUnit: 'kg'` as a default, `unit: WeightUnit =
//     'kg'` as a parameter, `?? 'lb'` as a fallback. This is rule 1 for units,
//     and it is the rule that would have caught the defect the other four were
//     only symptoms of.
//
//     `src/ui/settings.tsx` declared `DEFAULTS.weightUnit = 'kg'` and resolved
//     the NULL column to it BEFORE `useSettings()` handed anything to a screen.
//     The store was honest — `clients.weight_unit` is null until somebody taps
//     a unit — and by the time any of the thirty screens that read it got a
//     look, "chose kilograms" and "was never asked" were the same value. A
//     member in the United States was shown kilograms everywhere, stated with
//     the confidence of their own choice, and told nothing. Five pure modules
//     had the same thing in a parameter: `unit: WeightUnit = 'kg'`, so a
//     forgotten argument was a silent relabel rather than a compile error, and
//     one of them (`parseWorkoutText`) decides what gets WRITTEN to the log.
//
//     What is legitimate, and what the `unit-ok:` marker is for: a table that
//     translates a KNOWN region, or a known metric, to the unit it is measured
//     in. `src/lib/unitPreference.ts` maps US→lb the way src/lib/billing.ts
//     maps gbp→£ — that is a translation of something somebody said, not a
//     stand-in for something nobody said. The difference is whether an answer
//     existed.
//
//  6. A CURRENCY IN A SENTENCE. `'Cancel after 12pm and the £10 fee applies'`.
//     Rule 3 above wants a FIGURE beside the symbol and finds it by looking for
//     an interpolation — `$${total}`, `£{price}`, `AED ${n}`. A lane
//     mutation-testing the two attendance screens wrote `£10` into a
//     member-facing sentence, with the number typed out in the string, and
//     every gate in this directory passed it including this one.
//
//     It is the same defect and it is worse placed. src/lib/classSeat.ts's
//     `seatNote` must never quote a late-cancellation fee at all — the fee owed
//     is the one stored in `class_booking_cancellations` at the moment of
//     cancelling, and quoting today's policy over last month's cancellation
//     bills a member a price nobody ever showed them; classSeat.test.ts asserts
//     "names no fee and no currency" for it. The two screens that RENDER those
//     outcomes had no equivalent guard. And Repple is white-labelled: there is
//     no symbol that is right for a London gym and a Dubai one at once, so a
//     symbol baked into a sentence is wrong for most tenants by construction.
//
//     See "what rule 6 scans" below for what a sentence is here, and for the
//     two things it deliberately treats differently.
//
// ── what rule 6 scans, and what it lets through ───────────────────────────
//
// It reads USER-FACING TEXT: the body of every quoted literal on the line, and
// in a `.tsx` file the JSX text between tags as well — including a bare
// continuation line, because React Native prose is written one sentence to a
// line with the tags on the lines above and below it.
//
// A span is only text at all if it reads as a SENTENCE — a word of three or
// more letters that is not itself a currency code. That single test is what
// separates this rule from the picker: `'AED'`, `'GBP'`, `'£'` alone are a
// catalogue entry, a validated code, a symbol table (src/lib/coachCurrency.ts
// lists 26 codes and src/lib/billing.ts maps gbp→£; neither is prose and
// neither is touched). Two tiers then apply, and they are not the same tier
// because the two things are not equally wrong:
//
//   A SYMBOL — £ € ¥ ₹ ₩ ₽ د.إ — anywhere in that sentence. There is no
//   reading of a white-labelled product in which a symbol typed into prose is
//   right: it is one gym's money asserted at every other gym's members. No
//   figure needs to be near it.
//
//   A CODE — the 26 in CODES — only where a FIGURE is beside it: `AED 450.00`,
//   `450.00 AED`, `AED450`. A code in a sentence with no number is almost
//   always the sentence NAMING what a code is, and this tree is full of those
//   for good reasons: `'A currency is its three-letter ISO code — GBP, AED,
//   EUR, USD'` is how src/lib/gymPolicy.ts refuses a bad one; src/lib/csvImport.ts
//   and studio-web/app/accounting/page.tsx both explain that "two for GBP, none
//   for JPY, three for KWD" is why a figure cannot be scaled without its
//   currency. Every one of those is the product being honest about exactly the
//   thing this file exists to protect, and a rule that reported them would be
//   arguing with its own case. A code with a number against it is a PRICE, and
//   a price is the thing that cannot be hardcoded.
//
// `$` is scanned only as `$` immediately before a digit. That is deliberate and
// it is the whole difficulty of this rule, the same one rule 3 has: `$` is a
// template-literal delimiter, a regex anchor, a `String.replace` group
// reference (`'$1-$2-$3T'` is in app/(client)/scans.tsx) and a SQL placeholder.
// A bare `$` scanned in prose would report all four and teach people to switch
// the gate off. `$10` inside a sentence is a price and nothing else.
//
// ── what it deliberately does not flag ────────────────────────────────────
//
// A currency code in a PICKER — the list an owner chooses from is a list of
// currencies and has to name them. A code being VALIDATED or PARSED. A symbol
// looked up FROM a known code, which is a translation rather than a guess
// (`src/lib/billing.ts` maps gbp→£ and prints the ISO code for anything it does
// not recognise; that is the honest version and it stays).
//
// ── the escape hatch, and why it takes a sentence ─────────────────────────
//
// Mark the line, or up to three lines above it:
//
//     // currency-ok: this is the picker an owner chooses their currency from
//     // unit-ok: a fixed label on a form field, not a rendered measurement
//
// The reason is the point of the marker, exactly as with `no-error-ok:` in
// check-reads.mjs. It is the sentence a reviewer reads when deciding whether a
// hardcoded currency in front of somebody's money is honestly fine here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

// The web console writes to the same money columns through the same helpers, so
// it has the same failure mode and gets the same rule.
//
// `studio-web/components` was missing from this list until it was noticed that
// the sentence above names the console and the array named two of its three
// directories. Nothing argued the omission; it was the shape check-text.mjs had
// — `.md` in the extension list and `docs/` absent from the roots, so the gate
// LOOKED covered and matched none of them. The seven files under it are the
// console's shared furniture, and `DataTable` and `Kpi` are where a figure is
// finally rendered, which is exactly where a currency goes missing. Adding it
// found nothing today, which is the only reason it could be added in one
// change rather than argued over: the floor is in gate-floor.mjs and a hit
// from here on is a regression rather than a backlog.
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];
const ROOT = process.cwd();

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── this is a ratchet, not an ignore list ─────────────────────────────────
 *
 * The count is the point. A file listed at 7 fails the build at 8, so the
 * backlog can shrink and can never grow: somebody adding the eighth hardcoded
 * kilogram to a file gets the same red build as somebody adding the first one
 * to a clean file. And a count that has dropped fails too, asking for the
 * number to come down with it — an exception that quietly over-states what is
 * wrong is how a list like this becomes an ignore list, one stale line at a
 * time. Removing the last one removes the entry.
 *
 * Every entry here is open work with a named fix, not an exemption. The
 * per-line escape hatch — `currency-ok:` / `unit-ok:` — is the other mechanism
 * and means something different: that line is CORRECT and will stay.
 */
const KNOWN = new Map([
  // ── the two rule 6 found ────────────────────────────────────────────────
  //
  // Both are in other lanes' files, so both are ratcheted and NEITHER is
  // annotated. A `currency-ok:` pasted into somebody else's screen by the
  // person who wrote the rule is the rule being switched off from the position
  // least able to judge the site, which is the one use an escape hatch must
  // never have. If the owner of either file decides the sentence is right as it
  // stands, the marker is theirs to write and the entry comes off this list.

  // A catalogue of the wording of every notification this product sends — the
  // `body` here is an EXAMPLE, not a rendered string, which is why it reads so
  // convincingly like one. It is still the only place in the tree where a
  // number and a currency are typed together into a member-facing sentence, and
  // a catalogue that models the wrong shape is where the wrong shape gets
  // copied from. [fix] word the example without the money — the sentence works
  // as "Invoice 0007 — Ten sessions." — or let the owner mark it
  // `currency-ok:` saying it is a catalogue entry and not a send.
  ['src/lib/notifyInbox.ts:currency-prose', { count: 1 }],

  // "USD 49 plus GBP 39 is not 88 of anything" — the platform console
  // explaining why it lists each currency separately instead of summing them.
  // The two codes are an ILLUSTRATION of the argument this whole file makes,
  // which is the best possible reason for a currency to appear in a sentence
  // and still not a reason the rule can see: a figure against a code is a
  // figure against a code. [fix] the illustration survives without the numbers
  // — "an amount in USD plus an amount in GBP is not an amount in anything" —
  // or the page's owner marks it `currency-ok:` with that sentence.
  ['studio-web/app/platform/page.tsx:currency-prose', { count: 1 }],

  // src/lib/exportShare.ts:money-arity — CLOSED. `OwnerReportData` now carries
  // `currency: string | null`, app/(owner)/dashboard.tsx passes the gym's own
  // `tenants.currency`, and the report prints the value line for a gym that has
  // chosen a currency and withholds it — with a sentence saying why — for one
  // that has not. With the last bare call gone, `money()` in src/lib/gymRecord.ts
  // takes `currency: string | null | undefined` REQUIRED, so a forgotten
  // currency is now a compile error and this rule no longer rests on the lint
  // alone. The entry is deleted rather than zeroed: a zero is still an
  // exemption, and there is nothing left to exempt.

  // src/lib/gymSessions.ts:currency — was 2, now 0. The original offence, and
  // the last currency one in the tree. The entry named its own edit and that is
  // exactly the edit made: `run.currency` is REQUIRED and written through, so a
  // caller with no currency is a compile error rather than a dirham stamped
  // onto a permanent payment record; and `fetchSettlements` reads `?? null`
  // with `Settlement.currency` typed `string | null`, so a settlement that
  // states no money is withheld by money() instead of printed as AED.
  //
  // The two console screens that render those rows — /sessions and /payroll —
  // now show a dash naming the missing currency where money() withholds, rather
  // than the empty cell a bare null would have left beside an Amount column.
  // The entry is deleted rather than zeroed, for the reason the header gives.

  // ── the unit backlog ────────────────────────────────────────────────────
  //
  // `clients.weight_unit` is nullable and NULL means never chosen, not
  // kilograms. These are the places that print the unit as a literal rather
  // than reading the member's own. Every one of them is a real defect for a
  // member reading in pounds; none of them is a wrong NUMBER, which is why they
  // are a ratchet rather than a stop-ship.
  //
  // The prerequisite this list used to name — "making that preference nullable
  // so 'never chosen' is expressible at all" — IS DONE. `src/ui/settings.tsx`
  // no longer resolves a NULL column to 'kg' before a screen sees it: the store
  // is null until somebody answers, `useSettings()` reports `weightChosen` and
  // `weightSource` beside the unit it renders, and an unanswered preference
  // falls to the handset's region and SAYS SO where the answer can be given.
  // src/lib/unitPreference.ts sets out why that side of the trade-off was taken
  // over withholding the figure the way `money()` does. Rule 5 below is what
  // stops a default unit coming back.
  //
  // The fix for each entry that remains is the same and it is not local: render
  // through `src/lib/units.ts` with `useSettings().weightUnit`, which is how the
  // screens that get this right already do it.
  // src/lib/progression.ts:unit — CLOSED by another change landing tonight: the
  // module now takes the unit as an argument, exactly as the entry said it had
  // to, so the seven prose cues no longer name a unit the module invented. The
  // entry is deleted rather than zeroed, for the same reason as the one above.
  // app/(client)/tools.tsx:unit — was 7, now 0. The calculators read the member's
  // own kg/lb preference, so the entry is gone rather than zeroed: a zero would
  // still be an exemption, and there is nothing left to exempt.
  // app/(client)/nutrition.tsx:unit — was 5, now 0. The store was always right
  // and the label was wrong, exactly as the entry said. The target and current
  // weights read through `weightLabel`; the three rates go through a local
  // `rateIn` rather than `weightDeltaIn`, because rounding a rate to the whole
  // pound would print an ordinary 0.25 kg-a-week cut as "1 lb a week", double
  // the truth. One more was found while fixing them and is not a figure at all:
  // "no time left to spread the remaining kilos over", a unit typed into prose
  // with no number beside it to look wrong.
  // app/(trainer)/dashboard.tsx:unit — was 2, now 0. Both were a client's weight
  // delta on the coach's roster, printed with a bare "kg" whatever the coach
  // reads in. They now go through `weightDeltaIn` with `useSettings().weightUnit`
  // taken on the COACH side, exactly as the entry said they needed to, and as
  // app/(trainer)/client-training.tsx already did. The entry is deleted rather
  // than zeroed: a zero is still an exemption, and there is nothing left to
  // exempt.
  // app/(client)/calendar.tsx:unit — was 1, now 0. The one-line summary under a
  // logged workout in a day cell reads through `liftLabel` with the member's own
  // unit. Its neighbour, the cardio distance, deliberately does not convert:
  // `c.unit` is stored on the entry because the member chose km or miles when
  // they logged the run, and a body-measurement preference must not overrule an
  // answer they already gave. Deleted rather than zeroed — a zero is still an
  // exemption and there is nothing left to exempt.
  // app/(client)/coach.tsx:unit — was 1, now 0. It was the worst-placed of the
  // set: the next-weight suggestion is not printed on the screen, it is handed
  // to a language model in `context` and written back to the member in the
  // second person, so a pounds reader was told in prose to put 60 kg on the bar
  // by something speaking as their coach. It reads through `liftLabel` with the
  // member's own unit, and `suggestProgression` is now given that unit too, so
  // the rationale sentence beside it stops naming kilograms as well. The entry
  // is deleted rather than zeroed: a zero is still an exemption, and there is
  // nothing left to exempt.
  // app/(client)/library.tsx:unit — was 1, now 0. The banked-set chip reads
  // through `liftLabel`, and so does its accessibility label, which said
  // "kilos" out loud and was the copy of the bug nobody could see.
  // app/(client)/scan-machine.tsx:unit — was 1, now 0. The logged-set chip
  // reads through `liftLabel`; a set with no load is still a dash, not a 0.
  // app/(trainer)/leaderboard.tsx:unit — was 1, now 0. The COACH's unit, as
  // the trainer-dashboard entry below still asks for, and converted as a span
  // through `weightDeltaIn` so a steady 0.4 kg does not flicker between 0 and 1.
  // studio-web/app/coach/roster/page.tsx:unit — was 1, now 0, and the entry is
  // deleted rather than zeroed for the reason the header gives: a zero is still
  // an exemption and there is nothing left to exempt.
  //
  // Its stated blocker — "the console has no unit preference at all to read" —
  // had stopped being true. `profiles.weight_unit` exists and is nullable, and
  // its schema comment says what it is for: "the unit this ACCOUNT reads
  // weights in, whatever its role. Null means never chosen." `loadMe()` was
  // already selecting that row, so the console learns the preference for the
  // cost of one more column. studio-web/lib/units.ts sets out whose unit a
  // roster column has to be in (the COACH's, not each client's — a column where
  // row four is in pounds is not a column) and why a null falls back to the
  // browser's region and says so rather than withholding the figure the way
  // money() withholds an amount.
]);

/** ISO 4217 codes this product has met, plus the ones a gym is likely to pick.
 *  A code is only interesting to this check when it is being INVENTED — used
 *  as a fallback, a default, or printed beside a figure. */
const CODES = [
  'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP',
  'USD', 'GBP', 'EUR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN',
  'AUD', 'NZD', 'CAD', 'ZAR', 'INR', 'PKR', 'SGD', 'MYR', 'JPY', 'CNY', 'TRY',
];
const CODE = CODES.join('|');

/** The symbols that carry an amount. Not a full set on purpose — these are the
 *  ones that have actually been typed into this repo beside a figure. */
const SYMBOL = '[$£€¥₹₩₽]';

/* ── rule 6's vocabulary ───────────────────────────────────────────────────
 *
 * Separate constants from SYMBOL above on purpose. SYMBOL is the set that shows
 * up BESIDE AN INTERPOLATION, where `$` has to be in the set because `$${x}` is
 * the commonest form of that bug. Rule 6 reads prose, where a bare `$` is four
 * other things (see the header) and only `$` before a digit is money.
 */

/** A currency symbol standing in a sentence. `د.إ` is here and `$` is not; the
 *  header says why. */
const SYMBOL_IN_PROSE = /[£€¥₹₩₽]|د\.إ/;

/** A dollar amount typed out: `$10`, `$ 10`. Not a bare `$`. */
const DOLLAR_FIGURE = /\$ ?\d/;

/** A code with a FIGURE against it — a price rather than the name of a code.
 *  One character of slack either side and no more: `AED 450.00`, `450 AED`,
 *  `AED450`. `'…,month,AED,yes'` (a CSV example header in
 *  studio-web/app/import/page.tsx) has a word between the two and is not a
 *  price; neither is `'two for GBP, none for JPY, three for KWD'`. */
const CODE_PRICED = new RegExp(`\\b(?:${CODE})\\s?\\d|\\d\\s?(?:${CODE})\\b`);

/** Every code, for stripping before the sentence test below. */
const CODE_ANYWHERE = new RegExp(`\\b(?:${CODE})\\b`, 'g');

/**
 * Is this span a SENTENCE rather than a catalogue entry?
 *
 * A word of three or more letters that is not itself a currency code. This one
 * test is what lets the 26-code list in src/lib/coachCurrency.ts, the symbol
 * table in src/lib/billing.ts and every `'GBP'` being parsed or validated
 * through untouched, without a single exception being written for them — see
 * the header. It is deliberately cheap and deliberately generous: a rule about
 * what a MEMBER READS has no business guessing at anything subtler than "are
 * there words here".
 */
function readsAsProse(span) {
  return /(?:^|[^A-Za-z])[A-Za-z]{3,}(?:[^A-Za-z]|$)/.test(span.replace(CODE_ANYWHERE, ' '));
}

/**
 * The user-facing text on one line: the body of every quoted literal, plus — in
 * a `.tsx` file — the JSX text between tags.
 *
 * The last clause is the one that matters for the defect this rule was written
 * for. React Native prose is written
 *
 *     <Text style={s.note}>
 *       Cancel after 12pm and the £10 fee applies.
 *     </Text>
 *
 * so the sentence sits on a line of its own with no tag on it at all. A line in
 * a `.tsx` file holding neither `<` nor `>` outside a literal is JSX text or it
 * is nothing this rule can be fooled by: an identifier cannot contain `£`, and
 * a string containing one was already returned as a literal above.
 */
function userFacingText(line, tsx) {
  const spans = [];
  let plain = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === c) break;
        j++;
      }
      spans.push(line.slice(i + 1, j));
      plain += ' '.repeat(Math.min(j, line.length) - i + 1);
      i = j + 1;
      continue;
    }
    plain += c;
    i++;
  }
  if (!tsx) return spans;
  for (const m of plain.matchAll(/>([^<>]*)</g)) spans.push(m[1]);
  if (!plain.includes('<') && !plain.includes('>')) spans.push(plain);
  return spans;
}

/** Weight units. Length units are deliberately absent: "in" is a preposition
 *  and "cm" is rare enough to have produced nothing, so including them would
 *  cost more in silenced lines than it catches. */
const WEIGHT_UNIT = '(?:kgs?|lbs?)';

/** For rule 5, where the unit is a QUOTED LITERAL rather than a word floating
 *  in prose. Length is included here and absent above for that reason: `'in'`
 *  in quotes, assigned to something called a unit, is unambiguous in a way that
 *  a bare "in" between two words is not. */
const ANY_UNIT = "(?:kgs?|lbs?|cm|in)";

/** The names a unit preference goes by in this tree. */
const UNIT_NAME = '(?:weightUnit|lengthUnit|weight_unit|length_unit)';

/**
 * Rule 5's shapes, one per line so each can be argued with separately.
 *
 * Deliberately NOT matched: `unit: 'kg'` as a plain object field. That is how
 * src/lib/inbodyMetrics.ts and src/lib/goalTargets.ts describe what a METRIC is
 * measured in — fat mass is in kilograms because the InBody reports kilograms,
 * which is a fact about the machine and not a guess about a reader. Only the
 * preference's own names (`weightUnit`, `lengthUnit`) are matched in that
 * position, which is exactly where the DEFAULTS bug lived.
 */
const INVENTED_UNIT = [
  // `?? 'kg'`, `|| 'lb'` — a unit standing in for one nobody set.
  new RegExp(`(?:\\?\\?|\\|\\|)\\s*'${ANY_UNIT}'`),
  // `weightUnit: 'kg'` — the DEFAULTS bug itself.
  new RegExp(`\\b${UNIT_NAME}\\s*\\??\\s*:\\s*'${ANY_UNIT}'`),
  // `unit: WeightUnit = 'kg'` / `wu = 'kg'` — a defaulted parameter. The `=` is
  // guarded against `===`, which is a comparison and is how every one of these
  // unions is legitimately narrowed.
  new RegExp(`\\b(?:unit|wu|lu|${UNIT_NAME})\\s*(?::\\s*(?:Weight|Length)Unit\\s*)?(?<![=!<>])=(?!=)\\s*'${ANY_UNIT}'`),
  // `return 'kg'` — the same invention with a function wrapped round it, which
  // is the shape studio-web/app/close/page.tsx hid a currency in.
  new RegExp(`\\breturn\\s*'${ANY_UNIT}'`),
];

const files = [];

// ── a scan that was cut short must not read as a clean one ────────────────
//
// Lanes write this tree while gates run over it, so a file listed by readdir
// and gone by the time it is stat'd or read is an ordinary event here, not a
// defect. What was NOT ordinary is what used to happen next: the throw went up
// to `try { walk(root) } catch {}` at the bottom of this file, whose comment
// says it is there for "a root that is not there yet" — so it swallowed the
// vanished file AND every file after it in that root, and the run then printed
// ok over a tree it had partly not opened.
//
// A gate whose final line names a file count is making a claim about coverage.
// So: a disappearance is survived per entry, counted, and said out loud. The
// root-level catch now tolerates only the root itself being absent; anything
// else is a real fault and is allowed to be one.
let vanished = 0;
const gone = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); }
  catch (e) { if (gone(e)) { vanished++; return; } throw e; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); }
    catch (e) { if (gone(e)) { vanished++; continue; } throw e; }
    if (st.isDirectory()) walk(p);
    // Tests are excluded: their whole job is to pin what a named currency
    // renders as, so every assertion in them looks exactly like offence 3.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
  }
}
// Counted per ROOT. `walk` swallows a missing directory — the `catch` right here
// is what swallows it — so a renamed root contributed zero silently and only a
// single total stood behind it. See scripts/gate-floor.mjs for why a total is
// not a guard.
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  try { walk(r); }
  catch (e) { if (!gone(e)) throw e; /* only the root itself may be absent */ }
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:currency', perRoot);

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, for the same
// reason.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

/**
 * A `currency-ok:` / `unit-ok:` marker on this line, or anywhere in the comment
 * immediately above it.
 *
 * check-reads.mjs looks at a fixed three lines. That is right for `no-error-ok:`,
 * which annotates one read — and wrong here, because the thing being excused is
 * usually a small BLOCK (the three lines that map gbp→£, the six that map a
 * settlement row) under one explanation. A fixed window excused the first line
 * of such a block and flagged the rest, which teaches people to paste the
 * marker three times rather than write the reason once.
 *
 * So: the whole contiguous run of comment and blank lines above the hit, plus
 * the hit itself. Blank lines are included so a paragraph break inside an
 * explanation does not silently end it.
 */
function excused(lines, commented, i) {
  if (/(currency|unit)-ok:\s*\S/.test(lines[i])) return true;
  for (let j = i - 1; j >= 0; j--) {
    const blank = lines[j].trim() === '';
    if (!commented[j] && !blank) break;
    if (/(currency|unit)-ok:\s*\S/.test(lines[j])) return true;
  }
  return false;
}

/** Comment lines describe bugs rather than commit them, and this repository's
 *  comments are full of prose about "AED" and "(GBP)" for exactly that reason —
 *  every fix in this area explains the wrong version at length before the right
 *  one. Line comments are easy; the block form is what actually matters here,
 *  because a JSX `{/* … *\/}` explaining a currency label runs to six lines and
 *  only the first of them starts with a slash. */
function commentedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((line, i) => {
    if (inBlock) {
      out[i] = true;
      if (line.includes('*/')) inBlock = false;
      return;
    }
    if (/^\s*\/\//.test(line)) { out[i] = true; return; }
    const open = line.lastIndexOf('/*');
    if (open !== -1 && line.indexOf('*/', open) === -1) {
      inBlock = true;
      // A line that OPENS a block still has code before it in the JSX case
      // (`{/*`), so it counts as commented only when nothing precedes the
      // opener but whitespace or a brace.
      out[i] = /^[\s{]*$/.test(line.slice(0, open));
      return;
    }
    out[i] = /^\s*[{]?\s*\/\*.*\*\/\s*[}]?\s*$/.test(line);
  });
  return out;
}

/** The top-level argument count of the call starting at `from` in `line`, or
 *  null when the call runs past the end of the line and cannot be judged. */
function argCount(line, from) {
  let depth = 0;
  let args = 0;
  let seen = false;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1) continue; }
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return seen ? args + 1 : 0;
      continue;
    }
    if (depth === 1) {
      if (c === ',') args++;
      else if (!/\s/.test(c)) seen = true;
    }
  }
  return null;
}

/** Every hit, in file order, each tagged with the KNOWN key it counts against. */
const findings = [];

/* Rule 6's empty-set guard. The file count above says the walk found files; it
 * says nothing about whether `userFacingText` still recognises a sentence when
 * it sees one — a one-character slip in it would leave rule 6 reading no text
 * at all in 1,070 files and reporting that every sentence in the product is
 * clean. The floor is the invariant, not today's number: `app`, `src` and the
 * console are three user-facing products and cannot between them hold fewer
 * than twenty thousand sentences. There were 78,043 on 14 September 2026. */
let proseSpans = 0;
const PROSE_FLOOR = 20_000;

function flag(file, i, kind, what, fix) {
  const rel = relative(ROOT, file);
  findings.push({ key: `${rel}:${kind}`, where: `${rel}:${i + 1}`, what, fix });
}

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const lines = src.split('\n');
  const commented = commentedLines(lines);
  // Rule 2 only applies where `money` is gymRecord's. `money` in
  // src/lib/billing.ts is a different function with a different contract — it
  // takes Stripe's own currency and already refuses to guess one.
  const usesGymMoney = /import\s*\{[^}]*\bmoney\b[^}]*\}\s*from\s*'[^']*gymRecord'/.test(src);

  lines.forEach((line, i) => {
    if (commented[i] || excused(lines, commented, i)) return;

    // ── 1. an invented currency ──────────────────────────────────────────
    // `?? 'AED'`, `|| 'AED'`, `currency = 'AED'`, `: 'AED'` in a default.
    // `return 'AED'` is the same invention wearing a function around it —
    // studio-web/app/close/page.tsx had exactly that as the last line of a
    // `currencyOf(record)` helper, so a month-end close with no priced row in
    // it reported itself in dirhams.
    const invented = line.match(new RegExp(`(\\?\\?|\\|\\||=|\\breturn)\\s*'(${CODE})'`));
    if (invented) {
      if (rel === 'src/lib/billing.ts' || rel === 'studio-web/lib/currency.ts') {
        // These two are the honest doors and neither invents anything; they are
        // only ever handed a currency somebody stored.
      } else {
        flag(file, i, 'currency', `\`${invented[0]}\` — a currency nobody chose, as a fallback`,
          'Pass the gym\'s own currency through, and withhold the figure (or refuse the write) when it is null.');
        return;
      }
    }

    // ── 2. a bare money() call ───────────────────────────────────────────
    if (usesGymMoney) {
      const re = /(?<![A-Za-z0-9_.$])money\s*\(/g;
      let m;
      while ((m = re.exec(line))) {
        const n = argCount(line, m.index + m[0].length - 1);
        if (n === 1) {
          flag(file, i, 'money-arity', 'money() called with an amount and no currency',
            'Pass the currency it is an amount of. It renders a dash without one, which is honest but silent.');
        }
      }
    }

    // ── 3. a hardcoded symbol or code beside a figure ────────────────────
    // `$${x}` / `£{x}` in JSX / `'AED ' + n` / `AED ${n}` / `(GBP)` on a label.
    // Written out one shape at a time rather than as one clever expression.
    // The `$` is the whole difficulty: `${x}` is an interpolation and `$${x}`
    // is a dollar sign in front of one, and a pattern that cannot tell them
    // apart flags every template literal in the app — which is how a check
    // teaches people to switch it off rather than read it.
    const beside = [
      /\$\$\{/,                                            // `$${total}`
      /[£€¥₹₩₽]\s*\$?\{/,                                   // `£${x}` and <Text>£{x}</Text>
      // `\$(?!\{)` throughout: a `$` that opens an interpolation is not a
      // dollar sign, and treating it as one flagged every arrow function whose
      // body ends in a template literal.
      /\$\{[^}]*\}\s*(?:[£€¥₹₩₽]|\$(?!\{))/,                 // `${x}$`
      />\s*\{[^}]*\}\s*(?:[£€¥₹₩₽]|\$(?!\{))/,               // <Text>{x}£</Text>
      new RegExp(`\\b(${CODE})\\s*\\$\\{`),                  // `AED ${x}`
      new RegExp(`\\b(${CODE})\\s+\\{[A-Za-z_$][\\w.$]*\\}`),  // <Text>AED {x}</Text>
      new RegExp(`'(${CODE}) ?'\\s*\\+`),                    // 'AED ' + n
      /['"`][$£€¥₹₩₽]['"`]\s*\+/,                          // '$' + n
      new RegExp(`\\(\\s*(${CODE})\\s*\\)`),                 // a label reading "Price (AED)"
      /\(\s*[$£€¥₹₩₽]\s*\)/,                               // a label reading "Price ($)"
      // `<Text>${fee}</Text>` — a dollar sign in front of a JSX EXPRESSION
      // CONTAINER, which is the one shape of this rule the list above could
      // not see. `$${x}` is a dollar before a template interpolation and was
      // covered; `£{x}` is a symbol before a JSX container and was covered;
      // `${x}` is BOTH a dollar-before-a-container and, character for
      // character, an ordinary template interpolation — so it was left out
      // rather than flag every template literal in the app.
      //
      // That gap is where the bug lived: app/(client)/trainers.tsx printed
      // `<Text …>${c.sessionFee}</Text>` in the Find a Trainer directory, so
      // every coach priced in dirhams was quoted to clients in dollars, on the
      // one figure somebody picks a coach by. The coach's own profile screen
      // had been corrected and told them "Repple does not print a symbol it has
      // not been told"; this was the half still printing one.
      //
      // Disambiguated two ways, both cheap and both checked against the whole
      // tree: only in `.tsx` (JSX lives there; the HTML builders that legitimately
      // write `>${` are .ts), and only on a line with no backtick on it (a
      // template literal spanning lines opens on an earlier one). Together those
      // give zero false positives across app, src and studio-web.
      ...(rel.endsWith('.tsx') && !line.includes('`') ? [/>\s*\$\{/] : []),
    ].find((r) => r.test(line));
    if (beside) {
      flag(file, i, 'currency', `a currency typed beside a figure — ${(line.match(beside) || [''])[0].trim()}`,
        'Let the formatter state the currency (money()/gymMoney()/amount()), so the figure and its currency cannot drift apart.');
      return;
    }

    // ── 6. a currency in a sentence ──────────────────────────────────────
    // Rule 3 above needs an interpolation to find the figure. This one needs
    // no figure at all for a symbol, and a typed-out one for a code. See the
    // header for what a sentence is here and why the two tiers differ.
    for (const span of userFacingText(line, rel.endsWith('.tsx'))) {
      if (!readsAsProse(span)) continue;
      proseSpans++;
      const symbol = span.match(SYMBOL_IN_PROSE) || span.match(DOLLAR_FIGURE);
      const priced = symbol ? null : span.match(CODE_PRICED);
      if (!symbol && !priced) continue;
      flag(file, i, 'currency-prose',
        symbol
          ? `a currency symbol typed into a sentence a member reads — \`${symbol[0]}\` in "${span.trim().slice(0, 72)}"`
          : `a price stated in one gym's currency, in a sentence — \`${priced[0]}\` in "${span.trim().slice(0, 72)}"`,
        'Repple is white-labelled: no symbol is right for a London gym and a Dubai one at once. '
        + 'Word the sentence without the money and let the formatter state the figure and its currency '
        + 'together (money()/gymMoney()/amount()) — and if the sentence is about a FEE, read the fee '
        + 'that was stored when it was incurred, never today\'s policy: src/lib/classSeat.ts says why.');
      return;
    }

    // ── 5. an invented unit ──────────────────────────────────────────────
    // Before rule 4's early return, not after it: every shape of this rule
    // mentions a unit preference by name, which is precisely what that return
    // treats as evidence the line is written correctly.
    const madeUp = INVENTED_UNIT.find((r) => r.test(line));
    if (madeUp) {
      flag(file, i, 'unit-default', `a unit nobody chose, as a default — ${(line.match(madeUp) || [''])[0].trim()}`,
        'Take the unit as an argument and let an absent one stay absent. clients.weight_unit is NULL '
        + 'until somebody taps a unit, and a caller with none to pass does not know rather than means kg.');
      return;
    }

    // ── 4. a hardcoded weight unit beside a figure ───────────────────────
    // Skipped wherever the line already reads a unit preference, which is what
    // a correctly-written one looks like.
    if (/\b(wu|lu|unit|units|weightUnit|lengthUnit|weight_unit|length_unit)\b/.test(line)) return;
    const unit = line.match(new RegExp(`\\}\\s*${WEIGHT_UNIT}\\b|\\$\\{[^}]*\\}\\s*${WEIGHT_UNIT}\\b`));
    if (unit) {
      flag(file, i, 'unit', `a weight unit typed beside a figure — ${unit[0].trim()}`,
        'Render the client\'s own unit. clients.weight_unit is nullable and NULL means never chosen, not kilograms.');
    }
  });
}

/* ── the ratchet ───────────────────────────────────────────────────────────
 *
 * Findings are counted per KNOWN key. A file listed at 7 passes at 7 or fewer
 * and fails at 8, so the backlog can only ever shrink — the eighth hardcoded
 * kilogram in a listed file is as red as the first one in a clean file. A count
 * that has DROPPED fails too, with a different message: the number comes down
 * with the work, or the list slowly stops describing the tree.
 */
if (proseSpans < PROSE_FLOOR) {
  console.error(`check-currency: rule 6 found only ${proseSpans} sentence${proseSpans === 1 ? '' : 's'} of user-facing text `
    + `across ${files.length} files, expected at least ${PROSE_FLOOR}. These are three products people read, so its `
    + 'reader has stopped recognising prose and "no currency in a sentence" would be a claim about text it never saw. '
    + 'Refusing to pass.');
  process.exit(1);
}

const seen = new Map();
for (const f of findings) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);

const fresh = [];       // hits in files nobody has listed, or over the listed count
const shrunk = [];      // listed counts that are now too high
const stale = [];       // listed keys that match nothing at all

for (const f of findings) {
  const allowed = KNOWN.get(f.key)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // Report the overflow, not the first N — which of a file's seven is "the new
  // one" is not knowable, so the whole file is shown when it goes over.
  if (seen.get(f.key) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || stale.length || shrunk.length) {
  if (fresh.length) {
    console.error(`${fresh.length} figure${fresh.length === 1 ? '' : 's'} stating a currency or unit nobody chose:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}`);
      console.error(`    ${f.what}`);
      console.error(`    \u2192 ${f.fix}\n`);
    }
    console.error('A figure whose currency is unknown is WITHHELD — not printed bare, not printed in a guess.');
    console.error('If this line is genuinely fine, mark it `currency-ok: <why>` (or `unit-ok: <why>`) and');
    console.error('say why in a sentence — the reason is the whole point of the marker.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-currency.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have been fixed. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-currency.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `currency ok — ${files.length} files across the apps and the console; ` +
  'every figure names a currency somebody chose, or is withheld' +
  (open ? `. ${open} listed offence${open === 1 ? '' : 's'} remain open in KNOWN and cannot grow.` : '.'),
);
