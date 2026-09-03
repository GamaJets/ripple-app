"use strict";
// The intervention loop: surface, contact, record what was tried, measure.
//
// Framework-free, and further than most of the modules go: there is not even a
// Supabase client in here, nor anything it imports. Every function takes rows
// and returns a conclusion, so the same reasoning runs in the Studio console,
// in a test under plain node, and anywhere else that holds the rows. The reads
// and the one write stay in the screen, because the reads are where the failure
// modes live and each screen has to render its own.
//
// ── What was already true, and what was missing ────────────────────────────
//
// Retention SURFACES people. `assessDrift` (clientDrift.ts) measures a break in
// a person's own pattern and returns UNKNOWN rather than "fine" when there is
// no baseline; `retentionRead` (memberView.ts) separates somebody who moved to
// the gym floor from somebody who stopped; `buildGymRetention` rolls both up.
// Three screens name the same member.
//
// None of them could record that anybody was contacted. Which means the same
// name surfaced every Monday, two members of staff rang her in the same week,
// and the gym could never answer the only question that matters about any of
// this: does what we do make any difference?
//
// "Measure" is the hard half. Most of this file is about refusing to answer it
// badly.
//
// ── THE FOUR THINGS THIS MODULE MUST NOT DO ────────────────────────────────
//
// 1. A CONTACT IS NOT ATTENDANCE. Nothing here produces an `ActivityEvent`, and
//    `member_interventions` is not one of the parts a `RetentionRecord`
//    carries. Every function below takes a FINISHED `Drift` as input and never
//    contributes to one. If logging a call moved a member's verdict toward
//    healthy, the loop would feed the gym its own activity back as retention —
//    it would look most effective at the exact moment it stopped working.
//
// 2. AN INTERVENTION LOGGED YESTERDAY CANNOT BE JUDGED. The minimum window
//    comes from the member's OWN pattern, not from a fixed number of days:
//    somebody who trained four times a week is visibly absent in a fortnight,
//    somebody who trained fortnightly is not visible either way for six weeks.
//    Until the window passes, `assessFollowUp` returns UNKNOWN and says how
//    long is left. Never "no effect" — that is a claim, and it is the claim a
//    gym would act on by giving up on somebody too early.
//
// 3. ATTRIBUTION IS A CLAIM THE RECORD CANNOT MAKE. A member who came back may
//    have come back anyway. So the verdict is a SEQUENCE — their pattern
//    recovered, held, or kept falling AFTER the contact — and the word "worked"
//    appears nowhere. There is no success rate on `FollowUpTally`, and
//    `WHY_NO_RATE` below says in the module what the screen says on the page.
//
// 4. QUIETENING IS NOT HIDING. A member contacted last week drops to the bottom
//    of her band, greyed, with who called and when. She does not leave the
//    list. A filter would mean a gym stops seeing a member who is still
//    leaving, which is a worse failure than showing her twice.
//
// Everything derived is `T | null`, and null means "not knowable from what was
// read". A rate over zero attempts is null, never 0%.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WHY_NO_RATE = exports.BACK_TO_BASELINE_FRACTION = exports.MEANINGFUL_MOVE_FRACTION = exports.MEANINGFUL_MOVE_PER_WEEK = exports.FOLLOW_UP_LABEL = exports.FOLLOW_UP_CONTACT_DAYS = exports.FOLLOW_UP_READ_DAYS = exports.DEFAULT_COOLDOWN_DAYS = exports.MAX_COOLDOWN_DAYS = exports.MIN_COOLDOWN_DAYS = exports.MIN_JUDGE_DAYS = exports.COOLDOWN_GAPS = exports.JUDGE_GAPS = exports.OUTCOME_LABEL = exports.CONTACT_OUTCOMES = exports.CHANNEL_LABEL = exports.CHANNELS = void 0;
exports.landed = landed;
exports.contactsFor = contactsFor;
exports.lastContactFor = lastContactFor;
exports.contactBy = contactBy;
exports.triedLine = triedLine;
exports.cooldownFloor = cooldownFloor;
exports.paceFor = paceFor;
exports.paceOf = paceOf;
exports.paceNote = paceNote;
exports.surfaceOrder = surfaceOrder;
exports.quietenedCount = quietenedCount;
exports.assessFollowUp = assessFollowUp;
exports.summariseFollowUps = summariseFollowUps;
exports.loopHeadline = loopHeadline;
exports.assessAllFollowUps = assessAllFollowUps;
const clientDrift_1 = require("./clientDrift");
const DAY = 86400000;
exports.CHANNELS = ['call', 'text', 'email', 'whatsapp', 'app_message', 'in_person', 'other'];
exports.CHANNEL_LABEL = {
    call: 'Phone call',
    text: 'Text',
    email: 'Email',
    whatsapp: 'WhatsApp',
    app_message: 'App message',
    in_person: 'In person',
    other: 'Other',
};
exports.CONTACT_OUTCOMES = [
    'reached', 'replied', 'no_answer', 'left_message', 'bounced', 'declined', 'unknown',
];
exports.OUTCOME_LABEL = {
    reached: 'Spoke to them',
    replied: 'They replied',
    no_answer: 'No answer',
    left_message: 'Left a message',
    bounced: 'Number or address is dead',
    declined: 'Said they are not coming back',
    unknown: 'Not recorded',
};
/** Whether anybody on the other end actually received it. Null for 'unknown' —
 *  a row nobody finished is not evidence either way. */
function landed(o) {
    switch (o) {
        case 'reached':
        case 'replied':
        case 'declined': return true;
        case 'no_answer':
        case 'bounced': return false;
        // A message left on an answerphone reached the phone. Whether it reached
        // the person is exactly what nobody knows, and guessing either way here
        // would decide it.
        case 'left_message': return null;
        case 'unknown': return null;
    }
}
/** Newest first. Rows with an unparseable `at` are dropped rather than sorted
 *  to one end, where they would silently become "the most recent contact". */
function contactsFor(contacts, memberId) {
    return contacts
        .filter((c) => c.memberId === memberId && !Number.isNaN(Date.parse(c.at)))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
/** The most recent contact for one member, or null when there is none. */
function lastContactFor(contacts, memberId) {
    return contactsFor(contacts, memberId)[0] ?? null;
}
/** Who to say made the call. Never the raw uuid dressed up as a name. */
function contactBy(c) {
    const n = c.byName?.trim();
    return n ? n : null;
}
/** A short line for a row: what was tried, by whom, when. */
function triedLine(c, now = Date.now()) {
    const d = daysSince(c.at, now);
    const who = contactBy(c);
    const when = d == null ? 'at an unreadable time' : d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
    const by = who ? ` by ${who}` : '';
    return `${exports.CHANNEL_LABEL[c.channel]}${by}, ${when} — ${exports.OUTCOME_LABEL[c.outcome].toLowerCase()}.`;
}
/** Three ordinary gaps: enough that a member at their old rate would have been
 *  in several times, and a member who has stopped has visibly not been. */
exports.JUDGE_GAPS = 3;
/** Two gaps before calling again: long enough that the first call has had its
 *  chance, short enough that a keen member is not left for a month. */
exports.COOLDOWN_GAPS = 2;
/** Nothing is judgeable in under a fortnight, however often somebody trained.
 *  A daily trainer's three gaps is three days, and three days is a weekend. */
exports.MIN_JUDGE_DAYS = 14;
/** Cooldown floor and ceiling. A week is the shortest decent gap between two
 *  approaches to the same person; a month is the longest silence that still
 *  counts as trying. */
exports.MIN_COOLDOWN_DAYS = 7;
exports.MAX_COOLDOWN_DAYS = 28;
/** When there is no pattern to pace against. A fortnight, stated rather than
 *  derived, because it is a convention rather than a measurement. */
exports.DEFAULT_COOLDOWN_DAYS = 14;
/**
 * How many days of activity a caller must read before any of this can be
 * judged, and why it is not the drift window.
 *
 * `assessFollowUp` measures a member against their own settled pattern AS IT
 * STOOD ON THE DAY OF THE CALL, so a contact made ninety days ago needs the
 * drift history sitting BEHIND that day, not in front of it. A caller who read
 * only `DriftWindows.historyDays` would get `outside-the-read` on every contact
 * older than eight weeks — which is honest, and is also every contact old
 * enough to have an answer, so the loop would be permanently empty.
 *
 * 180 days is `FOLLOW_UP_CONTACT_DAYS` of contacts plus `DEFAULT_WINDOWS.
 * historyDays` of pattern behind the oldest of them, rounded up. It is a read
 * size and nothing is inferred from it: a caller still passes `readFromMs`, and
 * a contact older than the read is still refused by name rather than judged
 * against a baseline nobody read.
 */
exports.FOLLOW_UP_READ_DAYS = 180;
/**
 * How far back a screen should look for contacts to judge.
 *
 * Older contacts are not wrong, they are simply about a person the coach has
 * had four months of subsequent contact with, and stacking them into one tally
 * says less each time it grows. Kept strictly inside `FOLLOW_UP_READ_DAYS` so
 * every contact offered for judgement has its own baseline inside the read.
 */
exports.FOLLOW_UP_CONTACT_DAYS = 120;
/** The floor to use, from a coach's preference. Anything outside a day to a
 *  year is refused rather than clamped: a stored 0 or a stored 100000 is a bad
 *  write or an older build's field, and honouring it would either nag daily or
 *  silence a client for three centuries. Refusing falls back to the module's
 *  own number, which is a defensible answer; clamping would invent one the
 *  coach never chose. */
function cooldownFloor(bounds) {
    const v = bounds?.minCooldownDays;
    if (v == null || !Number.isFinite(v))
        return exports.MIN_COOLDOWN_DAYS;
    const n = Math.round(v);
    return n >= 1 && n <= 365 ? n : exports.MIN_COOLDOWN_DAYS;
}
function paceFor(baselinePerWeek, bounds) {
    const floor = cooldownFloor(bounds);
    if (baselinePerWeek == null || !(baselinePerWeek > 0)) {
        return {
            expectedGapDays: null,
            // With no pattern the number is a convention rather than a measurement —
            // and where the coach has stated their own convention, theirs is the one
            // that applies. Only when they have not does the module's fortnight stand.
            cooldownDays: bounds?.minCooldownDays != null && floor !== exports.MIN_COOLDOWN_DAYS
                ? floor
                : exports.DEFAULT_COOLDOWN_DAYS,
            judgeAfterDays: null,
            basis: 'no-pattern',
        };
    }
    const gap = 7 / baselinePerWeek;
    return {
        expectedGapDays: round1(gap),
        // The ceiling is raised to meet a floor above it rather than the floor being
        // pushed down to meet the ceiling. A coach who typed 45 gets 45.
        cooldownDays: clamp(Math.round(gap * exports.COOLDOWN_GAPS), floor, Math.max(exports.MAX_COOLDOWN_DAYS, floor)),
        judgeAfterDays: Math.max(exports.MIN_JUDGE_DAYS, Math.round(gap * exports.JUDGE_GAPS)),
        basis: 'own-pattern',
    };
}
/** The pace for a member, from their drift verdict. A member with no verdict at
 *  all — nothing that records attendance was read — paces as no-pattern, which
 *  is the honest reading: we do not know how often they came. */
function paceOf(drift, bounds) {
    return paceFor(drift?.baselinePerWeek ?? null, bounds);
}
/** Why this member's window is the length it is, in a sentence. */
function paceNote(p) {
    if (p.basis === 'no-pattern') {
        return `No settled pattern to pace against, so nothing here is judged and a ${p.cooldownDays}-day gap between approaches is a convention rather than a measurement.`;
    }
    return `They trained about every ${p.expectedGapDays} day${p.expectedGapDays === 1 ? '' : 's'}, so ${p.judgeAfterDays} days have to pass before anything can be said, and a second approach waits ${p.cooldownDays}.`;
}
/**
 * Re-order a surfaced list so that people somebody has just contacted sink
 * within their band, and nobody is removed.
 *
 * The cross-band order is untouched. A drifting member contacted on Tuesday
 * still sits above every steady member, because she is still drifting — the
 * call did not change that and must not appear to. What changes is which of the
 * drifting members the gym looks at first, which is the actual question the
 * list is answering.
 *
 * `rows` is expected in the order `buildGymRetention` produced, where bands are
 * contiguous. The partition below is stable and works run by run, so anything
 * the caller had already decided inside a band survives.
 *
 * IT NEVER DROPS A ROW. The output length always equals the input length, and
 * the tests assert it, because "contacted, so no longer visible" is the exact
 * failure this design exists to avoid: a gym that stops seeing a member who is
 * still leaving has replaced a nuisance with a blind spot.
 */
function surfaceOrder(rows, contacts, opts = {}) {
    const now = opts.now ?? Date.now();
    const wrapped = rows.map((row) => surfaceOne(row, contacts, now));
    const out = [];
    let i = 0;
    while (i < wrapped.length) {
        const key = bandKey(wrapped[i].row.drift);
        let j = i;
        while (j < wrapped.length && bandKey(wrapped[j].row.drift) === key)
            j++;
        const run = wrapped.slice(i, j);
        const loud = run.filter((s) => !s.quietened);
        // Among the quietened, the ones closest to coming back up lead — they are
        // the ones the gym will be looking at next week.
        const quiet = run.filter((s) => s.quietened)
            .sort((a, b) => (a.quietForDays ?? 0) - (b.quietForDays ?? 0));
        out.push(...loud, ...quiet);
        i = j;
    }
    return out;
}
function bandKey(d) {
    return d == null ? 'not-judged' : d.status;
}
function surfaceOne(row, contacts, now) {
    const mine = contactsFor(contacts, row.memberId);
    const last = mine[0] ?? null;
    const pace = paceOf(row.drift);
    const since = last ? daysSince(last.at, now) : null;
    // An unreadable date is not a recent contact. Quietening on it would push
    // somebody down the list on the strength of a row nobody can date.
    const quietened = since != null && since < pace.cooldownDays;
    return {
        row,
        contact: last,
        contactedDaysAgo: since,
        contactCount: mine.length,
        pace,
        quietened,
        quietForDays: quietened ? pace.cooldownDays - since : null,
        label: last ? triedLine(last, now) : null,
    };
}
/** How many of a surfaced list are quietened, so the screen can say it out loud
 *  rather than leaving the order unexplained. */
function quietenedCount(list) {
    return list.filter((s) => s.quietened).length;
}
exports.FOLLOW_UP_LABEL = {
    recovered: 'Came back',
    held: 'Held where they were',
    'kept-falling': 'Kept falling',
};
/** The move that counts as a move. Half a day a week is one extra active day in
 *  a fortnight — the smallest change that is a change rather than a rounding of
 *  somebody's Tuesday. Scaled up against a bigger baseline, because half a day
 *  a week is noise for a member who trained five times a week. */
exports.MEANINGFUL_MOVE_PER_WEEK = 0.5;
exports.MEANINGFUL_MOVE_FRACTION = 0.25;
/** Back at this much of their own baseline counts as back. Not 100%: a member
 *  who used to come four times and now comes three has come back. */
exports.BACK_TO_BASELINE_FRACTION = 0.7;
/**
 * What happened after one contact.
 *
 * `now` is an argument rather than ambient so a test and a screen agree, and so
 * two verdicts on the same page cannot be computed either side of midnight.
 *
 * THE ORDER OF THE REFUSALS MATTERS. Unreadable date, then outside the read,
 * then no baseline, then re-contacted, then too early. Each says something true
 * that the next one could not; reversing any pair would report a fact about the
 * query as a fact about the member.
 */
function assessFollowUp(input, now = Date.now()) {
    const windows = input.windows ?? clientDrift_1.DEFAULT_WINDOWS;
    const c = input.contact;
    const at = Date.parse(c.at);
    const blank = (blocked, reason, pace, extra = {}) => ({
        contactId: c.id,
        memberId: c.memberId,
        verdict: 'unknown',
        blocked,
        baselinePerWeek: null,
        beforePerWeek: null,
        afterPerWeek: null,
        movePerWeek: null,
        backToBaseline: null,
        pace,
        observedDays: null,
        daysToWait: null,
        reason,
        ...extra,
    });
    const noPace = paceFor(null);
    if (Number.isNaN(at)) {
        return blank('unreadable-date', 'This row does not carry a readable date, so there is no window to measure from.', noPace);
    }
    const evs = parsed(input.events);
    const baselineFrom = at - windows.historyDays * DAY;
    // Did we read far enough back to know what she used to do? A read that starts
    // after the baseline window would produce a low baseline built out of the
    // query's own edge, and every contact before it would be reported as a
    // recovery from a pattern the member never had.
    const readFrom = input.readFromMs ?? null;
    if (readFrom != null && readFrom > baselineFrom) {
        const short = Math.ceil((readFrom - baselineFrom) / DAY);
        return blank('outside-the-read', `This contact is older than the attendance history read here — it needs ${short} more day${short === 1 ? '' : 's'} of record before it to say what their pattern was. Not judged, rather than judged on a short baseline.`, noPace);
    }
    // Their settled pattern as it stood on the day of the call: the same shape
    // `assessDrift` uses, wound back to `at` rather than to now. Wound back on
    // purpose — a contact three months ago must be judged against what the gym
    // could see then, not against a window that now sits entirely after it.
    const baselineTo = at - windows.recentDays * DAY;
    const baselineSpan = (baselineTo - baselineFrom) / DAY;
    const baselineActive = activeDaysIn(evs, baselineFrom, baselineTo);
    const hasBaseline = baselineSpan >= clientDrift_1.MIN_BASELINE_SPAN_DAYS && baselineActive >= clientDrift_1.MIN_BASELINE_ACTIVE_DAYS;
    const baselinePerWeek = hasBaseline ? round1(baselineActive / (baselineSpan / 7)) : null;
    const pace = paceFor(baselinePerWeek);
    if (baselinePerWeek == null) {
        return blank('no-baseline', baselineActive === 0
            ? `Nothing recorded in the ${Math.round(windows.historyDays)} days before this contact, so there is no pattern to compare anything against. Not "no effect" — no measurement.`
            : `Only ${baselineActive} active day${baselineActive === 1 ? '' : 's'} before this contact — no settled pattern to judge a change against.`, pace, { baselinePerWeek: null });
    }
    const beforeActive = activeDaysIn(evs, baselineTo, at);
    const beforePerWeek = round1(beforeActive / (windows.recentDays / 7));
    const judgeAfter = pace.judgeAfterDays; // non-null whenever baselinePerWeek is
    // The window ends at the first of: now, the far end of the window, or the
    // next contact. A second call inside the first one's window contaminates it —
    // whatever happens next follows two things, and the record cannot say which.
    const nextAt = input.nextContactAt ? Date.parse(input.nextContactAt) : NaN;
    const cutByNext = !Number.isNaN(nextAt) && nextAt > at && nextAt < at + judgeAfter * DAY && nextAt <= now;
    const windowEnd = Math.min(now, at + judgeAfter * DAY, cutByNext ? nextAt : Infinity);
    const observedDays = Math.max(0, Math.floor((windowEnd - at) / DAY));
    const partial = {
        baselinePerWeek,
        beforePerWeek,
        pace,
        observedDays,
    };
    if (cutByNext) {
        const d = Math.max(0, Math.floor((nextAt - at) / DAY));
        return blank('recontacted', `Somebody contacted them again after ${d} day${d === 1 ? '' : 's'}, inside the ${judgeAfter} days this one needed. Whatever happened next followed both, and the record cannot say which — so neither is credited.`, pace, partial);
    }
    if (observedDays < judgeAfter) {
        const left = judgeAfter - observedDays;
        return blank('too-early', `${observedDays} of ${judgeAfter} days. They trained about every ${pace.expectedGapDays} day${pace.expectedGapDays === 1 ? '' : 's'}, so ${left} more day${left === 1 ? '' : 's'} have to pass before their absence or return means anything.`, pace, { ...partial, daysToWait: left });
    }
    const afterActive = activeDaysIn(evs, at, windowEnd + 1);
    const afterPerWeek = round1(afterActive / (observedDays / 7));
    const move = round1(afterPerWeek - beforePerWeek);
    const threshold = Math.max(exports.MEANINGFUL_MOVE_PER_WEEK, exports.MEANINGFUL_MOVE_FRACTION * baselinePerWeek);
    const backToBaseline = afterPerWeek >= exports.BACK_TO_BASELINE_FRACTION * baselinePerWeek;
    const verdict = move >= threshold ? 'recovered' : move <= -threshold ? 'kept-falling' : 'held';
    return {
        contactId: c.id,
        memberId: c.memberId,
        verdict,
        blocked: null,
        baselinePerWeek,
        beforePerWeek,
        afterPerWeek,
        movePerWeek: move,
        backToBaseline,
        pace,
        observedDays,
        daysToWait: null,
        reason: followUpReason(verdict, baselinePerWeek, beforePerWeek, afterPerWeek, observedDays, backToBaseline),
    };
}
function followUpReason(v, base, before, after, days, back) {
    const rate = (n) => `${n} day${n === 1 ? '' : 's'} a week`;
    const tail = `In the ${days} days since: ${rate(after)}. They were on ${rate(before)} when the gym got in touch, against their own ${rate(base)}.`;
    switch (v) {
        case 'recovered':
            return back
                ? `Training picked up and is back around what they used to do. ${tail} This is what followed the contact, not proof it caused it.`
                : `Training picked up, though still short of their own pattern. ${tail} This is what followed the contact, not proof it caused it.`;
        case 'kept-falling':
            return `Training kept falling after the contact. ${tail}`;
        default:
            return after === 0 && before === 0
                ? `Still nothing recorded either side of the contact. ${tail}`
                : `Training held about where it was. ${tail}`;
    }
}
/* ── adding it up, without inventing a rate ────────────────────────────────── */
/**
 * WHY THERE IS NO SUCCESS RATE ON THIS TYPE.
 *
 * Every member in this tally was contacted BECAUSE she was drifting. That is
 * the whole point of the loop, and it is also what makes "38% came back" a
 * number about nothing: there is no comparable group of drifting members who
 * were left alone, so there is nothing for 38% to be higher or lower than.
 * Regression to the mean alone would produce a healthy-looking figure — the
 * people furthest below their own average are, on average, the people most
 * likely to move back toward it whatever anybody does.
 *
 * The only way to get an honest causal number is to deliberately not contact
 * some of the members who need contacting, and then compare. A gym should not
 * do that to its members, and this module is not going to imply it did.
 *
 * So what is reported is counts of what followed, with the word "followed" kept
 * in front of them, and the refusals kept visible beside them — because "we
 * cannot tell yet" is most of the answer in the first months of using this, and
 * folding those rows away would make the loop look more conclusive than it is.
 */
exports.WHY_NO_RATE = 'No percentage is shown, and there is not one to show. Everybody here was contacted because they were drifting, so there is no comparable group who were left alone — and members furthest below their own average tend to drift back toward it regardless, which would flatter any figure taken from this table alone. These are counts of what FOLLOWED each contact, in sequence. None of them is evidence that the contact caused it.';
/**
 * Count what followed. Null in, null out: "not read yet" is not "nothing has
 * been tried", and a screen that printed 0 for the first has told the gym its
 * staff have done nothing.
 *
 * There is deliberately no rate on the returned object — see `WHY_NO_RATE`. The
 * coverage tests assert the absence, so that adding one is a visible decision
 * rather than a convenience somebody reaches for on a Friday.
 */
function summariseFollowUps(list) {
    if (list == null)
        return null;
    const t = {
        total: list.length, judged: 0, recovered: 0, held: 0, keptFalling: 0,
        tooEarly: 0, noBaseline: 0, recontacted: 0, outsideTheRead: 0, unreadable: 0,
    };
    for (const f of list) {
        switch (f.verdict) {
            case 'recovered':
                t.recovered++;
                t.judged++;
                break;
            case 'held':
                t.held++;
                t.judged++;
                break;
            case 'kept-falling':
                t.keptFalling++;
                t.judged++;
                break;
            default:
                switch (f.blocked) {
                    case 'too-early':
                        t.tooEarly++;
                        break;
                    case 'no-baseline':
                        t.noBaseline++;
                        break;
                    case 'recontacted':
                        t.recontacted++;
                        break;
                    case 'outside-the-read':
                        t.outsideTheRead++;
                        break;
                    default:
                        t.unreadable++;
                        break;
                }
        }
    }
    return t;
}
/** The sentence above the tally, or null when nothing has been tried at all. */
function loopHeadline(t) {
    if (t == null || t.total === 0)
        return null;
    if (t.judged === 0) {
        return `${t.total} contact${t.total === 1 ? '' : 's'} recorded, none of them old enough or backed by enough history to say what followed. That is the honest state of a loop that has just started, not a result.`;
    }
    const parts = [
        `${t.recovered} followed by training picking back up`,
        `${t.held} by no change`,
        `${t.keptFalling} by a further fall`,
    ];
    const waiting = t.tooEarly + t.noBaseline + t.recontacted + t.outsideTheRead + t.unreadable;
    let out = `Of ${t.total} contact${t.total === 1 ? '' : 's'}, ${t.judged} can be looked at: ${parts.join(', ')}.`;
    if (waiting)
        out += ` The other ${waiting} cannot be judged yet.`;
    return out;
}
/**
 * Every contact in the gym, each with what followed it.
 *
 * `eventsFor` is a lookup rather than a map argument so the caller keeps
 * control of what "no events for this member" means — return an empty array for
 * a member who did nothing, and this module's own `readFromMs` guard covers the
 * case where the record simply was not read that far back.
 *
 * Contacts for the same member are walked newest-first so each one knows the
 * contact that came AFTER it, which is what truncates its window.
 */
function assessAllFollowUps(contacts, eventsFor, opts = {}) {
    const now = opts.now ?? Date.now();
    const byMember = new Map();
    for (const c of contacts) {
        const list = byMember.get(c.memberId) ?? [];
        list.push(c);
        byMember.set(c.memberId, list);
    }
    const out = [];
    for (const [memberId, list] of byMember) {
        const ordered = contactsFor(list, memberId); // newest first
        const events = eventsFor(memberId);
        for (let i = 0; i < ordered.length; i++) {
            // The one after this in time is the one immediately before it in a
            // newest-first list.
            const next = i > 0 ? ordered[i - 1].at : null;
            out.push(assessAllOne(ordered[i], events, next, opts, now));
        }
        // Any row whose date would not parse was dropped by `contactsFor`. It still
        // has to be reported — a row nobody can date is a row the gym typed, and
        // silently losing it would under-count what its staff actually did.
        for (const c of list) {
            if (Number.isNaN(Date.parse(c.at))) {
                out.push(assessFollowUp({ contact: c, events, windows: opts.windows }, now));
            }
        }
    }
    return out.sort((a, b) => a.contactId.localeCompare(b.contactId));
}
function assessAllOne(contact, events, nextContactAt, opts, now) {
    return assessFollowUp({
        contact,
        events,
        nextContactAt,
        readFromMs: opts.readFromMs ?? null,
        windows: opts.windows,
    }, now);
}
/* ── helpers (private) ─────────────────────────────────────────────────────── */
/** LOCAL calendar day, matching streaks.ts and clientDrift.ts: an evening
 *  session belongs to that evening, not to the next UTC day. */
function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parsed(events) {
    const out = [];
    for (const e of events) {
        const at = Date.parse(e.at);
        if (Number.isNaN(at))
            continue;
        out.push({ at });
    }
    return out;
}
/** Active DAYS, de-duplicated — the same unit clientDrift uses. Logging five
 *  exercises in one session is one day of training, and counting it as five
 *  would let a single busy evening cover a fortnight of silence. */
function activeDaysIn(evs, fromMs, toMs) {
    const days = new Set();
    for (const e of evs)
        if (e.at >= fromMs && e.at < toMs)
            days.add(dayKey(e.at));
    return days.size;
}
function daysSince(iso, now) {
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        return null;
    return Math.max(0, Math.floor((now - t) / DAY));
}
const round1 = (n) => Math.round(n * 10) / 10;
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
