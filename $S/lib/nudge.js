"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WITHHELD_NOTE = exports.NEVER_SAYS = exports.DISMISS_FLOOR_DAYS = exports.ACTION_LABEL = exports.WHAT_IT_CANNOT_SEE = exports.SOURCE_LABEL = exports.ALL_SOURCES = void 0;
exports.mutedBy = mutedBy;
exports.mutedDaysFor = mutedDaysFor;
exports.refusalsIn = refusalsIn;
exports.observedLine = observedLine;
exports.greetingName = greetingName;
exports.readableDay = readableDay;
exports.draftMessage = draftMessage;
exports.explainDrift = explainDrift;
exports.earnsNudge = earnsNudge;
exports.buildNudgeBoard = buildNudgeBoard;
exports.weekKey = weekKey;
exports.watchDigestDue = watchDigestDue;
exports.watchDigestNote = watchDigestNote;
exports.boardNote = boardNote;
// Coach · the nudge. Turning "this client has gone quiet" into something a
// coach can actually do, without doing it for them.
//
// ── What was already true, and what was missing ────────────────────────────
//
// src/lib/clientDrift.ts works out who is breaking their own pattern, and the
// Clients tab sorts on it. That is the whole of it: the app computes the
// answer, prints it as a band heading, and stops. A coach with forty clients
// has to notice the third row of a list they opened for another reason, on the
// day it happens to matter — and the entire justification for computing drift
// was that they will not.
//
// So this module produces a SUGGESTION and a DRAFT. Nothing here sends
// anything, and nothing here can.
//
// ── THE THREE THINGS THIS MODULE MUST NOT DO ───────────────────────────────
//
// 1. IT MUST NEVER MESSAGE A CLIENT AS THE COACH. `draftMessage` returns a
//    string. There is no send in this file, no Supabase client, and no caller
//    that can be given one — `src/ui/nudges.ts` writes the RECORD of what the
//    coach did and never the message itself, which goes through the ordinary
//    thread the coach is already looking at, from their own hand, after they
//    have read and edited it.
//
//    This is not a stylistic preference. A message that appears to come from a
//    person who did not write it is a defect this codebase has already removed
//    once: `messages.sender` was taken from the client's own request, so a
//    client could post into their thread as 'coach' and their own phone would
//    render it as words from their coach. Automating the draft would put the
//    same falsehood back with better manners — the client would be reading a
//    sentence in their coach's voice that their coach had never seen.
//
// 2. IT MUST NEVER NAG. A suggestion engine that repeats is one a coach learns
//    to scroll past, and a coach who scrolls past this list scrolls past the
//    real ones in it. Two acts are recorded and both mute the client: sending,
//    which mutes for as long as the client's OWN rhythm says an approach needs
//    to be given a chance (`paceFor` in interventions.ts), and dismissing,
//    which mutes for longer because the coach has looked and said no.
//
//    The mute window is read from the RECORD, not recomputed from today's
//    constants — see `mutedBy`. A row nobody can date does not mute at all.
//
// 3. IT MUST NOT DIAGNOSE. Drift is a fall in what the record HOLDS. It is not
//    a fall in what the person did, and it is emphatically not a reason. The
//    same shape on the chart is produced by an injury, a fortnight in Greece, a
//    change of gym, a lapsed direct debit, and somebody who has quietly
//    decided they are finished — and by somebody training four times a week
//    who stopped opening the app. Every sentence this module writes is about
//    the record ("nothing logged for eleven days"), never about the person
//    ("losing motivation"). `NEVER_SAYS` is that rule made mechanical, and
//    `refusalsIn` is checked against every draft in nudge.test.ts.
//
// ── AND THE ONE THAT DECIDES WHETHER ANY OF IT IS USEFUL ───────────────────
//
// A CLIENT WHOSE ACTIVITY COULD NOT BE READ IS NOT A DRIFTING CLIENT. This is
// the LoadStatus rule (src/ui/loadStatus.ts) in the one place it costs
// something real: a refused read, a truncated page, or a roster entry with no
// Repple account behind it all yield an empty event list, and an empty event
// list assessed by `assessDrift` comes back as "nothing recorded" — which is a
// TRUE statement about a client who is genuinely silent and a FALSE one about
// a client who trained yesterday.
//
// A coach ringing somebody who trained yesterday to ask where they have been
// does not get a neutral outcome; they look like they have not been paying
// attention, to the one person who was. So `buildNudgeBoard` takes a per-client
// READ RESULT rather than a per-client event list, refuses to assess anybody
// whose read did not come back whole, and counts them out loud in `withheld`
// so a short list is never mistaken for a calm week.
const clientDrift_1 = require("./clientDrift");
const interventions_1 = require("./interventions");
const localDate_1 = require("./localDate");
const format_1 = require("./format");
const weekStart_1 = require("./weekStart");
const DAY = 86400000;
/* ── what the app can and cannot see ───────────────────────────────────────── */
/** Every source `fetchClientActivity` reads, in the order a coach thinks of
 *  them. Kept here as well as there so the evidence panel can say which ones
 *  were SILENT and which were never asked — two different facts that an
 *  absent row cannot tell apart on its own. */
exports.ALL_SOURCES = ['check_in', 'workout', 'session', 'visit'];
exports.SOURCE_LABEL = {
    check_in: 'check-ins',
    workout: 'logged workouts',
    session: 'completed sessions',
    visit: 'gym door scans',
};
/**
 * What the record cannot see, said in full, every time.
 *
 * This sentence is the difference between a prompt and an accusation. It is
 * exported rather than inlined in a screen because it has to be identical
 * wherever a drift figure is acted on, and because a future edit that softens
 * it should be a visible change to a named constant rather than a quiet
 * rewording of a caption.
 */
exports.WHAT_IT_CANNOT_SEE = 'This is what the app was told, not what they did. An injury, a fortnight away, '
    + 'a move to another gym, a lapsed payment or simply not opening the app all look '
    + 'exactly like this. Ask before assuming.';
exports.ACTION_LABEL = {
    sent: 'Messaged',
    dismissed: 'Set aside',
};
/**
 * The act, if any, currently keeping this client out of the list.
 *
 * The LATEST-ENDING live mute wins rather than the most recent record: a coach
 * who sets a client aside for thirty days and then messages them the same
 * afternoon has not shortened their own decision to thirty days.
 *
 * A record whose `at` will not parse mutes NOTHING. That is the deliberate
 * direction: an undateable row silencing a client forever is a client who
 * leaves and is never mentioned again, which is worse than one extra prompt.
 */
function mutedBy(records, clientId, now = Date.now()) {
    let best = null;
    for (const r of records) {
        if (r.clientId !== clientId)
            continue;
        const at = Date.parse(r.at);
        if (Number.isNaN(at))
            continue;
        // A non-positive window is not a mute. Reading it as one would let a bad
        // row silence somebody on the strength of arithmetic nobody intended.
        if (!(r.mutedDays > 0))
            continue;
        const endsMs = at + r.mutedDays * DAY;
        if (endsMs <= now)
            continue;
        if (!best || endsMs > best.endsMs) {
            best = { record: r, endsMs, daysLeft: Math.max(1, Math.ceil((endsMs - now) / DAY)) };
        }
    }
    return best;
}
/** A set-aside lasts at least a month. A coach who has looked at somebody and
 *  said "not this one" has made a decision, and asking again next Monday is the
 *  behaviour this whole module exists to avoid. */
exports.DISMISS_FLOOR_DAYS = 30;
/**
 * How long an act mutes a client for.
 *
 * Sending paces off the client's own rhythm — `paceOf` gives two of their
 * ordinary gaps between visits, floored at a week and capped at a month — so a
 * client who trained daily is not left for four weeks and a client who trained
 * fortnightly is not chased mid-gap. Dismissing takes the longer of that and a
 * month, because it is a decision rather than an attempt.
 *
 * Neither is permanent. A client set aside in January who is still silent in
 * March comes back, and that is right: the coach's "no" was about the situation
 * they were shown, and by then it is a different one.
 */
function mutedDaysFor(action, drift, bounds) {
    const p = (0, interventions_1.paceOf)(drift, bounds);
    // The dismiss floor is a MAX against the sending window, so a coach who has
    // raised their own minimum past a month gets their number for both acts
    // rather than having a dismissal quietly expire before a send would have.
    return action === 'sent' ? p.cooldownDays : Math.max(exports.DISMISS_FLOOR_DAYS, p.cooldownDays);
}
/**
 * Phrases that must not appear in a message drafted for a coach to send.
 *
 * Two kinds, and both are claims the record cannot support:
 *
 *   · A VERDICT ON THE PERSON — motivation, commitment, giving up. The app has
 *     a fall in a row count. It does not have a state of mind, and putting one
 *     in a coach's mouth is how a client who was in hospital receives a message
 *     about their commitment.
 *
 *   · A CAUSE. Injury, holiday, money. Naming one asserts it: "I know you've
 *     been away" to somebody who has not been, or worse, "I noticed your
 *     payment" in a draft a coach sends without rereading. The coach-facing
 *     caveat (`WHAT_IT_CANNOT_SEE`) names all three ON PURPOSE — that is the
 *     honest statement of what the signal is not — but it is written to the
 *     coach, and it stays there.
 *
 * `\b` boundaries throughout, deliberately: a substring list had `ill` in it,
 * which matches "will", and the first draft this module produced was refused
 * for saying somebody was sick when it had said "I will".
 */
exports.NEVER_SAYS = [
    { pattern: /\bmotivat/i, claim: 'a state of mind' },
    { pattern: /\bcommit(ment|ted)?\b/i, claim: 'a state of mind' },
    { pattern: /\blaz(y|iness)\b/i, claim: 'a verdict on the person' },
    { pattern: /\bexcuses?\b/i, claim: 'a verdict on the person' },
    { pattern: /\bslack(ing|ed|er)?\b/i, claim: 'a verdict on the person' },
    { pattern: /\bdisappoint/i, claim: 'a verdict on the person' },
    { pattern: /\b(giv(en|ing)|gave) up\b/i, claim: 'that they have stopped' },
    { pattern: /\bquit(ting)?\b/i, claim: 'that they have stopped' },
    { pattern: /\b(fallen|falling|dropped|dropping) off\b/i, claim: 'that they have stopped' },
    { pattern: /\byou('ve| have)? stopped\b/i, claim: 'that they have stopped' },
    { pattern: /\b(haven't|have not|has not|hasn't) been training\b/i, claim: 'that they did not train' },
    { pattern: /\bnot been training\b/i, claim: 'that they did not train' },
    { pattern: /\bdrift(ing)?\b/i, claim: 'the internal band name, as a verdict about them' },
    { pattern: /\bat risk\b/i, claim: 'the internal band name, as a verdict about them' },
    { pattern: /\bchurn/i, claim: 'the internal band name, as a verdict about them' },
    { pattern: /\binjur(y|ies|ed)\b/i, claim: 'a cause the record cannot see' },
    { pattern: /\bholidays?\b/i, claim: 'a cause the record cannot see' },
    { pattern: /\bvacations?\b/i, claim: 'a cause the record cannot see' },
    { pattern: /\b(sick|ill|unwell)\b/i, claim: 'a cause the record cannot see' },
    { pattern: /\b(payments?|invoices?|billing|unpaid|overdue|subscription)\b/i, claim: 'a cause the record cannot see' },
    { pattern: /\byou (should|must|need to)\b/i, claim: 'an instruction, which is the nagging this exists to avoid' },
];
/** Every claim a piece of text would be making that the record cannot support.
 *  Empty means it says only what was observed. */
function refusalsIn(text) {
    const out = [];
    for (const r of exports.NEVER_SAYS)
        if (r.pattern.test(text))
            out.push(r.claim);
    return [...new Set(out)];
}
/* ── the copy ──────────────────────────────────────────────────────────────── */
/**
 * The one factual sentence about the record.
 *
 * This is `drift.reason` verbatim, and that is the point rather than laziness.
 * clientDrift already writes its verdicts in the register this module needs —
 * "Nothing for 19 days — was 3.5 days a week", "Nothing recorded in 63 days on
 * your book" — and a second set of sentences here would be a second vocabulary,
 * free to disagree with the band heading three rows above it on the same
 * screen. Where the wording needs to change it changes there, once.
 */
function observedLine(d) {
    return d.reason;
}
/**
 * The client's given name, for a greeting, or null.
 *
 * First word only, and never a fragment of an email address or a bare uuid: a
 * draft opening "Hi 7f3a9c21" is worse than one opening with no name at all,
 * and a coach skimming a list of ready-to-send messages is exactly who would
 * miss it.
 */
function greetingName(name) {
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
/** A day key as a coach reads it: "12 Aug 2026". Local, via `dateParts`, so a
 *  bare date is not pulled a day backwards west of Greenwich. */
function readableDay(dayKey) {
    const p = (0, localDate_1.dateParts)(dayKey);
    return p ? (0, format_1.fmtPointDay)(p[0], p[1], p[2]) : dayKey;
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/**
 * The draft. A starting point for a coach, not a message.
 *
 * Written to three rules:
 *
 *   · it states what the APP has, and attributes it to the app — "I've not had
 *     anything logged from you", never "you haven't trained". The distinction
 *     survives being wrong: a client who trained six times without opening the
 *     app reads it and says so, and nobody has been accused of anything.
 *   · it offers the client the first word about why. It does not offer them a
 *     reason to agree with, which is what naming one would be.
 *   · it asks one open question and stops. No plan, no offer, no guilt. Those
 *     are the coach's to add, in the box, before they send.
 *
 * The last line is the one most likely to be edited away, and that is fine —
 * the whole design assumes the coach rewrites this. What matters is that the
 * version they start from cannot be sent unread and be wrong.
 */
function draftMessage(name, d) {
    const who = greetingName(name);
    const hi = who ? `Hi ${who} — ` : '';
    // Silent for a countable stretch: say the number and the date, because a
    // client who has been logging elsewhere can correct both.
    if (d.quietDays != null && d.quietDays >= 1) {
        return `${hi}I've not had anything come through in the app from you for ${plural(d.quietDays, 'day')}. `
            + `That might just be the app rather than you. How have you been getting on?`;
    }
    // Nothing at all on record, ever. The only honest opening is that we have
    // nothing, not that they have done nothing.
    if (d.quietDays == null) {
        const span = d.observedDays != null && d.observedDays > 0
            ? ` since you joined ${plural(d.observedDays, 'day')} ago`
            : '';
        return `${hi}I've not had anything come through in the app from you${span}. `
            + `That might just be the app rather than you. How have you been getting on?`;
    }
    // Something today or yesterday, but well down on their own rate. Nothing is
    // missing, so there is nothing to ask about having missed.
    const rate = d.baselinePerWeek != null && d.recentPerWeek != null
        ? ` It's been ${d.recentPerWeek} a week lately where it used to be ${d.baselinePerWeek}.`
        : '';
    return `${hi}Just checking in on how training's fitting in at the moment.${rate} `
        + `Anything you'd want to change about the plan?`;
}
/**
 * The dates behind the number.
 *
 * A coach asked to act on "-72%" cannot check it. A coach shown "six days in
 * July, nothing since the 12th, and the door log was not read because this
 * account has no gym" can, and will spot the case the arithmetic gets wrong —
 * which is the case this whole feature is most dangerous in.
 */
function explainDrift(input, now = Date.now(), windows = clientDrift_1.DEFAULT_WINDOWS) {
    const { drift: d, events } = input;
    const { recentStart, historyStart } = (0, clientDrift_1.driftBounds)(now, windows);
    const recentDays = (0, clientDrift_1.activeDayLog)(events, recentStart, now + 1);
    const baselineDays = (0, clientDrift_1.activeDayLog)(events, historyStart, recentStart);
    // The newest event, taken from the log rather than re-scanned, so the day it
    // is filed under is the same day the count used.
    const newest = recentDays.length ? recentDays[recentDays.length - 1]
        : baselineDays.length ? baselineDays[baselineDays.length - 1]
            : null;
    const lastSeen = newest ? { day: newest.day, kind: newest.kinds[0] } : null;
    const read = input.doorLogRead ? exports.ALL_SOURCES : exports.ALL_SOURCES.filter((k) => k !== 'visit');
    const seen = exports.ALL_SOURCES.filter((k) => d.kinds.includes(k));
    const silent = read.filter((k) => !d.kinds.includes(k));
    const notRead = exports.ALL_SOURCES.filter((k) => !read.includes(k));
    const window = {
        recentFrom: (0, clientDrift_1.localDayKey)(recentStart),
        historyFrom: (0, clientDrift_1.localDayKey)(historyStart),
        today: (0, clientDrift_1.localDayKey)(now),
    };
    const lines = [];
    lines.push(lastSeen
        ? `Last thing on record: ${exports.SOURCE_LABEL[lastSeen.kind].replace(/s$/, '')} on ${readableDay(lastSeen.day)}`
            + (d.quietDays != null ? ` — ${plural(d.quietDays, 'day')} ago.` : '.')
        : `Nothing on record at all, from any source.`);
    lines.push(`${readableDay(window.recentFrom)} to ${readableDay(window.today)}: `
        + (recentDays.length ? `${plural(recentDays.length, 'active day')} — ${recentDays.map((r) => readableDay(r.day)).join(', ')}.`
            : 'no active days.'));
    lines.push(`${readableDay(window.historyFrom)} to ${readableDay(window.recentFrom)}: `
        + (d.baselineSpanDays == null
            ? 'not on your book yet, so there is no baseline to compare against.'
            : baselineDays.length
                ? `${plural(baselineDays.length, 'active day')} over ${d.baselineSpanDays} days`
                    + (d.baselinePerWeek != null ? ` — ${d.baselinePerWeek} a week.` : ', which is too few to call a pattern.')
                : 'no active days, so there is no pattern to have broken.'));
    lines.push(`Read: ${read.map((k) => exports.SOURCE_LABEL[k]).join(', ')}.`
        + (notRead.length ? ` Not read: ${notRead.map((k) => exports.SOURCE_LABEL[k]).join(', ')}.` : ''));
    lines.push(exports.WHAT_IT_CANNOT_SEE);
    return { lastSeen, recentDays, baselineDays, window, seen, silent, notRead, lines };
}
exports.WITHHELD_NOTE = {
    'no-account': 'Added by hand, with no Repple account — there is nothing to read and no thread to write in.',
    'read-failed': 'Their training record could not be read, so nothing can be said about it. Not the same as quiet.',
    'read-partial': 'Only part of their record came back. A gap in it would look exactly like silence.',
};
/**
 * The statuses that earn a suggestion, and the two that do not.
 *
 * `at_risk` — well down on their own rate — and `idle` — nothing to judge them
 * on at all — are the two the coach has something to do about. clientDrift's
 * header makes the case for the second and it is the one worth restating: a
 * client the record knows nothing about is the one most likely to have already
 * gone, and burying them under the measurable cases is the bug.
 *
 * `watch` is deliberately NOT here. It is a client who is down and not far
 * down, which describes a busy fortnight as often as it describes anything, and
 * a suggestion per busy fortnight per client is precisely the nagging that
 * makes a coach stop reading. They are still on the Clients tab, in their own
 * band, where a coach who wants to look can look.
 */
function earnsNudge(d) {
    return d.status === 'at_risk' || d.status === 'idle';
}
/**
 * The whole board, from what was read and what the coach has already done.
 *
 * The order of the three refusals matters and is the order below:
 *
 *   1. an unread client is withheld — BEFORE any drift is computed for them,
 *      so there is no verdict lying around for a later edit to start using;
 *   2. a muted client is set aside — assessed, so the bands are still true, but
 *      never surfaced as a suggestion;
 *   3. everybody else is assessed, and the ones the record has something to say
 *      about are drafted for.
 */
function buildNudgeBoard(candidates, records, opts = {}) {
    const now = opts.now ?? Date.now();
    const windows = opts.windows ?? clientDrift_1.DEFAULT_WINDOWS;
    const nudges = [];
    const muted = [];
    const withheld = [];
    const watching = [];
    const assessedDrifts = [];
    for (const c of candidates) {
        // 1 · not read. No drift is computed at all, not even privately.
        if (!c.activity.read) {
            const why = c.activity.why;
            withheld.push({ clientId: c.clientId, name: c.name, why, note: exports.WITHHELD_NOTE[why] });
            continue;
        }
        const d = (0, clientDrift_1.assessDrift)({ clientId: c.clientId, events: c.activity.events, since: c.since ?? null }, now, windows);
        assessedDrifts.push(d);
        // 2 · already acted on. Set aside whether or not they earn a nudge, so a
        // client who recovers inside their own mute window does not pop back up as
        // a suggestion and then vanish again.
        const m = mutedBy(records, c.clientId, now);
        if (m) {
            muted.push({ clientId: c.clientId, name: c.name, drift: d, muted: m });
            continue;
        }
        // 3 · a slip rather than a break. Collected, never drafted for. The order
        //     matters: this sits AFTER the mute check, so a client the coach has
        //     already contacted does not reappear in the weekly digest either.
        if (d.status === 'watch') {
            watching.push({ clientId: c.clientId, name: c.name, drift: d, observed: observedLine(d) });
            continue;
        }
        if (!earnsNudge(d))
            continue;
        nudges.push({
            clientId: c.clientId,
            name: c.name,
            drift: d,
            observed: observedLine(d),
            caveat: exports.WHAT_IT_CANNOT_SEE,
            draft: draftMessage(c.name, d),
            pace: (0, interventions_1.paceOf)(d, opts.bounds),
            mutedDaysIfSent: mutedDaysFor('sent', d, opts.bounds),
            mutedDaysIfDismissed: mutedDaysFor('dismissed', d, opts.bounds),
        });
    }
    nudges.sort((a, b) => (0, clientDrift_1.compareDrift)(a.drift, b.drift));
    // Worst first inside the band, on the same comparator the suggestions use, so
    // a client does not change position by moving between the two lists.
    watching.sort((a, b) => (0, clientDrift_1.compareDrift)(a.drift, b.drift));
    // Soonest back first: the coach's next question about this list is which of
    // them they will be asked about again, not which was set aside longest ago.
    muted.sort((a, b) => a.muted.endsMs - b.muted.endsMs || a.clientId.localeCompare(b.clientId));
    return {
        nudges,
        muted,
        withheld,
        watching,
        summary: assessedDrifts.length ? (0, clientDrift_1.summariseDrift)(assessedDrifts) : null,
        assessed: assessedDrifts.length,
    };
}
/* ── the watch band, once a week ───────────────────────────────────────────── */
/**
 * The week a moment falls in, on a LOCAL week boundary.
 *
 * Local rather than UTC for the same reason `localDayKey` is: a coach in
 * Auckland opening the app as their week turns over is in a new week, and a UTC
 * key would keep them in the old one until lunchtime. WHICH day opens the week
 * is src/lib/weekStart.ts's decision and not this file's.
 *
 * The exact ISO-8601 week number is deliberately NOT computed. This string is
 * compared against itself and never displayed or parsed, so the only property
 * it needs is that it changes exactly once per week — and the year-boundary
 * arithmetic real ISO weeks require is a well-known source of off-by-one bugs
 * for a value nobody reads. It is the opening day's own date instead, which has
 * the property and cannot be wrong.
 *
 * ── Keys written by an older build ────────────────────────────────────────
 *
 * Two AsyncStorage keys hold a value this function produced —
 * `repple.watchDigest.week` (src/ui/nudges.ts) and `repple.coachBacklog.week`
 * (src/lib/coachReminders.ts). Every value written before the week moved is a
 * Monday's date; every value written after is a Sunday's, so the two sets can
 * never collide. Both readers ask `!== weekKey(now)`, so a stored Monday reads
 * as "a different week" and the digest or the prompt appears ONCE more than it
 * strictly owed, then stores a new key and is correct for ever after. The
 * failure direction is showing a coach something twice, never suppressing it —
 * which is why the keys are not moved. Do not "tidy" this into an ordering
 * comparison: an older Monday key would then read as the current week and
 * silently swallow the first digest after the change.
 */
function weekKey(now = Date.now()) {
    return (0, weekStart_1.weekStartIso)(now);
}
/**
 * Whether the weekly watch digest is owed.
 *
 * `seen` is the week key the coach last closed it on, or null if never. The
 * comparison is inequality and not "is older than": a stored key from a future
 * week (a handset whose clock was wrong, a restored backup) must resolve to
 * "show it", because the alternative is a digest that never appears again.
 *
 * There are no rows in the argument on purpose. Whether the digest is DUE is a
 * question about the calendar; whether it has anything IN it is a separate
 * question the caller asks with `rows.length`. Folding them together would mean
 * a quiet week silently consumed a coach's digest for that week.
 */
function watchDigestDue(seen, now = Date.now()) {
    return !seen || seen !== weekKey(now);
}
/**
 * The digest's own sentence.
 *
 * Says what the band IS and what it is not, because "watch" is an internal word
 * and a coach reading it as a verdict about the person is the failure this
 * whole module is written against. It also says out loud that nothing here is a
 * suggestion — the absence of a Write a Message button on these rows is the
 * design, and an absence explains nothing on its own.
 */
function watchDigestNote(rows) {
    if (rows.length === 0) {
        return 'Nobody assessed has slipped without breaking their pattern this week.';
    }
    return `${plural(rows.length, 'client')} on your book ${rows.length === 1 ? 'is' : 'are'} doing less than they were, `
        + 'and not by enough to be called quiet. There is nothing drafted for them and nothing to act on today — '
        + 'this is the week where a word costs least.';
}
/**
 * The line under the heading, which has to be true in all four states.
 *
 * Null in means null out, the same rule `summariseDrift` follows: before the
 * read lands there is no number of clients to nudge, and printing "0 to
 * contact" while it is in flight tells a coach their week is clear.
 */
function boardNote(b) {
    if (b == null)
        return 'Reading who has gone quiet…';
    const parts = [];
    parts.push(b.nudges.length
        ? `${plural(b.nudges.length, 'client')} worth a message.`
        : b.assessed
            ? 'Nobody to chase — everybody assessed is holding their pattern or has been contacted.'
            : 'Nobody could be assessed.');
    if (b.muted.length)
        parts.push(`${b.muted.length} set aside.`);
    if (b.withheld.length) {
        parts.push(`${plural(b.withheld.length, 'client')} could not be assessed, so this list is not the whole book.`);
    }
    return parts.join(' ');
}
