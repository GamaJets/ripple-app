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

const ROOTS = ['app', 'src/ui'];
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
  ['totalPct', 'a percentage'],
  ['sessions_total', 'the size of a session pack — 5, 10, 20'],
  ['CYCLE_KCAL', 'the fixed carb-cycling step, a constant under 300'],
  ['grams', 'already a formatted range label — "132–165 g" — not a number'],
]);

const FORMATTED = /\b(num|num1|money|toLocaleString|toFixed|catalogueValue)\s*[(.]/;

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
      const exprs = [...line.matchAll(/\$?\{([A-Za-z_$][\w.$]*)\}/g)].map((m) => m[1]);
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
