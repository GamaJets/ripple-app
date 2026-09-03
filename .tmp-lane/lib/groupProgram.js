"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.programSignature = programSignature;
exports.memberState = memberState;
exports.groupCoverage = groupCoverage;
exports.planFanOut = planFanOut;
exports.listNames = listNames;
exports.fanOutSubject = fanOutSubject;
exports.versionOf = versionOf;
exports.memberVersions = memberVersions;
exports.versionSpread = versionSpread;
exports.behindNote = behindNote;
exports.bespokeNote = bespokeNote;
const programBlock_1 = require("./programBlock");
const overwriteGuard_1 = require("./overwriteGuard");
const injuryGate_1 = require("./injuryGate");
/**
 * A stable fingerprint of what a programme actually asks somebody to DO.
 *
 * Days, their focus and cardio, and each exercise's name, sets and reps —
 * deliberately not `note`, `focus[]`, `alternatives` or the exercise `key`.
 * Those are rewritten in transit: the builder stamps its own `focus` and
 * blanks `alternatives` on every assign, and keys are regenerated as
 * `${day}-${index}`. Comparing them would report a client as being on
 * something different from the group when the sessions in front of them are
 * identical, which is a false alarm on the one screen whose job is to tell the
 * coach who is off-plan.
 *
 * The corollary is worth stating: two programmes with the same sessions and
 * different prose read as the same programme here. That is the intended
 * reading of "is Priya on the bootcamp programme".
 *
 * Null in, null out — a group that has not been given a programme has no
 * fingerprint, rather than the fingerprint of an empty one.
 */
function programSignature(p) {
    if (!p)
        return null;
    const days = daySignature(p.days ?? []);
    const base = `${(p.title ?? '').trim().toLowerCase()}::${days}`;
    // ── weeks two onward, and why they are APPENDED rather than folded in ───
    //
    // A programme is one week unless the coach wrote more (see
    // src/lib/programBlock.ts). Once it can be twelve, a signature over week one
    // alone says two eight-week blocks that share a Monday are the same
    // programme — so a coach who fixed week six and re-fanned it out would be
    // told everybody was already on it, which is the one sentence this whole
    // module exists to get right.
    //
    // `weeksSignaturePart` returns null for a ONE-WEEK programme, and that is
    // load-bearing rather than tidy. Every programme in `program_templates`,
    // every `assigned_programs` row and every group's own plan is one week
    // today, and a signature that changed shape for all of them would have
    // reported every member of every group as 'diverged' on the morning this
    // shipped — a screenful of false alarms on the one screen whose job is to
    // say who is off-plan. Absent weeks therefore fingerprint byte-for-byte as
    // they did before.
    const extra = (0, programBlock_1.weeksSignaturePart)(p, daySignature);
    return extra == null ? base : `${base}::w${extra}`;
}
/**
 * The part of the fingerprint that covers a list of days. Split out of
 * `programSignature` so weeks two onward are compared by exactly the same rule
 * as week one — a second spelling of this loop is a second chance for week four
 * to be judged on its cardio while week one is not.
 */
function daySignature(days) {
    return (days ?? []).map((d) => [
        d.day,
        (d.focus ?? '').trim().toLowerCase(),
        (d.cardio ?? '').trim().toLowerCase(),
        (d.exercises ?? []).map((e) => `${(e.name ?? '').trim().toLowerCase()}|${e.sets}|${(e.reps ?? '').trim().toLowerCase()}`).join(','),
    ].join('~')).join('//');
}
/**
 * Where one member stands, given how the read of `assigned_programs` went.
 *
 * `programStatus` is asked FIRST and answers for everything. Under anything
 * but a whole read, a null programme means "we did not find out" — so a member
 * is 'unknown', never 'none'. Rendering them as "not assigned yet" is how a
 * coach comes to assign over a programme they never saw.
 *
 * When the group itself has no programme (`groupSig` null) there is nothing to
 * be on, so a member with a programme is 'diverged' — on something that is not
 * the group's — and a member without one is 'none'. Both are true sentences.
 */
function memberState(programStatus, groupSig, assigned) {
    if (programStatus !== 'ready')
        return 'unknown';
    const sig = programSignature(assigned);
    if (sig === null)
        return 'none';
    if (groupSig !== null && sig === groupSig)
        return 'on';
    return 'diverged';
}
/** The at-a-glance line: who has it and who does not. */
function groupCoverage(states, membershipStatus, programStatus) {
    const c = {
        on: 0, diverged: 0, none: 0, unknown: 0, total: states.length,
        countable: membershipStatus === 'ready' && programStatus === 'ready',
    };
    for (const s of states)
        c[s] += 1;
    return c;
}
const NOTHING = (label, reason) => ({ allowed: false, label, reason, heldNote: null, send: [], blocked: [] });
/**
 * What would happen if the coach tapped Assign right now.
 *
 * `listStatus` is how the read of the LIST OF PEOPLE went. For a group that is
 * the membership read, and it is load-bearing: a group whose membership came
 * back short is not a smaller group, and assigning to the four names that
 * arrived out of eight leaves four people on last month's programme with
 * nothing anywhere saying so. For a hand-made tick-list — the bulk assign in
 * the template library — the coach chose the names themselves and there is no
 * read of the list to have failed, so the caller passes 'ready'.
 *
 * `programStatus` is how the read of `assigned_programs` went, and goes to the
 * overwrite guard: this writes over whatever each of them is currently on.
 */
function planFanOut(listStatus, programStatus, members, hasProgram, subject) {
    // Asked before anything else, because every question below is asked ABOUT
    // this list. A short or unread list makes the per-client checks below
    // meaningless: they would all pass, for the people who happened to arrive.
    if (listStatus === 'loading') {
        return NOTHING('Checking Who Is In This Group…', 'Still reading who is in this group. Assigning now could reach only the people who have loaded so far.');
    }
    if (listStatus === 'partial') {
        return NOTHING('Cannot assign to part of a group', 'Only part of this group came back, so this screen cannot tell you who is in it. Assigning would send the programme to the people who happened to load and leave the rest on what they are on, with nothing saying which was which.');
    }
    if (listStatus === 'error') {
        return NOTHING('Cannot assign to an unread group', 'Who is in this group could not be read. An empty list here means the read failed, not that the group is empty, so the assign is held until it loads.');
    }
    // Writing over somebody's training without having read it is the thing the
    // overwrite guard exists for, and one tap here is as many overwrites as
    // there are members.
    const over = (0, overwriteGuard_1.guardOverwrite)(programStatus, subject);
    if (!over.allowed)
        return NOTHING(over.label, over.reason);
    if (!hasProgram) {
        return NOTHING('Pick a Programme First', 'This group has no programme yet. Choose one from your library and it can go out to everybody in the group at once.');
    }
    if (!members.length) {
        return NOTHING('Nobody In This Group Yet', 'Add the clients who should be on this programme, then assign it to all of them at once.');
    }
    const send = [];
    const blocked = [];
    for (const m of members) {
        // Per client, every time. The whole hazard of a bulk assign is that this
        // is the check somebody moves outside the loop.
        const gate = (0, injuryGate_1.guardInjuries)(m.disclosures, m.ackStatus, m.injuries, m.acknowledged, m.name);
        if (gate.allowed)
            send.push(m.clientId);
        else
            blocked.push({ clientId: m.clientId, name: m.name, label: gate.label, reason: gate.reason });
    }
    if (!send.length) {
        return {
            allowed: false,
            label: blocked.length === 1 ? (blocked[0].label) : 'Read Their Injuries First',
            reason: blocked.length === 1
                ? blocked[0].reason
                : `Every client in this group is held: ${listNames(blocked.map((b) => b.name))}. Open each of them and read what they have disclosed, then this can go out.`,
            heldNote: null,
            send: [],
            blocked,
        };
    }
    return {
        allowed: true,
        label: blocked.length ? `Assign to ${send.length} of ${members.length}` : null,
        reason: null,
        heldNote: blocked.length
            ? `${listNames(blocked.map((b) => b.name))} ${blocked.length === 1 ? 'is' : 'are'} held and will NOT be assigned — they have disclosed injuries this screen cannot confirm you have read. Everyone else gets it now; open them individually when you have.`
            : null,
        send,
        blocked,
    };
}
/** "Priya", "Priya and Sam", "Priya, Sam and Alex" — never a bare join, because
 *  the coach is being told who is about to be left out. */
function listNames(names) {
    if (!names.length)
        return '';
    if (names.length === 1)
        return names[0];
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
/** The noun phrase the overwrite guard puts in its sentence. Written here so
 *  the group screen and the template library say the same thing. */
function fanOutSubject(count) {
    return count === 1
        ? 'the programme this client is currently on'
        : 'the programmes these clients are currently on';
}
/**
 * Which stored version a member's actual programme is, or null for none of
 * them.
 *
 * Null is the interesting answer and it is not a failure: it is the client with
 * the shoulder, on a Thursday their coach rewrote for them. Told apart from
 * "an older version" by the screen, because the two need opposite actions —
 * one is a re-send, the other must not be re-sent at all.
 *
 * The NEWEST matching version wins where two versions fingerprint the same,
 * which happens when a coach changes the programme and changes it back. Saying
 * "they are on version 1" about somebody holding a programme identical to
 * version 3 would send the coach off to re-assign something they already have.
 */
function versionOf(versions, assigned) {
    const sig = programSignature(assigned);
    if (sig == null)
        return null;
    let best = null;
    for (const v of versions) {
        if (v.signature != null && v.signature === sig && (best == null || v.version > best))
            best = v.version;
    }
    return best;
}
/**
 * Where every member stands, by version.
 *
 * `current` is the version number of the group's programme as it stands now —
 * `versions[versions.length - 1].version` in practice, passed in rather than
 * assumed so a caller that has read a truncated version list cannot silently
 * name the wrong one as current.
 *
 * `behind` is false under anything but a whole read of `assigned_programs`,
 * because it is a claim about what a specific person is training and the offer
 * beside it is a write over it. `memberState` already collapses to 'unknown'
 * there; this makes the consequence explicit rather than depending on it.
 */
function memberVersions(programStatus, versions, current, members, groupSig) {
    return members.map((m) => {
        const state = memberState(programStatus, groupSig, m.assigned);
        const version = state === 'unknown' || state === 'none' ? null : versionOf(versions, m.assigned);
        return {
            clientId: m.clientId,
            state,
            version,
            behind: state === 'diverged' && version != null && current != null && version < current,
        };
    });
}
function versionSpread(rows, membershipStatus, programStatus, current) {
    const out = {
        onCurrent: 0, behind: 0, bespoke: 0, none: 0, unknown: 0,
        countable: membershipStatus === 'ready' && programStatus === 'ready',
    };
    for (const r of rows) {
        if (r.state === 'unknown')
            out.unknown += 1;
        else if (r.state === 'none')
            out.none += 1;
        else if (r.state === 'on' || (r.version != null && current != null && r.version === current))
            out.onCurrent += 1;
        else if (r.behind)
            out.behind += 1;
        else
            out.bespoke += 1;
    }
    return out;
}
/**
 * The sentence offering a re-send, or null when there is nothing to offer.
 *
 * Null rather than a cheerful "everybody is up to date": that sentence would be
 * printed over an unread `assigned_programs` as readily as over a whole one,
 * and the caller's own status branch already says when nothing is known.
 *
 * Names the people rather than counting them. A coach about to overwrite three
 * clients' training is entitled to read the three names before they tap, which
 * is the rule the whole of `planFanOut` above is built on.
 */
function behindNote(rows, names, spread) {
    if (!spread.countable)
        return null;
    const behind = rows.filter((r) => r.behind);
    if (!behind.length)
        return null;
    const who = listNames(behind.map((r) => names(r.clientId)));
    return `${who} ${behind.length === 1 ? 'is' : 'are'} on an earlier version of this programme. Sending it again replaces what ${behind.length === 1 ? 'they are' : 'they are'} training with the current one.`;
}
/**
 * The bespoke members, named, so the coach can see who a re-send would UNDO.
 *
 * Deliberately its own sentence and not part of `behindNote`. These two lists
 * need opposite actions and a single paragraph mentioning both is a paragraph
 * where the second half is skimmed — and the half being skimmed here is the one
 * where a coach silently reverts the modification they made for somebody's
 * shoulder.
 */
function bespokeNote(rows, names, spread) {
    if (!spread.countable)
        return null;
    const bespoke = rows.filter((r) => r.state === 'diverged' && !r.behind);
    if (!bespoke.length)
        return null;
    const who = listNames(bespoke.map((r) => names(r.clientId)));
    return `${who} ${bespoke.length === 1 ? 'is' : 'are'} on a programme that is not any version of this one — someone edited ${bespoke.length === 1 ? 'their' : 'their'} copy. Assigning to the whole group would overwrite that.`;
}
