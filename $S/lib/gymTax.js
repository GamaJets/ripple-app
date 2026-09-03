"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAX_FACTS_ARE_STATED_NOT_CHECKED = exports.TAX_UNKNOWNS = exports.TAX_NO_RETURN_FIGURE = exports.NO_TAX_PROFILE = void 0;
exports.taxProfileLine = taxProfileLine;
exports.taxProfileBlockers = taxProfileBlockers;
exports.taxPeriod = taxPeriod;
exports.taxPeriodAt = taxPeriodAt;
exports.quarterKeyOf = quarterKeyOf;
exports.recentTaxPeriods = recentTaxPeriods;
exports.openMonthsIn = openMonthsIn;
exports.periodMovingNote = periodMovingNote;
exports.readGymTaxProfile = readGymTaxProfile;
exports.saveGymTaxProfile = saveGymTaxProfile;
exports.fetchClosedMonths = fetchClosedMonths;
const monthEnd_1 = require("./monthEnd");
const format_1 = require("./format");
const wroteRows_1 = require("./wroteRows");
// The gym's own clock. `cutAtGym` turns a window's calendar days into the
// instants they actually span at the gym, clock changes included, and hands
// back the caption that says whose clock it used.
const gymWindow_1 = require("./gymWindow");
exports.NO_TAX_PROFILE = { registered: null, registration: null };
/**
 * The sentence describing what Repple holds, which depends on the read before
 * it depends on the answer.
 *
 * A failed read must never render as "this gym is not registered". That is a
 * statement about a business's legal standing, made out of a query that
 * errored, on the screen its accountant is being pointed at.
 */
function taxProfileLine(p, status) {
    if (status === 'loading')
        return 'Still reading what this gym has said about tax.';
    if (status === 'error') {
        return 'What this gym has said about tax could not be read. That is not a statement that it has said nothing, and anything already recorded still stands.';
    }
    if (p.registered === true) {
        return p.registration
            ? 'This gym says it is registered, under the number below. Repple holds that number as typed and has never checked it against any register.'
            : 'This gym says it is registered but has not stated a number. The number is the one tax fact a business has to print on its own invoices, so it is worth adding.';
    }
    if (p.registered === false) {
        return 'This gym says it is not registered for a tax on its sales. Nothing on this page is a tax figure either way.';
    }
    return 'Nobody has said whether this gym is registered for a tax on its sales. That is not the same as saying it is not — until somebody answers, Repple holds no tax fact about this business at all.';
}
/** Why this profile cannot be saved, or an empty list when it can. A list
 *  rather than the first failure, like every other blocker in this codebase. */
function taxProfileBlockers(p) {
    const out = [];
    const reg = String(p.registration ?? '').trim();
    if (reg.length > 60) {
        out.push('That registration number is longer than any this can hold. Check it, or leave the box empty and none is recorded.');
    }
    // Part 701 has the same CHECK. A record that says both "not registered" and
    // "registered as GB123456789" is one nobody can act on, and it is the state a
    // half-finished edit produces.
    if (p.registered === false && reg) {
        out.push('This says the gym is not registered and still carries a registration number. Clear the number, or say it is registered.');
    }
    return out;
}
const QUARTER_MONTHS = {
    Q1: [1, 2, 3], Q2: [4, 5, 6], Q3: [7, 8, 9], Q4: [10, 11, 12],
};
/**
 * The twelve months, written out, in the language of whoever is filing.
 *
 * Read per call rather than held in a module constant: `monthNames()` asks
 * `appLocale()`, which is latched lazily, and a constant evaluated at import
 * would freeze the console's months to whatever the locale was before the app
 * had resolved one. Twelve strings per period label is not a cost worth a
 * stale language.
 */
const monthWords = () => (0, format_1.monthNames)();
/**
 * The window for a period key, or null when the key is not one.
 *
 * Assembled out of `monthWindow` in every case, including the single-month
 * case, so a period boundary and a close boundary cannot disagree. A quarter
 * whose middle month somehow failed to parse returns null rather than a
 * two-month quarter — a period that is quietly short is a return that is
 * quietly short.
 */
function taxPeriod(key) {
    const q = /^(\d{4})-(Q[1-4])$/.exec(String(key ?? ''));
    if (q) {
        const year = Number(q[1]);
        const months = QUARTER_MONTHS[q[2]].map((m) => `${year}-${String(m).padStart(2, '0')}`);
        const windows = [];
        for (const m of months) {
            const w = (0, monthEnd_1.monthWindow)(m);
            if (!w)
                return null;
            windows.push(w);
        }
        const first = windows[0];
        const last = windows[windows.length - 1];
        const names = monthWords();
        return {
            key,
            label: `${q[2]} ${year} · ${names[QUARTER_MONTHS[q[2]][0] - 1]} to ${names[QUARTER_MONTHS[q[2]][2] - 1]}`,
            months,
            firstDay: first.firstDay,
            lastDay: last.lastDay,
            fromIso: first.fromIso,
            toIso: last.toIso,
        };
    }
    const w = (0, monthEnd_1.monthWindow)(String(key ?? ''));
    if (!w)
        return null;
    return {
        key: w.key,
        label: w.label,
        months: [w.key],
        firstDay: w.firstDay,
        lastDay: w.lastDay,
        fromIso: w.fromIso,
        toIso: w.toIso,
    };
}
/**
 * A period cut on the GYM'S clock, or the same period cut on the reader's with
 * a caption that says so.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 *
 * /tax printed "{firstDay} to {lastDay}, in the gym’s own timezone." and got
 * its bounds from `taxPeriod`, which is `monthWindow`, which is
 * `new Date(y, mo - 1, 1)` — the reader's device. Those instants are then the
 * filter on the takings: `fetchPayments(sb, tenantId, period.fromIso,
 * period.toIso)`.
 *
 * So the payments taken in the first hours of 1 October at a Gulf gym fall into
 * Q3 read from London and into Q4 read at the desk. Two people export two
 * different quarters out of one database, on the screen whose entire purpose is
 * a filing deadline, under a caption asserting the opposite. /accounting
 * carries the identical sentence over the identical helper.
 *
 * ── Why this returns a note rather than null ───────────────────────────────
 *
 * A gym that has not set a timezone still has to be able to look at its own
 * quarter, and refusing the whole screen over an unset setting would be a worse
 * answer than the one it replaces. What must not survive is the CAPTION: the
 * device's bounds are fine as long as nothing tells an accountant they are the
 * gym's. So the basis and the sentence travel together, out of one function, and
 * a caller cannot render the confident wording over the fallback without going
 * out of its way.
 *
 * `zone` null covers both an unset timezone and one this runtime cannot
 * resolve. It does NOT cover a failed tenant read — that is a third thing, the
 * caller holds the error, and `fetchGymZone` exists to keep the two apart.
 */
function taxPeriodAt(key, zone) {
    const base = taxPeriod(key);
    if (!base)
        return null;
    // One implementation, shared with /accounting's month. Two screens wording
    // the same caption two ways is how they came to disagree about what it meant
    // in the first place.
    const at = (0, gymWindow_1.cutAtGym)(base, zone);
    return { period: at.window, basis: at.basis, note: at.note };
}
/** The quarter a month falls in. */
function quarterKeyOf(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
    if (!m)
        return null;
    const n = Number(m[2]);
    if (n < 1 || n > 12)
        return null;
    return `${m[1]}-Q${Math.floor((n - 1) / 3) + 1}`;
}
/**
 * The periods the picker offers, newest first: `quarters` quarters, then
 * `months` months.
 *
 * Both, rather than one or the other, because the two questions are different.
 * A return is filed for a quarter in most regimes that have one; a gym filing
 * monthly, or an owner checking one month against the bank, needs a month. The
 * quarter currently running is offered and is not hidden — a period that has
 * not finished is a real thing to look at and the screen says it has not
 * finished, which is the honest version of refusing to show it.
 */
function recentTaxPeriods(quarters, months, now = Date.now()) {
    const d = new Date(now);
    const out = [];
    const thisQuarter = quarterKeyOf((0, monthEnd_1.monthKeyOf)(d));
    if (thisQuarter) {
        const [y, q] = [Number(thisQuarter.slice(0, 4)), Number(thisQuarter.slice(6))];
        for (let i = 0; i < Math.max(0, quarters); i++) {
            const back = q - 1 - i;
            const year = y + Math.floor(back / 4);
            const idx = ((back % 4) + 4) % 4;
            out.push(`${year}-Q${idx + 1}`);
        }
    }
    for (let i = 0; i < Math.max(0, months); i++) {
        out.push((0, monthEnd_1.monthKeyOf)(new Date(d.getFullYear(), d.getMonth() - i, 1)));
    }
    return out;
}
/**
 * The months of this period that this gym has NOT closed, oldest first.
 *
 * `closed` is the set of month keys with a live close on them — the reader
 * passes what it read, and a read that failed passes nothing, which reports
 * every month as open. That direction is deliberate: telling somebody a period
 * is settled when the close read failed is the expensive mistake, and telling
 * them it is still moving when it is not costs them one look at /close.
 */
function openMonthsIn(p, closed) {
    const shut = new Set(closed);
    return p.months.filter((m) => !shut.has(m));
}
/**
 * What to say about a period whose months are not all closed, or null when
 * every one of them is.
 *
 * Named months rather than a count. "One month is open" sends somebody to look
 * at three; "September is open" sends them to one.
 */
function periodMovingNote(p, closed) {
    const open = openMonthsIn(p, closed);
    if (!open.length)
        return null;
    const names = open.map((m) => (0, monthEnd_1.monthWindow)(m)?.label ?? m);
    const list = names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${list} ${open.length === 1 ? 'has' : 'have'} not been closed, so the figures below can still move. Close ${open.length === 1 ? 'it' : 'them'} on the Close screen before anything here is copied into a return.`;
}
/* ── the sentences that keep this page from being read as a return ────────── */
/**
 * The refusal, in one paragraph, on the screen.
 *
 * This is the sentence the whole feature is built around. Somebody opening a
 * page called Tax expects a figure, and the honest answer is that Repple will
 * not produce one — so it has to be said plainly, at the top, rather than
 * inferred from the absence of a number.
 */
exports.TAX_NO_RETURN_FIGURE = 'Repple does not work out any tax figure and this page is not a return. It does not apply a rate to anything, it produces no tax amount, no net-of-tax figure and no return box, and it will not estimate one. What it gives you is the record a return is made FROM — what the gym took, what it billed, what it paid out and what it says about its own registration — in a period you can file against. The figure itself is your accountant’s, made with the documents Repple has never seen.';
/**
 * Everything Repple does not know, named one at a time.
 *
 * On the screen rather than in this comment, and itemised rather than summed
 * into "some data may be missing". A reader who is told which six things are
 * absent can decide whether their own records cover them; a reader told the
 * data is incomplete concludes that it is roughly right.
 */
exports.TAX_UNKNOWNS = [
    {
        title: 'No rate is recorded against any sale',
        detail: 'Repple stores no tax rate anywhere, on a membership, an invoice or a payment. A gym’s supplies can sit at different rates in the same week and some can be exempt, so one rate held against the gym would be a claim about all of them — and a rate held against an invoice would say nothing about the card payments at the desk, which are most of the money.',
    },
    {
        title: 'The takings are gross, and only what somebody recorded',
        detail: 'What a member was charged is what is here. The card processor’s fee is in no table in this database, and a payment that was taken and never entered at the desk is not here either — which is what /accounting’s reconciliation section exists to surface.',
    },
    {
        title: 'Nothing here is evidenced',
        detail: 'Repple holds no supplier invoice, no receipt and no till roll. Every cost on the record is somebody’s typed word about a document that lives somewhere else, and that document is what a tax authority asks for.',
    },
    {
        title: 'The costs are only what has been typed',
        detail: 'A cost nobody wrote down is missing, not nil. In a gym’s first months of using this most of them will be.',
    },
    {
        title: 'Two currencies are never added',
        detail: 'Where a period holds more than one currency there is no single figure at all, and none is shown. A gym charging in one currency and paying an insurer in another has two amounts of money, and this app holds no rate to turn them into one.',
    },
    {
        title: 'An open month is still moving',
        detail: 'A month nobody has closed on the Close screen can still take a late payment, a correction or a cost dated back into it. The period above says which of its months are open.',
    },
];
/** What the two stored facts are, said beside them. Neither is checked, and a
 *  reader is entitled to know that before quoting either. */
exports.TAX_FACTS_ARE_STATED_NOT_CHECKED = 'Both of these are what somebody at this gym typed. Repple has not checked either against any register — there is no register it could check — and has not inferred either from a country, a currency or a price. They are held exactly as entered.';
/* ── reads and writes ─────────────────────────────────────────────────────── */
/**
 * What the gym has said about tax.
 *
 * The error is returned rather than thrown, and kept apart from the values, for
 * the reason `readTenant` in studio-web/lib/currency.ts keeps them apart: a
 * refused read must reach the screen as "we could not ask", never as "this gym
 * is not registered".
 */
async function readGymTaxProfile(sb, tenantId) {
    // supabase-js RESOLVES on a database error, so the error is read off the
    // result. Without this a refused read arrives as `data: null` and the page
    // would state a fact about a business's legal standing out of a failed query.
    const { data, error } = await sb
        .from('tenants')
        .select('tax_registered, tax_registration')
        .eq('id', tenantId)
        .single();
    if (error) {
        return {
            profile: exports.NO_TAX_PROFILE,
            error: error.message || 'The gym record could not be read.',
        };
    }
    const raw = data ?? null;
    return {
        profile: {
            registered: typeof raw?.tax_registered === 'boolean' ? raw.tax_registered : null,
            registration: (raw?.tax_registration ?? '').trim() || null,
        },
        error: null,
    };
}
/**
 * Save both facts, in one write.
 *
 * BOTH columns, always, even when only one changed. Part 701 refuses a row that
 * says "not registered" and carries a number, so an update that moved one
 * column and left the other would be rejected by the CHECK at exactly the
 * moment somebody unticked the box.
 *
 * The COUNT is checked, not `error` alone: `tenants_owner_rw` is
 * `is_owner_of(id)`, so an update run by anybody else matches zero rows and
 * returns `error: null` — and the screen would report a registration number as
 * saved while the column is still empty.
 */
async function saveGymTaxProfile(sb, tenantId, p) {
    const reg = String(p.registration ?? '').trim();
    const r = await sb
        .from('tenants')
        .update({
        tax_registered: p.registered,
        // Empty is null, not an empty string: part 701's CHECK refuses a blank,
        // and "nobody has said" is the fact an empty box means.
        tax_registration: reg || null,
    }, { count: 'exact' })
        .eq('id', tenantId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('What this gym says about tax', r);
}
/**
 * The month keys this gym has a LIVE close on, inside a period.
 *
 * A reopened close is not a close — `reopened_at is null` is the same test the
 * partial unique index in part 182 is built on — so a month that was closed and
 * then reopened comes back as open here, which is what it is.
 *
 * Throws on a refused read rather than returning an empty list, because an
 * empty list is a real answer here ("none of these months is closed") and the
 * caller must be able to tell the two apart.
 */
async function fetchClosedMonths(sb, tenantId, months) {
    if (!months.length)
        return [];
    // Not chunked, and the bound is the caller's shape rather than a limit: a
    // `TaxPeriod` is one month or one quarter, so `months` is one key or three.
    // `recentTaxPeriods` builds every period this console offers and none of them
    // is longer. Three uuid-free month keys is a request line of a couple of
    // hundred bytes — nowhere near the 8KB a `.in()` has to respect.
    const { data, error } = await sb
        .from('gym_month_closes')
        .select('month_key')
        .eq('tenant_id', tenantId)
        .is('reopened_at', null)
        .in('month_key', months);
    if (error)
        throw error;
    return (data ?? []).map((r) => r.month_key);
}
