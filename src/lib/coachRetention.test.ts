// R2 — the coach's own follow-up loop, on the coach's own phone.
//
// The reading half of src/lib/interventions.ts had exactly one importer in this
// repository: a gym owner's page in studio-web. So `app/(trainer)/client.tsx`
// wrote every call and text into `member_interventions` and could never read
// back whether any of it made a difference. The screen now composes the same
// three functions the owner's console does, over the same rows, and this file
// asserts the composition rather than re-testing the module.
//
// The bug every assertion here is aimed at: a coach reads a tally and changes
// what they do. So the tally must never be manufactured out of a read that did
// not reach far enough back — which, on a per-client screen, is exactly the
// failure that would show a coach "0 came back" about every call they have ever
// made.
//
// Compile with tsc, run with node. No node:assert anywhere.
import {
  assessAllFollowUps, summariseFollowUps, loopHeadline, WHY_NO_RATE,
  FOLLOW_UP_READ_DAYS, FOLLOW_UP_CONTACT_DAYS,
  type Contact,
} from './interventions';
import { DEFAULT_WINDOWS, type ActivityEvent } from './clientDrift';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
/** Fixed, so every assertion means the same thing in every zone the repo tests
 *  under. Local noon for the same reason planVsActual.test.ts uses it. */
const NOW = Date.parse('2026-09-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

/* ── the read window is not the drift window, and this is why ─────────────
 *
 * A follow-up is judged against the client's settled pattern AS IT STOOD ON
 * THE DAY OF THE CALL. So a contact made ninety days ago needs the drift
 * history sitting BEHIND that day. A screen that read only the drift window
 * would return 'outside-the-read' for every contact old enough to have an
 * answer, and the loop would be permanently and silently empty. */

ok(FOLLOW_UP_CONTACT_DAYS + DEFAULT_WINDOWS.historyDays <= FOLLOW_UP_READ_DAYS,
  'every contact a screen offers for judgement has its own baseline inside the read');
ok(FOLLOW_UP_CONTACT_DAYS > DEFAULT_WINDOWS.historyDays,
  'and the contact window reaches past the drift window, or the loop only ever sees calls too recent to judge');

/* ── a client who came back ───────────────────────────────────────────────
 *
 * Three sessions a week for two months, a drop to nothing, a phone call, and
 * three sessions a week again. */

const twice = (fromDays: number, toDays: number, perWeek: number): ActivityEvent[] => {
  const out: ActivityEvent[] = [];
  for (let d = fromDays; d > toDays; d--) {
    // Spread `perWeek` days across each week rather than clustering them, so
    // the active-DAY count that clientDrift and interventions both work in is
    // the rate the assertion names.
    if (d % 7 < perWeek) out.push({ at: ago(d), kind: 'workout' });
  }
  return out;
};

const CALL = 40;
const recovered: ActivityEvent[] = [
  ...twice(140, CALL + 14, 3),   // their settled pattern, before the drop
  // the fortnight before the call: silence
  ...twice(CALL, 0, 3),          // and after it, back to it
];

const contact = (id: string, daysAgo: number): Contact => ({
  id, memberId: 'm1', at: ago(daysAgo), channel: 'call',
  byId: null, byName: 'Front desk', outcome: 'reached', note: null,
});

const one = assessAllFollowUps([contact('c1', CALL)], () => recovered, {
  now: NOW, readFromMs: NOW - FOLLOW_UP_READ_DAYS * DAY,
});
eq(one.length, 1, 'one contact, one read');
eq(one[0].verdict, 'recovered', 'training picking back up after the call is reported as what FOLLOWED it');

/* ── and the refusal that matters most on a per-client screen ─────────────
 *
 * A contact older than the activity read has no baseline that was ever read,
 * and 'kept-falling' over it would be a fact about the query printed as a fact
 * about a person. */

const tooOld = assessAllFollowUps([contact('c2', FOLLOW_UP_READ_DAYS + 30)], () => recovered, {
  now: NOW, readFromMs: NOW - FOLLOW_UP_READ_DAYS * DAY,
});
eq(tooOld[0].verdict, 'unknown', 'a contact older than the read is not judged');
eq(tooOld[0].blocked, 'outside-the-read', 'and it says which of the five reasons, rather than a dash');

/* ── null in, null out ────────────────────────────────────────────────────
 *
 * "Not read yet" is not "nothing has been tried", and a coach shown 0 for the
 * first has been told they have done nothing. */

eq(summariseFollowUps(null), null, 'an unread contact list produces no tally at all');
eq(loopHeadline(null), null, 'and no headline to put over it');
eq(loopHeadline(summariseFollowUps([])), null,
  'nor does an empty one: a coach who has made no calls does not need a report about them');

/* ── counts, never a rate ─────────────────────────────────────────────────
 *
 * The coverage tests already assert the absence of a rate on the returned
 * object. This asserts the SENTENCE the coach reads, because a percentage that
 * appeared only in prose would be just as wrong and would not fail that test. */

const tally = summariseFollowUps([...one, ...tooOld])!;
eq(tally.total, 2, 'every contact considered is counted, including the ones that cannot be judged');
eq(tally.judged, 1, 'and the refusals are kept out of the denominator rather than folded into it');
eq(tally.outsideTheRead, 1, 'each refusal keeps its own name');

const head = loopHeadline(tally)!;
ok(!/%/.test(head), 'there is no percentage in the headline');
ok(/cannot be judged yet/.test(head), 'and the unjudgeable ones are said out loud rather than hidden');
ok(!/worked|failed|caused/i.test(head),
  'nothing here claims a contact worked: everybody contacted was contacted because they were drifting, so there is no comparable group who were left alone');
ok(/followed/i.test(WHY_NO_RATE) && !/%/.test(WHY_NO_RATE.replace(/percentage/g, '')),
  'and the sentence the screen prints beside the counts says so in as many words');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('coachRetention: ok — the coach can read their own follow-up loop, in counts, with every refusal named and no rate anywhere');
