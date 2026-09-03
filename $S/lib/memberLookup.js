"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberNoBody = memberNoBody;
exports.memberNoFor = memberNoFor;
exports.readScan = readScan;
exports.indexByMemberNo = indexByMemberNo;
exports.findByMemberNo = findByMemberNo;
exports.scanNote = scanNote;
// The number on the member's screen, and the desk that could not type it in.
//
// ── What the member is holding ─────────────────────────────────────────────
//
// `app/(client)/access.tsx` draws a full-screen Code 39 barcode and, under it,
// the number in plain characters: "REP-3K7QW1ZP4". `app/(client)/membership.tsx`
// prints the same string beside the member's name. Both get it from
// `memberNoFrom(name, id, appName)` in src/lib/membership.ts, and the header of
// that file says what it is for — "the one screen they hold out to a person at
// a turnstile".
//
// ── What the desk could do with it ─────────────────────────────────────────
//
// Nothing. The member picker on studio-web/app/door/page.tsx searched
// `[name, plan, status, id]`, and its own comment beside that list read "and on
// the id because that is what a barcode scanner types into a text field". The
// id is `profiles.id`, a uuid, and no member-facing screen in this product has
// ever shown a member their uuid. What a scanner reading THIS product's own
// barcode types is "REP-3K7QW1ZP4", which matched no field in that list.
//
// So the whole of it: the app prints a number and tells the member to give it
// to reception (`MEMBER_NO_CHANGED_NOTE`, in that same file, says in as many
// words "give them this one instead"), and reception has nowhere to put it.
// The desk falls back to typing a name at somebody standing in front of them —
// which is slower, and which is the search that fails on the names it matters
// for: two members called Mohammed, a name the person at the desk cannot spell,
// a member whose name on the roster is not the name they use.
//
// ── The three things that make this more than a fifth search field ─────────
//
//   1. THE PREFIX IS NOT STABLE ACROSS DEVICES. `memberPrefix` derives the
//      three letters from the brand label the READING DEVICE has: `appName`
//      from src/ui/brand.tsx, which is the gym's own name once `my_gym_name()`
//      has answered on that device and the build's name until it has. So two
//      members of one gym can be holding "RUO-3K7QW1ZP4" and "REP-3K7QW1ZP4".
//      The BODY is the same in both, because `memberNoFrom` seeds its hash on
//      the id alone and the brand only chooses the letters. Matching on the
//      body is therefore the only match that works for both of them, and this
//      module never compares a prefix to anything.
//
//   2. THE NUMBER IS NOT GUARANTEED UNIQUE. membership.ts says so itself: "the
//      id it hashes is unique, the hash of it is not". Two members of one gym
//      sharing a number is unlikely and possible, and the failure mode is
//      checking in the wrong person — which puts a visit, and possibly a pass
//      redemption, against somebody who was not there. So a number matching two
//      people is its own answer and the desk is asked, never guessed for.
//
//   3. A NUMBER MATCHING NOBODY IS NOT PROOF OF ANYTHING WHEN THE ROSTER READ
//      DID NOT COME BACK WHOLE. "That is not a member here" said over a failed
//      or truncated read is a person turned away at a door they pay for.
//
// ── What this module does not do ───────────────────────────────────────────
//
// It does not admit anybody. `admissionCheck` in gymVisits.ts is what decides
// whether a person may come in; this only decides WHO is at the desk. The two
// are kept apart deliberately: a lookup that also carried a verdict would be a
// second opinion about admission, sitting one import away from the first.
//
// Pure, and it reuses `memberNoFrom` rather than reimplementing the hash. Two
// implementations of one number is how the desk and the member's phone come to
// disagree about it, which is the exact defect this file is fixing. Asserted
// against under plain `node`.
const membership_1 = require("./membership");
/**
 * The part of a member number that does not depend on which device drew it.
 *
 * `memberNoFrom` returns `${prefix}-${body}`. The prefix is three letters from
 * the brand label; the body is nine base-36 characters of a hash of the id. The
 * brand is passed as null here on purpose: `memberPrefix(null)` is 'MEM', so
 * this cannot accidentally be shown to anybody as a number, and the body is
 * identical whatever brand the member's own app used.
 *
 * `name` is passed as the empty string because `memberNoFrom` seeds on
 * `id || name || 'repple'` — with an id present the name has never been part of
 * the number. That is asserted, not assumed.
 */
function memberNoBody(id) {
    const key = String(id ?? '').trim();
    if (!key)
        return null;
    const n = (0, membership_1.memberNoFrom)('', key, null);
    const dash = n.indexOf('-');
    return dash < 0 ? null : n.slice(dash + 1);
}
/**
 * The number as THIS gym's app would print it, for showing back to a member.
 *
 * The prefix comes from the brand label the console knows — the gym's own name
 * — which is what a member whose app has read `my_gym_name()` is looking at. It
 * is never used for matching; see `memberNoBody`.
 */
function memberNoFor(id, brandLabel) {
    const key = String(id ?? '').trim();
    return key ? (0, membership_1.memberNoFrom)('', key, brandLabel ?? null) : null;
}
/** The body shape: nine characters of base-36, uppercase. */
const BODY = /^[0-9A-Z]{9}$/;
/** The whole number: three letters, a hyphen, and a body. */
const NUMBERED = /^[A-Z]{3}-[0-9A-Z]{9}$/;
/**
 * Read what came out of the keyboard or the scanner.
 *
 * Code 39 readers vary in what they hand over: some strip the `*` start and
 * stop characters and some do not, some send a trailing return, and a person
 * typing the number off a phone held up to them will put a space where the
 * hyphen is or leave it out. All of that is the same number and this reads all
 * of it.
 */
function readScan(raw) {
    const v = String(raw ?? '')
        .trim()
        .replace(/^\*+|\*+$/g, '')
        .toUpperCase()
        // A space or an en dash where the hyphen belongs. Not a global strip of
        // whitespace: "Sara Okafor" must stay two words and reach the name search
        // as one.
        .replace(/^([A-Z]{3})[\s‐-―]+([0-9A-Z]{9})$/, '$1-$2')
        .trim();
    if (!v)
        return { shape: 'blank' };
    if (NUMBERED.test(v))
        return { shape: 'numbered', body: v.slice(4) };
    if (BODY.test(v))
        return { shape: 'bare', body: v };
    return { shape: 'text' };
}
/**
 * Every member on the roster, indexed by the body of their number.
 *
 * A list per body rather than one person, because the hash is not unique and
 * pretending it is here is what would silently check in the wrong member.
 */
function indexByMemberNo(people) {
    const out = new Map();
    for (const p of people) {
        const body = memberNoBody(p.id);
        if (!body)
            continue;
        const at = out.get(body);
        if (at)
            at.push(p);
        else
            out.set(body, [p]);
    }
    return out;
}
/**
 * Who is at the desk, given what was typed or scanned.
 *
 * The order of the arms is the order of confidence, and the two that matter are
 * the last two: a number that matches nobody is 'unknown' only when the roster
 * this was checked against was complete. Under any other read state it is
 * 'unsure', which is a different sentence and a different thing for the person
 * at the desk to do.
 */
function findByMemberNo(raw, people, state) {
    const scan = readScan(raw);
    if (scan.shape === 'blank')
        return { kind: 'blank' };
    if (scan.shape === 'text')
        return { kind: 'name' };
    const hits = indexByMemberNo(people).get(scan.body) ?? [];
    if (hits.length === 1)
        return { kind: 'one', person: hits[0] };
    if (hits.length > 1)
        return { kind: 'ambiguous', people: hits };
    // Nine characters that match nobody are far more likely to be a name than a
    // member number, so they go quietly to the name search. A prefixed number is
    // unambiguous, and its failure to match is worth saying out loud.
    if (scan.shape === 'bare')
        return { kind: 'name' };
    return state === 'ready' ? { kind: 'unknown' } : { kind: 'unsure', state };
}
/**
 * The sentence under the search box, or null when there is nothing to say.
 *
 * A sentence per outcome rather than one hedged line. This is read standing up,
 * in about a second, with somebody waiting — and the four it can say send the
 * desk to four different actions: take them, ask which, tell them they are not
 * on the roster, or try again in a moment.
 */
function scanNote(r) {
    switch (r.kind) {
        case 'blank':
        case 'name':
        case 'one':
            return null;
        case 'ambiguous':
            return (`${r.people.length} members share that number, so nobody has been chosen. ` +
                `Pick the right one below, or ask their name.`);
        case 'unknown':
            return ('Nobody on this roster has that number. It is a Repple member number from the ' +
                'member’s own app, not a card number, so check they read it from the right screen.');
        case 'unsure':
            return (r.state === 'failed'
                ? 'The roster did not come back, so this console cannot say whether that number is a member here. It is not a refusal.'
                : r.state === 'partial'
                    ? 'Only part of the roster was read, so a number that matches nobody in it proves nothing. Do not turn anybody away on this.'
                    : 'Still reading the roster, so that number has not been checked against all of it yet.');
    }
}
