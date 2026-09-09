// Several gyms, side by side — and the rules a figure over them has to obey.
//
// ── What existed before this file, and what did not ───────────────────────
//
// `supabase/parts/290` records WHO OWNS WHAT (`owner_sites`, `my_sites()`) and
// grants nothing else. `src/lib/ownedSites.ts` is the console's honesty about
// that: an owner recorded against two gyms sees the second one's NAME, is told
// in words that no figure on the page includes it, and a single-site owner
// cannot tell any of it exists. Both are applied and both are correct.
//
// What has never existed anywhere in this codebase is a figure over more than
// one gym. `docs/ROADMAP.md` says so and a sweep confirms it: `my_sites()` has
// four readers (`studio-web/lib/sites.ts` and the three screens that print its
// copy) and not one of them adds anything up.
//
// This module is that arithmetic, and almost all of it is refusal. The sum is
// four lines; the rest is the four ways a cross-site figure lies.
//
// ── 1 · A TOTAL IS ONLY A FIGURE WHEN THE SITES AGREE WHAT IT IS MADE OF ──
//
// Two gyms on different currencies have no combined revenue. `tenants.currency`
// is per gym, it is NULLABLE ON PURPOSE (part 150 dropped the `'AED'` default
// from all seven money columns, and that default has been removed from this
// codebase three times), `currencyDecimals()` answers `null` for a code nobody
// stated, sixteen currencies have no minor unit at all and five have three of
// them. So there is no exchange rate here, no base currency, and no addition
// across codes — ever.
//
// The vocabulary is NOT invented here. `src/lib/monthEnd.ts` and
// `src/lib/staffView.ts` both closed this exact shape on their own screens
// today, and `src/lib/gymRateCurrency.ts` holds the words: a figure comes with
// `currency` / `mixedCurrency` / `note`, derived WHERE THE NUMBER IS COMPUTED
// rather than where it is rendered, because a label supplied by the screen is
// how a GBP gym's payroll came to be filed in dirhams. `normaliseCurrency` is
// imported from `./gymRecord` for the same reason it is exported there: a rule
// about money that exists twice is eventually two rules.
//
// ── 2 · TWO GYMS IN DIFFERENT TIMEZONES DO NOT SHARE A MONTH ─────────────
//
// `tenants.timezone` is per gym (part 710, validated against
// `pg_timezone_names`) and `src/lib/monthEnd.ts` closes a month on the gym's
// own clock. "September" at a gym in Europe/London and "September" at a gym in
// Asia/Dubai are two different windows that overlap for most of their length,
// and a single heading over both is a claim nobody checked. `zoneSpan` below
// answers which case a roll-up is in and `periodNote` is the sentence for the
// one that needs one. Nothing here converts a window; it only declines to
// pretend there was one.
//
// ── 3 · A SITE WHOSE READ FAILED IS NOT A SITE WITH NO MEMBERS ───────────
//
// The single most likely way to get this feature wrong, and it has shipped
// here twice in the narrow form: `status !== 'error'` admits 'loading' AND
// 'partial', and `status === 'error' || status === 'loading'` admits 'partial'.
// `scripts/check-whole.mjs` exists because fourteen screens carried the same
// hand-fixed comment about it.
//
// Across sites it gets worse rather than better, because the wrong answer is
// not an empty screen — it is a smaller number that looks like a real one. A
// roll-up over four gyms where one read failed is A FLOOR, NOT A TOTAL, and
// every function here that produces one says so in the type (`floor`) and in
// the copy (`floorNote`). `isWhole` is the gate and it is imported rather than
// re-spelled.
//
// ── 4 · NULL, NOT ZERO ───────────────────────────────────────────────────
//
// `docs/ROADMAP.md`'s standing rule, and `gymRecord.summarise`,
// `gymTrainers.payroll30For`, `gymPasses.passRevenueCents` and `staffView` all
// obey it. A roll-up with nothing in it returns `null`, never `0`: zero gyms
// answering is not a business with no members.
//
// ── What this module deliberately is NOT ─────────────────────────────────
//
// Phase 5. No forecast, no projection, no capacity model, no seasonality, no
// comparison of one site against another dressed up as a ranking. This is
// Record and Read: what each site IS, side by side, and a drill-down into one.
//
// Pure: no react, no supabase, no clock. Every function takes rows already
// fetched and returns a conclusion — the shape `monthEnd.ts`, `memberView.ts`
// and `staffView.ts` use, and for the same reason: the reads are where the
// failure modes live and only the screen can render its own failures.
import { isWhole, type LoadStatus } from '../ui/loadStatus';
import { normaliseCurrency } from './gymRecord';

/* ── one gym, as a roll-up sees it ────────────────────────────────────────── */

/**
 * A money figure and the currencies the rows behind it actually STATED.
 *
 * Two fields and not one code, for `monthEnd.Income`'s reason: a row that
 * states no currency is a real answer about that row and it belongs in the set
 * that decides whether a total may be summed — but it is not a WORD, so it
 * cannot go into "recorded in X and Y", which would render "recorded in and
 * GBP". `currencies` is the words; `unstated` is the other member of the set.
 *
 * `cents` is what the rows add up to BEFORE any of that is judged. It may be a
 * perfectly good figure in one currency, or a sum across two that must never be
 * printed — `denominate` is what tells the two apart, and it is the only thing
 * that may.
 */
export interface SiteMoney {
  cents: number | null;
  /** Distinct codes the rows stated. Not normalised on the way in — this
   *  module normalises, so a read that hands over ' gbp ' cannot open a second
   *  pot next to 'GBP' and withhold a total the gym is entitled to. */
  currencies: readonly string[];
  /** At least one row behind `cents` stated no currency at all. */
  unstated: boolean;
}

/**
 * One gym's line in a roll-up.
 *
 * `status` and `refused` answer two different questions and both have to be
 * asked. `status` is the house vocabulary from `src/ui/loadStatus.ts` — did the
 * read finish, and is what came back all of it. `refused` is the state part 290
 * actually leaves the platform in: this account is RECORDED against the gym and
 * no policy lets this session read its rows. That is not a failed read. Nothing
 * went wrong, retrying changes nothing, and the sentence a person needs is a
 * different one.
 */
export interface SiteFigures {
  siteId: string;
  /** `tenants.name`, or null when the gym has never been named. Null here is
   *  not a failed read — see `OwnedSite.name` in ./ownedSites. */
  name: string | null;
  /** True for the ONE site this session reads through every other screen in
   *  the console. At most one line in a roll-up carries it. */
  current: boolean;
  /** True when this gym's rows are not on this sign-in at all. */
  refused: boolean;
  status: LoadStatus;
  /** `tenants.currency` — what this gym counts in, or null when it has not
   *  said. Never defaulted. */
  currency: string | null;
  /** `tenants.timezone` — the IANA zone this gym's own day is measured in, or
   *  null when it has not said. Null is never UTC and never the reader's own
   *  zone. */
  timezone: string | null;
  /** Memberships in status 'active'. Null means the record cannot say. */
  activeMembers: number | null;
  /** People on the gym's coach roster. Null means the record cannot say. */
  trainers: number | null;
  /** Money the gym recorded taking in the window the read asked for. */
  taken: SiteMoney;
}

/* ── why a gym is not in a total ──────────────────────────────────────────── */

/**
 * The one reason a gym contributed nothing. Exactly one per gym per figure.
 *
 * Ordered here by precedence, which `gapOf` applies: a refused gym is refused
 * whatever its status says, and a gym that did not finish reading cannot also
 * be reported as having nothing on record.
 */
export type SiteGap =
  /** Not on this sign-in. Part 290 changed no policy; this is the ordinary
   *  state of a second gym and not a fault. */
  | 'refused'
  /** The read did not answer, or was refused by the database. */
  | 'error'
  /** The read has not answered yet. */
  | 'loading'
  /** The read answered at the row cap — the rows are real, the set is a
   *  prefix, and a figure over it is computed from an unknown fraction. */
  | 'partial'
  /** Read whole, and the record has no figure to give. Not a zero. */
  | 'unstated'
  /** Read whole, figure real, and denominated in money the others are not.
   *  Decided across the gyms, not by the gym on its own. */
  | 'currency';

/**
 * Why this gym is out of a figure, or null when it is in it.
 *
 * `value` is the measure being rolled up, already picked off the line. Passing
 * it in rather than re-picking it here is what keeps 'unstated' honest: the
 * question is about the figure being summed, and a gym can have members on
 * record and no revenue.
 *
 * `isWhole` and not `status !== 'error'`. The whole file turns on it.
 */
export function gapOf(site: SiteFigures, value: number | null): SiteGap | null {
  if (site.refused) return 'refused';
  if (!isWhole(site.status)) {
    // Named individually rather than folded into one 'unread'. A gym that is
    // still loading and a gym that answered with a prefix of its rows are two
    // different sentences, and the second one is the one nobody expects.
    return site.status === 'error' ? 'error' : site.status === 'loading' ? 'loading' : 'partial';
  }
  return value == null ? 'unstated' : null;
}

/** One gym left out of a figure, and why. */
export interface SiteGapLine {
  siteId: string;
  name: string | null;
  why: SiteGap;
}

/* ── the fold ─────────────────────────────────────────────────────────────── */

/** What every rolled-up figure carries about its own completeness. */
export interface Roll {
  /** Ids of the gyms that contributed, in the order they were given. */
  counted: string[];
  /** The gyms that did not, each with the one reason. */
  gaps: SiteGapLine[];
  /** Every gym contributed. Only then is the figure a TOTAL. False for an
   *  empty roll-up: no gyms is not a complete answer about a business. */
  whole: boolean;
  /**
   * There is a figure AND it is missing at least one gym.
   *
   * The flag a screen must render differently. A floor is a real number that
   * is smaller than the truth by an unknown amount, and it is the single most
   * dangerous thing on a multi-site page — it looks exactly like a total.
   */
  floor: boolean;
}

/** A counted figure over several gyms. */
export interface CountRoll extends Roll {
  /** The sum over the gyms in `counted`, or null when none contributed. */
  total: number | null;
}

/** A money figure over several gyms. */
export interface MoneyRoll extends Roll {
  /** The sum, or null — because nothing contributed, or because what did is
   *  not all in one money. */
  cents: number | null;
  /** The one code `cents` may be labelled with, or null. Null with a non-null
   *  `cents` is the 'unrecorded' case from ./gymRateCurrency: the figure is
   *  real and its unit is genuinely not on the record. */
  currency: string | null;
  /** Every code the contributing gyms actually stated, sorted. The WORDS. */
  currencies: string[];
  /** The gate. Not `currencies.length > 1` — a gym that stated nothing is a
   *  second answer and it is not a word. */
  mixedCurrency: boolean;
}

function rollFrom(sites: readonly SiteFigures[], gaps: SiteGapLine[], counted: string[]): Roll {
  return {
    counted,
    gaps,
    whole: sites.length > 0 && gaps.length === 0,
    floor: counted.length > 0 && gaps.length > 0,
  };
}

/**
 * Add one measure up across the gyms that can answer for it.
 *
 * `total` is null and never 0 when nothing contributed. Zero gyms answering is
 * not a business with no members, and this is the function where that mistake
 * would be invisible: the page would print a confident 0 beside a list of gyms
 * it had just failed to read.
 */
export function rollCount(
  sites: readonly SiteFigures[],
  pick: (s: SiteFigures) => number | null,
): CountRoll {
  const gaps: SiteGapLine[] = [];
  const counted: string[] = [];
  let total = 0;
  for (const s of sites) {
    const value = pick(s);
    const why = gapOf(s, value);
    if (why) { gaps.push({ siteId: s.siteId, name: s.name, why }); continue; }
    counted.push(s.siteId);
    total += value as number;
  }
  return { ...rollFrom(sites, gaps, counted), total: counted.length ? total : null };
}

/** What a set of money parts is denominated in, and whether it may be summed
 *  at all. One rule; `rollMoney` runs it across gyms and `siteMoney` runs it
 *  over one gym's own rows, so the two scopes cannot answer differently. */
export interface Denomination {
  cents: number | null;
  currency: string | null;
  currencies: string[];
  mixedCurrency: boolean;
}

/**
 * The currencies a set of money parts states, and the total if there is one.
 *
 * A part with a figure and nothing stated about it joins the same pot as a part
 * that explicitly recorded none — both are "nobody said", and both are one
 * member of the set rather than a free pass. That is what stops an unlabelled
 * gym being quietly absorbed into a labelled neighbour's currency, which is the
 * cross-site form of the substitution part 1010 added `sessions.rate_currency`
 * to end.
 */
export function denominate(parts: readonly SiteMoney[]): Denomination {
  const codes = new Set<string | null>();
  let cents = 0;
  let any = false;
  for (const p of parts) {
    if (p.cents == null) continue;
    any = true;
    cents += p.cents;
    let stated = false;
    for (const c of p.currencies) {
      const code = normaliseCurrency(c);
      if (code) { codes.add(code); stated = true; }
    }
    if (p.unstated || !stated) codes.add(null);
  }
  if (!any) return { cents: null, currency: null, currencies: [], mixedCurrency: false };
  const mixedCurrency = codes.size > 1;
  const only = codes.size === 1 ? [...codes][0] : null;
  return {
    // Two moneys added together is not an amount of anything, so the figure
    // does not survive. `currencies` says which pots were in it.
    cents: mixedCurrency ? null : cents,
    currency: mixedCurrency ? null : only,
    currencies: [...codes].filter((c): c is string => c != null).sort(),
    mixedCurrency,
  };
}

/**
 * One gym's own money figure, judged against its own rows.
 *
 * The drill-down's version of `rollMoney`, and deliberately the same function
 * underneath: a gym that changed its currency mid-window has a `cents` that is
 * a sum across two moneys, and that is not a figure at one site any more than
 * it is across four.
 */
export function siteMoney(m: SiteMoney): Denomination {
  return denominate([m]);
}

/**
 * Money, added up across the gyms that agree what money it is.
 *
 * A gym whose currency disagrees is not silently dropped and it is not
 * converted. The figure is WITHHELD for everybody — `cents` is null,
 * `mixedCurrency` is true — because the alternative is a total over three of
 * four gyms presented as the business's revenue, which is the same lie as a
 * floor and harder to see.
 */
export function rollMoney(
  sites: readonly SiteFigures[],
  pick: (s: SiteFigures) => SiteMoney,
): MoneyRoll {
  const gaps: SiteGapLine[] = [];
  const counted: string[] = [];
  const contributors: SiteGapLine[] = [];
  const parts: SiteMoney[] = [];
  for (const s of sites) {
    const m = pick(s);
    const why = gapOf(s, m.cents);
    if (why) { gaps.push({ siteId: s.siteId, name: s.name, why }); continue; }
    counted.push(s.siteId);
    contributors.push({ siteId: s.siteId, name: s.name, why: 'currency' });
    parts.push(m);
  }
  const d = denominate(parts);
  // A mixed set has no total, so no gym is IN one. Every contributor is
  // restated as a 'currency' gap rather than left in `counted` beside a null
  // figure — a screen reading `counted.length` would otherwise report four
  // gyms in a total that does not exist, and `floor` would claim the missing
  // amount runs in one direction when there is no amount at all.
  if (d.mixedCurrency) {
    return { counted: [], gaps: [...contributors, ...gaps], whole: false, floor: false, ...d };
  }
  return { ...rollFrom(sites, gaps, counted), ...d };
}

/* ── one month, or two? ───────────────────────────────────────────────────── */

/**
 * How many clocks the gyms behind a figure keep.
 *
 * Deliberately the shape of `branchSpan` in ./ownedSites — four kinds, the same
 * names, `unknown` for a question that could not be asked — because it is the
 * same question asked one level up, and a second vocabulary for "this figure
 * covers more than one place" is how two screens come to word one silence two
 * ways.
 *
 *   'unknown'  nothing contributed, so there is no set of clocks to describe.
 *   'none'     no contributing gym has set a timezone. Every window over them
 *              is drawn on somebody else's clock, and the screen must say so.
 *   'one'      every contributing gym keeps the same zone. A month is a month.
 *   'mixed'    two zones, or a zone and a gym that has not said. A period
 *              heading over this covers more than one window.
 */
export type ZoneSpan =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'one'; zone: string }
  | { kind: 'mixed'; zones: string[]; unzoned: boolean };

/**
 * The clocks behind a roll-up.
 *
 * Takes the roll rather than the gyms, and filters by `roll.counted`, so the
 * answer is about the gyms actually IN the figure. Asking it of the whole list
 * would report two zones for a figure that only one gym contributed to — a
 * warning about a problem the figure does not have, which teaches a reader to
 * ignore the ones it does.
 */
export function zoneSpan(roll: Roll, sites: readonly SiteFigures[]): ZoneSpan {
  const inFigure = new Set(roll.counted);
  const zones = new Set<string>();
  let unzoned = false;
  let any = false;
  for (const s of sites) {
    if (!inFigure.has(s.siteId)) continue;
    any = true;
    const z = (s.timezone ?? '').trim();
    if (z) zones.add(z); else unzoned = true;
  }
  if (!any) return { kind: 'unknown' };
  if (zones.size === 0) return { kind: 'none' };
  if (zones.size === 1 && !unzoned) return { kind: 'one', zone: [...zones][0] };
  return { kind: 'mixed', zones: [...zones].sort((a, b) => a.localeCompare(b)), unzoned };
}

/**
 * Whether a period heading — "September", "this month", "last 30 days by the
 * gym's day" — may be written over this figure as if it named one window.
 *
 * False under 'mixed' and under 'none', and true under 'one'. 'unknown' is
 * false as well: a screen may not claim a scope it did not establish, which is
 * `mayPresentAsOneSite`'s rule in ./ownedSites applied to time instead of
 * place.
 */
export function mayPresentAsOnePeriod(span: ZoneSpan): boolean {
  return span.kind === 'one';
}

/**
 * The sentence a period heading needs, or null when it needs none.
 *
 * `period` is the heading as the screen writes it — 'September', 'this month'.
 * It is interpolated rather than described so the note names the same words the
 * reader just read.
 */
export function periodNote(span: ZoneSpan, period: string): string | null {
  switch (span.kind) {
    case 'unknown':
    case 'one':
      return null;
    case 'none':
      return `No gym in this figure has set a timezone, so ${period} here is drawn on Repple’s clock rather than on any gym’s day. An owner sets a gym’s timezone on its settings screen.`;
    case 'mixed': {
      const named = span.zones.join(', ');
      const tail = span.unzoned
        ? `${named}, and at least one gym that has not set one`
        : named;
      return `These gyms keep different clocks — ${tail} — so ${period} is not one window here. Each gym’s day starts and ends at its own hour, and this figure covers all of them.`;
    }
  }
}

/* ── the copy a rolled-up figure cannot be shown without ──────────────────── */

/** How one gym is named in a sentence about it. Never the bare name when there
 *  is none: `— did not answer` reads as a broken screen rather than as missing
 *  data, which is what scripts/check-prose.mjs exists to stop. */
function nameOf(line: SiteGapLine): string {
  return line.name ?? 'a gym this console cannot name';
}

/** What each reason reads as, as the predicate of a sentence whose subject is
 *  the gym. One clause per reason, in one place. */
function clauseFor(why: SiteGap): string {
  switch (why) {
    case 'refused': return 'is not on this sign-in';
    case 'error': return 'did not answer';
    case 'loading': return 'has not answered yet';
    case 'partial': return 'answered with more rows than came back';
    case 'unstated': return 'has nothing on record to add';
    case 'currency': return 'counts in a different currency';
  }
}

/** The gyms left out, named with their reasons, or null when none were. */
export function gapsNote(roll: Roll): string | null {
  if (!roll.gaps.length) return null;
  return roll.gaps.map((g) => `${nameOf(g)} ${clauseFor(g.why)}`).join('; ') + '.';
}

/**
 * THE SENTENCE THIS MODULE EXISTS FOR.
 *
 * Null only when the figure is a total over every gym. In every other case a
 * multi-site figure is either a floor or absent, and both need saying:
 *
 *   · nothing contributed — there is no figure, and the reason is not "you have
 *     no members";
 *   · some contributed — the number on screen is REAL and SMALLER THAN THE
 *     TRUTH by an unknown amount. It is called a floor in as many words,
 *     because "partial" and "incomplete" are read as a hedge and a floor is a
 *     fact about which direction the error runs in.
 */
export function floorNote(roll: Roll): string | null {
  if (roll.whole) return null;
  const total = roll.counted.length + roll.gaps.length;
  const gaps = gapsNote(roll);
  if (total === 0) return 'No gyms were read, so there is nothing here to add up.';
  // ONE SILENCE, ONE EXPLANATION. A money roll-up whose gyms all read fine and
  // simply count in different moneys has every gym in `gaps` for the same
  // reason, and `moneyNote` says it in full — including the part that matters,
  // which is that Repple does not convert. A second paragraph here saying "not
  // one of these gyms could be added up" is the same silence worded twice, and
  // ./ownedSites' `branchNote` declines the identical duplication for the
  // identical reason.
  if (roll.gaps.every((g) => g.why === 'currency')) return null;
  // numbers-ok: both figures are counts of GYMS under one owner, so neither can
  // reach a thousand — and this module must not call a formatter to say so.
  // ./ownedSites is the sibling this file follows, six studio-web screens import
  // it, and it imports nothing but a type for exactly that reason: the console
  // renders on a server, and a server has no reader whose locale it could ask.
  // num() would reach appLocale(), which there resolves to the container's,
  // which is nobody's.
  if (!roll.counted.length) {
    // numbers-ok: a count of GYMS under one owner, which cannot reach a thousand.
    return `Not one of these ${total} gyms could be added up, so there is no figure — which is not the same as a figure of nothing. ${gaps}`;
  }
  const n = roll.counted.length;
  // numbers-ok: both are counts of GYMS under one owner, and cannot reach a thousand.
  return `This is a floor, not a total: ${n} of ${total} gyms are in it, so the real figure is higher by an amount nothing here can state. ${gaps}`;
}

/**
 * Why a rolled-up money figure has no single label, or null when it has one.
 *
 * ./gymRateCurrency's `totalNote` one level up, and the two cases are its two:
 * a mixed set has no total at all, and a set nobody stated a currency for has a
 * real total whose unit is genuinely not on the record. Neither is ever
 * resolved by borrowing a neighbour's code.
 */
export function moneyNote(roll: MoneyRoll): string | null {
  if (roll.mixedCurrency) {
    const named = roll.currencies.length ? roll.currencies.join(', ') : null;
    const pots = named
      ? `${named}, and at least one gym that recorded no currency at all`
      : 'and no two of them recorded the same thing';
    return `These gyms do not count in one money — ${pots} — so there is no combined figure. Repple never adds money across currencies and never converts it.`;
  }
  if (roll.cents != null && roll.currency == null) {
    return 'This figure is real and no gym in it recorded what money it is in, so it is deliberately not labelled with what any of them charges today — that would be a guess.';
  }
  return null;
}

/* ── side by side, and into one ───────────────────────────────────────────── */

/**
 * The gyms in the order a roll-up lists them: the one this console reads
 * first, then by name, then by id.
 *
 * The same order `sitesFrom` in ./ownedSites returns, and stated as a total
 * order for the same reason — two gyms with the same name must not swap places
 * between reads, which on a page of side-by-side columns is a reader comparing
 * last week's left-hand column with this week's right-hand one.
 */
export function orderSites(sites: readonly SiteFigures[]): SiteFigures[] {
  return [...sites].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.siteId.localeCompare(b.siteId),
  );
}

/** One gym, opened on its own. */
export interface Drill {
  site: SiteFigures;
  /** What this console can actually show of this gym, in words, or null when
   *  it is the gym every other screen already reads. */
  depthNote: string | null;
  /** Why there are no figures at all, or null when there are some. */
  blocked: string | null;
}

/**
 * Open one gym.
 *
 * Three answers and they are three different sentences, which is the point:
 *
 *   · THE CURRENT GYM. Everything. Every other screen in this console is
 *     already scoped to it, so the drill-down is a link into them and this adds
 *     no caveat.
 *   · A RECORDED GYM WHOSE TOTALS CAME BACK. Its figures and nothing else. Its
 *     members, its payments and its timetable are behind policies scoped to one
 *     tenant and this console cannot open them — so the drill-down says that
 *     rather than rendering an empty roster.
 *   · A REFUSED GYM. No figures. Part 290's ordinary state, and it is a
 *     sentence about what has not been switched on, not about a failure.
 */
export function drillInto(sites: readonly SiteFigures[], siteId: string): Drill | null {
  const site = sites.find((s) => s.siteId === siteId);
  if (!site) return null;
  if (site.current) return { site, depthNote: null, blocked: null };
  if (site.refused) {
    return {
      site,
      depthNote: null,
      blocked:
        'Your account is recorded as owning this gym and this sign-in cannot read it. Nothing failed — Repple has been told who owns it and has not been told to open its records here. Its own sign-in still shows everything.',
    };
  }
  if (!isWhole(site.status)) {
    return {
      site,
      depthNote: null,
      blocked:
        site.status === 'loading'
          ? 'This gym’s figures have not come back yet.'
          : site.status === 'partial'
            ? 'This gym answered with more rows than came back, so nothing here can be totalled for it. The figures are withheld rather than shown short.'
            : 'This gym’s figures could not be read. That is a read that failed rather than an answer about the gym — nothing here says it is empty.',
    };
  }
  return {
    site,
    depthNote:
      'These are this gym’s totals. Its members, payments and timetable are not on this sign-in — every other screen in this console is showing the gym you are signed in to.',
    blocked: null,
  };
}
