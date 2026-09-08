// Figures over three digits carry a thousands separator.
//
// Reported as "when you have more than 3 digits in a number add a comma."
// Half the screens called toLocaleString and half printed the raw number, so
// the same day's calories read 2,860 on the Meals hero and 2860 four lines
// down. A sweep fixes today; this stops the next figure being added raw.
//
// ── What it looks for ─────────────────────────────────────────────────────
//
// A value rendered into the UI whose NAME says it can pass a thousand —
// calories, volume, steps, revenue, a total — with no formatter anywhere on
// the line. It reads names rather than values because a value's range is not
// in the source: `kcal` is a number that reaches four digits in a weekly
// total and three in a snack, and the honest rule is that a field which can
// is formatted.
//
// ── What it deliberately does not flag ────────────────────────────────────
//
// Anything already passing through num(), num1() or toLocaleString on the same
// line. A <TextInput value=…>, where a separator would be typed back into the
// parser as a digit. And a name on the ignore list below, each with the reason
// it cannot exceed 999 written next to it — because "it is small" is a claim
// that needs to survive somebody changing the field.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The console renders the same kind of figure — a member count, a visit tally,
// a pass total — into the same kind of JSX, and a raw four-digit number is
// exactly as unreadable in a browser as on a phone. This rule is about the
// STRING a reader sees and nothing about React Native, so the console gets it.
//
// It is the console's own formatters that go in FORMATTED below, not the app's:
// `studio-web/lib/num.ts` argues at length why it cannot import src/lib/format
// — every function there asks `appLocale()`, a module-level latch seeded once,
// which in Next.js resolves on the server during render and again in the
// browser during hydration, on two machines with two locales. That is a silent
// hydration error. So the console has `num`, `num1` and `numUpTo` of its own,
// and `amount` in studio-web/lib/currency.ts for a gym-denominated figure.
const ROOTS = ['app', 'src/ui', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];
const ROOT = process.cwd();

/** Field-name fragments whose values pass a thousand in normal use. */
const BIG = /(kcal|calorie|volume|steps|revenue|payroll|earnings|total[A-Z]|Total\b|grams|mg\b|ml\b)/i;

/** Names that match BIG but genuinely cannot exceed 999, and why. */
const SMALL = new Map([
  ['totalSteps', 'a step counter in an onboarding flow — 5 of them'],
  ['totalSlots', 'bookable slots in one day'],
  ['kcalIn', 'a TextInput draft, typed by a person'],
  ['setKcal', 'a setState function, not a figure'],
  ['setKcalIn', 'a setState function, not a figure'],
  ['kcalNote', 'a sentence built elsewhere, already formatted'],
  ['dayVolumeNote', 'a sentence from tonnageNote in src/lib/bodyweightSets.ts — it carries a count of sets, never a tonnage'],
  ['totalPct', 'a percentage'],
  ['sessions_total', 'the size of a session pack — 5, 10, 20'],
  ['CYCLE_KCAL', 'the fixed carb-cycling step, a constant under 300'],
  ['grams', 'already a formatted range label — "132–165 g" — not a number'],
  // Added when the console joined ROOTS. Both are the SIZE OF ONE BOOK rather
  // than a tally across the gym, which is the distinction that matters here:
  // `passesTotal` on studio-web/app/passes is how many passes the gym has ever
  // issued and IS formatted, while these two are what is printed on a single
  // one of them.
  ['usesTotal', 'visits on one gym pass — a 10- or 20-visit book, or a year of daily entry; never four digits'],
  ['packTotal', 'sessions in one coaching pack — 5, 10, 20, exactly as sessions_total above'],
  // Not "cannot reach 999" but "is not a number at all" — the second kind of
  // entry on this list, which `kcalNote`, `grams` and `setKcal` above already
  // are. `payrollMoney` in studio-web/app/close/page.tsx is `money()`'s output:
  // a string with a currency code on the front, grouped by `minorMoney` at the
  // point it was built. BIG matches it on the bare word `payroll`, so no name
  // that still says what it holds can get past that; the local was renamed from
  // `payrollTotal` anyway, because a name ending in Total reads as a figure and
  // that is the confusion this gate ran into.
  ['payrollMoney', 'a money() string built where the currency is known — already grouped, and a separator on a string is nothing'],
]);

// `numUpTo` and `amount` are the console's, and both group: `numUpTo` is
// `toLocaleString` with a decimal cap, `amount` goes through `money()` in
// src/lib/gymRecord.ts and so through `minorMoney`. Neither matched the
// alternation before — `numUpTo(` is not `num` followed by a bracket — so a
// figure the console HAD formatted would have been reported raw.
const FORMATTED = /\b(num|num1|numUpTo|amount|money|toLocaleString|toFixed|catalogueValue)\s*[(.]/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (FORMATTED.test(line)) return;
      if (/<TextInput/.test(line)) return;
      // {expr} in JSX text, and ${expr} in a template literal.
      //
      // A JSX ATTRIBUTE — prop={value} — passes a number on rather than
      // printing it, and the screen that finally shows it is where the
      // separator belongs. Matching those flagged every prop named after a
      // figure, which teaches people to silence the check rather than read it.
      const exprs = [...line.matchAll(/(=)?\$?\{([A-Za-z_$][\w.$]*)\}/g)]
        .filter((m) => m[1] !== '=')
        .map((m) => m[2]);
      for (const expr of exprs) {
        const leaf = expr.split('.').pop();
        if (!BIG.test(leaf)) continue;
        if (SMALL.has(leaf) || SMALL.has(expr)) continue;
        findings.push(`${relative(ROOT, file)}:${i + 1}  {${expr}} — a figure that can pass a thousand, rendered raw`);
      }
    });
  }
}

if (findings.length) {
  console.error(`${findings.length} figure(s) rendered without a thousands separator:\n`);
  for (const f of findings) console.error('  ' + f);
  console.error(`\nWrap it in num() from src/lib/format — or, if it genuinely cannot reach 999,\nadd the name to SMALL in ${relative(ROOT, 'scripts/check-numbers.mjs')} with the reason.`);
  process.exit(1);
}
console.log('numbers ok — every four-digit-capable figure goes through a formatter');
