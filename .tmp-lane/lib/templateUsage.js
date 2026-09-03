"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateUsage = templateUsage;
// Which of a coach's saved programmes anybody is actually training.
//
// ── The gap ────────────────────────────────────────────────────────────────
//
// app/(trainer)/templates.tsx lists a coach's library and every row says the
// same three things: a name, a day count and an exercise count. After a year of
// coaching that list is twenty rows deep and none of them carries the one fact
// that would tell a coach which to open — whether anybody is on it.
//
// The library screen already holds everything needed to answer that and used
// none of it. `useProgramTemplates` gives the templates. `useAssignedPrograms`
// gives every client's programme, because the same screen needs it to say whose
// training a bulk assign is about to replace. Nothing new is read here and
// nothing new is asked of the database.
//
// ── Why an assignment can be matched to a template at all ─────────────────
//
// It cannot be matched by id: `assignProgramTo` writes a jsonb COPY of the
// programme with no reference back, and the builder's own delete confirmation
// says so — "an assignment is a copy, not a link back to this". There is no
// foreign key anywhere pointing at `program_templates` and adding one would be
// wrong, because a coach who deletes a template has not taken anybody off the
// programme they are training.
//
// So it is matched by CONTENT, through `programSignature` — the same
// fingerprint src/lib/groupProgram.ts uses to answer "is Priya on the bootcamp
// programme", byte for byte, including weeks two onward. Two programmes with
// the same sessions and different prose are the same programme, which is the
// intended reading of that question and is the intended reading of this one.
//
// ── The three answers, and why only two are counted ───────────────────────
//
// ON IT — the client's programme fingerprints identically to the template.
// FROM IT — the client's programme carries the template's TITLE and different
//   training. That is what a coach gets by loading a template into the builder,
//   changing a movement for one person's shoulder, and assigning it. Counted
//   separately and never added to the first: "six on it" and "six on it, two on
//   their own version of it" are different sentences about a coach's book.
// NEITHER — everybody else. Not reported per template, because "forty of your
//   clients are not on this template" is not a fact anybody needs.
//
// ── What this is NOT ──────────────────────────────────────────────────────
//
// It is not a measure of whether a programme WORKED. Nothing here reads a
// session, an adherence figure or a completion, and a count of who is on
// something is not a count of who is finishing it. The wording every sentence
// in here uses is "training", present tense, about right now — because that is
// the only thing these two reads can honestly support, and a library row that
// implied twelve people had completed a block would be a claim made out of an
// assignment table.
//
// ── And why it is withheld under anything but a whole read ────────────────
//
// `getProgram` returns null both for a client who is on nothing and for a
// client whose row did not come back. That is the exact trap the templates
// screen's own header warns about for its bulk assign, and a count built over
// it under 'error' would read "nobody is on this" about a library a coach has
// twelve people training. Under anything but 'ready' there is no number at all
// and there is a sentence saying why.
//
// Pure and framework-free.
const groupProgram_1 = require("./groupProgram");
const EMPTY = { on: [], from: [], line: null };
/** The title a programme was saved under, folded for comparison. Empty when it
 *  has none — and an empty title matches nothing, because "every untitled
 *  programme came from this untitled template" is not a claim about anything. */
const titleKey = (p) => String(p?.title ?? '').trim().toLowerCase();
const people = (n) => `${n} ${n === 1 ? 'client' : 'clients'}`;
/**
 * Count who is on each saved programme.
 *
 * `programs` is the map the screen already holds — client id to the programme
 * the server says they are on. `status` is that read's own status and it
 * governs everything: under anything but a whole read the counts are not
 * computed at all rather than computed and hidden, so there is no number
 * anywhere in the returned value for a later change to start rendering.
 */
function templateUsage(templates, programs, status) {
    const list = Array.isArray(templates) ? templates : [];
    const byId = {};
    if (status !== 'ready') {
        for (const tpl of list)
            byId[tpl.id] = EMPTY;
        return {
            byId,
            withheld: status === 'loading'
                ? 'Still reading who is training what, so no template says how many people are on it yet.'
                : status === 'partial'
                    ? 'More clients are on programmes than could be read in one request, so no template says how many people are on it. A count over part of your book is a wrong number, not a small one.'
                    : 'Who is training what could not be read, so no template says how many people are on it. Nothing here is a statement that your templates are unused.',
        };
    }
    // One pass over the book rather than one per template: a coach with a
    // hundred clients and twenty templates would otherwise fingerprint two
    // thousand programmes on every render of the library.
    const bySig = new Map();
    const byTitle = new Map();
    for (const [clientId, program] of Object.entries(programs ?? {})) {
        if (!program)
            continue;
        const sig = (0, groupProgram_1.programSignature)(program);
        if (sig !== null) {
            const seen = bySig.get(sig);
            if (seen)
                seen.push(clientId);
            else
                bySig.set(sig, [clientId]);
        }
        // Indexed under whatever title it carries, EMPTY INCLUDED. The decision
        // about an untitled programme is made once, below, where the template's own
        // title is read — two guards for one rule is one of them being wrong later.
        const title = titleKey(program);
        const seen = byTitle.get(title);
        if (seen)
            seen.push(clientId);
        else
            byTitle.set(title, [clientId]);
    }
    for (const tpl of list) {
        const sig = (0, groupProgram_1.programSignature)(tpl.program);
        const on = sig === null ? [] : (bySig.get(sig) ?? []).slice();
        // An UNTITLED template claims nobody. "Every untitled programme in your
        // book came from this untitled template" is not a claim about anything, and
        // a title is the only thread between a saved programme and the copy of it a
        // coach edited for one person's shoulder.
        const title = titleKey(tpl.program);
        // Everybody under the same title who is NOT on it exactly. `on` is the
        // subset, so this is a difference and never a second count of the same
        // person — a coach reading "6 on it, 6 on their own version" about six
        // people would stop believing either figure.
        const onSet = new Set(on);
        const from = title ? (byTitle.get(title) ?? []).filter((id) => !onSet.has(id)) : [];
        byId[tpl.id] = { on, from, line: usageLine(on.length, from.length) };
    }
    return { byId, withheld: null };
}
/**
 * The sentence under a library row.
 *
 * Present tense and "training", never "completed" or "finished": the read
 * behind it says who is on something today and says nothing at all about
 * whether anybody got to the end of it.
 */
function usageLine(on, from) {
    if (!on && !from)
        return null;
    if (on && from) {
        return `${people(on)} training this now, and ${from} on ${from === 1 ? 'an edited copy' : 'edited copies'} of it.`;
    }
    if (on)
        return `${people(on)} training this now.`;
    return `${people(from)} on ${from === 1 ? 'an edited copy' : 'edited copies'} of this, and nobody on it as saved.`;
}
