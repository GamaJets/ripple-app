// The reviews a member has written, read back. Compile with tsc, run with node.
//
// Nothing in the product has ever shown a member the set of reviews they wrote,
// so every sentence asserted below is one this app has never printed. Four of
// them would cost something real:
//
//   · "You haven't reviewed a coach yet" over a read that failed. Worse here
//     than in the usual place, because `write_coach_review` UPSERTS on
//     (coach_id, client_id): a member who believes they wrote nothing writes
//     one, and it silently replaces the review that was there and clears the
//     coach's reply with it. There is no second row and no undo.
//   · a count taken over a 'partial' read. The figure in that sentence is a
//     count, and src/ui/loadStatus.ts forbids one over a set known to be a
//     prefix — so the sentence itself has to decline to state it.
//   · "on their public profile" said about a review that is not on one. Two
//     separate ways for that to be false — withdrawn, and a coach who never
//     ticked "list me" — and they need two separate sentences.
//   · a sentence with a hole where the coach's name should be. `coach_name`
//     comes back null for a profile with no name on it, and "You rated — 4 out
//     of 5" is exactly what scripts/check-prose.mjs exists for.
import {
  sortMyReviews, myReviewsNote, myReviewRatingLine,
  myReviewVisibilityLine, myReviewEditedLine, type MyCoachReview,
} from './myReviews';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const review = (p: Partial<MyCoachReview> = {}): MyCoachReview => ({
  id: 'r1',
  coachId: 'c1',
  coachName: 'Sam Turner',
  coachListed: true,
  rating: 4,
  body: 'Patient, and never let me round my back.',
  createdAt: '2026-03-04T09:00:00.000Z',
  edited: false,
  withdrawnAt: null,
  coachReply: null,
  coachRepliedAt: null,
  ...p,
});

/* ── 1. order ─────────────────────────────────────────────────────────────*/

{
  const rows = [
    review({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' }),
    review({ id: 'a', createdAt: '2026-06-01T00:00:00.000Z' }),
    review({ id: 'c', createdAt: '2026-03-01T00:00:00.000Z' }),
  ];
  eq(sortMyReviews(rows).map((r) => r.id).join(''), 'acb', 'newest first');
  eq(rows.map((r) => r.id).join(''), 'bac', 'the caller’s array is not reordered under them');

  // A stamp that will not parse must not poison the comparison of the ones that
  // will. It sorts last, which is the honest end for a row with no readable
  // date on it.
  const withJunk = sortMyReviews([
    review({ id: 'junk', createdAt: 'not a date' }),
    review({ id: 'real', createdAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  eq(withJunk[0]?.id, 'real', 'an unreadable stamp does not float to the top');

  // Equal stamps must not swap places between renders — a list that reshuffles
  // itself looks like a list that is changing when nothing has.
  const tied = [review({ id: 'z' }), review({ id: 'y' })];
  eq(sortMyReviews(tied).map((r) => r.id).join(''), 'yz', 'the id breaks a tie, so the order is stable');
}

/* ── 2. the sentence above the list ───────────────────────────────────────*/

{
  const failed = myReviewsNote('error', 0, false);
  ok(!/haven’t reviewed/.test(failed), 'a failed read never says you have written nothing');
  ok(/replaces the old one/.test(failed),
    'the reader is warned off writing a replacement, because the write is an upsert with no undo');

  const part = myReviewsNote('partial', 3, false);
  ok(!/^3 reviews/.test(part), 'no count is stated over a read known to be short');
  ok(/not all of the ones/.test(part), 'a prefix is named as a prefix');

  const loading = myReviewsNote('loading', 0, false);
  ok(!/haven’t reviewed/.test(loading), 'a read still in flight never asserts an empty set');

  const none = myReviewsNote('ready', 0, false);
  ok(/haven’t reviewed/.test(none), 'a completed read with nothing in it may say so');

  eq(myReviewsNote('ready', 1, false), 'One review, in your own words, about somebody you trained with.',
    'one review is not "1 reviews"');
  ok(/^2 reviews/.test(myReviewsNote('ready', 2, false)), 'two is plural and carries its figure');

  eq(new Set([failed, part, loading, none, myReviewsNote('ready', 2, false)]).size, 5,
    'five situations, five sentences');
}

/* ── 2b. the review that is already on screen ─────────────────────────────*/

{
  // app/(client)/my-coach.tsx draws "Your Review" for the CURRENT coach and
  // filters that coach out of the list underneath, so an empty list there does
  // not mean an empty record. A member who has reviewed exactly one person —
  // the one whose review is six inches up the same screen — must not be told
  // they have never reviewed a coach.
  const onlyTheOneAbove = myReviewsNote('ready', 0, true);
  ok(!/haven’t reviewed a coach/.test(onlyTheOneAbove),
    'the review on screen above counts as a review you have written');
  ok(/only one you have reviewed/.test(onlyTheOneAbove), 'and it is named as the reason the list is empty');

  eq(myReviewsNote('ready', 1, true), 'One other coach you have reviewed, besides the one above.',
    'with the current coach above, the list is of OTHERS and says so');
  ok(/^3 other coaches/.test(myReviewsNote('ready', 3, true)), 'plural, and still "other"');

  // The two failure branches must not change their meaning for the flag: a read
  // that failed has told us nothing about either list.
  eq(myReviewsNote('error', 0, true), myReviewsNote('error', 0, false),
    'a failed read says the same thing whoever is on screen above it');
  eq(myReviewsNote('loading', 0, true), myReviewsNote('loading', 0, false),
    'so does a read still in flight');
}

/* ── 3. what was said, without a hole in it ───────────────────────────────*/

{
  eq(myReviewRatingLine(review({ rating: 4 })), 'You rated Sam Turner 4 out of 5.',
    'the coach is named where the record holds a name');
  const nameless = myReviewRatingLine(review({ coachName: null, rating: 2 }));
  eq(nameless, 'You gave 2 out of 5.',
    'no name in the record means a sentence that does not need one');
  ok(!/—|undefined|null/.test(nameless), 'never a dash, and never a variable printed raw');
  // "your coach" would be a lie about somebody they have left, and it looks
  // like a name where a name is expected.
  ok(!/your coach/i.test(nameless), 'a coach who is no longer theirs is not called "your coach"');

  // A rating that did not come back. `Number(r.rating) || 0` used to make this
  // "You rated Sam Turner 0 out of 5" — a number below the lowest anybody is
  // allowed to give, about a named person, invented out of an absent column.
  const unread = myReviewRatingLine(review({ rating: null }));
  ok(!/\b0\b/.test(unread), 'an unread rating is never printed as a zero');
  ok(!/null|undefined|NaN/.test(unread), 'and never as a variable printed raw');
  ok(/couldn’t read/.test(unread), 'it says the rating could not be read');
  ok(/Sam Turner/.test(unread), 'the coach is still named where the record holds a name');
  const unreadNameless = myReviewRatingLine(review({ rating: null, coachName: null }));
  ok(!/—|null|undefined/.test(unreadNameless), 'no hole where the name would be');
  ok(/couldn’t read/.test(unreadNameless), 'the nameless row says it too');
}

/* ── 4. who can read it ───────────────────────────────────────────────────*/

{
  const listed = myReviewVisibilityLine(review({ coachListed: true }));
  ok(/public profile/.test(listed), 'a live review of a listed coach is on a page anybody can browse');
  ok(/first name/.test(listed), 'and it carries the member’s first name, which they are told');

  const unlisted = myReviewVisibilityLine(review({ coachListed: false }));
  ok(!/public profile/.test(unlisted),
    'a coach who never ticked "list me" has no public profile for it to be on');
  ok(/can read it/.test(unlisted), 'the coach still reads it, which is the part that stays true');

  // Withdrawn beats listed. A review taken down is off the profile whether or
  // not the coach is in the directory, and the member is the one person
  // `coach_reviews_for` will not show it to.
  const gone = myReviewVisibilityLine(review({ coachListed: true, withdrawnAt: '2026-04-01T00:00:00.000Z' }));
  ok(/Withdrawn/.test(gone), 'a withdrawn review says so first');
  ok(!/public profile/.test(gone), 'withdrawn is not still on a profile because the coach is listed');
  ok(/replaces this one/.test(gone),
    'and the upsert is spelled out, because a "new" review is the same row');

  eq(new Set([listed, unlisted, gone]).size, 3, 'three states, three sentences');
}

/* ── 5. edited ────────────────────────────────────────────────────────────*/

eq(myReviewEditedLine(review({ edited: false })), null,
  'an unedited review gets no line rather than a sentence about nothing');
ok((myReviewEditedLine(review({ edited: true })) ?? '').length > 0,
  'an edited one says so, because the coach’s reply was cleared when it happened');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'MY REVIEWS FAILURES:\n' + errors.join('\n') : 'myReviews: ok — a failed read never says you wrote nothing, a prefix is never counted, and no sentence claims a public profile that is not there');
if (errors.length) process.exit(1);
