"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACH_THREAD_KEPT_NOTE = exports.THREAD_KEPT_NOTE = exports.WITHDRAWN_THREAD_NOTE = exports.THREAD_CAP = exports.coachChatKey = exports.COACH_CHAT_PREFIX = void 0;
exports.readThread = readThread;
exports.trimThread = trimThread;
exports.writeThread = writeThread;
exports.threadForConsent = threadForConsent;
/** Where one account's one thread lives. Versioned like every other stored blob
 *  in this app, so a shape change cannot be read as a corrupt one. */
exports.COACH_CHAT_PREFIX = 'coachchat:v1:';
/** Per account AND per side. Both halves are load-bearing; the header says why
 *  the second one is not decoration. */
const coachChatKey = (uid, side) => `${exports.COACH_CHAT_PREFIX}${uid}:${side}`;
exports.coachChatKey = coachChatKey;
/**
 * How many messages one thread keeps.
 *
 * There is a number here for the same reason `OUTBOX_CAP` has one and for one
 * more. AsyncStorage on Android is a SQLite row per key, and a thread nothing
 * trims is a row that grows for the life of the install. The extra reason is
 * the subject: this is health material, so the honest amount to keep is the
 * amount that is still useful to the person, not the amount the disk will take.
 * Forty is twenty exchanges — a fortnight of ordinary use, and more context
 * than anybody scrolls back through.
 *
 * The OLDEST go. A conversation is read from the bottom.
 */
exports.THREAD_CAP = 40;
/** One message off the wire, or null. A role this build does not know and an
 *  empty body are both unsendable and unrenderable, so neither is kept. */
function asMsg(r) {
    if (!r || typeof r !== 'object')
        return null;
    const o = r;
    const role = o.role;
    const content = o.content;
    if (role !== 'user' && role !== 'assistant')
        return null;
    if (typeof content !== 'string' || !content)
        return null;
    return { role, content };
}
/**
 * Read the thread back off the disk.
 *
 * Two halves, and it is the same rule as `src/lib/outbox.ts` · `readOutbox` and
 * `src/lib/crashQueue.ts`: bytes nobody could parse are NOT an empty
 * conversation. A caller that collapses them writes the next reply straight
 * over the top of a thread it never saw. `read: false` is the signal to show
 * what this session has and to stop writing until a launch can read the key
 * cleanly.
 *
 * A null raw — the key has never been written — IS a real empty thread and
 * comes back `read: true`. That is every account that has never used the coach.
 */
function readThread(raw) {
    if (raw == null || raw === '')
        return { thread: null, read: true };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { thread: null, read: false };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { thread: null, read: false };
    const o = parsed;
    if (!Array.isArray(o.msgs))
        return { thread: null, read: false };
    const msgs = [];
    for (const r of o.msgs) {
        const m = asMsg(r);
        // One unreadable message is dropped and the rest are kept — dropping a row
        // is not the same event as failing to read the file, exactly as `readOutbox`
        // argues. What is NOT tolerated is the flag: see below.
        if (m)
            msgs.push(m);
    }
    // A missing or non-boolean `health` is treated as true, and that is the only
    // asymmetry in this file. Every other unreadable field falls towards keeping
    // the member's words; this one falls towards treating the thread as medical,
    // because the cost of guessing wrong is a thread full of somebody's body
    // surviving a consent they have withdrawn.
    const health = typeof o.health === 'boolean' ? o.health : true;
    return { thread: { health, msgs }, read: true };
}
/** The last `THREAD_CAP` messages — what is actually written back. Oldest out,
 *  because a conversation is read from the bottom. */
function trimThread(msgs) {
    return msgs.length <= exports.THREAD_CAP ? [...msgs] : msgs.slice(msgs.length - exports.THREAD_CAP);
}
/** What goes on the disk. Trimmed here rather than at the call site, so there
 *  is no path that stores an untrimmed thread. */
function writeThread(msgs, health) {
    return JSON.stringify({ health, msgs: trimThread(msgs) });
}
/**
 * What may be restored, given what the member currently allows.
 *
 * `allowHealth` is the client's answer read forward: true while they are
 * sharing their health details, false once they have turned that off. A stored
 * thread written under a yes is a copy of the material the no is about, so it
 * is dropped rather than shown — and `dropped` comes back so the screen can say
 * that it happened, because a conversation vanishing with no explanation is its
 * own small betrayal.
 *
 * The coach's Assistant passes true and stores false: its thread is counts,
 * rates and amounts about a business, it names no client, and there is no
 * health tier in it to withdraw.
 */
function threadForConsent(thread, allowHealth) {
    if (!thread)
        return { msgs: [], dropped: false };
    if (thread.health && !allowHealth)
        return { msgs: [], dropped: true };
    return { msgs: thread.msgs, dropped: false };
}
/**
 * The sentence for a thread that was dropped because the member turned sharing
 * off.
 *
 * Says what went and why, and does not apologise for it: they asked for this.
 * It also says the one thing they cannot see for themselves — that the copy is
 * gone from the phone rather than merely hidden.
 */
exports.WITHDRAWN_THREAD_NOTE = 'Your earlier conversation was written while your coach could use your body, sleep and injuries, so it was removed from this phone when you turned that off. Nothing was kept and nothing was sent anywhere.';
/** Where the thread is, said on the screen that keeps it. The member is
 *  entitled to know a record exists before they can decide to clear it. */
exports.THREAD_KEPT_NOTE = 'This conversation is kept on this phone only, under your account, so you can come back to it. It is not stored on our servers and your coach cannot read it. Clearing it removes it for good.';
/** The same sentence for the coach's own Assistant. Different subject, so the
 *  reassurance that would be wrong here — "your coach cannot read it" — is not
 *  made; what a coach needs to know is that their figures did not become a
 *  record somewhere else. */
exports.COACH_THREAD_KEPT_NOTE = 'This conversation is kept on this phone only, under your account. It is not stored on our servers, and no client is named in it. Clearing it removes it for good.';
