"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMBER_PARTS = exports.EXPORT_UNBOUNDED_WHY = exports.EXPORT_DATE_FIELD = exports.EXPORT_FILE = exports.EXPORT_COST = exports.EXPORT_LABEL = exports.EXPORT_PARTS = void 0;
exports.csvCell = csvCell;
exports.csvRow = csvRow;
exports.toCsv = toCsv;
exports.minorToDecimal = minorToDecimal;
exports.isoDatePart = isoDatePart;
exports.gymDatePart = gymDatePart;
exports.daysAt = daysAt;
exports.slug = slug;
exports.partSlice = partSlice;
exports.rowDate = rowDate;
exports.windowSlices = windowSlices;
exports.undatedRows = undatedRows;
exports.partWindow = partWindow;
exports.exportBlocker = exportBlocker;
exports.incompleteWarning = incompleteWarning;
exports.memberSlices = memberSlices;
exports.memberRowCount = memberRowCount;
exports.buildGymExport = buildGymExport;
// The window's arithmetic and its prose. A `import type` for the shape and
// named functions for the rest — this stays the one file in the export path
// with no runtime import of a MODULE THAT TOUCHES ANYTHING, and exportWindow.ts
// is pure by the same rule, so the promise at the top of this header is intact.
const exportWindow_1 = require("./exportWindow");
// The second runtime import, and the header above says there is one. It is now
// two, and the reason is worth the amendment: how many minor units a currency
// has is a question this file was answering wrongly, and coachMoney.ts is the
// single place in the product that answers it. A second copy of the list is
// the copy that drifts. The purity the header is actually about is intact —
// coachMoney touches no Supabase, no browser and no clock, and evaluates
// nothing at module scope.
const coachMoney_1 = require("./coachMoney");
// The third, on the same amendment and the same grounds. Which DAY an instant
// fell on is a question this file was also answering wrongly — it was reading
// UTC's day off a stored timestamp and writing it into the column the importer
// reads — and gymZone.ts is the single place in TypeScript where a zone becomes
// a day. Its own header says so, and a second copy of that arithmetic is how a
// Sunday's takings come to sit in two places. The purity the header is about
// holds: gymZone evaluates nothing at module scope, imports nothing, and the
// one function used here takes its zone as an argument and asks `Intl`.
const gymZone_1 = require("./gymZone");
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
function csvCell(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'boolean')
        return v ? 'yes' : 'no';
    if (typeof v === 'number') {
        // NaN and Infinity are not figures. They are a bug upstream, and writing
        // "NaN" into a money column would launder one into the gym's record.
        if (!Number.isFinite(v))
            return '';
        return String(v);
    }
    const s = String(v);
    if (s === '')
        return '';
    if (NEEDS_QUOTES.test(s) || s !== s.trim())
        return '"' + s.replace(/"/g, '""') + '"';
    return s;
}
/** One row, already escaped, without its line ending. */
function csvRow(cells) {
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
function toCsv(header, rows, bom = true) {
    const lines = [csvRow(header), ...rows.map(csvRow)];
    return (bom ? '\uFEFF' : '') + lines.join('\r\n') + '\r\n';
}
/* ── values ────────────────────────────────────────────────────────────────── */
/**
 * Integer minor units as an exact decimal string, or '' for "never recorded".
 *
 * Deliberately string arithmetic. `(cents / 100).toFixed(2)` is a float
 * division and this is a ledger; the answer here is the same digits the
 * database holds with the point pushed left, which is a text operation, not a
 * numeric one.
 *
 * ── And the point is not always two places left ───────────────────────────
 *
 * This padded to three digits and sliced two, for every currency there is. A
 * gym in Tokyo exported ¥50,000 as "500.00" — an understatement of a hundred
 * times, in the file it hands an accountant — and a gym in Kuwait exported
 * KWD 12.340 as "123.40", ten times the sale. The readable half of the same
 * bundle was right the whole way through, because `money()` asks
 * `currencyDecimals`, so the two artefacts disagreed and neither said which to
 * believe.
 *
 * It also broke the round trip in both directions at once. `parseMoneyCents`
 * in src/lib/csvImport.ts is currency-aware now, so a file written at a flat
 * two places would re-import as a different amount — which is worse than
 * either fault alone, because an export that does not re-import is an export a
 * gym cannot move on.
 *
 * `currencyDecimals` in src/lib/coachMoney.ts is the one answer to how many
 * places this money has. Every caller below hands it the row's own currency,
 * and there is no row in this bundle that carries an amount without one.
 *
 * Null is empty rather than "0.00" — a pass with no recorded price is not a
 * free pass, and that distinction is the whole reason `paidCents` is nullable.
 * An UNKNOWN CURRENCY is empty for the same reason: `client_purchases` carries
 * none for a sale whose package has been deleted, and "45.00" of nothing is a
 * figure somebody would add up.
 */
function minorToDecimal(cents, currency) {
    if (cents === null || cents === undefined)
        return '';
    if (!Number.isFinite(cents) || !Number.isInteger(cents))
        return '';
    // How many places this money has, asked rather than assumed. Null — not 2 —
    // when nobody said which money it is, and an unstateable figure is an empty
    // cell beside the stored integer rather than a number in no currency at all.
    const dp = (0, coachMoney_1.currencyDecimals)(currency);
    if (dp == null)
        return '';
    if (dp === 0)
        return String(cents);
    const neg = cents < 0;
    // Padded to dp + 1 so a figure smaller than one whole unit keeps its leading
    // nought — 5 fils is "0.005", never ".005", which a spreadsheet reads as text.
    const digits = String(Math.abs(cents)).padStart(dp + 1, '0');
    return (neg ? '-' : '') + digits.slice(0, -dp) + '.' + digits.slice(-dp);
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
function isoDatePart(ts) {
    if (!ts)
        return '';
    return /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : '';
}
/**
 * The day a stored instant fell on AT THE GYM, for the columns the importer
 * reads — and the reason `isoDatePart` alone was not enough.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * `isoDatePart` reads UTC's day off the timestamp, because the first ten
 * characters of an ISO instant are UTC's date and nobody else's. Every payment
 * this product IMPORTED survives that: src/lib/gymImports.ts stamps them at
 * `T12:00:00Z`, so there is no zone on earth that moves them off their day.
 * A payment recorded natively at the desk carries the real instant — the money
 * screen writes one only when somebody picks a date — and a gym far enough from
 * UTC then exports the day either side of its own.
 *
 * That is not a cosmetic column. `date` is what `previewPayments` reads and
 * `gymImports` re-stamps at midday, so a bundle exported at the wrong day
 * RE-IMPORTS at the wrong day: the export a gym moves on with restates its own
 * takings into the neighbouring day, and on a month boundary into the
 * neighbouring month, on the file it hands an accountant. `taken_at` sits
 * beside it unchanged and is still the stored instant, so nothing is lost —
 * but the column that is read back is the one that has to be right.
 *
 * ── Why a zone-less gym still gets a day ──────────────────────────────────
 *
 * `gymDay` obeys the house rule and returns null when the gym has not set a
 * timezone. That is the right answer for bucketing a month's takings and the
 * wrong one here: blanking `date` for every gym that has not filled in a
 * setting would break the round trip outright, which is a far larger failure
 * than the one this closes. So it falls back to UTC's day, exactly as before,
 * and the bundle SAYS SO — `daysAt` in the manifest, the note on payments.csv
 * and the dates convention in the README all name which calendar was used.
 * That is the same bargain `gymWhen.ts` strikes with `atGym`, argued there.
 */
function gymDatePart(ts, zone) {
    return (0, gymZone_1.gymDay)(ts, zone) ?? isoDatePart(ts);
}
function daysAt(zone) {
    // Asked through `gymDay` itself rather than through `isZone`, so this cannot
    // answer 'gym' for a zone the formatter would then refuse.
    return (0, gymZone_1.gymDay)('2026-01-01T00:00:00.000Z', zone) ? 'gym' : 'utc';
}
/** A gym's name reduced to something safe in a filename. Empty names give ''. */
function slug(name) {
    return (name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}
exports.EXPORT_PARTS = [
    'plans', 'members', 'memberRecords', 'memberships', 'payments', 'invoices',
    'orders', 'reconciles', 'closes',
    'classes', 'attendance', 'sessions',
    'passTypes', 'passes', 'visits', 'invites',
    'settlements', 'adjustments', 'equipment', 'equipmentLog', 'shifts',
    'interventions', 'promos', 'events', 'purchases',
    'agreements', 'signatures', 'documents',
];
/** What each part is called in a sentence an owner reads. */
exports.EXPORT_LABEL = {
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
    orders: 'what members bought online',
    closes: 'the months that were signed off',
    adjustments: 'payroll adjustments',
    equipmentLog: 'the maintenance and accident book',
    reconciles: 'the reconciliation marks',
};
/** What leaving a part out of the bundle actually costs. Named so the warning
 *  says what the gym is *not taking with them*, not just what errored. */
exports.EXPORT_COST = {
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
    orders: 'every card payment the gym took online, and the Stripe reference each one reconciles to',
    closes: 'the figures each month was signed off on, who signed it, and what they were told was wrong at the time',
    adjustments: 'the bonuses, deductions, reimbursements and advances behind what the staff were actually paid',
    equipmentLog: 'when each machine was serviced, what the engineer found, and every incident recorded on one',
    reconciles: 'which payments and invoices somebody accepted as explained, and the reason they gave',
};
/** The basename each part writes to, before the bundle prefix. */
exports.EXPORT_FILE = {
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
    orders: 'online-orders.csv',
    closes: 'month-closes.csv',
    adjustments: 'payroll-adjustments.csv',
    equipmentLog: 'equipment-log.csv',
    reconciles: 'reconciliation-marks.csv',
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
exports.EXPORT_DATE_FIELD = {
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
    orders: 'created_at',
    // The month the close is ABOUT, not the day somebody pressed the button. An
    // accountant asking for a financial year means the twelve closes for those
    // months, and bounding on `closed_at` would drop a December close signed off
    // in the January after it — the one every year-end actually has.
    closes: 'month_key',
    // `applies_on` and not `created_at`, for the reason part 183 gives it: an
    // adjustment for last month entered this month belongs to last month.
    adjustments: 'applies_on',
    equipmentLog: 'happened_on',
    reconciles: 'marked_at',
};
/**
 * Why a period leaves a part whole, in the words the README prints.
 *
 * A reader who asked for one quarter and got the whole equipment register is
 * entitled to know whether that was a decision or a bug. Each of these is a
 * decision, and four of the seven would produce a WRONG file if they were
 * bounded — which is the opposite of what somebody would guess.
 */
exports.EXPORT_UNBOUNDED_WHY = {
    plans: 'a standing price list, with no event date to bound it by.',
    members: 'one row per person, derived from the memberships below it.',
    memberRecords: 'a standing file on each person, not a dated event.',
    memberships: 'a membership is a PERIOD, not an instant. One that ran all the way through your window may have started years before it, and bounding on its start date would drop exactly the memberships the window is about.',
    passTypes: 'a standing list of what a pass costs.',
    equipment: 'a standing register of what the gym owns.',
    promos: 'a standing list of codes.',
    agreements: 'the WORDING each signature points at. Bounding these to your window would leave a signature from inside it naming a version of the waiver that is not in the bundle, which is the position this file exists to get a gym out of.',
};
/** The slice a part is read from. `members` rides on `memberships`. */
function partSlice(input, part) {
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
        case 'orders': return input.orders;
        case 'closes': return input.closes;
        case 'adjustments': return input.adjustments;
        // Its own read, and deliberately not riding on `equipment`. A gym whose
        // register would not load still has an accident book, and an accident book
        // that came back empty because a different table failed is the worst file
        // in this bundle to be silently wrong about.
        case 'equipmentLog': return input.equipmentLog;
        case 'reconciles': return input.reconciles;
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
function rowDate(part, row) {
    const r = row;
    const str = (k) => {
        const v = r?.[k];
        return typeof v === 'string' && v.trim() ? v : null;
    };
    switch (part) {
        case 'plans':
        case 'members':
        case 'memberRecords':
        case 'memberships':
        case 'passTypes':
        case 'equipment':
        case 'promos':
        case 'agreements':
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
        case 'orders': return str('createdAt');
        // 'YYYY-MM' is not a date and `instantOf` will not parse one, so the month
        // is placed at its first day. A close is then INSIDE any window that
        // contains the start of the month it is about — which is the reading an
        // accountant asking for a quarter means, and the file says so.
        case 'closes': {
            const k = str('monthKey');
            return k && /^\d{4}-\d{2}$/.test(k) ? `${k}-01` : null;
        }
        case 'adjustments': return str('appliesOn');
        case 'equipmentLog': return str('happenedOn');
        case 'reconciles': return str('markedAt');
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
function windowSlices(input, w) {
    if (!(0, exportWindow_1.isBounded)(w))
        return { ...input, from: w.from, to: w.to };
    const cut = (part, s) => {
        if (s.state !== 'ready' || !exports.EXPORT_DATE_FIELD[part])
            return s;
        return { state: 'ready', rows: s.rows.filter((r) => (0, exportWindow_1.placeInWindow)(rowDate(part, r), w) !== 'outside') };
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
        orders: cut('orders', input.orders),
        closes: cut('closes', input.closes),
        adjustments: cut('adjustments', input.adjustments),
        equipmentLog: cut('equipmentLog', input.equipmentLog),
        reconciles: cut('reconciles', input.reconciles),
    };
}
/** How many rows of a part carry no date to place them by. Null when the part
 *  is unbounded or unread — which is not the same as none. */
function undatedRows(input, part) {
    const s = partSlice(input, part);
    if (s.state !== 'ready' || !exports.EXPORT_DATE_FIELD[part])
        return null;
    return s.rows.filter((r) => rowDate(part, r) === null).length;
}
/** The window statement for one part. */
function partWindow(part, bounded, undated) {
    const field = exports.EXPORT_DATE_FIELD[part];
    if (!bounded)
        return { bounded: false, field, why: null, undated: null };
    return field
        ? { bounded: true, field, why: null, undated }
        : { bounded: false, field: null, why: exports.EXPORT_UNBOUNDED_WHY[part] ?? 'no event date to bound it by.', undated: null };
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
function exportBlocker(input) {
    const pending = exports.EXPORT_PARTS.filter((p) => partSlice(input, p).state === 'loading');
    if (!pending.length)
        return null;
    const names = unique(pending.map((p) => exports.EXPORT_LABEL[p]));
    return `Still reading ${list(names)}. An export taken now would be missing rows that exist.`;
}
/**
 * The sentence that goes on the screen, at the top of the README, and into the
 * manifest when something could not be read. Null when the bundle is whole.
 */
function incompleteWarning(missing) {
    if (!missing.length)
        return null;
    const names = list(missing.map((m) => m.label));
    const costs = missing.map((m) => m.cost).join('; ');
    const n = missing.length;
    return (`THIS EXPORT IS NOT YOUR WHOLE RECORD. Could not read ${names}. ` +
        `${n === 1 ? 'That part is' : 'Those parts are'} MISSING from this bundle, not empty — ` +
        `${costs} ${n === 1 ? 'is' : 'are'} absent from every file here. ` +
        `Fix the read and export again before treating this as the gym's record.`);
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
exports.MEMBER_PARTS = [
    // First, because it is the part a subject-access response is least able to be
    // missing and the part this bundle went out without: their own file.
    'memberRecords',
    'memberships', 'payments', 'invoices', 'attendance', 'sessions',
    'passes', 'visits', 'invites', 'interventions', 'purchases', 'events',
    // What they bought online. `payments` is the DESK's register and holds none
    // of these, so a member who has only ever paid by card on their phone had an
    // empty payments.csv and nothing else — a subject-access response saying the
    // gym holds no record of their money.
    'orders',
    // What somebody wrote against their money. A mark reading "accepted — member
    // says they paid cash in March" is a note the gym made ABOUT this person, and
    // it is the kind of note a subject-access request is usually made to find.
    'reconciles',
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
function memberSlices(input, memberId) {
    const keep = (s, mine) => s.state === 'ready' ? { state: 'ready', rows: s.rows.filter(mine) } : s;
    const none = (s) => 
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
        // The gym's own books and its own building. A month close is four totals
        // for the whole gym, an adjustment is a coach's pay, and the accident book
        // carries no member column at all — none of the three is this person's
        // record, and handing them over would answer a request nobody made.
        closes: none(input.closes),
        adjustments: none(input.adjustments),
        equipmentLog: none(input.equipmentLog),
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
        orders: keep(input.orders, (o) => o.memberId === memberId),
        // Narrowed through the register the mark points AT, because the mark itself
        // names an invoice or a payment and never a person.
        reconciles: memberMarks(input, memberId),
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
/**
 * The reconciliation marks that are about ONE member's money.
 *
 * `gym_reconcile_marks` names an invoice id or a payment id and never a member,
 * so the only way to place a mark on a person is through the register it points
 * at. That makes this the one part of a member bundle whose scope DEPENDS on
 * two other reads, and the failure mode is the one this whole module exists to
 * prevent: with the invoices refused, filtering on the ids that did load would
 * produce a shorter list of marks and nothing anywhere would say it was short.
 *
 * So an unnarrowable part is UNREADABLE rather than empty. It comes out as the
 * same loudly-named stub, with INCOMPLETE in the filename and a line in the
 * README, and the sentence names the reason: the marks exist, they could not be
 * matched to this person, and this bundle is not their whole record.
 */
function memberMarks(input, memberId) {
    const marks = input.reconciles;
    if (marks.state !== 'ready')
        return marks;
    if (input.invoices.state !== 'ready' || input.payments.state !== 'ready') {
        const which = input.invoices.state !== 'ready' && input.payments.state !== 'ready'
            ? 'the invoice register and the payments'
            : input.invoices.state !== 'ready' ? 'the invoice register' : 'the payments';
        return {
            state: 'failed',
            reason: `a reconciliation mark names an invoice or a payment and never a member, so these could only be `
                + `narrowed to this person through ${which} — which did not read. The marks are NOT empty and they `
                + `are not included: they could not be matched.`,
        };
    }
    const mine = new Set([
        ...input.invoices.rows.filter((i) => i.memberId === memberId).map((i) => i.id),
        ...input.payments.rows.filter((p) => p.memberId === memberId).map((p) => p.id),
    ]);
    return { state: 'ready', rows: marks.rows.filter((m) => m.subjectId != null && mine.has(m.subjectId)) };
}
/** The agreement versions one member has a signature against. */
function keepSigned(agreements, signatures, memberId) {
    if (agreements.state !== 'ready')
        return agreements;
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
function memberRowCount(input, memberId) {
    // Windowed FIRST, for the same reason `buildGymExport` windows: the number
    // offered before the download has to be the number of rows the download
    // contains, and an owner told "412 rows" over a bundle holding 40 has been
    // given the one figure they were going to quote in a covering letter.
    const scoped = memberSlices(windowSlices(input, { from: input.from ?? null, to: input.to ?? null }), memberId);
    let n = 0;
    for (const part of exports.MEMBER_PARTS) {
        const s = partSlice(scoped, part);
        // One unreadable part makes the COUNT unknown rather than smaller. A
        // smaller number here would read as "this member has little on file".
        if (s.state !== 'ready')
            return null;
        n += s.rows.length;
    }
    return n;
}
/* ── the bundle ────────────────────────────────────────────────────────────── */
function buildGymExport(raw) {
    // The window is applied here, once, from the bounds the input states — so
    // there is no arrangement of calls in which the manifest names a period the
    // rows do not respect. A caller that has already narrowed loses nothing:
    // narrowing rows that are already inside the window is a no-op.
    const window = { from: raw.from ?? null, to: raw.to ?? null };
    const bounded = (0, exportWindow_1.isBounded)(window);
    const input = windowSlices(raw, window);
    const pending = exports.EXPORT_PARTS.filter((p) => partSlice(input, p).state === 'loading');
    const missing = [];
    for (const part of exports.EXPORT_PARTS) {
        const s = partSlice(input, part);
        if (s.state === 'failed') {
            missing.push({
                part,
                label: exports.EXPORT_LABEL[part],
                cost: exports.EXPORT_COST[part],
                reason: s.reason,
                file: '',
            });
        }
        else if (s.state === 'partial') {
            // A TRUNCATED read is reported here rather than written out as a CSV,
            // and that is a deliberate choice against the rows in hand.
            //
            // The rows are real. Writing them would produce a file that looks exactly
            // like the whole set: same name, same columns, a plausible row count, and
            // nothing anywhere in the bundle saying it is a prefix once the folder has
            // been copied somewhere else. src/lib/rowCap.ts's header is about exactly
            // this — a truncated read is worse than a failed one because it succeeds,
            // quietly, with the wrong answer — and an export is the artefact most
            // likely to outlive the screen that produced it and be read by somebody
            // who never saw a banner.
            //
            // So it takes the same shape as a failure: a named stub, `complete` false,
            // and INCOMPLETE in the filename. The reason says which of the two it is,
            // because "we could not read this" and "we read the first thousand of it"
            // send whoever fixes it to two different places.
            missing.push({
                part,
                label: exports.EXPORT_LABEL[part],
                cost: exports.EXPORT_COST[part],
                reason: `the read came back at its ${s.cap}-row limit, so what arrived is a PREFIX of this part ` +
                    `rather than all of it — a file holding part of a set, named as though it held the set, ` +
                    `is the one thing this bundle must never contain`,
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
            label: exports.EXPORT_LABEL[part],
            cost: exports.EXPORT_COST[part],
            reason: 'still loading when the export was taken',
            file: '',
        });
    }
    missing.sort((a, b) => exports.EXPORT_PARTS.indexOf(a.part) - exports.EXPORT_PARTS.indexOf(b.part));
    const complete = missing.length === 0;
    // The gym's day, not UTC's, for the same reason the `date` column is: a
    // bundle taken at 01:00 on 1 September in Auckland is a September export and
    // filing it as `taken-2026-08-31` is how it gets sent as the wrong one. Falls
    // back to UTC's day where the gym has no zone — `gymDatePart` says why.
    const day = gymDatePart(input.generatedAt, input.timezone) || 'undated';
    // The period, in the filename, before the day it was taken. A bundle sitting
    // in a Downloads folder among four others is read by its NAME long before
    // anybody opens the README, and "this is the first quarter, not the record"
    // is the fact most likely to be lost between one and the other. `taken-`
    // labels the trailing date so two dates in one name cannot be misread.
    const span = (0, exportWindow_1.windowSlug)(window);
    const stem = input.subject
        // Named for the person, so a folder of these does not need opening to tell
        // one member's record from another's — and so a whole-gym backup can never
        // be mistaken for a subject-access response by its filename alone.
        ? ['repple-member-record', slug(input.gymName), slug(input.subject.memberName) || input.subject.memberId.slice(0, 8), span, span ? 'taken-' + day : day].filter(Boolean).join('-')
        : ['repple-export', slug(input.gymName), span, span ? 'taken-' + day : day].filter(Boolean).join('-');
    const prefix = complete ? stem : stem + '-INCOMPLETE';
    const named = (basename) => `${prefix}-${basename}`;
    for (const m of missing)
        m.file = named(exports.EXPORT_FILE[m.part].replace(/\.csv$/, '') + '-NOT-EXPORTED.txt');
    const caveats = [];
    const files = [];
    const reports = [];
    const emailsKnown = input.invites.state === 'ready';
    if (!emailsKnown && input.memberships.state === 'ready') {
        caveats.push('members.csv has no email column: addresses are only held on invite rows, and the invites ' +
            'read did not come back. The column is absent rather than blank, because a blank one would ' +
            'read as "this member has no email address".');
    }
    if (bounded) {
        caveats.push(`This is a SLICE of the record, not the record. It covers ${(0, exportWindow_1.describeWindow)(window)}; ` +
            'anything the gym holds outside those dates is absent from every file here and is not ' +
            'missing, not deleted and not zero. The README lists which files the period actually ' +
            'narrowed and which are whole whatever it says.');
    }
    if (input.subject && input.signatures.state !== 'ready') {
        caveats.push('agreements.csv holds EVERY version this gym publishes rather than only the ones this ' +
            'member signed. Which ones they signed is on the signatures read, and that read did not ' +
            'come back, so narrowing them would have been a guess about what somebody agreed to.');
    }
    // Counted rather than dropped, and said out loud. A row with no date could
    // not be placed inside or outside the period, and leaving it out would have
    // asserted that it happened elsewhere.
    if (bounded) {
        const stray = [];
        for (const part of exports.EXPORT_PARTS) {
            const n = undatedRows(input, part);
            if (n)
                stray.push(`${exports.EXPORT_FILE[part]} (${n})`);
        }
        if (stray.length) {
            caveats.push(`Some rows carry no date to place them by, so they could not be put inside or outside ` +
                `the period: ${stray.join(', ')}. They are INCLUDED. Leaving them out would have said ` +
                `they happened outside your dates, and nothing here knows that.`);
        }
    }
    for (const part of exports.EXPORT_PARTS) {
        const s = partSlice(input, part);
        if (s.state !== 'ready') {
            const m = missing.find((x) => x.part === part);
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
                label: exports.EXPORT_LABEL[part],
                file: m.file,
                status: 'unavailable',
                rows: null,
                reason: m.reason,
                columns: null,
                note: `Not in this bundle. ${capitalise(exports.EXPORT_COST[part])} is unknown here — absent, not zero.`,
                window: partWindow(part, bounded, null),
            });
            continue;
        }
        const table = tableFor(part, input);
        const name = named(exports.EXPORT_FILE[part]);
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
            label: exports.EXPORT_LABEL[part],
            file: name,
            status: 'exported',
            rows: table.rows.length,
            reason: null,
            columns: table.header,
            note: table.note,
            window: partWindow(part, bounded, undatedRows(input, part)),
        });
    }
    const manifest = {
        app: 'Repple',
        kind: input.subject ? 'member-record-export' : 'gym-record-export',
        subject: input.subject ? { memberId: input.subject.memberId, memberName: input.subject.memberName } : null,
        formatVersion: 1,
        gym: input.gymName ?? null,
        tenantId: input.tenantId ?? null,
        exportedAt: input.generatedAt,
        timezone: input.timezone ?? null,
        daysAt: daysAt(input.timezone),
        window: {
            from: window.from,
            to: window.to,
            bounded,
            covers: (0, exportWindow_1.describeWindow)(window),
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
        conventions: conventionsFor(input.timezone),
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
function tableFor(part, input) {
    switch (part) {
        case 'plans': return plansTable(readyRows(input.plans));
        case 'members': return membersTable(input);
        case 'memberships': return membershipsTable(readyRows(input.memberships));
        case 'payments': return paymentsTable(readyRows(input.payments), input.timezone);
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
        case 'orders': return ordersTable(readyRows(input.orders));
        case 'closes': return closesTable(readyRows(input.closes));
        case 'adjustments': return adjustmentsTable(readyRows(input.adjustments));
        case 'equipmentLog': return equipmentLogTable(readyRows(input.equipmentLog));
        case 'reconciles': return reconcilesTable(readyRows(input.reconciles));
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
function memberRecordsTable(rows) {
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
function agreementsTable(rows) {
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
function signaturesTable(rows) {
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
const ATTRIBUTION_MEANS = {
    member: 'The member gave this themselves, from their own signed-in account, against this version of the wording.',
    staff: 'A member of staff recorded this on the member\u2019s behalf. It is a staff attestation that the member agreed. It is NOT the member\u2019s own signature.',
    unknown: 'Written before this product recorded who typed a signature. It is not known whether the member gave it or a member of staff entered it for them, and nothing here will guess.',
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
function documentsTable(rows) {
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
function invoicesTable(rows) {
    return {
        header: ['invoice_number', 'issued_on', 'due_on', 'member_name', 'member_id', 'amount', 'currency', 'amount_cents', 'status', 'note', 'invoice_id'],
        rows: rows.map((i) => [
            i.number, i.issuedOn, i.dueOn, i.memberName, i.memberId,
            minorToDecimal(i.amountCents, i.currency), i.currency, i.amountCents,
            i.status, i.note, i.id,
        ]),
        note: 'What the gym billed. A blank amount is an invoice that records none — it is not a free one. `status` is the register\u2019s own word; overdue is computed from due_on and is not stored.',
    };
}
/** Payroll settlements — money that actually left the account. */
function settlementsTable(rows) {
    return {
        header: ['settled_at', 'trainer_name', 'trainer_id', 'period_from', 'period_to', 'amount', 'currency', 'amount_cents', 'sessions', 'method', 'reversed_at', 'reverse_reason', 'settlement_id'],
        rows: rows.map((r) => [
            r.settledAt, r.trainerName, r.trainerId, r.periodFrom, r.periodTo,
            minorToDecimal(r.amountCents, r.currency), r.currency, r.amountCents,
            r.sessionsCount, r.method, r.reversedAt, r.reverseReason, r.id,
        ]),
        note: 'Amounts are snapshots of what was handed over and are never recomputed. A row with reversed_at set was TAKEN BACK — it is kept because a settlement that was recorded and then withdrawn is two facts, and it must not be counted as money out.',
    };
}
/** The equipment register. */
function equipmentTable(rows) {
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
function shiftsTable(rows) {
    return {
        header: ['starts_at', 'ends_at', 'trainer_name', 'trainer_id', 'role', 'status', 'note', 'shift_id'],
        rows: rows.map((s) => [s.startsAt, s.endsAt, s.trainerName, s.trainerId, s.role, s.status, s.note, s.id]),
        note: 'Who was rostered. `gym_shifts` carries no rate, so this file says who was on the floor and cannot say what the floor cost to staff.',
    };
}
/** Member contact — the record that anybody was ever spoken to. */
function interventionsTable(rows) {
    return {
        header: ['at', 'member_name', 'member_id', 'channel', 'outcome', 'contacted_by', 'contacted_by_id', 'note', 'intervention_id'],
        rows: rows.map((i) => [i.at, i.memberName, i.memberId, i.channel, i.outcome, i.byName, i.byId, i.note, i.id]),
        note: 'The only record in this product that a member was contacted about drifting away — it is what answers a member who says nobody ever got in touch. What FOLLOWED a contact is not here: that is computed from training either side of it, it changes as more training is recorded, and a snapshot of it in a file would be a judgement dressed as a fact.',
    };
}
/** Promo codes. */
function promosTable(rows) {
    return {
        header: ['code', 'discount_pct', 'active', 'redemptions', 'created_at', 'promo_id'],
        rows: rows.map((p) => [p.code, p.discount, p.active == null ? '' : p.active, p.redemptions, p.createdAt, p.id]),
        note: 'A redemption count with no amount beside it is deliberate: nothing records which payment a redemption applied to, so a percentage of an unknown price is not an amount and none is written.',
    };
}
/** The activity log. */
function eventsTable(rows) {
    return {
        header: ['at', 'kind', 'summary', 'subject_id', 'actor_id', 'event_id'],
        rows: rows.map((e) => [e.at, e.kind, e.summary, e.subjectId, e.actorId, e.id]),
        note: 'Written by database triggers as things happened, so nothing here was typed by anyone. The summary was composed at write time and names people as they were called then — it does not change when somebody is renamed or erased.',
    };
}
/** PT packs sold through the coaches' own checkout. */
function purchasesTable(rows) {
    return {
        header: ['created_at', 'trainer_name', 'trainer_id', 'client_id', 'amount', 'currency', 'amount_cents', 'sessions_total', 'sessions_used', 'status', 'purchase_id'],
        rows: rows.map((p) => [
            p.createdAt, p.trainerName, p.trainerId, p.clientId,
            minorToDecimal(p.amountCents, p.currency), p.currency, p.amountCents,
            p.sessionsTotal, p.sessionsUsed, p.status, p.id,
        ]),
        note: '`client_purchases` carries no tenant column, so these rows are scoped by the trainers on this gym\u2019s roster — a purchase against a coach who has since left the roster is not here. A blank currency means the package it was sold from has been deleted and the unit is unrecoverable; it is never guessed.',
    };
}
/* ── the five after those ──────────────────────────────────────────────────── */
/**
 * The order book — card money taken online.
 *
 * Two money columns and both of them go through `minorToDecimal`, so a row
 * whose amount could not be read is blank rather than free. `stripe_session_id`
 * and `stripe_payment_intent` are here because they are the only join between
 * this file and the gym's own Stripe payouts; without them an owner
 * reconciling a settlement has two lists of amounts and no key.
 */
function ordersTable(rows) {
    return {
        header: [
            'created_at', 'paid_at', 'status', 'member_name', 'member_id', 'kind', 'intent',
            'amount', 'currency', 'amount_cents',
            'term_starts_on', 'term_ends_on', 'uses_total', 'expires_on',
            'plan_id', 'pass_type_id', 'membership_id', 'pass_id',
            'stripe_account_id', 'stripe_session_id', 'stripe_payment_intent', 'failure_note', 'order_id',
        ],
        rows: rows.map((o) => [
            o.createdAt, o.paidAt, o.status, o.memberName, o.memberId, o.kind, o.intent,
            minorToDecimal(o.amountCents, o.currency), o.currency, o.amountCents,
            o.termStartsOn, o.termEndsOn, o.usesTotal, o.expiresOn,
            o.planId, o.passTypeId, o.membershipId, o.passId,
            o.stripeAccountId, o.stripeSessionId, o.stripePaymentIntent, o.failureNote, o.id,
        ]),
        note: 'Card money taken online, which is NOT in payments.csv — that file is the desk\u2019s own register. '
            + 'A status of "failed" does not mean the payment failed: it means Stripe took the money and the '
            + 'membership or pass could not be written, so a row with status=failed and an empty membership_id '
            + 'is somebody who paid and got nothing. A "pending" row older than a day or two is an order Stripe '
            + 'never told us the end of.',
    };
}
/**
 * The months that were signed off, and what was wrong at the time.
 *
 * Every figure is written blank where none was recorded. A close with an empty
 * `taken` is a month somebody signed off while the takings were showing a dash,
 * and printing a 0 there would turn "we did not know" into "we took nothing" in
 * a file an accountant reconciles a return against.
 */
function closesTable(rows) {
    return {
        header: [
            'month_key', 'closed_at', 'closed_by', 'closed_by_id',
            'taken', 'invoiced', 'outstanding', 'payroll', 'currency',
            'taken_cents', 'invoiced_cents', 'outstanding_cents', 'payroll_cents',
            'unmarked_sessions', 'blockers_at_close', 'note',
            'reopened_at', 'reopened_by', 'reopened_by_id', 'reopen_reason', 'close_id',
        ],
        rows: rows.map((c) => [
            c.monthKey, c.closedAt, c.closedByName, c.closedById,
            minorToDecimal(c.takenCents, c.currency), minorToDecimal(c.invoicedCents, c.currency),
            minorToDecimal(c.outstandingCents, c.currency), minorToDecimal(c.payrollCents, c.currency), c.currency,
            c.takenCents, c.invoicedCents, c.outstandingCents, c.payrollCents,
            c.unmarkedSessions, c.blockersAtClose, c.note,
            c.reopenedAt, c.reopenedByName, c.reopenedById, c.reopenReason, c.id,
        ]),
        note: 'The figures AS THEY STOOD when the month was signed off. They are snapshots and are never '
            + 'recomputed, so a close will disagree with a fresh sum over the same month once anything is '
            + 'backdated into it \u2014 that disagreement is the record, not an error. `blockers_at_close` is what '
            + 'the screen was refusing about when somebody closed it anyway. A row with `reopened_at` set was '
            + 'undone afterwards and is kept: a close and its reopening are two facts.',
    };
}
/** Payroll adjustments — the lines that made a settlement the figure it was. */
function adjustmentsTable(rows) {
    return {
        header: ['applies_on', 'trainer_name', 'trainer_id', 'kind', 'amount', 'currency', 'amount_cents', 'note', 'settlement_id', 'created_at', 'created_by', 'created_by_id', 'adjustment_id'],
        rows: rows.map((a) => [
            a.appliesOn, a.trainerName, a.trainerId, a.kind,
            minorToDecimal(a.amountCents, a.currency), a.currency, a.amountCents,
            a.note, a.settlementId, a.createdAt, a.createdByName, a.createdById, a.id,
        ]),
        note: 'Amounts are SIGNED and the sign already carries the kind: a deduction and an advance are negative, '
            + 'a bonus and a reimbursement positive. Sum the column as it stands; applying the kind a second time '
            + 'doubles it. `applies_on` is the period the line belongs to, which is not the day it was entered. '
            + 'A blank settlement_id is a line not yet paid out.',
    };
}
/** The maintenance history and the accident book. */
function equipmentLogTable(rows) {
    return {
        header: ['happened_on', 'kind', 'equipment_label', 'equipment_id', 'performed_by', 'findings', 'cost', 'currency', 'cost_cents', 'reported_to', 'document_id', 'recorded_by', 'recorded_by_id', 'created_at', 'entry_id'],
        rows: rows.map((e) => [
            e.happenedOn, e.kind, e.equipmentLabel, e.equipmentId, e.performedBy, e.findings,
            minorToDecimal(e.costCents, e.currency), e.currency, e.costCents,
            e.reportedTo, e.documentId, e.recordedByName, e.recordedById, e.createdAt, e.id,
        ]),
        note: 'Servicing, repairs, inspections and INCIDENTS, in one file because they are one question after a '
            + 'claim. A blank equipment_id beside a filled equipment_label is a machine that has since been '
            + 'retired \u2014 the entry outlives it deliberately, because the record of an accident must not be '
            + 'deleted by disposing of the machine it happened on. `document_id` points into documents.csv; the '
            + 'file itself is bytes in a bucket and does not travel in a CSV bundle.',
    };
}
/** Which lines somebody accepted, which they flagged, and why. */
function reconcilesTable(rows) {
    return {
        header: ['marked_at', 'subject_kind', 'subject_id', 'state', 'note', 'marked_by', 'marked_by_id', 'mark_id'],
        rows: rows.map((m) => [m.markedAt, m.subjectKind, m.subjectId, m.state, m.note, m.markedByName, m.markedById, m.id]),
        note: '`subject_id` is an invoice id when subject_kind is "invoice" and a payment id when it is "payment" '
            + '\u2014 join it to invoices.csv or payments.csv accordingly. One live mark per line: changing your mind '
            + 'replaced the row rather than adding one, so this file is the current answer and not a history of '
            + 'the arguing. An "accepted" row always carries a reason, because the database refuses one without.',
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
function plansTable(rows) {
    return {
        header: ['name', 'price', 'interval', 'currency', 'active', 'plan_id', 'price_cents'],
        rows: rows.map((p) => [
            p.name,
            minorToDecimal(p.priceCents, p.currency),
            p.interval,
            p.currency,
            p.active,
            p.id,
            p.priceCents,
        ]),
        note: 'Re-importable by previewPlans. price_cents is the stored figure; price is the same value for the importer, written to the number of decimal places the row\u2019s own currency has \u2014 none in a yen, three in a Kuwaiti dinar \u2014 which is why the currency column has to travel beside it.',
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
function membersTable(input) {
    const ms = readyRows(input.memberships);
    const invites = input.invites.state === 'ready' ? input.invites.rows : null;
    const byMember = new Map();
    for (const m of ms) {
        if (!m.memberId)
            continue;
        const at = byMember.get(m.memberId);
        if (at)
            at.push(m);
        else
            byMember.set(m.memberId, [m]);
    }
    const emailFor = new Map();
    for (const i of invites ?? []) {
        if (i.acceptedBy && i.email && !emailFor.has(i.acceptedBy))
            emailFor.set(i.acceptedBy, i.email);
    }
    const header = invites
        ? ['name', 'email', 'plan', 'started', 'ends', 'status', 'member_id']
        : ['name', 'plan', 'started', 'ends', 'status', 'member_id'];
    const rows = [];
    for (const [memberId, list] of byMember) {
        const cur = describesThemToday(list);
        const cells = [cur.memberName];
        if (invites)
            cells.push(emailFor.get(memberId) ?? null);
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
function describesThemToday(ms) {
    const rank = (m) => (m.status === 'active' ? 3 : m.status === 'frozen' ? 2 : 1);
    return [...ms].sort((a, b) => rank(b) - rank(a) || String(b.startedOn).localeCompare(String(a.startedOn)))[0];
}
function membershipsTable(rows) {
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
function paymentsTable(rows, zone) {
    const at = daysAt(zone);
    return {
        header: [
            'member', 'email', 'amount', 'date', 'method', 'note',
            'payment_id', 'member_id', 'amount_cents', 'currency', 'taken_at',
        ],
        rows: rows.map((p) => [
            p.memberName,
            null,
            minorToDecimal(p.amountCents, p.currency),
            gymDatePart(p.takenAt, zone),
            p.method,
            p.note,
            p.id,
            p.memberId,
            p.amountCents,
            p.currency,
            p.takenAt,
        ]),
        note: 'Re-importable by previewPayments. amount_cents and taken_at are the stored values; amount and date are the same values in the shapes the importer reads. `amount` is written to the number of decimal places `currency` has, so a file re-imported into a gym set to a DIFFERENT currency would be read at a different factor \u2014 previewPayments refuses any row whose currency column disagrees with the one it is importing in, rather than converting at par. '
            + (at === 'gym'
                ? `\`date\` is the day \`taken_at\` fell on IN THIS GYM'S OWN TIMEZONE (${String(zone)}), which is the day the till recorded and the day this file re-imports on. \`taken_at\` beside it is the stored instant, unchanged, and the two can name different days for a payment taken near midnight \u2014 that is not a disagreement, it is the same moment on two clocks.`
                : '`date` is the UTC day of `taken_at`, because this gym has not set a timezone and there is no other calendar to use \u2014 the reader\u2019s own laptop is not one, since this file outlives the browser that made it. That is the day the gym recorded for every payment this product imported (they are stamped at midday UTC, so no zone moves them) but can be a day either side for one taken near midnight at a desk far from UTC. Set the gym\u2019s timezone in Settings and export again to have this column written on the gym\u2019s own calendar; `taken_at` beside it is the stored instant either way and is the one to believe.'),
    };
}
function classesTable(rows) {
    return {
        header: ['class_id', 'title', 'room', 'instructor', 'trainer_id', 'starts_at', 'duration_min', 'capacity', 'booked', 'attended'],
        rows: rows.map((c) => [c.id, c.title, c.room, c.instructor, c.trainerId, c.startsAt, c.durationMin, c.capacity, c.booked, c.attended]),
        note: 'booked and attended are counted from the same booking rows that attendance.csv lists in full.',
    };
}
function attendanceTable(rows) {
    return {
        header: ['booking_id', 'class_id', 'class_title', 'class_starts_at', 'member_id', 'status', 'attended_at'],
        rows: rows.map((b) => [b.bookingId, b.classId, b.classTitle, b.startsAt || null, b.memberId, b.status, b.attendedAt]),
        note: 'An empty attended_at means nobody ticked the member off — which is not the same as absent.',
    };
}
function sessionsTable(rows) {
    return {
        header: [
            'session_id', 'trainer_id', 'trainer_name', 'client_id', 'client_name',
            'starts_at', 'duration_min', 'slot_status', 'outcome', 'outcome_at',
            'rate_cents', 'rate', 'settlement_id',
        ],
        rows: rows.map((s) => [
            s.id, s.trainerId, s.trainerName, s.clientId, s.clientName,
            s.startsAt, s.durationMin, s.status, s.outcome, s.outcomeAt,
            s.rateCents, minorToDecimal(s.rateCents, s.rateCurrency), s.settlementId,
        ]),
        note: 'An empty outcome means nobody has said what happened. It is not a no-show, and it was never treated as one.',
    };
}
function passTypesTable(rows) {
    return {
        header: ['pass_type_id', 'name', 'kind', 'price_cents', 'price', 'currency', 'uses', 'valid_days', 'active'],
        rows: rows.map((t) => [t.id, t.name, t.kind, t.priceCents, minorToDecimal(t.priceCents, t.currency), t.currency, t.uses, t.validDays, t.active]),
        note: 'An empty valid_days means the pass does not expire.',
    };
}
function passesTable(rows) {
    return {
        header: [
            'pass_id', 'pass_type_id', 'pass_type_name', 'kind', 'holder_id', 'holder_name',
            'host_member_id', 'issued_on', 'expires_on', 'uses_total', 'uses_spent',
            'paid_cents', 'paid', 'currency', 'note',
        ],
        rows: rows.map((p) => [
            p.id, p.passTypeId, p.passTypeName, p.kind, p.holderId, p.holderName,
            p.hostMemberId, p.issuedOn, p.expiresOn, p.usesTotal, p.usesSpent,
            p.paidCents, minorToDecimal(p.paidCents, p.currency), p.currency, p.note,
        ]),
        note: 'uses_total and uses_spent are exported raw and never differenced here — a clamped "uses left" would hide a counter that is out of step. An empty paid_cents means no price was recorded, not that it was free.',
    };
}
function visitsTable(rows) {
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
function invitesTable(rows) {
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
/**
 * The reader's key to the whole bundle — and a function rather than a constant,
 * because one line of it is a fact about THIS gym.
 *
 * It was a module constant, and two of its entries had gone stale against the
 * code that writes the files: `money` still promised "two-decimal strings" long
 * after `minorToDecimal` became currency-aware, which is a README telling a
 * Japanese gym its yen column has a fractional part; and `dates` said nothing
 * at all about which calendar the date-only columns are on, which is the entire
 * question `gymDatePart` exists to answer.
 */
function conventionsFor(zone) {
    const at = daysAt(zone);
    return {
        money: 'Held and exported as integer minor units (fils/cents) in the *_cents columns. ' +
            'The plain price/amount/paid/rate columns are the same figures written as exact ' +
            'decimal strings for spreadsheet and importer use, to the number of places the ' +
            'row’s own currency has — two for GBP, none at all for JPY, three for KWD. ' +
            'An amount whose currency this gym never recorded is left EMPTY rather than ' +
            'written at a number of places nobody chose. Nothing is rounded.',
        dates: 'ISO 8601 exactly as stored. Timestamps keep their time and zone; the date-only ' +
            'columns the importer reads sit beside them, never instead of them. ' +
            (at === 'gym'
                ? `Those date-only columns are written on THIS GYM'S calendar (${String(zone)}), so the day beside a payment is the day the till recorded it — which is a different day from the timestamp's UTC date for anything taken near midnight.`
                : 'This gym has not set a timezone, so those date-only columns are UTC’s day. For a gym far from UTC that is a day either side of its own for anything recorded near midnight. Set the timezone in Settings and export again.'),
        empty: 'An empty cell means the gym never recorded a value. It is never 0, never "null", ' +
            'and never a dash. A member with no recorded weight did not weigh nothing.',
        quoting: 'RFC 4180. A field containing a comma, semicolon, tab, pipe, quote or line break is ' +
            'quoted, and an inner quote is doubled. Names like O’Brien, "Bob" Smith and ' +
            'Smith, Jr. survive intact.',
        encoding: 'UTF-8 with a byte-order mark, CRLF line endings.',
    };
}
function notExportedText(m, input) {
    return [
        'THIS PART OF THE RECORD IS NOT IN THIS EXPORT.',
        '',
        `Part:    ${exports.EXPORT_LABEL[m.part]}`,
        `File:    ${exports.EXPORT_FILE[m.part]} was NOT written.`,
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
function readmeText(manifest, missing) {
    const out = [];
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
                out.push(`  - ${exports.EXPORT_FILE[p.part]}  (by ${p.window.field}${stray})`);
            }
            out.push('');
        }
        if (whole.length) {
            out.push('NOT narrowed — the whole set is here whatever period you asked for:');
            for (const p of whole) {
                out.push(`  - ${exports.EXPORT_FILE[p.part]}  ${p.window.why ?? ''}`);
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
    }
    else {
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
    // Which calendar the day-only columns are on, beside the instant rather than
    // buried in the conventions at the bottom. A reader who takes only this block
    // away is the reader most likely to add a column up by day.
    out.push(manifest.daysAt === 'gym'
        ? `Days:     the gym’s own calendar, ${manifest.timezone}`
        : 'Days:     UTC — this gym has not set a timezone, so the date-only columns are UTC’s day and can be a day either side of the gym’s own');
    out.push('');
    out.push('Files');
    out.push('-----');
    for (const p of manifest.parts) {
        if (p.status === 'exported') {
            out.push(`${p.file}  — ${p.label}, ${p.rows} ${p.rows === 1 ? 'row' : 'rows'}`);
        }
        else {
            out.push(`${p.file}  — ${p.label}: NOT EXPORTED (${p.reason})`);
        }
        if (p.note)
            out.push(`    ${p.note}`);
    }
    out.push('');
    if (manifest.caveats.length) {
        out.push('Caveats');
        out.push('-------');
        for (const c of manifest.caveats)
            out.push(`  - ${c}`);
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
function readyRows(s) {
    return s.state === 'ready' ? s.rows : [];
}
function unique(xs) {
    return [...new Set(xs)];
}
function list(names) {
    if (names.length === 0)
        return 'nothing';
    if (names.length === 1)
        return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
function capitalise(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}
