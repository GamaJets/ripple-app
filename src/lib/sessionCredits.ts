// What paid for a session — and what is going to pay for the next one.
//
// The reading half of supabase/parts/370. That file decides which entitlement a
// delivered session comes off; this one lets the three apps SAY so, in the same
// order and with the same rule, so a client, a coach and a gym owner cannot be
// shown three different answers about the same hour.
//
// Pure arithmetic and pure wording — no supabase, no react-native — so it runs
// under `npm test`.
//
// ── The two systems, and why the order is decided here ────────────────────
//
// A client may hold both a pack their COACH sold them (`client_purchases`) and
// a pass their GYM sold them (`gym_passes`). Part 370 picks by specificity: the
// entitlement that names both parties to the session wins, so a coach pack
// beats a gym pass, and an EXHAUSTED coach pack still beats a live gym pass
// rather than falling through onto the gym's money.
//
// `chooseRoute` below is that same rule, and it exists as a function rather
// than as an `if` inside a screen because the point of use is exactly where it
// went wrong before: three screens, three guesses, and no way for anybody to
// see which credit had actually been spent.
//
// A gym pass is not a second currency the app may spend anywhere, either. Route
// 2 matches `p.tenant_id = new.tenant_id` — the pass's gym must equal the
// SESSION's gym, which is the TRAINER's — so a pass pays for an hour with a
// coach of the gym that sold it and for no other hour. `gymPtLines` is where
// that predicate lives; a pass it sets aside is still a real pass, and
// `passesElsewhere` and `passesElsewhereLine` are how the member is told so.
//
// ── The rule this module will not break ───────────────────────────────────
//
// A balance that was not read is UNKNOWN, and unknown is never 0. `packLeft` in
// coachMoney.ts and `packBalance` in packDraw.ts both already refuse to
// manufacture a zero, and every count here propagates `null` the same way: one
// unreadable input makes the total null, because a client holding ten credits
// must never be shown "0 left", and an empty ledger under a failed read must
// never read as "you have never used a session".

import { PAST_STATE_NOTE } from './sessionHistory';

/** Which of the two entitlement systems a credit came off. Mirrors
 *  `sessions.pack_drawn_kind`. */
export type CreditKind = 'coach_pack' | 'gym_pass';

/**
 * Which system is paying for this client's sessions with this coach.
 *
 * 'none' is an ordinary answer, not a failure: a client paying cash, or on a
 * membership that includes PT, holds nothing and owes nothing.
 * 'unknown' is the answer when a read failed, and is the one state that must
 * never be rendered as a number.
 */
export type CreditRoute = 'coach_pack' | 'gym_pass' | 'none' | 'unknown';

/** One thing a client is holding that can pay for a one-to-one. */
export interface Entitlement {
  id: string;
  kind: CreditKind;
  /** What it is called on screen. Never a name invented for it — see
   *  `packLabel` in packDraw.ts for the coach-pack half of the same rule. */
  label: string;
  left: number;
  /**
   * How many sessions the thing is worth: `client_purchases.sessions_total` for
   * a coach pack, `gym_passes.uses_total` for a gym pass.
   *
   * Named for the column rather than `total` for the reason `PackLine` gives in
   * packDraw.ts: `check:numbers` recognises this name as a figure that cannot
   * pass a thousand — a pack is 5, 10 or 20 — so it is printed without a
   * thousands separator on purpose rather than by omission.
   */
  sessions_total: number;
  /**
   * ISO date this expires on, or null for one that does not.
   *
   * Both kinds can carry one. A gym pass always could; part 612 put an
   * `expires_on` on a coach pack too, and the sentence that used to sit here —
   * "a coach pack has no expiry in this schema" — has been false since.
   */
  expiresOn: string | null;
  /**
   * The window on this entitlement has already closed.
   *
   * Optional because only one of the two kinds is ever handed to a screen in
   * this state. `gymPtLines` drops a lapsed pass and is right to: the pass draw
   * in part 370 filters on `p.expires_on is null or p.expires_on >= v_on`, so a
   * lapsed pass genuinely cannot be spent on anything. A coach pack is the
   * opposite case — see `coachPackLines` — and this flag is how a screen says
   * why the figure beside it is nought.
   */
  expired?: boolean;
}

/** A session as the credit ledger reads it — the columns parts 193 and 370 put
 *  on `sessions`, and nothing else. */
export interface CreditSession {
  id: string;
  startsAt: string;
  /** Slot state: 'available' | 'booked' | 'blocked'. */
  status: string;
  /** Delivery result. Null means nobody has said yet. */
  outcome: string | null;
  /** Non-null for an occurrence of a standing appointment. */
  seriesId: string | null;
  packDrawnAt: string | null;
  packDrawnKind: CreditKind | null;
  packDrawnPurchaseId: string | null;
  packDrawnPassId: string | null;
  /** Completed, an entitlement should have paid, and none could. */
  shortfallAt: string | null;
  /** The client booked this themselves, so the coach-pack draw for it happened
   *  at booking. See supabase/parts/370. */
  bookingDrewCreditAt: string | null;
}

/* ── which entitlement pays ────────────────────────────────────────────────── */

/**
 * The choice, exactly as the database makes it.
 *
 * Both arguments are three-state on purpose. `true` they hold one, `false` they
 * hold none, `null` we could not read. Anything unread that the answer depends
 * on makes the answer 'unknown' — never 'none', which is a sentence about
 * somebody's money.
 *
 * `holdsCoachPack` is "do they hold a pack from this coach AT ALL", including
 * one with nothing left on it. That is deliberate and it is the load-bearing
 * half: an empty coach pack is still the answer to "who is paying for this
 * hour", and falling through to the gym's pass would move money between two
 * businesses to hide a conversation the coach needs to have.
 *
 * `holdsGymPtPass` is narrower than it reads: it is "do they hold a pass THIS
 * SESSION'S GYM sold them that covers PT and is live on the day". Route 2 of
 * part 370 matches on `p.tenant_id = new.tenant_id`, and a pass from another
 * gym — or any pass at all, when the coach is independent — cannot be drawn on
 * however many credits are on it. That whole predicate is `gymPtLines`'s, and
 * this function is deliberately not given the session's gym as well: one
 * predicate, one place. See `bookableCredits`.
 */
export function chooseRoute(
  holdsCoachPack: boolean | null | undefined,
  holdsGymPtPass: boolean | null | undefined,
): CreditRoute {
  if (holdsCoachPack == null) return 'unknown';
  if (holdsCoachPack) return 'coach_pack';
  if (holdsGymPtPass == null) return 'unknown';
  return holdsGymPtPass ? 'gym_pass' : 'none';
}

/** Why that route, in one clause a screen can drop into a caption. Null for
 *  'none', which needs no explaining to somebody who holds nothing. */
export function routeReason(route: CreditRoute): string | null {
  switch (route) {
    case 'coach_pack':
      return 'Sessions with this coach come off the pack you bought from them.';
    case 'gym_pass':
      return 'Sessions come off the PT pass your gym sold you.';
    case 'unknown':
      return 'We could not read what pays for these sessions.';
    default:
      return null;
  }
}

/* ── what is left ──────────────────────────────────────────────────────────── */

/**
 * How many sessions are left on the entitlements that actually pay.
 *
 * `lines` is null for a read that failed, which comes back as null — not 0, and
 * not an empty list. An empty ARRAY is a real answer: they hold nothing.
 */
export function creditsLeft(lines: readonly Entitlement[] | null | undefined): number | null {
  if (lines == null) return null;
  let n = 0;
  for (const l of lines) n += Math.max(0, l.left);
  return n;
}

/**
 * The lines that pay, given the route. A client holding both is shown only the
 * one that will actually be spent, because a screen listing both invites
 * somebody to add them up and plan a week they have not paid for.
 */
export function payingLines(
  route: CreditRoute,
  coach: readonly Entitlement[] | null | undefined,
  gym: readonly Entitlement[] | null | undefined,
): Entitlement[] | null {
  if (route === 'coach_pack') return coach == null ? null : coach.slice();
  if (route === 'gym_pass') return gym == null ? null : gym.slice();
  if (route === 'none') return [];
  return null;
}

/**
 * A gym pass is live on a given day, which is not the same as live today.
 *
 * The day matters because a session delivered on Tuesday is paid for by a pass
 * that was valid on Tuesday, and an outcome marked a week late must not turn a
 * covered session into an uncovered one — the same rule part 370 applies in
 * SQL. `onISODate` is a plain YYYY-MM-DD, compared as a string because ISO
 * dates sort correctly as text and parsing them into Date objects is how a
 * timezone gets into a question that has none.
 */
export function passLiveOn(expiresOn: string | null, onISODate: string): boolean {
  if (!expiresOn) return true;
  return expiresOn >= onISODate;
}

/**
 * The gym passes that can pay for a one-to-one, in the order part 370 spends
 * them: soonest to expire first, then oldest.
 *
 * The ordering is the opposite of the coach-pack rule — that one is oldest
 * first, matching the `order by created_at asc` in `redeem_pack_session` — and
 * the difference is not an inconsistency: a pass has always had a window, so
 * spending the one about to be lost is the only order that does not throw a
 * member's money away.
 *
 * That contrast used to be stated as "a coach pack cannot expire", which part
 * 612 made false: a coach pack can carry an `expires_on` too. What is still
 * true is the ordering, and it is still right, because the database spends
 * coach packs oldest-first whatever this list says and a picker that disagreed
 * with the draw would name a pack the credit did not come off.
 * `coachPackLines` now carries each pack's own date so a screen can SAY what is
 * about to be lost even where it cannot change what is spent first.
 *
 * ── a pass from ANOTHER gym is not a route, and was counted as one ────────
 *
 * Route 2 in part 370 is not "does this member hold a PT pass". It is:
 *
 *     where p.holder_id = new.client_id
 *       and p.tenant_id = new.tenant_id
 *       and ty.covers = 'pt'
 *       and p.uses_spent < p.uses_total
 *       and (p.expires_on is null or p.expires_on >= v_on)
 *
 * — and the same `p.tenant_id = new.tenant_id` again in the shortfall test a
 * few lines below it. Three of those five conjuncts were already applied here.
 * The tenant one was not, and it is the one that decides whether the credit
 * this list promises is the credit the server will take.
 *
 * `sessions.tenant_id` is the TRAINER's `profiles.tenant_id` (filled by
 * `sessions_fill_tenant()`), and every account gets its own personal tenant at
 * signup. So an hour with an INDEPENDENT coach carries that coach's personal
 * tenant, no gym pass can equal it, and a member who was shown "6 PT credits"
 * off their gym's pass had none of them drawn — the server fell through, and
 * stamped `pack_draw_shortfall_at` on the coach's delivered hour instead. A
 * coach on the staff of a DIFFERENT gym from the one that sold the pass is the
 * same failure with a different tenant in it.
 *
 * This is the expired-coach-pack argument (part 370, and the fix above it) run
 * the other way. There, a pack the server WOULD pick had been filtered out of
 * the app's list, so the app named the wrong route. Here, a pass the server
 * would NOT pick was left in, so the app named the wrong route again. Both are
 * the same rule: this list means "what part 370 will actually draw against",
 * and nothing else may be in it.
 *
 * ── carried, and said out loud ────────────────────────────────────────────
 *
 * A pass from another gym is dropped from THIS list — it cannot pay for this
 * session, so counting it would put a number under "Sessions Remaining" that
 * nothing will honour, and `chooseRoute` would route onto it. But it is a
 * perfectly good pass with real credits on it, and telling its holder they hold
 * nothing (or that it shows 0) would be its own wrong answer about somebody's
 * money. So `passesElsewhere` below returns exactly those, `bookableCredits`
 * carries them, and `creditsEmptyLine` says what they are.
 *
 * ── the three-state discriminator ─────────────────────────────────────────
 *
 * `sessionTenantId` may be given as an argument or carried on the rows by
 * `myPtPasses`; the argument wins when both are present. Three states, and they
 * are three different sentences:
 *
 *   a tenant  compare it, exactly as route 2 does
 *   `null`    the session belongs to no gym — route 2's own first line is
 *             `if new.tenant_id is null then return new`, so NOTHING pays
 *   absent    nobody said. The rows are not judged, and this is correct for
 *             exactly one live caller: `app/(trainer)/client.tsx`, whose read
 *             is narrowed by `gym_passes_staff_r` (`tenant_id = my_tenant()`)
 *             to the coach's own gym before it ever gets here.
 *
 * A row whose own `tenantId` is missing while a session tenant IS known cannot
 * be compared, so it is treated as one that does not pay here rather than one
 * that does — the safe direction, and not a silent one, because it still comes
 * back from `passesElsewhere` and still gets a sentence.
 */
export function gymPtLines(
  passes: readonly PtPassLike[] | null | undefined,
  onISODate: string,
  sessionTenantId?: string | null,
): Entitlement[] | null {
  const split = splitPtPasses(passes, onISODate, sessionTenantId);
  return split == null ? null : split.here;
}

/**
 * The member's live PT passes that this session's gym will NOT draw on.
 *
 * Same input, same filters, the opposite side of the tenant test — so a pass is
 * in exactly one of the two lists and never in neither. Non-PT passes and
 * lapsed ones are in neither, on purpose: those cannot be spent anywhere, and
 * "your class pack is from another gym" would be a sentence about the wrong
 * thing.
 *
 * `[]` when the discriminator was never supplied, because nothing was judged.
 */
export function passesElsewhere(
  passes: readonly PtPassLike[] | null | undefined,
  onISODate: string,
  sessionTenantId?: string | null,
): Entitlement[] | null {
  const split = splitPtPasses(passes, onISODate, sessionTenantId);
  return split == null ? null : split.elsewhere;
}

/** A gym pass row as this module needs to read it. `tenantId` and
 *  `sessionTenantId` are optional so a caller whose read is already narrowed to
 *  one gym — see `gymPtLines` — is not made to invent them. */
export interface PtPassLike {
  id: string;
  passTypeId: string | null;
  passTypeName: string | null;
  covers?: string | null;
  expiresOn: string | null;
  usesTotal: number;
  usesSpent: number;
  /** The gym that sold it. `gym_passes.tenant_id`. */
  tenantId?: string | null;
  /** The gym the session being priced belongs to. A property of the READ, not
   *  of the pass — see `myPtPasses` in connect.ts. */
  sessionTenantId?: string | null;
}

const byPassOrder = (a: Entitlement, b: Entitlement): number => {
  if (a.expiresOn && b.expiresOn && a.expiresOn !== b.expiresOn) return a.expiresOn < b.expiresOn ? -1 : 1;
  if (a.expiresOn && !b.expiresOn) return -1;
  if (!a.expiresOn && b.expiresOn) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function splitPtPasses(
  passes: readonly PtPassLike[] | null | undefined,
  onISODate: string,
  sessionTenantId?: string | null,
): { here: Entitlement[]; elsewhere: Entitlement[] } | null {
  if (passes == null) return null;
  const here: Entitlement[] = [];
  const elsewhere: Entitlement[] = [];
  for (const p of passes) {
    if (p.covers !== 'pt') continue;
    const total = Number.isFinite(p.usesTotal) ? p.usesTotal : 0;
    const spent = Number.isFinite(p.usesSpent) ? p.usesSpent : 0;
    if (!passLiveOn(p.expiresOn, onISODate)) continue;
    const line: Entitlement = {
      id: p.id,
      kind: 'gym_pass',
      // The type's own name, or a description of the pass. Never a name this
      // code made up for a thing the gym named something else — the same rule
      // `packLabel` keeps for coach packs.
      label: (p.passTypeName || '').trim() || `${total}-session PT pass`,
      left: Math.max(0, Math.min(total, total - spent)),
      sessions_total: total,
      expiresOn: p.expiresOn,
    };
    // The argument wins over the rows: a caller who names the session's gym is
    // answering for the session in front of them, and a row carries whatever
    // was true when it was fetched.
    const want = sessionTenantId !== undefined ? sessionTenantId : p.sessionTenantId;
    if (want === undefined) here.push(line);
    else if (want !== null && p.tenantId != null && p.tenantId === want) here.push(line);
    else elsewhere.push(line);
  }
  here.sort(byPassOrder);
  elsewhere.sort(byPassOrder);
  return { here, elsewhere };
}

/**
 * Coach packs as entitlement lines. Takes `PackLine`s from packDraw.ts rather
 * than re-deriving a balance this module has no business computing twice.
 *
 * ── `expiresOn` was a literal null, and part 612 made that false ──────────
 *
 * The comment on `gymPtLines` above says "a coach pack cannot expire and a pass
 * can", and that was true when it was written. Part 612 put a real
 * `expires_on` on a coach pack, `PackLine` has carried it since, and this
 * function threw it away on every line — so a coach pack with three weeks left
 * on it was handed to the picker as a pass that never runs out, sorted BEHIND
 * every dated gym pass, and offered with nothing anywhere saying it was about
 * to be lost. The one order that does not throw a client's money away is
 * soonest-to-expire first, and this fed it a null for every coach pack.
 *
 * ── an expired pack was dropped, and that disagreed with part 370 ────────
 *
 * This function used to end `.filter((l) => !l.expired)`, on the argument that
 * a closed window is not an entitlement and putting one in a picker offers
 * somebody something that cannot be spent. The argument is about SPENDING, and
 * the answer this list is used for is CHOOSING — and the two are decided by
 * different predicates in part 370.
 *
 * Route 1 is asked as "do they hold a pack from this coach at all", verified
 * against the live function today:
 *
 *     status = 'paid' and cp.sessions_total is not null
 *
 * with no expiry clause and no room clause. Part 612 closes a window by moving
 * `sessions_total` down to `sessions_used`; it leaves `status = 'paid'` and it
 * leaves `sessions_total` non-null. So an expired pack still WINS route 1, the
 * draw inside that route then finds no row with `sessions_used <
 * sessions_total`, and the session is stamped `pack_draw_shortfall_at`.
 *
 * Filtering the pack out here made the app answer a different question from the
 * database: a member holding an expired 10-pack from their coach and a live gym
 * PT pass was routed to 'gym_pass' and shown the pass's six credits, while the
 * server matched the pack, found no room, and drew nothing at all. The pass was
 * never touched, and the coach was told they had delivered an hour unpaid — by
 * `app/(trainer)/client.tsx`, off this same route.
 *
 * So the pack stays in the list, carrying `expired`, and the honest answer
 * becomes "this pack is what pays, and it has nothing left" rather than "the
 * gym pass pays". `left` is what the DATABASE will still draw off it, which is
 * normally nought — and is not always: `refund_pack_session` gives a credit back
 * to the newest pack with usage without asking whether that pack's window has
 * closed, and neither draw site filters on the window, so that credit really is
 * spendable and really is counted here. `packBalance` in packDraw.ts takes the
 * other view and keeps those out of its own `left` under `onClosedPacks`; where
 * the two disagree, this one is the one that matches what the trigger does.
 */
export function coachPackLines(
  lines: readonly {
    id: string; label: string; left: number; sessions_total: number;
    /** Optional so every existing construction of this shape keeps compiling.
     *  Absent and null mean the same thing: a pack with no window, which is
     *  every pack sold before part 612. */
    expiresOn?: string | null;
    expired?: boolean;
  }[] | null | undefined,
): Entitlement[] | null {
  if (lines == null) return null;
  return lines.map((l) => ({
    id: l.id,
    kind: 'coach_pack' as const,
    label: l.label,
    left: Math.max(0, l.left),
    sessions_total: l.sessions_total,
    // The pack's own last day, straight off the line. Null is still the
    // answer for a pack with no window, and it still sorts last — but it is
    // now the absence of a window rather than the absence of a field.
    expiresOn: l.expiresOn ?? null,
    // Carried, not filtered on. Whoever renders this line owes the member a
    // sentence about the closed window; whoever routes on it must count the
    // pack, because part 370 does.
    expired: !!l.expired,
  }));
}

/* ── the ledger ────────────────────────────────────────────────────────────── */

/**
 * What happened, or is going to happen, to a credit on one session.
 *
 * Past and future are different kinds of statement and are never worded the
 * same way: a draw is a fact, an expectation is a thing a cancellation can
 * still change.
 */
export type LedgerState =
  /** A credit came off at delivery. A fact, with a date. */
  | 'drawn'
  /** A credit came off when the client booked it. Also a fact. */
  | 'drawn_at_booking'
  /** Delivered, and nothing paid for it, because they hold nothing. Ordinary. */
  | 'not_covered'
  /** Delivered, they DO hold the entitlement, and it was empty. The defect. */
  | 'shortfall'
  /** Past, and nobody has said what happened yet. */
  | 'unmarked'
  /**
   * Past, marked, and not delivered. Three states and not one, because
   * `sessions.outcome` distinguishes three and folding them together is how a
   * screen came to tell somebody their cancelled session was "not marked yet".
   *
   * The names and the sentences are `PastState`'s in sessionHistory.ts rather
   * than a second vocabulary invented here: a coach reading "cancelled inside
   * the notice period" on a history row and on a credit row is reading about
   * the same thing.
   */
  | 'missed'
  | 'late_cancelled'
  | 'cancelled'
  /** Upcoming, and a credit is expected to come off when it is marked. */
  | 'expected'
  /** Upcoming, and already paid for — the credit came off at booking. */
  | 'reserved'
  /** Upcoming, and nothing will be drawn: they are paying another way. */
  | 'expected_none'
  /** We could not read what pays for these, so we will not guess. */
  | 'unknown';

export interface LedgerRow {
  sessionId: string;
  startsAt: string;
  state: LedgerState;
  kind: CreditKind | null;
  /** When the credit actually moved. Null for everything that has not moved. */
  drawnAt: string | null;
  /** The entitlement it came off, when one is named. */
  entitlementId: string | null;
}

export interface Ledger {
  /** Newest first. What a credit was actually spent on. */
  past: LedgerRow[];
  /** Soonest first. What is expected to spend one. */
  upcoming: LedgerRow[];
}

/**
 * A recorded outcome that is not 'completed', in sessionHistory's words.
 *
 * The live CHECK on `sessions.outcome` allows exactly null, 'completed',
 * 'no_show', 'cancelled' and 'late_cancelled', so the last branch is
 * unreachable against this database. It answers 'unknown' rather than
 * 'unmarked' anyway, because a value we do not recognise means we cannot say
 * what happened — and "nobody has marked this" is a different claim, about
 * somebody's coach, that this module would have no evidence for.
 */
const markedState = (outcome: string): LedgerState => {
  switch (outcome) {
    case 'no_show': return 'missed';
    case 'late_cancelled': return 'late_cancelled';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
};

const isPast = (s: CreditSession, now: number): boolean => {
  const t = Date.parse(s.startsAt);
  return Number.isFinite(t) ? t <= now : true;
};

/**
 * One session's place in the ledger.
 *
 * `route` is the answer `chooseRoute` gave, and it is what turns "nothing was
 * drawn" into one of three very different sentences: they hold nothing, they
 * hold something and it was empty, or we could not tell.
 */
export function ledgerStateOf(s: CreditSession, route: CreditRoute, now: number = Date.now()): LedgerState {
  if (s.packDrawnAt) return 'drawn';
  const past = isPast(s, now);

  if (past) {
    if (s.outcome == null) return 'unmarked';
    if (s.outcome !== 'completed') {
      // A no-show or a cancellation that had already spent a credit at booking
      // still spent one, and the client is entitled to see it.
      if (s.bookingDrewCreditAt && route === 'coach_pack') return 'drawn_at_booking';
      // And one that did not is still MARKED. This branch used to return
      // 'unmarked' — whose own definition four lines up is "nobody has said what
      // happened yet" — so a session the coach had recorded as a no-show told
      // the client "your coach has not said what happened yet" and told the
      // coach who marked it "not marked yet".
      return markedState(s.outcome);
    }
    if (s.shortfallAt) return 'shortfall';
    if (s.bookingDrewCreditAt && route === 'coach_pack') return 'drawn_at_booking';
    if (route === 'unknown') return 'unknown';
    return 'not_covered';
  }

  if (route === 'unknown') return 'unknown';
  if (route === 'none') return 'expected_none';
  // A one-off the client booked themselves has already paid, out of the coach
  // pack, at booking. Everything else pays at delivery.
  if (route === 'coach_pack' && s.seriesId == null && s.bookingDrewCreditAt) return 'reserved';
  return 'expected';
}

/**
 * Split a client's sessions into what a credit has been spent on and what is
 * expected to spend one.
 *
 * `sessions` null is a read that failed, and comes back as null rather than as
 * two empty lists — an empty ledger under a failed read reads as "you have
 * never used a session", which is the wrong sentence to show somebody who has
 * used nine.
 */
export function buildLedger(
  sessions: readonly CreditSession[] | null | undefined,
  route: CreditRoute,
  now: number = Date.now(),
): Ledger | null {
  if (sessions == null) return null;
  const past: LedgerRow[] = [];
  const upcoming: LedgerRow[] = [];
  for (const s of sessions) {
    if (s.status !== 'booked') continue;
    const state = ledgerStateOf(s, route, now);
    const row: LedgerRow = {
      sessionId: s.id,
      startsAt: s.startsAt,
      state,
      kind: s.packDrawnKind ?? (state === 'drawn_at_booking' ? 'coach_pack' : null),
      drawnAt: s.packDrawnAt ?? (state === 'drawn_at_booking' ? s.bookingDrewCreditAt : null),
      entitlementId: s.packDrawnPurchaseId ?? s.packDrawnPassId ?? null,
    };
    if (isPast(s, now)) past.push(row); else upcoming.push(row);
  }
  past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { past, upcoming };
}

/** How many credits the upcoming bookings are expected to take. Null when any
 *  of it is unknown, because a client planning a month needs the real number or
 *  an honest dash. */
export function expectedDraws(ledger: Ledger | null | undefined): number | null {
  if (ledger == null) return null;
  let n = 0;
  for (const r of ledger.upcoming) {
    if (r.state === 'unknown') return null;
    if (r.state === 'expected') n += 1;
  }
  return n;
}

/* ── wording ───────────────────────────────────────────────────────────────── */

/**
 * The sentence beside one ledger row, from the CLIENT's side.
 *
 * Sentence case, no dash inside a sentence, and no figure that was not read.
 * The two upcoming states are worded as expectations and say so, because part
 * 135's argument holds here: nothing is taken off a pack in advance, and a
 * screen that says a credit is already spent for a session eight weeks away is
 * describing a balance the database does not hold.
 */
export function clientLedgerLine(row: LedgerRow, entitlementLabel?: string | null): string {
  const off = entitlementLabel ? ` off ${entitlementLabel}` : '';
  switch (row.state) {
    case 'drawn':
      return row.kind === 'gym_pass'
        ? `One PT credit came${off || ' off your gym pass'} when this was marked complete.`
        : `One session came${off || ' off your pack'} when this was marked complete.`;
    case 'drawn_at_booking':
      return `One session came${off || ' off your pack'} when you booked this.`;
    case 'not_covered':
      return 'Nothing came off a pack for this one. You are paying your coach another way.';
    case 'shortfall':
      return 'Nothing was left to cover this session. Speak to your coach about what you owe for it.';
    case 'unmarked':
      return 'Your coach has not said what happened yet, so nothing has been drawn.';
    case 'missed':
    case 'late_cancelled':
    case 'cancelled':
      return `${PAST_STATE_NOTE[row.state]} Nothing came off a pack for it.`;
    case 'expected':
      return row.kind === 'gym_pass'
        ? 'One PT credit comes off your gym pass when your coach marks this complete.'
        : 'One session comes off your pack when your coach marks this complete.';
    case 'reserved':
      return 'A session came off your pack when you booked this. Cancelling in time puts it back.';
    case 'expected_none':
      return 'Nothing comes off a pack for this one.';
    default:
      return 'We could not read what pays for this session.';
  }
}

/** The same row from the COACH's or the GYM's side, where the person reading it
 *  is the one who gets paid rather than the one who paid. */
export function coachLedgerLine(row: LedgerRow): string {
  switch (row.state) {
    case 'drawn':
      return row.kind === 'gym_pass' ? 'Covered by a gym PT pass.' : 'Covered by their pack.';
    case 'drawn_at_booking':
      return 'Covered by their pack, drawn when they booked.';
    case 'not_covered':
      return 'Not on a pack. Settled with you directly.';
    case 'shortfall':
      return 'Nothing left to cover this. You delivered it unpaid.';
    case 'unmarked':
      return 'Not marked yet, so nothing has been drawn.';
    case 'missed':
    case 'late_cancelled':
    case 'cancelled':
      return `${PAST_STATE_NOTE[row.state]} No credit was drawn.`;
    case 'expected':
      return row.kind === 'gym_pass' ? 'A gym PT credit comes off when you mark it.' : 'A credit comes off their pack when you mark it.';
    case 'reserved':
      return 'Already drawn. They paid for this when they booked it.';
    case 'expected_none':
      return 'Nothing comes off a pack for this one.';
    default:
      return 'We could not read what pays for this.';
  }
}

/**
 * The one line a coach or an owner has to act on: how many hours were delivered
 * against an entitlement that was empty.
 *
 * Null when there are none, so a screen shows nothing rather than a reassuring
 * zero, and null when the ledger could not be read, because "no shortfalls"
 * and "we could not look" are opposite statements about whether somebody has
 * been paid.
 */
export function shortfallLine(ledger: Ledger | null | undefined): string | null {
  if (ledger == null) return null;
  const n = ledger.past.filter((r) => r.state === 'shortfall').length;
  if (n === 0) return null;
  return n === 1
    ? 'One delivered session had nothing left to draw from.'
    : `${n} delivered sessions had nothing left to draw from.`;
}

/**
 * What the client is told at the moment of booking, before the tap.
 *
 * Written here rather than in the booking screen so the promise made at the tap
 * and the sentence in the ledger afterwards cannot drift apart — which is
 * exactly how three screens came to describe one credit three ways.
 */
export function bookingCreditNote(route: CreditRoute, left: number | null): string | null {
  switch (route) {
    case 'coach_pack':
      if (left == null) return 'We could not read your pack, so we cannot say what this booking will cost you.';
      if (left === 0) return 'You have no sessions left on your pack. This booking is not covered by one.';
      return `A session comes off your pack the moment you book. You have ${left} left.`;
    case 'gym_pass':
      if (left == null) return 'We could not read your gym pass, so we cannot say what this booking will cost you.';
      if (left === 0) return 'You have no PT credits left on your gym pass. This booking is not covered by one.';
      return `One PT credit comes off your gym pass when your coach marks this complete. You have ${left} left.`;
    case 'unknown':
      return 'We could not read what pays for your sessions.';
    default:
      return null;
  }
}

/* ── the one answer, for the screens that all had their own ────────────────── */

/**
 * "How many sessions can I book?" — composed once, so three screens cannot
 * answer it three ways.
 *
 * ── What was actually on the three screens ────────────────────────────────
 *
 * `app/(client)/session-credits.tsx` read both systems and routed between them,
 * which is this function inlined. The other two read `client_purchases` alone:
 *
 *   packages.tsx      `packBalance(rows).left` — coach packs, no gym pass
 *   pt-sessions.tsx   `sessionPacks()?.left`   — coach packs, no gym pass
 *
 * A member whose gym sold them a PT pass and assigned them a coach therefore
 * held a real, spendable balance that two of the three screens could not see.
 * `packBalance` returns a REAL 0 for a history that was read and came back
 * empty — correctly, that is what it is for — so pt-sessions.tsx put the
 * figure 0 under "Sessions Remaining" and wrote **"You have not bought a
 * session pack"** beneath it. Both halves were true of `client_purchases` and
 * both were false of the member: they had bought a pass, and they had eight
 * sessions on it. packages.tsx drew no hero at all, which is quieter and is
 * the same omission.
 *
 * ── Why the answer is one number and not two ──────────────────────────────
 *
 * The temptation is to add the two balances together. That is the one answer
 * that is wrong in the case that matters: an EXHAUSTED coach pack still beats
 * a live gym pass — `chooseRoute` says so and part 370 does it in SQL — so a
 * member holding a spent 10-pack and an 8-use gym pass can book NOTHING
 * against an entitlement, and a hero reading "8" would send them to fill a
 * week that ends in eight shortfalls on their coach's unpaid hours.
 *
 * So: one figure, and it is the balance on the route that will actually pay.
 * The sentence under it is what differs between the two routes, because the
 * money belongs to two different businesses and the member is owed the name of
 * the one whose credit is about to move.
 *
 * Every argument is three-state and stays three-state. An unread half makes
 * the route 'unknown' and the figure null, never 'none' and never 0.
 */
export interface Bookable {
  route: CreditRoute;
  /** The entitlements that will actually be spent, in the order they are
   *  spent. Null for a read that did not land; `[]` for a member who holds
   *  nothing, which is an ordinary answer. */
  lines: Entitlement[] | null;
  /** How many sessions can be booked against an entitlement. Null is "we could
   *  not read it" and is never rendered as a figure. */
  left: number | null;
  /**
   * Live PT passes the member holds that THIS session's gym will not draw on —
   * another gym's, or any of them when the coach is independent. Never counted
   * in `left` and never in `lines`, because part 370 will not spend them here;
   * carried so the member can be told they exist rather than being told they
   * hold nothing. `[]` is "none of that kind", `null` is an unread pass list.
   */
  elsewhere: Entitlement[] | null;
}

export function bookableCredits(
  packLines: Parameters<typeof coachPackLines>[0],
  passes: readonly PtPassLike[] | null | undefined,
  todayISO: string,
  sessionTenantId?: string | null,
): Bookable {
  const coach = coachPackLines(packLines);
  const gym = gymPtLines(passes, todayISO, sessionTenantId);
  // `chooseRoute` is NOT given the session's gym, and deliberately. Its two
  // questions are "do they hold a coach pack" and "do they hold a gym PT pass
  // that pays" — and the second is already what `gymPtLines` answers, tenant
  // test included. Passing the tenant here as well would put route 2's
  // predicate in two places, which is how the app and the server came to
  // disagree in the first place.
  const route = chooseRoute(
    coach == null ? null : coach.length > 0,
    gym == null ? null : gym.length > 0,
  );
  const lines = payingLines(route, coach, gym);
  return {
    route,
    lines,
    left: creditsLeft(lines),
    elsewhere: passesElsewhere(passes, todayISO, sessionTenantId),
  };
}

/**
 * The line under the "Sessions Remaining" figure, naming the business whose
 * credit it is.
 *
 * Null when there is no figure for it to sit under — an unread balance or a
 * member who holds nothing — because a note with no number over it is a
 * caption for something that is not there.
 *
 * `expected` is how many booked sessions are still due to draw, from
 * `expectedDraws`. Only the ledger screen reads a diary, so it is optional:
 * `undefined` means nobody asked, which is not the same as `null` (asked, and
 * the diary would not read) and neither may be printed as "nothing booked".
 */
export function creditsHeroNote(b: Bookable, expected?: number | null): string | null {
  if (b.left == null || b.lines == null || b.lines.length === 0) return null;
  const n = b.lines.length;
  const named = b.route === 'gym_pass'
    ? (n === 1 ? 'On the PT pass your gym sold you' : `Across ${n} PT passes your gym sold you`)
    : (n === 1 ? 'On the pack you bought from your coach' : `Across ${n} packs you bought from your coach`);
  // Every line here is a pack whose window has closed. Said out loud, because
  // `coachPackLines` now keeps those — they are still what part 370 draws
  // against — and a caption that named the pack without naming the closed
  // window would leave a nought underneath it with no explanation.
  const closed = b.lines.every((l) => l.expired);
  let holding = closed
    ? `${named}, whose validity has run out`
    : named;
  // Two passes, one figure, and only one of them behind it. Said here because
  // this caption is the only thing under the number when the route IS the gym
  // pass, and a member holding a second pass from a second gym would otherwise
  // read the figure as covering both. Not said on the coach-pack route, where
  // no pass of any gym is named — the pack is what pays and that is the whole
  // sentence.
  if (b.route === 'gym_pass' && b.elsewhere != null && b.elsewhere.length > 0) {
    holding = `${holding} · a pass from another gym does not pay for these`;
  }
  if (expected == null) return holding;
  return expected === 0
    ? `${holding} · nothing booked is due to draw one`
    : `${holding} · ${expected} booked session${expected === 1 ? '' : 's'} still to draw`;
}

/**
 * The sentence for a pass that is real, valid, and cannot pay for THIS coach's
 * sessions.
 *
 * This is the half of the tenant fix that is about the member rather than the
 * money. `gymPtLines` stops counting another gym's pass because part 370 will
 * not draw on it — but "your pass shows 0" and "you hold no gym PT pass" are
 * both false things to tell somebody holding six good credits, and the second
 * is exactly the sentence `creditsEmptyLine` used to print. So the pass is
 * named, what it cannot do is stated once, and what it can still do is stated
 * with it.
 *
 * Worded so it is true of both shapes of the defect: a coach on another gym's
 * staff, and an INDEPENDENT coach whose sessions belong to their own personal
 * tenant and to no gym at all. Neither member needs to hear the word tenant.
 *
 * Null when there is nothing of the kind, or when the pass list was unread.
 */
export function passesElsewhereLine(b: Bookable): string | null {
  const other = b.elsewhere;
  if (other == null || other.length === 0) return null;
  const n = other.length;
  const credits = creditsLeft(other) ?? 0;
  const lead = n === 1
    ? 'Your sessions with this coach do not belong to the gym that sold you your PT pass, so nothing comes off it for them.'
    : `Your sessions with this coach do not belong to the gyms that sold you your ${n} PT passes, so nothing comes off them for these sessions.`;
  // Only when there is something left to be reassured about. "Its 0 credits are
  // still yours" is not a kindness.
  if (credits <= 0) return lead;
  const tail = n === 1
    ? `Its ${credits} PT credit${credits === 1 ? '' : 's'} ${credits === 1 ? 'is' : 'are'} still yours and still good at the gym that sold it.`
    : `Their ${credits} PT credit${credits === 1 ? '' : 's'} ${credits === 1 ? 'is' : 'are'} still yours and still good at the gyms that sold them.`;
  return `${lead} ${tail}`;
}

/**
 * What to say INSTEAD of a figure, and it is four different sentences.
 *
 * This is the function the defect was in. pt-sessions.tsx had two branches
 * where there are four, and it picked between them on `hasPacks` — a fact
 * about `client_purchases` alone — so "you have not bought a session pack" was
 * printed to somebody holding a gym pass and to somebody whose gym-pass read
 * had failed, indiscriminately.
 *
 * Null when there IS a figure, so a caller can render the hero and this and
 * never both.
 */
export function creditsEmptyLine(b: Bookable): string | null {
  if (b.route === 'unknown' || b.left == null) {
    return 'We could not read what pays for your sessions. This is our end, and it is not a statement that you have none — anything you have paid for is still yours.';
  }
  if (b.route === 'none') {
    // Holding a live PT pass from another gym IS holding a gym PT pass, so the
    // old sentence — "You are not on a session pack or a gym PT pass" — was
    // false for exactly the member this fix is about, and false in the
    // direction that invites them to go and buy a second one. The route is
    // still 'none', because part 370 will draw nothing here and will not stamp
    // a shortfall either (its own shortfall test carries the same
    // `p.tenant_id = new.tenant_id`), so nobody has delivered an unpaid hour —
    // this member is simply paying another way for these particular sessions.
    const other = passesElsewhereLine(b);
    if (other) {
      return `${other} Sessions with this coach are settled with them directly, which is an ordinary way to pay and not something to fix.`;
    }
    return 'You are not on a session pack or a gym PT pass. You settle sessions with your coach or your gym directly, which is an ordinary way to pay and not something to fix.';
  }
  if (b.left === 0) {
    if (b.route === 'gym_pass') {
      return 'You have no PT credits left on your gym pass. Your next session with your coach is not covered by one — ask your gym about another pass, or arrange it with your coach directly.';
    }
    // Ran out of TIME, not out of sessions, and those are two different things
    // to say to somebody who paid for credits they never used. Sessions with
    // this coach still come off this pack — part 370 picks it whether or not
    // its window has closed — so the sentence has to explain a nought that a
    // gym pass beside it will not fill.
    if (b.lines != null && b.lines.length > 0 && b.lines.every((l) => l.expired)) {
      return 'Your pack ran out of time. Sessions with this coach still come off that pack, so the next one is not covered by anything — ask them about the credits you did not use, buy another pack, or arrange it with them directly.';
    }
    return 'You have no sessions left on your pack. Your next session with your coach is not covered by one — buy another from them, or arrange it with them directly.';
  }
  return null;
}
