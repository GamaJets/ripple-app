// FINANCIAL CHECKS — a rule engine that reads the figures the owner typed.
//
// ── What it is called, and why that is the first thing in this file ────────
//
// This file was `financialAI.ts` and the screen over it was headed "AI
// Financial Review". Neither was true. There is no model call here and there
// never was one: everything below is arithmetic over eight typed numbers and a
// fixed set of thresholds — margin at 20 and 8 percent, churn at 3 and 6, net
// growth at 1.5, recurring share at 70, ancillary revenue at a sixth of the
// total — plus a weighted score out of a hundred. Run it twice on the same
// figures and it says the same words, because it is an if/else chain.
//
// The name did real damage rather than merely being loose. `grade >= 'A'` was
// a string comparison, so every grade from A to E took that arm and every gym
// on the platform read "your gym is in strong financial health" — and an owner
// who believes a MODEL looked at their books has nothing to check that verdict
// against. An owner told "these are the rules, and here is the threshold this
// figure crossed" would have seen "margin 4%, churn 9%/mo, strong financial
// health" for the contradiction it was, in a second. Naming a rule engine
// honestly does not make it weaker; it hands the reader the one thing that
// lets them disagree with it. src/lib/programReview.ts made the same argument
// first and pointed at this file while making it.
//
// The calculation is worth having and is unchanged. Only the framing moved.
//
// ── What it will not do ───────────────────────────────────────────────────
//
// It analyses ONLY figures the owner has entered. There is no accounting
// connection behind it — Xero and QuickBooks are each an OAuth app, a token
// store, a sync worker and a chart-of-accounts mapping, and none of that
// exists — and there is no sample/illustrative snapshot either: this module
// previously exported `sampleFinances()` returning an invented AED 214,000/mo,
// 1,940-member gym, which the screen rendered as if it were the owner's real
// business, complete with a grade and a verdict. Nothing here fabricates
// numbers; `emptyFinances()` is all zeros and `hasFigures()` gates the review
// so an un-filled screen shows an empty state instead of fiction.
import { deltaLabel } from './deltaLabel';
// The one formatter that knows how many places a currency has. See `moneyIn`
// below for what this file was doing instead.
import { wholeMoney } from './coachMoney';

export interface FinInputs {
  // MAJOR units, in the gym's own currency — whatever `tenants.currency` says
  // it is. These comments used to read "(AED)" and the formatter below used to
  // agree with them, which is how a white-label product came to tell a London
  // gym how many dirhams of profit it keeps.
  revenue: number;      // total monthly revenue
  expenses: number;     // total monthly expenses
  mrr: number;          // recurring membership revenue
  members: number;      // active members
  newMembers: number;   // joined this month
  churnedMembers: number; // left this month
  ptRevenue: number;    // personal-training revenue
  classRevenue: number; // class revenue
}

export interface FinFlag { tone: 'good' | 'watch' | 'risk'; title: string; detail: string }
export interface FinReview {
  score: number; grade: string;
  netProfit: number; marginPct: number; churnPct: number; growthPct: number;
  summary: string;
  strengths: FinFlag[];
  improvements: FinFlag[];
}

/**
 * A whole-currency figure for the review sentences, in the gym's own money.
 *
 * This was `'AED ' + Math.round(n).toLocaleString()` — a currency hardcoded
 * into a module that a white-labelled product runs for every gym on it. It was
 * not a label somewhere quiet either: it is spliced into the prose of every
 * strength, every improvement and the summary paragraph, so a Manchester
 * owner opening Financial health read "You keep AED 12,000 of every month's
 * AED 60,000 — strong operating discipline" about pounds. A wrong symbol in
 * front of a number is not cosmetic, it is a different amount, and this one
 * arrives inside a sentence that sounds like advice.
 *
 * `currency` is threaded in from the caller rather than defaulted, because
 * `tenants.currency` is nullable on purpose and a gym that has not set one has
 * no figure to be told — see `reviewFinances`, which withholds the sentence
 * rather than picking a currency for it.
 *
 * ── AND IT IS NO LONGER A FORMATTER OF ITS OWN ────────────────────────────
 *
 * Fixing the hardcoded code left the rest of the line in place: a private
 * `${currency} ${Math.round(n).toLocaleString()}`, which is the same figure
 * this product formats through `currencyDecimals` everywhere else, rounded to
 * a whole unit and printed by hand. `app/(owner)/financials.tsx` renders these
 * amounts TWICE on one screen — the KPI tiles through `gymMoney`, which is
 * `wholeMoney`, and the sentences under them through this — so a Bahraini owner
 * who typed 12500.25 of net profit read "BHD 12,500.250" in the tile and
 * "BHD 12,500" three lines below it, and had no way to tell which was their
 * money. Rounding a figure the owner typed is not a display choice at that
 * point; it is a second, quieter answer to the same question.
 *
 * `wholeMoney` asks `currencyDecimals` how many places the money actually has —
 * none for the sixteen zero-decimal currencies, three for the five that have a
 * thousand minor units — and nothing here divides, multiplies or rounds. It
 * also returns null for a currency nobody stated, which is exactly the silence
 * `m()` below already branches on, so the null-currency wording is unchanged.
 *
 * The bare `.toLocaleString()` that went with it was never the defect;
 * scripts/check-locale.mjs permits it. The rounding and the bypass were.
 */
const moneyIn = (n: number, currency: string): string | null => wholeMoney(n, currency);
// A `pct` helper stood here with no caller and a ternary whose two arms were
// both the empty string — a sign-prefix somebody removed without removing the
// branch. Left in place it is a formatter the next person reaches for believing
// it signs a percentage. src/lib/deltaLabel.ts is the one that actually does.

/** All-zero starting point. The owner fills these in (or accounting supplies them). */
export function emptyFinances(): FinInputs {
  return { revenue: 0, expenses: 0, mrr: 0, members: 0, newMembers: 0, churnedMembers: 0, ptRevenue: 0, classRevenue: 0 };
}

/**
 * True once there is enough entered for a review to mean anything.
 *
 * REVENUE, specifically, and not "any of the three". This used to be
 * `revenue > 0 || expenses > 0 || members > 0`, and every figure this module
 * derives is a share of revenue: margin, the 40 points of the score that margin
 * carries, and the recurring and ancillary flags. With revenue at zero
 * `marginPct` was pinned to 0 by its own divide-guard, which is not a measured
 * margin — it is the absence of one — and the review then stated it as a fact.
 *
 * An owner who entered only their member counts was handed a hero reading
 * "Health Score 60/100 · Grade C · 0% net margin", a risk flag headed "Thin
 * margin at 0%" saying "Only 0 of 0 is profit", and the advice to raise their
 * membership prices — all of it about money they had never typed, in the same
 * confident type used when it is true. Forty of the hundred points were scored
 * against a number nobody supplied.
 *
 * So revenue is the gate. It is also exactly what the empty state has always
 * asked for ("Enter this month's revenue, expenses and membership numbers"), so
 * nothing about the screen's promise changes — only whether the review can be
 * produced without the figure it is a ratio of.
 */
export function hasFigures(f: FinInputs): boolean {
  return f.revenue > 0;
}

/**
 * Whether the owner has typed ANYTHING, which is a different question.
 *
 * Without it the screen cannot tell a fresh install from somebody who filled in
 * their member counts and left revenue blank — both fail `hasFigures` and both
 * would get "Nothing is shown until it comes from you", which reads to the
 * second person as their figures having been lost.
 */
export function anyEntered(f: FinInputs): boolean {
  return f.revenue > 0 || f.expenses > 0 || f.mrr > 0 || f.members > 0
    || f.newMembers > 0 || f.churnedMembers > 0 || f.ptRevenue > 0 || f.classRevenue > 0;
}

/**
 * `currency` is REQUIRED and may be null, and the two are different answers.
 *
 * A string is the gym's own ISO code and every figure below is written in it.
 * Null means `tenants.currency` is unset — the gym has not told us — and every
 * sentence that would have contained a money figure is replaced by one that
 * does not. The alternatives were both worse: a bare "12,000" is read in
 * whatever money the owner is thinking in, and a guessed "AED 12,000" is read
 * as a fact somebody established. The scores, grades and percentages are
 * currency-free and are unaffected either way, so the review still works —
 * it just stops quoting amounts it cannot denominate.
 */
/**
 * The one line the screen puts under its title, saying what this is.
 *
 * Built here rather than typed into the screen, for the same reason
 * `checksLine()` is built inside src/lib/programReview.ts: the sentence that
 * refuses the word "AI" belongs next to the rules it is refusing it on behalf
 * of. A disclaimer typed into a `<Text>` on a screen is one refactor away from
 * being deleted by somebody who has never read this file, and the failure that
 * follows is silent — the arithmetic goes on working under a name that has
 * started lying again.
 */
export function reviewBasis(): string {
  return 'Fixed rules over the figures you enter, not a model. '
    + 'Every finding names the threshold it crossed, so you can disagree with it.';
}

/**
 * Where the entered figures actually live, in the words the owner needs.
 *
 * Three places on the screen say this and they must not drift apart, because
 * the cost being disclosed is asymmetric: an owner who believes their P&L is
 * backed up types a year of it into a phone, changes phone, and discovers on
 * the new one that a screen they treated as a record kept nothing. Saying "this
 * device only" states where the data is; it does not state what that costs, and
 * the second half is the half somebody acts on.
 *
 * It is a sentence about AsyncStorage under the key in `KEY` on
 * app/(owner)/financials.tsx, and it stops being true the day those figures are
 * written to a table. Change it then, in this one place.
 */
export function storageNote(): string {
  return 'These figures are saved on this phone and nowhere else. '
    + 'They are not backed up, they do not reach your other devices, and deleting the app deletes them.';
}

export function reviewFinances(f: FinInputs, currency: string | null): FinReview {
  // One local so the sentences below read as sentences. `m()` returns null when
  // the currency is unknown and each call site picks its wording from that,
  // rather than every branch repeating the ternary.
  const m = (n: number): string | null => (currency ? moneyIn(n, currency) : null);
  const netProfit = f.revenue - f.expenses;
  const marginPct = f.revenue > 0 ? (netProfit / f.revenue) * 100 : 0;
  const churnPct = f.members > 0 ? (f.churnedMembers / f.members) * 100 : 0;
  const netAdds = f.newMembers - f.churnedMembers;
  const growthPct = f.members > 0 ? (netAdds / f.members) * 100 : 0;
  const recurringShare = f.revenue > 0 ? (f.mrr / f.revenue) * 100 : 0;

  // Score: margin 40, retention 35, growth 25.
  const mScore = Math.max(0, Math.min(40, (marginPct / 25) * 40));
  const rScore = Math.max(0, Math.min(35, ((6 - churnPct) / 6) * 35));
  const gScore = Math.max(0, Math.min(25, ((growthPct + 1) / 5) * 25));
  const score = Math.round(mScore + rScore + gScore);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';

  const strengths: FinFlag[] = [];
  const improvements: FinFlag[] = [];

  if (marginPct >= 20) strengths.push({ tone: 'good', title: `Healthy ${marginPct.toFixed(0)}% net margin`, detail: m(netProfit) ? `You keep ${m(netProfit)} of every month's ${m(f.revenue)} — strong operating discipline.` : `You keep ${marginPct.toFixed(0)}% of every month's revenue — strong operating discipline. The amounts are not written here because this gym has not set its currency.` });
  else if (marginPct >= 8) improvements.push({ tone: 'watch', title: `Margin is moderate at ${marginPct.toFixed(0)}%`, detail: m(netProfit) ? `Net profit is ${m(netProfit)}/mo. Review your largest cost lines (staff, rent, platform) — a few points of margin compounds fast.` : `Net profit is ${marginPct.toFixed(0)}% of revenue. Review your largest cost lines (staff, rent, platform) — a few points of margin compounds fast.` });
  else improvements.push({ tone: 'risk', title: `Thin margin at ${marginPct.toFixed(0)}%`, detail: m(netProfit) ? `Only ${m(netProfit)} of ${m(f.revenue)} is profit. Prioritise cost review or a modest membership price increase before adding overhead.` : `Only ${marginPct.toFixed(0)}% of revenue is profit. Prioritise cost review or a modest membership price increase before adding overhead.` });

  if (churnPct <= 3) strengths.push({ tone: 'good', title: `Low churn (${churnPct.toFixed(1)}%/mo)`, detail: `Members are staying — retention is your cheapest growth lever and it's working.` });
  else if (churnPct <= 6) improvements.push({ tone: 'watch', title: `Churn to watch (${churnPct.toFixed(1)}%/mo)`, detail: `You lose ${f.churnedMembers} members/mo. A win-back offer and a check-in on low-attendance members could recover several of them.` });
  else improvements.push({ tone: 'risk', title: `High churn (${churnPct.toFixed(1)}%/mo)`, detail: `Losing ${f.churnedMembers}/mo drags growth. Target at-risk members with a personalised offer and re-engagement push — this is your #1 opportunity.` });

  if (growthPct >= 1.5) strengths.push({ tone: 'good', title: `Growing ${growthPct.toFixed(1)}% net this month`, detail: `${f.newMembers} joined vs ${f.churnedMembers} left. Momentum is positive — good time to invest in referrals or a new branch.` });
  else if (netAdds >= 0) improvements.push({ tone: 'watch', title: `Flat growth (${deltaLabel(growthPct, { since: null, unit: '%', noChange: 'no change' })})`, detail: `New joins barely outpace churn. A referral push and a class-led trial could lift acquisition.` });
  else improvements.push({ tone: 'risk', title: `Shrinking membership`, detail: `You lost ${Math.abs(netAdds)} net members. Fix retention first, then drive acquisition — a promotion pushed to lapsed members is a fast win.` });

  if (recurringShare >= 70) strengths.push({ tone: 'good', title: `${recurringShare.toFixed(0)}% recurring revenue`, detail: `Predictable membership income de-risks the business.` });
  if (f.ptRevenue + f.classRevenue < f.revenue * 0.15) improvements.push({ tone: 'watch', title: `Ancillary revenue is light`, detail: m(f.ptRevenue + f.classRevenue) ? `PT + classes are only ${m(f.ptRevenue + f.classRevenue)}/mo. Promote packs and premium classes to members already in the door — high margin, low cost.` : `PT + classes are under a sixth of revenue. Promote packs and premium classes to members already in the door — high margin, low cost.` });

  // `grade >= 'A'` was a string comparison, and every grade from A to E sorts at
  // or above 'A' — so this branch always won and the two honest summaries below
  // were dead code. A gym on grade E read "in strong financial health (E) …
  // low churn and positive growth" with its own bad numbers spliced in.
  //
  // Two more faults lived in the two branches that were then unreachable, and
  // both are the shape scripts/check-prose.mjs was written for — a sentence
  // assembled from parts, one of which can come out empty:
  //
  //  · The "needs attention" line interpolated `marginPct < 8 ? 'Margin is thin
  //    and' : ''` and then a space and a lower-case clause. At any gym scoring
  //    under 55 whose margin was 8% or better — a thin-retention, thin-growth
  //    gym, which is most of them — that read "Needs attention (E).  churn is
  //    high — tackle the risk items below first". A double space and a sentence
  //    starting in lower case is not a wording preference; it is what a broken
  //    screen looks like, on the one line of this screen an owner reads first.
  //    The four cases are spelled out instead, so no branch can leave a hole.
  //
  //  · The "solid but improvable" line asserted "The business is profitable"
  //    unconditionally. Margin scores nothing below zero but retention and
  //    growth alone reach 60, so a gym LOSING money every month cleared 55 and
  //    was told it was profitable — with the loss printed after the word as
  //    though it were the profit. Profitability is now read off netProfit,
  //    which is the figure that decides it.
  const attention = marginPct < 8
    ? churnPct > 6
      ? 'Margin is thin and churn is high'
      : 'Margin is thin and growth is stalling'
    : churnPct > 6
      ? 'Churn is high'
      : 'Growth is stalling';
  const standing = netProfit > 0
    ? `The business is profitable${m(netProfit) ? ` at ${m(netProfit)}/mo` : ''}`
    : netProfit < 0
      ? `The business is losing money${m(-netProfit) ? ` at ${m(-netProfit)}/mo` : ''}`
      : 'The business is breaking even';
  const summary = score >= 85
    ? `Your gym is in strong financial health (${grade}). ${m(netProfit) ? `${m(netProfit)}/mo profit on a ` : 'A '}${marginPct.toFixed(0)}% margin, low churn and positive growth. Keep protecting retention and reinvest into what's working.`
    : score >= 55
    ? `Solid but improvable (${grade}). ${standing}, but ${churnPct > 4 ? 'churn' : 'margin'} is the lever to pull next. Focus there and the score climbs quickly.`
    : `Needs attention (${grade}). ${attention} — tackle the risk items below first; each one directly lifts profitability.`;

  return { score, grade, netProfit, marginPct, churnPct, growthPct, summary, strengths, improvements };
}
