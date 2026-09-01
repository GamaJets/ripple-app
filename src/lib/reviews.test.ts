// Reviews of a named person, and the four sentences the product must never say
// about one. Compile with tsc, run with node.
//
// Everything here is an assertion about a claim: that a coach has no reviews,
// that a reader was never their client, that four ratings average to a figure,
// that a review saved. Each of those is false in a state the code can reach,
// and each false version is about somebody's livelihood.
import {
  ratingDisplay, formatAverage, ratingLine, reviewGate, reviewGateNote,
  reviewListState, gymLine, reviewerLabel, writeOutcome, asWriteResult,
  validateReview, draftProblemText, validateReply, unansweredCount,
  askMoment, askMomentNote, reviewAskDraft, askListNote,
  SETTLED_DAYS, GOAL_FRESH_DAYS, ASK_IS_UNFILTERED, WHO_REVIEWED_IS_HIDDEN,
  type AskCandidate,
  MIN_FOR_AVERAGE, MIN_RATING, MAX_RATING, MAX_BODY,
  IDENTITY_NOTE, EDIT_NOTE, WITHDRAW_NOTE, REPLY_NOTE,
  type Review, type WriteResult,
} from './reviews';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const rev = (p: Partial<Review>): Review => ({
  id: 'r1', rating: 5, body: 'Great', createdAt: '2026-08-01T00:00:00Z',
  edited: false, reviewerName: 'Cara', otherGym: null,
  coachReply: null, coachRepliedAt: null, ...p,
});

// ── "No reviews yet" is a claim, and a failed read does not support it ─────
//
// The single most important pair in this file. Both produce a null summary; one
// of them is a fact about the coach and the other is a fact about our server.
eq(ratingDisplay(null, 'ready').kind, 'none', 'a completed read with no rows is genuinely no reviews');
eq(ratingDisplay(null, 'error').kind, 'unknown', 'a failed read says nothing about the coach');
eq(ratingDisplay({ count: 9, sum: 40 }, 'error').kind, 'unknown',
  'rows returned alongside an error are not a rating either');
eq(ratingDisplay(null, 'loading').kind, 'loading', 'a read in flight is its own answer');
// 'partial' means the rows are real but there are more of them, and a count or
// an average over a fraction of the set is exactly what must not be printed.
eq(ratingDisplay({ count: 9, sum: 40 }, 'partial').kind, 'unknown',
  'a truncated read may not be counted or averaged');

// ── One rating is not a score ──────────────────────────────────────────────
eq(ratingDisplay({ count: 1, sum: 5 }, 'ready').kind, 'few', 'one review is a count, not a figure');
eq(ratingDisplay({ count: MIN_FOR_AVERAGE - 1, sum: 10 }, 'ready').kind, 'few',
  'just under the threshold is still a count');
eq(ratingDisplay({ count: MIN_FOR_AVERAGE, sum: 12 }, 'ready').kind, 'average',
  'at the threshold an average is allowed');
// There is deliberately no branch that computes an average below the threshold,
// so a screen cannot reach around this by reading the summary itself.
{
  const few = ratingDisplay({ count: 2, sum: 10 }, 'ready');
  ok(!('average' in few), 'the "few" case carries no average for a screen to print');
}
{
  const avg = ratingDisplay({ count: 4, sum: 18 }, 'ready');
  eq(avg.kind === 'average' ? avg.average : null, 4.5, 'the average is the mean of the ratings');
}

eq(formatAverage(4.5), '4.5', 'one decimal');
eq(formatAverage(5), '5.0', 'a whole number keeps its decimal so 5 and 4.9 line up');
eq(formatAverage(4.44), '4.4', 'rounded to one place');
eq(formatAverage(4.45), '4.5', 'and rounded up at the halfway point');
// Ratings are 1..5, so an average outside that came from bad arithmetic and
// must not be printed as though a coach scored 6.
eq(formatAverage(7), '5.0', 'an impossible average is clamped, never shown');
eq(formatAverage(0), '1.0', 'and so is an impossible low one');

eq(ratingLine({ kind: 'unknown' }), null, 'an unreadable rating prints nothing at all');
eq(ratingLine({ kind: 'loading' }), null, 'nor does one still loading');
eq(ratingLine({ kind: 'none' }), 'No reviews yet', 'a real empty says so');
eq(ratingLine({ kind: 'few', count: 1 }), '1 review', 'singular');
eq(ratingLine({ kind: 'few', count: 2 }), '2 reviews', 'plural');
eq(ratingLine({ kind: 'average', average: 4.5, count: 8 }), '4.5 from 8 reviews',
  'an average is always shown with the count it came from');

// ── Who may write one, and what we may say when we do not know ────────────
eq(reviewGate({ status: 'ready', canReview: true,  isSelf: false }), 'allowed', 'a client may write one');
eq(reviewGate({ status: 'ready', canReview: false, isSelf: false }), 'not-a-client', 'a stranger may not');
eq(reviewGate({ status: 'error', canReview: false, isSelf: false }), 'unknown',
  'a failed check is not evidence they were never a client');
eq(reviewGate({ status: 'error', canReview: true,  isSelf: false }), 'unknown',
  'and a stale true is not evidence they were');
eq(reviewGate({ status: 'ready', canReview: null,  isSelf: false }), 'unknown',
  'no answer is not a no');
eq(reviewGate({ status: 'loading', canReview: null, isSelf: false }), 'loading', 'still asking');
// Self wins over everything, including a read that has not finished: a coach
// looking at their own profile is knowable without asking the server.
eq(reviewGate({ status: 'loading', canReview: null, isSelf: true }), 'self', 'your own profile, immediately');
eq(reviewGate({ status: 'ready', canReview: true, isSelf: true }), 'self', 'even if the gate says yes');

{
  const unknown = reviewGateNote('unknown')!;
  ok(!/only .*client/i.test(unknown),
    `an unknown gate must not tell somebody they were never a client — got "${unknown}"`);
  ok(/our end|try again/i.test(unknown), 'and it must say the failure is ours');
  ok(/client/i.test(reviewGateNote('not-a-client')!), 'a real refusal explains the rule');
  eq(reviewGateNote('allowed'), null, 'nothing to say when they may write one');
}

// ── The list, and the sentence under an empty one ─────────────────────────
eq(reviewListState('loading', []), 'loading', 'still reading');
eq(reviewListState('ready', []), 'none', 'a completed empty read is empty');
eq(reviewListState('error', []), 'unreadable', 'a failed read is not an empty profile');
eq(reviewListState('error', [rev({})]), 'unreadable',
  'rows held over from before a failure are not the current set');
eq(reviewListState('ready', [rev({})]), 'some', 'rows are rows');

// ── What a reader is told, and what is withheld ───────────────────────────
eq(reviewerLabel(rev({ reviewerName: 'Cara' })), 'Cara', 'a first name is shown');
eq(reviewerLabel(rev({ reviewerName: null })), 'A client', 'a missing name is not invented');
eq(reviewerLabel(rev({ reviewerName: '   ' })), 'A client', 'nor is whitespace passed off as one');

// Cross-tenant labelling. The database fills `otherGym` only when the review's
// gym differs from the reader's, so a null here means "same gym" and must
// produce no line at all rather than an empty label.
eq(gymLine(rev({ otherGym: null })), null, 'same gym, nothing said');
eq(gymLine(rev({ otherGym: '  ' })), null, 'an empty gym name is not a gym');
eq(gymLine(rev({ otherGym: 'Iron Works' })), 'Trained with them at Iron Works',
  'a review from another gym is labelled with it');

// ── Saving: a word from the server, never an assumption ───────────────────
//
// The RPC returns a word because a zero-row write over PostgREST is not an
// error. `saved` is true for exactly one of them.
const RESULTS: WriteResult[] = ['written', 'not_a_client', 'invalid_rating', 'self', 'signed_out', 'failed'];
for (const r of RESULTS) {
  const o = writeOutcome(r, 'Alma');
  ok(o.title.length > 0 && o.body.length > 0, `${r} has something to say`);
  eq(o.saved, r === 'written', `${r} is only "saved" when it was written`);
  if (r !== 'written') {
    ok(!/saved\b(?!.*not)/i.test(o.title) || /not saved|could not/i.test(o.title),
      `${r} must not read as a success — got "${o.title}"`);
  }
}
ok(writeOutcome('written', 'Alma').body.includes('Alma'), 'the coach is named in the confirmation');
ok(/first name/i.test(writeOutcome('written', 'Alma').body),
  'and the client is reminded their name goes with it');
eq(writeOutcome('not_a_client', null).body.includes('your coach'), true,
  'a missing name falls back to a phrase, never to "null"');

// Anything the server did not say is a failure, not a success. This is the
// branch that catches an RPC that returned null because the call itself broke.
eq(asWriteResult('written'), 'written', 'a known word passes through');
eq(asWriteResult(null), 'failed', 'no answer is a failure');
eq(asWriteResult(undefined), 'failed', 'and so is an undefined one');
eq(asWriteResult('ok'), 'failed', 'a word the server does not return is not a success');
eq(asWriteResult({ result: 'written' }), 'failed', 'nor is an object that mentions one');

// ── The draft ─────────────────────────────────────────────────────────────
eq(validateReview({ rating: 5, body: 'good' }), 'ok', 'a normal review');
eq(validateReview({ rating: null, body: 'good' }), 'no-rating', 'a rating is required');
eq(validateReview({ rating: 0, body: '' }), 'bad-rating', `${MIN_RATING} is the floor`);
eq(validateReview({ rating: 6, body: '' }), 'bad-rating', `${MAX_RATING} is the ceiling`);
eq(validateReview({ rating: 4.5, body: '' }), 'bad-rating', 'half stars are not a thing here');
eq(validateReview({ rating: 3, body: '' }), 'ok', 'a rating with no words is a review');
eq(validateReview({ rating: 3, body: 'x'.repeat(MAX_BODY + 1) }), 'body-too-long', 'there is a limit');
eq(validateReview({ rating: 3, body: ' '.repeat(MAX_BODY + 40) }), 'ok',
  'the limit is on what is written, not on trailing whitespace');
for (const p of ['ok', 'no-rating', 'bad-rating', 'body-too-long'] as const) {
  eq(draftProblemText(p).length === 0, p === 'ok', `${p} says why`);
}
eq(validateReply('short'), 'ok', 'a reply');
eq(validateReply('x'.repeat(2000)), 'too-long', 'a reply has a limit too');

// ── The promises the product makes in words ───────────────────────────────
//
// Each of these is a sentence somebody reads before doing something they cannot
// fully undo. They live in the library so this file is where they are checked.
ok(/first name/i.test(IDENTITY_NOTE) && /coach/i.test(IDENTITY_NOTE),
  'the client is told their first name is published and their coach will likely know them');
ok(!/anonymous/i.test(IDENTITY_NOTE), 'and is never told a review is anonymous, because it is not');
ok(/repl/i.test(EDIT_NOTE) && /remov|clear|delet/i.test(EDIT_NOTE),
  'editing warns that the coach’s reply goes with the text it answered');
ok(/hide|hidden|everyone/i.test(WITHDRAW_NOTE), 'withdrawal says what it does');
ok(/public/i.test(REPLY_NOTE) && /no way to take|cannot take|there is no way/i.test(REPLY_NOTE),
  'the coach is told their reply is public and that it is their only recourse');

// ── The coach's inbox ─────────────────────────────────────────────────────
eq(unansweredCount([rev({ coachReply: null }), rev({ id: 'r2', coachReply: 'thanks' })], 'ready'), 1,
  'one review is waiting on an answer');
eq(unansweredCount([rev({ coachReply: '   ' })], 'ready'), 1, 'a blank reply is no reply');
eq(unansweredCount([rev({})], 'error'), null, 'nothing is counted off a read that failed');
eq(unansweredCount([rev({})], 'partial'), null,
  'nor off a truncated one — "all answered" would be the wrong thing to tell a coach');


/* ── asking for one ─────────────────────────────────────────────────────── */

// The refusal that is not negotiable. Asking only the clients who look happy is
// review-gating: against Apple's guidelines, against Google's, and a lie told
// to everybody who reads the average afterwards. Nothing in `AskCandidate`
// carries a rating, a drift band or anything else that could stand in for one,
// and that absence is the enforcement.
const ASK_DAY = 86_400_000;
const NOW_ASK = Date.parse('2026-09-01T12:00:00.000Z');
const cand = (o: Partial<AskCandidate>): AskCandidate => ({
  clientId: 'c1', name: 'Sarah Ahmed', since: null, goalReachedAt: null, asked: false, ...o,
});

// A goal they set themselves and reached is the strongest moment there is: they
// have just told the app, in their own words, that the thing they came for
// happened.
eq(askMoment(cand({ goalReachedAt: new Date(NOW_ASK - 2 * ASK_DAY).toISOString() }), NOW_ASK),
  'goal-reached', 'a goal reached two days ago is the moment');
eq(askMoment(cand({ goalReachedAt: new Date(NOW_ASK - (GOAL_FRESH_DAYS + 5) * ASK_DAY).toISOString() }), NOW_ASK),
  'none', 'and a goal reached three weeks ago is not — that is a prompt, not a conversation');

// Long enough on the book that there is something to write about.
eq(askMoment(cand({ since: new Date(NOW_ASK - (SETTLED_DAYS + 10) * ASK_DAY).toISOString() }), NOW_ASK),
  'settled', 'a long steady record is a moment');
eq(askMoment(cand({ since: new Date(NOW_ASK - 20 * ASK_DAY).toISOString() }), NOW_ASK),
  'none', 'three weeks in is asking somebody to review a plan they are still on');

// A goal outranks a settled record: a client who is both is asked about the goal.
eq(askMoment(cand({
  since: new Date(NOW_ASK - 200 * ASK_DAY).toISOString(),
  goalReachedAt: new Date(NOW_ASK - 1 * ASK_DAY).toISOString(),
}), NOW_ASK), 'goal-reached', 'the goal wins over the tenure');

// THE two refusals.
eq(askMoment(cand({ since: new Date(NOW_ASK - 300 * ASK_DAY).toISOString(), asked: true }), NOW_ASK),
  'none', 'somebody the coach has already asked is never asked again');
eq(askMoment(cand({ since: new Date(NOW_ASK - 300 * ASK_DAY).toISOString(), asked: null }), NOW_ASK),
  'none', 'and neither is somebody the record could not be read for — a failed read must not produce a prompt');
// The question this field WANTS to be is "have they already reviewed me", and
// the coach's app cannot answer it: `coach_reviews` has no policy and no grant
// to authenticated, because RLS selects rows and not columns and any policy
// wide enough to show a review to a stranger also hands over `client_id`. That
// refusal is right and this feature does not erode it.
ok(/cannot tell you who/i.test(WHO_REVIEWED_IS_HIDDEN), 'and the screen says so plainly');
ok(/may still appear/i.test(WHO_REVIEWED_IS_HIDDEN), 'including what a coach will actually notice');
// An undateable join is not a long one. A client the roster cannot date is as
// likely to have joined on Tuesday as last year.
eq(askMoment(cand({ since: null }), NOW_ASK), 'none', 'an unknown join date is no moment at all');
eq(askMoment(cand({ since: 'not a date' }), NOW_ASK), 'none', 'and neither is an unparseable one');
// A goal dated in the future — a wrong clock, a bad write — is not a moment.
eq(askMoment(cand({ goalReachedAt: new Date(NOW_ASK + 5 * ASK_DAY).toISOString() }), NOW_ASK),
  'none', 'a goal dated in the future is not a moment that has happened');

/* ── the words ──────────────────────────────────────────────────────────── */

for (const m of ['goal-reached', 'settled', 'none'] as const) {
  const note = askMomentNote(m, cand({
    since: new Date(NOW_ASK - 100 * ASK_DAY).toISOString(),
    goalReachedAt: new Date(NOW_ASK - 3 * ASK_DAY).toISOString(),
  }), NOW_ASK);
  ok(note.endsWith('.'), `${m} has a sentence`);
  ok(!note.includes('!'), `${m} does not shout`);
  ok(!/undefined|null|NaN/.test(note), `${m} renders no placeholder`);
}

const draft = reviewAskDraft('goal-reached', 'Sarah Ahmed', 'Tim Rodgers');
ok(draft.includes('Sarah'), 'the draft greets them');
ok(draft.includes('Tim'), 'and signs off as the coach');
ok(/congratulations/i.test(draft), 'and a goal-reached draft opens on the goal');
ok(!/congratulations/i.test(reviewAskDraft('settled', 'Sarah', 'Tim')),
  'while a settled one does not congratulate somebody on nothing in particular');
// THE assertion about the words. "A good review" and "a review" are two
// different requests, and only one of them leaves an average worth reading.
ok(!/(good|great|five|5[ -]star|positive|glowing|kind) (word|review)/i.test(draft),
  'the draft asks for a review and never for a good one');
ok(/whatever you actually think/i.test(draft), 'and says so out loud');
ok(!draft.includes('!'), 'and does not shout');
ok(!/undefined|null/.test(reviewAskDraft('settled', null, null)),
  'a nameless client and a nameless coach still produce a readable message');

/* ── the list note ──────────────────────────────────────────────────────── */

eq(askListNote(null), 'Working out who is worth asking…', 'null in, null out');
ok(askListNote([{ moment: 'none' as const }]).includes('real answer'),
  'an empty list is a real answer rather than an apology');
ok(askListNote([{ moment: 'none' as const }]).includes('monthly'),
  'and it says why this is not a monthly sweep');
ok(askListNote([{ moment: 'settled' as const }]).includes('1 client is'), 'one, singular');
ok(askListNote([{ moment: 'settled' as const }, { moment: 'goal-reached' as const }]).includes('2 clients are'), 'two, plural');
ok(askListNote([{ moment: 'settled' as const }]).includes('send it yourself'),
  'and every state says the app sends nothing');

ok(/never will/i.test(ASK_IS_UNFILTERED), 'the no-gating sentence is not hedged');
ok(!/[!]/.test(ASK_IS_UNFILTERED), 'and does not shout');


if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`reviews: ok (average from ${MIN_FOR_AVERAGE}, ${RESULTS.length} outcomes)`);
