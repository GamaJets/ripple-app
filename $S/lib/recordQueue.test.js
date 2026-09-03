"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The member-record kinds the outbox did not have. Compile with tsc, run with
// node.
//
// Four failures are guarded here, and the first is the one that would be
// invisible:
//
//   1. A PLANNED DAY REPLAYED AFTER ITS OWN DAY. `canPlan` refuses to mark a
//      date that has gone, and says why: a mark on last Tuesday is a claim about
//      what happened, not a plan. A queue that replayed one would be that
//      refusal defeated from behind, and nothing on any screen would say so.
//      The expiry is what stops it, so the expiry is asserted under the zones
//      this repo runs its tests in — a bare date parsed as UTC is the wrong day
//      for half the planet, which is the bug src/lib/localDate.ts exists for.
//
//   2. A PAYLOAD NOTHING CAN SEND, RETRIED FOR EVER. Every `as*Intent` below
//      answers null for a payload no statement could be built from, and null is
//      what makes the handler say 'refused' and take the item out. Without it
//      the queue shows "1 goal waiting" for the life of the install.
//
//   3. A PAYLOAD COERCED INSTEAD OF REFUSED. A day type this build does not
//      know must not become 'off', and a goal with neither a number nor words
//      must not become a blank row on somebody's list. Both are the app
//      inventing a member's own record.
//
//   4. A LINE THAT CLAIMS DELIVERY. Same walk as `outboxNote` and `unsentNote`:
//      the work is safe, nobody has it, and the screen will not show it yet.
const recordQueue_1 = require("./recordQueue");
const dayPlan_1 = require("./dayPlan");
const outbox_1 = require("./outbox");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── 1 · the goal ──────────────────────────────────────────────────────── */
{
    const g = (0, recordQueue_1.asGoalIntent)({ kind: 'weight', value: 78.5, title: null, targetDate: '2026-12-01' });
    eq(g?.kind, 'weight', 'a measured goal survives the round trip');
    eq(g?.value, 78.5, 'with its number');
    eq(g?.targetDate, '2026-12-01', 'and its date');
    const c = (0, recordQueue_1.asGoalIntent)({ kind: 'custom', value: null, title: '  squat without my knee complaining  ' });
    eq(c?.title, 'squat without my knee complaining', 'a custom goal keeps its words, trimmed');
    eq(c?.targetDate, null, 'and a goal with no date has none rather than a broken one');
    eq((0, recordQueue_1.asGoalIntent)(null), null, 'nothing is not an intent');
    eq((0, recordQueue_1.asGoalIntent)({ value: 78 }), null, 'and neither is a goal with no kind');
    eq((0, recordQueue_1.asGoalIntent)({ kind: 'weight', value: 0 }), null, 'a measured goal with no number is refused rather than written as a row saying nothing');
    eq((0, recordQueue_1.asGoalIntent)({ kind: 'weight', value: 'heavy' }), null, 'and so is one whose number is not a number');
    eq((0, recordQueue_1.asGoalIntent)({ kind: 'custom', title: '   ' }), null, 'a custom goal with no words is refused for the same reason');
    eq((0, recordQueue_1.asGoalIntent)({ kind: 'weight', value: 78, targetDate: 'soon' })?.targetDate, null, 'an unreadable date becomes no date rather than a 400 on the way out');
    // A kind this build has never heard of is NOT refused here: the server owns
    // that vocabulary, and refusing locally would discard a goal set by a newer
    // build of the same app on a phone that has since been downgraded.
    ok((0, recordQueue_1.asGoalIntent)({ kind: 'vo2max', value: 48 }) !== null, 'an unfamiliar kind is left for the server to judge rather than thrown away here');
}
/* ── 2 · the planned day ───────────────────────────────────────────────── */
{
    const d = (0, recordQueue_1.asDayPlanIntent)({ dateISO: '2026-09-10', type: 'rest', note: ' flying ' });
    eq(d?.type, 'rest', 'a marked day keeps its type');
    eq(d?.note, 'flying', 'and its note, trimmed');
    eq(d?.remove, false, 'and is not mistaken for a removal');
    const rm = (0, recordQueue_1.asDayPlanIntent)({ dateISO: '2026-09-10', remove: true });
    eq(rm?.remove, true, 'taking the mark off is the same kind, said explicitly');
    eq(rm?.type, null, 'and carries no type');
    eq((0, recordQueue_1.asDayPlanIntent)({ type: 'rest' }), null, 'an intent about no day is not an intent');
    eq((0, recordQueue_1.asDayPlanIntent)({ dateISO: 'next tuesday', type: 'rest' }), null, 'and neither is one about an unreadable day');
    eq((0, recordQueue_1.asDayPlanIntent)({ dateISO: '2026-09-10', type: 'refeed' }), null, 'a day type this build does not know is refused, never coerced to Standard — that would be the app inventing somebody’s plan');
    eq((0, recordQueue_1.asDayPlanIntent)({ dateISO: '2026-09-10' }), null, 'and a mark with no type at all is not silently a removal');
}
/* ── 3 · the expiry, which is the point of the kind ────────────────────── */
{
    const today = (0, dayPlan_1.isoToday)(new Date());
    const exp = (0, recordQueue_1.planExpiry)(today);
    ok(exp !== null, 'a readable date has an expiry');
    // The boundary is the END of the day, not its start: an intent queued this
    // morning and flushed this evening is still about a day that is running, and
    // `canPlan` would still accept it.
    ok(Date.parse(exp) > Date.now(), 'today’s plan has not lapsed while today is still running');
    eq((0, dayPlan_1.canPlan)(today, today), true, 'which is the same answer canPlan gives, so the two rules agree');
    // Yesterday, built the way the month grid builds a cell rather than by string
    // arithmetic, so this holds in every zone the suite runs under.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    eq((0, dayPlan_1.canPlan)(yIso, today), false, 'yesterday cannot be planned');
    ok(Date.parse((0, recordQueue_1.planExpiry)(yIso)) <= Date.now(), 'and an intent about yesterday has already lapsed');
    // The whole point, end to end: a lapsed day-plan intent comes OUT of the live
    // list and is handed back to be said, rather than being sent.
    const item = (0, outbox_1.newItem)('day-plan', { dateISO: yIso, type: 'rest', note: null }, { expiresAt: (0, recordQueue_1.planExpiry)(yIso) });
    const split = (0, outbox_1.partitionLapsed)([item]);
    eq(split.live.length, 0, 'a plan for a day that has gone is not sent');
    eq(split.lapsed.length, 1, 'and is not discarded in silence either — the member is told');
    eq((0, recordQueue_1.planExpiry)('not a date'), null, 'an unreadable date has no expiry rather than an instant one');
    // Month ends and leap years come out of the Date normalisation for free, and
    // are asserted because "add one to the day" is exactly the line somebody
    // rewrites into string arithmetic later.
    const end = (0, recordQueue_1.planExpiry)('2026-01-31');
    eq(new Date(end).getDate(), 1, 'the day after the 31st is the 1st');
    eq(new Date(end).getMonth(), 1, 'of the next month');
    const leap = (0, recordQueue_1.planExpiry)('2028-02-28');
    eq(new Date(leap).getDate(), 29, 'and a leap year still has a 29th');
}
/* ── 4 · the reading ───────────────────────────────────────────────────── */
{
    const r = (0, recordQueue_1.asGlucoseIntent)({ mmol: 5.4, at: '2026-09-01T08:00:00.000Z' });
    eq(r?.mmol, 5.4, 'a reading keeps its value');
    eq(r?.at, '2026-09-01T08:00:00.000Z', 'and the moment it was TAKEN, which is what puts it beside the right meal');
    eq((0, recordQueue_1.asGlucoseIntent)({ at: '2026-09-01T08:00:00.000Z' }), null, 'a reading with no value is not a reading');
    eq((0, recordQueue_1.asGlucoseIntent)({ mmol: 5.4 }), null, 'and one with no moment cannot be charted, so it is refused rather than filed under now');
    eq((0, recordQueue_1.asGlucoseIntent)({ mmol: 0, at: '2026-09-01T08:00:00.000Z' }), null, 'zero is not a reading a monitor produces');
    eq((0, recordQueue_1.asGlucoseIntent)({ mmol: 5.4, at: 'this morning' }), null, 'nor is an unreadable moment tolerated');
    // The id is what makes a replay safe. `glucose_external_once` is partial on
    // `external_id is not null` and supabase/parts/102 deliberately lets a
    // hand-typed reading repeat, so the primary key is the only thing that can
    // tell "the member typed 5.4 twice" apart from "we offered 5.4 twice because
    // the first answer was lost". Without it a lost response is a second point on
    // the chart for one finger-prick.
    eq((0, recordQueue_1.asGlucoseIntent)({ id: 'row-1', mmol: 5.4, at: '2026-09-01T08:00:00.000Z' })?.id, 'row-1', 'A READING CARRIES THE ROW ID THE DEVICE CHOSE — it is what a replay collides on');
    eq((0, recordQueue_1.asGlucoseIntent)({ id: '   ', mmol: 5.4, at: '2026-09-01T08:00:00.000Z' })?.id, null, 'a blank id is no id, never a key the insert would send as whitespace');
    // A reading queued by a build that predates the id has none, and is still a
    // reading. Refusing it would discard something a member typed in order to fix
    // a duplicate they have not got.
    eq((0, recordQueue_1.asGlucoseIntent)({ mmol: 5.4, at: '2026-09-01T08:00:00.000Z' })?.id, null, 'and one queued before this field existed still drains rather than being refused');
    eq((0, recordQueue_1.asGlucoseIntent)({ mmol: 5.4, at: '2026-09-01T08:00:00.000Z' })?.mmol, 5.4, 'with its value intact');
}
/* ── 5 · the coach's paperwork ─────────────────────────────────────────── */
{
    const a = (0, recordQueue_1.asCoachDocAcceptIntent)({ documentId: 'doc-1', title: 'Studio Waiver' });
    eq(a?.documentId, 'doc-1', 'an acceptance is the document it is about');
    eq(a?.title, 'Studio Waiver', 'and carries what it was called, for a sentence on a screen');
    eq((0, recordQueue_1.asCoachDocAcceptIntent)({ title: 'Studio Waiver' }), null, 'a title with no document names nothing the server could ever store, so it is refused rather than retried for ever');
    eq((0, recordQueue_1.asCoachDocAcceptIntent)({ documentId: '   ' }), null, 'and neither is a blank id a document');
    eq((0, recordQueue_1.asCoachDocAcceptIntent)({ documentId: 'doc-2' })?.title, null, 'a missing title is null, never the empty string a screen would render as a nameless document');
    eq((0, recordQueue_1.asCoachDocAcceptIntent)(null), null, 'nothing at all is not an intent');
    // No expiry, unlike the planned day. An acceptance is not about a date, and
    // discarding somebody's signature on a timer would send them to the studio
    // door with paperwork the coach cannot see. See src/lib/outbox.ts.
    const item = (0, outbox_1.newItem)('coach-doc-accept', { documentId: 'doc-1', title: 'Studio Waiver' });
    eq(item.expiresAt, null, 'an acceptance never lapses');
    const { live, lapsed } = (0, outbox_1.partitionLapsed)([item], Date.now() + 400 * 24 * 3600 * 1000);
    eq(lapsed.length, 0, 'not even a year later');
    eq(live.length, 1, 'it is still waiting to be sent');
}
/* ── 5b · a body scan typed with no signal ─────────────────────────────── */
{
    const good = (0, recordQueue_1.asScanIntent)({
        id: 'b3f1c2a4-0000-4000-8000-000000000001', takenAt: '2026-08-14',
        weightKg: 81.8, bodyFatPct: 18.2, skeletalMuscleKg: 36.1, source: 'InBody (OCR)',
        metrics: { visceral: 7 },
    });
    ok(good != null, 'a full scan is an intent');
    eq(good.takenAt, '2026-08-14', 'dated by the day the member stood on the machine, not by the day it sends');
    eq(good.weightKg, 81.8, 'kilograms, which is what the column holds');
    eq(good.metrics?.visceral, 7, 'and the InBody breakdown rides along');
    // The id is the whole of what makes a replay safe: `scans.id` is a uuid
    // primary key, so a scan the server already took comes back 23505 instead of
    // being filed as a second weigh-in on the same day.
    eq((0, recordQueue_1.asScanIntent)({ ...good, id: '' }), null, 'a scan with no id of its own is refused — a replay of it could duplicate a body');
    eq((0, recordQueue_1.asScanIntent)({ ...good, id: undefined }), null, 'and so is one that lost it');
    // The two columns a scan cannot be filed without. A payload missing either
    // could never become a row, so it is refused HERE and taken out, rather than
    // being offered to the server on every reconnect for the life of the install.
    eq((0, recordQueue_1.asScanIntent)({ ...good, weightKg: undefined }), null, 'no weight is no scan');
    eq((0, recordQueue_1.asScanIntent)({ ...good, bodyFatPct: null }), null, 'and neither is no body fat');
    eq((0, recordQueue_1.asScanIntent)({ ...good, weightKg: 0 }), null, 'a zero weight is not a light member, it is a member nobody weighed');
    // The same bound on the other column. Only the weight side of it was ever
    // asserted, so the body-fat check could have been relaxed to `>= 0` with
    // nothing to show for it — and a scan that reached the queue with a zero
    // there is one the `scans` table refuses, retried on every reconnect for the
    // life of the install because nothing on the device will ever take it out.
    eq((0, recordQueue_1.asScanIntent)({ ...good, bodyFatPct: 0 }), null, 'and a zero body fat is a reading nobody took, not a member with none');
    eq((0, recordQueue_1.asScanIntent)({ ...good, takenAt: '14 August' }), null, 'a date that is not a date is refused rather than guessed at');
    eq((0, recordQueue_1.asScanIntent)({ ...good, takenAt: '2026-08-14T09:00:00Z' }), null, 'and so is an instant: `scans.taken_at` is a date, and a timestamp moves the scan a day west of Greenwich');
    // Muscle mass is the one figure the printout may not carry. Absent means
    // absent — never zero, which would draw as a real reading on the chart.
    eq((0, recordQueue_1.asScanIntent)({ ...good, skeletalMuscleKg: undefined }).skeletalMuscleKg, null, 'no muscle reading is null');
    eq((0, recordQueue_1.asScanIntent)({ ...good, skeletalMuscleKg: 0 }).skeletalMuscleKg, null, 'and a zero is treated as one');
    // `metrics` is plain JSON bound for a jsonb column and the only thing asked
    // of it is that it be an OBJECT. An array passes `typeof x === 'object'`, so
    // the array check is the whole of the guard, and a scan carrying one would
    // send a shape nothing downstream reads by key.
    eq((0, recordQueue_1.asScanIntent)({ ...good, metrics: [1, 2] }).metrics, null, 'a list is not an InBody breakdown');
    eq((0, recordQueue_1.asScanIntent)({ ...good, metrics: 'visceral 7' }).metrics, null, 'and neither is a line of text');
    eq((0, recordQueue_1.asScanIntent)({ ...good, metrics: undefined }).metrics, null, 'a printout that carried none says none');
    eq((0, recordQueue_1.asScanIntent)(null), null, 'nothing is not an intent');
    eq((0, recordQueue_1.asScanIntent)({ id: 'x' }), null, 'and neither is a fragment');
}
/* ── 6 · the hour they asked their coach for ───────────────────────────── */
{
    const r = (0, recordQueue_1.asSessionRequestIntent)({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 45, note: '  legs  ' });
    ok(r !== null, 'a request the member typed offline is an intent');
    eq(r?.durationMin, 45, 'the length asked for survives');
    eq(r?.note, 'legs', 'and their words are trimmed');
    eq((0, recordQueue_1.asSessionRequestIntent)({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 60 })?.note, null, 'a request with no words is still a request');
    eq((0, recordQueue_1.asSessionRequestIntent)(null), null, 'nothing is not an intent');
    eq((0, recordQueue_1.asSessionRequestIntent)({ durationMin: 60 }), null, 'and neither is a request with no hour in it');
    eq((0, recordQueue_1.asSessionRequestIntent)({ startsAt: 'next tuesday', durationMin: 60 }), null, 'an hour nothing can read is refused rather than retried for ever');
    eq((0, recordQueue_1.asSessionRequestIntent)({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 0 }), null, 'a session of no length is not a session');
    eq((0, recordQueue_1.asSessionRequestIntent)({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 600 }), null, 'and one past the constraint in part 740 is refused here rather than by a failing write');
    // There is deliberately no coach on the payload. `request_session` resolves
    // `clients.trainer_id` when it runs, so a member who changed coach while this
    // sat on their phone asks the coach they now have.
    ok(!Object.prototype.hasOwnProperty.call(r ?? {}, 'trainerId'), 'the intent names no coach, so a stored one cannot go stale on the phone');
    // The expiry is the hour itself — the same boundary the server enforces and
    // the same one the member's screen states. Three places, one rule, and this
    // is where the coincidence stops being one.
    const start = '2026-09-10T18:00:00.000Z';
    eq((0, recordQueue_1.sessionRequestExpiry)(start), start, 'a queued request stops being worth sending at the hour it asks for');
    eq((0, recordQueue_1.sessionRequestExpiry)('whenever'), null, 'and an unreadable hour is no expiry rather than an immediate one, so nothing is thrown away on a bad string');
}
/* ── 7 · the sentences ─────────────────────────────────────────────────── */
{
    const kept = (0, recordQueue_1.keptOnPhoneNote)('planned day');
    ok(kept.includes('planned day'), 'the line names what was kept');
    ok(/this phone/.test(kept), 'says where it is');
    ok(/not sent yet/.test(kept), 'and does not let anybody believe it has been delivered');
    ok(/won’t show up here until/.test(kept), 'and warns that the screen will not show it, because the screen is the evidence and it has not changed');
    const full = (0, recordQueue_1.notKeptNote)('reading', 'full');
    const unavailable = (0, recordQueue_1.notKeptNote)('reading', 'unavailable');
    ok(/not saved/.test(full), 'a phone that is full says plainly that nothing was kept');
    ok(!/goes up next time/.test(full), 'and does not make this one the promise the kept line makes');
    ok(/not saved/.test(unavailable), 'and so does a device with no outbox to key');
    // Both of the above are satisfied by either sentence, so between them they
    // could not tell the two reasons apart — and these are two different things
    // to do about it. A phone that is FULL needs signal so the backlog can drain;
    // a phone with no outbox to key has nothing waiting at all, and telling that
    // member to wait for the queue to clear sends them to look at an empty one.
    ok(full !== unavailable, 'the two reasons are two sentences');
    ok(/as much unsent work as it will hold/.test(full), 'the full phone is told what is actually wrong with it: the backlog, which is a thing signal will fix');
    ok(!/as much unsent work as it will hold/.test(unavailable), 'and the phone with nowhere to keep it is NOT told it has a backlog it does not have');
    ok(/Nothing was kept/.test(unavailable), 'it is told nothing was kept');
    ok(full.includes('reading') && unavailable.includes('reading'), 'and both name the thing that was lost');
}
if (errors.length) {
    console.error(`recordQueue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('recordQueue: ok');
