// The owner's financial review says things out loud. Compile with tsc, run with node.
//
// Every string this module returns is rendered as prose on app/(owner)/financials.tsx
// — a summary paragraph under an "AI Financial Review" heading, and a titled
// flag per finding — and an owner reads it as advice about their own business.
// That makes three failure modes worth asserting against, all of which were
// live:
//
//  1. A SENTENCE WITH A HOLE IN IT. The "needs attention" summary was assembled
//     as `${marginPct < 8 ? 'Margin is thin and' : ''} ${churn…}`, so any gym
//     scoring under 55 with a margin of 8% or better got "Needs attention (E).
//     churn is high — …": a double space and a lower-case start. That is what
//     scripts/check-prose.mjs exists to catch and could not see here, because
//     the hole is opened by an empty string rather than by an em dash.
//
//  2. A CLAIM THAT CONTRADICTS THE FIGURE BESIDE IT. The same block asserted
//     "The business is profitable" unconditionally at score >= 55. Margin
//     scores nothing below zero, but retention and growth alone reach 60 — so a
//     gym losing money every month cleared the threshold and was told it was
//     profitable, with its loss printed straight after the word.
//
//  3. A REVIEW OF MONEY NOBODY ENTERED. `hasFigures` admitted a gym that had
//     typed only its member counts. `marginPct` is pinned to 0 by its own
//     divide-guard when revenue is 0 — the absence of a margin, not a margin of
//     nought — and the screen then printed "Health Score 60/100", "Thin margin
//     at 0%" and the advice to raise membership prices, over a revenue figure
//     that had never been supplied. Forty of the hundred points were scored
//     against it.
import { emptyFinances, hasFigures, anyEntered, reviewFinances, type FinInputs } from './financialAI';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const fin = (patch: Partial<FinInputs>): FinInputs => ({ ...emptyFinances(), ...patch });

/* ── 1. the gate ───────────────────────────────────────────────────────── */

eq(hasFigures(emptyFinances()), false, 'nothing entered is not enough for a review');
eq(hasFigures(fin({ revenue: 40000 })), true, 'revenue alone is enough — it is what every ratio divides by');
// The three that used to open the gate on their own. Each of them leaves
// `marginPct` at a guarded zero, which is not a measurement.
eq(hasFigures(fin({ members: 300 })), false, 'a member count is not a financial figure');
eq(hasFigures(fin({ expenses: 22000 })), false, 'costs with no revenue give no margin to review');
eq(hasFigures(fin({ mrr: 18000 })), false, 'recurring revenue is a share of total revenue, not a substitute for it');

/* ── 2. anyEntered: telling the two empty states apart ─────────────────── */

eq(anyEntered(emptyFinances()), false, 'a fresh install has entered nothing');
eq(anyEntered(fin({ members: 300 })), true, 'member counts are something the owner typed');
eq(anyEntered(fin({ churnedMembers: 4 })), true, 'any single field counts — the screen must not say their figures were lost');
eq(anyEntered(fin({ classRevenue: 900 })), true, 'ancillary revenue alone still counts as entered');
// The distinction is the whole point of having both: one is true and the other
// false for the same input, which is what lets the screen pick its wording.
ok(anyEntered(fin({ members: 300 })) && !hasFigures(fin({ members: 300 })),
  'entered-but-not-reviewable is a state the screen has to be able to see');

/* ── 3. no sentence may lose a word ────────────────────────────────────── */

/** Every prose string a review puts on screen. */
const prose = (f: FinInputs, cur: string | null = 'GBP'): string[] => {
  const r = reviewFinances(f, cur);
  return [r.summary, ...r.strengths.flatMap((x) => [x.title, x.detail]), ...r.improvements.flatMap((x) => [x.title, x.detail])];
};

/** The shapes a hole leaves behind. */
const holed = (s: string): string | null => {
  if (/ {2}/.test(s)) return 'double space';
  if (/[.!?] +[a-z]/.test(s)) return 'lower-case start after a full stop';
  if (/^\s|\s$/.test(s)) return 'leading or trailing space';
  if (/\b(null|undefined|NaN)\b/.test(s)) return 'a value name printed as a word';
  return null;
};

// A spread wide enough to reach every branch of every sentence: strong, middling
// and failing on each of margin, churn and growth, in both directions.
const cases: [string, FinInputs][] = [
  ['A-grade gym', fin({ revenue: 100000, expenses: 70000, mrr: 80000, members: 400, newMembers: 30, churnedMembers: 4, ptRevenue: 12000, classRevenue: 9000 })],
  ['mid gym', fin({ revenue: 60000, expenses: 52000, mrr: 30000, members: 200, newMembers: 8, churnedMembers: 9 })],
  // The exact case that produced "Needs attention (E).  churn is high": a
  // margin at or above 8, so the first interpolation was the empty string.
  ['thin retention, healthy margin', fin({ revenue: 60000, expenses: 54000, members: 200, newMembers: 2, churnedMembers: 20 })],
  ['thin margin and high churn', fin({ revenue: 60000, expenses: 59000, members: 200, newMembers: 1, churnedMembers: 30 })],
  ['thin margin, low churn, flat growth', fin({ revenue: 60000, expenses: 58000, members: 200, newMembers: 3, churnedMembers: 3 })],
  ['loss-making but well retained', fin({ revenue: 60000, expenses: 90000, members: 200, newMembers: 20, churnedMembers: 0 })],
  ['break-even', fin({ revenue: 60000, expenses: 60000, members: 200, newMembers: 5, churnedMembers: 5 })],
  ['shrinking', fin({ revenue: 60000, expenses: 20000, members: 200, newMembers: 1, churnedMembers: 12 })],
  ['one member, one of everything', fin({ revenue: 1, expenses: 1, members: 1, newMembers: 1, churnedMembers: 1 })],
];

for (const [label, f] of cases) {
  for (const cur of ['GBP', null] as const) {
    for (const s of prose(f, cur)) {
      const why = holed(s);
      ok(why == null, `${label} (${cur ?? 'no currency'}): ${why} in "${s}"`);
    }
  }
}

/* ── 4. the profitability claim must match netProfit ───────────────────── */

// Retention and growth alone reach 60, which clears the >= 55 branch, while a
// negative margin scores nothing. This gym is losing thirty thousand a month.
const losing = reviewFinances(fin({ revenue: 60000, expenses: 90000, members: 200, newMembers: 20, churnedMembers: 0 }), 'GBP');
ok(losing.score >= 55, 'the loss-making gym does reach the branch that used to call it profitable');
ok(losing.netProfit < 0, 'and it is genuinely losing money');
ok(!/is profitable/.test(losing.summary), `a gym losing money is not told it is profitable — got "${losing.summary}"`);
ok(/losing money/.test(losing.summary), `it is told what is actually happening — got "${losing.summary}"`);

const evens = reviewFinances(fin({ revenue: 60000, expenses: 60000, members: 200, newMembers: 12, churnedMembers: 0 }), 'GBP');
eq(evens.netProfit, 0, 'break-even is exactly zero profit');
ok(!/is profitable/.test(evens.summary), 'breaking even is not profitable either');

// Deliberately tuned into the 55–84 band, because that is the only branch that
// makes a profitability claim at all — a gym at 85+ gets the "strong financial
// health" sentence instead, and one under 55 gets "needs attention".
const earning = reviewFinances(fin({ revenue: 60000, expenses: 50000, members: 200, newMembers: 7, churnedMembers: 5 }), 'GBP');
ok(earning.score >= 55 && earning.score < 85, `the earning gym lands in the middle band — got ${earning.score}`);
ok(earning.netProfit > 0 && /is profitable/.test(earning.summary),
  `a gym that is making money is still told so — got "${earning.summary}"`);

/* ── 5. the currency is never guessed ──────────────────────────────────── */

// Null means the gym has not set `tenants.currency`. The percentages survive;
// the amounts are withheld rather than denominated in somebody's default.
const noCur = reviewFinances(fin({ revenue: 60000, expenses: 45000, members: 200, newMembers: 10, churnedMembers: 2 }), null);
for (const s of [noCur.summary, ...noCur.strengths.map((x) => x.detail), ...noCur.improvements.map((x) => x.detail)]) {
  ok(!/\b(AED|GBP|USD|EUR|SAR|AUD|CAD|ZAR)\b/.test(s), `no currency set, so no code may appear — got "${s}"`);
}
const gbp = reviewFinances(fin({ revenue: 60000, expenses: 45000, members: 200, newMembers: 10, churnedMembers: 2 }), 'GBP');
ok(gbp.summary.includes('GBP'), 'a gym that HAS set one gets its amounts written in it');
ok(!/\bAED\b/.test(gbp.summary), 'and never in the module default it used to hardcode');

/* ── 6. the score stays inside its own scale ───────────────────────────── */

for (const [label, f] of cases) {
  const r = reviewFinances(f, 'GBP');
  ok(r.score >= 0 && r.score <= 100, `${label}: the score is out of 100 — got ${r.score}`);
  ok('ABCDE'.includes(r.grade), `${label}: the grade is one of A–E — got ${r.grade}`);
  ok(Number.isFinite(r.marginPct) && Number.isFinite(r.churnPct) && Number.isFinite(r.growthPct),
    `${label}: no ratio may come out NaN or Infinity`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('financialAI.test.ts OK');
