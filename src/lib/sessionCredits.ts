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
// ── The rule this module will not break ───────────────────────────────────
//
// A balance that was not read is UNKNOWN, and unknown is never 0. `packLeft` in
// coachMoney.ts and `packBalance` in packDraw.ts both already refuse to
// manufacture a zero, and every count here propagates `null` the same way: one
// unreadable input makes the total null, because a client holding ten credits
// must never be shown "0 left", and an empty ledger under a failed read must
// never read as "you have never used a session".

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
  /** ISO date this expires on, or null for one that does not. Both halves of
   *  the product can carry one: a gym pass always could, and a coach pack has
   *  since supabase/parts/612 gave packages a validity window. */
  expiresOn: string | null;
  /**
   * The window on this one has CLOSED.
   *
   * Straight off `PackLine.expired`, which is `client_purchases.expired_at`
   * being set — the fact part 612's nightly pass writes — and never a date
   * comparison run here. packDraw.ts refuses that comparison on purpose and
   * this module will not reintroduce it: until the pass has run the credits are
   * genuinely still spendable, and an app that says otherwise is wrong about
   * somebody's money a day early.
   *
   * Optional because only one of the two systems ever reaches a screen expired.
   * `gymPtLines` DROPS a pass that is not live on the day, so a gym line is
   * live by construction; a coach pack is carried rather than filtered, because
   * the ROUTE must not move. Part 370 picks a coach pack on `status = 'paid'
   * and cp.sessions_total is not null` with no expiry clause, so an expired
   * pack still wins the route — and a screen that hid it would disagree with
   * the server about who is paying while showing the member a nought with
   * nothing beside it to explain the nought.
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
 * The ordering is the opposite of the coach-pack rule and the difference is not
 * an inconsistency — a coach pack cannot expire and a pass can, so spending the
 * one about to be lost is the only order that does not throw a member's money
 * away.
 */
export function gymPtLines(
  passes: readonly {
    id: string;
    passTypeId: string | null;
    passTypeName: string | null;
    covers?: string | null;
    expiresOn: string | null;
    usesTotal: number;
    usesSpent: number;
  }[] | null | undefined,
  onISODate: string,
): Entitlement[] | null {
  if (passes == null) return null;
  const out: Entitlement[] = [];
  for (const p of passes) {
    if (p.covers !== 'pt') continue;
    const total = Number.isFinite(p.usesTotal) ? p.usesTotal : 0;
    const spent = Number.isFinite(p.usesSpent) ? p.usesSpent : 0;
    if (!passLiveOn(p.expiresOn, onISODate)) continue;
    out.push({
      id: p.id,
      kind: 'gym_pass',
      // The type's own name, or a description of the pass. Never a name this
      // code made up for a thing the gym named something else — the same rule
      // `packLabel` keeps for coach packs.
      label: (p.passTypeName || '').trim() || `${total}-session PT pass`,
      left: Math.max(0, Math.min(total, total - spent)),
      sessions_total: total,
      expiresOn: p.expiresOn,
      // Never true here, and stated rather than left off: the `passLiveOn`
      // guard above has already dropped every pass whose day has passed, so a
      // gym line reaching a screen is one that can still be spent.
      expired: false,
    });
  }
  out.sort((a, b) => {
    if (a.expiresOn && b.expiresOn && a.expiresOn !== b.expiresOn) return a.expiresOn < b.expiresOn ? -1 : 1;
    if (a.expiresOn && !b.expiresOn) return -1;
    if (!a.expiresOn && b.expiresOn) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/**
 * Coach packs as entitlement lines. Takes `PackLine`s from packDraw.ts rather
 * than re-deriving a balance this module has no business computing twice.
 *
 * A pack whose window has closed is KEPT, and carries its window with it. It is
 * kept because part 370 keeps it: route 1 is `status = 'paid' and
 * cp.sessions_total is not null` with no expiry clause, so an expired pack
 * still wins, and the whole point of this module is that the app and the server
 * name the same payer. It carries `expired` and `expiresOn` because the price
 * of keeping it is that a screen must be able to SAY why a pack it is listing
 * has nothing on it — see `entitlementWindowLine` below.
 */
export function coachPackLines(
  lines: readonly {
    id: string;
    label: string;
    left: number;
    sessions_total: number;
    expired?: boolean;
    expiresOn?: string | null;
  }[] | null | undefined,
): Entitlement[] | null {
  if (lines == null) return null;
  return lines.map((l) => ({
    id: l.id,
    kind: 'coach_pack' as const,
    label: l.label,
    left: Math.max(0, l.left),
    sessions_total: l.sessions_total,
    expiresOn: l.expiresOn ?? null,
    expired: l.expired === true,
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
      return s.bookingDrewCreditAt && route === 'coach_pack' ? 'drawn_at_booking' : 'unmarked';
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

/* ── a window that has closed ──────────────────────────────────────────────── */

/**
 * The caption under one entitlement about its own window, or null when there is
 * no window to describe.
 *
 * `day` is the date already written the reader's way — `fmtFullDay` in
 * src/lib/format.ts — because a pack's last day is a calendar day rather than an
 * instant, and the screen is the only thing in reach that knows the reader's
 * locale. A `day` that would not format gives null rather than a sentence with a
 * hole in it.
 *
 * The tense is the whole of it. A window still open is a promise about a day
 * that has not come; a window that closed is a fact about one that has. The same
 * word — "Expires" — printed in September under a day in August, beside "0 of
 * 10", is this app telling somebody their money is still waiting for them.
 */
export function entitlementWindowLine(
  l: Pick<Entitlement, 'expiresOn' | 'expired'>,
  day: string | null | undefined,
): string | null {
  if (!l.expiresOn || !day) return null;
  return l.expired ? `Ran out of time on ${day}` : `Expires ${day}`;
}

/**
 * Why the balance is nought, when the reason is a closed window rather than a
 * spend. Null in every other case.
 *
 * Null for a pack somebody simply used up: that is the same nought about a
 * different person — one got what they paid for and one did not — and packDraw's
 * `exhausted` is false on an expired pack for exactly this reason.
 *
 * It says the window closed and stops there. It does NOT say credits were
 * stranded, because this module holds no such figure: a pack fully used and then
 * closed reads 0 here too, and `sessionsExpired` in packDraw.ts is the only
 * thing entitled to claim somebody lost something. `expiryLine` in
 * src/lib/packExpiry.ts is where that sentence lives.
 */
export function creditsEmptyLine(lines: readonly Entitlement[] | null | undefined): string | null {
  if (lines == null || lines.length === 0) return null;
  if (creditsLeft(lines) !== 0) return null;
  const closed = lines.filter((l) => l.expired === true).length;
  if (closed === 0) return null;
  const many = closed > 1;
  return `Your pack${many ? 's' : ''} ran out of time.`
    + ` Nothing can be booked against ${many ? 'them' : 'it'} now, and whether anything is done about that`
    + ' is a conversation with your coach rather than something this app settles on its own.';
}

/**
 * The note under the "Sessions Remaining" figure: what the figure is across, and
 * what is booked against it.
 *
 * Null for a list that is unread or empty, so a screen prints nothing rather
 * than a note about no packs. `expected` is `expectedDraws`, three-state as
 * ever — null is "we could not count the bookings", and it is said by leaving
 * the clause off rather than by printing a nought nobody counted.
 *
 * A closed window is named up here and not left to the lines below, because the
 * figure above it is what somebody plans a month against: "3" across four packs,
 * two of which nothing can be booked against, is not the same 3.
 */
export function creditsHeroNote(
  lines: readonly Entitlement[] | null | undefined,
  expected: number | null,
): string | null {
  if (lines == null || lines.length === 0) return null;
  const n = lines.length;
  const s = n === 1 ? '' : 's';
  const closed = lines.filter((l) => l.expired === true).length;
  const across = closed === 0
    ? `Across ${n} pack${s}`
    : closed === n
      ? `Across ${n} pack${s} whose validity has run out`
      : `Across ${n} pack${s} · ${closed} whose validity has run out`;
  if (expected == null) return across;
  return expected === 0
    ? `${across} · nothing booked is due to draw one`
    : `${across} · ${expected} booked session${expected === 1 ? '' : 's'} still to draw`;
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
