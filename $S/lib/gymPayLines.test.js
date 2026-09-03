"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The rate read and the two line writes that decide what a coach is paid.
// Compile with tsc, run with node.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// `fetchTrainerPay`, `addClassPay` and `addAdjustment` had no test anywhere in
// the repo. Between them they are the read that prices every payroll run and
// the two writes that put money onto one, and a mutation pass over the suites
// that DO cover src/lib/gymPay.ts found nothing failing when any of the three
// was broken. gymPay.test.ts asserts the pure rules — the three-layer rate, the
// blockers, the sums — and gymPayReads.test.ts asserts the paging of the two
// list reads. Neither of them ever calls these.
//
// So the assertions here are about what reaches the DATABASE and what comes
// back off it, and each one below was written by breaking the line it covers
// and checking this file went red.
//
// ── The two that pay the wrong amount ──────────────────────────────────────
//
// Two of them are worth naming, because they do not look like much in the
// diff:
//
//   · `fetchTrainerPay` sanitises `class_pay_kind` to null unless it is one of
//     the two the product knows. Let a third value through and
//     `classPayBlocker` stops refusing (it only checks for 'per_attendee') and
//     `classPayAmount` multiplies (it only special-cases 'per_class') — so a
//     flat 30.00 for teaching a class becomes 30.00 A HEAD. The assertion
//     below is on that consequence and not on the null.
//
//   · `addClassPay` writes NULL attendees for a per-class line whatever the
//     caller passed, because `gym_class_pay_attendees_shape` in
//     supabase/parts/183 is `(pay_kind = 'per_attendee') = (attendees is not
//     null)`. Pass the register through on a flat-rate line and the insert is
//     a 23514: the class goes onto no payroll line at all and the coach is not
//     paid for teaching it.
//
// The database is a fake, for the same reason gymPayReads.test.ts uses one:
// what is under test is the query and the payload, and a fake is the only way
// to assert the exact filters, the exact columns and the exact row that was
// sent.
const gymPay_1 = require("./gymPay");
const rowCap_1 = require("./rowCap");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
function fakeSb(answer) {
    const asked = [];
    const from = (table) => {
        const q = { table, select: null, eqs: [], limit: null, insert: null, counted: false };
        asked.push(q);
        const chain = {
            select: (cols) => { q.select = cols; return chain; },
            eq: (col, v) => { q.eqs.push([col, v]); return chain; },
            limit: (n) => { q.limit = n; return chain; },
            insert: (row, o) => {
                q.insert = row;
                q.counted = o?.count === 'exact';
                return chain;
            },
            then: (res) => {
                const a = answer(q);
                return res({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null });
            },
        };
        return chain;
    };
    return { sb: { from }, asked };
}
/** A `gym_trainer_pay` row as PostgREST hands it over. */
const payRow = (o = {}) => ({
    trainer_id: 't1', session_rate_cents: 4500, class_pay_kind: 'per_class',
    class_rate_cents: 3000, currency: 'GBP', updated_at: '2026-08-01T09:00:00Z', ...o,
});
/** Read one set of rate rows back through `fetchTrainerPay`. */
async function readPay(rows, tenantId = 'gym-1') {
    const { sb, asked } = fakeSb(() => ({ data: rows, error: null }));
    const index = await (0, gymPay_1.fetchTrainerPay)(sb, tenantId);
    return { index, asked };
}
/** What one call to `addClassPay` sent. */
async function sentClassPay(line, count = 1) {
    const { sb, asked } = fakeSb(() => ({ error: null, count }));
    await (0, gymPay_1.addClassPay)(sb, 'gym-1', line);
    return asked[0];
}
/** What one call to `addAdjustment` sent. */
async function sentAdjustment(a, count = 1) {
    const { sb, asked } = fakeSb(() => ({ error: null, count }));
    await (0, gymPay_1.addAdjustment)(sb, 'gym-1', a);
    return asked[0];
}
const threw = async (run) => {
    try {
        await run();
        return null;
    }
    catch (e) {
        return e;
    }
};
async function main() {
    /* ── fetchTrainerPay: the query ──────────────────────────────────────────── */
    {
        const { asked } = await readPay([payRow()], 'gym-1');
        eq(asked.length, 1, 'one read, not one per coach');
        eq(asked[0].table, 'gym_trainer_pay', 'what the GYM pays, never trainers.session_fee — that column is the coach’s own price list for their own clients');
        const tenant = asked[0].eqs.filter(([c]) => c === 'tenant_id');
        eq(tenant.length, 1, 'the read is scoped to one tenant');
        eq(tenant[0][1], 'gym-1', 'and to the tenant asked for — without this filter one gym prices its payroll off another gym’s rates');
        // One PAST the cap, which is what makes a full page and a truncated one
        // distinguishable at all. Derived from ROW_CAP rather than written as a
        // literal, so raising the cap does not silently un-cap this read.
        eq(asked[0].limit, rowCap_1.ROW_CAP + 1, 'capped one past the row cap, so a truncated read can be told from a complete one');
        for (const col of ['trainer_id', 'session_rate_cents', 'class_pay_kind', 'class_rate_cents', 'currency']) {
            ok((asked[0].select ?? '').includes(col), `the read asks for ${col} — a column not selected reads as null, which here means a coach silently back on the standard fee`);
        }
    }
    /* ── fetchTrainerPay: a truncated read is refused, not shortened ─────────── */
    {
        const rows = Array.from({ length: rowCap_1.ROW_CAP + 1 }, (_, i) => payRow({ trainer_id: `t${i}` }));
        const { sb } = fakeSb(() => ({ data: rows, error: null }));
        const e = await threw(() => (0, gymPay_1.fetchTrainerPay)(sb, 'gym-1'));
        ok(e != null, 'a read that came back at its limit REFUSES — a truncated one drops the coaches whose rows fell off the end back onto the gym’s standard fee, which for a senior coach is a smaller payslip that looks exactly like a correct one');
        const whole = Array.from({ length: rowCap_1.ROW_CAP }, (_, i) => payRow({ trainer_id: `t${i}` }));
        const { index } = await readPay(whole);
        eq(index.size, rowCap_1.ROW_CAP, 'and a set that merely ends AT the cap is a whole set');
    }
    /* ── fetchTrainerPay: a refused read is not an empty one ─────────────────── */
    {
        const { sb } = fakeSb(() => ({ data: null, error: { message: 'permission denied', code: '42501' } }));
        const e = await threw(() => (0, gymPay_1.fetchTrainerPay)(sb, 'gym-1'));
        ok(e != null, 'an error throws rather than returning an empty index — an empty index prices every coach at the gym’s standing fee and nothing on screen says the rates were never read');
    }
    /* ── fetchTrainerPay: what the row means ─────────────────────────────────── */
    {
        const { index } = await readPay([
            payRow({ trainer_id: 't1', session_rate_cents: 4500 }),
            payRow({ trainer_id: 't2', session_rate_cents: 0, class_pay_kind: null, class_rate_cents: null, currency: null }),
            payRow({ trainer_id: 't3', session_rate_cents: null, class_pay_kind: 'per_attendee', class_rate_cents: 800, currency: ' gbp ' }),
            payRow({ trainer_id: 't4', currency: '', updated_at: null }),
        ]);
        eq(index.size, 4, 'one entry per coach');
        eq(index.get('t1')?.sessionRateCents, 4500, 'the rate this gym pays this coach');
        eq(index.get('t1')?.trainerId, 't1', 'keyed by the coach the row is about');
        // The distinction the whole file turns on. `rateForSession` falls a null
        // through to the gym fee and stops at a zero, so reading one as the other
        // either pays a volunteer the standing fee or pays a coach nothing.
        eq(index.get('t2')?.sessionRateCents, 0, 'a rate of ZERO survives the read as zero — it is a claim the gym made, not an absent rate');
        eq(index.get('t3')?.sessionRateCents, null, 'and an absent rate stays null, which falls back to the gym’s fee rather than paying nothing');
        eq(index.get('t3')?.classPayKind, 'per_attendee', 'the counting method comes back as stored');
        eq(index.get('t3')?.classRateCents, 800, 'and the class rate with it');
        eq(index.get('t3')?.currency, 'GBP', 'the currency is normalised to the ISO code, spacing and case and all');
        eq(index.get('t2')?.currency, null, 'a row with no currency states none');
        eq(index.get('t4')?.currency, null, 'and neither does one holding an empty string — an empty currency is not a currency');
        eq(index.get('t4')?.updatedAt, null, 'an unstamped row reports no date rather than one');
        eq(index.get('t1')?.updatedAt, '2026-08-01T09:00:00Z', 'and a stamped one reports its own');
    }
    /* ── fetchTrainerPay: a class_pay_kind nobody knows pays 30 times over ───── */
    {
        // Not a hypothetical shape. `class_pay_kind` is a text column with a CHECK,
        // and a value that arrives from a future migration, a restored dump or a
        // hand-edited row is text this code has to decide about. The two functions
        // downstream decide differently: `classPayBlocker` only tests for
        // 'per_attendee' and `classPayAmount` only special-cases 'per_class', so an
        // unknown third value is refused by neither and multiplied by the second.
        const { index } = await readPay([
            payRow({ trainer_id: 't1', class_pay_kind: 'per_head', class_rate_cents: 3000 }),
        ]);
        const pay = index.get('t1');
        eq(pay.classPayKind, null, 'a counting method this product does not know is not a counting method');
        ok((0, gymPay_1.classPayBlocker)(pay, 30, false) != null, 'so the class is REFUSED with "this gym has not said what it pays this coach to teach" rather than costed against a rule nobody wrote');
        // What it would have cost. Written out so the assertion above is about
        // money rather than about a null: 3000 flat becomes 3000 a head across a
        // class of thirty.
        eq((0, gymPay_1.classPayAmount)('per_head', 3000, 30), 90000, 'because anything that is not per_class is multiplied — 30.00 for the class would have been 900.00 for teaching it');
    }
    /* ── addClassPay: the row that reaches the table ─────────────────────────── */
    {
        const q = await sentClassPay({
            classId: 'k1', trainerId: 't1', payKind: 'per_attendee',
            rateCents: 800, attendees: 12, amountCents: 9600,
            currency: 'GBP', createdBy: 'u1',
        });
        eq(q.table, 'gym_class_pay', 'the line goes on the class pay table');
        eq(q.insert?.tenant_id, 'gym-1', 'stamped with the gym that is paying');
        eq(q.insert?.class_id, 'k1', 'and the class it pays for');
        eq(q.insert?.trainer_id, 't1', 'and the coach who taught it');
        eq(q.insert?.pay_kind, 'per_attendee', 'the counting method is snapshotted');
        eq(q.insert?.rate_cents, 800, 'the rate as it stood is snapshotted');
        eq(q.insert?.attendees, 12, 'the headcount the amount was worked out from is snapshotted');
        eq(q.insert?.amount_cents, 9600, 'and the amount itself');
        eq(q.insert?.currency, 'GBP', 'in the currency the caller named — nothing here has a default currency to fall back on');
        eq(q.insert?.created_by, 'u1', 'and whoever put it there');
    }
    /* ── addClassPay: the amount is taken, never recomputed ──────────────────── */
    {
        // 800 × 12 is 9600 and this line says 7000, which is what happens when the
        // rate has changed since the class was costed or the register was corrected
        // afterwards. Recomputing here would rewrite a figure somebody may already
        // have been paid, which is the whole reason every column on this row is a
        // snapshot.
        const q = await sentClassPay({
            classId: 'k1', trainerId: 't1', payKind: 'per_attendee',
            rateCents: 800, attendees: 12, amountCents: 7000,
            currency: 'GBP', createdBy: null,
        });
        eq(q.insert?.amount_cents, 7000, 'the amount handed in is the amount written down, even when the rate and the headcount would multiply to another one');
    }
    /* ── addClassPay: attendees on a flat-rate line ──────────────────────────── */
    {
        // `gym_class_pay_attendees_shape`: (pay_kind = 'per_attendee') = (attendees
        // is not null). A per-class line carrying a headcount is a 23514, and a
        // 23514 here means the class is on no payroll line at all.
        const q = await sentClassPay({
            classId: 'k1', trainerId: 't1', payKind: 'per_class',
            rateCents: 3000, attendees: 12, amountCents: 3000,
            currency: 'GBP', createdBy: null,
        });
        eq(q.insert?.attendees, null, 'a flat-rate line carries NO headcount even when the caller offers one — the register did not enter into the amount, and the constraint refuses the row outright, so the coach is paid nothing for a class everybody thinks was queued');
        eq(q.insert?.pay_kind, 'per_class', 'and the kind is still the kind that was taught');
        // The other half of the same constraint, and the reason this is not simply
        // "drop the headcount": an empty class is a real answer and pays zero.
        const zero = await sentClassPay({
            classId: 'k2', trainerId: 't1', payKind: 'per_attendee',
            rateCents: 800, attendees: 0, amountCents: 0,
            currency: 'GBP', createdBy: null,
        });
        eq(zero.insert?.attendees, 0, 'a per-attendee line for a class nobody came to records nought, not nothing — nought is a register that was taken');
    }
    /* ── addClassPay: counted, and refused ───────────────────────────────────── */
    {
        const q = await sentClassPay({
            classId: 'k1', trainerId: 't1', payKind: 'per_class',
            rateCents: 3000, attendees: null, amountCents: 3000, currency: 'GBP', createdBy: null,
        });
        ok(q.counted, 'the insert asks the server how many rows it wrote');
        const { sb: refused } = fakeSb(() => ({ error: { message: 'new row violates row-level security policy' } }));
        const e1 = await threw(() => (0, gymPay_1.addClassPay)(refused, 'gym-1', {
            classId: 'k1', trainerId: 't1', payKind: 'per_class',
            rateCents: 3000, attendees: null, amountCents: 3000, currency: 'GBP', createdBy: null,
        }));
        ok(e1 != null, 'a refused insert throws');
        // The server's OWN words, not a sentence written here. class-analytics.tsx
        // renders `e.message` into "That class was NOT put on payroll: …", and an
        // owner who is told only that it could not be saved has nothing to take to
        // anybody. Replacing the error with a generic one is the mutation this
        // catches.
        ok(/row-level security/.test(e1?.message ?? ''), 'and throws what the server said, which is the half of the sentence the owner can act on');
        const { sb: silent } = fakeSb(() => ({ error: null, count: 0 }));
        const e2 = await threw(() => (0, gymPay_1.addClassPay)(silent, 'gym-1', {
            classId: 'k1', trainerId: 't1', payKind: 'per_class',
            rateCents: 3000, attendees: null, amountCents: 3000, currency: 'GBP', createdBy: null,
        }));
        ok(e2 != null, 'and so does an insert the server accepted while writing nothing — the owner sees the class move to "on payroll", the run finds no line, and the coach is not paid');
    }
    /* ── addAdjustment: the sign comes from the kind, never from the typing ──── */
    {
        // Written out here rather than read from `adjustmentSign`, because a test
        // that asks the code what it thinks the sign is agrees with any answer.
        // These are the four meanings: two hand money over and two take it back.
        const takesAway = {
            bonus: false, // extra pay
            reimbursement: false, // money the coach spent, handed back
            deduction: true, // taken off pay
            advance: true, // pay already handed over, so not owed again
        };
        for (const kind of gymPay_1.ADJUSTMENT_KINDS) {
            const q = await sentAdjustment({
                trainerId: 't1', kind, amountCents: 5000, currency: 'GBP',
                note: 'covered Saturday', appliesOn: '2026-08-31', createdBy: null,
            });
            eq(q.insert?.amount_cents, takesAway[kind] ? -5000 : 5000, `a ${kind} of 50.00 is stored ${takesAway[kind] ? 'negative' : 'positive'} — the sign is the meaning of the kind, and a screen that asked somebody to type the minus will one day be handed a plus`);
            eq(q.insert?.kind, kind, `and the kind is recorded as ${kind} — a bonus and a reimbursement are both additions and only one of them is taxable`);
        }
        // A caller that has already applied the sign must not apply it twice.
        const twice = await sentAdjustment({
            trainerId: 't1', kind: 'deduction', amountCents: -5000, currency: 'GBP',
            note: 'kit', appliesOn: '2026-08-31', createdBy: null,
        });
        eq(twice.insert?.amount_cents, -5000, 'a deduction handed in already negative stays a deduction — applying the sign twice would pay the coach an extra 100.00');
        const wrongWay = await sentAdjustment({
            trainerId: 't1', kind: 'bonus', amountCents: -5000, currency: 'GBP',
            note: 'cover', appliesOn: '2026-08-31', createdBy: null,
        });
        eq(wrongWay.insert?.amount_cents, 5000, 'and a bonus typed with a minus in front of it is still a bonus');
    }
    /* ── addAdjustment: the rest of the row ──────────────────────────────────── */
    {
        const q = await sentAdjustment({
            trainerId: 't7', kind: 'reimbursement', amountCents: 1250, currency: 'KWD',
            note: '  parking at the away class  ', appliesOn: '2026-09-01', createdBy: 'u2',
        });
        eq(q.table, 'payroll_adjustments', 'the line goes on the adjustments table');
        eq(q.insert?.tenant_id, 'gym-1', 'stamped with the gym');
        eq(q.insert?.trainer_id, 't7', 'and the coach');
        eq(q.insert?.currency, 'KWD', 'in the currency it was recorded in — a three-place currency reaches the column exactly as it was passed, with nothing converted and nothing assumed');
        eq(q.insert?.note, 'parking at the away class', 'the reason is trimmed, because a note of spaces is a line a coach queries and nobody can answer');
        // A bare date, passed through. `applies_on` is a DATE column and it is what
        // `runScopeOf` puts the line on a run by; stamping "now" here would file a
        // bonus deliberately dated the 1st against the month it was typed in.
        eq(q.insert?.applies_on, '2026-09-01', 'the date the adjustment applies ON is the date that was chosen, not the date it was typed');
        eq(q.insert?.created_by, 'u2', 'and whoever recorded it');
        ok(q.counted, 'the insert asks the server how many rows it wrote');
        const { sb: silent } = fakeSb(() => ({ error: null, count: 0 }));
        const e = await threw(() => (0, gymPay_1.addAdjustment)(silent, 'gym-1', {
            trainerId: 't7', kind: 'deduction', amountCents: 1250, currency: 'GBP',
            note: 'kit', appliesOn: '2026-09-01', createdBy: null,
        }));
        ok(e != null, 'an insert the server accepted while writing nothing throws — a deduction that reports itself recorded and is not there never comes off the run');
        const { sb: refused } = fakeSb(() => ({ error: { message: 'new row violates row-level security policy' } }));
        const e2 = await threw(() => (0, gymPay_1.addAdjustment)(refused, 'gym-1', {
            trainerId: 't7', kind: 'deduction', amountCents: 1250, currency: 'GBP',
            note: 'kit', appliesOn: '2026-09-01', createdBy: null,
        }));
        ok(/row-level security/.test(e2?.message ?? ''), 'and a refusal reaches the owner in the server’s own words rather than as a sentence written here');
    }
    /* ── the sentence about the gym’s currency, which nobody could reach ─────── */
    {
        // It was `if ((s.kind === 'rate' || c.kind === 'rate') && !currency)` at the
        // bottom of `payRateBlocker`, and `parseRate` refuses any non-empty rate
        // when there is no currency — so neither side could be 'rate' there and the
        // branch was dead. What the owner actually read was the parser's generic
        // complaint with a field name in front of it.
        const s = (0, gymPay_1.payRateBlocker)('45', '', '', null);
        ok(s != null, 'a rate with no currency behind it is still refused');
        ok(!/^Session rate:/.test(s ?? ''), 'and not as a field the parser could not read — the missing thing is the GYM’S currency, not the typing');
        ok(/currency/i.test(s ?? ''), 'the sentence names what is missing');
        ok(/actually paid/.test(s ?? ''), 'and says why it cannot be skipped: a rate is what somebody is actually paid');
        const c = (0, gymPay_1.payRateBlocker)('', '8', 'per_attendee', null);
        ok(c != null && !/^Class rate:/.test(c) && /actually paid/.test(c), 'the class rate reaches the same sentence — either box is a rate');
        eq((0, gymPay_1.payRateBlocker)('0', '', '', null), s, 'a rate of zero is a rate, and gets the same answer — it is the currency that is missing, not the amount');
        eq((0, gymPay_1.payRateBlocker)('', '', '', null), null, 'clearing both rates needs no currency, because nothing is left denominated — a gym without a currency must still be able to reach that state');
        eq((0, gymPay_1.payRateBlocker)('  ', ' ', '', null), null, 'and a box left with a stray space in it is still a cleared box — the same emptiness parseRate reads as "clear", so the two cannot disagree about whether a currency is needed');
        ok(/counted|pays nothing/.test((0, gymPay_1.payRateBlocker)('', '', 'per_class', null) ?? ''), 'and a counting method with no rate beside it is still answered on its own terms, not with the currency sentence');
        // With a currency the ordinary refusals are unchanged, which is the half a
        // reordering could quietly break.
        eq((0, gymPay_1.payRateBlocker)('45', '', '', 'GBP'), null, 'a session rate in a stated currency saves');
        eq((0, gymPay_1.payRateBlocker)('', '8', 'per_attendee', 'GBP'), null, 'and so does a class rate with its counting method');
        ok(/^Session rate:/.test((0, gymPay_1.payRateBlocker)('forty five', '', '', 'GBP') ?? ''), 'a rate that cannot be read is still reported as the rate that cannot be read, box and all');
        ok((0, gymPay_1.payRateBlocker)('', '8', '', 'GBP') != null, 'and a class rate with no counting method is still refused — "80" and "8 a head" are the same digits and different money');
    }
    {
        const a = (0, gymPay_1.adjustmentBlocker)('50', 'covered Saturday', null);
        ok(a != null, 'an adjustment with no currency behind it is refused');
        ok(/currency/i.test(a ?? '') && !/Nothing can be worked out from it/.test(a ?? ''), 'and told that the gym has not set its currency, rather than that the amount could not be read');
        ok(/Enter the amount/.test((0, gymPay_1.adjustmentBlocker)('', 'covered Saturday', null) ?? ''), 'an empty box with no currency is still answered about the box — that is the one the owner can fix from where they are standing');
        ok(/Enter the amount/.test((0, gymPay_1.adjustmentBlocker)('   ', 'covered Saturday', null) ?? ''), 'and so is a box holding only spaces');
        eq((0, gymPay_1.adjustmentBlocker)('50', 'covered Saturday', 'GBP'), null, 'an amount and a reason in a stated currency records');
        ok((0, gymPay_1.adjustmentBlocker)('50', '   ', 'GBP') != null, 'and a reason of spaces is no reason');
        ok((0, gymPay_1.adjustmentBlocker)('0', 'covered Saturday', 'GBP') != null, 'an adjustment of nothing changes nothing');
    }
    if (errors.length) {
        console.error(`gymPayLines.test.ts — ${errors.length} failed:`);
        for (const e of errors)
            console.error(`  · ${e}`);
        process.exit(1);
    }
    console.log('gymPayLines.test.ts — all assertions passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
