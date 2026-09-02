// Taking the gym's whole record out of Repple.
//
// The sibling of src/lib/gdpr.ts. That one answers "give me everything you hold
// about *me*" for one member; this one answers "give me everything you hold
// about *my gym*" for the owner. Same promise, opposite end of the tenant.
//
// ── Why this is worth building carefully ──────────────────────────────────
//
// An export is a promise, and a partial one is a broken promise. A gym that
// downloads a folder of files, finds all but one of them, and does not notice
// which one is missing has been told something false: that this is their
// record. Months later they cancel, delete the account, and discover the door
// log was never in the bundle. So the single rule this module is built around:
//
//   A read that FAILED never produces an empty CSV.
//
// An empty payments.csv is a claim — "this gym took no money" — and it is the
// one claim a failed query must never be allowed to make. A failed part emits a
// plainly-named `…-NOT-EXPORTED.txt` instead, every filename in the bundle
// gains INCOMPLETE, the manifest carries `"complete": false`, and the README
// opens with what is missing and what that costs. Four independent signals,
// because the gym only has to miss one.
//
// ── And the same rule pointed at the period ──────────────────────────────
//
// A bundle taken over a PERIOD has the identical failure available to it, one
// level up: the same filenames, the same README, and one quarter of the record
// inside. Missing rows that were never asked for do not look missing. So the
// window is not a filter this module applies and forgets — it is applied HERE,
// from the window on the input, so that what the bundle says about its bounds
// is true of its contents by construction, and it is then stated in the
// filename, in the manifest, at the top of the README, and per part.
//
// Per part, because a window does not narrow all of them and the exceptions
// matter: a membership is a period rather than an instant, an agreement is the
// wording a later signature points at, and the price book has no event date at
// all. `EXPORT_DATE_FIELD` names the column each part is bounded by, or null
// with a stated reason, and the README prints both lists. See exportWindow.ts.
//
// ── The other three rules ────────────────────────────────────────────────
//
// * **Stored, not derived.** Money leaves as the integer minor units it is
//   held in (`amount_cents`), and only *additionally* as an exact two-decimal
//   string for the columns the importer reads. 4500 -> "45.00" is a lossless
//   rewriting of an integer, computed with string arithmetic rather than
//   `/100`, so no float ever touches the ledger. Nothing here rounds, and
//   nothing clamps: `uses_left` is absent because `remainingUses` floors at
//   zero, and a pass counter that is out of step is evidence.
//
// * **A null survives as empty.** Not `0`, not `"null"`, not `"-"`. A member
//   with no recorded weight must not export as weighing nothing, and a pass
//   with no recorded price must not export as free. Empty means "the gym never
//   recorded this"; it is the only honest cell.
//
// * **The CSV must survive real names.** O'Brien, "Bob" Smith, Smith, Jr., and
//   a note field with a line break in it. Get the quoting wrong and every
//   column after the offending one shifts, silently, forever. `csvCell` quotes
//   on every delimiter src/lib/csv.ts is willing to sniff — not just the comma
//   — so a semicolon in a note cannot turn into a column break for whoever
//   opens the file in a comma-decimal locale.
//
// Pure and framework-free, further even than gymRecord.ts: the only runtime
// import in this file is exportWindow.ts, which is pure by the same rule and
// touches nothing — no Supabase, no browser, no clock. Everything below
// takes rows that some screen has already loaded and returns text. That is
// deliberate — the *reads* are where the failure modes live, and a screen has
// to render its own failures. This module's job is to refuse to paper over them.

import type { MembershipPlan, Membership, GymPayment } from './gymRecord';
import type { GymClass } from './gymSchedule';
import type { PtSession } from './gymSessions';
import type { PassType, GymPass } from './gymPasses';
import type { Visit } from './gymVisits';
import type { MemberInvite } from './memberInvites';
import type { Slice, MemberBooking } from './memberView';
import type { SignatureAttribution } from './gymSigning';
// The window's arithmetic and its prose. A `import type` for the shape and
// named functions for the rest — this stays the one file in the export path
// with no runtime import of a MODULE THAT TOUCHES ANYTHING, and exportWindow.ts
// is pure by the same rule, so the promise at the top of this header is intact.
import {
  type ExportWindow, isBounded, placeInWindow, windowSlug, describeWindow,
} from './exportWindow';

// Re-exported so a caller building a GymExportInput — a screen, or a test —
// can name every row type from here rather than importing six modules to do it.
// Types only: none of these lines adds a runtime import.
export type { ExportWindow } from './exportWindow';
export type { SignatureAttribution } from './gymSigning';
export type { MembershipPlan, Membership, GymPayment } from './gymRecord';
export type { GymClass } from './gymSchedule';
export type { PtSession } from './gymSessions';
export type { PassType, GymPass } from './gymPasses';
export type { Visit } from './gymVisits';
export type { MemberInvite } from './memberInvites';
export type { Slice, MemberBooking } from './memberView';

/* ── CSV writing ───────────────────────────────────────────────────────────── */

/** What a cell may hold before it is written. `null`/`undefined` mean "never
 *  recorded", and are the only things that become empty. */
export type Cell = string | number | boolean | null | undefined;

/**
 * Everything that must force a field to be quoted.
 *
 * Wider than RFC 4180 on purpose. The RFC only requires quoting for the
 * delimiter, the quote and CR/LF, but `sniffDelimiter` in src/lib/csv.ts will
 * happily decide a file is semicolon- or tab-separated, and a spreadsheet in a
 * comma-decimal locale does the same. A note reading `Paid cash; owes 20` must
 * not become two columns for the next reader, so every candidate delimiter is
 * treated as unsafe. Over-quoting is always legal; under-quoting is silent
 * corruption.
 */
const NEEDS_QUOTES = /["\u002C\r\n;\t|]/;

/**
 * One cell, escaped.
 *
 * A quote inside a quoted field is doubled — `"Bob" Smith` becomes
 * `"""Bob"" Smith"` — which is what src/lib/csv.ts reads back. Leading or
 * trailing whitespace is preserved by quoting it, because a name somebody
 * typed with a trailing space is still the name in their record and a
 * round-trip that trims it has changed the data.
 */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    // NaN and Infinity are not figures. They are a bug upstream, and writing
    // "NaN" into a money column would launder one into the gym's record.
    if (!Number.isFinite(v)) return '';
    return String(v);
  }
  const s = String(v);
  if (s === '') return '';
  if (NEEDS_QUOTES.test(s) || s !== s.trim()) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** One row, already escaped, without its line ending. */
export function csvRow(cells: Cell[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * A whole sheet.
 *
 * CRLF line endings and a UTF-8 BOM, which is what Excel needs to open
 * `Ahmed Al-Naïm` as a name rather than as mojibake. Both are safe on the way
 * back in: `parseCsv` strips a leading BOM and treats CRLF and LF alike, so a
 * file written here re-imports through `previewMembers` unchanged.
 */
export function toCsv(header: string[], rows: Cell[][], bom = true): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return (bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}

/* ── values ────────────────────────────────────────────────────────────────── */

/**
 * Integer minor units as an exact decimal string, or '' for "never recorded".
 *
 * Deliberately string arithmetic. `(cents / 100).toFixed(2)` is a float
 * division and this is a ledger; the answer here is the same digits the
 * database holds with a point pushed two places left, which is a text
 * operation, not a numeric one.
 *
 * Null is empty rather than "0.00" — a pass with no recorded price is not a
 * free pass, and that distinction is the whole reason `paidCents` is nullable.
 */
export function minorToDecimal(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) return '';
  const neg = cents < 0;
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2);
  return (neg ? '-' : '') + whole + '.' + frac;
}

/**
 * The date part of a stored timestamp, for the columns the CSV importer reads.
 *
 * `previewPayments` accepts `2026-08-26` and refuses `2026-08-26T09:14:00Z`, so
 * a date-only column has to exist for the round trip to work. It sits *beside*
 * the full `taken_at`, never instead of it: the timestamp is the stored value
 * and stays in the file exactly as held.
 *
 * Anything that is not recognisably ISO comes back empty rather than guessed.
 */
export function isoDatePart(ts: string | null | undefined): string {
  if (!ts) return '';
  return /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : '';
}

/** A gym's name reduced to something safe in a filename. Empty names give ''. */
export function slug(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/* ── the parts of the record ───────────────────────────────────────────────── */

/**
 * ── The eight parts this bundle used to leave behind ──────────────────────
 *
 * The list below was eleven entities, and a gym leaving on it took no record of
 * what it had INVOICED, what it had PAID ITS STAFF, what it OWNS, who was
 * ROSTERED, who it had CONTACTED about drifting away, what it had DISCOUNTED,
 * what had HAPPENED in the building, or what its coaches had SOLD.
 *
 * Every one of those is a thing a gym is asked for after it leaves. The
 * invoices and the settlements are the two an accountant asks for first and the
 * two with a statutory retention period attached; the equipment register is
 * what an insurer asks for; `member_interventions` is the only record that
 * anybody was ever contacted, which is the one a member disputing a cancellation
 * asks about. An export that quietly omitted all eight was not the gym's
 * record — it was the parts of the record the first version of this file
 * happened to cover.
 *
 * They are declared here as narrow row shapes rather than imported from the
 * modules that read them, deliberately: `gym_shifts`, `promos` and
 * `member_interventions` belong to other parts of this codebase, and an export
 * that breaks when one of them changes a field name is an export nobody can
 * rely on at exactly the moment they need it.
 *
 * ── And the four this one left behind ─────────────────────────────────────
 *
 * The list still had no PAPERWORK in it, which is the thing a gym is asked to
 * produce first and most often. A gym told "show us what she signed" could
 * export nineteen files and not one of them held a waiver, a signature, a
 * consent, or the index of the filing cabinet — and the one-member bundle, the
 * bundle produced for a subject-access request, did not carry the member's own
 * record either: no contact details, no next of kin, no medical note, none of
 * what the desk had written about them.
 *
 *   memberRecords  `gym_member_records`. The member's own file, which is the
 *                  one thing a subject-access response cannot be missing.
 *   agreements     `gym_agreements`. The WORDING of each version, because a
 *                  signature naming version 2 is unreadable without it.
 *   signatures     `gym_agreement_signatures`, attribution and all — see the
 *                  note on `ExportSignature` for why that column is the point.
 *   documents      `gym_documents`. The INDEX of the filing cabinet. The files
 *                  themselves are bytes in a bucket and cannot travel in a CSV;
 *                  the table says so in its own note rather than leaving a
 *                  reader to assume the export contained them.
 */
export type ExportPart =
  | 'plans'
  | 'members'
  | 'memberRecords'
  | 'memberships'
  | 'payments'
  | 'invoices'
  | 'classes'
  | 'attendance'
  | 'sessions'
  | 'passTypes'
  | 'passes'
  | 'visits'
  | 'invites'
  | 'settlements'
  | 'equipment'
  | 'shifts'
  | 'interventions'
  | 'promos'
  | 'events'
  | 'purchases'
  | 'agreements'
  | 'signatures'
  | 'documents';

export const EXPORT_PARTS: ExportPart[] = [
  'plans', 'members', 'memberRecords', 'memberships', 'payments', 'invoices',
  'classes', 'attendance', 'sessions',
  'passTypes', 'passes', 'visits', 'invites',
  'settlements', 'equipment', 'shifts',
  'interventions', 'promos', 'events', 'purchases',
  'agreements', 'signatures', 'documents',
];

/* ── the rows the eight new parts are made of ──────────────────────────────── */

/** One row of `gym_invoices`. Nullable throughout: an invoice with no amount is
 *  money of unknown size and must export as a blank, never as a zero. */
export interface ExportInvoice {
  id: string; number: number | null; memberId: string | null; memberName: string | null;
  amountCents: number | null; currency: string | null;
  issuedOn: string; dueOn: string | null; status: string | null; note: string | null;
}

/** One row of `payroll_settlements` — money that left the account. */
export interface ExportSettlement {
  id: string; trainerId: string | null; trainerName: string | null;
  periodFrom: string | null; periodTo: string | null;
  amountCents: number | null; currency: string | null;
  sessionsCount: number | null; method: string | null; settledAt: string;
  reversedAt: string | null; reverseReason: string | null;
}

/** One row of `gym_equipment`. */
export interface ExportEquipment {
  id: string; name: string; category: string | null; identifier: string | null;
  quantity: number | null; status: string | null; purchasedOn: string | null;
  serviceIntervalDays: number | null; lastServicedOn: string | null; note: string | null;
}

/** One row of `gym_shifts` — who was rostered, and whether they worked it. */
export interface ExportShift {
  id: string; trainerId: string | null; trainerName: string | null;
  startsAt: string | null; endsAt: string | null; role: string | null;
  status: string | null; note: string | null;
}

/**
 * One row of `member_interventions` — the record that somebody was contacted.
 *
 * `by_name` is exported beside `by_id` and not instead of it. The column exists
 * for exactly this moment: `by_id` is `on delete set null`, so once the trainer
 * who made the call has left, the id is a dead uuid and the name written down at
 * the time is the only thing that answers "has anybody already spoken to her?".
 *
 * There is deliberately no follow-up column. What followed a contact is
 * COMPUTED in src/lib/interventions.ts from the member's training either side of
 * it — it is not stored, it changes as more training is recorded, and exporting
 * a snapshot of it as though it were a field would put a judgement into the
 * record dressed as a fact.
 */
export interface ExportIntervention {
  id: string; memberId: string | null; memberName: string | null;
  channel: string | null; outcome: string | null;
  byId: string | null; byName: string | null;
  note: string | null; at: string | null;
}

/** One row of `promos`. */
export interface ExportPromo {
  id: string; code: string | null; discount: number | null;
  active: boolean | null; redemptions: number | null; createdAt: string | null;
}

/** One row of `gym_events` — the trigger-written activity log. */
export interface ExportEvent {
  id: string; kind: string | null; summary: string | null;
  subjectId: string | null; actorId: string | null; at: string;
}

/** One row of `client_purchases` — a coach's own checkout trail, scoped to this
 *  gym's roster. It carries no tenant column, so the scoping is done by the
 *  caller and stated in the file's note. */
export interface ExportPurchase {
  id: string; trainerId: string | null; trainerName: string | null;
  clientId: string | null; amountCents: number | null; currency: string | null;
  sessionsTotal: number | null; sessionsUsed: number | null;
  status: string | null; createdAt: string | null;
}

/* ── the four the paperwork is made of ─────────────────────────────────────── */

/**
 * One row of `gym_member_records` — what the gym itself knows about a person.
 *
 * Contact, next of kin, the operational medical note and the desk's own note.
 * The single most personal table in the tenant, and the one a subject-access
 * response is least able to be missing: everything else in a member bundle is
 * about what they DID, and this is about who they are.
 *
 * `medicalNote` is the gym's operational note — what the desk was told, for the
 * people standing on the floor. It is not the member's own injuries, which are
 * theirs and are exported from their own account by src/lib/gdpr.ts.
 */
export interface ExportMemberRecord {
  memberId: string; memberName: string | null;
  phone: string | null; email: string | null;
  emergencyName: string | null; emergencyPhone: string | null;
  medicalNote: string | null; note: string | null;
  tags: string[]; updatedAt: string | null;
}

/**
 * One version of one thing the gym asks people to agree to, WORDING AND ALL.
 *
 * The body travels. A signature row says "version 2 of the liability waiver",
 * and without the text of version 2 that is a reference to a document the
 * bundle does not contain — which is precisely the position the gym was in
 * before any of this was exported at all. `gym_agreements.body` is immutable
 * once signed (supabase/parts/185), so the row here is the wording as it stood
 * when it was agreed to, not as it stands today.
 */
export interface ExportAgreement {
  id: string; kind: string; title: string; body: string;
  version: number | null; active: boolean | null; required: boolean | null;
  createdAt: string | null;
}

/**
 * One signature — and the answer to who actually gave it.
 *
 * ── Why `attribution` is the column this row exists for ───────────────────
 *
 * Until supabase/parts/520 landed, every signature this product held was a
 * member of staff typing the member's name into a box at the desk, and every
 * screen called it "signed". The row could not tell the two apart. It now
 * carries `signed_by` (the account whose session wrote it, from `auth.uid()`,
 * never from anything a caller sends) and `attribution`:
 *
 *   member   the member's own signed-in session wrote it. The strong form.
 *   staff    somebody at the desk recorded it on their behalf. A real business
 *            record — a staff attestation — but not the member's own act.
 *   unknown  written before this was recorded. Not a synonym for staff: no row
 *            is relabelled by guesswork.
 *
 * An export that showed a signature WITHOUT saying which of those three it was
 * would be worse than no export: it would hand a gym a file that reads as
 * evidence of the strong form for rows that are the weak one, and the file
 * would then be produced in a dispute. So `attribution` is exported beside a
 * plain-English column saying what it means — see `signaturesTable`.
 */
export interface ExportSignature {
  id: string; agreementId: string;
  agreementKind: string | null; agreementTitle: string | null;
  memberId: string | null; memberName: string | null;
  signedName: string; signedAt: string; versionSigned: number | null;
  attribution: SignatureAttribution;
  signedById: string | null; signedByName: string | null;
  witnessedById: string | null; witnessedByName: string | null;
  guardianName: string | null; guardianRelationship: string | null;
  note: string | null;
}

/**
 * One row of `gym_documents` — the index in front of the `gym-docs` bucket.
 *
 * `storagePath` is exported and the FILE IS NOT. A CSV bundle cannot carry a
 * 25 MB scan, and a filing-cabinet index that did not say so would be read as
 * "the gym holds no documents" by whoever opened a bundle expecting the
 * contracts to be in it. The path is what makes each one findable afterwards.
 * It is an object key, not a URL and not a credential: reading the object still
 * requires a session that supabase/parts/390 permits.
 */
export interface ExportDocument {
  id: string; memberId: string | null; memberAttached: boolean | null;
  equipmentId: string | null; kind: string; title: string;
  storagePath: string; mime: string | null; sizeBytes: number | null;
  expiresOn: string | null; note: string | null;
  uploadedById: string | null; uploadedByName: string | null; uploadedAt: string;
}

/** What each part is called in a sentence an owner reads. */
export const EXPORT_LABEL: Record<ExportPart, string> = {
  plans: 'the price book',
  members: 'the member roster',
  memberRecords: 'the gym’s own file on each member',
  memberships: 'memberships',
  payments: 'payments',
  invoices: 'the invoice register',
  classes: 'the timetable',
  attendance: 'class attendance',
  sessions: 'one-to-ones',
  passTypes: 'pass types',
  passes: 'passes issued',
  visits: 'the door log',
  invites: 'invites',
  settlements: 'payroll settlements',
  equipment: 'the equipment register',
  shifts: 'the rota',
  interventions: 'member contact',
  promos: 'promo codes',
  events: 'the activity log',
  purchases: 'PT packs sold',
  agreements: 'the documents people are asked to sign',
  signatures: 'signatures',
  documents: 'the filing cabinet',
};

/** What leaving a part out of the bundle actually costs. Named so the warning
 *  says what the gym is *not taking with them*, not just what errored. */
export const EXPORT_COST: Record<ExportPart, string> = {
  plans: 'what the gym sells and for how much',
  members: 'who the members are',
  memberRecords: 'contact numbers, next of kin, the medical note and what the desk wrote about each member',
  memberships: 'who holds what plan, since when, and in what state',
  payments: 'every payment the gym has recorded',
  invoices: 'what the gym billed, to whom, and what is still owed on it',
  classes: 'what was on the timetable',
  attendance: 'who booked a class and who turned up',
  sessions: 'one-to-ones delivered and what they were worth',
  passTypes: 'what a drop-in, guest pass or class pack costs',
  passes: 'passes sold and the visits still owed on them',
  visits: 'who came through the door and when',
  invites: 'who was invited and whether they joined',
  settlements: 'what the gym actually paid its staff, and when',
  equipment: 'what the gym owns and what is due a service',
  shifts: 'who was rostered on the floor and when',
  interventions: 'the record that anybody was ever contacted about leaving',
  promos: 'what was discounted and how often it was used',
  events: 'what happened in the building, as the database recorded it',
  purchases: 'what the coaches sold through their own checkout',
  agreements: 'the wording of every waiver, consent and set of terms, as each version stood',
  signatures: 'who signed what, when, and whether they signed it themselves',
  documents: 'what is in the filing cabinet — the contracts, insurance, certificates and incident reports the gym holds',
};

/** The basename each part writes to, before the bundle prefix. */
export const EXPORT_FILE: Record<ExportPart, string> = {
  plans: 'plans.csv',
  members: 'members.csv',
  memberRecords: 'member-records.csv',
  memberships: 'memberships.csv',
  payments: 'payments.csv',
  invoices: 'invoices.csv',
  classes: 'classes.csv',
  attendance: 'attendance.csv',
  sessions: 'sessions.csv',
  passTypes: 'pass-types.csv',
  passes: 'passes.csv',
  visits: 'door-log.csv',
  invites: 'invites.csv',
  settlements: 'payroll-settlements.csv',
  equipment: 'equipment.csv',
  shifts: 'rota.csv',
  interventions: 'member-contact.csv',
  promos: 'promos.csv',
  events: 'activity-log.csv',
  purchases: 'pt-packs.csv',
  agreements: 'agreements.csv',
  signatures: 'signatures.csv',
  documents: 'documents.csv',
};

/* ── what a period does and does not narrow ────────────────────────────────── */

/**
 * The stored column each part is bounded by when an export is taken over a
 * period, or null for a part a period does not narrow at all.
 *
 * Named as the COLUMN rather than as a boolean, because "bounded" on its own is
 * ambiguous in the one direction that matters. `passes` is bounded by
 * `issued_on`: a pass sold inside the quarter is here and a pass sold before it
 * is not, EVEN IF it was still being used all through the quarter. That is a
 * defensible reading of "passes in this period" and it is not the only one, so
 * the file says which one it used rather than leaving an auditor to assume.
 *
 * The nulls are the load-bearing half of this table. See
 * `EXPORT_UNBOUNDED_WHY` — every one of them has a reason that is about the
 * shape of the data, not about the read being awkward to filter.
 */
export const EXPORT_DATE_FIELD: Record<ExportPart, string | null> = {
  plans: null,
  members: null,
  memberRecords: null,
  memberships: null,
  payments: 'taken_at',
  invoices: 'issued_on',
  classes: 'starts_at',
  attendance: 'class_starts_at',
  sessions: 'starts_at',
  passTypes: null,
  passes: 'issued_on',
  visits: 'entered_at',
  invites: 'created_at',
  settlements: 'settled_at',
  equipment: null,
  shifts: 'starts_at',
  interventions: 'at',
  promos: null,
  events: 'at',
  purchases: 'created_at',
  agreements: null,
  signatures: 'signed_at',
  documents: 'uploaded_at',
};

/**
 * Why a period leaves a part whole, in the words the README prints.
 *
 * A reader who asked for one quarter and got the whole equipment register is
 * entitled to know whether that was a decision or a bug. Each of these is a
 * decision, and four of the seven would produce a WRONG file if they were
 * bounded — which is the opposite of what somebody would guess.
 */
export const EXPORT_UNBOUNDED_WHY: Partial<Record<ExportPart, string>> = {
  plans: 'a standing price list, with no event date to bound it by.',
  members: 'one row per person, derived from the memberships below it.',
  memberRecords: 'a standing file on each person, not a dated event.',
  memberships:
    'a membership is a PERIOD, not an instant. One that ran all the way through your window may have started years before it, and bounding on its start date would drop exactly the memberships the window is about.',
  passTypes: 'a standing list of what a pass costs.',
  equipment: 'a standing register of what the gym owns.',
  promos: 'a standing list of codes.',
  agreements:
    'the WORDING each signature points at. Bounding these to your window would leave a signature from inside it naming a version of the waiver that is not in the bundle, which is the position this file exists to get a gym out of.',
};

/* ── what goes in ──────────────────────────────────────────────────────────── */

/**
 * Every read the export needs, each with its own three states.
 *
 * There is no `members` slice: the roster is derived from `memberships` (and
 * from `invites` for the addresses), so it can only ever be as available as
 * they are. That dependency is why `partSlice` exists rather than an index.
 */
export interface GymExportInput {
  gymName: string | null;
  tenantId: string | null;
  /** ISO instant the export was taken. Passed in so the output is testable. */
  generatedAt: string;
  /**
   * The period this export covers. Null on both sides is the whole record.
   *
   * `buildGymExport` APPLIES these rather than merely reporting them, so a
   * bundle cannot state a window its rows fall outside. Which parts they
   * actually narrow is `EXPORT_DATE_FIELD`, and the bundle prints both lists.
   */
  from?: string | null;
  to?: string | null;
  /**
   * Set when this bundle is ONE MEMBER's record rather than the gym's.
   *
   * It changes the filename, the manifest and the README, and it has to: a
   * subject-access response and a whole-gym backup are the same eleven CSVs
   * with completely different meanings, and a bundle that could not say which
   * it was would eventually be sent as the wrong one.
   */
  subject?: { memberId: string; memberName: string | null } | null;

  plans: Slice<MembershipPlan>;
  memberships: Slice<Membership>;
  payments: Slice<GymPayment>;
  classes: Slice<GymClass>;
  attendance: Slice<MemberBooking>;
  sessions: Slice<PtSession>;
  passTypes: Slice<PassType>;
  passes: Slice<GymPass>;
  visits: Slice<Visit>;
  invites: Slice<MemberInvite>;
  invoices: Slice<ExportInvoice>;
  settlements: Slice<ExportSettlement>;
  equipment: Slice<ExportEquipment>;
  shifts: Slice<ExportShift>;
  interventions: Slice<ExportIntervention>;
  promos: Slice<ExportPromo>;
  events: Slice<ExportEvent>;
  purchases: Slice<ExportPurchase>;
  memberRecords: Slice<ExportMemberRecord>;
  agreements: Slice<ExportAgreement>;
  signatures: Slice<ExportSignature>;
  documents: Slice<ExportDocument>;
}

/** The slice a part is read from. `members` rides on `memberships`. */
export function partSlice(input: GymExportInput, part: ExportPart): Slice<unknown> {
  switch (part) {
    case 'plans': return input.plans;
    case 'members': return input.memberships;
    case 'memberships': return input.memberships;
    case 'payments': return input.payments;
    case 'classes': return input.classes;
    case 'attendance': return input.attendance;
    case 'sessions': return input.sessions;
    case 'passTypes': return input.passTypes;
    case 'passes': return input.passes;
    case 'visits': return input.visits;
    case 'invites': return input.invites;
    case 'invoices': return input.invoices;
    case 'settlements': return input.settlements;
    case 'equipment': return input.equipment;
    case 'shifts': return input.shifts;
    case 'interventions': return input.interventions;
    case 'promos': return input.promos;
    case 'events': return input.events;
    case 'purchases': return input.purchases;
    // The roster rides on `memberships`; the gym's own FILE on each member is
    // its own table and its own read, so it fails on its own too.
    case 'memberRecords': return input.memberRecords;
    case 'agreements': return input.agreements;
    case 'signatures': return input.signatures;
    case 'documents': return input.documents;
  }
}

/* ── narrowing to a period ─────────────────────────────────────────────────── */

/**
 * The date one row is placed by, or null when the part is not bounded at all.
 *
 * One switch rather than a date accessor on each row shape, so that
 * `EXPORT_DATE_FIELD` and the value actually read cannot drift apart: adding a
 * part to the record without answering "what dates it" fails to compile here.
 */
export function rowDate(part: ExportPart, row: unknown): string | null {
  const r = row as Record<string, unknown>;
  const str = (k: string): string | null => {
    const v = r?.[k];
    return typeof v === 'string' && v.trim() ? v : null;
  };
  switch (part) {
    case 'plans': case 'members': case 'memberRecords': case 'memberships':
    case 'passTypes': case 'equipment': case 'promos': case 'agreements':
      return null;
    case 'payments': return str('takenAt');
    case 'invoices': return str('issuedOn');
    case 'classes': return str('startsAt');
    case 'attendance': return str('startsAt');
    case 'sessions': return str('startsAt');
    case 'passes': return str('issuedOn');
    case 'visits': return str('enteredAt');
    case 'invites': return str('createdAt');
    case 'settlements': return str('settledAt');
    case 'shifts': return str('startsAt');
    case 'interventions': return str('at');
    case 'events': return str('at');
    case 'purchases': return str('createdAt');
    case 'signatures': return str('signedAt');
    case 'documents': return str('uploadedAt');
  }
}

/**
 * Every dated part narrowed to the window, and every other part untouched.
 *
 * A row that could not be PLACED is kept, deliberately, and counted separately
 * so the bundle can say how many there were. Dropping it would assert that it
 * happened outside the period, and nothing here knows that — see the header on
 * exportWindow.ts. A part that did not read stays unread: a failed query is
 * still a failed query when somebody asks for three months of it.
 */
export function windowSlices(input: GymExportInput, w: ExportWindow): GymExportInput {
  if (!isBounded(w)) return { ...input, from: w.from, to: w.to };
  const cut = <T>(part: ExportPart, s: Slice<T>): Slice<T> => {
    if (s.state !== 'ready' || !EXPORT_DATE_FIELD[part]) return s;
    return { state: 'ready', rows: s.rows.filter((r) => placeInWindow(rowDate(part, r), w) !== 'outside') };
  };
  return {
    ...input,
    from: w.from,
    to: w.to,
    payments: cut('payments', input.payments),
    invoices: cut('invoices', input.invoices),
    classes: cut('classes', input.classes),
    attendance: cut('attendance', input.attendance),
    sessions: cut('sessions', input.sessions),
    passes: cut('passes', input.passes),
    visits: cut('visits', input.visits),
    invites: cut('invites', input.invites),
    settlements: cut('settlements', input.settlements),
    shifts: cut('shifts', input.shifts),
    interventions: cut('interventions', input.interventions),
    events: cut('events', input.events),
    purchases: cut('purchases', input.purchases),
    signatures: cut('signatures', input.signatures),
    documents: cut('documents', input.documents),
  };
}

/** How many rows of a part carry no date to place them by. Null when the part
 *  is unbounded or unread — which is not the same as none. */
export function undatedRows(input: GymExportInput, part: ExportPart): number | null {
  const s = partSlice(input, part);
  if (s.state !== 'ready' || !EXPORT_DATE_FIELD[part]) return null;
  return s.rows.filter((r) => rowDate(part, r) === null).length;
}

/* ── what comes out ────────────────────────────────────────────────────────── */

export interface ExportFile {
  name: string;
  mime: string;
  text: string;
  /** Data rows, excluding the header. Null for files that are not tables. */
  rows: number | null;
  part: ExportPart | null;
  /** True for the stub written in place of a part that could not be read. */
  placeholder: boolean;
}

export interface MissingPart {
  part: ExportPart;
  label: string;
  cost: string;
  reason: string;
  /** The stub written where the CSV should have been. */
  file: string;
}

/**
 * What the period did to one part.
 *
 * `bounded: false` on a bundle that HAS a period is the interesting case and
 * the reason this is a per-part field rather than one line at the top: it means
 * this file is whole while its neighbours are slices, and a reader summing
 * across the two without knowing that gets a number nobody can defend.
 */
export interface ExportPartWindow {
  /** True when the period narrowed this file. False on an unbounded export too
   *  — nothing was narrowed, so nothing was bounded. */
  bounded: boolean;
  /** The stored column it was narrowed by, or null. */
  field: string | null;
  /** Why the period left this one whole. Null when it narrowed it, and null on
   *  an unbounded bundle where the question does not arise. */
  why: string | null;
  /** Rows carrying no date to place them by, which are kept. Null when the
   *  question does not apply — never 0, which would say there were none. */
  undated: number | null;
}

export interface ExportPartReport {
  part: ExportPart;
  label: string;
  file: string;
  status: 'exported' | 'unavailable';
  rows: number | null;
  reason: string | null;
  columns: string[] | null;
  note: string | null;
  window: ExportPartWindow;
}

/** The window statement for one part. */
export function partWindow(
  part: ExportPart, bounded: boolean, undated: number | null,
): ExportPartWindow {
  const field = EXPORT_DATE_FIELD[part];
  if (!bounded) return { bounded: false, field, why: null, undated: null };
  return field
    ? { bounded: true, field, why: null, undated }
    : { bounded: false, field: null, why: EXPORT_UNBOUNDED_WHY[part] ?? 'no event date to bound it by.', undated: null };
}

export interface ExportManifest {
  app: 'Repple';
  /** Which of the two bundles this is. They are the same CSVs with entirely
   *  different meanings, and a file that could not say which would eventually
   *  be sent as the wrong one. */
  kind: 'gym-record-export' | 'member-record-export';
  /** Who a member export is about. Null on a whole-gym bundle. */
  subject: { memberId: string; memberName: string | null } | null;
  formatVersion: 1;
  gym: string | null;
  tenantId: string | null;
  exportedAt: string;
  /** The period, and a sentence saying it. `bounded` is the field to read: null
   *  on both sides is the whole record, which is a different claim from a very
   *  wide window and used to be indistinguishable from one. */
  window: { from: string | null; to: string | null; bounded: boolean; covers: string };
  /** False if a single part could not be read. Never true on a hopeful guess.
   *  Says nothing about the period — see `wholeRecord`. */
  complete: boolean;
  /** True only when every part was read AND no period was applied. The claim
   *  "this is the gym's record"; `complete` is only ever the weaker one. */
  wholeRecord: boolean;
  warning: string | null;
  parts: ExportPartReport[];
  caveats: string[];
  conventions: Record<string, string>;
}

export interface GymExportBundle {
  complete: boolean;
  /** Parts still in flight. An export must not be taken while any stand. */
  pending: ExportPart[];
  missing: MissingPart[];
  caveats: string[];
  /** Filename stem every file in the bundle shares. Carries INCOMPLETE. */
  prefix: string;
  files: ExportFile[];
  manifest: ExportManifest;
}

/* ── the blocker ───────────────────────────────────────────────────────────── */

/**
 * Why the export cannot be taken yet, or null when it can.
 *
 * Only ever blocks on *loading*. A read that has definitively failed does not
 * block: a gym whose door terminal is down still deserves the other ten files,
 * and withholding them would be its own kind of dishonesty. A read that has not
 * come back yet is different — nobody knows whether it holds ten thousand rows
 * or none, and a bundle taken mid-flight would be missing data that exists
 * without anything in it knowing.
 */
export function exportBlocker(input: GymExportInput): string | null {
  const pending = EXPORT_PARTS.filter((p) => partSlice(input, p).state === 'loading');
  if (!pending.length) return null;
  const names = unique(pending.map((p) => EXPORT_LABEL[p]));
  return `Still reading ${list(names)}. An export taken now would be missing rows that exist.`;
}

/**
 * The sentence that goes on the screen, at the top of the README, and into the
 * manifest when something could not be read. Null when the bundle is whole.
 */
export function incompleteWarning(missing: MissingPart[]): string | null {
  if (!missing.length) return null;
  const names = list(missing.map((m) => m.label));
  const costs = missing.map((m) => m.cost).join('; ');
  const n = missing.length;
  return (
    `THIS EXPORT IS NOT YOUR WHOLE RECORD. Could not read ${names}. ` +
    `${n === 1 ? 'That part is' : 'Those parts are'} MISSING from this bundle, not empty — ` +
    `${costs} ${n === 1 ? 'is' : 'are'} absent from every file here. ` +
    `Fix the read and export again before treating this as the gym's record.`
  );
}

/* ── one member's record ───────────────────────────────────────────────────── */

/**
 * The parts of the bundle that are ABOUT a person rather than about the gym.
 *
 * The price book, the timetable, the equipment register, the rota and the promo
 * codes are the gym's own record and belong to nobody. Including them in one
 * member's file would hand a subject-access request the gym's whole commercial
 * position, which is both wrong and — under every regime that grants the right
 * — outside what was asked for.
 *
 * The AGREEMENTS are the exception that proves the line. They are gym-authored
 * documents, and they are in a member's bundle anyway, narrowed to the versions
 * that member actually signed — because those are not the gym's commercial
 * position, they are the words this person agreed to, and a signature row
 * without them is a citation to a document nobody enclosed.
 */
export const MEMBER_PARTS: ExportPart[] = [
  // First, because it is the part a subject-access response is least able to be
  // missing and the part this bundle went out without: their own file.
  'memberRecords',
  'memberships', 'payments', 'invoices', 'attendance', 'sessions',
  'passes', 'visits', 'invites', 'interventions', 'purchases', 'events',
  // The paperwork. `agreements` is here because a signature without the wording
  // it points at names a document the bundle does not contain.
  'agreements', 'signatures', 'documents',
];

/**
 * One member's gym-side record, built by FILTERING the whole-gym reads.
 *
 * ── Why this is a filter rather than eleven new queries ───────────────────
 *
 * Because the alternative is two implementations of "what does this gym hold
 * about this person", and the day they disagree is the day a subject-access
 * request goes out short. The export screen has already read every one of these
 * tables, with its three states intact; narrowing them is pure, testable and
 * cannot fail in a way the whole-gym bundle would not have failed already.
 *
 * It also means a part that could NOT be read stays unreadable here, and comes
 * out as the same loudly-named stub with the same INCOMPLETE in the filename.
 * A member export that quietly omitted the payments because a query 500'd would
 * be a formal answer to a legal request with a hole in it and nothing saying so.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 *
 * It does not touch the member's own app data — their workouts, their photos,
 * their messages, their measurements. Those are the member's and are exported
 * by src/lib/gdpr.ts from their own account. This is the GYM-SIDE record, which
 * is the half `web/delete-account.html` currently tells members to "ask us" for.
 */
export function memberSlices(input: GymExportInput, memberId: string): GymExportInput {
  const keep = <T>(s: Slice<T>, mine: (row: T) => boolean): Slice<T> =>
    s.state === 'ready' ? { state: 'ready', rows: s.rows.filter(mine) } : s;
  const none = <T>(s: Slice<T>): Slice<T> =>
    // A gym-wide part is EMPTY in a member export, not missing: it was read
    // fine and it is simply not about this person. A failed read stays failed,
    // because "we could not read the timetable" is still true of the class
    // attendance that hangs off it.
    (s.state === 'ready' ? { state: 'ready', rows: [] } : s);

  return {
    ...input,
    plans: none(input.plans),
    classes: none(input.classes),
    passTypes: none(input.passTypes),
    settlements: none(input.settlements),
    equipment: none(input.equipment),
    shifts: none(input.shifts),
    promos: none(input.promos),

    memberRecords: keep(input.memberRecords, (r) => r.memberId === memberId),
    memberships: keep(input.memberships, (m) => m.memberId === memberId),
    payments: keep(input.payments, (p) => p.memberId === memberId),
    invoices: keep(input.invoices, (i) => i.memberId === memberId),
    attendance: keep(input.attendance, (b) => b.memberId === memberId),
    // `clientId`, not `memberId`: a one-to-one names the CLIENT, and filtering
    // on the wrong field would hand a member every session the gym ran.
    sessions: keep(input.sessions, (x) => x.clientId === memberId),
    // A pass they hold, and a pass somebody bought FOR them. `hostMemberId` is
    // the member who brought a guest — a guest pass on their account is part of
    // their record even though they are not its holder.
    passes: keep(input.passes, (p) => p.holderId === memberId || p.hostMemberId === memberId),
    visits: keep(input.visits, (v) => v.memberId === memberId),
    invites: keep(input.invites, (i) => i.acceptedBy === memberId),
    interventions: keep(input.interventions, (i) => i.memberId === memberId),
    purchases: keep(input.purchases, (p) => p.clientId === memberId),
    // The activity log, narrowed to events ABOUT them. `subject_id` is who an
    // event is about; `actor_id` is who did it, and a member is never the actor
    // of a gym event, so filtering on the subject is the whole of it.
    events: keep(input.events, (e) => e.subjectId === memberId),

    signatures: keep(input.signatures, (g) => g.memberId === memberId),
    // Documents ABOUT them. Filtered on `member_id` and not on the latched
    // `member_attached` flag: part 390 keeps that flag true after an erasure
    // sets the id to null, which is right for deciding who may READ a row and
    // wrong here — a document that no longer names anybody cannot be handed to
    // somebody as theirs on the strength of once having named someone.
    documents: keep(input.documents, (d) => d.memberId === memberId),
    // The wording they agreed to, and only that. Narrowable only where the
    // signatures actually read: with that query refused there is no way to know
    // WHICH versions they signed, so the agreements travel whole rather than
    // narrowed by a guess, and `buildGymExport` says so in a caveat. The
    // over-inclusive answer is the safe one here — these are the gym's own
    // published terms, not its commercial position.
    agreements: input.signatures.state === 'ready'
      ? keepSigned(input.agreements, input.signatures.rows, memberId)
      : input.agreements,
  };
}

/** The agreement versions one member has a signature against. */
function keepSigned(
  agreements: Slice<ExportAgreement>, signatures: ExportSignature[], memberId: string,
): Slice<ExportAgreement> {
  if (agreements.state !== 'ready') return agreements;
  const mine = new Set(signatures.filter((g) => g.memberId === memberId).map((g) => g.agreementId));
  return { state: 'ready', rows: agreements.rows.filter((a) => mine.has(a.id)) };
}

/**
 * How many rows one member's record actually comes to.
 *
 * Offered before the download, because the honest answer is sometimes zero and
 * an owner answering a subject-access request needs to know that BEFORE they
 * send a bundle of empty files with a covering note saying it is complete.
 */
export function memberRowCount(input: GymExportInput, memberId: string): number | null {
  // Windowed FIRST, for the same reason `buildGymExport` windows: the number
  // offered before the download has to be the number of rows the download
  // contains, and an owner told "412 rows" over a bundle holding 40 has been
  // given the one figure they were going to quote in a covering letter.
  const scoped = memberSlices(windowSlices(input, { from: input.from ?? null, to: input.to ?? null }), memberId);
  let n = 0;
  for (const part of MEMBER_PARTS) {
    const s = partSlice(scoped, part);
    // One unreadable part makes the COUNT unknown rather than smaller. A
    // smaller number here would read as "this member has little on file".
    if (s.state !== 'ready') return null;
    n += s.rows.length;
  }
  return n;
}

/* ── the bundle ────────────────────────────────────────────────────────────── */

export function buildGymExport(raw: GymExportInput): GymExportBundle {
  // The window is applied here, once, from the bounds the input states — so
  // there is no arrangement of calls in which the manifest names a period the
  // rows do not respect. A caller that has already narrowed loses nothing:
  // narrowing rows that are already inside the window is a no-op.
  const window: ExportWindow = { from: raw.from ?? null, to: raw.to ?? null };
  const bounded = isBounded(window);
  const input = windowSlices(raw, window);
  const pending = EXPORT_PARTS.filter((p) => partSlice(input, p).state === 'loading');

  const missing: MissingPart[] = [];
  for (const part of EXPORT_PARTS) {
    const s = partSlice(input, part);
    if (s.state === 'failed') {
      missing.push({
        part,
        label: EXPORT_LABEL[part],
        cost: EXPORT_COST[part],
        reason: s.reason,
        file: '',
      });
    }
  }
  // A part still loading is not a part that failed, but it is equally not in
  // the bundle. It is reported the same way so a bundle taken anyway (the
  // screen refuses, but this module cannot assume its only caller does) can
  // never present itself as whole.
  for (const part of pending) {
    missing.push({
      part,
      label: EXPORT_LABEL[part],
      cost: EXPORT_COST[part],
      reason: 'still loading when the export was taken',
      file: '',
    });
  }
  missing.sort((a, b) => EXPORT_PARTS.indexOf(a.part) - EXPORT_PARTS.indexOf(b.part));

  const complete = missing.length === 0;
  const day = isoDatePart(input.generatedAt) || 'undated';
  // The period, in the filename, before the day it was taken. A bundle sitting
  // in a Downloads folder among four others is read by its NAME long before
  // anybody opens the README, and "this is the first quarter, not the record"
  // is the fact most likely to be lost between one and the other. `taken-`
  // labels the trailing date so two dates in one name cannot be misread.
  const span = windowSlug(window);
  const stem = input.subject
    // Named for the person, so a folder of these does not need opening to tell
    // one member's record from another's — and so a whole-gym backup can never
    // be mistaken for a subject-access response by its filename alone.
    ? ['repple-member-record', slug(input.gymName), slug(input.subject.memberName) || input.subject.memberId.slice(0, 8), span, span ? 'taken-' + day : day].filter(Boolean).join('-')
    : ['repple-export', slug(input.gymName), span, span ? 'taken-' + day : day].filter(Boolean).join('-');
  const prefix = complete ? stem : stem + '-INCOMPLETE';
  const named = (basename: string) => `${prefix}-${basename}`;

  for (const m of missing) m.file = named(EXPORT_FILE[m.part].replace(/\.csv$/, '') + '-NOT-EXPORTED.txt');

  const caveats: string[] = [];
  const files: ExportFile[] = [];
  const reports: ExportPartReport[] = [];

  const emailsKnown = input.invites.state === 'ready';
  if (!emailsKnown && input.memberships.state === 'ready') {
    caveats.push(
      'members.csv has no email column: addresses are only held on invite rows, and the invites ' +
      'read did not come back. The column is absent rather than blank, because a blank one would ' +
      'read as "this member has no email address".',
    );
  }
  if (bounded) {
    caveats.push(
      `This is a SLICE of the record, not the record. It covers ${describeWindow(window)}; ` +
      'anything the gym holds outside those dates is absent from every file here and is not ' +
      'missing, not deleted and not zero. The README lists which files the period actually ' +
      'narrowed and which are whole whatever it says.',
    );
  }
  if (input.subject && input.signatures.state !== 'ready') {
    caveats.push(
      'agreements.csv holds EVERY version this gym publishes rather than only the ones this ' +
      'member signed. Which ones they signed is on the signatures read, and that read did not ' +
      'come back, so narrowing them would have been a guess about what somebody agreed to.',
    );
  }
  // Counted rather than dropped, and said out loud. A row with no date could
  // not be placed inside or outside the period, and leaving it out would have
  // asserted that it happened elsewhere.
  if (bounded) {
    const stray: string[] = [];
    for (const part of EXPORT_PARTS) {
      const n = undatedRows(input, part);
      if (n) stray.push(`${EXPORT_FILE[part]} (${n})`);
    }
    if (stray.length) {
      caveats.push(
        `Some rows carry no date to place them by, so they could not be put inside or outside ` +
        `the period: ${stray.join(', ')}. They are INCLUDED. Leaving them out would have said ` +
        `they happened outside your dates, and nothing here knows that.`,
      );
    }
  }

  for (const part of EXPORT_PARTS) {
    const s = partSlice(input, part);

    if (s.state !== 'ready') {
      const m = missing.find((x) => x.part === part)!;
      files.push({
        name: m.file,
        mime: 'text/plain;charset=utf-8',
        text: notExportedText(m, input),
        rows: null,
        part,
        placeholder: true,
      });
      reports.push({
        part,
        label: EXPORT_LABEL[part],
        file: m.file,
        status: 'unavailable',
        rows: null,
        reason: m.reason,
        columns: null,
        note: `Not in this bundle. ${capitalise(EXPORT_COST[part])} is unknown here — absent, not zero.`,
        window: partWindow(part, bounded, null),
      });
      continue;
    }

    const table = tableFor(part, input);
    const name = named(EXPORT_FILE[part]);
    files.push({
      name,
      mime: 'text/csv;charset=utf-8',
      text: toCsv(table.header, table.rows),
      rows: table.rows.length,
      part,
      placeholder: false,
    });
    reports.push({
      part,
      label: EXPORT_LABEL[part],
      file: name,
      status: 'exported',
      rows: table.rows.length,
      reason: null,
      columns: table.header,
      note: table.note,
      window: partWindow(part, bounded, undatedRows(input, part)),
    });
  }

  const manifest: ExportManifest = {
    app: 'Repple',
    kind: input.subject ? 'member-record-export' : 'gym-record-export',
    subject: input.subject ? { memberId: input.subject.memberId, memberName: input.subject.memberName } : null,
    formatVersion: 1,
    gym: input.gymName ?? null,
    tenantId: input.tenantId ?? null,
    exportedAt: input.generatedAt,
    window: {
      from: window.from,
      to: window.to,
      bounded,
      covers: describeWindow(window),
    },
    complete,
    // `complete` has always meant "every part was read, and read whole". It
    // says nothing at all about the period, and on a bounded bundle a reader
    // takes exactly the wrong thing from it — so the claim a reader actually
    // wants is spelled separately rather than left to be inferred from two
    // fields that are true at once.
    wholeRecord: complete && !bounded,
    warning: incompleteWarning(missing),
    parts: reports,
    caveats,
    conventions: CONVENTIONS,
  };

  files.push({
    name: named('manifest.json'),
    mime: 'application/json;charset=utf-8',
    text: JSON.stringify(manifest, null, 2) + '\n',
    rows: null,
    part: null,
    placeholder: false,
  });
  files.push({
    name: named('README.txt'),
    mime: 'text/plain;charset=utf-8',
    text: readmeText(manifest, missing),
    rows: null,
    part: null,
    placeholder: false,
  });

  return { complete, pending, missing, caveats, prefix, files, manifest };
}

/* ── the tables ────────────────────────────────────────────────────────────── */

interface Table { header: string[]; rows: Cell[][]; note: string | null }

function tableFor(part: ExportPart, input: GymExportInput): Table {
  switch (part) {
    case 'plans': return plansTable(readyRows(input.plans));
    case 'members': return membersTable(input);
    case 'memberships': return membershipsTable(readyRows(input.memberships));
    case 'payments': return paymentsTable(readyRows(input.payments));
    case 'classes': return classesTable(readyRows(input.classes));
    case 'attendance': return attendanceTable(readyRows(input.attendance));
    case 'sessions': return sessionsTable(readyRows(input.sessions));
    case 'passTypes': return passTypesTable(readyRows(input.passTypes));
    case 'passes': return passesTable(readyRows(input.passes));
    case 'visits': return visitsTable(readyRows(input.visits));
    case 'invites': return invitesTable(readyRows(input.invites));
    case 'invoices': return invoicesTable(readyRows(input.invoices));
    case 'settlements': return settlementsTable(readyRows(input.settlements));
    case 'equipment': return equipmentTable(readyRows(input.equipment));
    case 'shifts': return shiftsTable(readyRows(input.shifts));
    case 'interventions': return interventionsTable(readyRows(input.interventions));
    case 'promos': return promosTable(readyRows(input.promos));
    case 'events': return eventsTable(readyRows(input.events));
    case 'purchases': return purchasesTable(readyRows(input.purchases));
    case 'memberRecords': return memberRecordsTable(readyRows(input.memberRecords));
    case 'agreements': return agreementsTable(readyRows(input.agreements));
    case 'signatures': return signaturesTable(readyRows(input.signatures));
    case 'documents': return documentsTable(readyRows(input.documents));
  }
}

/* ── the paperwork ─────────────────────────────────────────────────────────── */

/**
 * The gym's own file on each member.
 *
 * Tags are joined with `; ` rather than with a comma, and the whole cell is
 * quoted by `csvCell` either way — but a comma inside a cell that a reader then
 * hand-edits in a text editor is how a roster gets shifted by one column six
 * months from now, and there is no reason to write one when a semicolon says
 * the same thing.
 */
function memberRecordsTable(rows: ExportMemberRecord[]): Table {
  return {
    header: ['member_name', 'member_id', 'phone', 'email', 'emergency_name', 'emergency_phone', 'medical_note', 'desk_note', 'tags', 'updated_at'],
    rows: rows.map((r) => [
      r.memberName, r.memberId, r.phone, r.email,
      r.emergencyName, r.emergencyPhone, r.medicalNote, r.note,
      r.tags.length ? r.tags.join('; ') : null,
      r.updatedAt,
    ]),
    note: 'What the gym itself recorded about each person: how to reach them, who to ring, what it was told for the floor, and what the desk wrote. `medical_note` is the GYM\u2019s operational note and is not the member\u2019s own injury record, which is theirs and leaves from their own account. A blank emergency contact means none was ever recorded — it does not mean the member has nobody.',
  };
}

/**
 * The documents themselves, wording included.
 *
 * `body` is a whole agreement in one cell — long, and full of line breaks and
 * commas. That is exactly what `csvCell` is for, and shortening it would defeat
 * the point: the reason this file exists is that a signature naming version 2
 * is worth nothing without the text of version 2 beside it.
 */
function agreementsTable(rows: ExportAgreement[]): Table {
  return {
    header: ['kind', 'title', 'version', 'active', 'required', 'created_at', 'agreement_id', 'body'],
    rows: rows.map((a) => [
      a.kind, a.title, a.version,
      a.active == null ? '' : a.active,
      a.required == null ? '' : a.required,
      a.createdAt, a.id, a.body,
    ]),
    note: 'The wording as it stood, which is what a signature points at. The body is immutable once anybody has signed it, so an old version here is what those people actually agreed to and not what the gym says today. `active` is whether this version is the one currently handed out; a retired version is kept because its signatures are still evidence.',
  };
}

/**
 * Who signed what — and which of the three kinds of signature it is.
 *
 * ── Why `what_the_attribution_means` is a column and not a footnote ───────
 *
 * The file is opened by a solicitor, an insurer or a regulator, and none of
 * them has read supabase/parts/520. `attribution = staff` in a cell on its own
 * is a token they will map onto whatever they already believe a signature is,
 * which is the strong form — the exact misreading that made part 520 necessary.
 * The sentence rides in the row, so the row cannot be quoted without it.
 *
 * `signed_by_id` is beside it and not instead of it: the id is the evidence and
 * the word is the reading, and only the first survives being disputed.
 */
function signaturesTable(rows: ExportSignature[]): Table {
  return {
    header: [
      'signed_at', 'member_name', 'member_id', 'signed_name',
      'agreement_kind', 'agreement_title', 'version_signed',
      'attribution', 'what_the_attribution_means',
      'signed_by_id', 'signed_by_name', 'witnessed_by_id', 'witnessed_by_name',
      'guardian_name', 'guardian_relationship', 'note',
      'signature_id', 'agreement_id',
    ],
    rows: rows.map((g) => [
      g.signedAt, g.memberName, g.memberId, g.signedName,
      g.agreementKind, g.agreementTitle, g.versionSigned,
      g.attribution, ATTRIBUTION_MEANS[g.attribution],
      g.signedById, g.signedByName, g.witnessedById, g.witnessedByName,
      g.guardianName, g.guardianRelationship, g.note,
      g.id, g.agreementId,
    ]),
    note: 'Read the attribution column before relying on any row here. Only \u2018member\u2019 is the member\u2019s own act; \u2018staff\u2019 is somebody at the desk recording that they agreed, and \u2018unknown\u2019 is a row written before this product recorded which. The signed name is what was typed at the time and is kept apart from the account name on purpose — the name on a waiver IS the waiver. The wording each row points at is in agreements.csv.',
  };
}

/** What each attribution means, in the words that have to survive being quoted
 *  out of the row they sit in. Written here rather than taken from the screen
 *  copy in gymSigning.ts: that is read in a table cell beside a filter and a
 *  count, and this is read cold, alone, months later, by somebody deciding
 *  whether the gym can rely on the row. */
const ATTRIBUTION_MEANS: Record<SignatureAttribution, string> = {
  member:
    'The member gave this themselves, from their own signed-in account, against this version of the wording.',
  staff:
    'A member of staff recorded this on the member\u2019s behalf. It is a staff attestation that the member agreed. It is NOT the member\u2019s own signature.',
  unknown:
    'Written before this product recorded who typed a signature. It is not known whether the member gave it or a member of staff entered it for them, and nothing here will guess.',
};

/**
 * The index of the filing cabinet — and the file that says the files are not
 * in this bundle.
 *
 * A CSV cannot carry a 25 MB scan. The alternative to saying so is a gym that
 * exports its record, sees `documents.csv`, and believes the signed contracts
 * left with it. `storage_path` is the object key each one is findable by; it is
 * not a link and not a credential, and reading the object still needs a session
 * the database permits.
 */
function documentsTable(rows: ExportDocument[]): Table {
  return {
    header: ['uploaded_at', 'kind', 'title', 'member_name_or_id', 'member_attached', 'equipment_id', 'expires_on', 'mime', 'size_bytes', 'note', 'uploaded_by_name', 'uploaded_by_id', 'storage_path', 'document_id'],
    rows: rows.map((d) => [
      d.uploadedAt, d.kind, d.title, d.memberId,
      d.memberAttached == null ? '' : d.memberAttached,
      d.equipmentId, d.expiresOn, d.mime, d.sizeBytes, d.note,
      d.uploadedByName, d.uploadedById, d.storagePath, d.id,
    ]),
    note: 'THE FILES THEMSELVES ARE NOT IN THIS BUNDLE. This is the index in front of the gym-docs bucket — what each document is, what it is about and when it expires — and a CSV cannot carry a scan. `storage_path` is the key each file is stored under, so every row here is findable; downloading them is a separate act against the bucket. An empty expires_on means it does not expire or nobody said, and those two were never distinguished.',
  };
}

/* ── the eight that used to be left behind ─────────────────────────────────── */

/**
 * The invoice register.
 *
 * `amount_cents` is written as a blank where the row carries none, not as a 0.
 * An invoice of unknown size in a file somebody files is the one row that must
 * not read as free — and `minorToDecimal` already returns '' for null, which is
 * why every money column here goes through it rather than through toFixed.
 */
function invoicesTable(rows: ExportInvoice[]): Table {
  return {
    header: ['invoice_number', 'issued_on', 'due_on', 'member_name', 'member_id', 'amount', 'currency', 'amount_cents', 'status', 'note', 'invoice_id'],
    rows: rows.map((i) => [
      i.number, i.issuedOn, i.dueOn, i.memberName, i.memberId,
      minorToDecimal(i.amountCents), i.currency, i.amountCents,
      i.status, i.note, i.id,
    ]),
    note: 'What the gym billed. A blank amount is an invoice that records none — it is not a free one. `status` is the register\u2019s own word; overdue is computed from due_on and is not stored.',
  };
}

/** Payroll settlements — money that actually left the account. */
function settlementsTable(rows: ExportSettlement[]): Table {
  return {
    header: ['settled_at', 'trainer_name', 'trainer_id', 'period_from', 'period_to', 'amount', 'currency', 'amount_cents', 'sessions', 'method', 'reversed_at', 'reverse_reason', 'settlement_id'],
    rows: rows.map((r) => [
      r.settledAt, r.trainerName, r.trainerId, r.periodFrom, r.periodTo,
      minorToDecimal(r.amountCents), r.currency, r.amountCents,
      r.sessionsCount, r.method, r.reversedAt, r.reverseReason, r.id,
    ]),
    note: 'Amounts are snapshots of what was handed over and are never recomputed. A row with reversed_at set was TAKEN BACK — it is kept because a settlement that was recorded and then withdrawn is two facts, and it must not be counted as money out.',
  };
}

/** The equipment register. */
function equipmentTable(rows: ExportEquipment[]): Table {
  return {
    header: ['name', 'category', 'identifier', 'quantity', 'status', 'purchased_on', 'service_interval_days', 'last_serviced_on', 'note', 'equipment_id'],
    rows: rows.map((e) => [
      e.name, e.category, e.identifier, e.quantity, e.status, e.purchasedOn,
      e.serviceIntervalDays, e.lastServicedOn, e.note, e.id,
    ]),
    note: 'A blank last_serviced_on beside a service interval means the schedule exists and nobody has recorded a service — which is not the same as serviced today.',
  };
}

/** The rota. */
function shiftsTable(rows: ExportShift[]): Table {
  return {
    header: ['starts_at', 'ends_at', 'trainer_name', 'trainer_id', 'role', 'status', 'note', 'shift_id'],
    rows: rows.map((s) => [s.startsAt, s.endsAt, s.trainerName, s.trainerId, s.role, s.status, s.note, s.id]),
    note: 'Who was rostered. `gym_shifts` carries no rate, so this file says who was on the floor and cannot say what the floor cost to staff.',
  };
}

/** Member contact — the record that anybody was ever spoken to. */
function interventionsTable(rows: ExportIntervention[]): Table {
  return {
    header: ['at', 'member_name', 'member_id', 'channel', 'outcome', 'contacted_by', 'contacted_by_id', 'note', 'intervention_id'],
    rows: rows.map((i) => [i.at, i.memberName, i.memberId, i.channel, i.outcome, i.byName, i.byId, i.note, i.id]),
    note: 'The only record in this product that a member was contacted about drifting away — it is what answers a member who says nobody ever got in touch. What FOLLOWED a contact is not here: that is computed from training either side of it, it changes as more training is recorded, and a snapshot of it in a file would be a judgement dressed as a fact.',
  };
}

/** Promo codes. */
function promosTable(rows: ExportPromo[]): Table {
  return {
    header: ['code', 'discount_pct', 'active', 'redemptions', 'created_at', 'promo_id'],
    rows: rows.map((p) => [p.code, p.discount, p.active == null ? '' : p.active, p.redemptions, p.createdAt, p.id]),
    note: 'A redemption count with no amount beside it is deliberate: nothing records which payment a redemption applied to, so a percentage of an unknown price is not an amount and none is written.',
  };
}

/** The activity log. */
function eventsTable(rows: ExportEvent[]): Table {
  return {
    header: ['at', 'kind', 'summary', 'subject_id', 'actor_id', 'event_id'],
    rows: rows.map((e) => [e.at, e.kind, e.summary, e.subjectId, e.actorId, e.id]),
    note: 'Written by database triggers as things happened, so nothing here was typed by anyone. The summary was composed at write time and names people as they were called then — it does not change when somebody is renamed or erased.',
  };
}

/** PT packs sold through the coaches' own checkout. */
function purchasesTable(rows: ExportPurchase[]): Table {
  return {
    header: ['created_at', 'trainer_name', 'trainer_id', 'client_id', 'amount', 'currency', 'amount_cents', 'sessions_total', 'sessions_used', 'status', 'purchase_id'],
    rows: rows.map((p) => [
      p.createdAt, p.trainerName, p.trainerId, p.clientId,
      minorToDecimal(p.amountCents), p.currency, p.amountCents,
      p.sessionsTotal, p.sessionsUsed, p.status, p.id,
    ]),
    note: '`client_purchases` carries no tenant column, so these rows are scoped by the trainers on this gym\u2019s roster — a purchase against a coach who has since left the roster is not here. A blank currency means the package it was sold from has been deleted and the unit is unrecoverable; it is never guessed.',
  };
}

/**
 * The price book, in the shape `previewPlans` reads.
 *
 * `name,price,interval,currency,active` are exactly its aliases, so a bundle
 * from one Repple gym imports into another without anybody editing a header.
 * `price_cents` follows as the authoritative figure — `price` is the same
 * number written for the importer's benefit and loses nothing, but if the two
 * ever disagree the integer is the one to believe.
 */
function plansTable(rows: MembershipPlan[]): Table {
  return {
    header: ['name', 'price', 'interval', 'currency', 'active', 'plan_id', 'price_cents'],
    rows: rows.map((p) => [
      p.name,
      minorToDecimal(p.priceCents),
      p.interval,
      p.currency,
      p.active,
      p.id,
      p.priceCents,
    ]),
    note: 'Re-importable by previewPlans. price_cents is the stored figure; price is the same value for the importer.',
  };
}

/**
 * One row per member, in the shape `previewMembers` reads.
 *
 * Derived from the membership rows, because a member is a person holding a
 * membership — there is no separate roster table to take. Where somebody holds
 * more than one, the row picked is the one that describes them today, using the
 * same rule as `currentMembership` in src/lib/memberView.ts: a live membership
 * beats a dead one however old, and among equals the latest start. Nothing is
 * lost by choosing — memberships.csv still carries every row.
 *
 * The email column exists only when the invites read succeeded, because that is
 * the only place the gym holds an address. Absent means "not known here";
 * blank would mean "no address", and those are different facts.
 */
function membersTable(input: GymExportInput): Table {
  const ms = readyRows(input.memberships);
  const invites = input.invites.state === 'ready' ? input.invites.rows : null;

  const byMember = new Map<string, Membership[]>();
  for (const m of ms) {
    if (!m.memberId) continue;
    const at = byMember.get(m.memberId);
    if (at) at.push(m); else byMember.set(m.memberId, [m]);
  }

  const emailFor = new Map<string, string>();
  for (const i of invites ?? []) {
    if (i.acceptedBy && i.email && !emailFor.has(i.acceptedBy)) emailFor.set(i.acceptedBy, i.email);
  }

  const header = invites
    ? ['name', 'email', 'plan', 'started', 'ends', 'status', 'member_id']
    : ['name', 'plan', 'started', 'ends', 'status', 'member_id'];

  const rows: Cell[][] = [];
  for (const [memberId, list] of byMember) {
    const cur = describesThemToday(list);
    const cells: Cell[] = [cur.memberName];
    if (invites) cells.push(emailFor.get(memberId) ?? null);
    cells.push(cur.planName, cur.startedOn, cur.endsOn, cur.status, memberId);
    rows.push(cells);
  }

  return {
    header,
    rows,
    note: invites
      ? 'Re-importable by previewMembers. One row per member; email is present only where the gym recorded one on an invite.'
      : 'Re-importable by previewMembers. NO email column — the invites read failed, and a blank column would have read as "no address".',
  };
}

/** The same rule as memberView.currentMembership, kept in step deliberately. */
function describesThemToday(ms: Membership[]): Membership {
  const rank = (m: Membership) => (m.status === 'active' ? 3 : m.status === 'frozen' ? 2 : 1);
  return [...ms].sort(
    (a, b) => rank(b) - rank(a) || String(b.startedOn).localeCompare(String(a.startedOn)),
  )[0];
}

function membershipsTable(rows: Membership[]): Table {
  return {
    header: ['membership_id', 'member_id', 'member_name', 'plan_id', 'plan_name', 'started_on', 'ends_on', 'status'],
    rows: rows.map((m) => [m.id, m.memberId, m.memberName, m.planId, m.planName, m.startedOn, m.endsOn, m.status]),
    note: 'Every membership row, including historical ones. members.csv holds one row per person.',
  };
}

/**
 * Payments, in the shape `previewPayments` reads.
 *
 * Two columns exist purely so the round trip works, and neither replaces
 * anything: `amount` is `amount_cents` written as an exact decimal because
 * `parseMoneyCents` reads money in major units, and `date` is the day part of
 * `taken_at` because `parseDate` refuses a full timestamp. The stored values
 * are both still here in full.
 *
 * The `email` column is always empty: `gym_payments` attributes by member id,
 * and profiles carry no address. It is present because a payment with neither
 * a name nor an address is one the importer will rightly refuse to attribute,
 * and that refusal should be visible rather than caused by a missing column.
 */
function paymentsTable(rows: GymPayment[]): Table {
  return {
    header: [
      'member', 'email', 'amount', 'date', 'method', 'note',
      'payment_id', 'member_id', 'amount_cents', 'currency', 'taken_at',
    ],
    rows: rows.map((p) => [
      p.memberName,
      null,
      minorToDecimal(p.amountCents),
      isoDatePart(p.takenAt),
      p.method,
      p.note,
      p.id,
      p.memberId,
      p.amountCents,
      p.currency,
      p.takenAt,
    ]),
    note: 'Re-importable by previewPayments. amount_cents and taken_at are the stored values; amount and date are the same values in the shapes the importer reads.',
  };
}

function classesTable(rows: GymClass[]): Table {
  return {
    header: ['class_id', 'title', 'room', 'instructor', 'trainer_id', 'starts_at', 'duration_min', 'capacity', 'booked', 'attended'],
    rows: rows.map((c) => [c.id, c.title, c.room, c.instructor, c.trainerId, c.startsAt, c.durationMin, c.capacity, c.booked, c.attended]),
    note: 'booked and attended are counted from the same booking rows that attendance.csv lists in full.',
  };
}

function attendanceTable(rows: MemberBooking[]): Table {
  return {
    header: ['booking_id', 'class_id', 'class_title', 'class_starts_at', 'member_id', 'status', 'attended_at'],
    rows: rows.map((b) => [b.bookingId, b.classId, b.classTitle, b.startsAt || null, b.memberId, b.status, b.attendedAt]),
    note: 'An empty attended_at means nobody ticked the member off — which is not the same as absent.',
  };
}

function sessionsTable(rows: PtSession[]): Table {
  return {
    header: [
      'session_id', 'trainer_id', 'trainer_name', 'client_id', 'client_name',
      'starts_at', 'duration_min', 'slot_status', 'outcome', 'outcome_at',
      'rate_cents', 'rate', 'settlement_id',
    ],
    rows: rows.map((s) => [
      s.id, s.trainerId, s.trainerName, s.clientId, s.clientName,
      s.startsAt, s.durationMin, s.status, s.outcome, s.outcomeAt,
      s.rateCents, minorToDecimal(s.rateCents), s.settlementId,
    ]),
    note: 'An empty outcome means nobody has said what happened. It is not a no-show, and it was never treated as one.',
  };
}

function passTypesTable(rows: PassType[]): Table {
  return {
    header: ['pass_type_id', 'name', 'kind', 'price_cents', 'price', 'currency', 'uses', 'valid_days', 'active'],
    rows: rows.map((t) => [t.id, t.name, t.kind, t.priceCents, minorToDecimal(t.priceCents), t.currency, t.uses, t.validDays, t.active]),
    note: 'An empty valid_days means the pass does not expire.',
  };
}

function passesTable(rows: GymPass[]): Table {
  return {
    header: [
      'pass_id', 'pass_type_id', 'pass_type_name', 'kind', 'holder_id', 'holder_name',
      'host_member_id', 'issued_on', 'expires_on', 'uses_total', 'uses_spent',
      'paid_cents', 'paid', 'currency', 'note',
    ],
    rows: rows.map((p) => [
      p.id, p.passTypeId, p.passTypeName, p.kind, p.holderId, p.holderName,
      p.hostMemberId, p.issuedOn, p.expiresOn, p.usesTotal, p.usesSpent,
      p.paidCents, minorToDecimal(p.paidCents), p.currency, p.note,
    ]),
    note: 'uses_total and uses_spent are exported raw and never differenced here — a clamped "uses left" would hide a counter that is out of step. An empty paid_cents means no price was recorded, not that it was free.',
  };
}

function visitsTable(rows: Visit[]): Table {
  return {
    header: ['visit_id', 'member_id', 'member_name', 'pass_id', 'class_id', 'entered_at', 'exited_at', 'source', 'note'],
    rows: rows.map((v) => [v.id, v.memberId, v.memberName, v.passId, v.classId, v.enteredAt, v.exitedAt, v.source, v.note]),
    note: 'An empty exited_at means the visitor is still inside or the door records no exits. Dwell is not computed here, because it cannot be for those rows.',
  };
}

/**
 * Invites, deliberately without the token column.
 *
 * `member_invites.token` is a live share-link secret. An export is a file that
 * gets emailed to an accountant and left in a Downloads folder, and a bundle
 * carrying working join links for every outstanding invite is a credential
 * leak, not a record. The rest of the row is exported in full.
 */
function invitesTable(rows: MemberInvite[]): Table {
  return {
    header: ['invite_id', 'email', 'full_name', 'plan_id', 'plan_name', 'invited_by', 'status', 'created_at', 'expires_at', 'accepted_at', 'accepted_by'],
    rows: rows.map((i) => [
      i.id, i.email, i.fullName, i.planId, i.planName, i.invitedBy,
      i.status, i.createdAt, i.expiresAt, i.acceptedAt, i.acceptedBy,
    ]),
    note: 'The invite token is deliberately NOT exported — it is a working join link, and a record should not carry live credentials.',
  };
}

/* ── the prose ─────────────────────────────────────────────────────────────── */

const CONVENTIONS: Record<string, string> = {
  money:
    'Held and exported as integer minor units (fils/cents) in the *_cents columns. ' +
    'The plain price/amount/paid/rate columns are the same figures written as exact ' +
    'two-decimal strings for spreadsheet and importer use. Nothing is rounded.',
  dates:
    'ISO 8601 exactly as stored. Timestamps keep their time and zone; the date-only ' +
    'columns the importer reads sit beside them, never instead of them.',
  empty:
    'An empty cell means the gym never recorded a value. It is never 0, never "null", ' +
    'and never a dash. A member with no recorded weight did not weigh nothing.',
  quoting:
    'RFC 4180. A field containing a comma, semicolon, tab, pipe, quote or line break is ' +
    'quoted, and an inner quote is doubled. Names like O’Brien, "Bob" Smith and ' +
    'Smith, Jr. survive intact.',
  encoding: 'UTF-8 with a byte-order mark, CRLF line endings.',
};

function notExportedText(m: MissingPart, input: GymExportInput): string {
  return [
    'THIS PART OF THE RECORD IS NOT IN THIS EXPORT.',
    '',
    `Part:    ${EXPORT_LABEL[m.part]}`,
    `File:    ${EXPORT_FILE[m.part]} was NOT written.`,
    `Reason:  ${m.reason}`,
    '',
    `What is missing: ${capitalise(m.cost)}.`,
    '',
    'This stub exists instead of an empty CSV on purpose. An empty file would have',
    'said that this gym has no such rows, and that is a claim nothing here can make.',
    'Missing is missing.',
    '',
    'Do not treat this bundle as the gym’s record. Fix the read and export again.',
    '',
    `Gym:      ${input.gymName ?? '(not read)'}`,
    `Exported: ${input.generatedAt}`,
    '',
  ].join('\n');
}

function readmeText(manifest: ExportManifest, missing: MissingPart[]): string {
  const out: string[] = [];

  // The period comes FIRST, above even the incomplete warning, because it is
  // the claim most likely to be carried away wrong. "Could not read the door
  // log" is a fact about this bundle; "this is one quarter and not the record"
  // is a fact about what the bundle IS, and a reader who takes only the first
  // line away has to take that one.
  if (manifest.window.bounded) {
    out.push('='.repeat(72));
    out.push(`THIS EXPORT COVERS ${manifest.window.covers.toUpperCase()}.`);
    out.push('IT IS A SLICE OF THE RECORD AND NOT THE RECORD.');
    out.push('='.repeat(72));
    out.push('');
    out.push('Anything the gym holds outside those dates is absent from every file here.');
    out.push('Absent is not missing, not deleted and not zero — it was not asked for.');
    out.push('');

    const cut = manifest.parts.filter((p) => p.window.bounded);
    const whole = manifest.parts.filter((p) => !p.window.bounded);
    // Basenames in these two lists, not the full prefixed filenames. Every file
    // in the bundle shares the stem and the stem carries the period, so
    // repeating it on twenty-three lines buries the one word that differs.
    if (cut.length) {
      out.push('Narrowed by the period — only rows dated inside it are here:');
      for (const p of cut) {
        const stray = p.window.undated ? `; ${p.window.undated} row(s) carry no ${p.window.field} and are INCLUDED, because leaving them out would say they happened outside your dates` : '';
        out.push(`  - ${EXPORT_FILE[p.part]}  (by ${p.window.field}${stray})`);
      }
      out.push('');
    }
    if (whole.length) {
      out.push('NOT narrowed — the whole set is here whatever period you asked for:');
      for (const p of whole) {
        out.push(`  - ${EXPORT_FILE[p.part]}  ${p.window.why ?? ''}`);
      }
      out.push('');
      out.push('So do not add a figure from a narrowed file to one from a whole file and');
      out.push('call the answer a figure for the period. They do not cover the same span.');
      out.push('');
    }
  }

  if (manifest.warning) {
    out.push('!'.repeat(72));
    out.push(manifest.warning);
    out.push('!'.repeat(72));
    out.push('');
    out.push('Not exported:');
    for (const m of missing) {
      out.push(`  - ${m.label}: ${m.reason}`);
      out.push(`      cost: ${m.cost}`);
      out.push(`      see:  ${m.file}`);
    }
    out.push('');
  } else {
    // What "complete" is allowed to mean, said in the words that make it
    // checkable. It used to say only that every read succeeded, which was true
    // and was not the claim a reader takes from the word: a read that came back
    // at PostgREST's silent 1000-row ceiling SUCCEEDS, and every part of this
    // bundle was capable of arriving as a prefix of itself under this sentence.
    // Every read behind it now either returns the whole set or fails and is
    // named above, so the claim is one somebody verified rather than one nobody
    // had reason to doubt. See src/lib/rowCap.ts.
    out.push(manifest.wholeRecord
      ? 'This bundle is complete: every part of the record was read, and read whole.'
      : 'Every part was read, and read whole — within the period above. Complete here means'
        + ' nothing was lost to a failed read. It does not mean this is the whole record.');
    out.push('');
    out.push('No read here can come back short without saying so. The database returns at most a');
    out.push('fixed number of rows per request and does not mention when it has stopped, so every');
    out.push('read either asks for one row more than it will accept — and fails loudly if it gets');
    out.push('it — or pages until the set is finished. A part that could not be read whole is a');
    out.push('part listed as not exported, never a shorter file.');
    out.push('');
  }

  out.push(`Repple — gym record export`);
  out.push(`Gym:      ${manifest.gym ?? '(not read)'}`);
  out.push(`Tenant:   ${manifest.tenantId ?? '(not read)'}`);
  out.push(`Exported: ${manifest.exportedAt}`);
  // Printed on an unbounded bundle too, and as a sentence rather than as two
  // raw instants. "Covers: the whole record, with no period applied" is a
  // claim somebody can check; a missing line is one they have to infer.
  out.push(`Covers:   ${manifest.window.covers}`);
  out.push('');

  out.push('Files');
  out.push('-----');
  for (const p of manifest.parts) {
    if (p.status === 'exported') {
      out.push(`${p.file}  — ${p.label}, ${p.rows} ${p.rows === 1 ? 'row' : 'rows'}`);
    } else {
      out.push(`${p.file}  — ${p.label}: NOT EXPORTED (${p.reason})`);
    }
    if (p.note) out.push(`    ${p.note}`);
  }
  out.push('');

  if (manifest.caveats.length) {
    out.push('Caveats');
    out.push('-------');
    for (const c of manifest.caveats) out.push(`  - ${c}`);
    out.push('');
  }

  out.push('How to read the figures');
  out.push('-----------------------');
  for (const [k, v] of Object.entries(manifest.conventions)) {
    out.push(`${k}: ${v}`);
  }
  out.push('');
  out.push('Bringing it back in');
  out.push('-------------------');
  out.push('plans.csv, members.csv and payments.csv use the column names Repple’s own');
  out.push('CSV import understands, so a bundle from one gym loads into another without');
  out.push('anybody renaming a header. The extra id and *_cents columns are reported by');
  out.push('the importer as unrecognised and ignored — they are there for other systems.');
  out.push('');
  out.push('The paperwork');
  out.push('-------------');
  out.push('signatures.csv says WHO gave each signature in its attribution column, and');
  out.push('every row carries a sentence saying what that means. Only “member” is the');
  out.push('member’s own act; “staff” is somebody at the desk recording that they agreed,');
  out.push('and “unknown” is a row written before this was recorded. Do not quote a row');
  out.push('from this file without that column — it is the difference between a signature');
  out.push('and a note about one.');
  out.push('');
  out.push('agreements.csv carries the full wording each signature points at, as it stood.');
  out.push('documents.csv is the INDEX of the filing cabinet and NOT the files: a CSV');
  out.push('cannot carry a scan. Every row names the key its file is stored under, so the');
  out.push('documents are findable, but they did not leave in this bundle.');
  out.push('');
  return out.join('\n');
}

/* ── small helpers ─────────────────────────────────────────────────────────── */

function readyRows<T>(s: Slice<T>): T[] {
  return s.state === 'ready' ? s.rows : [];
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function list(names: string[]): string {
  if (names.length === 0) return 'nothing';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
