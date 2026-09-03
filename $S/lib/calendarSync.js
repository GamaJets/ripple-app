"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WRITE_PRIVACY_NOTE = exports.isSyncEventId = exports.SYNC_ID_PREFIX = exports.LINK_NOTES = exports.NO_CALENDAR_LINK = exports.REMOTE_SCOPE_NOTE = exports.GOOGLE_WRITE_SCOPE = exports.GOOGLE_READ_SCOPE = void 0;
exports.remoteBusySpan = remoteBusySpan;
exports.remoteBusySpans = remoteBusySpans;
exports.combineBusy = combineBusy;
exports.missingSourceNote = missingSourceNote;
exports.linkState = linkState;
exports.syncEventId = syncEventId;
exports.syncClassEventId = syncClassEventId;
exports.plannedSyncEvents = plannedSyncEvents;
exports.syncClassesNote = syncClassesNote;
exports.pushSummaryLine = pushSummaryLine;
exports.pushLabel = pushLabel;
exports.reversedClientRedirect = reversedClientRedirect;
// Coach · a calendar that lives somewhere else.
//
// ── What this is, next to S6 ──────────────────────────────────────────────
//
// src/lib/deviceBusy.ts reads the diary on the PHONE. That covers a coach who
// keeps their life in the calendar app on the handset Repple is installed on,
// and it covers nobody else: the coach whose appointments live in a Google
// account they read on a laptop, the coach who has just changed phone, the
// coach on a work-issued handset with a separate personal account. For all of
// them the phone answers "nothing found", which is the truest empty list this
// app can produce and is still, on this screen, the wrong answer.
//
// So this adds a SECOND source of the same fact — when is the coach busy —
// and, for the first time in this app, a direction of travel back out.
//
// ── The rule S6 set, kept here, harder ────────────────────────────────────
//
// TIMES ONLY. NEVER TITLES, ATTENDEES, NOTES OR LOCATIONS.
//
// `toBusySpan` in deviceBusy.ts reads exactly `startDate` and `endDate` off a
// native object. A remote calendar is worse: an events.list response hands back
// the summary, the description, the location, the organiser's e-mail address,
// every attendee's e-mail address and response, the conferencing link, the
// recurrence rule and the private notes, all in one JSON body, and any of it
// would be one `...spread` away from a row a gym owner can read.
//
// Two things stop that, and the first one is not our code:
//
//   1. THE SCOPE. Repple asks Google for `calendar.freebusy` and nothing more.
//      That scope can call exactly one endpoint — POST /freeBusy — and that
//      endpoint's entire response for a calendar is a list of `{start, end}`.
//      There is no title in it to drop, because Google will not give this
//      grant one. A future edit cannot widen the read by writing more code;
//      it would have to change the scope, which invalidates every existing
//      consent and makes every coach re-authorise. That is the shape of a
//      boundary worth having.
//
//   2. `remoteBusySpan` below, which reads two properties off whatever came
//      back and returns two numbers, exactly as `toBusySpan` does — and hands
//      back the SAME `BusySpan` type, so the two sources merge into one list
//      through code that has never seen either calendar.
//
// ── The write direction, and what it may never touch ──────────────────────
//
// Reading is a copy. Writing is somebody else's calendar, and a sync that can
// modify or delete an entry a person made themselves is not a feature, it is a
// liability. So the write side is fenced twice, and again the first fence is
// not our code:
//
//   1. THE SCOPE. `calendar.app.created` grants access to calendars THIS
//      APPLICATION CREATED and to nothing else in the account. Repple creates
//      one secondary calendar and writes only inside it. A bug that tried to
//      delete the coach's own primary entries would be refused by Google
//      before it reached them, because the grant does not reach them.
//
//   2. THE MARKER. Every event Repple writes carries an id beginning
//      `SYNC_ID_PREFIX`, derived from the Repple session's own uuid. Nothing
//      without that prefix is ever patched or deleted, even inside our own
//      calendar. The whole of Repple's footprint in somebody's Google account
//      is therefore removable by deleting one calendar.
//
// And what goes OUT is as narrow as what comes in. `syncWireEvent` below
// returns three strings — an id and two instants — and that is the entire
// payload the app is able to hand the server. There is no field on it that
// could carry a client's name, so no future edit can accidentally publish one
// to a third party the client has never heard of. The event Google ends up
// storing is titled "Coaching session" with no attendee, no location, no
// description and no guest: enough for the coach to see the hour is taken,
// and nothing at all about who it is with.
const brands_1 = require("./brands");
const localDate_1 = require("./localDate");
/* ── reading ──────────────────────────────────────────────────────────────── */
/**
 * The scopes Repple asks Google for, and the reason each is the narrow one.
 *
 * `calendar.freebusy` is not `calendar.readonly`. The readonly scope would let
 * this app list calendars and read every event on them in full; freebusy can
 * call one endpoint that answers in start/end pairs. The cost of choosing it is
 * real and is stated where the coach reads it: freeBusy can only be asked about
 * calendars this grant can name, so Repple asks about the account's PRIMARY
 * calendar. An appointment the coach files on a secondary calendar is not seen,
 * and `REMOTE_SCOPE_NOTE` says so rather than letting an incomplete answer read
 * as a complete one.
 *
 * `calendar.app.created` is likewise not `calendar.events`. It reaches only
 * calendars this application made.
 */
exports.GOOGLE_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
exports.GOOGLE_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
/** Which calendar the read covers, in the coach's words. */
exports.REMOTE_SCOPE_NOTE = 'Repple asks Google only when you are busy on your main calendar, and Google answers with times and nothing else. No title, no notes, no location and nobody you are meeting can be read, because the permission Repple holds cannot see any of it. Anything you keep on a second calendar is not covered.';
/**
 * Epoch milliseconds for a value off a remote calendar, or null.
 *
 * Two shapes arrive. A busy period is RFC3339 carrying its own offset
 * ('2026-09-08T09:00:00+02:00' or a 'Z'), which is an INSTANT and is parsed as
 * one. A floating all-day value is a bare 'YYYY-MM-DD', which is a DAY in the
 * coach's own life: `Date.parse` would resolve it to UTC midnight, which is the
 * previous afternoon in Kiritimati and the following morning in Midway, so it
 * goes through `localDate` and becomes local midnight. This repo has shipped
 * that exact bug twice, which is why src/lib/localDate.ts exists at all.
 *
 * A number is taken as epoch milliseconds. The server narrows Google's answer
 * to numbers before it leaves the edge function, so that is the normal path;
 * the string branches are what make this readable and testable without one.
 */
function remoteMs(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const d = (0, localDate_1.localDate)(v);
        const t = d ? d.getTime() : NaN;
        return Number.isFinite(t) ? t : null;
    }
    return null;
}
/**
 * The two numbers, off whatever the remote calendar handed back, and nothing
 * else.
 *
 * `unknown` on purpose, exactly as `toBusySpan` takes `unknown`: typing this
 * parameter as a Google free/busy period would invite somebody to widen it one
 * field at a time, and there is nothing else on that object this app is allowed
 * to want. Every property read is written out below and there are two of them.
 *
 * Returns a `BusySpan` — the SAME two-number shape the phone's calendar
 * produces — so `busyCandidates` merges the two sources without ever knowing
 * there were two.
 */
function remoteBusySpan(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const startMs = remoteMs(raw.start);
    const endMs = remoteMs(raw.end);
    if (startMs == null || endMs == null)
        return null;
    if (endMs <= startMs)
        return null;
    return { startMs, endMs };
}
/** Every readable period in a list, with the unreadable ones dropped. A dropped
 *  period is time the coach blocks by hand, which is what they do today; a
 *  guessed one is time nobody can book. */
function remoteBusySpans(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const r of raw) {
        const s = remoteBusySpan(r);
        if (s)
            out.push(s);
    }
    return out;
}
/**
 * The state of a sheet fed by more than one calendar.
 *
 * `busyView` in deviceBusy.ts answers this for ONE source. Two sources make one
 * new way to be wrong and it is the same way the whole feature exists to
 * prevent: the phone answers, Google fails, the merged list is short, and a
 * sheet built on `count === 0` says "nothing in your calendar falls in this
 * window" — which is the sentence "you are free", said about a fortnight nobody
 * managed to read.
 *
 * So a source that failed is never silently dropped:
 *
 *   · every source in play still loading  → 'loading'
 *   · NO source answered                  → 'denied' when the only source is
 *                                            the phone and it refused us,
 *                                            'failed' otherwise
 *   · nothing found AND a source missing  → 'failed', never 'empty'
 *   · nothing found and every source in   → 'empty'
 *   · anything found                      → 'list', with `missing` naming the
 *                                            source the caller must warn about
 *
 * The last one is the deliberate choice. The periods that DID come back are
 * real and blockable, and hiding them behind an error would make a coach block
 * nothing at all; showing them without saying a calendar is absent would let
 * the list read as complete. Both are said at once.
 */
function combineBusy(sources, asked, count) {
    const active = sources.filter((s) => s.active);
    // Nothing can be read on this build and nothing is linked. Saying so outranks
    // every other state, including a stale permission: offering a button that
    // cannot do anything is worse than saying why it is not there.
    if (active.length === 0)
        return { view: 'unavailable', missing: [] };
    if (!asked)
        return { view: 'ask', missing: [] };
    if (active.some((s) => s.status === 'loading'))
        return { view: 'loading', missing: [] };
    const missing = active
        .filter((s) => s.status === 'error' || s.permission === 'denied')
        .map((s) => s.kind);
    if (missing.length === active.length) {
        const onlyRefused = active.length === 1 && active[0].permission === 'denied';
        return { view: onlyRefused ? 'denied' : 'failed', missing };
    }
    // 'empty' is the one word that means "you are free", so it is reachable only
    // when every source in play answered.
    if (count === 0)
        return { view: missing.length > 0 ? 'failed' : 'empty', missing };
    return { view: 'list', missing };
}
/**
 * The sentence naming what is not in the list, or null when nothing is.
 *
 * Always ends by saying what the absence does NOT mean. That clause is the
 * whole point of the function: a coach who reads "your Google calendar could
 * not be read" and nothing else will still take the short list in front of them
 * as their week.
 */
function missingSourceNote(missing) {
    if (missing.length === 0)
        return null;
    const both = missing.includes('device') && missing.includes('google');
    const what = both
        ? 'Neither your phone calendar nor your Google calendar could be read'
        : missing.includes('google')
            ? 'Your Google calendar could not be read'
            : 'Your phone calendar could not be read';
    return `${what}, so anything in it is missing from this list. This is not a statement that you are free at any of these times.`;
}
exports.NO_CALENDAR_LINK = {
    provider: 'google',
    connected: false,
    hasRefresh: false,
    writeEnabled: false,
    hasWriteCalendar: false,
};
function linkState(a) {
    if (!a.configured)
        return 'unconfigured';
    if (a.connecting)
        return 'connecting';
    if (!a.link.connected)
        return 'disconnected';
    if (!a.link.hasRefresh)
        return 'needs-reconnect';
    return a.link.writeEnabled && a.link.hasWriteCalendar ? 'two-way' : 'connected';
}
/**
 * What each link state says.
 *
 * 'unconfigured' is the one that has to be written carefully. A missing client
 * id is a thing the OWNER has not done, and the wearables screen already
 * learned what happens when the owner's setup instructions are printed to the
 * person holding the phone: src/lib/wearables/oauthConfig.ts has a whole field
 * (`clientNote`) that exists because a gym member was told to register an app
 * at dev.fitbit.com. So this says the gap is ours and points at the thing that
 * does work.
 */
exports.LINK_NOTES = {
    unconfigured: 'Repple has not finished setting Google Calendar up in this version, so there is nothing here to sign in to yet and nothing is wrong with your Google account. Reading your phone calendar and blocking time by hand both work today.',
    disconnected: 'Not connected. Repple reads nothing from Google until you sign in, and blocking time by hand is unaffected either way.',
    connecting: 'Waiting for Google to finish signing you in…',
    'needs-reconnect': 'Google did not give Repple permission to keep this connection alive, so it stops working about an hour after it is made. Connect again to fix it.',
    connected: 'Connected. Repple reads when you are busy on your main Google calendar, and writes nothing back.',
    'two-way': 'Connected. Repple reads when you are busy, and puts the sessions clients book into a separate calendar of its own.',
};
/* ── writing ──────────────────────────────────────────────────────────────── */
/**
 * The mark on everything Repple puts in somebody's Google account.
 *
 * Google requires an event id to be base32hex — the characters `a`-`v` and
 * `0`-`9` — which is why this is spelled with letters that survive the rule and
 * why a uuid's hex digits can be used verbatim. Every letter here is at or
 * below `v`; a prefix containing `w`, `x`, `y` or `z` would be rejected by
 * Google at insert time, on a call this repo has no way to exercise.
 *
 * It is a FIXED string and not the brand's, deliberately. A chain that rebrands
 * must not orphan every event Repple has already written, and an id is not a
 * label anybody reads.
 */
exports.SYNC_ID_PREFIX = 'repple';
const SYNC_ID_RE = /^repple[0-9a-f]{32}$/;
/**
 * The Google event id for a Repple session, or null.
 *
 * Derived from the session's own uuid rather than allocated, which is what
 * makes writing idempotent: the same session pushed twice is the same event,
 * so a sync that runs on every refresh cannot fill somebody's calendar with
 * duplicates of the same Tuesday. Null rather than a guess for anything that is
 * not a uuid — an id we invented could collide with an event we did not write.
 */
function syncEventId(sessionId) {
    const hex = String(sessionId || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex))
        return null;
    return exports.SYNC_ID_PREFIX + hex;
}
/**
 * Whether an event id is one Repple minted.
 *
 * The gate on every patch and every delete, on top of the scope that already
 * confines those calls to a calendar this app created. Two fences rather than
 * one, because the thing on the other side of them is a person's diary and
 * because the outer fence is enforced by a Google grant that a future
 * re-authorisation could widen without anybody here noticing.
 */
const isSyncEventId = (id) => typeof id === 'string' && SYNC_ID_RE.test(id);
exports.isSyncEventId = isSyncEventId;
/** How long a written event runs when the session does not say. The same
 *  default `sessions.duration_min` carries. */
const DEFAULT_MINUTES = 60;
/**
 * The Google event id for a class this coach teaches, or null.
 *
 * ── why this is not just `syncEventId(class.id)` ──────────────────────────
 *
 * `gym_classes.id` and `sessions.id` are separate id spaces and can hold the
 * same uuid — src/lib/coverage.test.ts asserts that outright about the floor
 * board, where a class and a session sharing an id must stay two rows. Here the
 * consequence would be worse than a merged row: the two would mint ONE Google
 * event id, so writing the class would overwrite the one-to-one, and the
 * session's hour would vanish out of the coach's diary with nothing anywhere
 * saying it had.
 *
 * A separate textual prefix is not available. The deployed edge function
 * carries its own copy of `/^repple[0-9a-f]{32}$/` and silently skips anything
 * that fails it, so an id spelled any other way is dropped by the server and
 * the class never appears at all.
 *
 * So the namespace is made inside the hex. Both tables default to a version-4
 * uuid — `uuid_generate_v4()` for sessions, `gen_random_uuid()` for classes —
 * and a v4 uuid always carries '4' as its thirteenth hex digit. Replacing that
 * one digit with 'c' lands the class outside the whole of the v4 space that
 * session ids are drawn from, changes nothing else, and stays 32 hex characters
 * so the server's gate still passes it. Two different classes still get two
 * different ids: one fixed position changes, and it changes the same way every
 * time.
 *
 * Null for anything that is not a v4 uuid, rather than a guess. If the digit is
 * not a '4' this cannot promise the result is outside the session space, and an
 * id that might collide is the exact thing being avoided. `plannedSyncEvents`
 * holds the second lock: it plans sessions first and refuses a class whose id
 * is already spoken for.
 */
function syncClassEventId(classId) {
    const hex = String(classId || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex))
        return null;
    if (hex[12] !== '4')
        return null;
    return exports.SYNC_ID_PREFIX + hex.slice(0, 12) + 'c' + hex.slice(13);
}
/**
 * The events Repple would put in the coach's calendar for a window.
 *
 * BOOKED SESSIONS ONLY, and that is a decision rather than a filter. An open
 * slot is an offer, not a commitment, and writing every offered hour into
 * somebody's personal calendar would bury the appointments they actually have
 * under a wall of availability. A blocked period is already an absence and
 * writing it back would be Repple telling the coach's calendar what the coach's
 * calendar told Repple.
 *
 * ── and the classes they teach ────────────────────────────────────────────
 *
 * This was one-to-ones and nothing else, which is the export half of the defect
 * src/lib/booking.ts describes at `classClashes`: classes live in `gym_classes`
 * behind a provider the calendar never consulted. The guard half stops Repple
 * opening a PT hour on top of a class. This half is what everybody ELSE sees —
 * a coach who exports their diary to show a partner, a gym or their own phone
 * was published as free for every hour they spend teaching, and the person
 * reading it has no way to know the timetable was never in there.
 *
 * ONLY classes recorded against this coach. A class with no `trainer_id` is not
 * theirs to claim — part 165 says every class studio-web wrote has that column
 * null — and a colleague's class is a colleague's. Both would fill one person's
 * private calendar with a gym's whole timetable. A cancelled class is not an
 * hour: the room gave it back, and writing it would take the hour off a coach
 * who is free.
 *
 * `teaching` omitted plans no classes at all, which is what every caller did
 * before this existed. It is NOT the same as passing an empty list: the server
 * removes any Repple event in the window that the plan does not name, so
 * handing it `{ classes: [], uid }` after a failed timetable read would strip
 * the coach's classes back out of Google and report it as a tidy-up. A caller
 * whose read did not complete must pass nothing here — `syncClassesNote` below
 * is the sentence for it.
 *
 * Sessions are planned first, deliberately: the `seen` set is what makes the
 * one-to-one win if a class ever mints an id a session already holds, so the
 * appointment with a person in it is never the one that gets overwritten.
 *
 * Sorted by id so the plan is stable, and de-duplicated, so two calls with the
 * same sessions produce the same list and a diff against what is already there
 * has nothing spurious in it.
 */
function plannedSyncEvents(sessions, fromMs, toMs, teaching) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs)
        return [];
    const seen = new Set();
    const out = [];
    const add = (id, startsAt, durationMin) => {
        if (seen.has(id))
            return;
        const startMs = Date.parse(String(startsAt));
        if (!Number.isFinite(startMs) || startMs < fromMs || startMs >= toMs)
            return;
        const mins = Number(durationMin);
        const dur = Number.isFinite(mins) && mins > 0 ? Math.round(mins) : DEFAULT_MINUTES;
        seen.add(id);
        out.push({
            id,
            startIso: new Date(startMs).toISOString(),
            endIso: new Date(startMs + dur * 60000).toISOString(),
        });
    };
    for (const s of sessions) {
        if (!s || s.status !== 'booked')
            continue;
        const id = syncEventId(s.id);
        if (!id)
            continue;
        add(id, s.startsAt, s.durationMin);
    }
    const uid = teaching?.uid ?? null;
    if (uid) {
        for (const c of teaching?.classes ?? []) {
            if (!c || c.status === 'cancelled' || c.trainerId !== uid)
                continue;
            const id = syncClassEventId(c.id);
            if (!id)
                continue;
            add(id, c.startsAt, c.durationMin);
        }
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}
/**
 * What to say when the class timetable was not consulted. Null when it was.
 *
 * The same shape and the same reason as `classCheckCaveat` in booking.ts: a
 * screen that says nothing here is publishing a diary it knows is short and
 * letting the coach believe it is whole. Silence about a missing hour is the
 * expensive direction — somebody books over it.
 */
function syncClassesNote(classesKnown) {
    if (classesKnown)
        return null;
    return 'Your class timetable could not be read, so only your one-to-one sessions are in this. Anybody reading your calendar will see the hours you teach as free.';
}
/**
 * The one line a coach reads after their sessions were written.
 *
 * Zero of everything is a real and common outcome — a second run of an
 * unchanged week — and it says so plainly rather than reading as a failure,
 * because "nothing happened" and "nothing worked" are the pair this repo keeps
 * confusing and they have opposite next steps.
 */
function pushSummaryLine(r) {
    const parts = [];
    if (r.created > 0)
        parts.push(`${r.created} added`);
    if (r.updated > 0)
        parts.push(`${r.updated} updated`);
    if (r.removed > 0)
        parts.push(`${r.removed} removed`);
    if (parts.length === 0)
        return 'Your Google calendar already matches what is on your Repple schedule, so nothing was changed.';
    // "Only sessions Repple put there" was true when sessions were all it wrote.
    // The classes a coach teaches go in the same calendar now, and the promise
    // being made is about PROVENANCE — nothing Repple did not create is touched —
    // so it is said in those words rather than in the name of one of the two
    // kinds of thing it creates.
    return `${parts.join(', ')} in your Google calendar. Only events Repple put there are ever touched.`;
}
/**
 * The promise the write side makes, kept in the same file as the code that
 * keeps it — the same arrangement as `BUSY_PRIVACY_NOTE` in deviceBusy.ts, and
 * for the same reason: the sentence and the behaviour are decided together or
 * they drift apart.
 */
exports.WRITE_PRIVACY_NOTE = `Repple makes a calendar of its own in your Google account, called "${brands_1.BRAND.label} coaching", and writes only inside it. Each booked session, and each class you are recorded as teaching, appears as "Coaching session" with no client name, no class name, no notes, no address and no guests, so nothing about a client reaches Google. Classes nobody is recorded against, and classes your colleagues teach, are never written. Nothing you or anybody else put in your calendar is ever changed or deleted, and removing this calendar removes everything Repple added.`;
/**
 * The button, saying what it will do. Null when there is nothing to send,
 * which is the caller's cue to disable it.
 *
 * `count` is the whole plan and `classes` is how many of it are classes, so a
 * button over a plan that is half timetable does not call it all sessions. A
 * coach who presses "Send 6 Sessions" and finds four classes in their diary has
 * been told the wrong thing by one word; the count itself was always right.
 * Zero classes keeps the sentence it has always had.
 */
function pushLabel(count, classes = 0) {
    if (!Number.isInteger(count) || count < 1)
        return null;
    if (Number.isInteger(classes) && classes > 0)
        return `Send ${count} to Google`;
    return count === 1 ? 'Send 1 Session' : `Send ${count} Sessions`;
}
/* ── the credential a human has to create ─────────────────────────────────── */
/**
 * The redirect URI for a Google OAuth client of the iOS or Android type,
 * derived from the client id, or null.
 *
 * Google mints those client ids as `<id>.apps.googleusercontent.com` and
 * requires the redirect to be the same thing reversed —
 * `com.googleusercontent.apps.<id>:/oauthredirect`. Deriving it means the owner
 * sets ONE value and cannot set the second one inconsistently with the first,
 * which is the failure mode `OAUTH_REDIRECT` in wearables/oauthConfig.ts
 * documents: a redirect that does not match what is registered closes the
 * browser on an unhandled scheme and the connection never completes, with no
 * error anywhere.
 *
 * Null for anything that is not a Google client id — a Web-type client uses an
 * https redirect that cannot be derived from anything and has to be given
 * outright.
 */
function reversedClientRedirect(clientId) {
    const m = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.apps\.googleusercontent\.com$/.exec(String(clientId || '').trim());
    if (!m)
        return null;
    return `com.googleusercontent.apps.${m[1]}:/oauthredirect`;
}
