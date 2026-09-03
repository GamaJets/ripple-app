#!/usr/bin/env node
// A hundred is not how many minor units a currency has.
//
// ── Why this file exists ──────────────────────────────────────────────────
//
// Repple is white-labelled. There is no default currency anywhere in it, and
// there is therefore no default number of decimal places either. Money is held
// in MINOR units — `*_cents` columns, Stripe's own denomination — and how many
// of those make a whole one is a property of the money and of nothing else:
//
//   100   most of the world.
//   1     the sixteen ZERO_DECIMAL currencies. There are no fils in a yen, so
//         a JPY amount of 50000 IS ¥50,000.
//   1000  the five THREE_DECIMAL ones. A Kuwaiti dinar has a thousand fils.
//
// So `* 100` and `/ 100` on money are right for about eighty per cent of
// currencies and silently wrong for twenty-one of them — a hundred times wrong
// in yen, ten times wrong in dinar. `src/lib/coachMoney.ts` is the one place
// that knows the answer, and `currencyDecimals`, `minorFromWhole`,
// `minorFromDecimal`, `readMinorAmount`, `majorFromMinor` and `money` are the
// doors through it.
//
// A currency sweep went through this tree and fixed dozens of these. It missed
// seven, and it missed them for one reason: there was no gate. Every fix left a
// comment explaining the hundred it had removed, and the next person read the
// comments rather than the code. Two of the seven were WRITES — a coach's ad
// spend scaled by a flat hundred into `coach_code_spend.amount_cents` and into
// `coach_ad_code_spend` — where a wrong figure is not a rendering fault that
// disappears on the next release but a permanent record somebody's
// cost-per-client is divided out of.
//
// ── What it flags ─────────────────────────────────────────────────────────
//
// `* 100`, `/ 100`, `* 1000`, `/ 1000` and `Math.round(x * 100)` on a line
// whose words say the number is MONEY. Nothing else. It reads names, it cannot
// follow a value, and it is honest about both below.
//
// ── The whole craft of it is not drowning in false positives ──────────────
//
// This tree contains 260 lines matching those four operators and the
// overwhelming majority of them are correct arithmetic about something that is
// not money at all:
//
//   · a percentage.        `Math.round((active / total) * 100)`
//   · a millisecond.       `14 * 24 * 60 * 60 * 1000`, `secs * 1000`
//   · a pixel or a ratio.  `` `${frac * 100}%` ``
//   · a kilogram, a micro, a body-fat figure, a Julian day number.
//
// A gate that flagged those would be turned off within a week, so the rule is
// narrow in three ways at once, and each narrowing is a deliberate blindness:
//
//   1. MONEY WORDS. The hit's line, and the identifier it sits in, has to name
//      money — cents, price, fee, amount, spend, payroll, invoice, refund. A
//      `* 100` on a line about a heart rate is invisible to this, and so is one
//      on a line whose money-ness is only knowable from a variable declared
//      forty lines up. It reads names because names are what a regex can see.
//
//   2. VETOES BEAT WORDS. A percentage of a price is still a percentage: the
//      hundred in `(priceCents * pct) / 100` is the definition of "per cent"
//      and has nothing to do with what a fils is. Same for a duration in
//      milliseconds, a ratio rendered as a percentage, and Google's micros.
//      Where a veto and a money word both fire, the veto wins — a false
//      negative here is one line of real prose somebody has to notice, and a
//      false positive is a gate people learn to route around.
//
//   3. A FACTOR CHOSEN BY THE CURRENCY IS NOT A HARDCODED ONE. `if
//      (THREE_DECIMAL.has(c)) return Math.round(minor / 1000)` contains a
//      literal thousand and is exactly right: the thousand was reached by
//      asking which money it is. A line near `ZERO_DECIMAL`, `THREE_DECIMAL`,
//      `currencyDecimals` or a `10 ** dp` passes for that reason and not as a
//      favour.
//
// ── What it deliberately cannot see ───────────────────────────────────────
//
//   · A hundred on a money value held in a variable with a neutral name. `const
//     n = row.price_cents; … n / 100` is invisible, and there is no window
//     wide enough to fix that without reading the neighbouring statement's
//     words as this one's.
//   · A hundred inside a SQL function body in supabase/parts, which is text to
//     every tool in this repo. check-sql-caps.mjs owns that tree.
//   · A `100` that has been given a name. `const CENTS = 100; x * CENTS` passes
//     and is the same defect. Naming it is at least an act somebody has to
//     perform on purpose.
//   · Anything in a comment. This repository's comments are FULL of prose about
//     the hundreds that were removed — every fix in this area explains the
//     wrong version at length before the right one — and flagging those would
//     make the gate impossible to keep and would punish the documentation that
//     is the best thing about the fixes.
//
// So it holds one rule completely and is silent about four more. The rest are
// held by src/lib/coachMoney.test.ts, by check-currency.mjs (which asks whether
// a figure NAMES a currency, where this asks whether it was SCALED by one), and
// by review.
//
// ── The escape marker ─────────────────────────────────────────────────────
//
// `currency-ok: <why>` on the line or in the comment immediately above it, in
// the house style check-currency.mjs and check-prose.mjs already use. The
// REASON is the marker: a bare `currency-ok:` with nothing after it does not
// count, because the sentence is the whole point — it is what a reviewer reads
// instead of re-deriving the argument.
//
// An exemption must be TRUE. Silencing a real hit with a marker to make a run
// go green writes the defect down as a decision, which is worse than the defect.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components', 'supabase/functions'];

/**
 * The operators. A factor of a hundred or a thousand, either way round.
 *
 * `1000` is here for the same reason `100` is and for one more: it is the
 * factor for the three-place currencies, so a `/ 1000` written for a Kuwaiti
 * dinar is right for five currencies and wrong for the other 175.
 *
 * `10 ** 2` and `Math.pow(10, 2)` are the same thought spelled out, and are
 * matched too — the sweep that wrote this found one of them.
 */
const FACTOR = /(?:[*/]\s*(?:100|1000|100_000|1_000)\b|10\s*\*\*\s*[23]\b|Math\.pow\(\s*10\s*,\s*[23]\s*\))/;

/**
 * Words that say the number on this line is money.
 *
 * `rate` is here and is the one that had to be qualified: a heart rate, a
 * sampling rate and a conversion rate are all rates, so it counts only where it
 * is attached to money — `rate_cents`, `rateCents`, `sessionRate`, `hourlyRate`.
 * `total` is deliberately NOT here on its own: a total of anything is a total.
 */
const MONEY = new RegExp([
  '\\bcents?\\b', '_cents\\b', 'Cents\\b', 'minorUnits?\\b', '\\bminor\\b', 'majorFrom', 'minorFrom',
  '\\bprice', 'Price\\b', '\\bfees?\\b', 'Fee\\b', '\\bamount', 'Amount\\b',
  '\\bmoney\\b', 'Money\\b', '\\bcurrenc', 'Currenc',
  '\\bspend\\b', 'Spend\\b', '\\brevenue\\b', 'Revenue\\b', '\\bpayroll', 'Payroll\\b',
  '\\binvoice', 'Invoice\\b', '\\brefund', 'Refund\\b', '\\bpayout', 'Payout\\b',
  '\\bsalar', '\\bwages?\\b', '\\bmrr\\b', 'Mrr\\b', '\\bowed\\b', 'outstanding',
  '\\bpaid\\b', 'Paid\\b', '\\bpayment', 'Payment\\b', '\\bcharge', 'Charge\\b',
  '\\bcosts?\\b', 'Cost\\b', '\\bbalance\\b', 'Balance\\b', '\\bdiscount', 'Discount\\b',
  '\\bsubtotal', '\\btakings?\\b', 'rate_cents', 'rateCents', 'RateCents',
  'sessionFee', 'session_fee', 'sessionRate', 'hourlyRate', 'dayRate',
].join('|'));

/**
 * Vetoes. Each one names a thing that is legitimately a hundred or a thousand.
 *
 * These beat the money words on purpose — see the header. A percentage OF a
 * price is a percentage; a millisecond timeout on a payment request is a
 * millisecond; Google's micros are a millionth and the six places are the
 * conversion, not a currency's minor unit.
 */
const VETO = [
  // Per cent. The word, the abbreviation, the sign, and the SHAPE — a ratio in
  // parentheses immediately left of the hundred, `(a / b) * 100`, which is how
  // most of them are written and which names nothing.
  /\bpct\b|\bpercent|Percent|\bperc\b|%/,
  /\/[^*/]*\)\s*\*\s*(?:100|1000)\b/,
  /\bshare\b|\bratio\b|\bproportion/i,
  // Time. Milliseconds are a thousand of a second and this app is full of them.
  //
  // The seconds→milliseconds thousand is the one that reaches money code:
  // Stripe stamps every object with a UNIX time in SECONDS, so `new
  // Date(payout.arrival_date * 1000)` sits on a line about a payout and is not
  // about a payout's amount at all. That is why the Date constructor and
  // `_date` are in here beside the durations.
  /\bms\b|Ms\b|milli|\bsec(?:s|onds?)?\b|Seconds?\b|Date\.now|getTime|new Date\(|toISOString|toLocaleDate|_date\b|\bunix\b|\bepoch\b|\btimeout|Timeout\b|\bttl\b|Ttl\b|TTL|\binterval|Interval\b|\bhorizon|Horizon\b|\bdelay|Delay\b|\bexpires|\bage(?:d|ing)?\b|\bduration|Duration\b|\bhours?\b|\bdays?\b|\bminutes?\b/,
  // Geometry, and anything on its way to a stylesheet.
  // `left` and `top` are deliberately NOT here, and the reason is a caught
  // false negative: `const left = (remaining / 100).toFixed(2)` in
  // gymRecord.ts is what is LEFT on a payment, and a veto on the word hid a
  // real hundred behind a CSS property name. Every genuine style hundred in
  // this tree is a percentage and is already vetoed as one.
  /\bpx\b|\bwidth\b|\bheight\b|\bopacity\b|\bflex\b|\bradius\b|\bzoom\b|transform|StyleSheet|\bstyle=/i,
  // Google reports cost in micros — a MILLIONTH. Converting them is a million,
  // not a hundred, and `majorFromMicros` is the one place that does it.
  /micro/i,
  // Other quantities that are simply not money.
  /\bkg\b|\blbs?\b|\bkcal\b|\bgrams?\b|\bmmol\b|\bbpm\b|\bhrv?\b|bodyFat|body_fat|\breps?\b|\bsets?\b|\bsteps?\b/i,
  // A precision helper: `Math.round(n * 100) / 100` is "to two decimal places"
  // of whatever it is, and both halves appear on the one line.
  /\*\s*100\s*\)\s*\/\s*100\b|\*\s*1000\s*\)\s*\/\s*1000\b/,
];

/**
 * A factor the CURRENCY chose.
 *
 * A literal thousand reached by asking `THREE_DECIMAL` is not a hardcoded
 * thousand — it is the answer. Same for a branch on `ZERO_DECIMAL`, a
 * `currencyDecimals()` result, or an exponent built from one (`10 ** dp`). This
 * is the third narrowing in the header, and it is why `owner-metrics` and
 * `coachMoney` itself do not need a marker each.
 */
const CURRENCY_AWARE = /ZERO_DECIMAL|THREE_DECIMAL|currencyDecimals|10\s*\*\*\s*dp\b|10\s*\*\*\s*(?:decimals|places)\b/;

/** `currency-ok: <why>`. The reason IS the marker — a bare one does not count. */
const EXCUSE = /(?:currency|unit)-ok:\s*\S/;

/**
 * Files the rule is right about and that are right anyway, with the reason.
 *
 * The same contract as KNOWN in check-currency.mjs and check-deltas.mjs: a
 * count per file, which fails when it GROWS (the next offence in a listed file
 * is as red as the first in a clean one) and fails when it SHRINKS or empties
 * (or the list quietly stops describing the tree). "It is fine" is not a
 * reason; each entry says what makes the hundred right.
 *
 * EMPTY, and it held one entry until the spreadsheet importer was fixed.
 *
 * That entry was `src/lib/csvImport.ts`, and it was written down as OPEN WORK
 * rather than as an exemption: `parseMoneyCents` read a gym's migration
 * spreadsheet at two decimal places flat, so it refused a legitimate
 * three-place Kuwaiti figure and read a Japanese "50000" as five million yen,
 * into `gym_payments.amount_cents`, permanently, on the one import a gym does
 * once and never checks again. It is now currency-aware end to end — the
 * currency is threaded through `parseMoneyCents`, `previewPayments` and
 * `previewPlans` and the scaling is done on the digits — and `minorToDecimal`
 * in src/lib/gymExport.ts moved with it, because an exporter at a flat two
 * places and a currency-aware importer would produce a bundle that does not
 * re-import as the same figures. src/lib/importRoundTrip.test.ts is what holds
 * both ends: export and re-import in GBP, JPY and KWD, compared as integers.
 *
 * Kept as an empty Map rather than deleted, because the mechanism above is
 * what makes a future offence recordable without being excused.
 */
const KNOWN = new Map([]);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.tmp' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    // Tests are excluded: their whole job is to pin what a hundred does in a
    // named currency, so every assertion in coachMoney.test.ts looks exactly
    // like the offence.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Which lines are comment.
 *
 * Copied in shape from check-currency.mjs, and load-bearing for the same
 * reason: this repository documents every hundred it has removed, at length,
 * and a gate that read those as code would be unkeepable. The block form is
 * what matters — a JSDoc paragraph explaining `price_cents / 100` runs to six
 * lines and only the first of them starts with a slash.
 */
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
      out[i] = line.slice(0, open).trim() === '' || line.slice(0, open).trim() === '{';
    }
  });
  return out;
}

/** The marker on this line, or anywhere in the unbroken comment above it. A
 *  fixed window excuses the first line of an explained block and flags the
 *  rest, which teaches people to paste the marker three times rather than
 *  write the reason once. */
function excused(lines, commented, i) {
  if (EXCUSE.test(lines[i])) return true;
  for (let j = i - 1; j >= 0; j--) {
    const blank = lines[j].trim() === '';
    if (!commented[j] && !blank) break;
    if (EXCUSE.test(lines[j])) return true;
  }
  return false;
}

const files = [];
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  try { walk(join(ROOT, r), files); } catch { /* a root that is not there yet */ }
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:hundreds', perRoot);

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, for the same
// reason.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

const findings = [];
let scanned = 0;
let excusedCount = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  const commented = commentedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (commented[i]) continue;
    const line = lines[i];
    if (!FACTOR.test(line)) continue;
    scanned++;
    if (!MONEY.test(line)) continue;
    if (VETO.some((v) => v.test(line))) continue;
    // The two lines above are read for the currency-aware test only. A branch
    // on THREE_DECIMAL and its `return` are routinely two lines apart.
    const near = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    if (CURRENCY_AWARE.test(near)) continue;
    if (excused(lines, commented, i)) { excusedCount++; continue; }
    findings.push({
      key: rel,
      where: `${rel}:${i + 1}`,
      what: line.trim().slice(0, 120),
      named: (line.match(MONEY) || [''])[0],
    });
  }
}

const seen = new Map();
for (const f of findings) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);

const fresh = [];
const shrunk = [];
const stale = [];
for (const f of findings) {
  const allowed = KNOWN.get(f.key)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // Report the overflow as the whole file: which of a file's three is "the new
  // one" is not knowable from the text.
  if (seen.get(f.key) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || stale.length || shrunk.length) {
  if (fresh.length) {
    console.error(`${fresh.length} hardcoded factor${fresh.length === 1 ? '' : 's'} on money:\n`);
    for (const f of fresh) {
      console.error(`  ${f.where}`);
      console.error(`    ${f.what}`);
      console.error(`    → the line says "${f.named}", so this is money, and a hundred is not how many`);
      console.error('      minor units it has. There are none in a yen and a thousand in a dinar.\n');
    }
    console.error('Ask the currency instead: currencyDecimals, minorFromWhole, minorFromDecimal,');
    console.error('readMinorAmount, majorFromMinor and money in src/lib/coachMoney.ts. All of them');
    console.error('return null rather than guessing when nobody has said which money it is.\n');
    console.error('If the factor genuinely is not about a minor unit — a percentage, a millisecond,');
    console.error('a figure a currency itself chose — mark it `currency-ok: <why>` and say why in a');
    console.error('sentence. The reason is the whole point of the marker, and it has to be true.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-hundreds.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have been fixed. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-hundreds.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `hundreds ok — ${files.length} files, ${scanned} hundreds and thousands read; ` +
  'none of the ones on money was reached without asking the currency' +
  (excusedCount ? `. ${excusedCount} marked \`currency-ok:\` with a reason` : '') +
  (open ? `. ${open} listed offence${open === 1 ? ' remains' : 's remain'} open in KNOWN and cannot grow.` : '.'),
);
