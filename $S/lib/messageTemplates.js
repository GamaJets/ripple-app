"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNFILLED_TOKEN_NOTE = exports.MAX_TEMPLATE_TITLE = exports.MAX_TEMPLATE_BODY = exports.STARTERS = exports.TOKENS = exports.COACH_TOKEN = void 0;
exports.startersToOffer = startersToOffer;
exports.templateBlockers = templateBlockers;
exports.applyTemplate = applyTemplate;
exports.hasUnfilledToken = hasUnfilledToken;
exports.templatesEmptyLine = templatesEmptyLine;
exports.orderTemplates = orderTemplates;
exports.nextPosition = nextPosition;
// The six messages a coach types every week.
//
// Welcome, rescheduling, the note before a first session, the note after a
// block finishes, the chase for paperwork, the check-in. A coach with thirty
// clients writes each of them several times a month, from scratch, in a
// composer with no memory — and the cost was measured directly: about an hour
// a week.
//
// ── What this is NOT ──────────────────────────────────────────────────────
//
// It is not automation. Nothing here sends anything, schedules anything or
// fills a thread on the coach's behalf. A template lands IN THE COMPOSER, as
// editable text, and the coach presses send — which is the same rule
// src/lib/nudge.ts holds for AI drafts and supabase/parts/140 holds in the
// database: a message is never composed under somebody else's name, and a
// message the coach did not read before it went is exactly that.
//
// That is why `applyTemplate` returns a string rather than performing a send,
// and why there is no "send to everyone tagged X" here. `bulkThreadNote` in
// src/lib/bulkActions.ts already carries the argument for the segment case.
//
// ── The placeholders, and why an unfilled one stays visible ───────────────
//
// `{name}` is the client's first name and `{coach}` is the coach's. Two tokens
// and no more: every additional one is a thing that can be missing, and a
// template littered with `{sessions_left}` is a template that reads as broken
// the first time somebody has no pack.
//
// An unfilled token comes out as the literal `{name}` rather than as a blank.
// "Hey {name}" is obviously unfinished and gets fixed before it is sent; "Hey ,"
// gets sent. The same convention and the same substitution the AI drafts use —
// `fillName` in src/lib/coachShare.ts — so a coach who has learned it from a
// template recognises it in a draft, and so the model can be told to write a
// placeholder instead of being handed a name.
//
// Pure. The reads and writes are in src/ui/messageTemplates.ts.
const coachShare_1 = require("./coachShare");
const format_1 = require("./format");
exports.COACH_TOKEN = '{coach}';
/** Both tokens, for the "what you can use" line on the editor. */
exports.TOKENS = [
    { token: coachShare_1.NAME_TOKEN, means: 'the client’s first name' },
    { token: exports.COACH_TOKEN, means: 'your own first name' },
];
/**
 * What a coach starts with.
 *
 * ── Why there are starters at all ─────────────────────────────────────────
 *
 * An empty template library is a feature that requires an hour of work before
 * it saves any, and the coaches who would benefit most are the ones with the
 * least hour to spare. These are the six named in the request, written plainly,
 * and every one of them is meant to be edited — the wording is a starting point
 * and not a house style, which is the difference between this and a canned
 * message.
 *
 * They are OFFERED and not inserted. Nothing writes these into a coach's
 * account on their behalf: a library that silently acquired six rows the coach
 * did not write is a library they cannot tell their own work from.
 * `startersToOffer` drops any whose title the coach already has, so a coach who
 * has written their own Welcome is not offered a second one.
 *
 * The voice is deliberately plain and slightly under-written. A template that
 * arrives sounding like marketing gets deleted; one that sounds like a hurried
 * human gets edited and kept.
 */
exports.STARTERS = [
    {
        id: null, position: 100, title: 'Welcome',
        body: 'Hey {name} — really glad to have you on board. I have set up your plan, so have a look in the Train tab when you get a minute and tell me if anything does not look right. Anything you want me to know before we start, just say.',
    },
    {
        id: null, position: 200, title: 'Before Your First Session',
        body: 'Hey {name} — looking forward to our first session. Bring water and something you can move in, get there five minutes early if you can, and eat something light an hour or so before. Let me know if anything is sore or bothering you and I will build around it.',
    },
    {
        id: null, position: 300, title: 'Moving A Session',
        body: 'Hey {name} — I need to move our session. Sorry about the short notice. What does the rest of the week look like for you? Happy to work around whatever suits.',
    },
    {
        id: null, position: 400, title: 'End Of A Block',
        body: 'Hey {name} — that is the block done. You have put real work into it. Have a look back at where you started and let me know how you feel about it, and I will get the next one written for you.',
    },
    {
        id: null, position: 500, title: 'Checking In',
        body: 'Hey {name} — checking in on how the week is going. Anything getting in the way? Even a quick reply helps me keep your plan honest.',
    },
    {
        id: null, position: 600, title: 'Paperwork Still Outstanding',
        body: 'Hey {name} — I still need your form back before we can get going properly. It takes two minutes and it is in the app. Give me a shout if you cannot find it.',
    },
];
/** The starters a coach does not already have, by title, case-insensitively.
 *  Never offers a duplicate of something they have written themselves. */
function startersToOffer(mine) {
    const have = new Set(mine.map((m) => m.title.trim().toLowerCase()));
    return exports.STARTERS.filter((s) => !have.has(s.title.trim().toLowerCase()));
}
/* ── validation ───────────────────────────────────────────────────────────── */
/** Bounded so a paste accident cannot become a template. A message longer than
 *  this is not a template, it is a document, and it would not fit a chat bubble
 *  anybody reads. Mirrors the CHECK constraint on the column. */
exports.MAX_TEMPLATE_BODY = 2000;
exports.MAX_TEMPLATE_TITLE = 60;
/**
 * Every reason this template cannot be saved, in the coach's own words.
 *
 * A list rather than the first failure — the same discipline `receiptBlockers`
 * and `invoiceBlockers` keep: somebody who has left two fields wrong should be
 * told both at once rather than made to press Save twice.
 */
function templateBlockers(t) {
    const out = [];
    const title = String(t.title ?? '').trim();
    const body = String(t.body ?? '').trim();
    if (!title)
        out.push('Give it a name. This is what you will pick it by, in a list of six of them, six months from now.');
    else if (title.length > exports.MAX_TEMPLATE_TITLE)
        out.push(`That name is longer than ${(0, format_1.num)(exports.MAX_TEMPLATE_TITLE)} characters, which is longer than the row it has to fit on.`);
    if (!body)
        out.push('Write the message. A template with nothing in it would put an empty box in your composer.');
    else if (body.length > exports.MAX_TEMPLATE_BODY)
        out.push(`That message is longer than ${(0, format_1.num)(exports.MAX_TEMPLATE_BODY)} characters. A template that long is a document rather than a message, and nobody reads it in a chat bubble.`);
    // Checked rather than silently accepted: `{Name}` and `{ name }` are the two
    // near-misses a person actually types, they look right, and they would be
    // sent to a client verbatim.
    const nearMiss = /\{\s*(name|coach)\s*\}/i.exec(body);
    if (nearMiss && !body.includes(nearMiss[0].toLowerCase().replace(/\s/g, ''))) {
        out.push(`“${nearMiss[0]}” is not one of the placeholders. They are ${coachShare_1.NAME_TOKEN} and ${exports.COACH_TOKEN}, in lower case with no spaces — anything else is sent to your client exactly as it is written.`);
    }
    return out;
}
/* ── using one ────────────────────────────────────────────────────────────── */
/**
 * The template, with the names in.
 *
 * Delegates to `fillName` rather than doing its own replace, so there is one
 * substitution in the coach app and an AI draft and a template cannot end up
 * filling `{name}` differently. An unknown name leaves the token visible — see
 * the header.
 */
function applyTemplate(body, clientName, coachName) {
    return (0, coachShare_1.fillName)(body, clientName, coachName);
}
/** True when this template still has a token in it after filling — which means
 *  a name was not known and the coach is about to send a literal `{name}`. The
 *  composer says so rather than sending it. */
function hasUnfilledToken(text) {
    return text.includes(coachShare_1.NAME_TOKEN) || text.includes(exports.COACH_TOKEN);
}
/** The sentence for that. Sentence case; it goes under the composer. */
exports.UNFILLED_TOKEN_NOTE = 'This still has a placeholder in it, because the name it needed was not known. Type over it before you send — it goes to your client exactly as it appears here.';
/* ── the list, and what an empty one means ────────────────────────────────── */
/**
 * What to say under an empty library.
 *
 * The usual rule, and it earns its place here for a specific reason: a coach
 * who is told they have no templates will write one, and if the read simply
 * failed they now have two of the same template with different wording, in a
 * list they pick from at speed.
 */
function templatesEmptyLine(status) {
    if (status === 'loading')
        return 'Reading your templates…';
    if (status === 'error') {
        return 'Your templates could not be read, so this is not "you have none". Anything you have saved is still on your account — writing a new one now would sit alongside it rather than replace it.';
    }
    if (status === 'partial')
        return 'There are more templates than came back in one request, so this is not all of them.';
    return 'You have no saved messages yet. Save the ones you type every week and they are one tap away in any thread.';
}
/** Sorted the way the picker shows them: by position, then by name so the order
 *  does not shuffle between reads when two share a position. */
function orderTemplates(rows) {
    return [...rows].sort((a, b) => (a.position - b.position) || a.title.localeCompare(b.title));
}
/** The next position, so a new template lands at the end rather than in the
 *  middle of somebody's ordering. */
function nextPosition(rows) {
    if (!rows.length)
        return 100;
    return Math.max(...rows.map((r) => r.position)) + 100;
}
