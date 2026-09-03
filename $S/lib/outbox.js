"use strict";
// The writes that are allowed to wait, for the surfaces that had no queue.
//
// ── What was actually wrong ────────────────────────────────────────────────
//
// src/lib/offlineQueue.ts decides whether a failed write is worth keeping, and
// four providers act on that decision: the workout log, the food log, habits
// and check-ins. Every other write in the client app had no second half at all.
// A message typed on a treadmill, a tape measurement taken in the changing
// room, an injury disclosed on the way in, a PT session approved at reception —
// all of them called `insert`, caught the throw, returned false and forgot the
// content. The member saw a sentence saying it did not send. The words were
// gone.
//
// This file is the durable half those four surfaces did not have: an intent,
// written to the device, replayed when the app can reach the server again
// (src/lib/offlineQueue.ts · `flushAll`, driven by src/lib/reachability.ts).
//
// ── What is deliberately NOT in here, and why ──────────────────────────────
//
// A queue is not free. Replaying a write later is only honest when the answer
// the server would have given now is the answer it will give then. Four kinds
// of write in this app fail that test and are deliberately left to fail
// immediately, with a sentence that says so:
//
//   · BOOKING A CLASS OR A PT SLOT. A seat is a scarce thing somebody else can
//     take. Queueing the intent means telling a member "we will book you when
//     you have signal", and forty minutes later the class is full and they have
//     arranged their evening around a place they never had. The honest answer
//     offline is that nothing was booked — which is what src/ui/classes.tsx
//     already returns, and what `retryLine` now explains properly.
//
//   · CANCELLING ONE. The consequences are computed against the policy at the
//     moment of cancelling: whether a pack credit comes back, whether a late
//     fee applies, whether the slot is re-offered, whether the coach is paged.
//     A cancellation replayed two hours later is a different cancellation, and
//     the member has already been marked absent for the one they thought they
//     had made. Failing loudly lets them ring the gym, which is the thing that
//     actually saves them the no-show fee.
//
//   · SPENDING MONEY — redeeming an offer, buying a pack, taking a payment.
//     Nothing in this app may move money on a device's word alone, and a
//     replayed purchase is the classic double charge.
//
//   · ANYTHING CARRYING A FILE. A photo, an injury document. The queue holds
//     JSON in AsyncStorage; the file lives in a cache directory the OS is free
//     to empty, so a queued upload is an intent whose subject may not exist by
//     the time it runs. src/ui/messaging.ts therefore queues text and refuses
//     to queue an attachment, and says which.
//
//     This clause used to name a body scan alongside them, and that was a
//     misreading of what a scan write IS. `clientData.addScan` inserts six
//     columns — the date, the two weights, the body-fat percentage, the muscle
//     mass and a source string — and does not touch storage at all. There is no
//     STORAGE OBJECT behind a scan: `scans.image_path` is never written by this
//     app, no bucket holds the page, and so there is no file for a cache sweep
//     to take.
//
//     Said as "the photograph is never uploaded", which is how this read until
//     now, that is false and worth correcting even though the conclusion does
//     not move. A page the member says yes to is base64-posted to TWO named
//     companies — vision-analyze → api.anthropic.com and ocr-scan →
//     api.ocr.space — see src/ui/scanSheets.ts and src/lib/scanSheetConsent.ts.
//     That send happens on the screen, in front of the member, before anything
//     reaches this queue; what is queued is the six numbers that came back out
//     of it. The claim this clause needs is the narrow one, so it makes the
//     narrow one. A scan is numbers about the member's own body: not scarce, no money
//     in it, and it says the same thing whenever it lands. That is 'scan'
//     below, and it is why the one screen that says "try again in a moment"
//     over a member's InBody printout no longer has to.
//
// Everything left is a write about the member's own record that says the same
// thing whenever it lands. Those are the ones in here.
//
// ── The three that were left out of "everything left" ─────────────────────
//
// That closing rule was written with three kinds behind it and it admitted
// three more, which had no queue for no reason anybody had decided on: the goal
// a member sets (src/ui/goalTracker.tsx), the day they mark on the calendar
// (app/(client)/calendar.tsx) and a blood sugar reading they type
// (src/ui/glucoseData.ts). Every one is a statement about the member's own
// record, none is scarce, none costs money and none carries a file, and all
// three said "it isn't stored" and dropped what was typed. They are 'goal',
// 'day-plan' and 'glucose' below, and src/lib/recordQueue.ts holds their
// payloads.
//
// One of them needed the expiry this file already had and nothing used: a
// planned day is a plan, and `canPlan` refuses to mark a date that has gone.
// An intent to mark next Tuesday that surfaces on Wednesday is not a late plan,
// it is a claim about the past, and this table is explicitly not where a claim
// about the past gets to live. So a day-plan intent expires with its own day —
// see `planExpiry` — and comes back through `partitionLapsed` to be said out
// loud rather than written.
//
// ── The fourth that was left out, and the sentence that admits it ─────────
//
// Accepting the paperwork a COACH asks a member to sign — a studio waiver, a
// par-form, the house rules for a rented unit (app/(client)/coach-documents.tsx,
// supabase/parts/135). It was a bare insert with nothing behind it: the write
// failed, an alert said "That acceptance was not saved", and the member's tap
// was gone. That is 'coach-doc-accept' below.
//
// It passes the admission rule above on every clause. It is not scarce —
// nobody else can take a member's own acceptance of their own coach's
// document, and there is no seat to lose. It costs nothing. It carries no
// file: the DOCUMENT is a file and it is not going anywhere, the intent is a
// reference to a row that is already on the server, so nothing here depends on
// a cache directory surviving. And it says the same thing whenever it lands:
// the person read the waiver and agreed to it, and `accepted_at` is when the
// row is written either way.
//
// It has no expiry, and that is the deliberate part. A day-plan lapses because
// the day passes; an acceptance is not about a day. A member who accepts their
// coach's waiver in a basement studio with no signal has accepted it, and the
// worst outcome of a late write is a coach seeing the signature an hour later.
// The outcome of no queue at all is the one this table exists to stop: they are
// turned away from a session they have paid for, at the door, for paperwork
// they completed.
//
// Replay is safe because the primary key is (document_id, client_id). A second
// send of one the server already has comes back 23505, which classifyWrite
// reads as a refusal and drops — and the handler in src/ui/recordOutbox.ts
// treats that particular refusal as what it plainly is: the row is there.
//
// ── The fifth, which is the one the exclusion list appears to forbid ──────
//
// ASKING A COACH FOR A TIME THEY HAVE NOT OPENED ('session-request',
// supabase/parts/740, src/lib/sessionRequests.ts). The first exclusion above
// says "BOOKING A CLASS OR A PT SLOT" may not wait, and a reader skimming this
// list would stop there. The reason that clause gives is what settles it, and it
// is about scarcity rather than about the subject: "A seat is a scarce thing
// somebody else can take. Queueing the intent means telling a member 'we will
// book you when you have signal', and forty minutes later the class is full and
// they have arranged their evening around a place they never had."
//
// A request is the precise opposite of that, by construction. Nothing is held,
// so there is no seat for anybody to take first; nobody else is competing for
// it, because it is addressed to one coach and names one member; and it cannot
// fill up, because a request confers nothing at all until the coach answers.
// The sentence the member reads while it waits — "1 session request saved on
// this phone and not sent yet" — promises exactly what will happen, which is the
// test the booking clause fails and this one passes. It costs nothing, part 740
// draws no credit and raises no charge for one. And it carries no file.
//
// It has an expiry, and it is the second kind here to need one. A request asks
// for a specific hour and `answer_session_request` refuses to accept one whose
// hour has gone — so an intent surfacing after that hour is a question nobody
// can answer, and sending it would put a dead row in a coach's queue. The
// expiry is the requested hour itself (`sessionRequestExpiry`), the same
// boundary the server enforces and the same boundary the member's screen
// states, so all three agree without any of them being told by the others.
//
// What the member is NOT told is that their coach has been asked, because their
// coach has not been. `lapsedNote('session-request')` is the sentence for the
// intent that waited too long, and it says plainly that nothing reached anyone.
//
// ── The one that is handled somewhere else, deliberately ──────────────────
//
// An injury disclosure is not a kind here, and that is not an omission. It is
// written as part of the client's profile row (src/ui/clientData.tsx), which
// already caches the whole profile to this device and re-sends it as an UPDATE
// from state. For a write shaped like that there is nothing to queue that state
// is not already holding — "send it again" and "send what is on screen" are the
// same instruction. What was missing was only the TRIGGER, and that file now
// registers with src/lib/offlineQueue.ts · `flushAll` like everything else, so a
// knee disclosed in a basement goes up on the reconnect rather than waiting for
// the next thing the member happens to edit.
Object.defineProperty(exports, "__esModule", { value: true });
exports.inOrder = exports.ofKind = exports.bumpTry = exports.dropItem = exports.isOutboxKind = exports.OUTBOX_CAP = exports.outboxLapsedKey = exports.OUTBOX_LAPSED_PREFIX = exports.outboxKey = exports.OUTBOX_PREFIX = exports.OUTBOX_KINDS = void 0;
exports.mergeLapsed = mergeLapsed;
exports.newRowId = newRowId;
exports.newItem = newItem;
exports.readOutbox = readOutbox;
exports.addItem = addItem;
exports.partitionLapsed = partitionLapsed;
exports.kindNoun = kindNoun;
exports.outboxNote = outboxNote;
exports.lapsedNote = lapsedNote;
const wellnessSync_1 = require("./wellnessSync");
/**
 * The same kinds as a list, for a caller that has to walk them.
 *
 * The union is the authority and this is derived from it by hand, which is the
 * one thing worth watching: `src/lib/outbox.test.ts` asserts every member of
 * the union has an entry here, so a kind added to the type without being added
 * to this list fails the suite rather than going quietly unrendered — the exact
 * failure mode of the sentences this list exists to draw.
 */
exports.OUTBOX_KINDS = [
    'message', 'measurement', 'pt-approval', 'goal', 'day-plan', 'glucose', 'coach-doc-accept', 'scan',
    'session-request',
];
/** Where one account's outbox lives. Per account, because two people sharing a
 *  phone must not inherit each other's unsent writes. */
exports.OUTBOX_PREFIX = 'outbox:v1:';
const outboxKey = (uid) => `${exports.OUTBOX_PREFIX}${uid}`;
exports.outboxKey = outboxKey;
/**
 * Where the things this account has to be TOLD about live.
 *
 * ── Why a lapsed intent needs a key of its own ────────────────────────────
 *
 * `partitionLapsed` returns the lapsed items rather than deleting them, and the
 * docstring says why: "a lapsed intent is the one case where the member has to
 * be told: they typed something, it never went, and it is not going to.
 * Dropping it silently is exactly the failure this whole file is about, moved
 * later in time."
 *
 * The telling was held in React state and nowhere else. The moment an intent
 * lapses it comes OUT of `outboxKey` — correctly, it must never be sent — and
 * the only record that it ever existed is a `useState` in
 * src/ui/outbox.tsx. So the sequence that actually happens on a phone is: a
 * member marks next Tuesday as a rest day in a basement studio; Tuesday passes;
 * they open the app on Wednesday, the lapse is detected on the load, the intent
 * is written out of the outbox — and if the process ends before they happen to
 * read the home screen (a launch straight into another tab, a swipe-away, the
 * OS reclaiming a backgrounded app), the notice is gone with it and nothing
 * will ever raise it again. The member believes they marked the day.
 *
 * That is the file's own failure arriving through the one door it left open, so
 * the notice is written to the device and survives until the member has
 * acknowledged it.
 */
exports.OUTBOX_LAPSED_PREFIX = 'outbox:lapsed:v1:';
const outboxLapsedKey = (uid) => `${exports.OUTBOX_LAPSED_PREFIX}${uid}`;
exports.outboxLapsedKey = outboxLapsedKey;
/**
 * The lapse notices to keep, given the ones already held and the ones that have
 * just lapsed.
 *
 * ONE PER KIND, newest first, which is not a cap chosen for space — it is
 * exactly what gets drawn. app/(client)/dashboard.tsx renders
 * `[...new Set(lapsed.map((i) => i.kind))]`, one `lapsedNote(kind)` per kind,
 * and `lapsedNote` is singular whatever the count: "A planned day was waiting
 * to send for too long". Three lapsed planned days are one thing to say, so
 * keeping three of them would be storing two rows that can never change a word
 * on any screen.
 *
 * Bounded by the union rather than by a number, which is the property worth
 * having: a phone left in a drawer for a month cannot accumulate lapse notices
 * faster than there are kinds of write.
 *
 * The NEWEST of a kind is the one kept, and that is the opposite direction from
 * `addItem`'s refusal — deliberately, because these are not work. `addItem`
 * refuses past the cap because evicting would discard something a member typed
 * that could still be sent; nothing here can ever be sent, and between two
 * notices that say the identical sentence the more recent is the one whose
 * moment the member is likelier to remember.
 */
function mergeLapsed(existing, incoming) {
    const newest = new Map();
    for (const i of [...existing, ...incoming]) {
        const held = newest.get(i.kind);
        // `>=` so a later arrival wins a tie, which is the same "the last one is
        // the answer" rule the rest of this file keeps.
        if (!held || Date.parse(i.at) >= Date.parse(held.at))
            newest.set(i.kind, i);
    }
    // In the union's own order, so the home screen draws the same list in the
    // same place every launch rather than in whatever order the lapses happened.
    return exports.OUTBOX_KINDS.map((k) => newest.get(k)).filter((i) => i !== undefined);
}
/**
 * How many intents one device will hold.
 *
 * There is a number here for a reason that is not tidiness: AsyncStorage on
 * Android is one SQLite row per key and a runaway queue is a write that starts
 * failing, which would take the whole outbox with it. Two hundred is weeks of
 * ordinary use for one person.
 *
 * `add` REFUSES past the cap rather than evicting. Evicting the oldest is the
 * obvious implementation and it is silent data loss chosen by a constant; a
 * refusal is a thing the caller can put in front of somebody.
 */
exports.OUTBOX_CAP = 200;
/**
 * A uuid for a row this device is about to write, chosen HERE rather than by
 * the server.
 *
 * ── What it is for ────────────────────────────────────────────────────────
 *
 * At-least-once delivery. The insert reaches Postgres, the rows are written,
 * and the RESPONSE is lost on the way back — a tunnel, a dropped 4G handover,
 * the app backgrounded mid-request. `classifyWrite` sees no answer, correctly
 * calls that 'unsent', and the intent stays queued; the next flush offers it
 * again. If the server minted the key there is nothing for the second offer to
 * collide with and the member ends up with two of something. If the DEVICE
 * minted it, the second offer comes back 23505 and the handler reads that for
 * what it plainly is: the row is there.
 *
 * That is the property `ScanIntent` already relies on and states at length, and
 * it was minted privately in app/(client)/scans.tsx where nothing else could
 * reach it. It is a rule about queued writes, so it lives with them.
 *
 * ── Why not expo-crypto ──────────────────────────────────────────────────
 *
 * `expo-crypto` calls `requireNativeModule` at module scope, so importing it
 * throws while the importing file is LOADING on any install made before that
 * dependency landed — the whole screen, not the one feature, and no `if` inside
 * a component runs early enough to help. That is what scripts/check-native.mjs
 * refuses, and it is right to: an over-the-air update carries the JavaScript and
 * never the native half.
 *
 * So: the platform's own `crypto.randomUUID` where the runtime has one, and
 * otherwise a v4 built from `Math.random`. `Math.random` is not a source of
 * secrets and this is not a secret — it is a primary key for a row about the
 * member's own record, and which rows they may write is decided by RLS and not
 * by anybody's ability to guess an id. What it has to be is UNIQUE, and 122
 * random bits is unique enough that the app will never see two.
 */
function newRowId() {
    const c = globalThis.crypto;
    if (typeof c?.randomUUID === 'function') {
        try {
            const id = c.randomUUID();
            if (typeof id === 'string' && id)
                return id;
        }
        catch { /* no usable platform uuid; the shape below is built by hand */ }
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const r = (Math.random() * 16) | 0;
        return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
let SEQ = 0;
/** A new intent. `at` defaults to now and is the member's moment, not the
 *  send's. */
function newItem(kind, payload, opts = {}) {
    return {
        id: `${wellnessSync_1.LOCAL_PREFIX}ob.${Date.now().toString(36)}.${SEQ++}`,
        kind,
        at: opts.at ?? new Date().toISOString(),
        payload,
        tries: 0,
        expiresAt: opts.expiresAt ?? null,
    };
}
/**
 * What is on the device, and whether we managed to read it.
 *
 * The two halves are the whole point, and it is the same rule
 * src/lib/workoutQueue.ts states for its own cache: bytes nobody could parse
 * are NOT an empty queue. A caller that collapses them writes its own list
 * straight over the top of intents it never saw. `read: false` is the signal to
 * stop writing until the next launch can read the key cleanly.
 *
 * null raw — the key has never been written — IS a real empty queue and comes
 * back `read: true`. That is the ordinary case for every account that has never
 * been offline.
 */
function readOutbox(raw) {
    if (raw == null)
        return { items: [], read: true };
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return { items: [], read: false };
        const items = [];
        for (const r of parsed) {
            if (!r || typeof r !== 'object')
                continue;
            const kind = String(r.kind ?? '');
            const id = String(r.id ?? '');
            const at = String(r.at ?? '');
            // A row missing any of the three cannot be sent OR identified, and
            // keeping it would make it permanently uncountable. Dropping one bad row
            // is not the same event as failing to read the file, so `read` stays
            // true: the rest are known good and may be written back.
            if (!id || !at || !(0, exports.isOutboxKind)(kind))
                continue;
            items.push({
                id, kind, at,
                payload: r.payload,
                tries: Number.isFinite(r.tries) ? Number(r.tries) : 0,
                expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : null,
            });
        }
        return { items, read: true };
    }
    catch {
        return { items: [], read: false };
    }
}
// The same list as `OUTBOX_KINDS`, deliberately, rather than a second one: a
// private copy here was how a new kind could become readable from storage
// without ever being drawn on a screen.
const isOutboxKind = (s) => exports.OUTBOX_KINDS.includes(s);
exports.isOutboxKind = isOutboxKind;
/**
 * Add one intent.
 *
 * `added` is false only when the cap is reached, and the list comes back
 * unchanged so the caller can say "this phone is holding as much as it can"
 * rather than quietly losing either this write or the oldest one.
 */
function addItem(list, item) {
    if (list.length >= exports.OUTBOX_CAP)
        return { list, added: false };
    return { list: [...list, item], added: true };
}
/** Remove one, by id. Used on 'stored' and on 'refused' alike — a refusal
 *  offered again gets the same refusal, which offlineQueue.ts argues at
 *  length. */
const dropItem = (list, id) => list.filter((i) => i.id !== id);
exports.dropItem = dropItem;
/** Record that a send was attempted and nobody answered. */
const bumpTry = (list, id) => list.map((i) => (i.id === id ? { ...i, tries: i.tries + 1 } : i));
exports.bumpTry = bumpTry;
/** Everything of one kind, oldest first — which is the order they must be sent
 *  in. A thread is a conversation and two messages typed offline arriving in
 *  the wrong order is a different conversation. */
const ofKind = (list, kind) => list.filter((i) => i.kind === kind).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
exports.ofKind = ofKind;
/** Oldest first across every kind, for a flush that sends the lot. */
const inOrder = (list) => [...list].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
exports.inOrder = inOrder;
/**
 * Split off the intents that have stopped meaning anything.
 *
 * Returned rather than deleted, because a lapsed intent is the one case where
 * the member has to be told: they typed something, it never went, and it is not
 * going to. Dropping it silently is exactly the failure this whole file is
 * about, moved later in time.
 */
function partitionLapsed(list, now = Date.now()) {
    const live = [];
    const lapsed = [];
    for (const i of list) {
        const t = i.expiresAt ? Date.parse(i.expiresAt) : NaN;
        // An unparseable expiry is treated as no expiry. The alternative — treating
        // it as already lapsed — throws away a member's write on the strength of a
        // string this file failed to read.
        if (Number.isFinite(t) && t <= now)
            lapsed.push(i);
        else
            live.push(i);
    }
    return { live, lapsed };
}
/** What one of these is called, for a sentence. Plural given explicitly rather
 *  than by adding an s, so a kind whose plural is irregular cannot be added
 *  later without noticing. */
function kindNoun(kind) {
    switch (kind) {
        case 'message': return { one: 'message', many: 'messages' };
        case 'measurement': return { one: 'measurement', many: 'measurements' };
        case 'pt-approval': return { one: 'session approval', many: 'session approvals' };
        // Named the way the member would name them, not the way the table does.
        // "A planned day was waiting to send for too long" is a sentence somebody
        // can act on; "a planned_days row" is not.
        case 'goal': return { one: 'goal', many: 'goals' };
        case 'day-plan': return { one: 'planned day', many: 'planned days' };
        case 'glucose': return { one: 'blood sugar reading', many: 'blood sugar readings' };
        // Not "acceptance", which is the table's word for it. The member signed
        // something their coach gave them, and that is what the sentence has to say
        // back to them for it to mean anything at the studio door.
        case 'coach-doc-accept': return { one: 'signed document', many: 'signed documents' };
        // What the member calls it. "Body composition" is the coach's phrase and
        // "a scans row" is the table's; the thing they did was stand on a machine
        // at their gym and photograph the printout.
        case 'scan': return { one: 'body scan', many: 'body scans' };
        // "Request" is the table's word and it is also the member's, because the
        // whole design of the feature is that this is a QUESTION and not a booking.
        // Naming it anything warmer here would be the first place the distinction
        // started to blur, on the one screen that says the words have not been sent.
        case 'session-request': return { one: 'session request', many: 'session requests' };
    }
}
/**
 * The sentence for a screen that is holding `n` of one kind.
 *
 * Deliberately the same shape and the same promise as
 * src/lib/offlineQueue.ts · `unsentNote`, because a member should not have to
 * learn two vocabularies for the same situation, and because the delicate part
 * is identical: the work is NOT lost, it has NOT been delivered, and nobody has
 * read it. A client whose injury note is sitting here must not believe their
 * coach has seen it.
 *
 * Null for zero, so a caller can render it unconditionally without drawing an
 * empty banner about nothing.
 */
function outboxNote(n, kind) {
    if (n <= 0)
        return null;
    const { one, many } = kindNoun(kind);
    return `${n} ${n === 1 ? one : many} saved on this phone and not sent yet — ${n === 1 ? 'it goes' : 'they go'} up next time you have signal.`;
}
/**
 * The sentence for something that waited too long to be worth sending.
 *
 * Names what it was and states plainly that it did not happen, because the
 * member's model is that it did.
 */
function lapsedNote(kind) {
    const { one } = kindNoun(kind);
    return `A ${one} was waiting to send for too long, so it was not sent. Nothing reached anyone and you may want to do it again.`;
}
