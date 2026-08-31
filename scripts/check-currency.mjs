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
//     both bugs above. The database columns are `not null default 'AED'`, so
//     the fallback is invisible at every layer once it has been written.
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

// The web console writes to the same money columns through the same helpers, so
// it has the same failure mode and gets the same rule.
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib'];
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
  ['src/lib/exportShare.ts:money-arity', { count: 1, why:
    'The owner platform report calls money() with no currency, so it renders a dash rather than a ' +
    'figure. That is already the honest outcome — it was a fabricated "AED 6,300.00" before money() ' +
    'lost its default. The edit: give OwnerReportData a `currency: string | null`, pass ' +
    'tenant.currency from app/(owner)/dashboard.tsx, and print the metric only when it is set. That ' +
    "file belongs to another change in flight; when it lands, delete this entry and change money()'s " +
    '`currency?:` to `currency:` in src/lib/gymRecord.ts, which is what makes the rule a type error ' +
    'rather than a lint.' }],

  ['src/lib/gymSessions.ts:currency', { count: 2, why:
    'The original offence, and the only currency one left in the tree. `recordSettlement` writes ' +
    '`currency: run.currency ?? \'AED\'` into payroll_settlements (a permanent payment record that ' +
    '/accounting and /close read back as fact), and `fetchSettlements` coerces the column the same ' +
    'way on the way out. BOTH CALL SITES NOW PASS THE GYM\'S CURRENCY AND BLOCK THE SETTLEMENT ' +
    'WITHOUT ONE — studio-web/app/payroll/page.tsx and studio-web/app/sessions/page.tsx — so the ' +
    'fallback is unreachable from the product and this is a trap rather than a live bug. The edit: ' +
    "make `run.currency` required (it is `currency?: string` today) and write it through, and change " +
    'the read to `?? null` with `Settlement.currency` typed `string | null`, exactly as ' +
    'src/lib/gymPasses.ts and the four console pages now do. That file belongs to another change in ' +
    'flight tonight; it was not touched to avoid a collision.' }],

  // ── the unit backlog ────────────────────────────────────────────────────
  //
  // `clients.weight_unit` is nullable and NULL means never chosen, not
  // kilograms — but `src/ui/settings.tsx` still defaults it to 'kg' (see
  // DEFAULTS there), so a client who has never picked one is shown, and told,
  // kilograms. These are the places that then print the unit as a literal
  // rather than reading the client's own. Every one of them is a real defect
  // for a client reading in pounds; none of them is a wrong NUMBER, which is
  // why they are a ratchet rather than a stop-ship.
  //
  // The fix in each case is the same and it is not local: render through
  // `src/lib/units.ts` with `useSettings().weightUnit`, which is how the
  // screens that get this right already do it. The prerequisite is making that
  // preference nullable so "never chosen" is expressible at all.
  ['src/lib/progression.ts:unit', { count: 7, why:
    'Coaching cues built as prose — "Try 60kg" — in a pure module with no access to a client. The ' +
    'unit has to arrive as an argument, the way the currency now arrives at money(). Has its own ' +
    'progression.test.ts, so the change is assertable.' }],
  ['app/(client)/tools.tsx:unit', { count: 7, why:
    'The calculators. Every figure is derived from a stored metric value and labelled kg on the way ' +
    'out; useSettings().weightUnit is already imported by its sibling screens.' }],
  ['app/(client)/nutrition.tsx:unit', { count: 5, why:
    'Rate-of-change and target sentences on the meal plan. `plan.targetKg` is genuinely stored in ' +
    'kilograms — it is the LABEL that is wrong, not the store.' }],
  ['app/(trainer)/dashboard.tsx:unit', { count: 2, why:
    "A client's weight delta on the coach's roster. The coach reads in THEIR unit and the client's " +
    'delta is stored in kg, so this one needs `useSettings().weightUnit` on the coach side, not the ' +
    "client's — see app/(trainer)/client-training.tsx, which already distinguishes the two." }],
  ['app/(client)/calendar.tsx:unit', { count: 1, why: 'A logged set summary in a day cell.' }],
  ['app/(client)/coach.tsx:unit', { count: 1, why: 'The next-weight suggestion, rendered from progression.ts above.' }],
  ['app/(client)/library.tsx:unit', { count: 1, why: 'A previous-set label on an exercise card.' }],
  ['app/(client)/scan-machine.tsx:unit', { count: 1, why: 'A scan readout.' }],
  ['app/(trainer)/leaderboard.tsx:unit', { count: 1, why: 'A weight delta in the leaderboard row, same shape as the trainer dashboard.' }],
  ['studio-web/app/coach/roster/page.tsx:unit', { count: 1, why:
    'The console has no unit preference at all to read — it renders the stored metric value, so the ' +
    'honest short-term label is "kg (stored)" and the real fix is a console-side preference.' }],
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

/** Weight units. Length units are deliberately absent: "in" is a preposition
 *  and "cm" is rare enough to have produced nothing, so including them would
 *  cost more in silenced lines than it catches. */
const WEIGHT_UNIT = '(?:kgs?|lbs?)';

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    // Tests are excluded: their whole job is to pin what a named currency
    // renders as, so every assertion in them looks exactly like offence 3.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
  }
}
for (const r of ROOTS) { try { walk(r); } catch { /* a root that is not there yet */ } }

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
    ].find((r) => r.test(line));
    if (beside) {
      flag(file, i, 'currency', `a currency typed beside a figure — ${(line.match(beside) || [''])[0].trim()}`,
        'Let the formatter state the currency (money()/gymMoney()/amount()), so the figure and its currency cannot drift apart.');
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
