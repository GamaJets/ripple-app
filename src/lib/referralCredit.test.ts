// Reporting referrals to the person who made them. Compile with tsc, run with
// node.
//
// Two bugs are guarded here and they pull in opposite directions.
//
// The first is the one this codebase keeps producing: a count of zero printed
// because a read failed. "Nobody has used your code yet" is a sentence about
// the world, and a referrer who reads it concludes their invitations went
// nowhere and stops sending them. It is the same failure src/lib/joinCodes.ts
// documents for a coach's paid campaigns, with the same cause — an empty answer
// under 'error' means UNKNOWN — and it arrives here through the same door.
//
// The second is specific to this screen: a signup is not a conversion. The
// whole point of the feature is that "4 friends joined" and "1 has started
// training" are different facts, and neither may be quietly derived from the
// other. Most of the assertions below are about keeping those two numbers apart
// and about not promising a reward nobody has agreed to.
import {
  CONVERSION_RULE, REFERRAL_PRIVACY_NOTE, rewardNote, friendLine, joinedLabel,
  shapeReferrals, summaryLine, invitesCutLine, type RawReferral, type ReferralRow,
  COACH_REWARD_NOTE, COACH_REFERRAL_PRIVACY_NOTE, shapeCoachReferrers,
  referrerLine, coachSummaryLine, type RawCoachReferrer,
} from './referralCredit';
import type { LoadStatus } from '../ui/loadStatus';

import { setAppLocale } from './locale';
const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// These assertions read dates in British order — the day first. That is no
// longer what the app writes for everybody: src/lib/format.ts asks
// src/lib/locale.ts, which reads the handset, so the same call produces
// "Sep 2, 2026" on an American one. The locale is stated here for the same
// reason this file states its timezones: a test that reads whatever the runner
// happens to be set to is a test of the machine.
setAppLocale('en-GB');

// Exactly the shape my_referrals() answered with, live, on 2026-08-31: a first
// name, a join timestamp, and a first-workout timestamp that is null for
// somebody who has not trained.
const raw = (over: Partial<RawReferral> = {}): RawReferral => ({
  friend_name: 'Ben',
  joined_at: '2026-08-31T18:26:11.701217+00:00',
  started_at: '2026-08-24T10:00:00+00:00',
  ...over,
});
const row = (over: Partial<ReferralRow> = {}): ReferralRow => ({
  name: 'Ben',
  joinedAt: '2026-08-31T12:00:00Z',
  startedAt: '2026-08-24T10:00:00Z',
  converted: true,
  ...over,
});

/* ── joined and converted are different facts ──────────────────────────── */

const shaped = shapeReferrals([
  raw(),
  raw({ friend_name: 'Evan', joined_at: '2026-08-30T09:00:00Z', started_at: null }),
]);
eq(shaped.length, 2, 'two rows shape');
eq(shaped[0].name, 'Ben', 'newest join first');
eq(shaped[0].converted, true, 'a friend with a first workout has converted');
eq(shaped[1].converted, false, 'a friend who signed up and never trained has not');
// This is the live case. Evan used a code, has a profile, has no workouts, and
// the screen must not count him as a win.
eq(shaped[1].startedAt, null, 'and carries no start date to render');

// A blank name is the server's own fallback repeated, because an empty string
// under an avatar circle is a row that looks broken.
eq(shapeReferrals([raw({ friend_name: '   ' })])[0].name, 'A friend', 'a blank name still reads as somebody');
eq(shapeReferrals([raw({ friend_name: null })])[0].name, 'A friend', 'so does a missing one');
// No join date means the row cannot be placed in time at all, and a placeholder
// date would be a date nobody chose.
eq(shapeReferrals([raw({ joined_at: null })]).length, 0, 'a row with no join date is dropped');
eq(shapeReferrals([raw({ joined_at: 'not a date' })]).length, 0, 'and so is an unparseable one');
// An unparseable start date is "not started", never a fabricated start.
eq(shapeReferrals([raw({ started_at: 'soon' })])[0].converted, false,
  'an unreadable first-workout date is not a conversion');
eq(shapeReferrals(null).length, 0, 'a null read shapes to nothing rather than throwing');

/* ── nothing is counted unless the read was whole ──────────────────────── */

for (const s of ['error', 'partial', 'loading'] as LoadStatus[]) {
  const line = summaryLine(s, 4, 1);
  ok(!/\b4\b/.test(line) && !/\b1\b/.test(line), `${s} states no figure — got ${JSON.stringify(line)}`);
  // The dangerous sentence. It is a claim about whether anybody accepted an
  // invitation, and under a failed read it is not known.
  ok(!/nobody/i.test(line), `${s} does not claim nobody has used the code`);
  ok(!/\b0\b/.test(line), `${s} does not print a zero it did not read`);
}
// A count that arrived as null under a ready status is still not a zero.
ok(!/nobody/i.test(summaryLine('ready', null, null)), 'a missing count is not "nobody"');
ok(!/\b0\b/.test(summaryLine('ready', null, 2)), 'nor is half a missing pair');

// And under 'ready' the figures are stated, because they are real.
ok(/4 joined/.test(summaryLine('ready', 4, 1)), 'a completed read says how many joined');
ok(/1 has started/.test(summaryLine('ready', 4, 1)), 'and how many of them started training');
ok(/2 have started/.test(summaryLine('ready', 4, 2)), 'and agrees with itself about plurals');
ok(/none training yet/.test(summaryLine('ready', 4, 0)),
  'four signups and no training says so — it does not round up to a success');
ok(/nobody/i.test(summaryLine('ready', 0, 0)), 'a genuine zero may say nobody has used the code');
// The two numbers are never derived from one another: the second is not
// implied by the first, which is the entire point of the screen.
ok(!/started/.test(summaryLine('ready', 0, 0)), 'with nobody joined there is no conversion claim');
// House rule: four figures carry a separator.
ok(/1,204/.test(summaryLine('ready', 1204, 900)), 'a four-figure count carries its thousands separator');

/* ── one friend's line says what happened and guesses at nothing ───────── */

ok(/^Joined /.test(friendLine(row())), 'a friend line leads with when they joined');
ok(/started training/.test(friendLine(row())), 'a converted friend says so');
ok(/not training yet/.test(friendLine(row({ startedAt: null, converted: false }))),
  'one who has not started says that, in the present tense');
// "Not converted" is a score, and the referrer knows this person.
ok(!/convert/i.test(friendLine(row({ startedAt: null, converted: false }))),
  'and is not labelled with the word the business uses');

// Dates are rendered in the reader's own local zone, which the suite runs in
// three of (see the test:zones script). Asserting an exact string would pass in
// one zone and fail in the next, so what is pinned is that the label names the
// LOCAL day of the instant — which is the property that would break if this
// ever formatted in UTC.
const at = Date.parse('2026-08-12T21:30:00Z');
eq(joinedLabel(new Date(at).toISOString()).split(' ')[0], String(new Date(at).getDate()),
  'the join date is the reader’s local day, in every zone the suite runs in');
ok(joinedLabel('2026-08-12T21:30:00Z').length > 0, 'and it is not blank');
eq(joinedLabel('nonsense'), '', 'an unparseable date renders as nothing rather than as "Invalid Date"');
ok(!/\d{4}/.test(joinedLabel('2026-08-12T21:30:00Z')), 'no year: a recent date is not a filing reference');

/* ── the screen promises exactly what the database can keep ────────────── */

// The three sentences on the screen. They are here, in a tested module, rather
// than inline in the JSX, because the thing most likely to go wrong with them
// is that somebody rewrites the screen and the promise drifts from what
// supabase/parts/128 actually records.
ok(/first workout/i.test(CONVERSION_RULE), 'the rule names a first workout as the bar');
ok(/signing up/i.test(CONVERSION_RULE), 'and says explicitly that a signup is not enough');
// The one thing this feature must never do: invent a reward.
const REWARD_NOTE = rewardNote('Repple');
ok(/gym or coach/i.test(REWARD_NOTE), 'the reward note leaves the reward to the business');
ok(/no reward has been promised/i.test(REWARD_NOTE), 'and says plainly that none has been promised');

// White-label. This is the Invite Friends screen — the one built for showing to
// other people — and it opened with the supplier's name on a build that may not
// be called Repple at all.
const branded = rewardNote('Example Fitness');
ok(/^Example Fitness records/.test(branded), `the note carries the brand it was given — got ${branded}`);
ok(!/Repple/.test(branded), 'and never the supplier’s name');
ok(!/free session|% off|voucher|points|credit balance/i.test(REWARD_NOTE),
  'and offers nothing nobody agreed to');
ok(/first name/i.test(REFERRAL_PRIVACY_NOTE), 'the privacy note says a first name is what is shown');
ok(/never shown anything about your training/i.test(REFERRAL_PRIVACY_NOTE),
  'and that the exposure does not run the other way');

/* ── THE COACH'S SIDE ─────────────────────────────────────────────────────── */
//
// Same two bugs, aimed at a different reader, plus a third that only exists
// here: a coach shown a value would offer it to somebody. The rows below are
// the shape coach_referrals() returns (supabase/parts/630) — an id, a first
// name, and two counts, and no detail whatsoever about the people referred.

const rawCoach: RawCoachReferrer[] = [
  { referrer_id: 'c1', referrer_name: 'Priya', joined: 4, converted: 1 },
  { referrer_id: 'c2', referrer_name: 'Tom', joined: 2, converted: 2 },
  { referrer_id: 'c3', referrer_name: '   ', joined: 1, converted: 0 },
];
const coachRows = shapeCoachReferrers(rawCoach);
eq(coachRows.length, 3, 'every client who brought somebody in is listed');
eq(coachRows[0].id, 'c1', 'ordered by how many they brought in');
eq(coachRows[2].name, 'A client', 'a blank name is described rather than left empty under a row');

eq(shapeCoachReferrers([{ referrer_id: '', referrer_name: 'X', joined: 3, converted: 0 }]).length, 0,
  'a row naming nobody is dropped — a coach cannot thank an id-less row');
eq(shapeCoachReferrers([{ referrer_id: 'c9', referrer_name: 'X', joined: null, converted: null }]).length, 0,
  'and a count that is not a count is dropped rather than becoming a zero');
eq(shapeCoachReferrers([{ referrer_id: 'c9', referrer_name: 'X', joined: 2, converted: 5 }])[0].converted, 2,
  'converted can never exceed joined — "3 of 2 started training" ends the reader’s trust in both');
eq(shapeCoachReferrers(null).length, 0, 'a read that returned nothing shapes to nothing, not to a throw');

const priya = referrerLine(coachRows[0]);
ok(priya.includes('4 people joined') && priya.includes('1 has started training'),
  `both counts are on the line, always — got ${priya}`);
ok(referrerLine(coachRows[2]).includes('none training yet'),
  'and a client whose people have not started is said plainly, not left blank');
ok(!/£|\$|€|worth|credit|owed/i.test(priya), 'no line about a person carries money');

// The first bug: a failed read becoming a statement about the world. A coach
// told nobody is referring stops asking, and asking is free.
for (const s of ['loading', 'error', 'partial'] as LoadStatus[]) {
  const line = coachSummaryLine(s, null);
  ok(!/\d/.test(line), `${s} states no figure — got ${line}`);
  ok(!/^None|nobody/i.test(line), `${s} never says nobody has referred anybody — got ${line}`);
}
ok(coachSummaryLine('ready', null).includes('couldn’t'),
  'a null under ready is still a failure to check, not an answer of none');
ok(coachSummaryLine('ready', []).startsWith('None of your clients'),
  'and only a real, whole, empty read may say none');

const summary = coachSummaryLine('ready', coachRows);
ok(summary.includes('7 people') && summary.includes('3 of whom'),
  `the two totals are stated together — got ${summary}`);
ok(!/£|\$|€|revenue|worth|value/i.test(summary), 'and the summary is a headcount, never a takings figure');

// The third bug, which is the reason this screen was specified as counts only.
ok(/no discount/i.test(COACH_REWARD_NOTE) && /no free session/i.test(COACH_REWARD_NOTE),
  'the coach note names the rewards it is NOT offering rather than leaving them to be assumed');
ok(!/[£$€]|\d/.test(COACH_REWARD_NOTE),
  'and carries no amount and no currency — there is no figure it could honestly hold');
ok(/yours to decide/i.test(COACH_REWARD_NOTE), 'and hands the decision back to the coach');
ok(/never been told/i.test(COACH_REWARD_NOTE), 'saying outright that the app does not know the amount');
ok(/not shown who those people are/i.test(COACH_REFERRAL_PRIVACY_NOTE),
  'the privacy note says the referred people are not named to the coach');

// ── the ceiling inside `my_referrals()` ────────────────────────────────────
//
// The list stops at 200 server-side and nothing on the client can see it, so
// the sentence saying so is the only thing standing between a referrer and a
// silently short guest list.
eq(invitesCutLine(0, 200), null, 'an empty list says nothing about a ceiling');
eq(invitesCutLine(199, 200), null, 'nor does one that stopped short of it on its own');
ok(invitesCutLine(200, 200) != null, 'a list that came back AT the ceiling says so');
ok(invitesCutLine(200, 200)!.includes('200'), 'and names the number rather than saying "some"');
ok(/most recent/.test(invitesCutLine(200, 200)!),
  'and says WHICH end was cut — the order is created_at desc, so it is the oldest that went');
ok(/counts above/.test(invitesCutLine(200, 200)!),
  'and protects the two figures above it, which my_referral_summary() computes over every row');
ok(!/could not|couldn|failed|error/i.test(invitesCutLine(200, 200)!),
  'this is a full read that ended at a product limit, not a failure, and must not read as one');
eq(invitesCutLine(Number.NaN, 200), null, 'a length that is not a number states no ceiling');
eq(invitesCutLine(200, 0), null, 'and a cap of zero is not a cap');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`referralCredit: ok (${shaped.length} rows shaped, ${shaped.filter((r) => r.converted).length} converted)`);
