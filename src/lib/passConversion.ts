// Guest passes and day passes, and what happened to the people who held them.
//
// Framework-free on purpose, like memberView.ts and gymRetention.ts: there is
// not even a Supabase client in here, nor anything it imports. Every function
// takes rows and returns a conclusion, so the same reasoning runs in the
// console, in the phone app, and in a test under plain node.
//
// This EXTENDS gymPasses.ts rather than forking it. `summarisePasses`,
// `passStatus`, `remainingUses`, `isExpired`, `passRevenueCents` and
// `guestsByHost` all still do their jobs; what was missing is the join to the
// membership roster — a gym could see that it handed out forty passes and had
// no way at all to ask whether any of those people came back and signed up.
//
// ── The four things this view would lie about if it were written naively ────
//
// 1. A SEQUENCE IS NOT A CAUSE. Somebody who used a guest pass in March and
//    joined in June may well have joined anyway; the pass may have been the
//    reason, or the gym's new squat racks, or a friend, or a New Year. Nothing
//    in these rows can tell those apart. So every name in this module says what
//    the record actually contains — `joinedAfterPass`, `joinedAfterRate`,
//    "used a pass, then joined" — and never "converted". `CAUSAL_CAVEAT` is
//    exported so the screen has to print it rather than invent its own wording.
//    The ORDER and the INTERVAL are facts. The arrow between them is not.
//
// 2. YOU CANNOT MATCH A WALK-IN TO ANYTHING. A pass sold to somebody who never
//    made an account has `holderId: null`. There is no key to look that person
//    up by in the membership table, so whether they later joined is not
//    unknown-and-probably-no — it is unanswerable. Counting those passes in the
//    denominator would show a gym that sells mostly anonymous day passes a
//    terrible conversion rate when the truth is that nobody could tell. They
//    are excluded and COUNTED OUT LOUD (`anonymousPasses`, `attributionNote`).
//    They cannot even be counted as PEOPLE: two anonymous passes may be one
//    person twice, which is why the holder-level figures never include them.
//
// 3. A RATE OVER A HANDFUL IS NOISE WITH A PERCENT SIGN. gymRetention.ts
//    already settled this and the constant is imported from there rather than
//    re-picked here, so the two screens cannot disagree about the same rule: a
//    group where one person is worth more than ten points of the rate does not
//    get one. Counts are still shown — "3 of 6 later joined" is true and useful
//    — only the percentage is withheld.
//
// 4. A PASS THAT HAS NOT RUN OUT HAS NOT FAILED. Somebody handed a ten-day pass
//    last Tuesday who has not joined is UNDECIDED. Putting them in the
//    denominator makes the gym's most recent, most active week of pass-giving
//    look like its worst. They stay out until their pass has actually expired
//    or been used up — `passStatus` from gymPasses.ts is the arbiter, so the
//    desk screen and this one call the same pass live.
//
// ── And the money ───────────────────────────────────────────────────────────
//
// Two figures, deliberately never one. What the passes brought in is cash
// already taken, once. What the memberships that followed are worth is a
// recurring monthly figure that has not been taken yet and may never be. They
// are held in separate fields, there is no `total`, and `MONEY_NOTE` says why.
// Adding them would book a hypothetical year of subscription as revenue.

import {
  remainingUses, isExpired, passStatus, passRevenueCents, summarisePasses, guestsByHost,
  type GymPass,
} from './gymPasses';
import { summarise, type Membership, type MembershipPlan, type MembershipStatus } from './gymRecord';
import type { Visit } from './gymVisits';
import { rowsOf, type Slice } from './memberView';
import { MIN_COHORT_FOR_RATE, pointsPerMember, rateOf } from './gymRetention';

const DAY = 86_400_000;

/* ── the reads, each able to fail on its own ───────────────────────────────── */

/**
 * The four reads this view is built from. Each is a `Slice`, so "not loaded",
 * "loaded and empty" and "the read failed" stay three different facts all the
 * way through — a failed membership query that rendered as an empty roster
 * would report that not one pass holder has ever joined the gym.
 */
export interface PassConversionRecord {
  passes: Slice<GymPass>;
  memberships: Slice<Membership>;
  /** Door visits. A pass redemption is a visit and carries `passId`. */
  visits: Slice<Visit>;
  /** The price book, needed to value a membership at all. */
  plans: Slice<MembershipPlan>;
}

export type ConversionPart = keyof PassConversionRecord;

export const CONVERSION_PARTS: ConversionPart[] = ['passes', 'memberships', 'visits', 'plans'];

export const CONVERSION_LABEL: Record<ConversionPart, string> = {
  passes: 'passes',
  memberships: 'the membership roster',
  visits: 'the door log',
  plans: 'the price book',
};

/** What the page loses when each read fails — named as the missing ANSWER, not
 *  the missing query, because "plans failed" means nothing to a gym owner. */
export const CONVERSION_COST: Record<ConversionPart, string> = {
  passes: 'how many passes were issued, and every figure derived from it',
  memberships: 'whether any pass holder ever joined',
  visits: 'when a pass was actually used, as opposed to merely issued',
  plans: 'what the memberships that followed are worth',
};

export interface BrokenConversionPart {
  part: ConversionPart;
  label: string;
  cost: string;
  reason: string;
}

export function brokenConversionParts(rec: PassConversionRecord): BrokenConversionPart[] {
  const out: BrokenConversionPart[] = [];
  for (const part of CONVERSION_PARTS) {
    const s = rec[part];
    if (s.state === 'failed') {
      out.push({ part, label: CONVERSION_LABEL[part], cost: CONVERSION_COST[part], reason: s.reason });
    }
  }
  return out;
}

export function pendingConversionParts(rec: PassConversionRecord): ConversionPart[] {
  return CONVERSION_PARTS.filter((p) => rec[p].state === 'loading');
}

/** The sentence above a half-loaded page, or null when nothing failed. */
export function conversionWarning(rec: PassConversionRecord): string | null {
  const broken = brokenConversionParts(rec);
  if (!broken.length) return null;
  const names = broken.map((b) => b.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Could not read ${list}. ${broken.length === 1 ? 'That is' : 'Those are'} missing from this page rather than empty — ${broken.map((b) => b.cost).join('; ')} ${broken.length === 1 ? 'is' : 'are'} unknown here.`;
}

/* ── the words the screen is required to print ─────────────────────────────── */

/**
 * The caveat that has to sit under any figure on this page.
 *
 * Exported as a constant rather than left to the screen so it cannot quietly
 * become "conversion rate" in a later edit. Trap 1 is the whole reason this
 * module is careful, and it is the one a reader will otherwise supply for
 * themselves out of habit.
 */
export const CAUSAL_CAVEAT =
  'This is a sequence, not a cause. It counts people who held a pass and later took out a membership, and how long there was between the two. Nothing in these rows says the pass is why they joined — some of them would have joined anyway. Read it as "used a pass, then joined", never as "the pass converted them".';

export const MONEY_NOTE =
  'These two figures are different kinds of money and must not be added. Pass income is cash already taken, once. The membership figure is what the memberships those holders now hold are worth per month, for as long as they last — it has not been taken and may never be. A single total would book a hypothetical year of subscription as revenue.';

/* ── one holder ────────────────────────────────────────────────────────────── */

/**
 * What the record says happened to one pass holder.
 *
 * `already-member` is not a failure and not a success — it is somebody who was
 * on the books before their first pass, so their membership cannot have
 * followed from it. They are outside the question entirely, in both directions.
 */
export type HolderOutcome = 'already-member' | 'joined-after' | 'undecided' | 'no-membership';

export interface PassHolder {
  holderId: string;
  name: string | null;
  /** How many passes this person has been given or has bought. */
  passes: number;
  /** Of those, how many have had at least one visit taken off them. */
  redeemed: number;
  firstPassOn: string;
  lastPassOn: string;
  /** The earliest door visit recorded against any of their passes, when the
   *  door log carries one. Null means no redemption VISIT was recorded — which
   *  is not the same as an unused pass, since a desk can decrement a pass
   *  without the door terminal seeing anybody. */
  firstUsedOn: string | null;
  /** Members who issued them a guest pass. Usually none or one. */
  hostMemberIds: string[];
  /** True while any of their passes is still redeemable — the reason a holder
   *  with no membership may be undecided rather than a miss. */
  hasLivePass: boolean;
  outcome: HolderOutcome;
  /** The membership start that followed their first pass. Null unless joined. */
  joinedOn: string | null;
  /** Where that membership stands now — a holder who joined and cancelled in
   *  the same month is a different story from one who is still training. */
  statusNow: MembershipStatus | null;
  /** Whole days from their FIRST pass to that membership starting. Null unless
   *  joined. Measured from the issue date because every pass has one; the date
   *  it was first used is on `firstUsedOn` and is often missing. */
  daysToJoin: number | null;
  /** What they paid for their passes, or null when no price was recorded. */
  paidCents: number | null;
}

/* ── the whole picture ─────────────────────────────────────────────────────── */

export interface HolderCounts {
  /** Holders with an account, so answerable at all. */
  identified: number;
  alreadyMember: number;
  joinedAfter: number;
  undecided: number;
  noMembership: number;
  /** joinedAfter + noMembership — the only holders whose story has ended. */
  decided: number;
}

export interface JoinInterval {
  n: number;
  medianDays: number;
  minDays: number;
  maxDays: number;
  /** Days-to-join, sorted, so a screen can draw the spread rather than a mean. */
  days: number[];
}

export interface HostGuests {
  hostMemberId: string;
  hostName: string | null;
  /** Every guest pass they issued, anonymous ones included. */
  guests: number;
  /** Guest passes issued to somebody with an account. */
  identified: number;
  /** Guest passes to a walk-in — unanswerable, not unsuccessful. */
  anonymous: number;
  /** Distinct identified guests who later took out a membership. */
  joined: number;
  /** Identified guests whose pass has not run out yet. */
  undecided: number;
  /** Identified guests who were already members when the pass was issued. */
  alreadyMembers: number;
}

export interface PassMoney {
  /** What the gym took for the passes, in minor units. Null when not one pass
   *  carried a recorded price — a pass with no price is not a free pass. */
  passCents: number | null;
  passesPriced: number;
  passesTotal: number;
  /** Recurring monthly value of the memberships held by holders who joined
   *  after a pass and are still active. Null when none is on a priced plan.
   *  Deliberately never added to `passCents`. See MONEY_NOTE. */
  followingMrrCents: number | null;
  /** How many of those memberships are active right now. */
  followingActive: number;
  /**
   * The currency the priced passes were sold in, or null when NONE of them
   * states one.
   *
   * It used to be `currencies[0] ?? 'AED'`, so a gym whose passes carry no
   * currency was told its pass revenue in dirhams — a figure with a currency
   * bolted onto it at the last moment, indistinguishable on screen from one the
   * gym actually sold in. Null instead: the amount is known and the money it is
   * in is not, and `money()` withholds the figure rather than denominating it
   * for us.
   */
  currency: string | null;
  /** True when the passes were sold in more than one currency, in which case
   *  `passCents` adds unlike things and the screen must say so. */
  mixedCurrency: boolean;
}

export interface PassConversion {
  today: string;
  /** Pass-level counts, straight from gymPasses. Null when passes not read. */
  passes: ReturnType<typeof summarisePasses> | null;
  /** How many passes have had at least one visit taken off them. */
  redeemedPasses: number | null;
  /** Redemptions the DOOR LOG saw, which is a smaller and different number:
   *  a desk can spend a pass without the terminal recording anybody. */
  redemptionVisits: number | null;
  /** Passes issued to somebody with no account. Excluded from every rate. */
  anonymousPasses: number | null;

  holders: PassHolder[] | null;
  counts: HolderCounts | null;

  /**
   * joinedAfter / decided, or null. NOT a conversion rate — see CAUSAL_CAVEAT.
   * Null over nothing, and null under the floor: never 0 to stand in for
   * "nobody has decided yet".
   */
  joinedAfterRate: number | null;
  /** Why there is no percentage, when there is not. */
  suppressed: 'no-denominator' | 'too-few' | null;

  interval: JoinInterval | null;
  hosts: HostGuests[] | null;
  money: PassMoney | null;

  /** Sentences the screen prints verbatim. Each is null when it has nothing to
   *  say, so a page never renders an empty caveat box. */
  attributionNote: string | null;
  undecidedNote: string | null;
  floorNote: string;
  headline: string | null;

  warning: string | null;
  loading: ConversionPart[];
}

export interface ConversionOptions {
  /** Plain ISO date, the gym's own. Defaults to today in UTC. */
  today?: string;
  /** Smallest decided group allowed a percentage. Defaults to the retention
   *  floor, deliberately shared so the two screens cannot disagree. */
  minGroup?: number;
}

export function buildPassConversion(
  rec: PassConversionRecord,
  opts: ConversionOptions = {},
): PassConversion {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const minGroup = opts.minGroup ?? MIN_COHORT_FOR_RATE;

  const passRows = rowsOf(rec.passes);
  const memberRows = rowsOf(rec.memberships);
  const visitRows = rowsOf(rec.visits);
  const planRows = rowsOf(rec.plans);

  const floorNote = floorSentence(minGroup);
  const warning = conversionWarning(rec);
  const loading = pendingConversionParts(rec);

  // With no passes there is no page. Every figure is null rather than zero: a
  // gym whose pass query failed has not issued nothing.
  if (passRows == null) {
    return {
      today,
      passes: null, redeemedPasses: null, redemptionVisits: null, anonymousPasses: null,
      holders: null, counts: null, joinedAfterRate: null, suppressed: null,
      interval: null, hosts: null, money: null,
      attributionNote: null, undecidedNote: null, floorNote,
      headline: null, warning, loading,
    };
  }

  const passes = summarisePasses(passRows, today);
  const redeemedPasses = passRows.filter((p) => p.usesSpent > 0).length;
  const anonymousPasses = passRows.filter((p) => !p.holderId).length;

  // Door-seen redemptions, and only when the door log actually arrived. Zero
  // here with an unread log would read as "no pass was ever used".
  const passIds = new Set(passRows.map((p) => p.id));
  const redemptionVisits = visitRows == null
    ? null
    : visitRows.filter((v) => v.passId && passIds.has(v.passId)).length;

  const holders = memberRows == null
    ? null
    : buildHolders(passRows, memberRows, visitRows, today);

  const counts = holders == null ? null : countHolders(holders);
  const interval = holders == null ? null : intervalOf(holders);

  const decided = counts?.decided ?? 0;
  const joinedAfterRate = counts == null ? null : rateOf(counts.joinedAfter, decided, minGroup);
  const suppressed: PassConversion['suppressed'] =
    counts == null || joinedAfterRate != null ? null
      : decided === 0 ? 'no-denominator'
      : 'too-few';

  const hosts = holders == null ? null : hostsOf(passRows, holders, memberRows ?? []);
  const money = moneyOf(passRows, holders, memberRows, planRows);

  return {
    today,
    passes, redeemedPasses, redemptionVisits, anonymousPasses,
    holders, counts, joinedAfterRate, suppressed,
    interval, hosts, money,
    attributionNote: attributionSentence(passRows.length, anonymousPasses, counts),
    undecidedNote: undecidedSentence(counts),
    floorNote,
    headline: headlineOf({ passes, redeemedPasses, counts, joinedAfterRate, interval, memberRead: memberRows != null }),
    warning,
    loading,
  };
}

/* ── holders ───────────────────────────────────────────────────────────────── */

/**
 * One row per identified holder, never per pass.
 *
 * The unit matters. Somebody handed four guest passes over a year who then
 * joined is ONE person who joined, and counting the join four times — once per
 * pass — is how a gym with a few enthusiastic regulars talks itself into a
 * conversion rate it does not have.
 *
 * Anonymous passes produce no row at all. They cannot be grouped: two passes
 * written "walk-in" may be one person twice or two people once, and there is
 * nothing in the record that decides which.
 */
export function buildHolders(
  passes: GymPass[],
  memberships: Membership[],
  visits: Visit[] | null,
  today: string,
): PassHolder[] {
  const byHolder = new Map<string, GymPass[]>();
  for (const p of passes) {
    if (!p.holderId) continue;
    const list = byHolder.get(p.holderId);
    if (list) list.push(p);
    else byHolder.set(p.holderId, [p]);
  }

  // First door visit per pass id, when the door log is here at all.
  const firstUse = new Map<string, string>();
  for (const v of visits ?? []) {
    if (!v.passId) continue;
    const at = String(v.enteredAt).slice(0, 10);
    const seen = firstUse.get(v.passId);
    if (!seen || at < seen) firstUse.set(v.passId, at);
  }

  const memberOf = new Map<string, Membership[]>();
  for (const m of memberships) {
    if (!m.memberId) continue;
    const list = memberOf.get(m.memberId);
    if (list) list.push(m);
    else memberOf.set(m.memberId, [m]);
  }

  const out: PassHolder[] = [];
  for (const [holderId, theirs] of byHolder) {
    const dates = theirs.map((p) => dateOf(p.issuedOn)).filter((d): d is string => d != null).sort();
    // A pass with an unreadable issue date cannot be placed in time at all, so
    // this holder gets no interval and no before/after judgement.
    const firstPassOn = dates[0] ?? '';
    const lastPassOn = dates[dates.length - 1] ?? '';

    const mine = memberOf.get(holderId) ?? [];
    const covering = firstPassOn ? mine.find((m) => coversDate(m, firstPassOn)) : undefined;
    const after = firstPassOn ? earliestFrom(mine, firstPassOn) : null;

    const hasLivePass = theirs.some((p) => passStatus(p, today) === 'live');

    const outcome: HolderOutcome =
      after ? 'joined-after'
        : covering ? 'already-member'
        : !firstPassOn ? 'undecided'
        : hasLivePass ? 'undecided'
        : 'no-membership';

    const joinedOn = outcome === 'joined-after' ? dateOf(after!.startedOn) : null;

    let firstUsedOn: string | null = null;
    for (const p of theirs) {
      const at = firstUse.get(p.id);
      if (at && (firstUsedOn == null || at < firstUsedOn)) firstUsedOn = at;
    }

    const { cents } = passRevenueCents(theirs);

    out.push({
      holderId,
      name: nameOf(theirs, mine),
      passes: theirs.length,
      redeemed: theirs.filter((p) => p.usesSpent > 0).length,
      firstPassOn,
      lastPassOn,
      firstUsedOn,
      hostMemberIds: [...new Set(theirs.map((p) => p.hostMemberId).filter((h): h is string => !!h))],
      hasLivePass,
      outcome,
      joinedOn,
      statusNow: outcome === 'joined-after' ? after!.status : covering?.status ?? null,
      daysToJoin: joinedOn && firstPassOn ? daysBetween(firstPassOn, joinedOn) : null,
      paidCents: cents,
    });
  }

  // Joiners first, quickest first, so the rows a gym would act on lead.
  const rank: Record<HolderOutcome, number> = {
    'joined-after': 0, 'undecided': 1, 'no-membership': 2, 'already-member': 3,
  };
  return out.sort(
    (a, b) => rank[a.outcome] - rank[b.outcome]
      || (a.daysToJoin ?? Infinity) - (b.daysToJoin ?? Infinity)
      || b.lastPassOn.localeCompare(a.lastPassOn)
      || a.holderId.localeCompare(b.holderId),
  );
}

export function countHolders(holders: PassHolder[]): HolderCounts {
  let alreadyMember = 0, joinedAfter = 0, undecided = 0, noMembership = 0;
  for (const h of holders) {
    if (h.outcome === 'already-member') alreadyMember++;
    else if (h.outcome === 'joined-after') joinedAfter++;
    else if (h.outcome === 'undecided') undecided++;
    else noMembership++;
  }
  return {
    identified: holders.length,
    alreadyMember, joinedAfter, undecided, noMembership,
    // Only these two have finished happening. An undecided holder is not a
    // miss and an already-member holder was never in the question.
    decided: joinedAfter + noMembership,
  };
}

/**
 * How long there was between a first pass and a membership starting.
 *
 * The median rather than the mean: one person who took a guest pass in 2024 and
 * joined two years later would drag an average into meaninglessness, and the
 * question a gym is asking — "how long does this usually take?" — is a median
 * question. The whole sorted list is returned too, so a screen can show the
 * spread instead of a single number pretending to be the answer.
 */
export function intervalOf(holders: PassHolder[]): JoinInterval | null {
  const days = holders
    .filter((h) => h.outcome === 'joined-after' && h.daysToJoin != null)
    .map((h) => h.daysToJoin!)
    .sort((a, b) => a - b);
  if (!days.length) return null;
  const mid = Math.floor(days.length / 2);
  const medianDays = days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
  return { n: days.length, medianDays, minDays: days[0], maxDays: days[days.length - 1], days };
}

/* ── which members bring people who join ───────────────────────────────────── */

/**
 * Guest passes per host, enriched with what happened to the guests.
 *
 * Built on `guestsByHost` from gymPasses rather than beside it, so the host
 * list and its ordering stay one definition. A host's guests are almost never
 * numerous enough to carry a percentage, which is the point: this table shows
 * COUNTS, and a gym reading "Sara: 4 guests, 2 later joined" has everything it
 * needs to thank her without a rate that would be mostly noise.
 */
export function hostsOf(
  passes: GymPass[],
  holders: PassHolder[],
  memberships: Membership[],
): HostGuests[] {
  const outcomeOf = new Map(holders.map((h) => [h.holderId, h.outcome]));
  const nameOfMember = new Map<string, string>();
  for (const m of memberships) {
    if (m.memberId && m.memberName?.trim()) nameOfMember.set(m.memberId, m.memberName.trim());
  }
  // A host's name comes from the roster only. `holderName` on a guest pass is
  // the GUEST's name; using it here would label every host with their visitor.

  return guestsByHost(passes).map(({ hostMemberId, guests }) => {
    const theirs = passes.filter((p) => p.kind === 'guest' && p.hostMemberId === hostMemberId);
    const anonymous = theirs.filter((p) => !p.holderId).length;
    // Distinct guests, not distinct passes: a host who brought the same friend
    // three times brought one person.
    const ids = [...new Set(theirs.map((p) => p.holderId).filter((h): h is string => !!h))];
    let joined = 0, undecided = 0, alreadyMembers = 0;
    for (const id of ids) {
      const o = outcomeOf.get(id);
      if (o === 'joined-after') joined++;
      else if (o === 'undecided') undecided++;
      else if (o === 'already-member') alreadyMembers++;
    }
    return {
      hostMemberId,
      hostName: nameOfMember.get(hostMemberId) ?? null,
      guests,
      identified: ids.length,
      anonymous,
      joined,
      undecided,
      alreadyMembers,
    };
  }).sort((a, b) => b.joined - a.joined || b.guests - a.guests || a.hostMemberId.localeCompare(b.hostMemberId));
}

/* ── money, in two figures that are never one ──────────────────────────────── */

export function moneyOf(
  passes: GymPass[],
  holders: PassHolder[] | null,
  memberships: Membership[] | null,
  plans: MembershipPlan[] | null,
): PassMoney {
  const { cents, priced, total } = passRevenueCents(passes);
  const currencies = [...new Set(passes.map((p) => p.currency).filter(Boolean))];

  // The memberships held by people who joined AFTER a pass, and only those.
  // `summarise` from gymRecord does the interval arithmetic — a yearly plan is
  // a twelfth of a month here exactly as it is on /money, so the two screens
  // cannot quote different recurring values for the same gym.
  let followingMrrCents: number | null = null;
  let followingActive = 0;
  if (holders && memberships && plans) {
    const joiners = new Set(holders.filter((h) => h.outcome === 'joined-after').map((h) => h.holderId));
    const followed = memberships.filter((m) => joiners.has(m.memberId));
    const s = summarise([], followed, plans);
    followingMrrCents = s.mrrCents;
    followingActive = s.activeMembers;
  }

  return {
    passCents: cents,
    passesPriced: priced,
    passesTotal: total,
    followingMrrCents,
    followingActive,
    currency: currencies[0] ?? null,
    mixedCurrency: currencies.length > 1,
  };
}

/* ── sentences ─────────────────────────────────────────────────────────────── */

function floorSentence(minGroup: number): string {
  const p = pointsPerMember(minGroup);
  return `A percentage is shown only once ${minGroup} pass holders have decided. At ${minGroup}, one person is worth ${fmt(p ?? 0)} points of it; below that a single person moving swings the figure further than anything a gym would act on, so it would be measuring the group's size rather than the gym. Under the floor the counts are still shown — they are true. This is the same floor /retention uses, from the same constant.`;
}

/** Names the passes that could never have been answered for. Null when every
 *  pass carried an account, in which case there is nothing to warn about. */
export function attributionSentence(
  issued: number,
  anonymous: number,
  counts: HolderCounts | null,
): string | null {
  if (anonymous <= 0) return null;
  const share = issued > 0 ? Math.round((anonymous / issued) * 100) : 0;
  let s = `${anonymous} of ${issued} passes (${share}%) went to somebody with no account. There is no key to look those people up by in the roster, so whether they joined later is UNANSWERABLE — not "no". They are excluded from the figures below rather than counted as failures, and they cannot be counted as people either: two anonymous passes may be one person twice.`;
  if (share >= 50) {
    s += ' Over half the passes are in this position, so the figures below describe a minority of what the gym actually handed out. Taking a name and an email at the desk is what would change that.';
  }
  if (counts && counts.identified === 0) {
    s += ' Not one pass carries an account, so there is no conversion question this record can answer at all.';
  }
  return s;
}

/** Names the holders whose story has not finished. Null when none. */
export function undecidedSentence(counts: HolderCounts | null): string | null {
  if (!counts || counts.undecided <= 0) return null;
  return `${counts.undecided} holder${counts.undecided === 1 ? '' : 's'} still ${counts.undecided === 1 ? 'has' : 'have'} a live pass and ${counts.undecided === 1 ? 'has' : 'have'} not joined. ${counts.undecided === 1 ? 'That is' : 'Those are'} undecided, not lost, and ${counts.undecided === 1 ? 'is' : 'are'} outside the figure — a pass handed out last week has not failed. Note the asymmetry this creates while any pass is live: a holder who has already joined is counted even though their pass is still running, so the figure will move as the live passes run out.`;
}

function headlineOf(x: {
  passes: ReturnType<typeof summarisePasses>;
  redeemedPasses: number;
  counts: HolderCounts | null;
  joinedAfterRate: number | null;
  interval: JoinInterval | null;
  memberRead: boolean;
}): string | null {
  if (x.passes.issued === 0) return null;
  const head = `${x.passes.issued} pass${x.passes.issued === 1 ? '' : 'es'} issued, ${x.redeemedPasses} used at least once.`;
  if (!x.memberRead || !x.counts) {
    return `${head} The membership roster could not be read, so whether any holder later joined is unknown here — not none.`;
  }
  const c = x.counts;
  if (c.identified === 0) {
    return `${head} None of them carries an account, so no holder can be matched to a membership.`;
  }
  if (c.decided === 0) {
    return `${head} ${c.identified} went to somebody with an account, and not one of those has decided yet — every pass is either still live or its holder was already a member. There is nothing to report a rate over.`;
  }
  const rate = x.joinedAfterRate == null ? '' : ` (${Math.round(x.joinedAfterRate * 100)}%)`;
  let out = `${head} ${c.joinedAfter} of ${c.decided} holders whose pass has run out later took out a membership${rate}.`;
  if (x.interval) {
    out += ` Typically ${x.interval.medianDays} day${x.interval.medianDays === 1 ? '' : 's'} after their first pass, across ${x.interval.n} of them, ranging ${x.interval.minDays} to ${x.interval.maxDays}.`;
  }
  out += ' They joined after a pass; nothing here says the pass is why.';
  return out;
}

/** Why no percentage is shown, in a sentence. Null when one is. */
export function suppressionSentence(
  c: PassConversion,
  minGroup: number = MIN_COHORT_FOR_RATE,
): string | null {
  if (c.suppressed === 'no-denominator') {
    return 'No pass holder has decided yet — every identified holder either still has a live pass or was already a member. A rate over nobody is not 0%, it is nothing.';
  }
  if (c.suppressed === 'too-few') {
    const n = c.counts?.decided ?? 0;
    const p = pointsPerMember(n);
    return `${n} holder${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} decided — one of them is worth ${fmt(p ?? 0)} points, so no percentage is shown. The floor is ${minGroup}. The counts beside it are still true.`;
  }
  return null;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

/** A plain ISO date from whatever the column holds, or null. Taken from the
 *  STRING when it already is one — parsing '2026-08-01' and reading the local
 *  date back off it moves the pass a day west of Greenwich. */
export function dateOf(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from one plain ISO date to another, in UTC. Never negative. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
}

/**
 * Whether this membership was already running when the pass was issued.
 *
 * STRICTLY before, so a walk-in who takes a day pass and signs up the same
 * afternoon reads as joined-that-day rather than as somebody who was already a
 * member. That is the most pass-shaped join a gym ever gets and losing it would
 * be perverse.
 *
 * A membership with no end date is treated as still covering the pass. That is
 * the conservative direction: it puts the holder OUTSIDE the question rather
 * than claiming a join the record cannot stand behind. It does mean a member
 * who cancelled without anybody recording an end date, and who later came back
 * through a guest pass, is not counted as a win-back.
 */
export function coversDate(m: Membership, when: string): boolean {
  const start = dateOf(m.startedOn);
  if (!start || !(start < when)) return false;
  const end = dateOf(m.endsOn);
  return end == null || end >= when;
}

/** The earliest membership starting on or after `when`. */
function earliestFrom(ms: Membership[], when: string): Membership | null {
  let best: Membership | null = null;
  let bestDate: string | null = null;
  for (const m of ms) {
    const s = dateOf(m.startedOn);
    if (!s || s < when) continue;
    if (bestDate == null || s < bestDate) { bestDate = s; best = m; }
  }
  return best;
}

function nameOf(passes: GymPass[], ms: Membership[]): string | null {
  for (const m of ms) if (m.memberName?.trim()) return m.memberName.trim();
  for (const p of passes) if (p.holderName?.trim()) return p.holderName.trim();
  return null;
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/* ── re-exported so a screen needs one import for the whole subject ────────── */

export { remainingUses, isExpired, passStatus, summarisePasses, MIN_COHORT_FOR_RATE };
