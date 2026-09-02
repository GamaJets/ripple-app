// How often a coach hears about a personal best, and what they are told.
// Compile with tsc, run with node.
//
// The rule that a set IS a personal best is not tested here and is not stated
// here: it lives in the guarded branch in app/(client)/workouts.tsx and in
// `priorBest1RM`, and supabase/parts/202 explains at length why re-stating it
// anywhere else — plpgsql, or a second TypeScript module — is the failure this
// whole feature is shaped to avoid. What is tested here is everything that
// branch cannot decide.
//
// The four defects these assertions are aimed at:
//
//   1. AN INBOX A COACH MUTES. A beginner on linear progression takes a
//      lifetime record on every movement in every session, and working up
//      inside one movement takes three more. Sent as they happen that is eight
//      pushes in forty minutes from one client. Muting is account-wide by
//      category, so the cost is not the noise, it is that the coach stops
//      hearing that a card was declined. The two loops at the bottom of the
//      rate section are that scenario played out set by set.
//
//   2. A NUMBER THE APP WOULD RESTATE DIFFERENTLY. Part 163's rule and part
//      202's: no percentage, no delta, no "up 12% this month" — every one of
//      those is a second copy of a figure some screen also renders, free to
//      drift from it. The body states a movement, a load and a rep count, all
//      three of which came off the set that was just logged.
//
//   3. A LOAD IN THE WRONG UNIT. This is the one notification in the product
//      composed on one person's handset and read on another's. Loads are stored
//      in kilograms, the READER's preference decides display everywhere else,
//      and a client's device cannot read their coach's. A bare "100" to a coach
//      in pounds is 220 pounds wrong, so both units are stated.
//
//   4. A NOTIFICATION THAT OPENS NOBODY. `client-training.tsx` has a roster
//      picker and opens perfectly well with no client named, so a missing or
//      placeholder id is not an error anywhere — it is a message about one
//      person that opens a list of everybody.
import {
  PR_ROUTE_BASE, PR_TITLE, announcedRecord, bothUnits, movementKey,
  prDayKey, prDecision, prNotification, prRoute, type PrAnnounced, type PrSet,
} from './prNotify';
import { inboxDecision, inboxIcon, safeRoute } from './notifyInbox';
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX } from './notifyCopy';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── days, in whatever zone this suite is being run in ──────────────────────
 *
 * `npm run test:zones` runs everything from Kiritimati (+14) to Midway (-11),
 * so not one date string is written down here. Local midday is built with the
 * Date constructor, which is local in every zone, and it is midday rather than
 * midnight so that a DST shift cannot move a case over a boundary.
 */
const middayOn = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0, 0).getTime();
const MIN = 60_000;
const DAY1 = middayOn(2026, 4, 12);
const DAY2 = middayOn(2026, 4, 13);

ok(prDayKey(DAY1) !== prDayKey(DAY2), 'two middays a day apart are two different local days');
eq(prDayKey(DAY1 + 5 * MIN), prDayKey(DAY1), 'five minutes later in the same session is the same day');

const squat: PrSet = { movement: 'Back squat', kg: 100, reps: 5 };
const bench: PrSet = { movement: 'Bench press', kg: 80, reps: 8 };

/* ── the rate rule ─────────────────────────────────────────────────────── */

ok(prDecision(null, squat, DAY1).announce, 'a device that has never sent one announces');
ok(prDecision(undefined, squat, DAY1).announce, 'and so does one whose store could not be read');

const sentSquatDay1: PrAnnounced = announcedRecord(squat, DAY1);
eq(sentSquatDay1.day, prDayKey(DAY1), 'the record is filed under the local day it was sent on');
eq(sentSquatDay1.movement, 'back squat', 'and under the normalised movement');

ok(!prDecision(sentSquatDay1, squat, DAY1 + 10 * MIN).announce,
  'the same movement again ten minutes later is not a second message');
ok(!prDecision(sentSquatDay1, bench, DAY1 + 20 * MIN).announce,
  'and neither is a DIFFERENT movement — the cap is one a day, not one per lift');
ok(/back squat/.test(prDecision(sentSquatDay1, bench, DAY1 + 20 * MIN).why),
  'the refusal names the record that already spoke for today');
ok(prDecision(sentSquatDay1, bench, DAY2).announce, 'tomorrow is a new day and a new message');

// The whole reason the cap is one a day. Working up inside one movement takes a
// record on every set, and a five-movement beginner session takes one on every
// movement. Both are counted here as a coach's phone would count them.
const workingUp: PrSet[] = [
  { movement: 'Back squat', kg: 90, reps: 5 },
  { movement: 'Back squat', kg: 95, reps: 5 },
  { movement: 'Back squat', kg: 100, reps: 3 },
];
const beginnerSession: PrSet[] = [
  ...workingUp,
  { movement: 'Bench press', kg: 60, reps: 5 },
  { movement: 'Barbell row', kg: 55, reps: 8 },
  { movement: 'Overhead press', kg: 35, reps: 5 },
  { movement: 'Romanian deadlift', kg: 80, reps: 8 },
];
const runSession = (sets: PrSet[], startMs: number, from: PrAnnounced | null): { sent: number; last: PrAnnounced | null } => {
  let last = from;
  let sent = 0;
  sets.forEach((s, i) => {
    const at = startMs + i * 4 * MIN;
    if (prDecision(last, s, at).announce) { sent += 1; last = announcedRecord(s, at); }
  });
  return { sent, last };
};

eq(runSession(workingUp, DAY1, null).sent, 1, 'working up through one movement is one message, not three');
const week = runSession(beginnerSession, DAY1, null);
eq(week.sent, 1, 'a beginner taking seven records in one session is told about once');
eq(week.last?.movement, 'back squat', 'and it is the FIRST one, at the moment it happened');
// Three sessions in a week, one message each. That is the ceiling a coach with
// twenty clients has to be able to hold.
let carried: PrAnnounced | null = null;
let acrossTheWeek = 0;
for (const d of [12, 14, 16]) {
  const r = runSession(beginnerSession, middayOn(2026, 4, d), carried);
  acrossTheWeek += r.sent;
  carried = r.last;
}
eq(acrossTheWeek, 3, 'three sessions in a week are three messages, whatever happened inside them');

/* ── the refusals that keep a hole out of a sentence ───────────────────── */

ok(!prDecision(null, { movement: '   ', kg: 100, reps: 5 }, DAY1).announce, 'a movement with no name says nothing');
ok(!prDecision(null, { movement: 'Pull-up', kg: 0, reps: 12 }, DAY1).announce,
  'a bodyweight set has no load to state — and is excluded upstream long before this');
ok(!prDecision(null, { movement: 'Plank', kg: 40, reps: 0 }, DAY1).announce, 'a set with no reps is not a set');
ok(!prDecision(null, squat, NaN).announce, 'an unreadable clock has no day for the once-a-day rule to work in');
ok(!prDecision(null, { movement: 'Back squat', kg: Number.NaN, reps: 5 }, DAY1).announce, 'NaN is not a load');

/* ── the movement key folds spelling, and nothing else ─────────────────── */

eq(movementKey('Back Squat'), movementKey('back  squat'), 'case and spacing are the same movement');
ok(movementKey('Back squat') !== movementKey('Front squat'), 'two squats a member considers different stay different');
ok(movementKey('Squat') !== movementKey('Back squat'),
  'and this is NOT exerciseSlug — a member may take a record on each in one day');
eq(movementKey(null), '', 'no name is the empty key, which is what prDecision refuses on');

/* ── both units, because the reader is not the person who typed it ─────── */

eq(bothUnits(100), '100 kg (220.5 lb)', 'a round hundred kilos, read by a coach in pounds');
eq(bothUnits(60), '60 kg (132.5 lb)', 'and a sixty');
ok(bothUnits(2.5).startsWith('2.5 kg'), 'a fractional load keeps its fraction');

/* ── what the coach is told ────────────────────────────────────────────── */

const named = prNotification(squat, 'Sam Cooper');
ok(!!named, 'a complete set produces a message');
if (named) {
  eq(named.title, PR_TITLE, 'the heading is fixed and carries no figure');
  ok(named.title.length <= NOTICE_TITLE_MAX, 'the heading fits what notify_users() stores');
  ok(named.body.length <= NOTICE_BODY_MAX, 'and so does the body');
  ok(named.body.includes('Sam Cooper'), 'the coach is told which client');
  ok(named.body.includes('Back squat'), 'and which movement, in the words the programme uses');
  ok(named.body.includes('100 kg'), 'the load in kilograms');
  ok(named.body.includes('220.5 lb'), 'and the same load in pounds');
  ok(named.body.includes('5 reps'), 'and the reps that were done');
  ok(named.body.trim().endsWith('.'), 'it is sentences, not a fragment');
}

// Defect 2, stated as a shape rather than as a sentence: nothing derived.
for (const n of [
  prNotification(squat, 'Sam Cooper'),
  prNotification(bench, null),
  prNotification({ movement: 'Deadlift', kg: 182.5, reps: 1 }, 'Tam'),
]) {
  ok(!!n, 'each of these sets has something true to say');
  if (!n) continue;
  ok(!n.body.includes('%'), `“${n.body}” states no percentage`);
  ok(!/\bup \d/i.test(n.body), 'and no "up 12" style movement figure');
  ok(!/\b\d+(\.\d+)?\s*(more|extra|better|heavier)\b/i.test(n.body), 'and no comparison with the previous best');
  ok(!/1RM|one-rep max of|e1RM/i.test(n.body.replace('estimated one-rep max', '')),
    'the estimated one-rep max is how the record is JUDGED, and is never quoted as a figure');
  ok(!n.body.includes('—'), 'no dash standing in for a value it could not read');
}

const oneRep = prNotification({ movement: 'Deadlift', kg: 182.5, reps: 1 }, 'Tam');
ok(!!oneRep && oneRep.body.includes('for 1 rep,'), 'a single is a rep, not reps');

const anonymous = prNotification(squat, null);
ok(!!anonymous && anonymous.body.startsWith('A client '),
  'an unread profile is "A client" and never a name off a shared handset');
eq(prNotification(squat, '   ')?.body, anonymous?.body, 'and so is a blank one');

eq(prNotification({ movement: '', kg: 100, reps: 5 }, 'Sam'), null, 'no movement, no message');
eq(prNotification({ movement: 'Pull-up', kg: 0, reps: 12 }, 'Sam'), null, 'no load, no message');
eq(prNotification({ movement: 'Back squat', kg: 100, reps: 0 }, 'Sam'), null, 'no reps, no message');

/* ── where it opens ────────────────────────────────────────────────────── */

const route = prRoute('7f3d4b2a-0000-4000-8000-000000000001');
ok(!!route && route.startsWith(PR_ROUTE_BASE + '?'), 'the route names the client');
eq(prRoute(null), null, 'no id means no route at all, rather than a screen opened at nobody');
eq(prRoute('   '), null, 'and a blank id is no id');
eq(safeRoute(route, 'trainer'), route, 'a coach’s build follows it');
eq(safeRoute(route, 'client'), null, 'a client’s build refuses it, as it refuses every trainer route');
eq(inboxIcon(route), 'dumbbell', 'and the row is drawn as a lift rather than as a generic bell');

const forInbox = prNotification(squat, 'Sam Cooper');
ok(!!forInbox && inboxDecision(forInbox.title, forInbox.body, route).record,
  'it earns an inbox row: a coach who missed the banner has no other way to learn it');

if (errors.length) {
  console.error(`prNotify: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(' ✗ ' + e);
  process.exit(1);
}
console.log('prNotify: ok');
