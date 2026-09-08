// Staff — the gym's own people, and what the record can honestly say about each.
//
// The console could already see a trainer three ways and never as a person on a
// payroll: the Overview lists a roster with a health dot, /sessions prices the
// one-to-ones, /timetable draws the rota. An owner asking the ordinary Monday
// question — who works here, what did they deliver, what do I owe them, were
// they on the floor for the hours I rostered, and is anyone's book quietly
// emptying — had to hold four screens in their head and join them by name.
//
// Framework-free on purpose, and further than the reading modules go: there is
// not a Supabase client anywhere in here. Every function takes rows already
// fetched and returns a conclusion, so the same reasoning runs in the console,
// in the phone app, and in a test under plain node. The reads stay in the
// screen, because the reads are where the failure modes live and only the
// screen can render its own failures. Same shape as monthEnd.ts and
// memberView.ts.
//
// ── The trap this module exists to avoid ───────────────────────────────────
//
// A trainer with no data must NEVER rank as fine.
//
// This codebase has been bitten by it repeatedly. `atRiskClient` in
// trainerMock.ts returns false for a client it has never seen a data point
// from — reporting "not at risk" about somebody it knows nothing about.
// `clientDrift.ts` was written to end the same bug on the coach's book.
//
// On a staff screen it has a second, sharper form, and this is the one that
// costs money. `trainerHealth` in ownerAnalytics.ts scores on `sessions30` —
// bookings whose clock has passed, marked or not. A trainer with five clients
// and twenty sessions that NOBODY MARKED scores as healthy and reads
// "Carrying clients and delivering sessions", when the truthful statement is
// that there is no evidence any of the twenty happened. That trainer is also
// the one whose pay cannot be computed. Scoring them green is the exact
// inversion of what the owner needs to see.
//
// So `assess()` below puts an EVIDENCE GATE in front of ownerAnalytics rather
// than beside it. `trainerHealth` still owns the healthy / watch / at-risk
// judgement — its vocabulary is not forked and its reasons are printed
// verbatim — but it is only asked the question when the record can support an
// answer, and it is asked about CONFIRMED delivery rather than about bookings.
// Where the record cannot support an answer the result is UNKNOWN, which is a
// state of the evidence and not a grade of the person.
//
// Four ways a trainer ends up UNKNOWN, all of them named on screen:
//   · the read that would judge them failed or is still in flight;
//   · nothing at all on record — no clients, no sessions;
//   · sessions finished and not one has an outcome, so delivery is unknown
//     in both directions;
//   · they joined days ago and nothing is marked yet.
//
// ── No invented figures ────────────────────────────────────────────────────
//
// Every derived number is `number | null`, and null means "the record cannot
// say", never zero. A trainer whose rota was not read has `rosteredHours:
// null`; so does a trainer with no live shift. Both render as a dash with a
// sentence, and neither is reported as a trainer who worked no hours.
//
// ── And no unlabelled money ────────────────────────────────────────────────
//
// `owedCents` and `outstandingCents` were bare integers and this module said
// nothing at all about what money they were in. /staff therefore supplied the
// unit itself, from `tenants.currency` — the gym's code TODAY — over rates
// snapshotted whenever they were snapshotted, exactly the substitution
// supabase/parts/1010 added `sessions.rate_currency` to end.
//
// Worse than a label: `settlementAmount` adds `rate_cents` up across rows whose
// `rate_currency` may disagree with each other, so on a gym that has changed
// its currency mid-window the figure is a sum ACROSS moneys — not an amount of
// anything. /sessions already refuses to settle that exact run, through
// `settleCurrencyBlocker`, so "Payable now" was a confident figure the settle
// path would not pay, with neither screen explaining the difference.
//
// The rule here is ./gymRateCurrency's, unchanged and not re-derived:
//
//   · one currency      → the figure stands, `…Currency` names it;
//   · unrecorded        → the figure is REAL and stands, `…Currency` is null
//                         and `…Note` says the unit was never written down.
//                         Nulling it would destroy a true number;
//   · more than one     → there is no figure. `…Cents` is null, `…Mixed` is
//                         true, and `…Note` names the pots. A sum across
//                         currencies is never printed, exported or settled.
//
// Same shape and the same three field names as `monthEnd.PayrollView`, which
// closed this defect on /close: the label and the number are derived from one
// set of rows, at the place the number is computed, not at the place it is
// rendered.

import type { Slice } from './memberView';
import { rowsOf } from './memberView';
import type { PtSession, PayPolicy, PayrollLine } from './gymSessions';
import {
  isAwaitingOutcome, payableRate, payrollByTrainer, settleableSessions, settlementAmount,
  settleBlocker,
} from './gymSessions';
// What money a run of sessions is actually in. This module used to add
// `rate_cents` up and hand back a bare integer; the console then wrote
// `tenants.currency` beside it. See the header note below, and ./gymRateCurrency
// for the one place that rule lives — nothing here re-derives it.
import {
  runCurrency, runLabel, settleCurrencyBlocker, totalNote, type RatedSession,
} from './gymRateCurrency';
import type { Shift, DemandBlock } from './gymRota';
import { shiftHours, isLive } from './gymRota';
import { trainerHealth, type TrainerLike } from './ownerAnalytics';
import { STATUS_LABEL, STATUS_RANK, statusFromRisk, type StatusLevel } from './status';
import {
  assessDrift, sortByDrift, summariseDrift, DEFAULT_WINDOWS,
  type Drift, type DriftWindows, type ActivityEvent,
} from './clientDrift';

const DAY = 86_400_000;
const HOUR_MIN = 60;

/** A trainer joined less recently than this has had a fair chance to appear in
 *  the record. Inside it, an empty record is newness rather than a problem. */
export const NEW_TRAINER_DAYS = 14;

const round1 = (n: number) => Math.round(n * 10) / 10;
const s = (n: number) => (n === 1 ? '' : 's');

/* ── what money a figure is in ─────────────────────────────────────────────── */

/**
 * The rates a payroll figure over these rows is actually a sum of, each
 * carrying the unit it was summed IN.
 *
 * Through `payableRate`, which is the single rule `payrollByTrainer` prices
 * with — never a filter written a second time here. `monthEnd.payrollOf` builds
 * its rate set the same way and for the same reason: a total and its own
 * currency label derived from two differently-written sets of rows is precisely
 * the fault this pair exists to close.
 *
 * A fallback-priced session comes back with a null unit, which
 * ./gymRateCurrency reads as 'unrecorded'. That is deliberate — `fallback` is a
 * bare integer and nothing tells this module what money the gym's standard fee
 * is in, so it must not borrow the code off a neighbouring snapshotted row.
 */
type PayableRate = { rateCents: number; rateCurrency: string | null };

function ratesOf(
  rows: PtSession[], policy: PayPolicy, fallback: number | null,
): PayableRate[] {
  return rows
    .map((r) => payableRate(r, policy, fallback))
    .filter((r): r is PayableRate => r != null);
}

/** A money figure and the truth about what it is denominated in. */
interface MoneyVerdict {
  /** The figure, or null when there is no single figure to state. */
  cents: number | null;
  currency: string | null;
  mixed: boolean;
  note: string | null;
}

/**
 * `cents`, judged against the rows it was summed from.
 *
 * The three calls are `monthEnd.payrollOf`'s three, verbatim, so the two
 * modules cannot drift apart on the one question. The only thing added is the
 * withholding: a mixed run has no total, so `cents` does not survive it.
 */
function verdictOn(cents: number | null, rates: readonly RatedSession[] | null): MoneyVerdict {
  if (rates == null) return { cents, currency: null, mixed: false, note: null };
  const mixed = runCurrency(rates).kind === 'mixed';
  return {
    // Not the sum, and not zero: two moneys added together is not an amount, so
    // the figure is withheld and `note` says which pots were in it.
    cents: mixed ? null : cents,
    currency: runLabel(rates),
    mixed,
    note: totalNote(rates),
  };
}

/* ── the rows this module reasons over ─────────────────────────────────────── */

/** A member of staff, as the roster states them. Names live on `profiles`. */
export interface StaffTrainer {
  trainerId: string;
  name: string | null;
  /** ISO timestamp they joined, or null when the profile carries none. */
  since: string | null;
}

/** One client, and whose book they are on. `trainerId` null means nobody's. */
export interface StaffClient {
  clientId: string;
  name: string | null;
  trainerId: string | null;
  since: string | null;
}

/** Everything the record knows one client did. An empty `events` means read and
 *  silent; a client missing from the slice entirely means not asked about. */
export interface ClientActivity {
  clientId: string;
  events: ActivityEvent[];
}

/* ── the parts, and their three states ─────────────────────────────────────── */

export interface StaffRecord {
  trainers: Slice<StaffTrainer>;
  sessions: Slice<PtSession>;
  shifts: Slice<Shift>;
  clients: Slice<StaffClient>;
  activity: Slice<ClientActivity>;
  /** Classes on the timetable in the window, as demand blocks. Only ever read
   *  for `kind: 'class'` — the one-to-one blocks the same query returns are
   *  ignored here, because `sessions` already holds them with their outcomes. */
  classes: Slice<DemandBlock>;
}

export type StaffPart = keyof StaffRecord;

export const STAFF_PARTS: StaffPart[] = [
  'trainers', 'sessions', 'shifts', 'clients', 'activity', 'classes',
];

export const STAFF_LABEL: Record<StaffPart, string> = {
  trainers: 'the staff roster',
  sessions: 'the one-to-ones',
  shifts: 'the rota',
  clients: 'the client book',
  activity: 'the training record',
  classes: 'the timetable',
};

/** What the screen loses when a part cannot be read — named as the missing
 *  ANSWER, not the missing table. "shifts failed" tells an owner nothing;
 *  "rostered hours are unknown, not nil" tells them everything. */
export const STAFF_COST: Record<StaffPart, string> = {
  trainers: 'there is no roster, so this page cannot name anybody',
  sessions: 'what was delivered and what is owed are unknown, and nobody can be judged on delivery',
  shifts: 'rostered hours are unknown, not nil — no trainer can be shown against the hours they were booked for',
  clients: 'nobody\'s book can be counted, so client load is unknown rather than empty',
  activity: 'no client can be assessed for drift, so a silent book looks the same as a steady one',
  classes: 'class hours are missing, so a trainer who teaches will look under-used',
};

export interface BrokenStaffPart {
  part: StaffPart;
  label: string;
  cost: string;
  reason: string;
}

export function brokenStaffParts(rec: StaffRecord): BrokenStaffPart[] {
  return STAFF_PARTS
    .filter((p) => rec[p].state === 'failed')
    .map((p) => ({
      part: p,
      label: STAFF_LABEL[p],
      cost: STAFF_COST[p],
      reason: (rec[p] as { state: 'failed'; reason: string }).reason,
    }));
}

export function loadingStaffParts(rec: StaffRecord): StaffPart[] {
  return STAFF_PARTS.filter((p) => rec[p].state === 'loading');
}

/** The parts that came back, and came back short. */
export function truncatedStaffParts(rec: StaffRecord): StaffPart[] {
  return STAFF_PARTS.filter((p) => rec[p].state === 'partial');
}

/**
 * The sentence to put above a staff page whose reads came back SHORT, or null
 * when nothing was truncated.
 *
 * Its own sentence, not folded into `staffWarning`. On this page in particular
 * the two are acted on differently: a failed roster read is a fault to chase,
 * and a truncated one is a set of named people who are simply not on a payroll
 * screen — which reads as a gym with fewer coaches rather than as a read that
 * ran short.
 */
export function staffTruncationWarning(rec: StaffRecord): string | null {
  const cut = truncatedStaffParts(rec);
  if (!cut.length) return null;
  const names = cut.map((p) => STAFF_LABEL[p]);
  const one = cut.length === 1;
  const list = one
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const costs = cut.map((p) => STAFF_COST[p]).join('; ');
  return (
    `Read the first rows of ${list} and there are more. ${one ? 'That part is' : 'Those parts are'} ` +
    `a PREFIX, not the whole record — ${costs}. Every figure over ${one ? 'it' : 'them'} is withheld ` +
    `rather than shown as a subtotal.`
  );
}

/**
 * Whether this page is entitled to present itself as a whole picture.
 *
 * 'broken' outranks 'loading', as in memberView: once something has definitively
 * failed the screen is incomplete no matter what else is still arriving, and
 * saying "loading" would promise a completeness that is not coming.
 */
export function staffCompleteness(rec: StaffRecord): 'whole' | 'loading' | 'truncated' | 'broken' {
  if (brokenStaffParts(rec).length) return 'broken';
  if (loadingStaffParts(rec).length) return 'loading';
  // 'truncated' rather than 'whole', which is what this returned before the
  // fourth state existed: a page built on a prefix was reporting itself as a
  // whole picture, which is the one answer it must never give.
  return truncatedStaffParts(rec).length ? 'truncated' : 'whole';
}

/**
 * The sentence above a half-loaded staff page, or null when every part is in.
 *
 * Same rule as `memberView.partialWarning` and `monthEnd.closeWarning`: name the
 * half that failed AND what the reader is therefore not seeing. A staff page is
 * read to decide who to talk to and what to pay them; a partial one presented
 * as whole gets somebody the wrong conversation or the wrong money.
 */
export function staffWarning(rec: StaffRecord): string | null {
  const broken = brokenStaffParts(rec);
  if (!broken.length) return null;
  const names = broken.map((b) => b.label);
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Could not read ${list}. This page is partial, not empty — ${broken.map((b) => b.cost).join('; ')}.`;
}

/* ── one member of staff ───────────────────────────────────────────────────── */

export interface StaffMember {
  trainerId: string;
  name: string | null;
  since: string | null;
  /** Days on the book. Null when the profile carries no join date. */
  observedDays: number | null;

  /** Clients on their book. Null when the client roster was not read — never 0,
   *  which would claim a trainer nobody is assigned to. */
  clients: number | null;

  /* delivery — every one null when the one-to-ones were not read */
  /** Booked slots of theirs in the window, whatever became of them. */
  sessions: number | null;
  delivered: number | null;
  noShows: number | null;
  cancelled: number | null;
  /** Finished, booked, and nobody has said what happened. */
  unmarked: number | null;
  /** Booked and still in the future. Not unmarked — nothing has happened yet. */
  upcoming: number | null;
  /** Sessions whose outcome somebody actually recorded. THE evidence count. */
  marked: number | null;

  /* money */
  /**
   * Payable and priced across the window.
   *
   * Null when nothing payable had a rate — AND null when this coach's window
   * straddles two currencies, because a sum across moneys is not a figure. Read
   * `owedMixedCurrency` to tell those two nulls apart, and print `owedNote`
   * where the number would have gone.
   */
  owedCents: number | null;
  /** The one currency `owedCents` may be LABELLED with, or null when no single
   *  label is honest. `runLabel`'s rule, asked of this coach's payable rates —
   *  never `tenants.currency`, which is the gym's code today and says nothing
   *  about what a rate snapshotted last March was in. */
  owedCurrency: string | null;
  /** True when this coach's payable sessions were priced in more than one
   *  money. `owedCents` is then null rather than a total of nothing. */
  owedMixedCurrency: boolean;
  /** Why `owedCents` cannot be printed as one labelled figure, from
   *  `totalNote` — the mixed pots, or rates that predate part 1010 and carry no
   *  unit. Null when the run has one currency, or nothing priced at all. */
  owedNote: string | null;
  payable: number | null;
  priced: number | null;
  /**
   * What settling right now would hand over: marked, priced, payable and not
   * already settled.
   *
   * Null when the sessions were not read, null when nothing is outstanding, and
   * null when the outstanding rows disagree about currency — the case /sessions
   * refuses to settle, so this page must not quote a figure for it either.
   */
  outstandingCents: number | null;
  outstandingSessions: number | null;
  /** The one currency `outstandingCents` may be labelled with, or null. */
  outstandingCurrency: string | null;
  /** True when the outstanding rows were priced in more than one money. */
  outstandingMixedCurrency: boolean;
  /** Why `outstandingCents` cannot be printed as one labelled figure. */
  outstandingNote: string | null;
  /** Why a settlement cannot be recorded for them right now, from
   *  `gymSessions.settleBlocker` and then `gymRateCurrency.settleCurrencyBlocker`
   *  — the same two readers /sessions and /payroll ask, in the same order, so
   *  the three screens cannot hold three opinions about one run. Null when it
   *  can, and null when unknown. */
  settleBlocker: string | null;
  settleable: boolean;

  /* hours */
  /** Live shift hours in the window. Null when the rota was not read, and null
   *  when they hold no live shift — a trainer whose only shift was pulled has
   *  no hours, not zero hours (`gymRota.rosterByTrainer` says the same). */
  rosteredHours: number | null;
  shifts: number | null;
  pulledShifts: number | null;
  /** Hours of CONFIRMED one-to-one delivery. Null while nothing of theirs is
   *  marked: with no outcome recorded, 0 would assert they delivered nothing. */
  deliveredHours: number | null;
  /** Hours sitting inside sessions nobody marked — the hours the record cannot
   *  account for in either direction. */
  unmarkedHours: number | null;
  /** Hours of class on the timetable assigned to them. Scheduled, not
   *  confirmed, so never added into `deliveredHours`. */
  classHours: number | null;
  /** deliveredHours ÷ rosteredHours. Null when either side is unknown or the
   *  rostered side is nothing — there is no ratio over no hours. */
  floorUse: number | null;
  /** What that ratio does NOT contain, said out loud beside it. */
  hoursNote: string | null;

  /* the book */
  /** Their clients assessed against their own patterns, worst first. Null
   *  unless BOTH the book and the training record were read — drift computed
   *  over an unread activity table calls every client silent. */
  book: Drift[] | null;
  drifting: number | null;
  watchClients: number | null;
  unknownClients: number | null;
  steadyClients: number | null;

  /* the verdict, or the refusal to give one */
  status: StatusLevel;
  /** True when the record cannot support a judgement. Not a grade. */
  unknown: boolean;
  /** Short, human, and true about the RECORD rather than about the person. */
  reason: string;
}

/**
 * The staff page's ordering. Built from `STATUS_RANK` and differing from it in
 * exactly one place, deliberately: `idle` — this module's UNKNOWN — moves from
 * last to second.
 *
 * This is the same deviation `DRIFT_RANK` makes in clientDrift.ts, for the same
 * reason and with the same care. STATUS_RANK sinks `idle` because on the
 * Overview's glance-roster "nothing to assess" is not a call to action and
 * floating it would bury the rows that are. On THIS page it is the opposite: a
 * trainer the record cannot judge is a trainer whose pay cannot be computed and
 * whose delivery nobody has confirmed, and burying them under the healthy rows
 * is precisely how a gym pays the wrong amount. Never last, and never mixed in
 * among the fine.
 */
export const STAFF_RANK: Record<StatusLevel, number> = {
  ...STATUS_RANK,
  at_risk: 0,
  idle: 1,
  watch: 2,
  on_track: 3,
};

/**
 * The staff page's labels. STATUS_LABEL's three concern levels are reused
 * verbatim; only `idle` is re-worded, exactly as DRIFT_LABEL does — "Idle"
 * printed beside an employee's name on their employer's dashboard reads as a
 * verdict on them, when what is actually true is that we do not know.
 */
export const STAFF_STATUS_LABEL: Record<StatusLevel, string> = {
  ...STATUS_LABEL,
  idle: 'Unknown',
};

/** The heading a band gets on the staff list. */
export function bandTitle(status: StatusLevel): string {
  switch (status) {
    case 'at_risk': return 'Needs attention';
    case 'idle': return 'Nothing the record can judge';
    case 'watch': return 'Worth a look';
    default: return 'Delivering';
  }
}

/** What a band means, said once under its heading rather than on every row. */
export function bandNote(status: StatusLevel): string {
  switch (status) {
    case 'at_risk': return 'Carrying clients and not delivering, on the record as it stands.';
    case 'idle': return 'No evidence either way. Not the same as fine — find out which.';
    case 'watch': return 'Delivering, but something about the pattern is off.';
    default: return 'Clients on the book and confirmed sessions behind them.';
  }
}

/** Worst first, unknown directly beneath. Within a band, the bigger book leads
 *  — of two equally flagged trainers, the one carrying more clients is the
 *  larger exposure and the call to make first. */
export function compareStaff(a: StaffMember, b: StaffMember): number {
  const r = STAFF_RANK[a.status] - STAFF_RANK[b.status];
  if (r !== 0) return r;
  const ca = a.clients ?? -1, cb = b.clients ?? -1;
  if (ca !== cb) return cb - ca;
  const ua = a.unmarked ?? -1, ub = b.unmarked ?? -1;
  if (ua !== ub) return ub - ua;
  return (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.trainerId.localeCompare(b.trainerId);
}

/* ── the whole view ────────────────────────────────────────────────────────── */

export interface StaffOptions {
  /** Whether a no-show is payable. A gym policy, never assumed here — the same
   *  control and the same default as /sessions and /close. */
  policy: PayPolicy;
  /** The gym's standard session fee in minor units, for sessions carrying no
   *  snapshotted rate. Null when none is set, and then those sessions stay
   *  unpriced rather than valued at nothing. */
  fallbackRateCents?: number | null;
  now?: number;
  /**
   * `tenants.currency` as it stands now — the code a settlement recorded today
   * would be stamped with.
   *
   * Optional, and its absence is NOT read as "this gym has no currency": with
   * nothing stated here the currency half of the settle check falls back to the
   * one branch that needs no gym code at all, which is the refusal of a run
   * priced in two moneys. Pass it and `settleBlocker` also catches the run whose
   * rates positively disagree with the label the payment row would carry —
   * exactly what /sessions and /payroll already refuse.
   */
  gymCurrency?: string | null;
  /** How far back the sessions, rota and timetable were read. Used only for
   *  wording — the rows themselves decide the figures. */
  windowDays: number;
  /** Drift windows for the client books. Defaults to clientDrift's own. */
  windows?: DriftWindows;
}

export interface StaffRollup {
  /** Headcount on the roster. Null when the roster was not read. */
  trainers: number | null;
  atRisk: number | null;
  watch: number | null;
  onTrack: number | null;
  /** Trainers the record cannot judge. The figure this page exists to surface. */
  unknown: number | null;
  /**
   * Everyone not on_track — the same set `ownerAnalytics.gymRollup` counts as
   * `atRiskCount`, named here for what it is so the two screens cannot be read
   * as disagreeing.
   */
  flagged: number | null;
  /** Clients carried by flagged trainers: the exposure, not the headcount. */
  flaggedClients: number | null;

  clients: number | null;
  /** Clients on nobody's book. A real state, not a rounding error. */
  unassignedClients: number | null;

  delivered: number | null;
  noShows: number | null;
  unmarked: number | null;

  /**
   * Payable and priced across the window, over the ROSTER.
   *
   * Null when nothing could be priced, and null when the roster's rates
   * straddle two currencies — which happens without any single coach's line
   * being mixed, one coach on EUR and another on GBP being enough. That case is
   * the reason this is not simply the sum of the rows underneath: the sum would
   * still be a number, and it would be a number in no money at all.
   */
  owedCents: number | null;
  owedCurrency: string | null;
  owedMixedCurrency: boolean;
  owedNote: string | null;
  /** What could be handed over right now across the whole gym. Same three
   *  companions, and withheld on a mixed roster for the same reason. */
  outstandingCents: number | null;
  outstandingCurrency: string | null;
  outstandingMixedCurrency: boolean;
  outstandingNote: string | null;

  rosteredHours: number | null;
  deliveredHours: number | null;
  classHours: number | null;
}

export interface StaffView {
  members: StaffMember[] | null;
  rollup: StaffRollup;
  /**
   * Payroll lines for trainer ids that ran sessions but are not on the roster —
   * somebody who left, or a roster row that never existed. Real money against a
   * name this page cannot print, so it is surfaced rather than dropped.
   */
  offRoster: PayrollLine[] | null;
  /** The banner above the whole screen when a part failed. */
  warning: string | null;
  /** The banner above the whole screen when a part came back SHORT. Its own
   *  field, not folded into `warning`, because a fault to chase and a figure to
   *  stop quoting are two different things to do next. */
  truncated: string | null;
  /** Why the page cannot judge everybody, in one line, or null. */
  caveat: string | null;
}

/**
 * The whole staff picture.
 *
 * Every input arrives as a slice and every output that depends on a slice which
 * is not ready is null. There is no branch anywhere in here that substitutes an
 * empty array for a failed read, and no branch that lets a trainer with no
 * evidence come out on_track.
 */
export function buildStaff(rec: StaffRecord, opts: StaffOptions): StaffView {
  const now = opts.now ?? Date.now();
  const windows = opts.windows ?? DEFAULT_WINDOWS;
  const fallback = opts.fallbackRateCents ?? null;

  const trainerRows = rowsOf(rec.trainers);
  const sessionRows = rowsOf(rec.sessions);
  const shiftRows = rowsOf(rec.shifts);
  const clientRows = rowsOf(rec.clients);
  const activityRows = rowsOf(rec.activity);
  const classRows = rowsOf(rec.classes);

  // Payroll is computed ONCE over the whole window, by the same function
  // /sessions and /close use. Recomputing per trainer here would be a second
  // opinion about the same money.
  const lines = sessionRows ? payrollByTrainer(sessionRows, opts.policy, fallback, now) : null;
  const lineOf = new Map((lines ?? []).map((l) => [l.trainerId, l]));

  // What a settlement would actually cover: unsettled, marked, priced, payable.
  // Same fallback the payroll lines above were priced with. Without it this
  // drops every session carried by the gym's standard fee, and the staff view
  // reports a trainer as owed money that the settle path would not pay.
  const settleable = sessionRows ? settleableSessions(sessionRows, opts.policy, now, fallback) : null;
  const settleableOf = new Map<string, PtSession[]>();
  for (const x of settleable ?? []) {
    const list = settleableOf.get(x.trainerId) ?? [];
    list.push(x);
    settleableOf.set(x.trainerId, list);
  }

  const activityOf = new Map((activityRows ?? []).map((a) => [a.clientId, a.events]));

  const known = new Set((trainerRows ?? []).map((t) => t.trainerId));

  const members = trainerRows
    ? trainerRows
        .map((t) => assess(t, {
          rec, now, windows, windowDays: opts.windowDays,
          sessions: sessionRows, shifts: shiftRows, clients: clientRows,
          classes: classRows, activityOf,
          line: lineOf.get(t.trainerId) ?? null,
          settleableRows: settleableOf.get(t.trainerId) ?? null,
          policy: opts.policy,
          gymCurrency: opts.gymCurrency,
          // The same fee those rows were ADMITTED on, carried through to the
          // function that prices them. Without it `settlementAmount` falls back
          // to its own `?? 0` for exactly the rows this fallback let in.
          fallbackRateCents: fallback,
        }))
        .sort(compareStaff)
    : null;

  // Money owed to somebody who is not on the roster. Only claimable when the
  // roster itself was read — without it every line looks off-roster.
  const offRoster = trainerRows && lines
    ? lines.filter((l) => !known.has(l.trainerId))
    : null;

  // The rates the gym-wide figures are sums of, restricted to the ROSTER for
  // the reason `rollupOf` states: the headline has to be about the rows printed
  // underneath it. Off-roster work has its own section and its own currency,
  // which `PayrollLine` already carries.
  //
  // Not folded up out of the members: a roster can straddle two currencies with
  // every individual coach on exactly one, and a fold over their verdicts would
  // see nothing wrong with adding those two together.
  const rosterRates = trainerRows && sessionRows
    ? ratesOf(sessionRows.filter((r) => known.has(r.trainerId)), opts.policy, fallback)
    : null;
  const rosterOutstandingRates = trainerRows && settleable
    ? ratesOf(settleable.filter((r) => known.has(r.trainerId)), opts.policy, fallback)
    : null;

  return {
    members,
    rollup: rollupOf(members, clientRows, sessionRows, classRows, {
      owed: rosterRates, outstanding: rosterOutstandingRates,
    }),
    offRoster,
    warning: staffWarning(rec),
    truncated: staffTruncationWarning(rec),
    caveat: caveatOf(members),
  };
}

/**
 * `settleCurrencyBlocker`, asked only the part it can honestly answer.
 *
 * `gymCurrency` undefined means the caller did not tell this module what
 * `tenants.currency` says. Passing that through would make every branch that
 * consults the gym's code announce "this gym has not set a currency", which is
 * a statement about the gym rather than about what this module was told — the
 * exact kind of invented fact the rest of this file exists to refuse.
 *
 * So with nothing stated only the mixed refusal stands, and it stands
 * unconditionally: `settleCurrencyBlocker` reaches that branch before it looks
 * at the gym's code at all, so no gym currency could rescue a run priced in two
 * moneys. The clash and the no-currency cases need the code and go unasked.
 */
function currencyBlocker(
  rows: PtSession[], gymCurrency: string | null | undefined,
): string | null {
  if (gymCurrency !== undefined) return settleCurrencyBlocker(rows, gymCurrency);
  const run = runCurrency(rows);
  return run.kind === 'mixed' ? settleCurrencyBlocker(rows, null) : null;
}

/* ── assessing one person ──────────────────────────────────────────────────── */

interface AssessInput {
  rec: StaffRecord;
  now: number;
  windows: DriftWindows;
  windowDays: number;
  sessions: PtSession[] | null;
  shifts: Shift[] | null;
  clients: StaffClient[] | null;
  classes: DemandBlock[] | null;
  activityOf: Map<string, ActivityEvent[]>;
  line: PayrollLine | null;
  settleableRows: PtSession[] | null;
  /** The same policy `payrollByTrainer` and `settleableSessions` were run with,
   *  so `ratesOf` below prices the same set of rows the figures came off. */
  policy: PayPolicy;
  /** `tenants.currency` as stated to `buildStaff`, or undefined when it was
   *  not stated. See `StaffOptions.gymCurrency`. */
  gymCurrency: string | null | undefined;
  /** The gym's standard session fee, for sessions with no rate of their own —
   *  the same value `settleableSessions` was filtered with above. */
  fallbackRateCents: number | null;
}

function assess(t: StaffTrainer, x: AssessInput): StaffMember {
  const { now, windowDays } = x;

  const sinceMs = t.since ? Date.parse(t.since) : NaN;
  const observedDays = Number.isFinite(sinceMs)
    ? Math.max(0, Math.floor((now - sinceMs) / DAY))
    : null;

  /* ── delivery ─────────────────────────────────────────────────────────── */

  const mine = x.sessions == null
    ? null
    : x.sessions.filter((s) => s.trainerId === t.trainerId && s.status === 'booked');

  let delivered: number | null = null;
  let noShows: number | null = null;
  let cancelled: number | null = null;
  let unmarked: number | null = null;
  let upcoming: number | null = null;
  let deliveredMin = 0;
  let unmarkedMin = 0;

  if (mine) {
    delivered = 0; noShows = 0; cancelled = 0; unmarked = 0; upcoming = 0;
    for (const sn of mine) {
      if (sn.outcome === 'completed') { delivered++; deliveredMin += sn.durationMin; }
      else if (sn.outcome === 'no_show') noShows++;
      else if (sn.outcome === 'cancelled' || sn.outcome === 'late_cancelled') cancelled++;
      else if (isAwaitingOutcome(sn, now)) { unmarked++; unmarkedMin += sn.durationMin; }
      // Booked, unmarked, and not finished yet. Nothing has happened, so it is
      // neither delivery nor an outcome anybody is late recording.
      else upcoming++;
    }
  }

  const sessions = mine ? mine.length : null;
  const marked = mine ? delivered! + noShows! + cancelled! : null;

  /* ── money ────────────────────────────────────────────────────────────── */

  const outstandingRows = x.sessions == null ? null : (x.settleableRows ?? []);
  const outstandingSessions = outstandingRows ? outstandingRows.length : null;
  const outstandingSum = outstandingRows && outstandingRows.length
    // Priced with the gym's fee, because that is what admitted these rows.
    //
    // This call was `settlementAmount(outstandingRows)`. `settleableSessions`
    // 98 lines up was given the fallback and therefore admits a session whose
    // `rate_cents` is null, and `settlementAmount`'s own `?? 0` — documented as
    // "genuinely unreachable for anything settleableSessions returned" — was
    // reachable for precisely those. A gym with a `session_fee` and no
    // per-trainer rates showed a coach's twelve delivered, unsettled sessions
    // as 0 payable beside their real earned figure, out of the same rows, and
    // the gym-wide "Payable now" KPI summed those noughts.
    ? settlementAmount(outstandingRows, x.fallbackRateCents)
    : null;

  // …and what money that is. `settlementAmount` adds `rate_cents` up and knows
  // nothing about `rate_currency`, so on a gym that changed its currency
  // mid-window the sum above is a total across two moneys. `verdictOn` refuses
  // it rather than letting the screen label it with `tenants.currency`.
  const outstandingRates = outstandingRows
    ? ratesOf(outstandingRows, x.policy, x.fallbackRateCents)
    : null;
  const outstanding = verdictOn(outstandingSum, outstandingRates);

  // The earned side, from the payroll line that produced the figure.
  // `payrollByTrainer` has already asked `runCurrency` about exactly the rates
  // it summed, so `currency` and `mixedCurrency` are read off the line rather
  // than recomputed here over a set assembled a second time. Only the sentence
  // has to be derived, and it is derived from the rows that line was built
  // from — every session of theirs, at whatever status, which is the set
  // `payrollByTrainer` was handed.
  const ownRows = x.sessions == null
    ? null
    : x.sessions.filter((r) => r.trainerId === t.trainerId);
  const owedCents = x.line == null ? null
    : x.line.mixedCurrency ? null
    : x.line.cents;
  const owedNote = ownRows ? totalNote(ratesOf(ownRows, x.policy, x.fallbackRateCents)) : null;

  // `settleBlocker` answers "is there anything to hand over, and is it safe" —
  // a different question from `settlementBlocker`, which asks whether a figure
  // on screen is final. Only asked when the sessions were actually read.
  //
  // Then the currency half, in the same order and through the same reader
  // /sessions and /payroll use. Without it this page called a run settleable
  // and quoted a figure for it while the settle path refused the very same
  // rows, and neither screen said why they differed.
  //
  // Asked of the SESSION ROWS, exactly as /sessions and /payroll ask it, and
  // deliberately not of `outstandingRates`. The two look at different things on
  // purpose: a fee-priced row has no rate of its own, so it is absent from
  // `settleCurrencyBlocker`'s pots and present in the rate set as 'unrecorded'.
  // That is why a run can be honest to settle — each row priced by the settle
  // path itself — while still having no single figure to print above it.
  const blocker = outstandingRows
    ? settleBlocker(outstandingRows, unmarked ?? 0)
      ?? (outstandingRows.length ? currencyBlocker(outstandingRows, x.gymCurrency) : null)
    : null;

  /* ── hours ────────────────────────────────────────────────────────────── */

  const theirShifts = x.shifts == null
    ? null
    : x.shifts.filter((sh) => sh.trainerId === t.trainerId);
  let rosteredHours: number | null = null;
  let pulledShifts: number | null = null;
  if (theirShifts) {
    pulledShifts = theirShifts.filter((sh) => !isLive(sh)).length;
    for (const sh of theirShifts) {
      if (!isLive(sh)) continue;
      const h = shiftHours(sh);
      if (h == null) continue;      // an unreadable span is not a shift of no length
      rosteredHours = (rosteredHours ?? 0) + h;
    }
    if (rosteredHours != null) rosteredHours = round1(rosteredHours);
  }

  // Null while nothing of theirs is marked: with no outcome recorded anywhere,
  // "0 hours delivered" is a claim the record cannot make.
  const deliveredHours = marked && marked > 0 ? round1(deliveredMin / HOUR_MIN) : null;
  const unmarkedHours = sessions ? round1(unmarkedMin / HOUR_MIN) : null;

  const classHours = x.classes == null
    ? null
    : round1(x.classes
        .filter((c) => c.kind === 'class' && c.trainerId === t.trainerId)
        .reduce((a, c) => a + c.durationMin, 0) / HOUR_MIN);

  const floorUse = deliveredHours != null && rosteredHours != null && rosteredHours > 0
    ? deliveredHours / rosteredHours
    : null;

  /* ── the book ─────────────────────────────────────────────────────────── */

  const theirClients = x.clients == null
    ? null
    : x.clients.filter((c) => c.trainerId === t.trainerId);
  const clients = theirClients ? theirClients.length : null;

  // Both halves or nothing. Drift over an unread activity table would report
  // every client as silent, which on this page reads as a trainer who has lost
  // their whole book.
  const book = theirClients && x.rec.activity.state === 'ready'
    ? sortByDrift(theirClients.map((c) => assessDrift(
        { clientId: c.clientId, events: x.activityOf.get(c.clientId) ?? [], since: c.since },
        now, x.windows,
      )))
    : null;
  const bands = summariseDrift(book);

  /* ── the verdict, or the refusal ──────────────────────────────────────── */

  const v = verdict({
    rec: x.rec, windowDays, name: t.name,
    clients, sessions, marked, delivered, unmarked, observedDays,
  });

  return {
    trainerId: t.trainerId,
    name: t.name,
    since: t.since,
    observedDays,

    clients,

    sessions, delivered, noShows, cancelled, unmarked, upcoming, marked,

    owedCents,
    owedCurrency: x.line?.currency ?? null,
    owedMixedCurrency: x.line?.mixedCurrency ?? false,
    owedNote,
    payable: x.line?.payable ?? null,
    priced: x.line?.priced ?? null,
    outstandingCents: outstanding.cents,
    outstandingSessions,
    outstandingCurrency: outstanding.currency,
    outstandingMixedCurrency: outstanding.mixed,
    outstandingNote: outstanding.note,
    settleBlocker: blocker,
    settleable: outstandingRows != null && outstandingRows.length > 0 && blocker == null,

    rosteredHours,
    shifts: theirShifts ? theirShifts.length : null,
    pulledShifts,
    deliveredHours,
    unmarkedHours,
    classHours,
    floorUse,
    hoursNote: hoursNote({ rosteredHours, deliveredHours, unmarkedHours, classHours, rec: x.rec }),

    book,
    drifting: bands?.drifting ?? null,
    watchClients: bands?.watch ?? null,
    unknownClients: bands?.unknown ?? null,
    steadyClients: bands?.steady ?? null,

    status: v.status,
    unknown: v.unknown,
    reason: v.reason,
  };
}

interface VerdictInput {
  rec: StaffRecord;
  windowDays: number;
  name: string | null;
  clients: number | null;
  sessions: number | null;
  marked: number | null;
  delivered: number | null;
  unmarked: number | null;
  observedDays: number | null;
}

/**
 * The evidence gate, and then `trainerHealth`.
 *
 * Nothing below invents a grade. Every branch that cannot demonstrate delivery
 * returns `idle` — UNKNOWN — with a sentence saying which kind of nothing it
 * is looking at. Only the last branch reaches ownerAnalytics, and it reaches it
 * with CONFIRMED sessions rather than bookings.
 */
function verdict(v: VerdictInput): { status: StatusLevel; unknown: boolean; reason: string } {
  const unknown = (reason: string) => ({ status: statusFromRisk('idle'), unknown: true, reason });

  // 1. The reads that would judge them. A verdict computed over a failed read is
  //    not a verdict; a verdict computed over a read still in flight is a guess
  //    that will be contradicted in a second.
  if (v.sessions == null) {
    return unknown(v.rec.sessions.state === 'failed'
      ? 'The one-to-ones could not be read, so there is no record of delivery to judge — this is unknown, not nil.'
      : 'Still reading the one-to-ones. Nothing is claimed about delivery yet.');
  }
  if (v.clients == null) {
    return unknown(v.rec.clients.state === 'failed'
      ? 'The client book could not be read, so how much this trainer is carrying is unknown — and a trainer with no clients reads very differently from one whose clients did not load.'
      : 'Still reading the client book.');
  }

  // 2. Nothing at all on record. Same fact `trainerHealth` calls idle, said in
  //    this page's words.
  if (v.clients === 0 && v.sessions === 0) {
    return unknown(`No client on their book and no one-to-one on record in the last ${v.windowDays} days. Nothing to assess — which is not the same as nothing wrong.`);
  }

  // 3. THE one this module exists for. Sessions ran and not one carries an
  //    outcome, so delivery is unknown in BOTH directions. `trainerHealth`
  //    would score these as sessions and call the trainer healthy; they are
  //    also exactly the sessions that stop their pay being computed.
  //
  //    Counted on the FINISHED sessions, not on every booked slot: a session
  //    next Tuesday is not one anybody is late marking.
  const finished = (v.marked ?? 0) + (v.unmarked ?? 0);
  if (v.marked === 0 && finished > 0) {
    return unknown(`${finished} one-to-one${s(finished)} finished and not one has an outcome recorded. There is no evidence of delivery either way, and no pay can be computed over ${finished === 1 ? 'it' : 'them'}.`);
  }

  // 4. Too new to have a record. A trainer who joined on Tuesday with three
  //    clients and nothing marked is not failing to deliver.
  if (v.marked === 0 && v.observedDays != null && v.observedDays < NEW_TRAINER_DAYS) {
    const d = v.observedDays;
    return unknown(`On the books ${d} day${s(d)} with nothing marked yet — too little record to say anything.`);
  }

  // 5. There is evidence. `trainerHealth` owns the judgement from here, and its
  //    reason is printed verbatim so this page and the Overview cannot be read
  //    as holding two opinions.
  //
  //    `sessions30` is fed the DELIVERED count, not the booked one. Its own
  //    doc-comment says the booked figure "is not the same as what was
  //    confirmed delivered — use `delivered30` for anything that costs money",
  //    and a staff page is entirely about what costs money. A trainer with
  //    twenty no-shows and nothing delivered comes back "clients but no
  //    sessions delivered in 30 days", which is the true and useful sentence.
  const like: TrainerLike = {
    id: '', name: v.name ?? '',
    clients: v.clients,
    sessions30: v.delivered ?? 0,
    delivered30: v.delivered ?? 0,
    unmarked30: v.unmarked ?? 0,
  };
  const h = trainerHealth(like);
  const status = statusFromRisk(h.risk);
  // trainerHealth's own idle branch (no clients, no delivered sessions) is an
  // absence of evidence too, and must not be allowed to read as a grade.
  return { status, unknown: status === 'idle', reason: h.reason };
}

function hoursNote(x: {
  rosteredHours: number | null;
  deliveredHours: number | null;
  unmarkedHours: number | null;
  classHours: number | null;
  rec: StaffRecord;
}): string | null {
  if (x.rosteredHours == null) {
    if (x.rec.shifts.state === 'failed') return 'The rota could not be read, so there is nothing to measure delivery against.';
    if (x.rec.shifts.state === 'loading') return null;
    return 'No live shift on the rota in this window, so there are no rostered hours to measure against — which is not the same as a trainer who worked none.';
  }
  if (x.deliveredHours == null) {
    return 'No outcome is recorded against any of their one-to-ones, so no hours can be counted as delivered.';
  }
  const missing: string[] = [];
  if (x.classHours != null && x.classHours > 0) {
    missing.push(`${x.classHours} class hour${s(x.classHours)} they are down to teach`);
  }
  if (x.classHours == null && x.rec.classes.state === 'failed') {
    missing.push('class hours, which could not be read at all');
  }
  if (x.unmarkedHours != null && x.unmarkedHours > 0) {
    missing.push(`${x.unmarkedHours} hour${s(x.unmarkedHours)} of one-to-ones nobody has marked`);
  }
  if (!missing.length) return null;
  return `Confirmed one-to-ones only — ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in that figure.`;
}

/* ── the gym-wide picture ──────────────────────────────────────────────────── */

function rollupOf(
  members: StaffMember[] | null,
  clientRows: StaffClient[] | null,
  sessionRows: PtSession[] | null,
  classRows: DemandBlock[] | null,
  /** The rates the two gym-wide figures are sums of, over the roster. */
  rates: { owed: RatedSession[] | null; outstanding: RatedSession[] | null },
): StaffRollup {
  if (!members) {
    return {
      trainers: null, atRisk: null, watch: null, onTrack: null, unknown: null,
      flagged: null, flaggedClients: null,
      clients: clientRows ? clientRows.length : null,
      unassignedClients: clientRows ? clientRows.filter((c) => !c.trainerId).length : null,
      delivered: null, noShows: null, unmarked: null,
      owedCents: null, owedCurrency: null, owedMixedCurrency: false, owedNote: null,
      outstandingCents: null, outstandingCurrency: null,
      outstandingMixedCurrency: false, outstandingNote: null,
      rosteredHours: null, deliveredHours: null, classHours: null,
    };
  }

  let atRisk = 0, watch = 0, onTrack = 0, unknown = 0, flaggedClients = 0;
  for (const m of members) {
    if (m.status === 'at_risk') atRisk++;
    else if (m.status === 'watch') watch++;
    else if (m.status === 'idle') unknown++;
    else onTrack++;
    if (m.status !== 'on_track') flaggedClients += m.clients ?? 0;
  }

  // Sums only where the underlying read succeeded. `sum` returns null the moment
  // any contributing figure is unknown, because a partial total on a payroll
  // page is worse than no total.
  const sum = (pick: (m: StaffMember) => number | null): number | null => {
    let total: number | null = null;
    for (const m of members) {
      const v = pick(m);
      if (v == null) continue;
      total = (total ?? 0) + v;
    }
    return total;
  };

  const deliveredHours = sum((m) => m.deliveredHours);
  const rosteredHours = sum((m) => m.rosteredHours);
  const classHours = sum((m) => m.classHours);

  // The two gym-wide money figures, each judged against the roster's own rates.
  //
  // `sum` skips a member whose figure was withheld for being mixed — and that
  // can never understate the headline, because a member can only be mixed if
  // the roster's rate set is too, and then the headline is withheld as well.
  // The case this DOES catch, which no fold over the member figures could, is
  // two coaches on one currency each and two different currencies between them:
  // every row printable, and their total an amount of nothing.
  //
  // Summed over the ROSTER, so the headline equals the rows underneath it.
  // Sessions run by somebody who is no longer on the roster are money too, and
  // they get their own section rather than swelling a total nothing on screen
  // adds up to — `offRoster`'s `PayrollLine`s carry their own currency.
  const owed = verdictOn(sum((m) => m.owedCents), rates.owed);
  const outstanding = verdictOn(sum((m) => m.outstandingCents), rates.outstanding);

  return {
    trainers: members.length,
    atRisk, watch, onTrack, unknown,
    flagged: atRisk + watch + unknown,
    flaggedClients,

    clients: clientRows ? clientRows.length : null,
    unassignedClients: clientRows ? clientRows.filter((c) => !c.trainerId).length : null,

    delivered: sessionRows ? sum((m) => m.delivered) : null,
    noShows: sessionRows ? sum((m) => m.noShows) : null,
    unmarked: sessionRows ? sum((m) => m.unmarked) : null,

    owedCents: owed.cents,
    owedCurrency: owed.currency,
    owedMixedCurrency: owed.mixed,
    owedNote: owed.note,
    outstandingCents: outstanding.cents,
    outstandingCurrency: outstanding.currency,
    outstandingMixedCurrency: outstanding.mixed,
    outstandingNote: outstanding.note,

    rosteredHours: rosteredHours == null ? null : round1(rosteredHours),
    deliveredHours: deliveredHours == null ? null : round1(deliveredHours),
    classHours: classRows == null || classHours == null ? null : round1(classHours),
  };
}

/**
 * The one line under the headline that says how much of the roster this page is
 * actually able to judge, or null when it can judge all of it.
 *
 * Deliberately separate from `staffWarning`, which names failed reads. This one
 * fires even when every read succeeded: a gym where nobody marks outcomes has a
 * complete, working staff page that cannot assess a single person, and that is
 * the finding rather than a footnote.
 */
export function caveatOf(members: StaffMember[] | null): string | null {
  if (!members || !members.length) return null;
  const unknown = members.filter((m) => m.unknown);
  if (!unknown.length) return null;
  if (unknown.length === members.length) {
    return `Not one of the ${members.length} people on this roster can be assessed from the record as it stands. Every row below says which kind of nothing it is looking at; none of them is a clean bill of health.`;
  }
  const names = unknown.map((m) => m.name ?? 'an unnamed account');
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${unknown.length} of ${members.length} cannot be assessed: ${list}. They are shown as Unknown, which is not a grade and is not the same as fine.`;
}
