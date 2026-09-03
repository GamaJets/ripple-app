"use strict";
// A statement of what this app recorded, for a period the coach chose.
//
// ── The thing that was asked for, and the thing that may honestly be built ──
//
// The roadmap line was "payout scheduling and tax export: Connect pays out;
// nothing summarises a year". Half of that cannot be built from this repo and
// the other half must not be called what it was called.
//
// PAYOUTS. This paragraph used to read "nothing in this app is ever told about
// one … no column anywhere that could hold a payout id, an arrival date, a fee
// or a balance", and it stopped being true at part 194. The stripe-webhook
// mirrors `payout.paid`, `payout.failed`, `payout.updated` and
// `payout.canceled` into `coach_payouts`, which carries the amount, the
// currency, Stripe's own status and the arrival date. So the statement handed
// to an accountant was missing HALF of the one reconciliation an accountant
// actually performs — sales against bank receipts — while the data for the
// other half sat in this database and was rendered on the Money screen.
//
// Payouts that Stripe says ARRIVED are therefore now a section of their own,
// counted on the day they reached the bank. Two things are still refused:
//
//   · A SCHEDULE. Knowing four payouts happened says nothing about when the
//     fifth will be sent, and a rendered timetable would be a promise about
//     when somebody's rent money lands. `payoutFacts()` still says so.
//   · A SUBTRACTION. A payout is a BALANCE — many charges at once, less
//     Stripe's fees, less the platform's, less refunds, on Stripe's own
//     schedule — so it does not correspond to any sale on this document, and
//     "sold 4,800 · received 4,281 · fees 519" would be three numbers about
//     three different sets of transactions. Nothing here subtracts one from the
//     other and the section says why.
//
// A payout in transit is NOT counted. Money on its way to a bank is not money
// in one, and it is the arrived figure a coach reconciles a bank statement
// against.
//
// A TAX EXPORT. Tax treatment turns on the coach's country, their registration
// status, where their client is and what was sold — none of which this app
// knows or asks. supabase/parts/138 already settled the principle for a coach's
// invoice and this holds the identical line: no tax is calculated, the concepts
// are ABSENT rather than zeroed, and the document says so on its own face. What
// a coach at the end of a year actually needs is a statement of what this app
// recorded, clearly labelled as that, to hand to an accountant beside the
// Stripe records. That is what this builds.
//
// ── What the statement claims ──────────────────────────────────────────────
//
// Ten sections, each with its period named and its source named:
//
//   sessions delivered      counted, never priced — see `SESSIONS_NOT_MONEY`
//   packs and memberships   what Stripe told this app it charged
//   subscription renewals   the same, one row per paid invoice
//   payments recorded here  cash and transfers, the coach's own word (part 170)
//   invoices issued         the coach's own documents, their own claim
//   late-cancellation fees  recorded here, charged by nobody here
//   payouts that arrived    what Stripe says reached the bank, never netted
//   money given back        refunds on a sale or a renewal, never netted
//   chargebacks raised      what a card issuer took back, never netted
//   costs recorded here     what the coach says went out (part 450)
//
// The last three are the ones this document did not have, and their absence was
// not a gap so much as a slant: every figure on it was money IN. A coach who
// refunded four sales, lost a chargeback and paid a year of gym rent handed
// their accountant a statement showing the sales at full value and no penny of
// any of it, and this app held rows for all three. Nothing is SUBTRACTED by
// adding them — see `REFUNDS_ARE_NOT_NETTED`, `DISPUTES_ARE_NOT_NETTED` and
// `COSTS_ARE_NEVER_NETTED`, which are three statements of one rule — but both
// sides are now on the page for the person whose job is the difference.
//
// ── What it refuses to claim ───────────────────────────────────────────────
//
// * **No figure without a currency somebody chose.** Every amount goes through
//   coachMoney.ts, whose `moneyIn` returns null rather than guessing a unit.
//   `tenants.currency` is nullable on purpose and 35 of 54 live tenants have it
//   NULL today; part 150 removed the last database defaults. An amount that
//   cannot be denominated is WITHHELD and the reason is printed.
//
// * **Never a sum across currencies.** `sumTaken` produces one pot per
//   currency and this file never flattens them. AED 600 plus GBP 90 is not 690
//   of anything.
//
// * **Never a total over a read that was not whole.** `LoadStatus` is
//   `loading | ready | partial | error`, and a count or a total is stated only
//   under 'ready'. A confident zero over a failed read, in a financial summary,
//   is the worst version of this app's worst defect: it tells a self-employed
//   person they earned nothing.
//
// * **Never the same money twice.** Packs and renewals are disjoint by
//   construction — the stripe-webhook writes `client_purchases` only when
//   `sess.mode !== 'subscription'` — so those two may be combined, and only
//   those two. Invoices are NOT added to them: a coach who issues a document
//   for a pack Stripe already took would otherwise have it counted twice, and
//   this file says so rather than quietly picking one.
//
// * **Never a period this app chose.** `PERIOD_IS_YOURS` says outright that
//   the period is a calendar period the coach picked and that this app does not
//   know which period anybody's accountant works to.
//
// Pure, framework-free and asserted against under plain `node`. The reads live
// in src/ui/coachStatement.ts; nothing here touches Supabase.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LATE_FEES_ONLY_CURRENT_CLIENTS = exports.LATE_FEES_NOT_TAKINGS = exports.DISPUTES_ARE_NOT_NETTED = exports.REFUNDS_ARE_A_RUNNING_TOTAL = exports.REFUNDS_ARE_NOT_NETTED = exports.INVOICES_NOT_ADDED = exports.SESSIONS_NOT_MONEY = exports.PERIOD_IS_YOURS = exports.PERIOD_UNREADABLE = exports.STATEMENT_STRIPE_IS_THE_RECORD = exports.PAYOUTS_ONLY_ARRIVED = exports.PAYOUTS_ARE_NOT_NETTED = exports.RECEIPTS_ARE_YOUR_WORD = exports.STATEMENT_NOT_THE_WHOLE_BOOK = exports.STATEMENT_IS = exports.STATEMENT_NOT = exports.YEAR_START_IS_YOURS = exports.isCalendarStart = exports.CALENDAR_YEAR_START = void 0;
exports.calendarYear = calendarYear;
exports.calendarQuarter = calendarQuarter;
exports.calendarMonth = calendarMonth;
exports.fiscalYear = fiscalYear;
exports.fiscalQuarter = fiscalQuarter;
exports.customRange = customRange;
exports.dayLabel = dayLabel;
exports.periodSentence = periodSentence;
exports.periodRange = periodRange;
exports.periodBoundsIso = periodBoundsIso;
exports.splitByPeriod = splitByPeriod;
exports.splitByDay = splitByDay;
exports.minorToPlain = minorToPlain;
exports.majorToPlain = majorToPlain;
exports.sumCharges = sumCharges;
exports.withheldReason = withheldReason;
exports.periodReads = periodReads;
exports.statementCaveats = statementCaveats;
exports.payoutFacts = payoutFacts;
exports.coachStatement = coachStatement;
exports.statementDoc = statementDoc;
exports.statementCsv = statementCsv;
exports.statementItemsCsv = statementItemsCsv;
exports.statementFileStem = statementFileStem;
exports.statementShareBlurb = statementShareBlurb;
// One money formatter for the whole app. It refuses to print an amount whose
// currency it was not told, and it knows which currencies have no minor unit,
// so ¥50,000 does not print as ¥500. A statement is the last place that may
// hold a second opinion about how much money something is.
// `currencyDecimals` rather than `ZERO_DECIMAL` — the plain-digit writers below
// need the WHOLE answer to how many places a currency has, not half of it, and
// half of it is what put a Kuwaiti coach's sales into an accountant's
// spreadsheet at ten times their value. There is one place in this app that
// knows the three families and it is coachMoney.ts.
const coachMoney_1 = require("./coachMoney");
// The same five replacements the invoice uses, rather than a fifth private
// copy. Every value on this page that a person typed goes through it.
const coachInvoice_1 = require("./coachInvoice");
// Which Stripe status words mean the money is actually in a bank. Imported
// rather than repeated: a second reading of 'in_transit' living here is a
// second thing to get wrong, and getting it wrong puts money that has not
// arrived into a figure an accountant reconciles a bank statement against.
const coachPayouts_1 = require("./coachPayouts");
// The three sentences the costs screen already says, imported rather than
// restated. A cost means the same thing on a document as it does on the screen
// it was typed into, and a second copy of "nothing here is netted" is the copy
// that gets softened on one surface and left alone on the other.
const coachCosts_1 = require("./coachCosts");
// Dates on this document are written by the same two helpers every other screen
// in the app writes one with. A statement is read by the coach and handed to
// their accountant; neither of them is guaranteed to read English months.
const format_1 = require("./format");
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, mIndex, d) => `${y}-${pad(mIndex + 1)}-${pad(d)}`;
/** Days in a month, honouring leap years. `new Date(y, m + 1, 0)` is the last
 *  day of month `m`, and it is built locally so no UTC rollover is involved. */
const lastDay = (y, mIndex) => new Date(y, mIndex + 1, 0).getDate();
/** 1 January to 31 December. Named `calendarYear` and never `taxYear`. */
function calendarYear(y) {
    return { from: iso(y, 0, 1), to: iso(y, 11, 31), label: String(y) };
}
/** A three-month calendar quarter, `q` from 1 to 4. */
function calendarQuarter(y, q) {
    const qq = Math.min(4, Math.max(1, Math.floor(q)));
    const first = (qq - 1) * 3;
    const last = first + 2;
    return { from: iso(y, first, 1), to: iso(y, last, lastDay(y, last)), label: `Q${qq} ${y}` };
}
/** One calendar month, `m` from 1 to 12. */
function calendarMonth(y, m) {
    const mi = Math.min(11, Math.max(0, Math.floor(m) - 1));
    // The label is the reader's own — "Aug 2026", "Aug. 2026", "2026年8月". The
    // KEY of the period is `from`/`to`, which are ISO and stay ISO; nothing is
    // stored or matched on this string.
    return { from: iso(y, mi, 1), to: iso(y, mi, lastDay(y, mi)), label: (0, format_1.fmtPointMonth)(y, mi) };
}
/** 1 January, which is what every existing caller meant. */
exports.CALENDAR_YEAR_START = { month: 1, day: 1 };
/** True when this start is the calendar one, so a screen can say "your year is
 *  the calendar year" rather than printing "1 January" as though it were a
 *  choice somebody had to make. */
const isCalendarStart = (s) => s.month === 1 && s.day === 1;
exports.isCalendarStart = isCalendarStart;
/**
 * A twelve-month year beginning on `start` in year `y`, ending the day before
 * the same date a year later.
 *
 * The end is computed as "the day before the anniversary" rather than as a
 * hardcoded month-end, because that is the only rule that is right for every
 * start date AND for a leap year. A year beginning 6 April 2026 ends 5 April
 * 2027; one beginning 1 March 2027 ends 29 February 2028, which no fixed table
 * of month lengths gets right.
 *
 * The label spans both calendar years — "2026/27" — where the period actually
 * crosses one, and is a bare year where it does not. A UK coach handed a
 * document headed "2026" for the year to April 2027 would file it against the
 * wrong twelve months, and the two are indistinguishable once it is printed.
 */
function fiscalYear(y, start = exports.CALENDAR_YEAR_START) {
    const m = clampMonth(start.month);
    const d = clampDay(y, m, start.day);
    // `iso` takes a ZERO-BASED month index, like Date does, and `m` here is the
    // 1-to-12 number a person types. Mixing the two silently shifts a whole
    // statement by a month, which is the one error on this screen that produces a
    // plausible document for the wrong period.
    const from = iso(y, m - 1, d);
    // The anniversary, minus one day. Date normalises a day number of 0 to the
    // last day of the previous month, so no branch is needed for a start on the
    // 1st — and none is needed for 29 February either, because the anniversary in
    // a non-leap year normalises to 1 March and stepping back lands on 28
    // February, which is the last day of that year.
    const end = new Date(y + 1, m - 1, d - 1);
    const to = iso(end.getFullYear(), end.getMonth(), end.getDate());
    const label = (0, exports.isCalendarStart)(start)
        ? String(y)
        : `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
    return { from, to, label };
}
/** A three-month quarter OF a coach's own year, `q` from 1 to 4. Counted from
 *  their start date, so Q1 of a year beginning 6 April runs 6 April to 5 July —
 *  never from January, which would put the quarters of a fiscal year and the
 *  quarters of a calendar year under the same four labels. */
function fiscalQuarter(y, q, start = exports.CALENDAR_YEAR_START) {
    const qq = Math.min(4, Math.max(1, Math.floor(q)));
    const m = clampMonth(start.month);
    const d = clampDay(y, m, start.day);
    // Month arithmetic through Date rather than modular arithmetic on the index,
    // so a quarter that crosses into the next calendar year takes its year with
    // it. `new Date(y, 13, 1)` is February of y + 1, which is exactly wanted.
    const open = new Date(y, m - 1 + (qq - 1) * 3, d);
    const close = new Date(y, m - 1 + qq * 3, d - 1);
    return {
        from: iso(open.getFullYear(), open.getMonth(), open.getDate()),
        to: iso(close.getFullYear(), close.getMonth(), close.getDate()),
        label: `Q${qq} ${(0, exports.isCalendarStart)(start) ? y : `${y}/${String((y + 1) % 100).padStart(2, '0')}`}`,
    };
}
const clampMonth = (m) => Math.min(12, Math.max(1, Math.floor(m) || 1));
/** A start day past the end of its month is the last day of that month rather
 *  than a rollover into the next one. A coach who types 31 for a year starting
 *  in February means the end of February, and `new Date(y, 1, 31)` would
 *  silently give them 3 March. */
const clampDay = (y, month1, day) => {
    const max = lastDay(y, month1 - 1);
    return Math.min(max, Math.max(1, Math.floor(day) || 1));
};
/**
 * Any two dates the coach typed, or null when they are not a period.
 *
 * The last of the three spans, and the one that needs no assumptions at all: an
 * accountant who works to a period this app has never heard of gets it by
 * typing both ends. Null rather than a corrected range for a backwards pair —
 * silently swapping them would produce a document for a period the coach did
 * not ask for, headed with dates they did not choose, and there is no cue on
 * the page that would give it away.
 *
 * The label is the two dates spelled out rather than a name, because there is
 * no name for it and inventing one ("Custom") tells a reader of the file
 * nothing about which twelve weeks it covers.
 */
function customRange(from, to) {
    const a = String(from ?? '').slice(0, 10);
    const b = String(to ?? '').slice(0, 10);
    const shape = /^\d{4}-\d{2}-\d{2}$/;
    if (!shape.test(a) || !shape.test(b))
        return null;
    if (b < a)
        return null;
    // Both ends have to be days that EXIST. The regex above accepts 2026-02-30,
    // and `periodRange` would not refuse it: `new Date(2026, 1, 30)` normalises
    // to 2 March rather than failing, so the statement would silently cover two
    // days more than the coach typed and its heading would still read "30 Feb".
    // The round trip is the only check that catches it.
    if (!isRealDay(a) || !isRealDay(b))
        return null;
    const p = { from: a, to: b, label: `${dayLabel(a)} to ${dayLabel(b)}` };
    // And the pair has to produce a half-open instant range, because a period
    // with no bounds would read every table with no filter at all.
    return periodRange(p) ? p : null;
}
/** Whether `YYYY-MM-DD` names a day that exists, by building it and checking it
 *  came back as itself. Date normalises an overflowing day rather than
 *  refusing it, so the round trip is what distinguishes 30 February from 2
 *  March — and on a statement those are two different periods. */
function isRealDay(isoDay) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
    if (!m)
        return false;
    const y = Number(m[1]);
    const mi = Number(m[2]) - 1;
    const d = Number(m[3]);
    if (mi < 0 || mi > 11 || d < 1)
        return false;
    const back = new Date(y, mi, d);
    return back.getFullYear() === y && back.getMonth() === mi && back.getDate() === d;
}
/**
 * That the year's start is the coach's own statement, not this app's finding.
 *
 * Printed beside `PERIOD_IS_YOURS` rather than replacing it, because the two
 * say different things: that one is about the period, this one is about the
 * fact that a twelve-month period beginning in April is a claim about somebody's
 * tax affairs and this app has taken their word for it.
 */
exports.YEAR_START_IS_YOURS = 'The day your year starts is one you set on this screen. This app does not know which tax year you file to, has not inferred one from your phone, your currency or where you are, and does not check that the one you chose is right for you.';
/** `YYYY-MM-DD` as a person reads it, without going through `new Date(s)` —
 *  which is UTC midnight, and so the day before for anybody west of Greenwich.
 *  The parts go to `fmtPointDay` as numbers: nothing to parse, nothing to
 *  shift, and the words are the reader's rather than an English array's. */
function dayLabel(isoDay) {
    const s = String(isoDay ?? '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m)
        return '—';
    const mi = Number(m[2]) - 1;
    if (mi < 0 || mi > 11)
        return '—';
    return (0, format_1.fmtPointDay)(Number(m[1]), mi, Number(m[3]));
}
/** The period spelled out, both ends, for the face of the document. */
function periodSentence(p) {
    return `${dayLabel(p.from)} to ${dayLabel(p.to)} inclusive`;
}
function periodRange(p) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.from ?? ''));
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(p.to ?? ''));
    if (!a || !b)
        return null;
    const from = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]), 0, 0, 0, 0).getTime();
    // The day AFTER `to`, at local midnight. Date normalises an overflowing day
    // number, so the 32nd of January is the 1st of February without a branch.
    const to = new Date(Number(b[1]), Number(b[2]) - 1, Number(b[3]) + 1, 0, 0, 0, 0).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
        return null;
    return { fromMs: from, toMs: to };
}
/**
 * The ISO instants a PostgREST `.gte()` / `.lt()` pair needs for this period.
 *
 * The bounds are computed once, here, so the rows the server returns and the
 * rows this module would have accepted cannot disagree. A screen that filtered
 * again in JavaScript with a different rule would either drop rows it had
 * already been given or, worse, keep rows outside the period it printed.
 */
function periodBoundsIso(p) {
    const r = periodRange(p);
    if (!r)
        return null;
    return { fromIso: new Date(r.fromMs).toISOString(), toIso: new Date(r.toMs).toISOString() };
}
function splitByPeriod(rows, at, range) {
    const inside = [];
    let undated = 0;
    let noPeriod = 0;
    for (const r of rows) {
        const t = Date.parse(String(at(r) ?? ''));
        if (!Number.isFinite(t)) {
            undated += 1;
            continue;
        }
        // A row with a date, and no period to compare it against. It is not undated
        // and it is not outside the period; there is no period. Counted, so that
        // nothing can vanish between the two.
        if (!range) {
            noPeriod += 1;
            continue;
        }
        if (t >= range.fromMs && t < range.toMs)
            inside.push(r);
    }
    return { inside, undated, noPeriod };
}
/**
 * The same split for a DATE-ONLY column, compared as calendar days.
 *
 * `coach_invoices.issued_on` is a Postgres `date` and comes back as a bare
 * `YYYY-MM-DD`. It means a day, not an instant, and it must not go through
 * `splitByPeriod`: `Date.parse('2026-01-01')` is UTC midnight, which is
 * 08:00 BEFORE local midnight in Los Angeles — so an invoice issued on the
 * first day of the period would fall outside the period that names it, for
 * every coach in the Americas and for nobody in Dubai, where this was written.
 *
 * ISO dates sort lexicographically, so the comparison is the string one and no
 * Date is constructed at all. A value that is not a bare date is undated: it is
 * in no period rather than swept into this one.
 *
 * The period's own two ends are tested ONCE, before the loop, and a period that
 * does not read counts every dated row under `noPeriod` rather than dropping
 * it — the same hole `splitByPeriod` had, and for the same reason it mattered:
 * the ends were tested inside the `if`, so an unreadable period silently
 * emptied a section that then printed a count of nought.
 */
function splitByDay(rows, on, p) {
    const inside = [];
    let undated = 0;
    let noPeriod = 0;
    const from = String(p.from ?? '');
    const to = String(p.to ?? '');
    const readable = /^\d{4}-\d{2}-\d{2}$/;
    const havePeriod = readable.test(from) && readable.test(to) && from <= to;
    for (const r of rows) {
        const d = String(on(r) ?? '').slice(0, 10);
        if (!readable.test(d)) {
            undated += 1;
            continue;
        }
        if (!havePeriod) {
            noPeriod += 1;
            continue;
        }
        if (d >= from && d <= to)
            inside.push(r);
    }
    return { inside, undated, noPeriod };
}
/* ── amounts as plain digits, for a spreadsheet ───────────────────────────── */
/**
 * Minor units as an exact decimal string, or null when it cannot be stated.
 *
 * Deliberately string arithmetic: this is a ledger, and `(cents / 100)
 * .toFixed(2)` is a float division. The answer is the same digits the database
 * holds with a point pushed two places left, which is a text operation.
 *
 * CURRENCY-AWARE, and that is the whole reason this is not
 * `minorToDecimal` from gymExport.ts. That one always divides by a hundred.
 * There are no sen in a yen: ¥50,000 is stored as 50000 minor units, and
 * writing "500.00" into an accountant's spreadsheet understates a coach's
 * takings by a factor of a hundred in sixteen currencies.
 *
 * ── And it went the other way in five ─────────────────────────────────────
 *
 * The branch above was the ONLY branch: `ZERO_DECIMAL` or a hundred. A Kuwaiti
 * dinar has a thousand fils in it, so KWD 12.340 is stored as 12340 minor units
 * and this function wrote "123.40" into an accountant's spreadsheet — ten times
 * the sale, in the file the paragraph above exists to stop being wrong. The
 * readable document beside it was right the whole time, because `minorMoney`
 * goes through `currencyDecimals`, so the two artefacts a coach hands over
 * together disagreed by a factor of ten and neither said which was which.
 *
 * `currencyDecimals` is now the one answer to how many places this money has —
 * the same function `minorMoney`, `majorFromMinor` and `readMinorAmount` use.
 * There is one place in this app that decides that question and it is not this
 * one; a second copy of the list is the copy that drifts, which is exactly what
 * this was.
 *
 * Null — not "0.00" — when either half is missing, so the CSV cell is empty and
 * nobody reads a hole as a sale for nothing.
 */
function minorToPlain(minorUnits, currency) {
    if (minorUnits == null || !Number.isFinite(minorUnits) || !Number.isInteger(minorUnits))
        return null;
    const dp = (0, coachMoney_1.currencyDecimals)(currency);
    if (dp == null)
        return null;
    if (dp === 0)
        return String(minorUnits);
    const neg = minorUnits < 0;
    // Padded to dp + 1 so a figure smaller than one whole unit keeps its leading
    // nought — 5 fils is "0.005", never ".005", which a spreadsheet reads as text.
    const digits = String(Math.abs(minorUnits)).padStart(dp + 1, '0');
    return (neg ? '-' : '') + digits.slice(0, -dp) + '.' + digits.slice(-dp);
}
/**
 * A whole-unit amount as a plain string, or null when it cannot be stated.
 *
 * `charges.amount` is `numeric` and holds MAJOR units — 25 means twenty-five
 * pounds, not twenty-five pence. Everything else on this statement is minor
 * units. Mixing the two is a hundred-fold error in a money column, so the two
 * conversions are separate functions with separate names and the sections that
 * use them are never added together.
 *
 * Through `currencyDecimals` for the same reason `minorToPlain` is: a fee
 * recorded in dinars has three places, and `toFixed(2)` rounds the third one
 * away — a fils off every fee, silently, in the file an accountant adds up.
 */
function majorToPlain(amount, currency) {
    if (amount == null || !Number.isFinite(amount))
        return null;
    const dp = (0, coachMoney_1.currencyDecimals)(currency);
    if (dp == null)
        return null;
    return dp === 0 ? String(Math.round(amount)) : amount.toFixed(dp);
}
/* ── the standing statements ──────────────────────────────────────────────── */
/**
 * What this document is NOT. The single most important text on the page.
 *
 * A constant rather than an inline string so it cannot be softened on one
 * surface and left alone on another, and so the test can assert it appears on
 * every artefact this module builds — the readable statement and the CSV both.
 */
exports.STATEMENT_NOT = 'THIS IS NOT A TAX DOCUMENT AND IT IS NOT A STATEMENT OF EARNINGS. No tax of any kind has been calculated, added, withheld or deducted anywhere on it — those concepts are absent from it, not set to zero. Nothing has been taken off any figure here: no processing fee, no platform fee, no cost of any kind. Every amount is the gross a client was charged. It is not proof that money moved and it is not a statement of what reached a bank account. Give it to your accountant alongside your records from Stripe and your bank; it is something for them to work from, not a return.';
/** What it IS, said in the same breath so the two are never separated. */
exports.STATEMENT_IS = 'This is a list of what this app recorded between the two dates named above, and nothing else. Each section says where its figures came from.';
/**
 * That this app is not the whole of a coach's book.
 *
 * The half of a working trainer's income that arrives in cash, by bank
 * transfer, or through a gym's front desk was never in this app to be listed,
 * and a statement that did not say so would read as a complete year.
 */
exports.STATEMENT_NOT_THE_WHOLE_BOOK = 'Money taken outside this app — cash, a bank transfer, a card taken at a gym — reaches this statement only where you wrote it down yourself, in the section that says so. Anything you were paid and did not record is not here, so this is short by that amount and only you know by how much.';
/**
 * That a recorded payment is the coach's own word and nothing more.
 *
 * The same hedge `kindLine` puts on an invoice, and it belongs on this section
 * more than on any other: there is no Stripe record behind these at all, so an
 * accountant reading the statement has to be able to tell which figures have
 * something to be reconciled against and which have only the coach's memory.
 */
exports.RECEIPTS_ARE_YOUR_WORD = 'These are payments you told this app about after the fact. Nothing behind them has been checked against a bank or a card processor, this app was not involved in any of them, and there is no second record anywhere to reconcile them against. They may also describe the same money as a sale above, if a payment was recorded twice — nothing here can tell.';
/**
 * That a payout is a balance and not the proceeds of a sale.
 *
 * The single most important line in the payouts section, and the reason it took
 * a section of its own rather than a column beside the sales. Every reader of
 * this document — the coach, and more dangerously their accountant — will be
 * tempted to subtract: "packs and renewals came to 4,800, the bank received
 * 4,281, so the fees were 519." All three of those numbers are about different
 * sets of transactions over different spans, because Stripe pays out a BALANCE
 * on its own schedule and a payout inside this period may be settling charges
 * from before it. The subtraction is not done here, and the reason is printed
 * rather than left to be worked out.
 *
 * The long form is `PAYOUT_IS_NOT_A_SALE` in src/lib/coachPayouts.ts, which the
 * Money screen carries. This is the same rule stated for a document.
 */
exports.PAYOUTS_ARE_NOT_NETTED = 'A payout is your Stripe balance reaching your bank, not the proceeds of any sale listed above. It is many charges at once, less what Stripe and the platform took and anything refunded, on Stripe’s own schedule — so a payout counted in this period may be settling charges made before it, and the two figures are deliberately never subtracted from each other. Do not read the gap between them as fees.';
/**
 * That only arrived payouts are counted, and that an empty section is not a
 * statement about a bank account.
 *
 * An empty payouts section is much more likely to mean the Connect webhook
 * destination has never been subscribed to `payout.*` than that Stripe paid the
 * coach nothing — part 194's deployment note is explicit about it — and a
 * document that quietly showed nothing would be read by an accountant as
 * evidence of no bank receipts at all.
 */
exports.PAYOUTS_ONLY_ARRIVED = 'Only payouts Stripe reported as PAID are counted, on the day Stripe said they would reach the bank. One still in transit is not money in an account and is not in the figures. Nothing appears here at all unless Stripe has told this app about a payout, so an empty section is not a statement that you were paid nothing — your Stripe dashboard and your bank statement are the record.';
/** That Stripe, not this app, is the authority on money that moved. */
exports.STATEMENT_STRIPE_IS_THE_RECORD = 'Where Stripe took the payment, Stripe’s own record is the artefact. The amounts here are what this app was told at the time; they have never been reconciled against Stripe, against a bank, or against each other. What Stripe charged in fees, what the platform took, and whether the money has reached your bank are not recorded in this app at all.';
/**
 * That the two dates at the top of this document did not read, so NOTHING on it
 * is a figure.
 *
 * The other half of `splitByPeriod`'s `noPeriod`. Every period this screen
 * offers is built by `fiscalYear`, `fiscalQuarter` or `customRange` and all
 * three produce real days — but a period restored from storage, or handed in by
 * a caller written later, can be two strings that are not dates, and until now
 * that produced a complete-looking document reading "0 sales, 0 renewals, 0
 * invoices" under a 'ready' status, with every read having succeeded.
 *
 * A confident nought over an unreadable period is the same artefact as a
 * confident nought over a failed read, and it is worse in one way: there is no
 * failed read anywhere to raise a caveat, so the document says every part of it
 * was read in full, which is true and completely misleading.
 */
exports.PERIOD_UNREADABLE = 'The two dates this statement covers could not be read as days, so nothing on it has been placed inside or outside a period and NO figure is stated anywhere on it. Every read behind it may have succeeded — that is not the problem. Pick the period again and take the statement afresh; do not treat any nought on this one as a nought in your record.';
/** That the period was the coach's choice and not this app's. */
exports.PERIOD_IS_YOURS = 'The period above is a calendar period you chose. This app does not know which period your accountant or your authority works to and has not assumed one.';
/**
 * Why sessions are counted and never priced.
 *
 * A session's `rate_cents` is a GYM payroll rate, snapshotted for settling with
 * an employed trainer — it is not a self-employed coach's income. And a session
 * delivered against a pack was already paid for in the pack sale above, so
 * pricing the sessions as well would count the same money twice. Both of those
 * would look perfectly reasonable on a screen, which is why the reason is
 * printed rather than left to a code comment.
 */
exports.SESSIONS_NOT_MONEY = 'Sessions are counted here and deliberately not priced. A session paid for out of a pack was already paid for in the sales above, and pricing it again would count the same money twice.';
/** Why invoices are listed apart and never added to the sales. */
exports.INVOICES_NOT_ADDED = 'These are documents you issued. They may describe the same money as the sales above — an invoice you wrote for a pack Stripe had already taken — so they are listed separately and are deliberately not added to anything else on this statement.';
/**
 * That a refund is listed and never subtracted.
 *
 * The same rule `PAYOUTS_ARE_NOT_NETTED` states for a payout, and it has to be
 * said louder here, because a refund LOOKS like it belongs in a subtraction in
 * a way a payout does not. It still may not be done by this app: the sales
 * figure above is gross, Stripe's processing fee on the original charge is not
 * in this database at all and is usually not returned, and a refund made in one
 * period against a sale made in another belongs to neither on its own. The
 * accountant does the netting, from both figures, knowing which period each is
 * about. What this app owes them is both figures.
 */
exports.REFUNDS_ARE_NOT_NETTED = 'These are amounts given back. They are NOT subtracted from the sales above and no net figure appears anywhere on this statement: a refund made in this period may be against a sale made in another, the sales figures are gross of everything Stripe and this platform took, and what Stripe charged to process the original payment is usually not returned. Both figures are here so your accountant can do that arithmetic knowing which period each belongs to.';
/**
 * That one row here is every refund on one charge, added up.
 *
 * `refunded_cents` is a running total, so a sale refunded in three instalments
 * is one line carrying the sum and dated on the last of them. A reader counting
 * lines as refund events counts too few, and a reader looking for the first
 * instalment's date will not find it here — Stripe's dashboard has both.
 */
exports.REFUNDS_ARE_A_RUNNING_TOTAL = 'Each line here is the whole of what has been given back on one charge, not one refund. A sale refunded twice appears once, for the total, on the day of the later one. Stripe’s own dashboard is where the individual refunds and their dates are.';
/**
 * That a chargeback is counted when it was RAISED, and never netted.
 *
 * The money leaves on the day the issuer raises it, whatever happens
 * afterwards — that is `DISPUTE_MONEY_IS_ALREADY_GONE` in src/lib/disputes.ts,
 * and this section holds the same line. A dispute the coach later wins is money
 * that left and came back; both are facts and neither is quietly cancelled out
 * here, because the two can fall in different periods and the accountant is the
 * one who knows which return each belongs on.
 */
exports.DISPUTES_ARE_NOT_NETTED = 'A chargeback takes the money back out of your balance on the day it is raised, before anybody decides who is right. These are counted on that day, whatever was decided later, and they are NOT subtracted from the sales above. Where you won one, the money came back on a different day and Stripe’s record is where that is. Nothing here is a judgement about any of them.';
/** Why late-cancellation fees are their own section. */
exports.LATE_FEES_NOT_TAKINGS = 'These are fees recorded in this app against your clients. This app does not charge them, is not told whether they were paid, and does not add them to anything above.';
/**
 * The hole this statement used to have, and the smaller one it still has.
 *
 * `charges` was readable by a coach through `charges_trainer_rw` alone, which
 * was `exists (select 1 from clients c where c.id = charges.client_id and
 * c.trainer_id = auth.uid())` — the LIVE relationship, not a coach id stored on
 * the row. Ending coaching sets `clients.trainer_id` to null (see
 * src/lib/endCoaching.ts), so from that moment the fee became invisible to the
 * person who recorded it, in this period AND IN EVERY PAST ONE. That is not a
 * short section, it is a retroactive edit: last year's statement, already
 * printed and already handed to an accountant, could not be reproduced, and the
 * second copy differed from the first with nothing on either to say which was
 * which.
 *
 * Part 169 snapshots `charges.coach_id` when the fee is raised and reads
 * through that as well as through the live relationship, so a fee recorded from
 * now on stays on every statement that covers its date whatever happens to the
 * coaching afterwards. The same discipline part 126 already applied to the
 * CURRENCY on the same row, and for the same reason.
 *
 * What is NOT recovered is every fee raised BEFORE part 169 against somebody
 * who had already moved on: the pair is recorded nowhere, so the backfill could
 * not reach it and a guess would put one coach's fee on another's statement.
 * That residue is what this sentence is now about, and it is narrower and
 * dated rather than open-ended.
 */
exports.LATE_FEES_ONLY_CURRENT_CLIENTS = 'A fee recorded from September 2026 onward stays on this statement whatever happens to the coaching afterwards, because who recorded it is written on the fee itself. Older fees are read through the coaching relationship instead, so one recorded against somebody who had already left before that change is not readable by this app under your account and is missing from this section.';
/**
 * Add up recorded fees, per currency, in whole units.
 *
 * A waived fee is excluded from the pots and counted separately, the same
 * discipline `invoiceBook` keeps for a voided invoice: an omitted row a coach
 * cannot see is worse than one they can.
 */
function sumCharges(rows) {
    const by = new Map();
    let waived = 0;
    let unlabelled = 0;
    let unpriced = 0;
    for (const r of rows) {
        if (r.waivedAt) {
            waived += 1;
            continue;
        }
        if (r.amount == null || !Number.isFinite(r.amount)) {
            unpriced += 1;
            continue;
        }
        const cur = (r.currency || '').trim().toUpperCase();
        if (!cur) {
            unlabelled += 1;
            continue;
        }
        const pot = by.get(cur);
        if (pot) {
            pot.wholeUnits += r.amount;
            pot.count += 1;
        }
        else
            by.set(cur, { currency: cur, wholeUnits: r.amount, count: 1 });
    }
    const pots = [...by.values()].sort((a, b) => (b.wholeUnits - a.wholeUnits) || a.currency.localeCompare(b.currency));
    return { pots, waived, unlabelled, unpriced };
}
/** The sentence a read that did not land puts where the figures would have
 *  gone. 'loading' collapses into a withholding for the same reason it does on
 *  an invoice: a document is built and handed over in one gesture, so a read
 *  still in flight is a read that did not answer. */
function withheldReason(status, what) {
    if (status === 'ready')
        return null;
    if (status === 'partial') {
        return `More ${what} are on record than this app was able to read in one go, so no figure is stated. What is listed is real and it is not all of it.`;
    }
    if (status === 'loading') {
        return `Your ${what} had not finished loading when this was built, so no figure is stated. Nothing here says there were none.`;
    }
    return `Your ${what} could not be read, so no figure is stated. An empty section here does NOT mean there were none — it means this app could not tell you.`;
}
/** Money lines from a `Taken`, or an empty list when nothing was recorded. */
function takenLines(t) {
    return t.pots.map((p) => ({
        label: `${p.count} ${p.count === 1 ? 'payment' : 'payments'} in ${p.currency}`,
        // Never a bare number. `minorMoney` returns null if it was not told a
        // currency, and a null here would be a bug in `sumTaken`, which cannot
        // build a pot without one — so the dash is unreachable rather than tolerated.
        amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
    }));
}
/** What a `Taken` has to admit to. */
function takenNotes(t, noun) {
    const out = [];
    if (t.pots.length > 1) {
        out.push('These are separate amounts of money in different currencies and are deliberately not added together.');
    }
    if (t.unlabelled > 0) {
        out.push(`${t.unlabelled} ${t.unlabelled === 1 ? `${noun} has` : `${noun}s have`} an amount with no currency on it, so ${t.unlabelled === 1 ? 'it is' : 'they are'} not in any figure above. Do not read the shorter total as the whole of it.`);
    }
    if (t.unpriced > 0) {
        out.push(`${t.unpriced} ${t.unpriced === 1 ? `${noun} has` : `${noun}s have`} no amount recorded at all, so ${t.unpriced === 1 ? 'it is' : 'they are'} counted and not summed.`);
    }
    return out;
}
/**
 * Whether the period itself reads, which decides whether any figure may be
 * stated at all.
 *
 * Both halves are asked, because they can fail apart: `periodRange` builds the
 * half-open instant range the timestamped sections split on, and the bare
 * `from`/`to` days are what the date-only sections (invoices, payouts) compare
 * against. A period that satisfies one and not the other would give a document
 * with figures in half its sections and silent noughts in the rest.
 */
function periodReads(p) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = String(p?.from ?? '');
    const to = String(p?.to ?? '');
    return day.test(from) && day.test(to) && from <= to && periodRange(p) != null;
}
/** Every part that could not be read, named. */
function statementCaveats(input) {
    const out = [];
    // First, and on its own, because it is not a failed read and it costs every
    // figure on the document rather than one section's.
    if (!periodReads(input.period))
        out.push(`The period: ${exports.PERIOD_UNREADABLE}`);
    const say = (status, what, cost) => {
        if (status === 'ready')
            return;
        const how = status === 'partial'
            ? 'came back with more rows than one request returns'
            : status === 'loading'
                ? 'had not finished loading when this was built'
                : 'could not be read';
        out.push(`${what}: this read ${how}, so ${cost} is MISSING from this statement rather than absent from your record. Fix the read and take it again before treating this as a complete list.`);
    };
    if (input.issuer.status !== 'ready') {
        out.push('Your name: it could not be read when this was built, so the top of this statement is blank. That is a failed read, not a record with no name in it.');
    }
    say(input.sessions.status, 'Sessions', 'the number of sessions you delivered');
    say(input.packs.status, 'Packs and memberships sold', 'what clients paid you for packs and memberships');
    say(input.subscriptions.status, 'Subscription renewals', 'what clients paid you in renewals');
    say(input.receipts.status, 'Payments you recorded yourself', 'the cash and transfers you have written down');
    say(input.invoices.status, 'Invoices issued', 'the documents you issued');
    say(input.lateCancellations.status, 'Late-cancellation fees', 'the fees recorded against your clients');
    say(input.payoutsPaid.status, 'Payouts that reached your bank', 'what Stripe paid out to you');
    say(input.refunds.status, 'Money you gave back', 'what you refunded, leaving the sales above looking whole');
    say(input.disputes.status, 'Chargebacks raised against you', 'money taken back out of your balance by a card issuer');
    say(input.costs.status, 'Costs you recorded yourself', 'the money you have written down as going out');
    if (input.payouts.status !== 'ready') {
        out.push('Your payout account: its state could not be read, so this statement says nothing about whether you are set up to be paid.');
    }
    return out;
}
/**
 * What this app knows about payouts. Four columns, and it says so.
 *
 * This is the honest deliverable in place of a payout schedule. No `payout.*`
 * event reaches this app, so there is no date, no amount, no fee and no arrival
 * to show — and a timetable rendered from nothing would be read as a promise
 * about when somebody's rent money lands.
 */
function payoutFacts(k) {
    const lines = [];
    if (k.status !== 'ready') {
        lines.push('Whether you have a payout account set up could not be read just now. Nothing below is a statement about your account.');
    }
    else if (!k.hasAccount) {
        lines.push('You have not connected a payout account, so nothing has been paid out to you through this app.');
    }
    else if (!k.chargesEnabled) {
        lines.push(k.detailsSubmitted
            ? 'You have started setting up a payout account and Stripe has not finished verifying it. Until it does, clients cannot check out.'
            : 'A payout account exists but the setup was never finished, so clients cannot check out yet.');
    }
    else {
        lines.push('Your payout account is connected and clients can check out.');
    }
    // What changed, and what did not. Part 194 mirrors `payout.paid` and
    // `payout.failed`, so this app IS now told when a payout happened and for how
    // much — but it is still told nothing about the schedule, nothing about the
    // fee that came off it, and nothing about the balance behind it. The old
    // version of this paragraph said "never told about a payout", which is no
    // longer true and would have read as this app hiding something it has.
    //
    // Deliberately still no timetable. Knowing that four payouts happened says
    // nothing about when the fifth will, and a rendered schedule would be a
    // promise about when somebody's rent money lands.
    lines.push('The payouts themselves are listed above, under what reached your bank, mirrored from Stripe as each one was made. What is NOT here is a schedule: this app is not told when the next payout will be sent, what fee came off any of them, or what your Stripe balance is, so there is no timetable on this statement because there is no data behind one.');
    lines.push('A payout is a balance reaching your bank rather than the proceeds of a sale — many charges at once, less what Stripe and Repple took and anything refunded — so it does not correspond to any sales figure above and nothing here subtracts one from the other.');
    lines.push('Your payouts live with Stripe. Stripe emails the address you signed up with each time one is sent, and the dashboard set up for you when you onboarded is where the schedule and the arrival dates are. This app cannot open it for you — it holds no link to your account, and inventing one would send you somewhere that is not it.');
    return { title: 'Payouts', lines };
}
function coachStatement(input) {
    const range = periodRange(input.period);
    // Whether the two dates at the top of the document mean anything. Null range
    // and unreadable days are the same failure arriving through two doors, and
    // `periodReads` asks both — see `PERIOD_UNREADABLE` for what it costs.
    //
    // Every `…Ready` boolean below is ANDed with this, so nothing that states a
    // number is built at all where the period does not read. It is not enough to
    // blank the counts afterwards: the notes carry figures too — "Marked
    // completed: 0. No-show: 0." off an `inside` that is empty because no row
    // could be placed is the same confident nought wearing a sentence.
    const readable = periodReads(input.period);
    /* ── sessions: counted, never priced ───────────────────────────────────── */
    const sess = splitByPeriod(input.sessions.rows, (r) => r.startsAt, range);
    const delivered = sess.inside.filter((s) => s.outcome === 'completed').length;
    const noShow = sess.inside.filter((s) => s.outcome === 'no_show').length;
    const lateCancelled = sess.inside.filter((s) => s.outcome === 'late_cancelled').length;
    const cancelled = sess.inside.filter((s) => s.outcome === 'cancelled').length;
    const unmarked = sess.inside.filter((s) => !s.outcome).length;
    const sessionsReady = input.sessions.status === 'ready' && readable;
    const sessionNotes = [exports.SESSIONS_NOT_MONEY];
    if (sessionsReady) {
        sessionNotes.push(`Marked completed: ${delivered}. No-show: ${noShow}. Late-cancelled: ${lateCancelled}. Cancelled: ${cancelled}.`);
        if (unmarked > 0) {
            sessionNotes.push(`${unmarked} session${unmarked === 1 ? '' : 's'} in this period ${unmarked === 1 ? 'has' : 'have'} no outcome recorded, so ${unmarked === 1 ? 'it is' : 'they are'} in the total below and in none of the four lines above.`);
        }
        if (sess.undated > 0) {
            sessionNotes.push(`${sess.undated} session${sess.undated === 1 ? '' : 's'} could not be dated and ${sess.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
        }
    }
    const sessionsSection = {
        key: 'sessions',
        title: 'Sessions in This Period',
        source: 'This app’s own record — sessions booked here and marked here, by you or by your client.',
        status: input.sessions.status,
        count: sessionsReady ? sess.inside.length : null,
        countLabel: sess.inside.length === 1 ? 'session' : 'sessions',
        lines: [],
        withheld: withheldReason(input.sessions.status, 'sessions'),
        notes: sessionNotes,
    };
    /* ── packs and memberships ─────────────────────────────────────────────── */
    const packSplit = splitByPeriod(input.packs.rows, (r) => r.created_at, range);
    const packTaken = (0, coachMoney_1.sumTaken)(packSplit.inside);
    const packsReady = input.packs.status === 'ready' && readable;
    const packNotes = packsReady ? takenNotes(packTaken, 'sale') : [];
    if (packsReady && packSplit.undated > 0) {
        packNotes.push(`${packSplit.undated} sale${packSplit.undated === 1 ? '' : 's'} could not be dated and ${packSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
    }
    const packsSection = {
        key: 'packs',
        title: 'Packs and Memberships Sold',
        source: 'Stripe took these payments and told this app what it had charged. Stripe’s own record is the authority; this is what this app was told at the time.',
        status: input.packs.status,
        count: packsReady ? packSplit.inside.length : null,
        countLabel: packSplit.inside.length === 1 ? 'sale' : 'sales',
        lines: packsReady ? takenLines(packTaken) : [],
        withheld: withheldReason(input.packs.status, 'sales'),
        notes: packNotes,
    };
    /* ── subscription renewals ─────────────────────────────────────────────── */
    const subSplit = splitByPeriod(input.subscriptions.rows, (r) => r.created_at, range);
    const subTaken = (0, coachMoney_1.sumTaken)(subSplit.inside);
    const subsReady = input.subscriptions.status === 'ready' && readable;
    const subNotes = subsReady ? takenNotes(subTaken, 'renewal') : [];
    if (subsReady && subSplit.undated > 0) {
        subNotes.push(`${subSplit.undated} renewal${subSplit.undated === 1 ? '' : 's'} could not be dated and ${subSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
    }
    const subsSection = {
        key: 'subscriptions',
        title: 'Subscription Renewals Paid',
        source: 'One row per renewal invoice Stripe reported as paid. Stripe’s own record is the authority; this is what this app was told at the time.',
        status: input.subscriptions.status,
        count: subsReady ? subSplit.inside.length : null,
        countLabel: subSplit.inside.length === 1 ? 'renewal' : 'renewals',
        lines: subsReady ? takenLines(subTaken) : [],
        withheld: withheldReason(input.subscriptions.status, 'renewals'),
        notes: subNotes,
    };
    /* ── what the coach recorded themselves ────────────────────────────────── */
    //
    // The half of a working coach's book that never went near Stripe. Its own
    // section rather than being folded into the sales above, because the two are
    // different KINDS of fact and a statement handed to an accountant has to keep
    // them apart: one is what a payment processor told this app it had charged,
    // the other is what the coach typed. Neither is checked against a bank, but
    // only one of them has a Stripe record sitting behind it to be checked
    // against, and the accountant is the person who needs to know which is which.
    //
    // ── `splitByDay`, not `splitByPeriod` ─────────────────────────────────
    //
    // `coach_receipts.received_on` is a Postgres `date` and reaches this module
    // as a bare `YYYY-MM-DD` in `created_at` (see the mapper in
    // src/ui/coachStatement.ts). It means a calendar day — the day the coach says
    // cash was handed over, in the room both people were standing in — and
    // `splitByPeriod` reads it as an INSTANT: `Date.parse('2026-01-01')` is UTC
    // midnight, which is eight hours BEFORE local midnight in Los Angeles, so
    // `t >= range.fromMs` was false for every payment received on the FIRST day
    // of the period.
    //
    // Those payments were not counted, and they were not reported missing
    // either. `undated` counts rows whose date will not parse and this one parses
    // perfectly; `noPeriod` counts rows with no period to compare against and
    // there was one. The row simply fell out between the two, and the section
    // printed a shorter count and a smaller total under a 'ready' status with a
    // tick beside it, on the one document in this app that gets copied into
    // somebody else's spreadsheet. Invisible in Dubai, where the statement was
    // written; present in every period, for every coach in the Americas.
    //
    // The server read is already a calendar-day comparison — `.gte('received_on',
    // period.from).lte('received_on', period.to)` — so the row was fetched and
    // then dropped here. Every other date-only column on this document
    // (`issued_on`, `arrival_on`, `paid_on`) already goes through `splitByDay`;
    // this was the one that did not, and `splitByDay`'s own header names exactly
    // this trap.
    const recSplit = splitByDay(input.receipts.rows, (r) => r.created_at, input.period);
    const recTaken = (0, coachMoney_1.sumTaken)(recSplit.inside);
    const recReady = input.receipts.status === 'ready' && readable;
    const recNotes = [exports.RECEIPTS_ARE_YOUR_WORD];
    if (recReady) {
        for (const n of takenNotes(recTaken, 'payment'))
            recNotes.push(n);
        if (recSplit.undated > 0) {
            recNotes.push(`${recSplit.undated} recorded payment${recSplit.undated === 1 ? '' : 's'} could not be dated and ${recSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
        }
    }
    const receiptsSection = {
        key: 'receipts',
        title: 'Payments You Recorded Yourself',
        source: 'Written down by you, in this app, for money taken outside it — cash, a bank transfer, or a card taken somewhere this app was not involved.',
        status: input.receipts.status,
        count: recReady ? recSplit.inside.length : null,
        countLabel: recSplit.inside.length === 1 ? 'payment' : 'payments',
        lines: recReady ? takenLines(recTaken) : [],
        withheld: withheldReason(input.receipts.status, 'recorded payments'),
        notes: recNotes,
    };
    /* ── invoices issued ───────────────────────────────────────────────────── */
    // By DAY, not by instant: `issued_on` is a Postgres `date` and means a
    // calendar day. See `splitByDay` for what going through the instant range
    // costs a coach in Los Angeles on the first of the month.
    const invSplit = splitByDay(input.invoices.rows, (r) => r.issuedOn, input.period);
    const voided = invSplit.inside.filter((i) => !!i.voidedAt);
    const live = invSplit.inside.filter((i) => !i.voidedAt);
    const received = live.filter((i) => i.kind === 'received').length;
    const invTaken = (0, coachMoney_1.sumTaken)(live.map((i) => ({ amount_cents: i.amountCents, currency: i.currency, created_at: i.issuedOn })));
    const invReady = input.invoices.status === 'ready' && readable;
    const invNotes = [exports.INVOICES_NOT_ADDED];
    if (invReady) {
        invNotes.push(`${received} of ${live.length} state the money was received; the rest state it was being requested. Both are your own word and neither has been checked against a bank or a card processor.`);
        if (voided.length > 0) {
            invNotes.push(`${voided.length} voided invoice${voided.length === 1 ? ' is' : 's are'} left out of the figures above. ${voided.length === 1 ? 'Its number is' : 'Their numbers are'} not reused.`);
        }
        for (const n of takenNotes(invTaken, 'invoice'))
            invNotes.push(n);
        if (invSplit.undated > 0) {
            invNotes.push(`${invSplit.undated} invoice${invSplit.undated === 1 ? '' : 's'} could not be dated and ${invSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
        }
    }
    const invoicesSection = {
        key: 'invoices',
        title: 'Invoices You Issued',
        source: 'Your own documents, numbered in your own sequence inside this app. What each says about the money is your statement, not a verified fact.',
        status: input.invoices.status,
        count: invReady ? live.length : null,
        countLabel: live.length === 1 ? 'invoice that stands' : 'invoices that stand',
        lines: invReady ? takenLines(invTaken) : [],
        withheld: withheldReason(input.invoices.status, 'invoices'),
        notes: invNotes,
    };
    /* ── late-cancellation fees ────────────────────────────────────────────── */
    const feeSplit = splitByPeriod(input.lateCancellations.rows, (r) => r.createdAt, range);
    const fees = sumCharges(feeSplit.inside);
    const feesReady = input.lateCancellations.status === 'ready' && readable;
    const feeNotes = [exports.LATE_FEES_NOT_TAKINGS, exports.LATE_FEES_ONLY_CURRENT_CLIENTS];
    if (feesReady) {
        if (fees.pots.length > 1)
            feeNotes.push('These are separate amounts of money in different currencies and are deliberately not added together.');
        if (fees.waived > 0)
            feeNotes.push(`${fees.waived} fee${fees.waived === 1 ? ' was' : 's were'} waived by you and ${fees.waived === 1 ? 'is' : 'are'} left out of the figures above.`);
        if (fees.unlabelled > 0)
            feeNotes.push(`${fees.unlabelled} fee${fees.unlabelled === 1 ? ' has' : 's have'} an amount with no currency on it, so ${fees.unlabelled === 1 ? 'it is' : 'they are'} not in any figure above.`);
        if (fees.unpriced > 0)
            feeNotes.push(`${fees.unpriced} fee${fees.unpriced === 1 ? ' has' : 's have'} no amount recorded at all.`);
        if (feeSplit.undated > 0)
            feeNotes.push(`${feeSplit.undated} fee${feeSplit.undated === 1 ? '' : 's'} could not be dated and ${feeSplit.undated === 1 ? 'is' : 'are'} in no period at all.`);
    }
    const feesSection = {
        key: 'lateCancellations',
        title: 'Late-Cancellation Fees Recorded',
        source: 'Recorded in this app against your own clients, under your own late-cancellation policy.',
        status: input.lateCancellations.status,
        count: feesReady ? feeSplit.inside.length - fees.waived : null,
        countLabel: feeSplit.inside.length - fees.waived === 1 ? 'fee that stands' : 'fees that stand',
        lines: feesReady
            ? fees.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'fee' : 'fees'} in ${p.currency}`,
                amount: (0, coachMoney_1.wholeMoney)(p.wholeUnits, p.currency) ?? '—',
            }))
            : [],
        withheld: withheldReason(input.lateCancellations.status, 'late-cancellation fees'),
        notes: feeNotes,
    };
    /* ── payouts that reached the bank ─────────────────────────────────────── */
    //
    // The other half of the one reconciliation an accountant actually does. The
    // sections above are what clients were CHARGED; this is what Stripe says
    // arrived. Both halves have been in this database since part 194 and the
    // document carried only the first.
    //
    // Counted by `arrival_on`, a Postgres `date`, so it goes through `splitByDay`
    // rather than the instant range — the same argument the invoices section
    // makes. A payout arriving on the first of the period would otherwise fall
    // outside it for every coach west of Greenwich.
    //
    // ONLY 'paid'. `payoutState` is the single place that reads Stripe's status
    // word, and everything that is not an arrival is counted separately and named
    // rather than being added to a bank figure or dropped from the page.
    const payoutSplit = splitByDay(input.payoutsPaid.rows, (p) => p.arrivalOn, input.period);
    const arrived = payoutSplit.inside.filter((p) => (0, coachPayouts_1.payoutState)(p.status) === 'arrived');
    const notArrived = payoutSplit.inside.length - arrived.length;
    const payTaken = (0, coachMoney_1.sumTaken)(arrived.map((p) => ({
        amount_cents: p.amountCents,
        currency: p.currency,
        created_at: p.arrivalOn ?? '',
    })));
    const payReady = input.payoutsPaid.status === 'ready' && readable;
    const payNotes = [exports.PAYOUTS_ARE_NOT_NETTED, exports.PAYOUTS_ONLY_ARRIVED];
    if (payReady) {
        for (const n of takenNotes(payTaken, 'payout'))
            payNotes.push(n);
        if (notArrived > 0) {
            payNotes.push(`${notArrived} payout${notArrived === 1 ? '' : 's'} dated in this period ${notArrived === 1 ? 'has' : 'have'} a status other than paid — still on the way, failed, or a word Stripe uses that this app does not recognise — so ${notArrived === 1 ? 'it is' : 'they are'} counted here and in no figure above. A failed payout is money that stayed in your Stripe balance; the Money screen carries Stripe's own reason for each one.`);
        }
        if (payoutSplit.undated > 0) {
            payNotes.push(`${payoutSplit.undated} payout${payoutSplit.undated === 1 ? '' : 's'} carry no arrival date and ${payoutSplit.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
        }
    }
    const payoutsSection = {
        key: 'payoutsPaid',
        title: 'Payouts That Reached Your Bank',
        source: 'Mirrored from Stripe as each payout was made, on the date Stripe said it would arrive. Stripe’s own record and your bank statement are the authority; this is what this app was told at the time.',
        status: input.payoutsPaid.status,
        count: payReady ? arrived.length : null,
        countLabel: arrived.length === 1 ? 'payout that arrived' : 'payouts that arrived',
        lines: payReady
            ? payTaken.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'payout' : 'payouts'} in ${p.currency}`,
                amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
            }))
            : [],
        withheld: withheldReason(input.payoutsPaid.status, 'payouts'),
        notes: payNotes,
    };
    /* ── money given back ──────────────────────────────────────────────────── */
    //
    // Dated on `refunded_at`, the day the money went back, and NOT on the day of
    // the sale it came off. A refund in April against a January sale belongs in
    // April's statement and in nobody's January — which is also the reason
    // nothing here is subtracted from anything: the two figures are about two
    // different periods as often as not.
    const refundSplit = splitByPeriod(input.refunds.rows, (r) => r.refundedAt, range);
    const refTaken = (0, coachMoney_1.sumTaken)(refundSplit.inside.map((r) => ({
        amount_cents: r.refundedCents,
        currency: r.currency,
        created_at: r.refundedAt,
    })));
    const refReady = input.refunds.status === 'ready' && readable;
    const refNotes = [exports.REFUNDS_ARE_NOT_NETTED, exports.REFUNDS_ARE_A_RUNNING_TOTAL];
    if (refReady) {
        const onSales = refundSplit.inside.filter((r) => r.on === 'sale').length;
        const onRenewals = refundSplit.inside.length - onSales;
        refNotes.push(`${onSales} of these came off a pack or membership sale and ${onRenewals} off a subscription renewal.`);
        for (const n of takenNotes(refTaken, 'refund'))
            refNotes.push(n);
        if (refundSplit.undated > 0) {
            refNotes.push(`${refundSplit.undated} refund${refundSplit.undated === 1 ? '' : 's'} could not be dated and ${refundSplit.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
        }
    }
    const refundsSection = {
        key: 'refunds',
        title: 'Money You Gave Back',
        source: 'Written onto the sale by Stripe — through a refund made in this app, and through one you made in your own Stripe dashboard. Stripe’s own record is the authority.',
        status: input.refunds.status,
        count: refReady ? refundSplit.inside.length : null,
        countLabel: refundSplit.inside.length === 1 ? 'charge refunded' : 'charges refunded',
        lines: refReady
            ? refTaken.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'charge' : 'charges'} in ${p.currency}`,
                amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
            }))
            : [],
        withheld: withheldReason(input.refunds.status, 'refunds'),
        notes: refNotes,
    };
    /* ── chargebacks ───────────────────────────────────────────────────────── */
    //
    // Counted on the day the issuer RAISED it, which is the day the money left.
    // A dispute won later is money that left and came back, on two different
    // days; both are facts and neither is netted here.
    const dispSplit = splitByPeriod(input.disputes.rows, (d) => d.openedAt, range);
    const dispTaken = (0, coachMoney_1.sumTaken)(dispSplit.inside.map((d) => ({
        amount_cents: d.amountCents,
        currency: d.currency,
        created_at: d.openedAt,
    })));
    const dispReady = input.disputes.status === 'ready' && readable;
    const dispNotes = [exports.DISPUTES_ARE_NOT_NETTED];
    if (dispReady) {
        const open = dispSplit.inside.filter((d) => !d.closedAt).length;
        if (open > 0) {
            dispNotes.push(`${open} of these ${open === 1 ? 'is' : 'are'} still open, so ${open === 1 ? 'it has' : 'they have'} no outcome yet. Nothing here says who will win ${open === 1 ? 'it' : 'them'}.`);
        }
        for (const n of takenNotes(dispTaken, 'chargeback'))
            dispNotes.push(n);
        if (dispSplit.undated > 0) {
            dispNotes.push(`${dispSplit.undated} chargeback${dispSplit.undated === 1 ? '' : 's'} could not be dated and ${dispSplit.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
        }
    }
    const disputesSection = {
        key: 'disputes',
        title: 'Chargebacks Raised Against You',
        source: 'Mirrored from Stripe as each one was raised. The status word on each is Stripe’s own; your Stripe dashboard is where the evidence and the outcome live.',
        status: input.disputes.status,
        count: dispReady ? dispSplit.inside.length : null,
        countLabel: dispSplit.inside.length === 1 ? 'chargeback' : 'chargebacks',
        lines: dispReady
            ? dispTaken.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'chargeback' : 'chargebacks'} in ${p.currency}`,
                amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
            }))
            : [],
        withheld: withheldReason(input.disputes.status, 'chargebacks'),
        notes: dispNotes,
    };
    /* ── what the coach recorded going out ─────────────────────────────────── */
    //
    // By DAY, not by instant: `coach_costs.paid_on` is a Postgres `date` and
    // means a calendar day, the same as `issued_on` and `arrival_on` above. Rent
    // was paid on a day, in the place the coach was standing.
    //
    // NOTHING IS SUBTRACTED. This section and the sales sections are the two
    // halves somebody will be tempted to difference, and `COSTS_ARE_NEVER_NETTED`
    // gives the four independent reasons that number would be wrong.
    const costSplit = splitByDay(input.costs.rows, (c) => c.paidOn, input.period);
    const costTaken = (0, coachMoney_1.sumTaken)(costSplit.inside.map((c) => ({
        amount_cents: c.amountCents,
        currency: c.currency,
        created_at: c.paidOn,
    })));
    const costReady = input.costs.status === 'ready' && readable;
    const costNotes = [coachCosts_1.COST_IS_YOUR_WORD, coachCosts_1.COSTS_ARE_NEVER_NETTED, coachCosts_1.COSTS_ARE_NOT_TAX_ADVICE];
    if (costReady) {
        for (const n of takenNotes(costTaken, 'cost'))
            costNotes.push(n);
        if (costSplit.undated > 0) {
            costNotes.push(`${costSplit.undated} cost${costSplit.undated === 1 ? '' : 's'} could not be dated and ${costSplit.undated === 1 ? 'is' : 'are'} in no period at all, including this one.`);
        }
    }
    const costsSection = {
        key: 'costs',
        title: 'Costs You Recorded Yourself',
        source: 'Written down by you, in this app, for money you say went out. Nothing behind them has been checked against a bank, a card or a supplier.',
        status: input.costs.status,
        count: costReady ? costSplit.inside.length : null,
        countLabel: costSplit.inside.length === 1 ? 'cost' : 'costs',
        lines: costReady
            ? costTaken.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'cost' : 'costs'} in ${p.currency}`,
                amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
            }))
            : [],
        withheld: withheldReason(input.costs.status, 'costs'),
        notes: costNotes,
    };
    /* ── the one combination this statement makes ──────────────────────────── */
    //
    // Only when BOTH halves came back whole. A sum over a page of a longer list
    // is not a smaller total, it is a wrong one — and this is the figure a coach
    // is most likely to copy straight into something else.
    const bothWhole = packsReady && subsReady && readable;
    const combined = bothWhole ? (0, coachMoney_1.combineTaken)(packTaken, subTaken) : null;
    const salesTotal = combined
        ? {
            lines: combined.pots.map((p) => ({
                label: `${p.count} ${p.count === 1 ? 'payment' : 'payments'} in ${p.currency}`,
                amount: (0, coachMoney_1.minorMoney)(p.minorUnits, p.currency) ?? '—',
            })),
            notes: takenNotes(combined, 'payment'),
        }
        : null;
    const salesWithheld = bothWhole
        ? null
        : readable
            ? 'No combined figure is stated, because one of the two reads behind it did not come back whole. Adding a complete half to an incomplete one produces a number that is wrong rather than small.'
            : exports.PERIOD_UNREADABLE;
    const caveats = statementCaveats(input);
    /* ── an unreadable period costs every figure, in one place ─────────────── */
    //
    // Each section above was built as though the split it was handed meant
    // something. Where the period does not read, no split does: `noPeriod` is
    // where all the dated rows went, `inside` is empty, and a count off an empty
    // `inside` is a nought about nothing. So the withholding is applied HERE, to
    // every section at once, rather than as a seventh copy of the same branch in
    // each of them — a per-section branch is how six of them get it right and the
    // seventh prints a nought.
    //
    // The read status is left exactly as it was. The reads DID succeed and saying
    // otherwise would send a coach to fix a query that is fine; what is withheld
    // is the figure, and `PERIOD_UNREADABLE` says which of the two went wrong.
    const sections = readable
        ? [sessionsSection, packsSection, subsSection, receiptsSection, invoicesSection, feesSection, payoutsSection, refundsSection, disputesSection, costsSection]
        : [sessionsSection, packsSection, subsSection, receiptsSection, invoicesSection, feesSection, payoutsSection, refundsSection, disputesSection, costsSection]
            .map((s) => ({
            ...s,
            // `count` and `lines` are already empty here, because every `…Ready`
            // boolean above is ANDed with `readable` — as are the notes, which is
            // the half a post-hoc blanking would have missed. What this map adds is
            // the one thing those booleans cannot: the REASON. `withheldReason`
            // answers null under a 'ready' read, and the read was ready; it is the
            // period that was not, and the section has to say which.
            count: null,
            lines: [],
            withheld: exports.PERIOD_UNREADABLE,
        }));
    return {
        period: input.period,
        issuerName: (input.issuer.name || '').trim() || null,
        issuerStatus: input.issuer.status,
        brand: (input.issuer.brand || '').trim() || null,
        generatedAt: input.generatedAt,
        sections,
        salesTotal,
        salesWithheld,
        payouts: payoutFacts(input.payouts),
        caveats,
        complete: caveats.length === 0,
    };
}
const STYLE = `
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;padding:26px;margin:0;font-size:14px;line-height:1.45}
  .h{background:#0f172a;color:#fff;padding:18px 22px;border-radius:14px}
  .h h1{margin:0;font-size:21px} .h p{margin:4px 0 0;opacity:.85;font-size:12px}
  h2{font-size:14px;margin:24px 0 6px;padding-bottom:5px;border-bottom:2px solid #0f172a}
  p{margin:6px 0}
  .lede{color:#475569;font-size:12px}
  .warn{border:2px solid #b45309;border-radius:10px;padding:12px 14px;margin-top:16px}
  .warn h3{margin:0 0 6px;font-size:13px;color:#b45309;text-transform:uppercase;letter-spacing:.5px}
  .warn li{margin-bottom:5px}
  .not{border:3px solid #b91c1c;border-radius:10px;padding:14px 16px;margin-top:16px;color:#b91c1c}
  .not h3{margin:0 0 4px;font-size:14px;text-transform:uppercase;letter-spacing:1px}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}
  th{color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  .r{text-align:right}
  .none{color:#64748b}
  .foot{margin-top:26px;padding-top:12px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px}
`;
/**
 * The statement, in HTML and in plain text.
 *
 * Both are built from the same values in the same order, so the text a coach
 * sends from a build with no expo-print says exactly what the PDF would have
 * said — including every standing statement and every caveat. A text fallback
 * that dropped those would be the same failure arriving through the back door.
 */
function statementDoc(s) {
    const H = [];
    const T = [];
    const readIssuer = s.issuerStatus === 'ready' || s.issuerStatus === 'partial';
    H.push(`<div class="h"><h1>Statement of Record</h1><p>${(0, coachInvoice_1.escapeHtml)(periodSentence(s.period))}${s.brand ? ' · ' + (0, coachInvoice_1.escapeHtml)(s.brand) : ''}</p></div>`);
    T.push('STATEMENT OF RECORD');
    T.push(periodSentence(s.period) + (s.brand ? ' · ' + s.brand : ''));
    /* ── what it is not, before anything a reader could mistake for a figure ─ */
    H.push(`<div class="not"><h3>Read this first</h3><p>${(0, coachInvoice_1.escapeHtml)(exports.STATEMENT_NOT)}</p></div>`);
    T.push('', '*** READ THIS FIRST ***', exports.STATEMENT_NOT);
    /* ── the caveats, where they cannot be scrolled past ────────────────────── */
    if (!s.complete) {
        H.push('<div class="warn"><h3>Parts of this could not be read</h3><ul>');
        T.push('', '*** PARTS OF THIS COULD NOT BE READ ***');
        for (const c of s.caveats) {
            H.push(`<li>${(0, coachInvoice_1.escapeHtml)(c)}</li>`);
            T.push('- ' + c);
        }
        H.push('</ul></div>');
    }
    /* ── whose it is ───────────────────────────────────────────────────────── */
    H.push('<h2>Whose record this is</h2>');
    T.push('', 'WHOSE RECORD THIS IS');
    if (!readIssuer) {
        H.push('<p class="none"><b>Not read.</b> The name on this account could not be read when this statement was made, so nothing is printed here. This is not a statement that the record has no name in it.</p>');
        T.push('Name: NOT READ — the name on this account could not be read. This is not a statement that the record has no name in it.');
    }
    else if (!s.issuerName) {
        H.push('<p class="none">No name has been recorded on this account.</p>');
        T.push('Name: no name has been recorded on this account.');
    }
    else {
        H.push(`<p><b>${(0, coachInvoice_1.escapeHtml)(s.issuerName)}</b></p>`);
        T.push(s.issuerName);
    }
    H.push(`<p class="lede">Period: ${(0, coachInvoice_1.escapeHtml)(periodSentence(s.period))}. Built ${(0, coachInvoice_1.escapeHtml)(String(s.generatedAt))}.</p>`);
    T.push(`Period: ${periodSentence(s.period)}. Built ${s.generatedAt}.`);
    H.push(`<p class="lede">${(0, coachInvoice_1.escapeHtml)(exports.PERIOD_IS_YOURS)}</p>`);
    T.push(exports.PERIOD_IS_YOURS);
    /* ── the sections ──────────────────────────────────────────────────────── */
    for (const sec of s.sections) {
        H.push(`<h2>${(0, coachInvoice_1.escapeHtml)(sec.title)}</h2>`);
        T.push('', sec.title.toUpperCase());
        H.push(`<p class="lede">Source: ${(0, coachInvoice_1.escapeHtml)(sec.source)}</p>`);
        T.push(`Source: ${sec.source}`);
        if (sec.withheld) {
            H.push(`<p class="none"><b>No figure.</b> ${(0, coachInvoice_1.escapeHtml)(sec.withheld)}</p>`);
            T.push(`NO FIGURE: ${sec.withheld}`);
        }
        else {
            H.push(`<p><b>${sec.count} ${(0, coachInvoice_1.escapeHtml)(sec.countLabel)}</b> in this period.</p>`);
            T.push(`${sec.count} ${sec.countLabel} in this period.`);
            if (sec.lines.length) {
                H.push('<table><tr><th>Recorded</th><th class="r">Amount</th></tr>'
                    + sec.lines.map((l) => `<tr><td>${(0, coachInvoice_1.escapeHtml)(l.label)}</td><td class="r">${(0, coachInvoice_1.escapeHtml)(l.amount)}</td></tr>`).join('')
                    + '</table>');
                for (const l of sec.lines)
                    T.push(`  ${l.label}   ${l.amount}`);
            }
        }
        for (const n of sec.notes) {
            H.push(`<p class="lede">${(0, coachInvoice_1.escapeHtml)(n)}</p>`);
            T.push(n);
        }
    }
    /* ── the one combined figure ───────────────────────────────────────────── */
    H.push('<h2>Packs and Renewals Together</h2>');
    T.push('', 'PACKS AND RENEWALS TOGETHER');
    if (s.salesTotal) {
        H.push('<p class="lede">The two sections above are the only two figures on this statement that may be added, and they are added one currency at a time.</p>');
        T.push('The two sections above are the only two figures on this statement that may be added, and they are added one currency at a time.');
        if (s.salesTotal.lines.length) {
            H.push('<table><tr><th>Recorded</th><th class="r">Amount</th></tr>'
                + s.salesTotal.lines.map((l) => `<tr><td>${(0, coachInvoice_1.escapeHtml)(l.label)}</td><td class="r">${(0, coachInvoice_1.escapeHtml)(l.amount)}</td></tr>`).join('')
                + '</table>');
            for (const l of s.salesTotal.lines)
                T.push(`  ${l.label}   ${l.amount}`);
        }
        else {
            H.push('<p class="none">Nothing was recorded in either section in this period.</p>');
            T.push('Nothing was recorded in either section in this period.');
        }
        for (const n of s.salesTotal.notes) {
            H.push(`<p class="lede">${(0, coachInvoice_1.escapeHtml)(n)}</p>`);
            T.push(n);
        }
    }
    else {
        H.push(`<p class="none"><b>No figure.</b> ${(0, coachInvoice_1.escapeHtml)(s.salesWithheld ?? '')}</p>`);
        T.push(`NO FIGURE: ${s.salesWithheld ?? ''}`);
    }
    /* ── payouts ───────────────────────────────────────────────────────────── */
    H.push(`<h2>${(0, coachInvoice_1.escapeHtml)(s.payouts.title)}</h2>`);
    T.push('', s.payouts.title.toUpperCase());
    for (const l of s.payouts.lines) {
        H.push(`<p class="lede">${(0, coachInvoice_1.escapeHtml)(l)}</p>`);
        T.push(l);
    }
    /* ── what this document is, and is not ─────────────────────────────────── */
    H.push('<h2>About this statement</h2>');
    T.push('', 'ABOUT THIS STATEMENT');
    for (const line of [exports.STATEMENT_IS, exports.STATEMENT_NOT, exports.STATEMENT_NOT_THE_WHOLE_BOOK, exports.STATEMENT_STRIPE_IS_THE_RECORD]) {
        H.push(`<p class="lede">${(0, coachInvoice_1.escapeHtml)(line)}</p>`);
        T.push(line);
    }
    const foot = s.complete
        ? `Statement of record for ${periodSentence(s.period)}${s.brand ? ', from ' + s.brand : ''}. Not a tax document.`
        : `Statement of record for ${periodSentence(s.period)} — PARTS OF THIS COULD NOT BE READ, see above${s.brand ? '. From ' + s.brand : ''}. Not a tax document.`;
    H.push(`<p class="foot">${(0, coachInvoice_1.escapeHtml)(foot)}</p>`);
    T.push('', foot);
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head><body>${H.join('')}</body></html>`;
    return { html, text: T.join('\n'), complete: s.complete, caveats: s.caveats };
}
/* ── the line-item file ───────────────────────────────────────────────────── */
/**
 * Everything that must force a CSV field to be quoted.
 *
 * Wider than RFC 4180, and the same set gymExport.ts uses, for the same reason:
 * `sniffDelimiter` in src/lib/csv.ts will happily decide a file is semicolon-
 * or tab-separated, and so will a spreadsheet in a comma-decimal locale. A
 * client called "Smith, Jr." or a description reading "8 sessions; paid cash"
 * must not become an extra column, because every column after it shifts and the
 * amount lands under the wrong heading.
 */
const NEEDS_QUOTES = /[",\r\n;\t|]/;
function cell(v) {
    if (v === null || v === undefined)
        return '';
    if (typeof v === 'number')
        return Number.isFinite(v) ? String(v) : '';
    const s = String(v);
    if (s === '')
        return '';
    return NEEDS_QUOTES.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const CSV_HEADER = ['part', 'date', 'who', 'what', 'currency', 'amount', 'status', 'note'];
/**
 * The line items, as a file an accountant opens.
 *
 * The first rows are not data. They are the same standing statements the
 * readable document carries, one per row under `part = about`, so the file says
 * what it is and what it is not on its own face — a CSV that arrives in
 * somebody's inbox with a covering note gets separated from the note.
 *
 * Every part that could not be read gets its own row under `part = not read`,
 * BEFORE the items, so a short file cannot be mistaken for a quiet year. This
 * is the lesson from the console's export: "every part was read successfully"
 * is a sentence a truncating read also satisfies, so what is written here is
 * the failure by name rather than a claim of success.
 *
 * The `amount` column is a plain decimal in the currency beside it, through
 * `minorToPlain` / `majorToPlain` — currency-aware, so a yen figure is not
 * divided by a hundred, and empty rather than zero when the amount cannot be
 * denominated.
 */
function statementCsv(s) {
    const rows = [];
    rows.push(['about', '', '', 'What this is', '', '', '', exports.STATEMENT_IS]);
    rows.push(['about', '', '', 'What this is NOT', '', '', '', exports.STATEMENT_NOT]);
    rows.push(['about', '', '', 'What is missing from it', '', '', '', exports.STATEMENT_NOT_THE_WHOLE_BOOK]);
    rows.push(['about', '', '', 'Who holds the real record', '', '', '', exports.STATEMENT_STRIPE_IS_THE_RECORD]);
    rows.push(['about', '', '', 'The period', '', '', '', `${periodSentence(s.period)}. ${exports.PERIOD_IS_YOURS}`]);
    rows.push(['about', '', '', 'Whose record', '', '', '',
        s.issuerStatus === 'ready' || s.issuerStatus === 'partial'
            ? (s.issuerName ?? 'No name has been recorded on this account.')
            : 'NOT READ — the name on this account could not be read when this file was made.']);
    rows.push(['about', '', '', 'Built', '', '', '', String(s.generatedAt)]);
    if (s.caveats.length) {
        for (const c of s.caveats)
            rows.push(['not read', '', '', 'A part of this record is missing from this file', '', '', '', c]);
    }
    else {
        // Deliberately not "everything was read successfully". Every read this file
        // is built from returned whole and none of them hit its row cap — which is a
        // narrower claim than completeness, and it is the one that is true.
        rows.push(['about', '', '', 'Reads', '', '', '', 'Every read behind this file returned in full and none of them stopped at a row limit. That is a statement about the reads, not about your whole book — see the row above about what is missing from it.']);
    }
    for (const sec of s.sections) {
        if (sec.withheld) {
            rows.push([sec.key, '', '', sec.title, '', '', 'no figure', sec.withheld]);
            continue;
        }
        rows.push([sec.key, '', '', sec.title, '', '', 'read in full', `${sec.count} ${sec.countLabel}. Source: ${sec.source}`]);
        for (const l of sec.lines)
            rows.push([sec.key, '', '', l.label, '', '', 'total', l.amount]);
        for (const n of sec.notes)
            rows.push([sec.key, '', '', sec.title, '', '', 'note', n]);
    }
    return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
/** The one sentence written beside every empty amount cell in this file. A
 *  hole and a nought are different facts and the hole has to say so where it
 *  is, because a cell is read on its own line and not with the covering note. */
const NO_CURRENCY_CELL = 'No currency is recorded on this one, so no amount is written. Do not read the empty cell as nothing charged.';
function statementItemsCsv(s, items) {
    const rows = [];
    rows.push(['about', '', '', 'What this is NOT', '', '', '', exports.STATEMENT_NOT]);
    rows.push(['about', '', '', 'The period', '', '', '', periodSentence(s.period)]);
    rows.push(['about', '', '', 'Nothing is netted', '', '', '', 'Every amount below is the size of what moved and the first column says which way. Money in and money back out are on the same lines and are deliberately not signed, so no column here adds up to anything on its own.']);
    rows.push(['about', '', '', 'Late-cancellation fees', '', '', '', exports.LATE_FEES_ONLY_CURRENT_CLIENTS]);
    rows.push(['about', '', '', 'Refunds', '', '', '', exports.REFUNDS_ARE_A_RUNNING_TOTAL]);
    for (const c of s.caveats)
        rows.push(['not read', '', '', 'A part of this record is missing from this file', '', '', '', c]);
    // The period, once, for every split below. Where it does not read, no row can
    // be placed in it — every split comes back empty — and a file of about-rows
    // with no items under it would look like a quiet period rather than an
    // unreadable one. `statementCaveats` has already put PERIOD_UNREADABLE in the
    // caveats above; this is the row that stands where the items would have been.
    if (!periodReads(s.period)) {
        rows.push(['not read', '', '', 'No items are listed in this file', '', '', 'no period', exports.PERIOD_UNREADABLE]);
        return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
    }
    const range = periodRange(s.period);
    const inPeriodInvoices = splitByDay(items.invoices, (i) => i.issuedOn, s.period).inside;
    const inPeriodFees = splitByPeriod(items.fees, (f) => f.createdAt, range).inside;
    const inPeriodRefunds = splitByPeriod(items.refunds, (r) => r.refundedAt, range).inside;
    const inPeriodDisputes = splitByPeriod(items.disputes, (d) => d.openedAt, range).inside;
    const inPeriodCosts = splitByDay(items.costs, (c) => c.paidOn, s.period).inside;
    for (const i of inPeriodInvoices) {
        rows.push([
            'invoice',
            i.issuedOn,
            i.billTo,
            i.description,
            i.currency ?? '',
            minorToPlain(i.amountCents, i.currency) ?? '',
            i.voidedAt ? 'voided' : (i.kind === 'received' ? 'stated received' : 'stated requested'),
            i.currency ? '' : NO_CURRENCY_CELL,
        ]);
    }
    for (const f of inPeriodFees) {
        rows.push([
            'late cancellation',
            String(f.createdAt ?? '').slice(0, 10),
            '',
            'Late-cancellation fee',
            f.currency ?? '',
            majorToPlain(f.amount, f.currency) ?? '',
            f.waivedAt ? 'waived' : 'recorded',
            f.currency ? '' : NO_CURRENCY_CELL,
        ]);
    }
    // Money OUT. Unsigned, like everything else here — see the note row above.
    // `who` is left empty rather than filled from the sale: the refund columns
    // carry no name and joining one on would put a person against an amount on
    // the strength of a lookup this file did not make.
    for (const r of inPeriodRefunds) {
        rows.push([
            'refund',
            String(r.refundedAt ?? '').slice(0, 10),
            '',
            r.on === 'renewal' ? 'Refunded on a subscription renewal' : 'Refunded on a pack or membership sale',
            r.currency ?? '',
            minorToPlain(r.refundedCents, r.currency) ?? '',
            'given back',
            r.currency ? '' : NO_CURRENCY_CELL,
        ]);
    }
    for (const d of inPeriodDisputes) {
        rows.push([
            'chargeback',
            String(d.openedAt ?? '').slice(0, 10),
            '',
            d.reason ? `Chargeback — reason given: ${d.reason}` : 'Chargeback — no reason was given',
            d.currency ?? '',
            minorToPlain(d.amountCents, d.currency) ?? '',
            // Stripe's own status word, verbatim. Nothing here rewrites it into an
            // outcome, and an open one says it is open rather than reading as nothing.
            String(d.status || '').trim() || 'status not stated',
            d.currency ? '' : NO_CURRENCY_CELL,
        ]);
    }
    for (const c of inPeriodCosts) {
        rows.push([
            'cost',
            c.paidOn,
            '',
            c.description,
            c.currency ?? '',
            minorToPlain(c.amountCents, c.currency) ?? '',
            // The coach's own category word, and never read as a claim about tax.
            String(c.category || '').trim() || 'uncategorised',
            c.currency ? '' : NO_CURRENCY_CELL,
        ]);
    }
    return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
/**
 * A filename that carries its own warning.
 *
 * An incomplete file is named INCOMPLETE, the way gymExport.ts names one, so
 * the fact survives being saved to a desktop and opened three weeks later by
 * somebody who never read the covering note.
 */
function statementFileStem(s) {
    const slug = (s.brand ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    const base = ['statement-of-record', slug, s.period.from, 'to', s.period.to].filter(Boolean).join('-');
    return s.complete ? base : base + '-INCOMPLETE';
}
/**
 * What the share sheet says before the file leaves the phone.
 *
 * A coach about to send an accountant a document with figures on it is entitled
 * to know, in advance, that a part of it is missing. Afterwards is too late,
 * because it is already in somebody else's inbox and it is being worked from.
 */
function statementShareBlurb(s) {
    const parts = [
        `Statement of record for ${periodSentence(s.period)}. It says on its own face that it is not a tax document, that no tax has been calculated on it, and that nothing has been taken off the figures.`,
    ];
    if (!s.complete) {
        parts.push(`BEFORE YOU SEND IT: ${s.caveats.length} part${s.caveats.length === 1 ? '' : 's'} of your record could not be read just now, so the file names ${s.caveats.length === 1 ? 'it' : 'them'} rather than looking complete, and its filename says INCOMPLETE. You can send it as it is, or close this and try again in a moment.`);
    }
    return parts.join('\n\n');
}
