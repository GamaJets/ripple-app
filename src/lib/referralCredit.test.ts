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
  CONVERSION_RULE, REFERRAL_PRIVACY_NOTE, REWARD_NOTE, friendLine, joinedLabel,
  shapeReferrals, summaryLine, type RawReferral, type ReferralRow,
} from './referralCredit';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

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
ok(/gym or coach/i.test(REWARD_NOTE), 'the reward note leaves the reward to the business');
ok(/no reward has been promised/i.test(REWARD_NOTE), 'and says plainly that none has been promised');
ok(!/free session|% off|voucher|points|credit balance/i.test(REWARD_NOTE),
  'and offers nothing nobody agreed to');
ok(/first name/i.test(REFERRAL_PRIVACY_NOTE), 'the privacy note says a first name is what is shown');
ok(/never shown anything about your training/i.test(REFERRAL_PRIVACY_NOTE),
  'and that the exposure does not run the other way');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`referralCredit: ok (${shaped.length} rows shaped, ${shaped.filter((r) => r.converted).length} converted)`);
