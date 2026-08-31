// What a join code cost, what it brought back, and — the part that matters —
// when the difference between two codes is too small to mean anything.
//
// src/lib/joinCodes.ts explains why "0 joined" printed under a failed read is
// dangerous: a coach reads it as a campaign that failed and stops printing the
// flyer. This is the same danger with money attached. A coach who is told
// "Instagram is your best channel" moves next month's ad budget onto Instagram,
// and if that sentence came out of a four-versus-one split across twelve
// clients then Repple has just spent their money on a coin toss it presented as
// a finding.
//
// So this module does two jobs, and the second is the point of it:
//
//   1. arithmetic — cost per client, revenue against spend — kept pure so the
//      rules can be asserted without a database;
//   2. REFUSAL — enoughToTell() below declines to rank channels at all until
//      the numbers could distinguish them from chance.
//
// Throughout, unknown is a distinct value from zero and never collapses into
// it. No spend recorded is not zero spend: a campaign whose cost nobody wrote
// down would otherwise show an infinite return and win every comparison. An
// unread revenue figure is not no revenue. Both arrive here as null and leave
// as a dash.
import { num } from './format';
import { money } from './gymRecord';
import type { LoadStatus } from '../ui/loadStatus';

/** An amount and the currency it is an amount of. Minor units, as money() takes. */
export type Money = { cents: number; currency: string };

/** A row of my_code_returns(), as PostgREST hands it back. */
export type RawCodeReturn = {
  id: string | null;
  code: string | null;
  label: string | null;
  created_at: string | null;
  revoked_at: string | null;
  is_default: boolean | null;
  joined: number | string | null;
  active_now: number | string | null;
  /** Null when the purchases behind the code did not agree on one currency. */
  revenue_cents: number | string | null;
  revenue_currency: string | null;
  /** Null when the coach has recorded nothing. NOT zero. */
  spend_cents: number | string | null;
  spend_currency: string | null;
};

/** The same row, once it is safe to reason about. */
export type CodeReturnRow = {
  id: string | null;
  code: string;
  label: string;
  isDefault: boolean;
  isLive: boolean;
  createdAt: string | null;
  /** People, not requests — one per client, attributed last touch. */
  clients: number;
  /** How many of them are still on the roster today. */
  activeNow: number;
  /** null = we could not put a single figure on it, never "they paid nothing". */
  revenue: Money | null;
  /** null = the coach has not said what this cost, never "it was free". */
  spend: Money | null;
};

/**
 * The smallest number of clients across the two codes being compared at which
 * a difference between them can be anything but chance.
 *
 * The reasoning, because a threshold nobody can check is a threshold somebody
 * will quietly lower. Take the coach's own null hypothesis — these two channels
 * are equally good — and the arrival of each client is then a coin toss over
 * which code they came in on. With n clients split between the two codes, the
 * split is Binomial(n, ½), and a two-sided exact test is the honest way to ask
 * whether the observed split is surprising.
 *
 * At n = 5 the most lopsided possible result, 5–0, has p = 2 × (½)^5 = 0.0625.
 * Nothing at n = 5 clears p < 0.05. It is not that a 4–1 split is weak evidence
 * at five clients; it is that NO split at five clients is evidence, so a screen
 * that ranks them is ranking noise however the numbers fall.
 *
 * At n = 6 a 6–0 split gives p = 0.03125, and the question becomes answerable
 * for the first time. Six is therefore not a round number picked for feel — it
 * is the point at which the test can return an answer at all.
 *
 * Clearing this bar is necessary and not sufficient: the split itself still has
 * to be extreme enough, which is what tellApart() below actually tests. The
 * brief's own example — twelve clients, Instagram 4, TikTok 1 — clears nothing:
 * n = 5 between those two codes, and even had it been 4–1 out of a hundred
 * elsewhere, p = 0.375. That coach has learned nothing and is told so.
 */
export const MIN_CLIENTS_TO_COMPARE = 6;

/**
 * How much chance we are willing to mistake for a channel. The conventional
 * 5%, stated as a constant because it is the other half of the threshold and
 * has to move with it if it ever moves.
 */
export const NOISE_P = 0.05;

/**
 * Said once on the screen, not buried.
 *
 * my_code_returns() attributes each client to the code on their most recent
 * accepted request. Somebody who sees an Instagram post, thinks about it for a
 * month and finally joins off a code a friend gave them is counted as the
 * friend's, and Instagram gets nothing for the work that started it. That is a
 * real limitation of every last-touch model and a coach making budget decisions
 * on these numbers is entitled to know it before they read the numbers.
 *
 * It also says what is not here at all. Only joins BY CODE are on this list —
 * a client who found the coach by browsing the directory is on the roster and
 * in none of these rows, so these figures do not add up to the coach's whole
 * business and are not meant to.
 */
export const LAST_TOUCH_NOTE =
  'Each client is credited to the last code they actually used. Somebody who saw your Instagram post and later joined off a friend’s code — or with no code at all — counts there and not here, so the channels that start people off look smaller than they are, and this list is only the people who arrived by code.';

const count = (v: number | string | null | undefined): number => {
  // PostgREST returns bigint as a STRING — a bigint does not survive
  // JSON.parse intact. Number('') and Number(null) are both 0, so either would
  // arrive as a confident zero; only a finite number is a count.
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * Minor units plus a currency, or null.
 *
 * Null in either half yields null, and that is the whole point of the helper.
 * An amount with no currency is not an amount of money, and defaulting the
 * currency would let a figure in dirhams be compared against one in pounds
 * without anything on the screen looking wrong.
 */
const asMoney = (cents: number | string | null | undefined, currency: string | null | undefined): Money | null => {
  if (cents == null || currency == null) return null;
  const n = typeof cents === 'string' ? Number(cents) : cents;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const c = String(currency).trim().toUpperCase();
  if (!c) return null;
  return { cents: Math.round(n), currency: c };
};

/**
 * Raw rows → rows worth rendering, in the order they should be read.
 *
 * Same order as shapeJoinCodes(): the default code first because it is the one
 * already on the cards, then live codes newest first, then revoked ones, whose
 * figures are the record of what a finished campaign did. A row with no code is
 * dropped rather than drawn blank, for the reason given there.
 */
export function shapeCodeReturns(rows: RawCodeReturn[] | null | undefined): CodeReturnRow[] {
  const out: CodeReturnRow[] = [];
  for (const r of rows || []) {
    const code = (r?.code || '').trim().toUpperCase();
    if (!code) continue;
    const isDefault = !!r.is_default;
    out.push({
      id: r.id ?? null,
      code,
      label: (r.label || '').replace(/\s+/g, ' ').trim() || (isDefault ? 'Your main code' : code),
      isDefault,
      isLive: !r.revoked_at,
      createdAt: r.created_at ?? null,
      clients: count(r.joined),
      activeNow: count(r.active_now),
      revenue: asMoney(r.revenue_cents, r.revenue_currency),
      spend: asMoney(r.spend_cents, r.spend_currency),
    });
  }
  return out.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    const at = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (at !== bt) return bt - at;
    return a.code.localeCompare(b.code);
  });
}

/**
 * What each client off this code cost.
 *
 * Null unless the spend is recorded AND somebody actually came: dividing a real
 * £400 by zero clients is not "£0 each", and a screen that printed Infinity or
 * a dash-shaped zero there would be describing the worst campaign the coach
 * ran as costless.
 */
export function costPerClient(row: CodeReturnRow): Money | null {
  if (!row.spend || row.clients <= 0) return null;
  return { cents: Math.round(row.spend.cents / row.clients), currency: row.spend.currency };
}

/**
 * Revenue against spend for one code, or why there is no such figure.
 *
 * `back` is revenue divided by spend — 3 means three pounds back per pound in.
 * It is null when the spend is a recorded zero, because everything divided by
 * nothing is not a large number, it is not a number. The net is still stated in
 * that case: a free code that earned £900 earned £900.
 */
export type CodeReturn =
  | { known: true; net: Money; back: number | null }
  | { known: false; why: 'no-spend' | 'no-revenue' | 'currency'; note: string };

export function codeReturn(row: CodeReturnRow): CodeReturn {
  if (!row.spend) {
    return {
      known: false,
      why: 'no-spend',
      note: 'Add what this code cost you and Repple can tell you what it returned.',
    };
  }
  if (!row.revenue) {
    return {
      known: false,
      why: 'no-revenue',
      note: 'What these clients have paid could not be totalled, so there is no return to show.',
    };
  }
  if (row.revenue.currency !== row.spend.currency) {
    // Subtracting one currency from another gives a number that is not an
    // amount of anything. It would still look like money on screen.
    return {
      known: false,
      why: 'currency',
      note: `You recorded this spend in ${row.spend.currency} and these clients paid in ${row.revenue.currency}, so the two cannot be compared here.`,
    };
  }
  return {
    known: true,
    net: { cents: row.revenue.cents - row.spend.cents, currency: row.revenue.currency },
    back: row.spend.cents > 0 ? row.revenue.cents / row.spend.cents : null,
  };
}

/**
 * The two-sided exact probability of a split this lopsided, or worse, if the
 * two codes were in truth equally good.
 *
 * Computed in log space and summed with the log-sum-exp trick, because the
 * straightforward product of binomial coefficients over 2^n underflows to zero
 * somewhere past a couple of hundred clients — and a p that has underflowed to
 * 0 reads as certainty, which is the exact failure this function exists to
 * prevent, arrived at by arithmetic instead of by wishful thinking.
 */
export function splitP(a: number, b: number): number {
  const n = Math.round(a) + Math.round(b);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const m = Math.min(Math.round(a), Math.round(b));
  // log of P(exactly 0 on one side) = log(2^-n)
  let logTerm = -n * Math.LN2;
  let logSum = logTerm;
  for (let k = 1; k <= m; k++) {
    // pmf(k) / pmf(k-1) = (n - k + 1) / k
    logTerm += Math.log((n - k + 1) / k);
    const hi = Math.max(logSum, logTerm);
    const lo = Math.min(logSum, logTerm);
    logSum = hi + Math.log1p(Math.exp(lo - hi));
  }
  return Math.min(1, 2 * Math.exp(logSum));
}

/** Whether two codes' client counts can be told apart from a coin toss. */
export type Apart =
  | { tell: true; p: number }
  | { tell: false; why: 'too-few' | 'too-close'; p: number; have: number; needed: number };

export function tellApart(a: number, b: number): Apart {
  const have = Math.max(0, Math.round(a)) + Math.max(0, Math.round(b));
  if (have < MIN_CLIENTS_TO_COMPARE) {
    return { tell: false, why: 'too-few', p: splitP(a, b), have, needed: MIN_CLIENTS_TO_COMPARE };
  }
  const p = splitP(a, b);
  if (p > NOISE_P) return { tell: false, why: 'too-close', p, have, needed: MIN_CLIENTS_TO_COMPARE };
  return { tell: true, p };
}

/**
 * Which channel is winning — or, far more often, the refusal to say.
 *
 * Only the top two codes are tested. If the best and the second best cannot be
 * told apart there is no ranking to be had, whatever the rest of the list does;
 * and if they can, the coach has the one comparison they came here to make.
 *
 * The default code is left out of the ranking deliberately. Its bucket is not a
 * channel: my_code_returns() puts into it everybody whose code no named code
 * claims, including codes since rotated away. Declaring "your main code" the
 * winner would be telling a coach to spend more on a thing that is not a thing.
 *
 * Under any status but 'ready' this refuses outright. An empty or truncated
 * read is not a channel that brought nobody — see src/ui/loadStatus.ts.
 */
export type Tell =
  | { rankable: true; best: CodeReturnRow; runnerUp: CodeReturnRow; p: number; note: string }
  | { rankable: false; why: 'unread' | 'one-code' | 'too-few' | 'too-close'; note: string; have: number; needed: number };

export function enoughToTell(status: LoadStatus, rows: CodeReturnRow[]): Tell {
  const needed = MIN_CLIENTS_TO_COMPARE;
  if (status !== 'ready') {
    return {
      rankable: false,
      why: 'unread',
      note: 'Your codes could not be read, so nothing here compares them.',
      have: 0,
      needed,
    };
  }
  const named = rows.filter((r) => !r.isDefault);
  if (named.length < 2) {
    return {
      rankable: false,
      why: 'one-code',
      note: 'One code cannot be compared with anything. Make a second — one per channel — and both can run at once.',
      have: named.reduce((n, r) => n + r.clients, 0),
      needed,
    };
  }
  const ranked = [...named].sort((a, b) => b.clients - a.clients || a.label.localeCompare(b.label));
  const best = ranked[0];
  const runnerUp = ranked[1];
  const apart = tellApart(best.clients, runnerUp.clients);
  if (!apart.tell) {
    const note = apart.why === 'too-few'
      ? `Too few to tell. ${num(apart.have)} ${apart.have === 1 ? 'client has' : 'clients have'} come in on your two busiest codes, and below ${num(needed)} no split between them means anything — a run of heads is not a better coin. Keep both running.`
      : `Too close to tell. ${best.label} is ahead of ${runnerUp.label}, but a gap that size turns up about ${oneIn(apart.p)} of the time when two channels are equally good. Keep both running rather than moving money on this.`;
    return { rankable: false, why: apart.why, note, have: apart.have, needed };
  }
  return {
    rankable: true,
    best,
    runnerUp,
    p: apart.p,
    note: `${best.label} is bringing in more than ${runnerUp.label} by more than chance would explain — a gap this size comes up about ${oneIn(apart.p)} of the time between two equally good channels.`,
  };
}

/** A probability as a person reads one: "1 time in 20". */
function oneIn(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return 'almost none';
  if (p >= 1) return 'most';
  return `1 time in ${num(Math.round(1 / p))}`;
}

/**
 * What the coach typed into the spend field → what to send.
 *
 * Blank CLEARS the record rather than storing zero, and those are different
 * facts: "this cost me nothing" is a claim a coach can make about an organic
 * post, and "I have not told you" is not a claim at all. Storing the second as
 * the first would give an unmeasured campaign a perfect return and float it to
 * the top of every comparison.
 *
 * Whole units in, minor units out — a coach types 400, not 40000.
 */
export type SpendInput =
  | { kind: 'clear' }
  | { kind: 'amount'; cents: number }
  | { kind: 'bad'; reason: string };

export function parseSpend(input: string | null | undefined): SpendInput {
  const raw = String(input ?? '').trim().replace(/[, ]/g, '');
  if (!raw) return { kind: 'clear' };
  // Currency symbols are what a person types when asked for an amount of
  // money, and refusing them teaches nothing.
  const bare = raw.replace(/^[^\d.\-]+/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(bare)) {
    if (/^-/.test(bare) || /^[^\d.]*-/.test(raw)) return { kind: 'bad', reason: 'Spend cannot be negative.' };
    return { kind: 'bad', reason: 'Enter what you spent as a number — 250, or 250.50. Leave it empty if you do not know.' };
  }
  const cents = Math.round(Number(bare) * 100);
  if (!Number.isFinite(cents)) return { kind: 'bad', reason: 'That is not an amount.' };
  if (cents >= 100000000000) return { kind: 'bad', reason: 'That is more than Repple will record against one code — check the zeros.' };
  return { kind: 'amount', cents };
}

/** What is already in the spend field when the sheet opens, or '' for unknown. */
export function spendFieldValue(row: CodeReturnRow): string {
  if (!row.spend) return '';
  const whole = row.spend.cents / 100;
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(2);
}

/**
 * The four figures under one code, as strings ready to render.
 *
 * Every one of them is a dash under anything but a completed read, for the
 * reason codeCountLine() in src/lib/joinCodes.ts gives: a zero printed because
 * the request failed reads exactly like a campaign that failed, and here it
 * would also read like money that was never earned.
 */
export type CodeFigures = { spent: string; clients: string; revenue: string; perClient: string };

export function codeFigures(status: LoadStatus, row: CodeReturnRow): CodeFigures {
  const dash = '—';
  if (status !== 'ready') return { spent: dash, clients: dash, revenue: dash, perClient: dash };
  const per = costPerClient(row);
  return {
    spent: row.spend ? (money(row.spend.cents, row.spend.currency) ?? dash) : dash,
    clients: num(row.clients),
    revenue: row.revenue ? (money(row.revenue.cents, row.revenue.currency) ?? dash) : dash,
    perClient: per ? (money(per.cents, per.currency) ?? dash) : dash,
  };
}

/**
 * The one line that says whether the code paid for itself, or why nobody can
 * say. Empty under an incomplete read — the figures beside it are already
 * dashes, and a second sentence repeating the failure is noise.
 *
 * The negative case is worded rather than signed. `money()` would render a loss
 * as "GBP -400.00", and a minus sign in a small grey line is the easiest thing
 * on a screen to miss when it is the only thing separating a channel that made
 * money from one that lost it.
 */
export function returnLine(status: LoadStatus, row: CodeReturnRow): string {
  if (status !== 'ready') return '';
  const r = codeReturn(row);
  if (!r.known) return r.note;
  const back = r.back != null ? ` That is ${r.back.toFixed(1)}× what you put in.` : '';
  if (r.net.cents >= 0) {
    return `${money(r.net.cents, r.net.currency) ?? '—'} more than it cost you.${back}`;
  }
  return `It has cost you ${money(-r.net.cents, r.net.currency) ?? '—'} more than it has brought in.${back}`;
}

/**
 * The sentence under one code's figures.
 *
 * Says how many of the people it brought are still here, because that is the
 * half of "did it work" that a join count cannot answer: ten clients who all
 * left is not the same channel as four who stayed.
 */
export function stayedLine(status: LoadStatus, row: CodeReturnRow): string {
  if (status === 'loading') return 'Working out what it brought in…';
  if (status === 'error') return 'We couldn’t read what this code brought in.';
  if (status === 'partial') return 'Not all of your clients could be read, so nothing here is a total.';
  if (row.clients === 0) return row.isLive ? 'Nobody has come in on it yet.' : 'Nobody came in on it.';
  const stayed = `${num(row.activeNow)} of ${num(row.clients)} still with you`;
  return row.activeNow === row.clients ? `${stayed} — all of them.` : `${stayed}.`;
}
