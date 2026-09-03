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
import {
  asCoachDocAcceptIntent, asDayPlanIntent, asGlucoseIntent, asGoalIntent, asScanIntent,
  asSessionRequestIntent, sessionRequestExpiry,
  keptOnPhoneNote, notKeptNote, planExpiry,
} from './recordQueue';
import { canPlan, isoToday } from './dayPlan';
import { partitionLapsed, newItem } from './outbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1 · the goal ──────────────────────────────────────────────────────── */

{
  const g = asGoalIntent({ kind: 'weight', value: 78.5, title: null, targetDate: '2026-12-01' });
  eq(g?.kind, 'weight', 'a measured goal survives the round trip');
  eq(g?.value, 78.5, 'with its number');
  eq(g?.targetDate, '2026-12-01', 'and its date');

  const c = asGoalIntent({ kind: 'custom', value: null, title: '  squat without my knee complaining  ' });
  eq(c?.title, 'squat without my knee complaining', 'a custom goal keeps its words, trimmed');
  eq(c?.targetDate, null, 'and a goal with no date has none rather than a broken one');

  eq(asGoalIntent(null), null, 'nothing is not an intent');
  eq(asGoalIntent({ value: 78 }), null, 'and neither is a goal with no kind');
  eq(asGoalIntent({ kind: 'weight', value: 0 }), null,
    'a measured goal with no number is refused rather than written as a row saying nothing');
  eq(asGoalIntent({ kind: 'weight', value: 'heavy' }), null, 'and so is one whose number is not a number');
  eq(asGoalIntent({ kind: 'custom', title: '   ' }), null, 'a custom goal with no words is refused for the same reason');
  eq(asGoalIntent({ kind: 'weight', value: 78, targetDate: 'soon' })?.targetDate, null,
    'an unreadable date becomes no date rather than a 400 on the way out');
  // A kind this build has never heard of is NOT refused here: the server owns
  // that vocabulary, and refusing locally would discard a goal set by a newer
  // build of the same app on a phone that has since been downgraded.
  ok(asGoalIntent({ kind: 'vo2max', value: 48 }) !== null,
    'an unfamiliar kind is left for the server to judge rather than thrown away here');
}

/* ── 2 · the planned day ───────────────────────────────────────────────── */

{
  const d = asDayPlanIntent({ dateISO: '2026-09-10', type: 'rest', note: ' flying ' });
  eq(d?.type, 'rest', 'a marked day keeps its type');
  eq(d?.note, 'flying', 'and its note, trimmed');
  eq(d?.remove, false, 'and is not mistaken for a removal');

  const rm = asDayPlanIntent({ dateISO: '2026-09-10', remove: true });
  eq(rm?.remove, true, 'taking the mark off is the same kind, said explicitly');
  eq(rm?.type, null, 'and carries no type');

  eq(asDayPlanIntent({ type: 'rest' }), null, 'an intent about no day is not an intent');
  eq(asDayPlanIntent({ dateISO: 'next tuesday', type: 'rest' }), null, 'and neither is one about an unreadable day');
  eq(asDayPlanIntent({ dateISO: '2026-09-10', type: 'refeed' }), null,
    'a day type this build does not know is refused, never coerced to Standard — that would be the app inventing somebody’s plan');
  eq(asDayPlanIntent({ dateISO: '2026-09-10' }), null, 'and a mark with no type at all is not silently a removal');
}

/* ── 3 · the expiry, which is the point of the kind ────────────────────── */

{
  const today = isoToday(new Date());
  const exp = planExpiry(today);
  ok(exp !== null, 'a readable date has an expiry');
  // The boundary is the END of the day, not its start: an intent queued this
  // morning and flushed this evening is still about a day that is running, and
  // `canPlan` would still accept it.
  ok(Date.parse(exp as string) > Date.now(), 'today’s plan has not lapsed while today is still running');
  eq(canPlan(today, today), true, 'which is the same answer canPlan gives, so the two rules agree');

  // Yesterday, built the way the month grid builds a cell rather than by string
  // arithmetic, so this holds in every zone the suite runs under.
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  eq(canPlan(yIso, today), false, 'yesterday cannot be planned');
  ok(Date.parse(planExpiry(yIso) as string) <= Date.now(), 'and an intent about yesterday has already lapsed');

  // The whole point, end to end: a lapsed day-plan intent comes OUT of the live
  // list and is handed back to be said, rather than being sent.
  const item = newItem('day-plan', { dateISO: yIso, type: 'rest', note: null }, { expiresAt: planExpiry(yIso) });
  const split = partitionLapsed([item]);
  eq(split.live.length, 0, 'a plan for a day that has gone is not sent');
  eq(split.lapsed.length, 1, 'and is not discarded in silence either — the member is told');

  eq(planExpiry('not a date'), null, 'an unreadable date has no expiry rather than an instant one');
  // Month ends and leap years come out of the Date normalisation for free, and
  // are asserted because "add one to the day" is exactly the line somebody
  // rewrites into string arithmetic later.
  const end = planExpiry('2026-01-31');
  eq(new Date(end as string).getDate(), 1, 'the day after the 31st is the 1st');
  eq(new Date(end as string).getMonth(), 1, 'of the next month');
  const leap = planExpiry('2028-02-28');
  eq(new Date(leap as string).getDate(), 29, 'and a leap year still has a 29th');
}

/* ── 4 · the reading ───────────────────────────────────────────────────── */

{
  const r = asGlucoseIntent({ mmol: 5.4, at: '2026-09-01T08:00:00.000Z' });
  eq(r?.mmol, 5.4, 'a reading keeps its value');
  eq(r?.at, '2026-09-01T08:00:00.000Z', 'and the moment it was TAKEN, which is what puts it beside the right meal');

  eq(asGlucoseIntent({ at: '2026-09-01T08:00:00.000Z' }), null, 'a reading with no value is not a reading');
  eq(asGlucoseIntent({ mmol: 5.4 }), null, 'and one with no moment cannot be charted, so it is refused rather than filed under now');
  eq(asGlucoseIntent({ mmol: 0, at: '2026-09-01T08:00:00.000Z' }), null, 'zero is not a reading a monitor produces');
  eq(asGlucoseIntent({ mmol: 5.4, at: 'this morning' }), null, 'nor is an unreadable moment tolerated');
}

/* ── 5 · the coach's paperwork ─────────────────────────────────────────── */

{
  const a = asCoachDocAcceptIntent({ documentId: 'doc-1', title: 'Studio Waiver' });
  eq(a?.documentId, 'doc-1', 'an acceptance is the document it is about');
  eq(a?.title, 'Studio Waiver', 'and carries what it was called, for a sentence on a screen');

  eq(asCoachDocAcceptIntent({ title: 'Studio Waiver' }), null,
    'a title with no document names nothing the server could ever store, so it is refused rather than retried for ever');
  eq(asCoachDocAcceptIntent({ documentId: '   ' }), null, 'and neither is a blank id a document');
  eq(asCoachDocAcceptIntent({ documentId: 'doc-2' })?.title, null,
    'a missing title is null, never the empty string a screen would render as a nameless document');
  eq(asCoachDocAcceptIntent(null), null, 'nothing at all is not an intent');

  // No expiry, unlike the planned day. An acceptance is not about a date, and
  // discarding somebody's signature on a timer would send them to the studio
  // door with paperwork the coach cannot see. See src/lib/outbox.ts.
  const item = newItem('coach-doc-accept', { documentId: 'doc-1', title: 'Studio Waiver' });
  eq(item.expiresAt, null, 'an acceptance never lapses');
  const { live, lapsed } = partitionLapsed([item], Date.now() + 400 * 24 * 3600 * 1000);
  eq(lapsed.length, 0, 'not even a year later');
  eq(live.length, 1, 'it is still waiting to be sent');
}

/* ── 5b · a body scan typed with no signal ─────────────────────────────── */

{
  const good = asScanIntent({
    id: 'b3f1c2a4-0000-4000-8000-000000000001', takenAt: '2026-08-14',
    weightKg: 81.8, bodyFatPct: 18.2, skeletalMuscleKg: 36.1, source: 'InBody (OCR)',
    metrics: { visceral: 7 },
  });
  ok(good != null, 'a full scan is an intent');
  eq(good!.takenAt, '2026-08-14', 'dated by the day the member stood on the machine, not by the day it sends');
  eq(good!.weightKg, 81.8, 'kilograms, which is what the column holds');
  eq(good!.metrics?.visceral, 7, 'and the InBody breakdown rides along');

  // The id is the whole of what makes a replay safe: `scans.id` is a uuid
  // primary key, so a scan the server already took comes back 23505 instead of
  // being filed as a second weigh-in on the same day.
  eq(asScanIntent({ ...(good as object), id: '' }), null, 'a scan with no id of its own is refused — a replay of it could duplicate a body');
  eq(asScanIntent({ ...(good as object), id: undefined }), null, 'and so is one that lost it');

  // The two columns a scan cannot be filed without. A payload missing either
  // could never become a row, so it is refused HERE and taken out, rather than
  // being offered to the server on every reconnect for the life of the install.
  eq(asScanIntent({ ...(good as object), weightKg: undefined }), null, 'no weight is no scan');
  eq(asScanIntent({ ...(good as object), bodyFatPct: null }), null, 'and neither is no body fat');
  eq(asScanIntent({ ...(good as object), weightKg: 0 }), null, 'a zero weight is not a light member, it is a member nobody weighed');
  eq(asScanIntent({ ...(good as object), takenAt: '14 August' }), null, 'a date that is not a date is refused rather than guessed at');
  eq(asScanIntent({ ...(good as object), takenAt: '2026-08-14T09:00:00Z' }), null,
    'and so is an instant: `scans.taken_at` is a date, and a timestamp moves the scan a day west of Greenwich');

  // Muscle mass is the one figure the printout may not carry. Absent means
  // absent — never zero, which would draw as a real reading on the chart.
  eq(asScanIntent({ ...(good as object), skeletalMuscleKg: undefined })!.skeletalMuscleKg, null, 'no muscle reading is null');
  eq(asScanIntent({ ...(good as object), skeletalMuscleKg: 0 })!.skeletalMuscleKg, null, 'and a zero is treated as one');

  eq(asScanIntent(null), null, 'nothing is not an intent');
  eq(asScanIntent({ id: 'x' }), null, 'and neither is a fragment');
}

/* ── 6 · the hour they asked their coach for ───────────────────────────── */

{
  const r = asSessionRequestIntent({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 45, note: '  legs  ' });
  ok(r !== null, 'a request the member typed offline is an intent');
  eq(r?.durationMin, 45, 'the length asked for survives');
  eq(r?.note, 'legs', 'and their words are trimmed');
  eq(asSessionRequestIntent({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 60 })?.note, null,
    'a request with no words is still a request');

  eq(asSessionRequestIntent(null), null, 'nothing is not an intent');
  eq(asSessionRequestIntent({ durationMin: 60 }), null, 'and neither is a request with no hour in it');
  eq(asSessionRequestIntent({ startsAt: 'next tuesday', durationMin: 60 }), null,
    'an hour nothing can read is refused rather than retried for ever');
  eq(asSessionRequestIntent({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 0 }), null,
    'a session of no length is not a session');
  eq(asSessionRequestIntent({ startsAt: '2026-09-10T18:00:00.000Z', durationMin: 600 }), null,
    'and one past the constraint in part 740 is refused here rather than by a failing write');

  // There is deliberately no coach on the payload. `request_session` resolves
  // `clients.trainer_id` when it runs, so a member who changed coach while this
  // sat on their phone asks the coach they now have.
  ok(!Object.prototype.hasOwnProperty.call(r ?? {}, 'trainerId'),
    'the intent names no coach, so a stored one cannot go stale on the phone');

  // The expiry is the hour itself — the same boundary the server enforces and
  // the same one the member's screen states. Three places, one rule, and this
  // is where the coincidence stops being one.
  const start = '2026-09-10T18:00:00.000Z';
  eq(sessionRequestExpiry(start), start, 'a queued request stops being worth sending at the hour it asks for');
  eq(sessionRequestExpiry('whenever'), null,
    'and an unreadable hour is no expiry rather than an immediate one, so nothing is thrown away on a bad string');
}

/* ── 7 · the sentences ─────────────────────────────────────────────────── */

{
  const kept = keptOnPhoneNote('planned day');
  ok(kept.includes('planned day'), 'the line names what was kept');
  ok(/this phone/.test(kept), 'says where it is');
  ok(/not sent yet/.test(kept), 'and does not let anybody believe it has been delivered');
  ok(/won’t show up here until/.test(kept),
    'and warns that the screen will not show it, because the screen is the evidence and it has not changed');

  const full = notKeptNote('reading', 'full');
  ok(/not saved/.test(full), 'a phone that is full says plainly that nothing was kept');
  ok(!/goes up next time/.test(full), 'and does not make this one the promise the kept line makes');
  ok(/not saved/.test(notKeptNote('reading', 'unavailable')), 'and so does a device with no outbox to key');
}

if (errors.length) {
  console.error(`recordQueue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('recordQueue: ok');
