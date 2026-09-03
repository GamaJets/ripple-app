"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOLLOW_UP_WHEN = exports.FOLLOW_UP_LABEL = exports.MISTYPED_CODE_NOTE = exports.ENQUIRY_IS_ANNOUNCED = exports.FOLLOW_UP_IS_MANUAL = exports.LEAD_STATE_NOTE = exports.LEAD_STATE_LABEL = exports.LEAD_STATES = exports.MAX_FOLLOW_UP = exports.MAX_LEAD_NOTE = exports.MAX_LEAD_CONTACT = exports.MAX_LEAD_NAME = void 0;
exports.contactKind = contactKind;
exports.shapeLeads = shapeLeads;
exports.shapeFollowUps = shapeFollowUps;
exports.leadCountLine = leadCountLine;
exports.leadProblem = leadProblem;
exports.followUpProblem = followUpProblem;
exports.senderName = senderName;
exports.followUpDraft = followUpDraft;
exports.followUpLink = followUpLink;
exports.followUpRecord = followUpRecord;
// An enquiry: somebody who opened a coach's join link and left their details
// without making an account.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// A join code measures CONVERSIONS. src/lib/joinCodes.ts counts who spent one,
// src/lib/codeReturn.ts says what each one cost and returned, src/lib/adMatch.ts
// reads the code out of an ad's destination so none of it has to be mapped by
// hand. Every one of those numbers is about a person who already installed the
// app, already made an account and already decided.
//
// The person who clicked and did not join is in none of them, and there are
// more of those than there are clients. `supabase/parts/157` adds the one
// unauthenticated write that records them; this file is the part of the feature
// that can be reasoned about without a database.
//
// ── The rule this file exists to hold ─────────────────────────────────────
//
// Attribution here is the SAME attribution as ad spend, and deliberately not a
// second one. `attributeLeads` matches an enquiry's `via_code` against the
// coach's own codes exactly as `matchAds` matches an ad's destination: uppercase
// on both sides, an exact string match, and a code that is not one of theirs is
// reported as unknown rather than guessed at. Two attribution rules for the same
// six characters would let a screen say an ad cost £400 for a campaign whose
// enquiries it filed somewhere else.
//
// ── And the rule src/lib/joinCodes.ts already wrote down ──────────────────
//
// A count is the one part of this answer that can be silently wrong, and under
// a failed read the honest output is a dash. A coach shown "0 enquiries" for
// their flyer will conclude the flyer failed and stop printing it, and nothing
// on screen would say the read did not complete. See src/ui/loadStatus.ts — an
// empty list under 'error' means UNKNOWN.
//
// ── What is deliberately absent ───────────────────────────────────────────
//
// There is no send here, no schedule, no template and no sequence. Repple has
// no email channel at all — "Email as a channel" is a separate unbuilt item —
// so a follow-up sequence would be a promise the app cannot keep, and a coach
// would watch a lead sit at "Day 2 of 5" while nothing was ever sent. Following
// one of these up is manual today, and FOLLOW_UP_IS_MANUAL is the sentence the
// screen says so with.
const format_1 = require("./format");
/** Longest name the server stores — leave_my_details truncates past this. */
exports.MAX_LEAD_NAME = 80;
/** Longest contact string the server stores. */
exports.MAX_LEAD_CONTACT = 120;
/** Longest message the server stores. */
exports.MAX_LEAD_NOTE = 500;
/** Longest follow-up note the coach may record against one enquiry. */
exports.MAX_FOLLOW_UP = 1000;
/**
 * The three states, in the order a coach works through them.
 *
 * There is still no 'joined', and there still cannot be. `state` is the COACH'S
 * OWN WORKFLOW — untouched, unwritten by anything but them — and a fourth value
 * in it would be the app deciding where their enquiry had got to.
 *
 * What part 211 added is a different thing on different columns: an EVIDENCED
 * MATCH, where the email somebody typed on the form is the email of an account
 * that later joined through the SAME CODE. That is a fact rather than a guess,
 * it lives on `joined_at` / `joined_via`, and where it is absent nothing at all
 * is claimed. `LeadRow.joined` below carries it and is deliberately three-
 * valued: matched, not matched, and NOT KNOWN — the third being a database
 * without part 211, which must never read as the second.
 */
exports.LEAD_STATES = ['new', 'contacted', 'closed'];
/** Title Case, because these render as the labels on buttons and filters. */
exports.LEAD_STATE_LABEL = {
    new: 'New',
    contacted: 'Contacted',
    closed: 'Closed',
};
/** Sentence case: this is the line under the state, not the state. */
exports.LEAD_STATE_NOTE = {
    new: 'Nobody has reached out yet.',
    contacted: 'You have reached out. What you did is below.',
    closed: 'Finished — whether they joined or not.',
};
/**
 * Said on the screen, above the list, and not softened.
 *
 * This app cannot send an email or a text. A coach who is not told that will
 * assume an enquiry has been acknowledged by something, and the person who
 * left their number will hear nothing at all.
 */
exports.FOLLOW_UP_IS_MANUAL = 'Repple does not contact these people. Nothing has been sent to them and nothing will be — following one of these up is you, in your own phone, today. What you record here is a note to yourself.';
/**
 * That the coach is TOLD one arrived, which is a different promise entirely.
 *
 * R5. Until part 470 a `coach_leads` row was written by an unauthenticated form
 * and sat there until the coach happened to open this screen, so the app was
 * not even telling them there was something to follow up. An enquiry is a
 * person who raised their hand and is at that moment also enquiring with three
 * other coaches.
 *
 * Kept as its OWN sentence rather than folded into `FOLLOW_UP_IS_MANUAL`,
 * which stays literally true and stays on the screen beside it. "You will be
 * told" and "nothing is sent to them" are two facts and a coach who read them
 * as one would believe the enquirer had been acknowledged.
 */
exports.ENQUIRY_IS_ANNOUNCED = 'You are told the moment one of these arrives, on whatever device you are signed in on. The notification carries their name and nothing else — not their number, not what they wrote — because it is drawn on a lock screen.';
/**
 * Said on the form, and repeated here so the app and the web page agree.
 *
 * The server drops an enquiry whose code resolves to nobody, because a row with
 * no coach is a row nobody can read, act on or erase. That is the right trade
 * against an unauthenticated write path, and it has a cost a coach should know
 * about: a mistyped code is an enquiry neither of you will ever see.
 */
exports.MISTYPED_CODE_NOTE = 'An enquiry only reaches you if the link carried one of your codes. Somebody who retyped it wrong is not held anywhere — there is no coach to give them to.';
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/**
 * What somebody typed to be reached on: an email, a phone number, or neither.
 *
 * ONE field on the form and one column in the database, because this product
 * cannot send an email — a column called `email` would be the first half of a
 * promise — and because half the people who fill in a coach's form would rather
 * be texted anyway. So the kind is read back out of the string here, where it
 * can be asserted on, instead of being asked for on the form.
 *
 * 'unknown' is a real answer and is never guessed away. An Instagram handle, a
 * WhatsApp name and a typo all land there, and the screen shows the string as
 * typed with no tel: or mailto: on it — offering to dial something that is not
 * a number is worse than offering nothing, because the coach finds out after
 * they have tapped it.
 *
 * Email is tested first: '+44 7700 900123' contains no '@', and
 * 'joe+ads@x.com' contains digits and a '+' and would read as a phone number
 * under a looser order.
 */
function contactKind(v) {
    const s = String(v ?? '').trim();
    if (!s)
        return 'unknown';
    // Deliberately not RFC 5322. The question is "can this be handed to a mail
    // app", and the shape that answers it is: something, one @, something with a
    // dot in it, no spaces.
    if (/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s))
        return 'email';
    // A phone number as people write them: an optional leading +, then digits
    // with spaces, dashes, dots or brackets between them. Seven digits is the
    // shortest real subscriber number; more than fifteen is not a number under
    // E.164 and is usually somebody's account id.
    const digits = s.replace(/\D/g, '');
    if (/^\+?[\d\s().-]+$/.test(s) && digits.length >= 7 && digits.length <= 15)
        return 'phone';
    return 'unknown';
}
/** Rank for sorting: what still needs doing, first. */
const stateRank = (s) => (s === 'new' ? 0 : s === 'contacted' ? 1 : 2);
const asState = (v) => v === 'contacted' || v === 'closed' ? v : 'new';
/**
 * Raw rows → rows worth rendering, in the order they should be worked through.
 *
 * New first, then contacted, then closed; newest first inside each. A coach
 * opens this screen to find out who is waiting on them, and burying a person
 * who enquired this morning under three months of closed enquiries is the same
 * failure as burying the drift figure on the Clients tab — the list is only
 * worth having if the thing to do next is at the top of it.
 *
 * A row with no id, no name or no contact is DROPPED rather than drawn blank.
 * The database constrains all three to be non-empty, so this cannot happen off
 * a healthy read; a blank line under the word "enquiries" is a coach ringing
 * nobody, and a row with no id cannot be marked, noted or erased afterwards.
 *
 * `codes` is the coach's own list, in `matchAds`'s shape, so the same
 * uppercase-exact rule attributes an enquiry and an ad. Passing an empty list
 * because the codes read FAILED would name every campaign null; that is why
 * the caller gates on the codes' status and not only on the leads'.
 */
function shapeLeads(rows, codes) {
    const byCode = new Map();
    for (const c of codes || []) {
        const code = String(c?.code ?? '').trim().toUpperCase();
        if (code)
            byCode.set(code, c.label || code);
    }
    const out = [];
    for (const r of rows || []) {
        const id = String(r?.id ?? '').trim();
        const name = clean(r?.name, exports.MAX_LEAD_NAME);
        const contact = clean(r?.contact, exports.MAX_LEAD_CONTACT);
        if (!id || !name || !contact)
            continue;
        const viaCode = String(r?.via_code ?? '').trim().toUpperCase();
        out.push({
            id,
            name,
            contact,
            contactKind: contactKind(contact),
            note: clean(r?.note, exports.MAX_LEAD_NOTE) || null,
            viaCode,
            campaign: byCode.get(viaCode) ?? null,
            at: r?.at ?? null,
            state: asState(r?.state),
            // `'joined_at' in r` and not `r.joined_at != null`. The two differ in
            // exactly the case that matters: a database without part 211 sends no such
            // key at all, and treating its absence as a null VALUE would be the app
            // saying "no match" about every enquiry ever left. Present-and-null is a
            // real answer; absent is not an answer.
            joined: r && typeof r === 'object' && 'joined_at' in r ? r.joined_at != null : null,
            joinedAt: (r?.joined_at ?? null) || null,
        });
    }
    return out.sort((a, b) => {
        const rs = stateRank(a.state) - stateRank(b.state);
        if (rs !== 0)
            return rs;
        const at = a.at ? Date.parse(a.at) : NaN;
        const bt = b.at ? Date.parse(b.at) : NaN;
        const av = Number.isFinite(at);
        const bv = Number.isFinite(bt);
        // A row with no readable timestamp sorts last within its state rather than
        // to the top: Date.parse gives NaN, every comparison against NaN is false,
        // and a sort that leaves those wherever they landed reorders the list
        // between two reads of the same data.
        if (av !== bv)
            return av ? -1 : 1;
        if (av && bv && at !== bt)
            return bt - at;
        return a.id.localeCompare(b.id);
    });
}
/** Follow-up rows → what is safe to render, newest first. */
function shapeFollowUps(rows) {
    const out = [];
    for (const r of rows || []) {
        const id = String(r?.id ?? '').trim();
        const body = String(r?.body ?? '').trim().slice(0, exports.MAX_FOLLOW_UP);
        if (!id || !body)
            continue;
        out.push({ id, body, at: r?.at ?? null });
    }
    return out.sort((a, b) => {
        const at = a.at ? Date.parse(a.at) : NaN;
        const bt = b.at ? Date.parse(b.at) : NaN;
        const av = Number.isFinite(at);
        const bv = Number.isFinite(bt);
        if (av !== bv)
            return av ? -1 : 1;
        if (av && bv && at !== bt)
            return bt - at;
        return a.id.localeCompare(b.id);
    });
}
/**
 * The line under the heading. Sentence case, and it states no figure it cannot
 * stand behind.
 *
 * 'partial' is possible here in a way it is not for `my_join_codes()`: this is
 * an ordinary table read through PostgREST, which stops at 1,000 rows and says
 * nothing (see src/lib/rowCap.ts). A coach with a busy campaign really can pass
 * that, and a count taken off a truncated page would be a subtotal printed as a
 * total. So 'partial' states the shown figure as a floor and never as the
 * answer.
 */
function leadCountLine(status, rows) {
    if (status === 'loading')
        return 'Counting who has been in touch…';
    if (status === 'error') {
        return 'Your enquiries could not be read, so nothing here is a count. This is not an empty inbox.';
    }
    const waiting = rows.filter((r) => r.state === 'new').length;
    const joined = rows.filter((r) => r.joined === true).length;
    if (status === 'partial') {
        return `More enquiries came back than could be read in one go. ${(0, format_1.num)(rows.length)} of them are below and there are more — this is not the whole list, and no figure on this screen is a total.`;
    }
    if (rows.length === 0) {
        return 'Nobody has left their details yet. Your join link carries the form — share it and enquiries land here.';
    }
    const total = `${(0, format_1.num)(rows.length)} ${rows.length === 1 ? 'enquiry' : 'enquiries'}`;
    // The conversion count is added only when there IS one. "0 became clients" is
    // a figure a coach reads as a verdict on their own marketing, and on a
    // database without part 211 every row's `joined` is null and the count would
    // be zero for a reason that has nothing to do with the marketing.
    const became = joined ? ` ${(0, format_1.num)(joined)} of them became clients.` : '';
    return (waiting ? `${total} · ${(0, format_1.num)(waiting)} waiting on you.` : `${total}, all of them dealt with.`) + became;
}
/**
 * Why this enquiry cannot be submitted, or null if it can.
 *
 * The web form at web/join.html enforces the same two rules and states the same
 * two limits, and it has to: `leave_my_details` returns void for every input it
 * is ever given — a blank name and a good one are indistinguishable outcomes on
 * purpose, because a function that answers differently for different inputs is
 * an oracle over join codes. See supabase/parts/157. That makes the client the
 * ONLY place a person can be told they left the name blank, which is why the
 * rules live in a pure module rather than inline in a page.
 */
function leadProblem(name, contact) {
    const nm = String(name ?? '').trim();
    const ct = String(contact ?? '').trim();
    if (!nm)
        return 'Put in a name, so the coach knows who is asking.';
    if (nm.length > exports.MAX_LEAD_NAME)
        return `Keep the name to ${exports.MAX_LEAD_NAME} characters or fewer.`;
    if (!ct)
        return 'Put in an email address or a phone number, or the coach has no way to answer.';
    if (ct.length > exports.MAX_LEAD_CONTACT)
        return `Keep that to ${exports.MAX_LEAD_CONTACT} characters or fewer.`;
    if (contactKind(ct) === 'unknown') {
        return 'That does not look like an email address or a phone number. The coach will reply to whatever you put here, so it has to be something they can reach you on.';
    }
    return null;
}
/**
 * Why this follow-up note cannot be saved, or null if it can.
 *
 * Blank is refused rather than saved as an empty row: the record is the point,
 * and an empty record of a phone call is worse than no record, because it looks
 * from the list like the call was written up.
 */
function followUpProblem(body) {
    const b = String(body ?? '').trim();
    if (!b)
        return 'Write what you did, so the next time you open this you know where it got to.';
    if (b.length > exports.MAX_FOLLOW_UP)
        return `Keep it to ${exports.MAX_FOLLOW_UP} characters or fewer.`;
    return null;
}
/** Title Case — these are the labels on the buttons. */
exports.FOLLOW_UP_LABEL = {
    first: 'Draft a First Reply',
    second: 'Draft a Second Try',
    last: 'Draft a Last Word',
};
/** Sentence case — the line under the button, so a coach picks the right one
 *  rather than the first one. */
exports.FOLLOW_UP_WHEN = {
    first: 'the day they get in touch. The one that matters most.',
    second: 'a few days later, when the first went unanswered.',
    last: 'once, and then leave them alone. It closes the door politely.',
};
/** The coach's own first name, for signing off, or null. First word only and
 *  never a fragment of an email address or a bare uuid — the same rule
 *  `greetingName` in src/lib/nudge.ts keeps, and for the same reason: a message
 *  signed "7f3a9c21" is worse than one signed with nothing. */
function senderName(name) {
    const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
    if (!first)
        return null;
    if (first.includes('@'))
        return null;
    if (/^[0-9a-f-]{8,}$/i.test(first))
        return null;
    if (!/[A-Za-zÀ-ÿ]/.test(first))
        return null;
    return first;
}
/** Their given name, for the greeting. Same rule, applied to what they typed on
 *  a form — where "Mr Smith" and "sarah" are both ordinary. */
function theirName(name) {
    return senderName(name);
}
/**
 * The draft.
 *
 * `business` is the coach's own trading name where they have set one, and their
 * own name otherwise. It is NEVER this app's brand: the coach is writing as
 * themselves and a prospect who has never heard of the software should not meet
 * its name in the first sentence. Null is handled by simply not naming a
 * business, which reads perfectly well.
 */
function followUpDraft(kind, lead, coachName, business) {
    const who = theirName(lead.name);
    const me = senderName(coachName);
    const hi = who ? `Hi ${who},` : 'Hi,';
    const sign = me ? `\n\n${me}` : '';
    const trading = (business || '').trim();
    // Only where they actually left one. "Thanks for your message" said to
    // somebody who left a name and a number and nothing else is the app inventing
    // a message they did not write.
    const theirs = lead.note ? '\n\nYou mentioned: ' + lead.note.trim() : '';
    const from = trading ? ` at ${trading}` : '';
    if (kind === 'first') {
        return {
            subject: 'About your message',
            body: `${hi}\n\nThanks for getting in touch${from} — I saw your enquiry and wanted to reply myself.${theirs}`
                + `\n\nWhat are you hoping to get out of training at the moment? Once I know that I can tell you`
                + ` honestly whether I am the right person for it.${sign}`,
        };
    }
    if (kind === 'second') {
        return {
            subject: 'Following up',
            body: `${hi}\n\nI wrote a few days ago about your enquiry${from} and I know how easily these get buried.`
                + `\n\nIf you are still thinking about it, tell me what you are training for and I will come back with`
                + ` something specific. If the timing is wrong, that is a fine answer too.${sign}`,
        };
    }
    return {
        subject: 'Leaving you to it',
        body: `${hi}\n\nI have not heard back, so I will stop writing — nobody needs another inbox to clear.`
            + `\n\nIf you want to pick it up later, reply to this and I will still be here.${sign}`,
    };
}
/** URL-encode for a mailto/sms query, including the characters
 *  `encodeURIComponent` leaves alone but a mail app treats as separators. */
const q = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
/**
 * A phone number as typed, reduced to something a dialler will accept.
 *
 * Three things happen and each is a real number a coach has in their list:
 *
 *   · A PARENTHESISED TRUNK PREFIX is dropped when the number is
 *     international. `+44 (0)7700 900123` is the ordinary British way of
 *     writing a number that is dialled as `+447700900123` from abroad and
 *     `07700 900123` at home — the bracketed zero is explicitly the digit you
 *     do NOT dial with the country code. Keeping it produces `+4407700900123`,
 *     which is not a number anywhere, and the message silently fails to send.
 *     Only applied to a `+` number: `(0161) 496 0000` is a UK area code and
 *     every digit of it is dialled.
 *   · Everything that is not a digit goes, brackets and spaces included. An
 *     `sms:` URL carrying them fails to open at all on some Android builds, and
 *     a button that does nothing is indistinguishable from a broken app.
 *   · A `+` survives only in the first position. A stray one mid-string is a
 *     typo or an extension marker and a dialler will refuse the whole string.
 */
function dialable(raw) {
    const s = raw.trim();
    const intl = s.startsWith('+');
    const body = intl ? s.slice(1).replace(/\(\s*\d+\s*\)/g, '') : s;
    const digits = body.replace(/\D/g, '');
    if (!digits)
        return '';
    return intl ? '+' + digits : digits;
}
/**
 * The link that opens the coach's own mail or messages app with the draft in
 * it, or null when there is nothing to open it with.
 *
 * Null for a contact this app could not read as an email or a phone number, and
 * that refusal is the whole reason `contactKind` returns 'unknown' rather than
 * guessing: offering to dial an Instagram handle is worse than offering
 * nothing, because the coach finds out after they have tapped it.
 *
 * A phone number is stripped to digits and a leading `+` — an `sms:` URL with
 * brackets and spaces in it silently fails to open on some Android builds, and
 * a button that does nothing is indistinguishable from an app that is broken.
 *
 * The SMS body is carried on `?body=`, which iOS and Android both honour and
 * which is ignored rather than shown as text where they do not.
 */
function followUpLink(lead, draft) {
    const to = String(lead.contact ?? '').trim();
    if (!to)
        return null;
    if (lead.contactKind === 'email') {
        return `mailto:${q(to)}?subject=${q(draft.subject)}&body=${q(draft.body)}`;
    }
    if (lead.contactKind === 'phone') {
        const digits = dialable(to);
        if (!digits)
            return null;
        return `sms:${digits}?body=${q(draft.body)}`;
    }
    return null;
}
/**
 * The follow-up note to record after the coach sends one, pre-filled.
 *
 * A record of what was actually done is the whole of what this screen keeps,
 * and a coach who has just opened their mail app is exactly the person who will
 * not come back and type one. The note names WHICH draft was opened, because
 * "wrote to them" three times in a row tells nobody which stage it reached.
 *
 * It is a starting point and not a claim: the coach may have edited the draft
 * to nothing, or closed the mail app without sending. The wording says
 * "opened", which is the only thing this app actually observed.
 */
function followUpRecord(kind, channel) {
    const which = kind === 'first' ? 'first reply' : kind === 'second' ? 'second try' : 'last word';
    return `Opened the ${which} as ${channel === 'email' ? 'an email' : 'a text'} from my own phone.`;
}
