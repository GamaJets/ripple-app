// Owner financial-health review. Deterministic analysis of the gym's numbers
// (margin, retention, growth, concentration) that reads like an advisor and
// always works offline.
//
// It analyses ONLY figures the owner has entered (or that a connected
// accounting integration supplied). There is no sample/illustrative snapshot:
// this module previously exported `sampleFinances()` returning an invented
// AED 214,000/mo, 1,940-member gym, which the Financial health screen rendered
// as if it were the owner's real business — complete with a grade and an AI
// verdict saying the gym was in strong financial health. Nothing here
// fabricates numbers; `emptyFinances()` is all zeros and `hasFigures()` gates
// the review so an un-filled screen shows an empty state instead of fiction.
import { deltaLabel } from './deltaLabel';

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
 */
const moneyIn = (n: number, currency: string) => `${currency} ${Math.round(n).toLocaleString()}`;
const pct = (n: number) => (n >= 0 ? '' : '') + n.toFixed(1) + '%';

/** All-zero starting point. The owner fills these in (or accounting supplies them). */
export function emptyFinances(): FinInputs {
  return { revenue: 0, expenses: 0, mrr: 0, members: 0, newMembers: 0, churnedMembers: 0, ptRevenue: 0, classRevenue: 0 };
}

/** True once there is enough entered for a review to mean anything. */
export function hasFigures(f: FinInputs): boolean {
  return f.revenue > 0 || f.expenses > 0 || f.members > 0;
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
  const summary = score >= 85
    ? `Your gym is in strong financial health (${grade}). ${m(netProfit) ? `${m(netProfit)}/mo profit on a ` : 'A '}${marginPct.toFixed(0)}% margin, low churn and positive growth. Keep protecting retention and reinvest into what's working.`
    : score >= 55
    ? `Solid but improvable (${grade}). The business is profitable${m(netProfit) ? ` at ${m(netProfit)}/mo` : ''}, but ${churnPct > 4 ? 'churn' : 'margin'} is the lever to pull next. Focus there and the score climbs quickly.`
    : `Needs attention (${grade}). ${marginPct < 8 ? 'Margin is thin and' : ''} ${churnPct > 6 ? 'churn is high' : 'growth is stalling'} — tackle the risk items below first; each one directly lifts profitability.`;

  return { score, grade, netProfit, marginPct, churnPct, growthPct, summary, strengths, improvements };
}
