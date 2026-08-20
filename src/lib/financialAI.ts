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

export interface FinInputs {
  revenue: number;      // total monthly revenue (AED)
  expenses: number;     // total monthly expenses (AED)
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

const money = (n: number) => 'AED ' + Math.round(n).toLocaleString();
const pct = (n: number) => (n >= 0 ? '' : '') + n.toFixed(1) + '%';

/** All-zero starting point. The owner fills these in (or accounting supplies them). */
export function emptyFinances(): FinInputs {
  return { revenue: 0, expenses: 0, mrr: 0, members: 0, newMembers: 0, churnedMembers: 0, ptRevenue: 0, classRevenue: 0 };
}

/** True once there is enough entered for a review to mean anything. */
export function hasFigures(f: FinInputs): boolean {
  return f.revenue > 0 || f.expenses > 0 || f.members > 0;
}

export function reviewFinances(f: FinInputs): FinReview {
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

  if (marginPct >= 20) strengths.push({ tone: 'good', title: `Healthy ${marginPct.toFixed(0)}% net margin`, detail: `You keep ${money(netProfit)} of every month's ${money(f.revenue)} — strong operating discipline.` });
  else if (marginPct >= 8) improvements.push({ tone: 'watch', title: `Margin is moderate at ${marginPct.toFixed(0)}%`, detail: `Net profit is ${money(netProfit)}/mo. Review your largest cost lines (staff, rent, platform) — a few points of margin compounds fast.` });
  else improvements.push({ tone: 'risk', title: `Thin margin at ${marginPct.toFixed(0)}%`, detail: `Only ${money(netProfit)} of ${money(f.revenue)} is profit. Prioritise cost review or a modest membership price increase before adding overhead.` });

  if (churnPct <= 3) strengths.push({ tone: 'good', title: `Low churn (${churnPct.toFixed(1)}%/mo)`, detail: `Members are staying — retention is your cheapest growth lever and it's working.` });
  else if (churnPct <= 6) improvements.push({ tone: 'watch', title: `Churn to watch (${churnPct.toFixed(1)}%/mo)`, detail: `You lose ${f.churnedMembers} members/mo. A win-back offer and a check-in on low-attendance members could recover several of them.` });
  else improvements.push({ tone: 'risk', title: `High churn (${churnPct.toFixed(1)}%/mo)`, detail: `Losing ${f.churnedMembers}/mo drags growth. Target at-risk members with a personalised offer and re-engagement push — this is your #1 opportunity.` });

  if (growthPct >= 1.5) strengths.push({ tone: 'good', title: `Growing ${growthPct.toFixed(1)}% net this month`, detail: `${f.newMembers} joined vs ${f.churnedMembers} left. Momentum is positive — good time to invest in referrals or a new branch.` });
  else if (netAdds >= 0) improvements.push({ tone: 'watch', title: `Flat growth (${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}%)`, detail: `New joins barely outpace churn. A referral push and a class-led trial could lift acquisition.` });
  else improvements.push({ tone: 'risk', title: `Shrinking membership`, detail: `You lost ${Math.abs(netAdds)} net members. Fix retention first, then drive acquisition — a promotion pushed to lapsed members is a fast win.` });

  if (recurringShare >= 70) strengths.push({ tone: 'good', title: `${recurringShare.toFixed(0)}% recurring revenue`, detail: `Predictable membership income de-risks the business.` });
  if (f.ptRevenue + f.classRevenue < f.revenue * 0.15) improvements.push({ tone: 'watch', title: `Ancillary revenue is light`, detail: `PT + classes are only ${money(f.ptRevenue + f.classRevenue)}/mo. Promote packs and premium classes to members already in the door — high margin, low cost.` });

  // `grade >= 'A'` was a string comparison, and every grade from A to E sorts at
  // or above 'A' — so this branch always won and the two honest summaries below
  // were dead code. A gym on grade E read "in strong financial health (E) …
  // low churn and positive growth" with its own bad numbers spliced in.
  const summary = score >= 85
    ? `Your gym is in strong financial health (${grade}). ${money(netProfit)}/mo profit on a ${marginPct.toFixed(0)}% margin, low churn and positive growth. Keep protecting retention and reinvest into what's working.`
    : score >= 55
    ? `Solid but improvable (${grade}). The business is profitable at ${money(netProfit)}/mo, but ${churnPct > 4 ? 'churn' : 'margin'} is the lever to pull next. Focus there and the score climbs quickly.`
    : `Needs attention (${grade}). ${marginPct < 8 ? 'Margin is thin and' : ''} ${churnPct > 6 ? 'churn is high' : 'growth is stalling'} — tackle the risk items below first; each one directly lifts profitability.`;

  return { score, grade, netProfit, marginPct, churnPct, growthPct, summary, strengths, improvements };
}
