// One member, everything the gym knows about them.
//
// The Studio console can already *administer* a member — /money opens a
// membership, changes its status and records a payment against it. What it
// could not do is show you a person. The record was there; it was scattered
// across seven tables and six modules, each of which answers a different
// question about the gym as a whole and none of which answers "how is Sara
// doing?".
//
// Framework-free on purpose, and further than the other modules go: there is
// not even a Supabase client in here. Every function below takes rows and
// returns a conclusion, so the same reasoning can be run in the console, in the
// phone app, and in a test under plain node. The reads stay in the screen that
// needs them, because the *reads* are where the failure modes live and each
// screen has to render its own failures.
//
// ── The reason this file exists at all ─────────────────────────────────────
//
// A gym that judges retention by class attendance cannot tell these two people
// apart:
//
//   A. booked three classes a week until April, none since.
//   B. booked three classes a week until April, none since.
//
// A is in the building four times a week lifting on the floor. B has not been
// through the door since April. Read only the class rows and they are the same
// member, and the gym chases the wrong one — or worse, chases neither, because
// "attendance is down" is a number rather than a name.
//
// `retentionRead` below is the whole point of the module: it reports what class
// attendance alone would say, what the door log actually says, and flags the
// case where the first would call somebody lapsed while the second shows them
// still turning up. It refuses to answer at all when the door log is silent,
// because a gym with no door terminal has no evidence either way and a
// confident-looking verdict there would be a fabrication.

import type { Membership, GymPayment, MembershipStatus } from './gymRecord';
import type { Visit } from './gymVisits';
import type { PtSession } from './gymSessions';
import { isAwaitingOutcome } from './gymSessions';
import type { GymPass } from './gymPasses';
import { remainingUses } from './gymPasses';
import type { MemberInvite } from './memberInvites';

/* ── three states, never two ───────────────────────────────────────────────
 *
 * "Not read yet", "read, and there is nothing there" and "the read failed" are
 * three different facts and a screen must not collapse them. The usual
 * `T[] | null` cannot: it has two states for three answers, and the one that
 * gets lost is always the failure — which then renders as an empty record, the
 * single most misleading thing this console could do.
 */

export type Slice<T> =
  | { state: 'loading' }
  | { state: 'ready'; rows: T[] }
  | { state: 'failed'; reason: string };

export const sliceLoading = <T>(): Slice<T> => ({ state: 'loading' });
export const sliceReady = <T>(rows: T[]): Slice<T> => ({ state: 'ready', rows });
export const sliceFailed = <T>(reason: string): Slice<T> => ({ state: 'failed', reason });

/**
 * The rows, or null when there are none to be had.
 *
 * Deliberately lossy — it collapses "loading" and "failed" into null — so it is
 * only ever safe for computing a *value*. Ask `slice.state` when rendering:
 * that is where the distinction has to survive.
 */
export function rowsOf<T>(s: Slice<T>): T[] | null {
  return s.state === 'ready' ? s.rows : null;
}

/** A booking of one member onto one class, flattened so this module needs no
 *  query of its own. `attendedAt` null means booked and not ticked off — which
 *  is not the same as absent, and is why `showRate` counts only what was
 *  actually marked. */
export interface MemberBooking {
  bookingId: string;
  memberId: string;
  classId: string;
  classTitle: string | null;
  startsAt: string;
  /** 'booked', 'cancelled', … as the table stores it. */
  status: string;
  attendedAt: string | null;
}

/** Every half of the record a member page draws. Each is loaded, and can fail,
 *  on its own — a broken door log must not blank out the payments. */
export interface MemberRecord {
  memberships: Slice<Membership>;
  payments: Slice<GymPayment>;
  visits: Slice<Visit>;
  bookings: Slice<MemberBooking>;
  sessions: Slice<PtSession>;
  passes: Slice<GymPass>;
  invites: Slice<MemberInvite>;
}

export type RecordPart = keyof MemberRecord;

export const PART_ORDER: RecordPart[] = [
  'memberships', 'payments', 'visits', 'bookings', 'sessions', 'passes', 'invites',
];

/** What each part is called in a sentence an owner reads. */
export const PART_LABEL: Record<RecordPart, string> = {
  memberships: 'memberships',
  payments: 'payments',
  visits: 'the door log',
  bookings: 'class bookings',
  sessions: 'one-to-ones',
  passes: 'passes',
  invites: 'invites',
};

/** What each part would take with it if it could not be read — named so the
 *  warning says what is *missing from the page*, not just what errored. */
export const PART_COST: Record<RecordPart, string> = {
  memberships: 'plan and status',
  payments: 'what they have paid',
  visits: 'when they were last actually in the building',
  bookings: 'classes booked and attended',
  sessions: 'one-to-ones and their outcomes',
  passes: 'passes and visits still owed',
  invites: 'invite state',
};

export interface BrokenPart {
  part: RecordPart;
  label: string;
  cost: string;
  reason: string;
}

/** The parts whose read failed, in a stable order. */
export function brokenParts(rec: MemberRecord): BrokenPart[] {
  const out: BrokenPart[] = [];
  for (const part of PART_ORDER) {
    const s = rec[part];
    if (s.state === 'failed') {
      out.push({ part, label: PART_LABEL[part], cost: PART_COST[part], reason: s.reason });
    }
  }
  return out;
}

/** The parts still in flight. */
export function pendingParts(rec: MemberRecord): RecordPart[] {
  return PART_ORDER.filter((p) => rec[p].state === 'loading');
}

/**
 * Whether the page is entitled to present itself as a whole picture.
 *
 * 'broken' outranks 'loading': once something has definitively failed, the
 * screen is incomplete no matter what else is still arriving, and saying
 * "loading" would promise a completeness that is not coming.
 */
export function completeness(rec: MemberRecord): 'whole' | 'loading' | 'broken' {
  if (brokenParts(rec).length) return 'broken';
  return pendingParts(rec).length ? 'loading' : 'whole';
}

/**
 * The sentence to put above a half-loaded member page, or null when the page is
 * whole.
 *
 * It names both the part and what the reader is therefore *not* seeing, because
 * "visits failed to load" means nothing to a gym owner and "attendance is
 * missing from this page, not empty" means everything.
 */
export function partialWarning(rec: MemberRecord): string | null {
  const broken = brokenParts(rec);
  if (!broken.length) return null;
  const names = broken.map((b) => b.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const costs = broken.map((b) => b.cost).join('; ');
  return `Could not read ${list}. ${plural(broken.length, 'That section is', 'Those sections are')} missing from this page, not empty — ${costs} ${plural(broken.length, 'is', 'are')} unknown here.`;
}

/* ── the dossier ───────────────────────────────────────────────────────────── */

/**
 * Everything the gym knows about one person.
 *
 * Every list is `T[] | null` and every derived figure is `number | null`, with
 * null meaning "this part of the record was not available". Nothing here ever
 * substitutes zero for unknown: a member whose payments could not be read has
 * `paidCents: null`, and so does a member who has genuinely never paid — the
 * screen tells those apart from the slice state, which is exactly why the slice
 * state is kept separately instead of being flattened into this object.
 */
export interface MemberDossier {
  memberId: string;
  name: string | null;

  memberships: Membership[] | null;
  /** The row that describes them now. Null when they hold none, or none read. */
  membership: Membership | null;
  planName: string | null;
  status: MembershipStatus | null;

  payments: GymPayment[] | null;
  /** Null when nothing was recorded — a member with no payment rows has not
   *  necessarily paid nothing, and 0.00 would assert that they have. */
  paidCents: number | null;
  lastPaidAt: string | null;

  visits: Visit[] | null;
  /** Door visits with no class attached — the gym floor. */
  floorVisits: number | null;
  /** Door visits recorded against a class. */
  classVisits: number | null;
  lastSeenAt: string | null;
  /** Whole days since the last door visit. Null when never seen, or not read. */
  lastSeenDays: number | null;

  bookings: MemberBooking[] | null;
  /** Live bookings — cancellations are not places held. */
  booked: number | null;
  attended: number | null;
  /** attended / booked, or null when they booked nothing. Not 0%. */
  showRate: number | null;

  sessions: PtSession[] | null;
  delivered: number | null;
  noShows: number | null;
  /** Finished, booked, and nobody has said what happened. */
  unmarked: number | null;

  passes: GymPass[] | null;
  passVisitsLeft: number | null;

  invites: MemberInvite[] | null;
}

/**
 * The people this page can show. Null when the membership list itself could not
 * be read — with no roster there is no member-centred view, and inventing one
 * from whoever happens to appear in the door log would quietly drop every
 * member who has not been in this month.
 */
export function memberIds(rec: MemberRecord): string[] | null {
  const ms = rowsOf(rec.memberships);
  if (ms == null) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of ms) {
    if (!m.memberId || seen.has(m.memberId)) continue;
    seen.add(m.memberId);
    out.push(m.memberId);
  }
  return out;
}

export function buildDossier(
  memberId: string,
  rec: MemberRecord,
  now: number = Date.now(),
): MemberDossier {
  const ms = pick(rowsOf(rec.memberships), (m) => m.memberId === memberId);
  const pays = pick(rowsOf(rec.payments), (p) => p.memberId === memberId);
  const vis = pick(rowsOf(rec.visits), (v) => v.memberId === memberId);
  const bks = pick(rowsOf(rec.bookings), (b) => b.memberId === memberId);
  const sess = pick(rowsOf(rec.sessions), (s) => s.clientId === memberId);
  const pss = pick(rowsOf(rec.passes), (p) => p.holderId === memberId);
  const invs = rowsOf(rec.invites);

  const current = ms ? currentMembership(ms) : null;

  const live = bks ? bks.filter((b) => b.status !== 'cancelled') : null;
  const attended = live ? live.filter((b) => b.attendedAt).length : null;
  const booked = live ? live.length : null;

  const last = vis ? lastVisitAt(vis) : null;

  return {
    memberId,
    name: nameFor(memberId, ms, vis, pss),

    memberships: ms,
    membership: current,
    planName: current?.planName ?? null,
    status: current?.status ?? null,

    payments: pays,
    paidCents: pays == null || pays.length === 0
      ? null
      : pays.reduce((a, p) => a + p.amountCents, 0),
    lastPaidAt: pays == null || pays.length === 0
      ? null
      : pays.reduce((a, p) => (a > p.takenAt ? a : p.takenAt), pays[0].takenAt),

    visits: vis,
    floorVisits: vis ? vis.filter((v) => !v.classId).length : null,
    classVisits: vis ? vis.filter((v) => !!v.classId).length : null,
    lastSeenAt: last,
    lastSeenDays: last == null ? null : daysBetween(Date.parse(last), now),

    bookings: bks,
    booked,
    attended,
    // A member who booked nothing has no show rate. 0% would read as "booked
    // and never turned up", which is a different member entirely.
    showRate: booked == null || attended == null || booked === 0 ? null : attended / booked,

    sessions: sess,
    delivered: sess ? sess.filter((s) => s.outcome === 'completed').length : null,
    noShows: sess ? sess.filter((s) => s.outcome === 'no_show').length : null,
    unmarked: sess ? sess.filter((s) => isAwaitingOutcome(s, now)).length : null,

    passes: pss,
    passVisitsLeft: pss ? pss.reduce((a, p) => a + remainingUses(p), 0) : null,

    invites: invs,
  };
}

/** A dossier per member on the roster, or null when the roster is unreadable. */
export function buildDossiers(rec: MemberRecord, now: number = Date.now()): MemberDossier[] | null {
  const ids = memberIds(rec);
  if (ids == null) return null;
  return ids
    .map((id) => buildDossier(id, rec, now))
    .sort((a, b) => (a.name ?? '\uffff').localeCompare(b.name ?? '\uffff') || a.memberId.localeCompare(b.memberId));
}

/* ── the read this whole screen exists for ─────────────────────────────────── */

export type Trend = 'up' | 'steady' | 'down';

/** Why a member is outside the absence question entirely. */
export type AbsenceExclusion = 'frozen' | 'cancelled' | 'no-membership' | null;

export interface RetentionRead {
  /** Half the window, in days — the span each side of the comparison covers. */
  halfDays: number;
  recent: { classAttendances: number; visits: number };
  earlier: { classAttendances: number; visits: number };

  /** What class attendance alone would say. Null when they attended none in
   *  either half — there is no trend in nothing. */
  classes: Trend | null;
  /** What the door log says. Null when it recorded nothing for them either
   *  half, which is not the same as zero visits: an unread or absent door log
   *  produces exactly the same silence as a member who stayed away, and this
   *  module refuses to tell them apart on no evidence. */
  door: Trend | null;

  /**
   * The finding. True when class attendance has gone to nothing but the door
   * log still shows them coming in — the member a class-only report would
   * write off, and the reason the door log is on this page.
   */
  stillTrainingOffTheTimetable: boolean;

  /**
   * The complement, and only claimable when the gym's door log is actually
   * running: not one visit for this member in the recent half while other
   * members were being logged. This is the one case where an absence is
   * evidence rather than a gap — with a silent or unread door log the same
   * emptiness means nothing at all, so the flag stays false there.
   */
  absentFromLiveDoorLog: boolean;

  /**
   * Why absence could not be judged, when it could not. Null when the member
   * is somebody the gym still expects to see, so the flag above stands on its
   * own merits.
   *
   * A screen must not render "not absent" and "we did not look" identically —
   * that is how a frozen member reads as a member who is fine.
   */
  absenceUnknownBecause: AbsenceExclusion;

  /** A sentence for the screen, or null when the record cannot support one. */
  note: string | null;
}

export interface RetentionOptions {
  now?: number;
  /** The full comparison span. Split in half: the recent half against the one
   *  before it. */
  windowDays?: number;
  /**
   * Whether the gym's door log recorded anything at all in the window — from
   * the gym-wide visit rows, not this member's.
   *
   * Required rather than defaulted, and not derivable from the dossier: a
   * member with no visits looks identical whether the gym has no door terminal,
   * the door read failed, or they genuinely stopped coming. Only the caller
   * holding the gym-wide rows knows which, and the answer changes what this
   * function is allowed to conclude.
   */
  doorLogActive: boolean;
}

export const DEFAULT_WINDOW_DAYS = 56;

/**
 * What class attendance says, what the door log says, and where they disagree.
 *
 * Two equal halves of `windowDays`, most recent against the one before it. Two
 * halves rather than a slope through every week on purpose: a gym owner acts on
 * "compared with the eight weeks before", and a regression line over sparse
 * attendance data invites a confidence the rows do not carry.
 */
export function retentionRead(d: MemberDossier, opts: RetentionOptions): RetentionRead {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const halfDays = windowDays / 2;
  const half = halfDays * 86_400_000;
  const midpoint = now - half;
  const start = now - 2 * half;

  const inRecent = (iso: string) => within(iso, midpoint, now);
  const inEarlier = (iso: string) => within(iso, start, midpoint);

  const live = (d.bookings ?? []).filter((b) => b.status !== 'cancelled' && b.attendedAt);
  const recentClasses = live.filter((b) => inRecent(b.startsAt)).length;
  const earlierClasses = live.filter((b) => inEarlier(b.startsAt)).length;

  const vis = d.visits ?? [];
  const recentVisits = vis.filter((v) => inRecent(v.enteredAt)).length;
  const earlierVisits = vis.filter((v) => inEarlier(v.enteredAt)).length;

  const classes = d.bookings == null ? null : trend(recentClasses, earlierClasses);
  const door = d.visits == null ? null : trend(recentVisits, earlierVisits);

  const stillTrainingOffTheTimetable =
    d.bookings != null && d.visits != null &&
    earlierClasses > 0 && recentClasses === 0 && recentVisits > 0;

  // Absence is only evidence about somebody the gym still expects to see.
  //
  // This used to be `visits read && door log live && no recent visits`, with no
  // reference to the membership at all — so a FROZEN member, who agreed a pause
  // with the gym, was flagged as gone quiet, and so was somebody who had
  // CANCELLED and already left. Both got chased. A freeze is the gym's own
  // decision being read back to it as a problem, and chasing a leaver is worse
  // than noise.
  //
  // 'expired' is deliberately NOT excluded: a lapsed membership nobody renewed
  // is exactly the person a retention view exists to surface, and treating it
  // as an agreed ending would hide the case that matters most.
  //
  // A null status means the roster was not read or the member holds no
  // membership row. Neither is evidence that they are absent, so the flag stays
  // false and `absenceUnknownBecause` says which.
  const expected = d.status === 'active' || d.status === 'expired';
  const absentFromLiveDoorLog =
    d.visits != null && opts.doorLogActive && recentVisits === 0 && expected;

  const absenceUnknownBecause: AbsenceExclusion =
    d.status === 'frozen' ? 'frozen'
      : d.status === 'cancelled' ? 'cancelled'
      : d.status == null ? 'no-membership'
      : null;

  return {
    halfDays,
    recent: { classAttendances: recentClasses, visits: recentVisits },
    earlier: { classAttendances: earlierClasses, visits: earlierVisits },
    classes,
    door,
    stillTrainingOffTheTimetable,
    absentFromLiveDoorLog,
    absenceUnknownBecause,
    note: noteFor({
      halfDays, recentClasses, earlierClasses, recentVisits, earlierVisits,
      bookingsRead: d.bookings != null, visitsRead: d.visits != null,
      doorLogActive: opts.doorLogActive,
      stillTrainingOffTheTimetable, absentFromLiveDoorLog,
    }),
  };
}

/** Whether the gym's door log recorded anything in the rows the page loaded.
 *  Null when the door log could not be read — the caller must not treat that
 *  as "no door log", which is a fact about the gym rather than the network. */
export function doorLogActive(rec: MemberRecord): boolean | null {
  const vis = rowsOf(rec.visits);
  if (vis == null) return null;
  return vis.length > 0;
}

/**
 * The caveat to print under any attendance figure when the gym has no door log
 * in the window, or null when there is nothing to warn about.
 *
 * Without it, class bookings are the only attendance on the page and the reader
 * will take them for the whole truth — which is precisely the under-count
 * `gymVisits` was written to end.
 */
export function attendanceCaveat(rec: MemberRecord): string | null {
  const active = doorLogActive(rec);
  if (active === null) return null; // the failure banner already says this
  if (active) return null;
  return 'No door visits are recorded in this window, so attendance below is class bookings only. A member training on the floor is invisible to it.';
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function pick<T>(rows: T[] | null, keep: (row: T) => boolean): T[] | null {
  return rows == null ? null : rows.filter(keep);
}

function trend(recent: number, earlier: number): Trend | null {
  if (recent === 0 && earlier === 0) return null;
  if (recent > earlier) return 'up';
  if (recent < earlier) return 'down';
  return 'steady';
}

function within(iso: string, from: number, to: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= from && t < to;
}

function daysBetween(then: number, now: number): number | null {
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

function lastVisitAt(visits: Visit[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const v of visits) {
    const t = Date.parse(v.enteredAt);
    if (Number.isNaN(t) || t <= bestT) continue;
    bestT = t;
    best = v.enteredAt;
  }
  return best;
}

/**
 * The membership row that describes them today.
 *
 * A live row wins over a dead one however old it is: somebody who cancelled in
 * March and rejoined in June is a member, and showing "cancelled" because the
 * cancellation is a separate row would be wrong at the desk. Among equals, the
 * most recent start.
 */
function currentMembership(ms: Membership[]): Membership | null {
  if (!ms.length) return null;
  const rank = (m: Membership) => (m.status === 'active' ? 3 : m.status === 'frozen' ? 2 : 1);
  return [...ms].sort(
    (a, b) => rank(b) - rank(a) || String(b.startedOn).localeCompare(String(a.startedOn)),
  )[0];
}

function nameFor(
  memberId: string,
  ms: Membership[] | null,
  vis: Visit[] | null,
  pss: GymPass[] | null,
): string | null {
  for (const m of ms ?? []) if (m.memberName?.trim()) return m.memberName.trim();
  for (const v of vis ?? []) if (v.memberName?.trim()) return v.memberName.trim();
  for (const p of pss ?? []) if (p.holderName?.trim()) return p.holderName.trim();
  // Never the id dressed up as a name. The screen decides how to show an
  // unnamed row; this returns the fact.
  void memberId;
  return null;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function noteFor(x: {
  halfDays: number;
  recentClasses: number; earlierClasses: number;
  recentVisits: number; earlierVisits: number;
  bookingsRead: boolean; visitsRead: boolean; doorLogActive: boolean;
  stillTrainingOffTheTimetable: boolean; absentFromLiveDoorLog: boolean;
}): string | null {
  const d = Math.round(x.halfDays);
  if (x.stillTrainingOffTheTimetable) {
    return `Stopped booking classes but has not stopped training — ${x.recentVisits} door ${plural(x.recentVisits, 'visit', 'visits')} in the last ${d} days against ${x.earlierClasses} ${plural(x.earlierClasses, 'class', 'classes')} in the ${d} before. A class-only report would read this member as lapsed.`;
  }
  if (x.absentFromLiveDoorLog) {
    return x.earlierVisits > 0
      ? `Not through the door once in the last ${d} days, after ${x.earlierVisits} ${plural(x.earlierVisits, 'visit', 'visits')} in the ${d} before.`
      : `Not through the door once in ${d * 2} days, while the door log was recording other members. This is the one absence the record can actually stand behind.`;
  }
  if (!x.visitsRead) return null;
  if (!x.doorLogActive) return null;
  if (x.recentVisits > 0 && x.bookingsRead && x.recentClasses === 0 && x.earlierClasses === 0) {
    return `Trains on the floor: ${x.recentVisits} door ${plural(x.recentVisits, 'visit', 'visits')} in the last ${d} days and no classes either half. Nothing on the timetable measures this member.`;
  }
  return null;
}
