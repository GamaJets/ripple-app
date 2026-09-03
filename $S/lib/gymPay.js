"use strict";
// What a gym pays its own coaches — per session, per class, and everything
// that is neither.
//
// Three gaps close here and they are one piece of work because they are one
// payroll run.
//
// ── Every coach was paid the same ─────────────────────────────────────────
//
// `payroll30For` in src/lib/gymTrainers.ts multiplies delivered sessions by a
// single `tenants.session_fee`, so a coach of fifteen years and a trainee in
// their first month are worth an identical amount to the payroll screen, and
// /payroll offers no override anywhere.
//
// `trainers.session_fee` is NOT the missing value and must never be read as it.
// supabase/parts/23 added it as part of the public directory — tagline, offers,
// specialties, session_fee, listed — and it is what a coach CHARGES a client
// for private work booked through the app. Reading it as what the gym pays them
// would take a coach's own price list and hand it to their employer's payroll
// run: a different number, usually a bigger one, and not the gym's to use.
//
// ── Teaching a class was unpaid by the system ─────────────────────────────
//
// `payroll_settlements` links to `sessions` and nothing else, so a trainer who
// taught twelve classes and covered twenty floor hours is owed nothing this
// product can compute. app/(owner)/class-analytics.tsx holds the per-attendee
// rate in `useState` and says on screen that "nothing is paid from this screen",
// which is honest and is the whole problem.
//
// ── A run could not be undone or adjusted ─────────────────────────────────
//
// `recordSettlement` is insert-only. Pressing "Mark as paid" before the money
// moves stamps every session in the run permanently and drops them out of "Owed
// now", and the only way back is editing rows in the Supabase dashboard.
//
// ── The rate that applies, and the order it is looked for ─────────────────
//
// Three layers, most specific first, and the order matters more than any single
// layer:
//
//   1. `sessions.rate_cents` — snapshotted when the outcome was marked. This is
//      what was AGREED for that session and nothing may override it. It is why
//      a rate rise in March does not retroactively repay January.
//   2. `gym_trainer_pay.session_rate_cents` — what this gym pays this coach,
//      today, for a session that carries no snapshot.
//   3. `tenants.session_fee` — the gym's standing figure, which is what
//      everything used before this file existed.
//
// A null at every layer means the session is UNPRICED, which is not free.
// `payrollTotal` in src/lib/gymSessions.ts already refuses to answer over
// unpriced work and `settlementBlocker` says so; nothing here weakens that.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADJUSTMENT_LABEL = exports.ADJUSTMENT_KINDS = exports.CLASS_PAY_LABEL = void 0;
exports.rateForSession = rateForSession;
exports.withResolvedRates = withResolvedRates;
exports.payCurrency = payCurrency;
exports.fetchTrainerPay = fetchTrainerPay;
exports.payRateBlocker = payRateBlocker;
exports.parseRate = parseRate;
exports.saveTrainerPay = saveTrainerPay;
exports.classPayAmount = classPayAmount;
exports.classPayBlocker = classPayBlocker;
exports.fetchClassPay = fetchClassPay;
exports.addClassPay = addClassPay;
exports.adjustmentSign = adjustmentSign;
exports.adjustmentBlocker = adjustmentBlocker;
exports.fetchAdjustments = fetchAdjustments;
exports.addAdjustment = addAdjustment;
exports.adjustmentsTotal = adjustmentsTotal;
exports.runScopeOf = runScopeOf;
exports.scopedToRun = scopedToRun;
exports.runTotal = runTotal;
exports.runCurrencyBlocker = runCurrencyBlocker;
exports.reverseSettlement = reverseSettlement;
exports.reversalReasonBlocker = reversalReasonBlocker;
exports.stampRunExtras = stampRunExtras;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
// Whether every session the run paid for actually came loose. The three
// unstamps below asked for a row count and read none of them.
const unstampCheck_1 = require("./unstampCheck");
const gymRecord_1 = require("./gymRecord");
// The one reader for a typed amount in this product. See parseRate.
const coachMoney_1 = require("./coachMoney");
// A timestamp read as the day it fell on IN THE GYM'S OWN TIMEZONE.
//
// This comment used to sit over `isoDate` alone and was half right about the
// wrong half. Slicing the ISO string does give the UTC day, and a class at nine
// on the last evening of the month in a gym west of Greenwich is a UTC row for
// the 1st — filed, and paid, in the following month's run. But `isoDate` is not
// the gym's day either: it is the LOCAL day of whichever machine has /payroll
// open. src/lib/gymZone.ts names both of those as the two wrong answers, and
// `gymDay` is the one right one. `isoDate` stays only as the disclosed fallback
// for a gym that has not set a zone — the shape gymTodayWindow already uses.
const gymZone_1 = require("./gymZone");
const format_1 = require("./format");
exports.CLASS_PAY_LABEL = {
    per_class: 'A flat amount for the class',
    per_attendee: 'An amount for each person who turned up',
};
/**
 * The rate that applies to one session, in minor units, or null when nobody has
 * priced it.
 *
 * The whole of the three-layer rule, in one place, so that `payrollByTrainer`,
 * `settleableSessions` and `settlementAmount` cannot each hold a different
 * opinion of what "priced" means. They already did once: `settleableSessions`
 * required `rateCents != null` while `payrollByTrainer` was pricing the same
 * sessions off the gym fee, so the screen said AED 1,500 owed and the button
 * said "nothing outstanding" — and on a mixed month there was no blocker at
 * all, the screen said 1,500 and settling handed over 900. This is the shape
 * that prevents the third version of that.
 */
function rateForSession(s, pay, gymFeeCents) {
    if (s.rateCents != null)
        return s.rateCents;
    const own = s.trainerId ? pay.get(s.trainerId)?.sessionRateCents : null;
    if (own != null)
        return own;
    return gymFeeCents;
}
/**
 * The same sessions with the effective rate written onto each one.
 *
 * This exists rather than a `perTrainerRate` argument threaded through
 * `payrollByTrainer`, `settleableSessions` and `settlementAmount` because those
 * three have ALREADY disagreed about what "priced" means once, and the
 * consequence was a screen saying AED 1,500 owed while the button handed over
 * 900 and stamped the sessions as paid. Three functions with three copies of a
 * three-layer fallback is that bug waiting for its third outing.
 *
 * Resolving once, up front, means every one of them sees the same number
 * because they are all reading the same field. Nothing is written to the
 * database: `sessions.rate_cents` still holds only what was snapshotted at
 * delivery, and a session priced here off a trainer's current rate is priced
 * off it every time this screen loads until somebody settles it — at which
 * point `recordSettlement` snapshots the amount that was actually handed over.
 *
 * The objects are copies. Mutating the caller's rows would leave a screen
 * showing a rate the record does not hold, which is exactly the confusion
 * `sessions.rate_cents` exists to prevent.
 */
function withResolvedRates(sessions, pay, gymFeeCents) {
    return sessions.map((s) => {
        const rate = rateForSession(s, pay, gymFeeCents);
        return rate === s.rateCents ? s : { ...s, rateCents: rate };
    });
}
/**
 * The one currency a set of pay rates agrees on, or null.
 *
 * A gym paying one coach in GBP and another in EUR has no single payroll total,
 * and the screen must say so rather than adding them. A coach with no rate set
 * states nothing and does not disagree — they fall back to the gym's fee, which
 * is denominated in the gym's own currency.
 */
function payCurrency(rates, gymCurrency) {
    const stated = new Set(rates.map((r) => (r.currency ?? '').trim().toUpperCase()).filter((c) => !!c));
    if (stated.size === 0)
        return gymCurrency;
    if (stated.size > 1)
        return null;
    const only = [...stated][0];
    // A gym whose stated rates are in one currency and whose own currency is
    // another is a real disagreement, not a fallback. Two answers, so neither.
    if (gymCurrency && gymCurrency !== only)
        return null;
    return only;
}
async function fetchTrainerPay(sb, tenantId) {
    const { data, error } = await sb
        .from('gym_trainer_pay')
        .select('trainer_id, session_rate_cents, class_pay_kind, class_rate_cents, currency, updated_at')
        .eq('tenant_id', tenantId)
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    const out = new Map();
    // Capped and refusing. A truncated read here does not make payroll smaller in
    // a visible way — it silently drops the coaches whose rows fell off the end
    // back onto the gym's standard fee, which for a senior coach is a smaller
    // payslip that looks exactly like a correct one.
    for (const r of (0, rowCap_1.assertWhole)(data, "this gym's pay rates")) {
        out.set(r.trainer_id, {
            trainerId: r.trainer_id,
            sessionRateCents: numOrNull(r.session_rate_cents),
            classPayKind: r.class_pay_kind === 'per_class' || r.class_pay_kind === 'per_attendee' ? r.class_pay_kind : null,
            classRateCents: numOrNull(r.class_rate_cents),
            currency: (r.currency ?? '').trim().toUpperCase() || null,
            updatedAt: r.updated_at ?? null,
        });
    }
    return out;
}
/** Why a rate cannot be saved, or null when it can. */
function payRateBlocker(sessionRate, classRate, classKind, currency) {
    // ── Why the currency is asked about FIRST ─────────────────────────────────
    //
    // This sentence used to sit at the bottom of this function, as
    // `if ((s.kind === 'rate' || c.kind === 'rate') && !currency)`, and it could
    // not run. `parseRate` refuses any non-empty rate when there is no currency
    // — `readMinorAmount` has nothing to take the decimal places from — so
    // neither side can be 'rate' while `currency` is null, and the check was
    // dead. Deleting all three lines left every suite green, which is how it was
    // found.
    //
    // The cost was not a dead line. It was that an owner who types a rate before
    // setting the gym's currency got `parseRate`'s generic refusal — "an amount
    // typed in would not be an amount of any money" — prefixed with a field
    // name, which describes a parser's difficulty. The sentence written for this
    // exact case says what to do about it and why it matters: the missing thing
    // is the GYM'S currency, one setting away, and the reason it cannot be
    // skipped is that a rate is what somebody is actually paid.
    //
    // So the order is inverted rather than the branch deleted: ask whether the
    // gym has a currency before asking the parser to read money in it. Gated on
    // something having been typed, because clearing both rates needs no currency
    // — nothing is left denominated — and that is a real state a gym without a
    // currency must still be able to reach.
    //
    // A currency that is stated but not one this runtime knows the places for
    // still falls through to `parseRate`, which is the right voice for it: the
    // gym HAS said what money it is in, and the difficulty is with the code.
    if (!currency && (isTyped(sessionRate) || isTyped(classRate))) {
        return 'This gym has not set its currency, so a rate cannot say what money it is in — and a rate is what somebody is actually paid.';
    }
    // The currency this function already takes, now passed down. It was in scope
    // the whole time and `parseRate` was doing its own arithmetic beside it.
    const s = parseRate(sessionRate, currency);
    if (s.kind === 'bad')
        return `Session rate: ${s.reason}`;
    const c = parseRate(classRate, currency);
    if (c.kind === 'bad')
        return `Class rate: ${c.reason}`;
    if (c.kind === 'rate' && classKind === '') {
        return 'Say how the class rate is counted — a flat amount for the class, or an amount per person. "80" and "8 a head" are the same number of digits and completely different money.';
    }
    if (c.kind === 'clear' && classKind !== '') {
        return 'A way of counting class pay with no rate beside it pays nothing. Enter the rate, or clear the counting method.';
    }
    return null;
}
/** Did somebody type something into this box, as opposed to leaving it or
 *  clearing it? The same emptiness `parseRate` reads as 'clear'. */
function isTyped(v) {
    return String(v ?? '').trim() !== '';
}
/**
 * A rate as typed, in whole units → minor units.
 *
 * Empty CLEARS, and zero is a value. That distinction is the same one
 * `parseSessionFee` in src/lib/gymSettings.ts makes and it matters more here:
 * clearing means "this coach is on the gym's standard fee", and zero means "the
 * gym pays this coach nothing per session", which is a claim somebody has to
 * make deliberately — a volunteer, an owner coaching their own clients — and
 * which must not be reachable by tabbing past an empty box.
 */
function parseRate(input, currency) {
    // ── the two bugs that were in one line ───────────────────────────────────
    //
    // This began `.replace(/[,\s]/g, '')` and ended `Math.round(Number(bare) *
    // 100)`, and it is the SHARED rate parser: the console's payroll editor and
    // the owner phone's class-rate editor both price people through it.
    //
    // The comma strip made `52,50` — how most of Europe writes it — into `5250`,
    // and the hundred then made that 525,000 minor units. A front desk setting a
    // coach's rate to fifty-two fifty set it to five thousand two hundred and
    // fifty, on both surfaces, silently.
    //
    // The hundred was wrong on its own terms too. It is right for a sterling gym
    // and wrong for a third of the currencies this product supports: a Tokyo gym
    // paying ¥5,000 an hour recorded ¥500,000, and the `\d{1,2}` decimal rule
    // made a Kuwaiti gym's three-place rate unstatable in the first place.
    //
    // `readMinorAmount` takes the places from the currency, refuses a thousands
    // separator rather than guessing which side of the Channel the typist grew up
    // on, and refuses a third decimal place rather than rounding it. It is the
    // one reader for a typed amount in this product, and this was the last write
    // path doing its own arithmetic.
    //
    // The currency is an argument with no default. A rate with no currency is a
    // number, and this is what somebody is paid.
    const raw = String(input ?? '').trim();
    if (!raw)
        return { kind: 'clear' };
    if (/-/.test(raw))
        return { kind: 'bad', reason: 'A rate cannot be negative. A deduction is an adjustment line, not a rate.' };
    const read = (0, coachMoney_1.readMinorAmount)(raw, currency);
    if (!read.ok)
        return { kind: 'bad', reason: read.reason };
    // `rate_cents` is a plain integer column, so anything past 2^31-1 is refused
    // by the database with a 22003 after the form has closed. The ceiling is in
    // MINOR units, which is what the column holds.
    if (read.minorUnits > 2147483647) {
        return { kind: 'bad', reason: 'That is more than Repple will record as a rate — check the zeros.' };
    }
    return { kind: 'rate', cents: read.minorUnits };
}
/**
 * Store what this gym pays this coach.
 *
 * An upsert on the unique index, with the conflict target named. PostgREST
 * defaults to the primary key, which never collides, so an unnamed upsert would
 * write a second rate row for the same coach every time the owner pressed Save
 * — and `fetchTrainerPay` would then return whichever of them the database felt
 * like ordering first.
 */
async function saveTrainerPay(sb, tenantId, p) {
    const r = await sb.from('gym_trainer_pay').upsert({
        tenant_id: tenantId,
        trainer_id: p.trainerId,
        session_rate_cents: p.sessionRateCents,
        class_pay_kind: p.classPayKind,
        class_rate_cents: p.classRateCents,
        // A row with no amounts on it carries no currency either, which is what the
        // `gym_trainer_pay_amount_has_currency` constraint requires and is also the
        // honest state: nothing has been priced, so nothing is denominated.
        currency: p.sessionRateCents == null && p.classRateCents == null ? null : p.currency,
        updated_at: new Date().toISOString(),
        updated_by: p.updatedBy,
    }, { onConflict: 'tenant_id,trainer_id', count: 'exact' });
    if (r.error)
        throw r.error;
    // COUNTED, like every other write in this file.
    //
    // This is the write that decides what a coach is paid, and it was the only
    // one here reporting success from `error` alone. The narrow argument for
    // that was sound as far as it went — an INSERT blocked by a WITH CHECK
    // policy raises 42501, and `ON CONFLICT DO UPDATE` raises rather than
    // silently skipping when the UPDATE policy's USING clause fails — so the
    // ordinary RLS refusal does arrive as an error.
    //
    // It is not the whole set of ways nothing gets written. A future policy
    // written as a filter, a trigger that returns NULL, a conflict target that
    // stops matching the constraint it names: each of those is a 2xx with no
    // rows touched, and each would leave a gym believing it had just set a
    // senior coach's rate while payroll went on paying the standing fee — the
    // smaller figure, month after month, looking exactly like a correct one.
    // Counting costs one word and removes the whole class.
    (0, wroteRows_1.assertWrote)('What this gym pays that coach', r);
}
/**
 * What one taught class is worth, in minor units, or null when it cannot be
 * priced.
 *
 * A per-attendee class with an unknown register is NULL, not zero. The
 * distinction is the whole reason this returns nullable: a class nobody took a
 * register for has an unknown headcount, and paying it at zero would be the
 * product deciding a coach taught to an empty room because the paperwork is
 * missing. `attendees === 0` is a real answer — an empty class — and pays zero.
 */
function classPayAmount(kind, rateCents, attendees) {
    if (!Number.isFinite(rateCents) || rateCents < 0)
        return null;
    if (kind === 'per_class')
        return rateCents;
    if (attendees == null || !Number.isFinite(attendees) || attendees < 0)
        return null;
    return rateCents * attendees;
}
/** Why a class cannot be added to the payroll, or null when it can. */
function classPayBlocker(pay, attendees, already) {
    if (already)
        return 'This class is already on a payroll line for this coach.';
    if (!pay || pay.classRateCents == null || pay.classPayKind == null) {
        return 'This gym has not said what it pays this coach to teach, so there is no rate to apply. Set one on Payroll.';
    }
    if (!pay.currency) {
        return 'The rate for this coach states no currency, so what they are owed cannot be written down.';
    }
    if (pay.classPayKind === 'per_attendee' && attendees == null) {
        return 'This class is paid per person and nobody took a register, so the headcount is unknown. Paying it at nought would say the coach taught to an empty room because the paperwork is missing.';
    }
    return null;
}
/**
 * Every class-pay line this gym has, with the date its class was taught.
 *
 * The date is read separately from `gym_classes` rather than embedded, for the
 * same reason `namesFor` is a second query: an embed is a join this module
 * cannot assert without a live database, and a class-pay line whose class row
 * fails to load must come back with `taughtOn: null` rather than not come back.
 *
 * `taughtOn` is what /payroll scopes a run by. Without it the run had no date
 * on these lines at all — see the note on `ClassPayLine.taughtOn`.
 *
 * ── Why this pages rather than refusing ────────────────────────────────────
 *
 * It was `.limit(capLimit())` plus `assertWhole`, tenant-wide with no date
 * bound, and a settled line is stamped rather than deleted. Twenty classes a
 * week is a thousand lines inside a year, so a gym in its second season crossed
 * the cap and the read threw — and because /payroll builds every coach's run
 * out of one call, the throw took the WHOLE screen with it. Nobody could be
 * paid from the console at all, including the coaches whose own lines were
 * nowhere near the cap. Refusing for good at a threshold the gym cannot get
 * back under is not honesty, it is a screen that stops working on a birthday.
 *
 * The run genuinely needs the whole set — a line settled in any past month is
 * how `runsFor` reconstructs what has already been paid, and an unsettled line
 * from before the period is paid on this run because it has no other run coming
 * (see `runScopeOf`) — so `readAll` finishes the read and `PAGE_CEILING` still
 * refuses past fifty thousand lines, which is a sentence about the size of the
 * read rather than about anybody's wages.
 *
 * `created_at` is a timestamp and a gym that registers a morning's classes in
 * one sitting has rows tied on it to the microsecond only rarely — but rarely
 * is not never, and `readAll` requires a TOTAL order or pages silently drop and
 * repeat rows. `id` is the primary key and supplies it.
 */
/*
 * ── Why `zone` is required and not optional ────────────────────────────────
 *
 * It WAS optional, and the console took the reader-clock fallback for as long
 * as it existed: /payroll called `fetchClassPay(supabase, tenantId)` with two
 * arguments, every line came back `taughtOnBasis: 'reader'`, and nothing on
 * that screen printed a word about it. The disclosure was real and unread,
 * which on a payroll run is the same as no disclosure at all — the coach at
 * the Dubai gym is still short a month, and the coach at the UTC+14 gym is
 * still missing from the run entirely.
 *
 * An optional parameter is a fallback a caller can take by saying nothing.
 * Required, a caller with no zone has to write `null`, and whoever reads that
 * line can ask whether the screen beside it says so. `tenants.timezone` is
 * what to pass — `fetchGymZone` in src/lib/gymZone.ts and `readTenant` in
 * studio-web/lib/currency.ts both hand it over already parsed, so a stored
 * value this runtime cannot resolve arrives as null rather than as a zone that
 * silently does nothing.
 */
async function fetchClassPay(sb, tenantId, zone) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('gym_class_pay')
        .select('id, class_id, trainer_id, pay_kind, rate_cents, attendees, amount_cents, currency, settlement_id, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), 'the class pay lines');
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.trainer_id));
    const taught = await classDatesFor(sb, rows.map((r) => r.class_id), zone);
    const basis = (0, gymZone_1.isZone)(zone) ? 'gym' : 'reader';
    return rows.map((r) => ({
        taughtOn: taught.get(r.class_id) ?? null,
        taughtOnBasis: basis,
        id: r.id,
        classId: r.class_id,
        trainerId: r.trainer_id,
        trainerName: names.get(r.trainer_id) ?? null,
        payKind: r.pay_kind === 'per_attendee' ? 'per_attendee' : 'per_class',
        rateCents: Number(r.rate_cents) || 0,
        attendees: numOrNull(r.attendees),
        amountCents: Number(r.amount_cents) || 0,
        currency: r.currency,
        settlementId: r.settlement_id ?? null,
        createdAt: r.created_at,
    }));
}
/**
 * Put one taught class onto the payroll.
 *
 * Everything is snapshotted — the kind, the rate, the headcount and the amount
 * — and never recomputed. A rate changed in March must not rewrite what a coach
 * was paid in January, which is the same reasoning as `sessions.rate_cents` and
 * `payroll_settlements.amount_cents`, and a register corrected afterwards must
 * not silently change a figure somebody has already been paid.
 */
async function addClassPay(sb, tenantId, line) {
    const r = await sb.from('gym_class_pay').insert({
        tenant_id: tenantId,
        class_id: line.classId,
        trainer_id: line.trainerId,
        pay_kind: line.payKind,
        rate_cents: line.rateCents,
        // NULL on a per-class line, whatever the caller passed.
        //
        // The headcount did not enter into the amount — `classPayAmount` returns
        // the flat rate and never looks at it — and
        // `gym_class_pay_attendees_shape` in supabase/parts/183 requires exactly
        // this: `(pay_kind = 'per_attendee') = (attendees is not null)`. A caller
        // that hands the register over for a flat-rate class is not recording a
        // useful extra fact, it is producing a 23514 that fails the whole insert,
        // so the class goes onto no payroll line at all and the coach is not paid
        // for teaching it. Deciding it here means one screen's habit cannot do
        // that; the constraint and this line say it independently.
        attendees: line.payKind === 'per_attendee' ? line.attendees : null,
        amount_cents: line.amountCents,
        currency: line.currency,
        created_by: line.createdBy,
    }, { count: 'exact' });
    if (r.error)
        throw r.error;
    // COUNTED, which the comment on `saveTrainerPay` claimed every write in this
    // file already was and which this one was not.
    //
    // An INSERT refused by `gym_class_pay_owner`'s WITH CHECK does arrive as a
    // 42501, so the ordinary RLS refusal is caught by `r.error` above. It is not
    // the whole set: a BEFORE INSERT trigger returning NULL, or a future policy
    // written as a filter, is a 2xx that wrote nothing — and this screen's
    // failure mode is silence. The owner sees the class move to "on payroll",
    // the run never picks a line up that does not exist, and the coach is simply
    // not paid for a class everybody believes was queued.
    (0, wroteRows_1.assertWrote)('That class pay line', r);
}
exports.ADJUSTMENT_KINDS = ['bonus', 'deduction', 'reimbursement', 'advance'];
/**
 * What each kind means, and it is not four words for two signs.
 *
 * A reimbursement is the gym paying back money the coach spent; a bonus is pay.
 * Both add, and a payslip that called one the other would be wrong in a way
 * that matters to whoever files it — one is taxable and one is not.
 */
exports.ADJUSTMENT_LABEL = {
    bonus: 'Bonus — extra pay',
    deduction: 'Deduction — taken off pay',
    reimbursement: 'Reimbursement — money they spent, paid back',
    advance: 'Advance — pay already handed over',
};
/**
 * The sign the kind implies, never typed.
 *
 * A screen that asks somebody to enter a negative number will one day be handed
 * a positive one, and a deduction of 50 recorded as +50 is a coach paid a
 * hundred more than they should have been. supabase/parts/183 enforces the same
 * rule at the database, so the two say it independently.
 */
function adjustmentSign(kind) {
    return kind === 'deduction' || kind === 'advance' ? -1 : 1;
}
/** Why an adjustment cannot be recorded, or null. */
function adjustmentBlocker(amount, note, currency) {
    // First, and for the reason `payRateBlocker` gives at length: this check was
    // the LAST line of this function and was unreachable by exactly the same
    // route. `parseRate` refuses a non-empty amount with no currency, so `r` was
    // never 'rate' when `currency` was null and the sentence below never
    // printed. An owner recording a bonus at a gym with no currency set read a
    // parser's complaint instead of the one fact that stops them.
    //
    // Gated on something having been typed, so an empty box still gets "enter
    // the amount" — which is the more useful of the two when there is nothing
    // there at all.
    if (!currency && isTyped(amount)) {
        return 'This gym has not set its currency, so an adjustment cannot say what money it is in.';
    }
    // Same as payRateBlocker: the currency was already a parameter here and
    // parseRate was doing its own arithmetic beside it.
    const r = parseRate(amount, currency);
    if (r.kind === 'bad')
        return r.reason;
    if (r.kind === 'clear')
        return 'Enter the amount, as a positive number. Repple applies the minus for a deduction or an advance.';
    if (r.cents === 0)
        return 'An adjustment of nothing changes nothing. Leave it off the run instead.';
    if (!note.trim()) {
        return 'Say what this is for. An adjustment with no reason on it is the line a coach queries and nobody can answer.';
    }
    return null;
}
/**
 * Every adjustment this gym has recorded, settled or not.
 *
 * Paged for the same reason `fetchClassPay` is, and with the same consequence
 * when it was not: /payroll reads both in one `allSettled` and either refusal
 * left a whole console unable to pay anybody. `applies_on` is a DATE, so a gym
 * that files a batch of bonuses on the first of the month has every one of them
 * tied on it — `id` is the primary key and gives `readAll` the total order it
 * requires.
 */
async function fetchAdjustments(sb, tenantId) {
    const rows = await (0, rowCap_1.readAll)((from, to) => sb
        .from('payroll_adjustments')
        .select('id, trainer_id, kind, amount_cents, currency, note, applies_on, settlement_id')
        .eq('tenant_id', tenantId)
        .order('applies_on', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to), 'the payroll adjustments');
    if (!rows.length)
        return [];
    const names = await namesFor(sb, rows.map((r) => r.trainer_id));
    return rows.map((r) => ({
        id: r.id,
        trainerId: r.trainer_id,
        trainerName: names.get(r.trainer_id) ?? null,
        kind: exports.ADJUSTMENT_KINDS.includes(r.kind) ? r.kind : 'bonus',
        amountCents: Number(r.amount_cents) || 0,
        currency: r.currency,
        note: r.note,
        appliesOn: r.applies_on,
        settlementId: r.settlement_id ?? null,
    }));
}
async function addAdjustment(sb, tenantId, a) {
    const r = await sb.from('payroll_adjustments').insert({
        tenant_id: tenantId,
        trainer_id: a.trainerId,
        kind: a.kind,
        // The sign comes from the kind. `Math.abs` first, so a caller that already
        // applied it cannot produce a positive deduction by applying it twice.
        amount_cents: Math.abs(a.amountCents) * adjustmentSign(a.kind),
        currency: a.currency,
        note: a.note.trim(),
        applies_on: a.appliesOn,
        created_by: a.createdBy,
    }, { count: 'exact' });
    if (r.error)
        throw r.error;
    // Counted, for the reason `addClassPay` gives. An adjustment that reports
    // itself recorded and is not there is a deduction that never comes off, or a
    // bonus a coach was told they had.
    (0, wroteRows_1.assertWrote)('That adjustment', r);
}
function adjustmentsTotal(rows) {
    const currency = (0, gymRecord_1.sharedCurrency)(rows);
    const currencies = [...new Set(rows.map((r) => (r.currency ?? '').trim().toUpperCase()).filter(Boolean))].sort();
    const sum = (only) => rows.filter((r) => only(r.kind)).reduce((a, r) => a + r.amountCents, 0);
    if (!rows.length || !currency) {
        return { cents: null, taxableCents: null, reimbursementCents: null, currency, currencies, count: rows.length };
    }
    return {
        cents: sum(() => true),
        taxableCents: sum((k) => k !== 'reimbursement'),
        reimbursementCents: sum((k) => k === 'reimbursement'),
        currency,
        currencies,
        count: rows.length,
    };
}
/**
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * /payroll built each run from `(classPay ?? []).filter((x) => x.settlementId
 * == null)` and the same line for adjustments. `fetchClassPay` is tenant-wide
 * with no date bound at all, and `applies_on` — captured on the adjustment form
 * precisely so somebody could say when a bonus applies — was never consulted.
 * So opening the July run paid for September's classes and September's bonuses,
 * and stamped every one of them with July's `period_from`.
 *
 * The coach is eventually paid the right total against the wrong month, which
 * is worse than being paid late: the cash-basis month on /accounting, the
 * coach's own earnings screen and any filing built from `period_from` all
 * disagree, and a bonus deliberately dated 1 September is filed as August's
 * cost.
 *
 * ── Why 'earlier' is paid and 'later' is not ──────────────────────────────
 *
 * They are not symmetrical. A line from a month already settled has no other
 * run coming for it — settlement is per line, and refusing it here would leave
 * it unpayable forever. A line dated in the FUTURE has its own run coming, by
 * construction, and putting it on this one is the defect.
 */
function runScopeOf(dated, period) {
    const d = (dated ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        return 'undated';
    if (d > period.toDate)
        return 'later';
    if (d < period.fromDate)
        return 'earlier';
    return 'on';
}
/** The lines a run for this period may pay: the period's own, plus anything
 *  still unsettled from before it. Never anything dated after it. */
function scopedToRun(rows, dateOf, period) {
    return rows.filter((r) => {
        const s = runScopeOf(dateOf(r), period);
        return s === 'on' || s === 'earlier';
    });
}
/**
 * The three parts of one coach's run, added up, or null where a part cannot be.
 *
 * `sessionCents` is nullable and the other two are not, and that asymmetry is
 * real: a session can be unpriced, and `payrollTotal` already refuses over one.
 * A class pay line and an adjustment both carry a snapshotted amount by
 * construction — they cannot exist unpriced — so a zero there is a genuine zero.
 *
 * The TOTAL is null whenever the session half is, because a run that pays for
 * classes and cannot price the sessions is not a smaller run, it is one nobody
 * should hand over.
 */
function runTotal(l) {
    if (l.sessionCents == null)
        return null;
    return l.sessionCents + l.classCents + l.adjustmentCents;
}
/**
 * Why a run cannot be settled, beyond what `settleBlocker` already says.
 *
 * One rule, and it is about currency: a coach whose class rate is in EUR and
 * whose gym pays in GBP has two amounts that cannot be added. Every other
 * refusal on a payroll run is about sessions and lives in
 * src/lib/gymSessions.ts.
 */
function runCurrencyBlocker(parts) {
    const seen = new Set(parts.filter((c) => !!c).map((c) => c.toUpperCase()));
    if (seen.size > 1) {
        return `This run mixes ${[...seen].sort().join(' and ')}. Adding them is not a total, and no rate here converts one into the other.`;
    }
    return null;
}
/* ── taking a run back ─────────────────────────────────────────────────────── */
/**
 * Undo a payroll run.
 *
 * Four writes, in this order, and the order is the whole safety argument:
 *
 *   1. unstamp the sessions
 *   2. unstamp the class pay lines
 *   3. unstamp the adjustments
 *   4. mark the settlement reversed
 *
 * If any of the first three fails, the settlement is still standing and the run
 * is still recorded as paid — wrong, visible, and repeatable by pressing the
 * button again. The other order would mark the run reversed while its sessions
 * were still stamped against it: they would be excluded from "Owed now"
 * forever, so a coach would silently never be paid for them, and the run that
 * was supposed to have paid them says it did not.
 *
 * The settlement row is never deleted. It is a statement somebody made that
 * money went out; deleting it leaves neither the statement nor the withdrawal.
 */
async function reverseSettlement(sb, settlementId, reason, by) {
    // What the run says it paid for, read BEFORE anything is written.
    //
    // `payroll_settlements.sessions_count` is NOT NULL and `recordSettlement`
    // writes it as `uniqueIds(run.sessionIds).length` — a count of rows, measured
    // against the stamp itself. It is therefore the exact number of session rows
    // that have to come loose here, and it is the only number available that does
    // not depend on which rows this account can see. See src/lib/unstampCheck.ts
    // for why counting the rows we could reach would only ever tell us about the
    // rows we could reach.
    const claim = await sb.from('payroll_settlements')
        .select('sessions_count')
        .eq('id', settlementId)
        .single();
    if (claim.error)
        throw claim.error;
    const claimed = claim.data?.sessions_count;
    if (typeof claimed !== 'number') {
        throw new Error('This run was not taken back. How many sessions it paid for could not be read, and '
            + 'unstamping without that number cannot be checked. Nothing has been changed.');
    }
    const s = await sb.from('sessions')
        .update({ settlement_id: null }, { count: 'exact' })
        .eq('settlement_id', settlementId);
    if (s.error)
        throw s.error;
    // The count was already being ASKED for on this write and then dropped. Every
    // policy on these tables is a `USING` clause and a `USING` clause filters, so
    // a session row this account cannot update is not refused — it is invisible,
    // and the update returns 204 with a null error having changed nothing.
    //
    // Thrown here, before the settlement is touched, so the state left behind is
    // the one this function's own ordering argument was written to preserve: the
    // run still stands, still reads as paid, nothing has been stranded, and
    // pressing the button again is safe.
    const shortfall = (0, unstampCheck_1.unstampBlocker)(claimed, s.count ?? null);
    if (shortfall)
        throw new Error(shortfall);
    const c = await sb.from('gym_class_pay')
        .update({ settlement_id: null }, { count: 'exact' })
        .eq('settlement_id', settlementId);
    if (c.error)
        throw c.error;
    const a = await sb.from('payroll_adjustments')
        .update({ settlement_id: null }, { count: 'exact' })
        .eq('settlement_id', settlementId);
    if (a.error)
        throw a.error;
    const r = await sb.from('payroll_settlements')
        .update({
        reversed_at: new Date().toISOString(),
        reversed_by: by,
        reverse_reason: reason.trim(),
    }, { count: 'exact' })
        .eq('id', settlementId)
        .is('reversed_at', null);
    if (r.error)
        throw r.error;
    // Counted, and this is the one that matters most. `settlements_owner` filters
    // rather than refuses, so an update matching nothing returns 204 with a null
    // error — and the screen would say the run was taken back while it still
    // stands, with its sessions now unstamped and payable a SECOND time.
    (0, wroteRows_1.assertWrote)('Reversing that settlement', r);
}
/** Why a reversal cannot be recorded, or null. */
function reversalReasonBlocker(reason) {
    if (!reason.trim()) {
        return 'Say why this run is being taken back. A settlement that was recorded and then withdrawn is two facts a coach is entitled to see, and the reason is the second one.';
    }
    return null;
}
/**
 * Stamp class lines and adjustments onto a settlement that has just been
 * recorded.
 *
 * Separate from `recordSettlement` in src/lib/gymSessions.ts rather than folded
 * into it, because that function is shared with the phone app and knows only
 * about sessions. Called immediately after it, with the id it returns.
 *
 * A PARTIAL stamp is reported rather than swallowed, exactly as
 * `recordSettlement` reports a partial session stamp: the unstamped remainder
 * is silently payable a second time, which is the expensive direction.
 *
 * ── Why the ids are chunked ────────────────────────────────────────────────
 *
 * Both `.in()` filters travel in the QUERY STRING of a PATCH, and both id
 * lists are unbounded. `scopedToRun` puts the period's own lines on the run
 * PLUS everything still unsettled from before it — which has no other run
 * coming — so the first payroll run at a gym that has been queuing classes on
 * the phone for a season carries that whole backlog on one coach's row. A uuid
 * costs about 39 bytes inside `in.("…","…")`, so a little over two hundred of
 * them is past the 8KB request line nginx and most CDNs allow, and the failure
 * is a 414 with no relation to the code that caused it.
 *
 * That 414 lands in the WORST place available. `recordSettlement` has already
 * written the settlement row and stamped the sessions by the time this is
 * called, so the run is recorded and paid; the class lines and adjustments are
 * not stamped, stay unsettled, and join the NEXT run. The gym pays for the
 * same classes twice, and the only sign is one error toast on the run that
 * looked like it worked.
 *
 * `ID_CHUNK` is the same 150 every `.in()` in this codebase uses. Chunked
 * updates are not one transaction, so the counts are summed across chunks and
 * compared against the whole list — a chunk that fails part way through is
 * reported as the partial stamp it is, with the same sentence, rather than as
 * a bare HTTP error.
 */
async function stampRunExtras(sb, settlementId, classPayIds, adjustmentIds) {
    await stampAll(sb, 'gym_class_pay', settlementId, classPayIds, 'class pay lines');
    await stampAll(sb, 'payroll_adjustments', settlementId, adjustmentIds, 'adjustments');
}
/**
 * One `.in()`-sized batch at a time, counted, and reported against the whole.
 *
 * The count is the point and not the chunking. `payroll_adjustments` and
 * `gym_class_pay` are both owner-scoped by RLS, which FILTERS rather than
 * refuses: an update that matches nothing comes back 204 with a null error and
 * no rows touched. Without `{ count: 'exact' }` this would report a stamp that
 * did not happen, and the lines it claims to have settled would be offered for
 * payment again next month.
 */
async function stampAll(sb, table, settlementId, ids, what) {
    // Deduplicated once, and the total is measured against THAT rather than
    // against the caller's array: an id listed twice is one row, and comparing a
    // count of rows against a count of mentions would report a perfectly
    // complete stamp as a partial one and send an owner chasing a double payment
    // that has not happened.
    const unique = (0, idLookup_1.uniqueIds)(ids);
    if (!unique.length)
        return;
    let stamped = 0;
    for (const chunk of (0, idLookup_1.chunkIds)(unique)) {
        const r = await sb.from(table)
            .update({ settlement_id: settlementId }, { count: 'exact' })
            .in('id', chunk);
        // Thrown with the running total attached rather than raw: a settlement that
        // is recorded and half-stamped is a different thing to tell somebody than
        // a request that was refused, and the half already stamped is not going to
        // be stamped again by a retry.
        if (r.error) {
            throw new Error(`The settlement was recorded, but stamping the ${what} against it failed after ${stamped} of ${unique.length}: ${r.error.message ?? 'the write was refused'}. The rest are still shown as unpaid and could be settled twice.`);
        }
        stamped += r.count ?? 0;
    }
    if (stamped !== unique.length) {
        throw new Error(`The settlement was recorded, but only ${stamped} of ${unique.length} ${what} were stamped against it. The rest are still shown as unpaid and could be settled twice.`);
    }
}
function numOrNull(v) {
    return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}
/**
 * When each of these classes was taught, as a bare calendar date AT THE GYM.
 *
 * `gym_classes.starts_at` is a timestamp and this returns the DAY of it,
 * because a payroll period is a run of calendar days and comparing a timestamp
 * against `period.toDate` is how a class on the last evening of the month falls
 * into the next one.
 *
 * ── Whose day ─────────────────────────────────────────────────────────────
 *
 * `zone` is `tenants.timezone`, and when it is set and this runtime can resolve
 * it, `gymDay` decides — one implementation, in src/lib/gymZone.ts, for the
 * reason that file gives: two implementations of a calendar rule is how a
 * Sunday's takings end up in two places.
 *
 * This was `isoDate(new Date(t))` with a comment above the import claiming the
 * gym's timezone. `isoDate` reads the LOCAL getters, so the day was the day
 * where the READER was. A class at 01:00 on 1 September at a Dubai gym came
 * back as 31 August on a laptop in London and joined August's run; the same row
 * read at the gym's own front desk did not. At UTC+14 it goes the other way and
 * costs more: a class at 18:00Z on the last day of the period reads as the 1st
 * of the next one, `runScopeOf` calls that 'later', and the line drops off the
 * run altogether — a coach not paid, on nobody's screen, because the console
 * was open in the wrong country.
 *
 * A gym that has not set a zone falls back to the reader's day AND THE CALLER
 * IS TOLD, through `ClassPayLine.taughtOnBasis`. That is the shape
 * `gymTodayWindow` settled on and it is not a default timezone: refusing to
 * date the lines would leave every one of them 'undated', and `scopedToRun`
 * drops an undated line, so a blank settings field would stop paying anybody.
 *
 * A class this cannot read comes back absent, which the caller renders as an
 * unknown date rather than as a class taught at the epoch.
 *
 * CHUNKED, because the read above it now pages. A bare `.in()` was safe only
 * while `fetchClassPay` refused past a thousand rows — a thousand rows carry at
 * most a thousand distinct class ids, so the lookup could not truncate and the
 * refusal was holding it up. With `readAll` above, ten thousand pay lines carry
 * far more ids than one `in.()` may either fit in a request line or be answered
 * with, and both failures are silent. See src/lib/idLookup.ts.
 */
async function classDatesFor(sb, ids, zone) {
    const out = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        // no-error-ok: an unreadable class date leaves the line undated, which the
        // payroll run reports rather than silently scoping the line in or out
        const { data } = await sb.from('gym_classes').select('id, starts_at').in('id', chunk).limit((0, rowCap_1.capLimit)());
        for (const c of (data ?? [])) {
            const t = Date.parse(String(c?.starts_at ?? ''));
            if (!Number.isFinite(t))
                continue;
            // The gym's day when the gym has said what its day is; otherwise the
            // reader's, which `taughtOnBasis` discloses. Never the UTC slice.
            out.set(c.id, (0, gymZone_1.gymDay)(t, zone) ?? (0, format_1.isoDate)(new Date(t)));
        }
    }
    return out;
}
/** Chunked for the same reason `classDatesFor` is: both lookups sit behind
 *  reads that page, so the id list is no longer bounded by a row cap. */
async function namesFor(sb, ids) {
    const out = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        // no-error-ok: an unreadable name renders as a dash; the amount it labels is still real
        const { data } = await sb.from('profiles').select('id, full_name').in('id', chunk).limit((0, rowCap_1.capLimit)());
        for (const p of (data ?? [])) {
            const n = (p.full_name || '').trim();
            if (n)
                out.set(p.id, n);
        }
    }
    return out;
}
