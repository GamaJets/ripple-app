"use strict";
// Matching an ad to the join code it points at — the whole reason ad spend can
// be collected without the coach mapping anything.
//
// ── The idea ─────────────────────────────────────────────────────────────
//
// src/lib/joinCode.ts already builds the link a coach puts in their Instagram
// bio: `https://…/join?c=K7M2QX`. The same link is what they set as the
// destination of the ad. So the ad ALREADY carries the code, and the sync only
// has to read it back out. Nothing is mapped by hand — which matters, because a
// mapping screen is a thing that is correct on the day it is filled in and
// quietly wrong every day after, and being quietly wrong here means telling a
// coach that the wrong channel is the one making them money.
//
// ── One matcher, three channels ──────────────────────────────────────────
//
// Meta, Google Ads and TikTok all answer the same two questions — what did this
// ad cost, and where does it point — and all three are matched by the code in
// the destination. So there is one matcher, not three: `matchAds` takes an
// `AdInsight` a channel's sync has already reduced its own reply to, and
// `codeFromUrl` reads the code out of a link whichever redirector mangled it.
//
// What is NOT the same between them is the unit the money arrives in, and that
// is deliberately not in this file. `centsFromAmount` below takes a decimal in
// MAJOR units, which is what Meta and TikTok report; Google reports micros and
// `centsFromMicros` in src/lib/adChannels.ts converts them once, there, before
// anything reaches here. A per-channel unit inside the matcher would be a
// hundredfold error waiting for whichever channel was added next.
//
// ── Why this is a pure module ────────────────────────────────────────────
//
// Everything below is a decision about somebody's money and none of it needs a
// network, a database or a device. Kept separate so the rules can be asserted
// (adMatch.test.ts) rather than discovered in production off a real ad account.
//
// ── The three ways this can be honestly wrong, all of them recorded ──────
//
// An ad may carry no destination we can read, a destination with no `?c=`, or a
// code that is not one of this coach's. All three are UNMATCHED, and unmatched
// is not zero: it is real money that left the coach's account and could not be
// placed. It is returned with the ad's name and destination so the screen can
// show it. A total that quietly dropped those ads would be a smaller, tidier,
// wrong number, and the coach would divide their revenue by it.
//
// A fourth: an ad whose spend figure cannot be read at all. That one carries a
// null amount, and a null amount poisons the unmatched TOTAL to null rather
// than being skipped — a partial sum of unattributed money reads exactly like
// the whole of it.
//
// ── Currency ─────────────────────────────────────────────────────────────
//
// The provider reports the ad account's own currency, which need not be what
// the coach charges in and is never assumed. Where the ads disagree about it,
// nothing is summed: `currencyConflict` is set and the caller records the run
// as unusable rather than adding dirhams to dollars.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_CURRENCY_NOTE = exports.CURRENCY_CONFLICT_NOTE = exports.UNMATCHED_NOTE = void 0;
exports.adCurrencyDecimals = adCurrencyDecimals;
exports.centsFromAmount = centsFromAmount;
exports.codeFromUrl = codeFromUrl;
exports.urlsFromCreative = urlsFromCreative;
exports.matchAds = matchAds;
exports.unmatchedReasonNote = unmatchedReasonNote;
/* ── how many places this money has ────────────────────────────────────────
 *
 * Copied from src/lib/coachMoney.ts rather than imported, and the copy is
 * forced rather than lazy. This module is imported by three edge functions
 * (`ads-sync`, `ads-google`, `ads-tiktok`), Deno resolves a relative specifier
 * literally, and `coachMoney.ts` imports `./locale` — an extensionless path
 * Deno cannot open. So a module an edge function imports has to be a LEAF with
 * no relative imports at all; scripts/check-functions.mjs enforces exactly
 * that, and `supabase/functions/owner-metrics/index.ts` carries the same copy
 * for the same reason and says so.
 *
 * What stops the copies drifting is not discipline, it is an assertion:
 * adMatch.test.ts imports `currencyDecimals` from coachMoney and this file's
 * `adCurrencyDecimals` and requires the two to agree on every currency in both
 * sets. A copy nothing compares is a copy that has already drifted.
 *
 * Stripe's own two lists. There are no fils in a yen, and there are a THOUSAND
 * of them in a Kuwaiti dinar.
 */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);
/** How many decimal places this money has, or null when nobody said which
 *  money it is. Null rather than 2: there is no default currency in this
 *  product and there is therefore no default number of places either. */
function adCurrencyDecimals(currency) {
    const cur = (currency || '').trim().toLowerCase();
    if (!cur)
        return null;
    if (ZERO_DECIMAL.has(cur))
        return 0;
    if (THREE_DECIMAL.has(cur))
        return 3;
    return 2;
}
/**
 * A provider's decimal amount → the minor units the rest of Repple stores.
 *
 * ── This used to be `Math.round(n * 100)` and the reason given was false ──
 *
 * The comment that stood here said the flat hundred was deliberate, "because
 * that is what `money()` in gymRecord.ts divides by for every currency" — so a
 * ¥1,234 ad stored 123400 and rendered as "JPY 1,234.00", the right amount with
 * a decimal place nobody in Japan uses.
 *
 * `money()` has not done that for some time. It delegates to `minorMoney` in
 * coachMoney.ts, which asks `currencyDecimals` how many places the money has:
 * JPY has none, so 123400 minor units renders as "JPY 123,400". A coach in
 * Tokyo was shown their advertising spend as a HUNDRED TIMES what they spent,
 * and their cost-per-client with it, because a comment about the renderer went
 * on being true of the writer after the renderer was fixed.
 *
 * The other end is the same defect the other way. A Kuwaiti account reporting
 * 12.340 stored 1234, and `minorMoney` reads 1234 fils as KWD 1.234 — a tenth
 * of the real figure. Revenue on the same screen comes from
 * `client_purchases.amount_cents`, which is TRUE minor units as Stripe charged
 * them, so the two sides of part 98's whole comparison were denominated
 * differently in twenty-one currencies and nothing on the screen said so.
 *
 * ── So the currency is required, and it is the ad account's own ───────────
 *
 * There is no default currency in this product and therefore no default factor.
 * Null when nobody said which money it is — `matchAds` passes the account
 * currency it has already established, and a run with no currency, or with two,
 * is refused whole by every caller before a figure is recorded.
 *
 * The scaling is done on the DIGITS — the same arithmetic, line for line, as
 * `minorFromDecimal` in coachMoney.ts, which this cannot import for the
 * leaf-module reason above — so nothing is multiplied as a float and 12.345 in
 * a two-place currency is 1235 rather than 1234.999999999999 truncated to 1234.
 * It ROUNDS a place the currency does not have rather than refusing it:
 * Google's micros reach here as "12.345678" and a provider is not a person
 * typing into a box, so dropping the ad would put a hole in the coach's spend
 * where a rounded half-fils belongs.
 *
 * Null for anything unreadable, and null is never a zero. An empty string, a
 * missing field and the word "unknown" all mean we do not know what this ad
 * cost, and a zero would say the coach got it for free.
 */
function centsFromAmount(v, currency) {
    const dp = adCurrencyDecimals(currency);
    if (dp == null || v == null)
        return null;
    const s = String(v).trim().replace(/[,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s))
        return null;
    const dot = s.indexOf('.');
    const intPart = dot === -1 ? s : s.slice(0, dot);
    // Padded one place further than the money has, so the rounding digit is there
    // to read even when the provider stated no fraction at all.
    const frac = (dot === -1 ? '' : s.slice(dot + 1)).padEnd(dp + 1, '0');
    const digits = intPart + frac.slice(0, dp);
    if (digits.length > 15)
        return null;
    const base = Number(digits);
    if (!Number.isSafeInteger(base))
        return null;
    const cents = frac.charCodeAt(dp) - 48 >= 5 ? base + 1 : base;
    if (!Number.isSafeInteger(cents))
        return null;
    // The same ceiling part 98 puts on a typed figure. An amount past it is a
    // provider fault or a units mix-up, not a campaign.
    if (cents < 0 || cents >= 100000000000)
        return null;
    return cents;
}
/** Percent-decode without throwing on a half-encoded string somebody pasted. */
function decode(s) {
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    }
    catch {
        return s;
    }
}
/**
 * The join code a destination URL points at, or null.
 *
 * Parsed by hand rather than through `URL`. React Native's URL is a partial
 * implementation whose `searchParams` has been missing or half-present
 * depending on the engine, and this module runs in the app, in a Deno edge
 * function and under plain node in the test. A regex over the query string
 * behaves the same in all three and does not throw on a malformed link, which
 * is exactly the kind of link a person pastes into an ad.
 *
 * Two things it deliberately handles:
 *
 *   · a link shim. Meta rewrites destinations through `l.facebook.com/l.php?u=
 *     <the real url, encoded>`, and the code is inside that inner URL. Without
 *     following it every ad on a page post would read as having no code.
 *     Google's redirector is the same shape with a different parameter name:
 *     `googleadservices.com/pagead/aclk?…&adurl=<the real url, encoded>`, and
 *     `google.com/aclk` uses it too. `adurl` is therefore read exactly as `u`
 *     is, by the same loop — a second parser for Google would be a second set
 *     of rules to keep in step with this one, and the one that drifted would be
 *     the one nobody had a test for.
 *   · tracking parameters after the code — `?c=K7M2QX&utm_source=ig` and
 *     `{{ad.id}}` macros appended by `url_tags` — which are ordinary query
 *     parameters and must not stop the code being found. Google appends
 *     `gclid`, TikTok appends `ttclid`, and both also arrive unexpanded as the
 *     literal macros `{gclid}` and `__CLICKID__` when the parameter is read off
 *     the ad's own final URL rather than off a click. None of them is a join
 *     code and none of them is read as one: a click id identifies the CLICK,
 *     and treating one as a code would file a coach's money against a value
 *     that changes on every impression. They matter here only in that they must
 *     not hide the `?c=` sitting beside them, which is what the loop below is.
 *
 * The value is returned as it was written, uppercased and stripped of spacing
 * only. It is NOT normalised to six characters: `normaliseCode` truncates, and
 * truncating `?c=hello-world` to "HELLOW" would invent a code that might belong
 * to somebody. Whether the value is one of this coach's codes is decided by
 * matchAds against the real list, and a value that is not is reported as
 * 'unknown-code' rather than guessed at.
 */
function codeFromUrl(url, depth = 0) {
    const raw = String(url ?? '').trim();
    if (!raw || depth > 3)
        return null;
    // Everything after the first '?', minus any fragment. A code in the fragment
    // is not a thing the link builder produces and would not reach the server.
    const q = raw.split('#')[0].split('?').slice(1).join('?');
    if (!q)
        return null;
    let nested = null;
    for (const pair of q.split('&')) {
        if (!pair)
            continue;
        const eq = pair.indexOf('=');
        if (eq < 0)
            continue;
        const key = decode(pair.slice(0, eq)).trim().toLowerCase();
        const val = decode(pair.slice(eq + 1)).trim();
        if (!val)
            continue;
        // Case-insensitive on the key: the link builder writes `c`, and a coach
        // retyping the URL into an ad by hand writes `C` about as often.
        if (key === 'c') {
            const code = val.replace(/\s+/g, '').toUpperCase();
            if (code)
                return code;
        }
        // The shim's inner URL, kept for after the loop — a real `c` on the outer
        // link is the more direct statement of intent and wins. `u` is Meta's,
        // `adurl` is Google's; the rest were already here for the hand-pasted
        // redirectors that use them.
        if (!nested && (key === 'u' || key === 'url' || key === 'q' || key === 'adurl') && /^https?:\/\//i.test(val)) {
            nested = val;
        }
    }
    return nested ? codeFromUrl(nested, depth + 1) : null;
}
/**
 * Every URL on an ad creative, wherever the provider decided to put it.
 *
 * Meta's creative shape is a union of half a dozen historical formats — a plain
 * `link_url`, `object_story_spec.link_data.link`, a `child_attachments` array
 * for a carousel, `asset_feed_spec.link_urls` for a dynamic ad — and it gains a
 * new one whenever a new ad format ships. Naming the paths would mean a coach's
 * spend silently becoming unattributable the month Meta adds a format.
 *
 * So this walks the object and takes every string that is an http(s) URL. The
 * cost of being broad is picking up an image URL or a tracking pixel, and that
 * costs nothing: a URL with no `?c=` in it contributes no code, and the ad is
 * only ever matched to a code some URL on it actually names.
 *
 * Being shapeless is why it took the other two channels without a line of
 * change. Google hands back `ad_group_ad.ad.final_urls` (an array) alongside
 * `final_mobile_urls` and, on some ad types, a `tracking_url_template`; TikTok
 * hands back a single `landing_page_url` and, for a Spark ad, nothing but a
 * post id. All three are objects with URLs somewhere in them, and the one that
 * has no URL at all is honestly reported as 'no-link' rather than guessed at.
 */
function urlsFromCreative(creative, limit = 40) {
    const out = [];
    const seen = new Set();
    const walk = (v, depth) => {
        if (out.length >= limit || depth > 8 || v == null)
            return;
        if (typeof v === 'string') {
            const s = v.trim();
            if (/^https?:\/\//i.test(s) && !seen.has(s)) {
                seen.add(s);
                out.push(s);
            }
            return;
        }
        if (Array.isArray(v)) {
            for (const x of v)
                walk(x, depth + 1);
            return;
        }
        if (typeof v === 'object') {
            for (const x of Object.values(v))
                walk(x, depth + 1);
        }
    };
    walk(creative, 0);
    // A destination that names a code is what we are here for; sorting those
    // first means an ad with a tracking pixel listed before its real link is
    // still matched, and the URL recorded against an UNMATCHED ad is the first
    // one seen rather than an arbitrary one.
    return out.sort((a, b) => Number(codeFromUrl(b) != null) - Number(codeFromUrl(a) != null));
}
/**
 * Ads in, per-code totals and the money that could not be placed out.
 *
 * The order of the checks is the order in which a coach can act on the answer:
 * an ad with no spend figure is a provider problem, an ad with no link is an
 * ad-format problem, an ad with a link and no code is a thing they can fix in
 * thirty seconds by editing the destination, and a code that is not theirs is
 * usually a typo in that destination.
 */
function matchAds(ads, codes) {
    const list = Array.isArray(ads) ? ads : [];
    // Code → the coach's own row. Uppercased on both sides so 'k7m2qx' in a
    // hand-typed destination is the same code as 'K7M2QX'.
    const byCode = new Map();
    for (const c of codes || []) {
        const code = String(c?.code ?? '').trim().toUpperCase();
        if (code)
            byCode.set(code, { id: c.id ?? null, code, label: c.label || code });
    }
    const currencies = new Set();
    for (const a of list) {
        const c = String(a?.currency ?? '').trim().toUpperCase();
        if (c)
            currencies.add(c);
    }
    const currencyConflict = currencies.size > 1;
    const currency = currencies.size === 1 ? [...currencies][0] : null;
    const totals = new Map();
    const unmatched = [];
    let matchedCents = 0;
    let unmatchedCents = 0;
    const dropInUnmatched = (a, url, cents, reason) => {
        unmatched.push({ adId: String(a?.adId ?? ''), adName: String(a?.adName ?? '').trim(), url, cents, reason });
        if (cents == null)
            unmatchedCents = null;
        else if (unmatchedCents != null)
            unmatchedCents += cents;
    };
    // The unit every figure below is scaled into. It is the ACCOUNT's currency,
    // established from the ads themselves above, and it is deliberately not read
    // per ad: where the ads disagree there is no account currency, `currency` is
    // null, and every caller refuses the whole run rather than recording a total
    // in a unit that is not one of them. Null here therefore makes every amount
    // unreadable, which is the right answer — a spend figure with no currency is
    // a number, and the screen it feeds compares it against what clients paid.
    const unit = currencyConflict ? null : currency;
    for (const a of list) {
        const urls = (a?.urls || []).map((u) => String(u || '').trim()).filter(Boolean);
        const cents = centsFromAmount(a?.spend, unit);
        // An unreadable amount first: we cannot attribute a number we do not have,
        // and pretending it is zero would let it disappear into a matched code.
        if (cents == null) {
            dropInUnmatched(a, urls[0] ?? null, null, 'no-amount');
            continue;
        }
        if (!urls.length) {
            dropInUnmatched(a, null, cents, 'no-link');
            continue;
        }
        let found = null;
        let foundOn = null;
        for (const u of urls) {
            const c = codeFromUrl(u);
            if (c) {
                found = c;
                foundOn = u;
                break;
            }
        }
        if (!found) {
            dropInUnmatched(a, urls[0], cents, 'no-code');
            continue;
        }
        const known = byCode.get(found);
        if (!known) {
            dropInUnmatched(a, foundOn, cents, 'unknown-code');
            continue;
        }
        const row = totals.get(known.code) ?? { codeId: known.id, code: known.code, label: known.label, cents: 0, ads: 0 };
        row.cents += cents;
        row.ads += 1;
        totals.set(known.code, row);
        matchedCents += cents;
    }
    return {
        currency,
        currencyConflict,
        // Biggest spend first: it is the figure a coach checks, and the one an
        // error in is worth the most.
        matched: [...totals.values()].sort((a, b) => b.cents - a.cents || a.code.localeCompare(b.code)),
        unmatched: unmatched.sort((a, b) => (b.cents ?? -1) - (a.cents ?? -1)),
        matchedCents,
        unmatchedCents,
        adsSeen: list.length,
    };
}
/**
 * What to tell a coach about one unmatched ad.
 *
 * Each one names the remedy, because "unmatched" on its own reads as a Repple
 * fault and three of the four are things only the coach can fix — in their ad,
 * in about a minute.
 */
function unmatchedReasonNote(reason) {
    switch (reason) {
        case 'no-link':
            return 'This ad has no destination link we could read, so there is nothing on it to match a code against.';
        case 'no-code':
            return 'This ad’s link does not carry a code. Set its destination to one of your join links and its spend will be counted from the next sync.';
        case 'unknown-code':
            return 'This ad’s link carries a code that is not one of yours — usually a typo in the destination, or a code that was deleted.';
        case 'no-amount':
            return 'What this ad cost came back in a form we could not read, so its spend is unknown rather than nothing.';
    }
}
/**
 * Said on the screen, above the figures, because a coach acting on these
 * numbers has to know what they do not include.
 */
exports.UNMATCHED_NOTE = 'Money spent on ads whose destination does not carry one of your join links cannot be credited to a code. It is listed below with what it cost, because it is money you spent — it is not missing, and it is not nothing.';
/** Why a sync that ran can still be unusable. Both are stated, never guessed. */
exports.CURRENCY_CONFLICT_NOTE = 'This ad account reported spend in more than one currency, and adding those together would produce a figure that is not an amount of money. Nothing was recorded from this sync.';
exports.NO_CURRENCY_NOTE = 'This ad account did not say which currency it bills in, and a figure with no currency cannot be compared with what your clients pay. Nothing was recorded from this sync.';
