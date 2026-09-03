"use strict";
// What a gym has said about itself — and the difference between a setting it
// has not made and a setting somebody guessed for it.
//
// Four things live here, and they are together because they are the same
// question asked four ways: what does this gym charge in, what does it pay a
// coach for, what colour is it, and how does a screen write any of them without
// inventing an answer.
//
// A fifth joined them: what timezone is it in. Its parsing lives in
// src/lib/gymZone.ts rather than here, because unlike a currency code or a hex
// colour a zone is not checkable with a regex — the answer is whatever the
// runtime's IANA database holds, and there is a whole file's worth of day and
// hour arithmetic that follows from it. What lives here is the same thing that
// lives here for the other four: the read, the patch, and the record of who may
// change it and what happens to what was there before.
//
// Framework-agnostic like the rest of src/lib: the Supabase client arrives as
// an argument, so the web console and the phone app can both use this and
// neither owns it. That matters more here than usual — `tenants.currency` is
// now written from two surfaces, and two implementations of one rule is how the
// rule stops being one rule.
//
// ── Why the pay policy is stored at all ────────────────────────────────────
//
// `PAY_DELIVERED_ONLY` in src/lib/gymSessions.ts is documented as "the
// conservative default", and it was being used as the STORED VALUE by four
// screens that each held their own unsaved copy: /sessions, /staff and /close
// as `useState`, and /coach/earnings as a hardcoded constant with a note on
// screen admitting it cannot read the gym's real policy. An owner who set the
// policy on Sessions and walked to Close to settle the month settled against a
// different number from the one they had just looked at.
//
// A default that renders cleanly looks considered. That sentence is the whole
// of part 99's argument about currency and it applies here without a word
// changed, so the stored value is NULLABLE and null means the gym has not
// decided — which is a thing to say on screen, not a thing to fill in.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_PAY_POLICY_NOTE = exports.PAY_POLICY_LABEL = exports.PAY_POLICY_CODES = void 0;
exports.payPolicyOf = payPolicyOf;
exports.payPolicyCode = payPolicyCode;
exports.parseTenantCurrency = parseTenantCurrency;
exports.parseBrandColor = parseBrandColor;
exports.fetchGymProfile = fetchGymProfile;
exports.saveGymProfile = saveGymProfile;
const wroteRows_1 = require("./wroteRows");
const gymSettings_1 = require("./gymSettings");
exports.PAY_POLICY_CODES = [
    'delivered_only',
    'no_shows',
    'late_cancellations',
    'no_shows_and_late_cancellations',
];
/** What each answer means, in the words a screen shows an owner. Sentence case:
 *  these are read as statements, not as button labels. */
exports.PAY_POLICY_LABEL = {
    delivered_only: 'Only sessions that were delivered',
    no_shows: 'Delivered sessions and no-shows',
    late_cancellations: 'Delivered sessions and late cancellations',
    no_shows_and_late_cancellations: 'Delivered sessions, no-shows and late cancellations',
};
/**
 * The stored code → the policy `isPayable` takes.
 *
 * Returns null for null, and for anything the constraint does not permit. Not
 * `PAY_DELIVERED_ONLY`: a value this module does not recognise is a value
 * nobody here understands, and answering it with the conservative reading is
 * the exact substitution this whole file exists to stop. A caller that gets
 * null must say "not set" and refuse to total, which is what a screen would
 * have to do anyway for the gym that has genuinely not decided.
 */
function payPolicyOf(code) {
    switch (code) {
        case 'delivered_only': return { payNoShows: false, payLateCancellations: false };
        case 'no_shows': return { payNoShows: true, payLateCancellations: false };
        case 'late_cancellations': return { payNoShows: false, payLateCancellations: true };
        case 'no_shows_and_late_cancellations': return { payNoShows: true, payLateCancellations: true };
        default: return null;
    }
}
/** The policy a control produced → the code to store. Total, so a control can
 *  never assemble a policy that has no representation in the column. */
function payPolicyCode(p) {
    if (p.payNoShows && p.payLateCancellations)
        return 'no_shows_and_late_cancellations';
    if (p.payNoShows)
        return 'no_shows';
    if (p.payLateCancellations)
        return 'late_cancellations';
    return 'delivered_only';
}
/** The sentence a screen prints where a policy would go, when none is set. One
 *  wording in one place, so four screens cannot word the same silence four
 *  ways — which is how they came to disagree in the first place. */
exports.NO_PAY_POLICY_NOTE = 'this gym has not said what it pays for beyond delivered sessions';
/**
 * What the owner typed → what to write to `tenants.currency`.
 *
 * `tenants_currency_is_iso` is `currency is null or currency ~ '^[A-Z]{3}$'`,
 * so anything else fails the write with 23514 after the sheet has closed. It is
 * refused here instead, where the field they typed it into is still on screen.
 *
 * Blank CLEARS rather than being refused, and that is deliberate: an owner who
 * empties the field is saying they no longer know, and the column is nullable
 * precisely so that can be said. Every screen already renders a null as a dash
 * with a note; none of them renders a wrong code as anything at all.
 *
 * The normalisation here is a courtesy, not the guarantee. The guarantee is
 * `tenants_normalise_settings`, the trigger the database runs on every write
 * from every client — see supabase/parts/166. Doing it in both places is the
 * point: the caller gets told before the round trip, and the stored value is
 * right whoever wrote it.
 */
function parseTenantCurrency(input) {
    const raw = String(input ?? '').trim();
    if (!raw)
        return { kind: 'clear' };
    const code = raw.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
        return {
            kind: 'bad',
            reason: 'A currency is its three-letter ISO code — GBP, AED, EUR, USD. Not a symbol and not a name.',
        };
    }
    return { kind: 'currency', currency: code };
}
/**
 * What the owner typed → what to write to `tenants.brand_color`.
 *
 * There is NO check constraint on that column — the same finding
 * `isBrandColor` in src/lib/gymSettings.ts records — so unlike the currency,
 * nothing downstream will refuse a bad value on the way in. It is refused here
 * because the alternative is that it is not refused anywhere: the phone theme
 * parses it as hex without asking, and studio-web's own `safeHex` silently
 * keeps its default. Both of those are a gym whose buttons are the wrong colour
 * or unreadable, with nothing on screen to say why.
 *
 * Blank CLEARS, for the reason `parseTenantCurrency` gives about currency: an
 * owner who empties the field is saying they have not chosen a colour, part 118
 * dropped the default precisely so that could be said, and every surface
 * already renders the null as its own accent.
 *
 * Three- and six-digit hex only, and lower-cased, which is what `brandColorOf`
 * already decides for the READ side. One rule, asked here before the round trip
 * and again when the stored value is handed to a theme.
 */
function parseBrandColor(input) {
    const raw = String(input ?? '').trim();
    if (!raw)
        return { kind: 'clear' };
    const color = (0, gymSettings_1.brandColorOf)(raw);
    if (!color) {
        return {
            kind: 'bad',
            reason: 'A brand colour is a hex code — #1e88e5 or #1b5, with the hash. Not a colour name and not rgb().',
        };
    }
    return { kind: 'color', color };
}
/**
 * The gym's own row, with the error kept apart from the values.
 *
 * supabase-js RESOLVES on a database error rather than rejecting, so taking
 * only `data` turns a refused read into a row of nulls — a gym with no name, no
 * fee, no currency and no policy, every one of which a screen then states as a
 * setting the owner has not made. `error` is what tells "we could not ask" from
 * "nobody has said", and they are different sentences with different fixes.
 */
async function fetchGymProfile(sb, tenantId) {
    const { data, error } = await sb
        .from('tenants')
        .select('name, currency, session_fee, session_pay_policy, brand_color, timezone')
        .eq('id', tenantId)
        .single();
    if (error) {
        return { profile: null, error: error.message || 'The gym record could not be read.' };
    }
    const r = (data ?? {});
    const fee = r.session_fee;
    return {
        profile: {
            name: r.name ?? null,
            currency: String(r.currency ?? '').trim().toUpperCase() || null,
            // A numeric column arrives from PostgREST as a string on some paths and a
            // number on others. Parsed once, here, so no screen has to guess — and
            // NaN becomes null rather than a figure payroll would multiply by.
            sessionFee: fee == null || fee === '' ? null
                : Number.isFinite(Number(fee)) ? Number(fee) : null,
            payPolicy: r.session_pay_policy ?? null,
            brandColor: r.brand_color ?? null,
            // Trimmed to null so '' and null are one answer, which is what
            // `tenants_timezone_check` already guarantees on the way in — restated
            // here for a row written before part 710 existed.
            timezone: String(r.timezone ?? '').trim() || null,
        },
        error: null,
    };
}
/**
 * Save what the owner changed.
 *
 * The COUNT is checked, not `error` alone — see src/lib/wroteRows.ts, and this
 * is the table where that matters most. `tenants_owner_rw` is
 * `is_owner_of(tenants.id)` and is the only policy granting UPDATE, so an
 * update run by anybody else — a trainer who reached the URL, an owner whose
 * profile row says something else, an owner of a different gym — matches ZERO
 * ROWS and returns `error: null`. Without the count the sheet says "Saved", the
 * page reloads, and the old value comes back looking like a stale cache.
 *
 * An empty patch is refused rather than sent. PostgREST answers an empty update
 * with a 204 and a count of zero, which `assertWrote` would report as a refusal
 * — a confusing error for pressing Save without changing anything.
 */
async function saveGymProfile(sb, tenantId, patch) {
    const row = {};
    if (patch.name !== undefined)
        row.name = patch.name;
    if (patch.currency !== undefined)
        row.currency = patch.currency;
    if (patch.sessionFee !== undefined)
        row.session_fee = patch.sessionFee;
    if (patch.payPolicy !== undefined)
        row.session_pay_policy = patch.payPolicy;
    // `tenants_normalise_settings` does NOT touch this one — it trims the name and
    // folds the case of the currency and the policy, and nothing else — so what is
    // sent here is what is stored. `parseBrandColor` is therefore the only thing
    // between an owner's typing and the column, which is why it lower-cases rather
    // than leaving that to a trigger that will not do it.
    if (patch.brandColor !== undefined)
        row.brand_color = patch.brandColor;
    // `tenants_timezone_check` (part 710) trims this, folds '' to null and
    // REFUSES anything pg_timezone_names does not hold. Unlike the colour, this
    // column has a guarantee behind it — so a bad value arrives as a raised
    // exception with the zone named in it rather than as a silently stored
    // string, and `parseGymZone` exists to say so before the round trip rather
    // than to be the only thing standing in the way.
    if (patch.timezone !== undefined)
        row.timezone = patch.timezone;
    if (Object.keys(row).length === 0)
        return;
    const r = await sb.from('tenants').update(row, { count: 'exact' }).eq('id', tenantId);
    (0, wroteRows_1.assertWrote)('That gym setting', r);
}
