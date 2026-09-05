// Leaving a coach — the words, not the wire. Compile with tsc then run with node.
//
// The assertions that matter here are the negative ones. A test that only
// checked "the success message mentions the coach" would pass against a version
// that said "you have left your coach" over a call the server refused, which is
// the exact failure endCoaching.ts exists to make impossible: the client stops
// sending check-ins to somebody who is still reading everything.
//
// So most of what follows asserts what the strings must NOT contain, and that
// the three outcomes cannot be mistaken for one another.
//
// Run by `npm test`, under tsconfig.test.json, like every other suite here. The
// "Not wired into `npm test`" note that used to sit here — with a hand-rolled
// tsc command beside it — stopped being true when the entry landed in
// package.json, and a header claiming a suite does not run tells the next reader
// that nothing is watching this file.
import {
  coachLabel, leaveCoachPrompt, leaveOutcome, endCoachingErrorMessage, replaceCoachNote,
  departureTally, departureLine, END_REASON_LABEL,
  END_REASONS, CLIENT_END_REASONS, CLIENT_END_REASON_LABEL, CLIENT_END_REASON_NOTE,
  CLIENT_END_EXPLAINER, clientEndConfirmBody, clientEndOutcomeLine,
  endReasonPrompt, END_RECORD_UNREADABLE, END_REASON_NOTE,
  type EndCoachingResult, type EndedRelationship, type EndRecord,
} from './endCoaching';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── the coach's name is never invented, and never rendered as a bug ──
//
// `profiles.full_name` is nullable and may be whitespace. Every one of these
// used to be a way to put the word "null" or an empty gap on screen inside the
// sentence "Leave ___?".
ok(coachLabel('Sam Rivera') === 'Sam Rivera', 'a real name must survive unchanged');
ok(coachLabel('  Sam Rivera  ') === 'Sam Rivera', 'a padded name must be trimmed, not shown padded');
ok(coachLabel(null) === 'your coach', 'no name must fall back to the role');
ok(coachLabel(undefined) === 'your coach', 'an absent name must fall back to the role');
ok(coachLabel('') === 'your coach', 'an empty name must fall back to the role');
ok(coachLabel('   ') === 'your coach', 'a whitespace-only name is not a name');

for (const bad of [null, undefined, '', '   '] as (string | null | undefined)[]) {
  const p = leaveCoachPrompt(bad);
  const all = `${p.title} ${p.body} ${p.confirmLabel}`;
  ok(!/null|undefined/i.test(all), `an unnamed coach must not leak a placeholder into the prompt: ${p.title}`);
}

// ── the prompt says what actually changes ──
//
// Each of these is a specific promise made by 68-end-coaching.sql or by the
// triggers in 47-share-progress-photo.sql. A prompt that drops one of them is
// asking somebody to agree to something they have not been told.
const named = leaveCoachPrompt('Sam Rivera');
ok(named.title.includes('Sam Rivera'), 'the prompt must name the coach being left');
ok(named.confirmLabel.includes('Sam Rivera'), 'the confirm button must name who is being left, not say "OK"');
ok(named.confirmLabel !== named.cancelLabel, 'the two buttons must not read the same');
ok(/photo/i.test(named.body), 'the prompt must mention progress photos — their grants are deleted, not suspended');
ok(/cannot be undone|can’t be undone|can not be undone/i.test(named.body),
  'the photo consequence is the one irreversible part and must be named as irreversible');
ok(/booked/i.test(named.body), 'the prompt must say booked sessions are not cancelled — they are not, and people assume they are');
ok(/nothing of yours is deleted|still yours|stays exactly as it is/i.test(named.body),
  'the prompt must say the client keeps their own history, or leaving reads as erasing it');
ok(/again|rejoin|re-join/i.test(named.body), 'the prompt must say re-joining is possible; everything but the photos is reversible');
ok(/message thread|thread/i.test(named.body), 'the message thread closes for the coach and the prompt must say so');

// The prompt must not promise a clean undo. It is reversible in every respect
// except the photos, and a blanket "you can undo this" would be a lie about the
// only part that matters.
ok(!/undo (this|it) (any ?time|later)/i.test(named.body), 'the prompt must not offer a blanket undo');

// ── the three outcomes are three different facts ──
const LEFT: EndCoachingResult = { ok: true, ended: true };
const NOTHING: EndCoachingResult = { ok: true, ended: false };
const FAILED: EndCoachingResult = { ok: false, reason: 'The change could not be saved.' };

const left = leaveOutcome(LEFT, 'Sam Rivera');
const nothing = leaveOutcome(NOTHING, 'Sam Rivera');
const failed = leaveOutcome(FAILED, 'Sam Rivera');

ok(left.title !== nothing.title && nothing.title !== failed.title && left.title !== failed.title,
  'the three outcomes must not share a title — they are three different states');
ok(left.body !== nothing.body && nothing.body !== failed.body, 'nor a body');

// THE assertion. A refused call must not contain a sentence that reads as
// departure, even in passing — a person skimming an alert takes its shape.
ok(!/you have left|you.?ve left|no longer see|is closed/i.test(`${failed.title} ${failed.body}`),
  `a failed call must not read as having succeeded: ${failed.title} — ${failed.body}`);
ok(/still/i.test(`${failed.title} ${failed.body}`), 'a failed call must say the relationship is still in place');
ok(failed.body.includes('Nothing was changed'), 'a failed call must say plainly that nothing changed');
ok(failed.body.includes('The change could not be saved.'), 'a failed call must carry the server\'s own reason forward');

// `ended: false` is the server saying the two were never linked. It is a true
// answer and must read as one — neither a success nor an error.
ok(!/you have left|you.?ve left/i.test(`${nothing.title} ${nothing.body}`),
  'a call that found no link must not claim the client left anybody');
ok(!/could not|failed|try again/i.test(`${nothing.title} ${nothing.body}`),
  'a call that found no link must not be dressed up as a failure — nothing went wrong');
ok(/no record/i.test(nothing.body), 'a call that found no link must say there was no record of one');

// The success message is allowed to be definite, because by then the server has
// said so — and it must still not claim anything was deleted.
ok(/no longer/i.test(left.body), 'a confirmed unlink may state plainly that the coach no longer sees anything');
ok(/still (yours|here)/i.test(left.body), 'a confirmed unlink must reassure that the client\'s own data survives');
ok(left.title.includes('Sam Rivera'), 'a confirmed unlink must name who was left');

// Every outcome survives an unnamed coach the same way the prompt does.
for (const r of [LEFT, NOTHING, FAILED]) {
  const o = leaveOutcome(r, null);
  ok(!/null|undefined/i.test(`${o.title} ${o.body}`), `an unnamed coach must not leak into an outcome: ${o.title}`);
  ok(o.body.includes('your coach'), 'an unnamed coach is referred to by role in every outcome');
}

// ── the server's raised messages become sentences ──
//
// 68-end-coaching.sql raises three, and each has a screen consequence the
// client can act on. An unrecognised failure keeps the server's own words.
ok(endCoachingErrorMessage('not signed in').includes('not signed in'), 'a signed-out call must say so');
ok(/own account/i.test(endCoachingErrorMessage('you cannot end a coaching relationship with yourself')),
  'ending with yourself must be explained, not echoed as SQL');
ok(/which coach/i.test(endCoachingErrorMessage('no one to end coaching with')),
  'a missing id must be explained as not knowing who was meant');

// The unknown case is the one that has cost this codebase debugging time when
// it was flattened. The server's words survive.
const odd = endCoachingErrorMessage('permission denied for table clients');
ok(odd.includes('permission denied for table clients'), 'an unrecognised failure must keep the server\'s own words');
ok(!/^something went wrong/i.test(odd), 'an unrecognised failure must not be flattened into a shrug');
ok(!/\.\.$/.test(odd), 'no message ends in a double full stop');

// Nothing, at all, from an empty raise.
ok(endCoachingErrorMessage(null) === 'The change could not be saved.', 'a null reason still produces a sentence');
ok(endCoachingErrorMessage('   ') === 'The change could not be saved.', 'a whitespace reason still produces a sentence');

/* ── R3: the answers, counted ──────────────────────────────────────────────
 *
 * Every departure reason was collected and none was ever counted. The negative
 * assertions matter most here too: a tally that printed "0 people have left
 * you" over a refused read would be a compliment manufactured out of a broken
 * query, and a percentage over a book of five would move twenty points because
 * one person moved house.
 */

const dep = (reason: unknown): EndedRelationship => ({ reason, endedAt: '2026-08-01T00:00:00Z' });

ok(departureTally(null) === null, 'an unread list of endings produces no tally at all');
ok(departureLine(null, 90) === null, 'and no sentence over it');
ok(departureLine(departureTally([]), 90) === null,
  'nor does an empty book: "0 people have left you" reads as a compliment on a book nobody has been on');

const tally = departureTally([
  dep('cost'), dep('cost'), dep('schedule'), dep('unsaid'), dep(null), dep('a-reason-a-later-build-invented'),
])!;
ok(tally.total === 6, 'every ending in the window is counted, whether or not anybody said why');
ok(tally.counts.length === 3, 'only the reasons with something against them are listed');
ok(tally.counts[0].reason === 'cost' && tally.counts[0].n === 2, 'commonest first');
ok(tally.unrecorded === 2,
  'a null and a reason this build does not know both land in unrecorded, rather than being dropped or guessed at');
ok(!tally.counts.some((c) => (c.reason as string) === 'a-reason-a-later-build-invented'),
  'and an unrecognised reason never becomes a row nothing can label');

// The one collapse this must never make. "They were asked and did not want to
// say" and "nobody asked" are opposite facts about the coach's own
// record-keeping, and only one of them is something they can still fix.
const unsaidOnly = departureTally([dep('unsaid'), dep(null)])!;
ok(unsaidOnly.counts.length === 1 && unsaidOnly.counts[0].n === 1 && unsaidOnly.unrecorded === 1,
  'an unrecorded ending is never folded in with They Did Not Say');

const line = departureLine(tally, 90)!;
ok(!/%/.test(line), 'there is no percentage in the line: a share over a small book is noise reading as a trend');
ok(line.includes(END_REASON_LABEL.cost.toLowerCase()), 'the commonest reason is named in the coach\u2019s own vocabulary');
ok(/90 days/.test(line), 'and the window is stated, because the whole figure is about a period');
ok(/not the same as/.test(line), 'the unrecorded ones are told apart from the ones somebody declined to explain');

const allBlank = departureLine(departureTally([dep(null), dep(null)]), 90)!;
ok(/nothing is recorded about why/.test(allBlank),
  'a book where nobody has been asked says so, rather than showing an empty list under a heading');


/* ── the member's own account of why they left ──────────────────────────────
 *
 * The only `endCoaching` call in the client app was on the Find a Trainer
 * DIRECTORY, and it was the one-argument form. So a member who wanted out had
 * to open a marketplace to find the exit, and the only churn reason ever
 * recorded was the coach's belief about somebody who was never asked.
 */

// The ids must be the SAME ids. A churn list that cannot hold a client's own
// answer beside a coach's guess is two lists, and the whole of
// `reasonAttribution` depends on them being one question asked of two people.
for (const r of CLIENT_END_REASONS) {
  ok(END_REASONS.includes(r), `every reason a client can pick is a reason the coach's list knows — ${r}`);
  ok(!!CLIENT_END_REASON_LABEL[r], `and carries a label — ${r}`);
  ok(!!CLIENT_END_REASON_NOTE[r], `and a line under it — ${r}`);
}

// The two a client cannot honestly answer.
ok(!CLIENT_END_REASONS.includes('coach-ended'),
  '"My Decision" is a coach speaking about themselves and is not offered to a client');
ok(!CLIENT_END_REASONS.includes('unsaid'),
  '"They Did Not Say" is a fact about the coach\'s asking — a client who will not say has the Skip button');

// First person, and not the coach's wording carried over.
for (const r of CLIENT_END_REASONS) {
  ok(!/\bthey\b/i.test(CLIENT_END_REASON_NOTE[r]),
    `the member reads about themselves, not about a third party — ${r}: ${CLIENT_END_REASON_NOTE[r]}`);
}

ok(/coach sees this/i.test(CLIENT_END_EXPLAINER), 'the member is told who reads it before they write it');
ok(/your own words/i.test(CLIENT_END_EXPLAINER), 'and that it is filed as theirs rather than as a guess');
ok(/skip/i.test(CLIENT_END_EXPLAINER), 'and that they can leave without answering');

const body = clientEndConfirmBody('Sam');
ok(/Sam/.test(body), 'the confirmation names the coach');
ok(/no longer see your training/i.test(body), 'and says what the coach loses access to');
ok(/nothing you have logged is deleted/i.test(body), 'and that the member loses no record of their own');
ok(/not refunded here/i.test(body) || /settled with them directly/i.test(body),
  'and that money is not settled by this button');
ok(/this coach/.test(clientEndConfirmBody(null)), 'an unnamed coach still gets a grammatical sentence');
ok(/this coach/.test(clientEndConfirmBody('   ')), 'and so does a blank name');

// The three outcomes, kept apart. `reasonStored` false with `ended` true is a
// real answer from endCoachingWithReason, not a failure.
ok(/nothing was changed/i.test(clientEndOutcomeLine(false, true, false)),
  'a server that found no relationship says so rather than claiming an ending');
ok(/Nothing was recorded about why/i.test(clientEndOutcomeLine(true, false, false)),
  'skipping is reported as having recorded nothing');
ok(/passed on to them/i.test(clientEndOutcomeLine(true, true, true)),
  'a stored reason says it reached the coach');
const lost = clientEndOutcomeLine(true, true, false);
ok(/could not be recorded/i.test(lost), 'a reason that did not save says so');
ok(/ending itself did happen/i.test(lost), 'and does not leave the member wondering whether they left');
ok(!/passed on to them/i.test(lost), 'and never claims the coach was told');

/* ── asking a second coach ───────────────────────────────────────────────── */
//
// `link_coaching` ends every other active relationship, so a member browsing
// the directory while already coached is one accept away from losing the coach
// they have. The screen offered three buttons and said none of this.

{
  const note = replaceCoachNote('Dana Ruiz', 'Sam Okafor');
  ok(note.includes('Dana Ruiz') && note.includes('Sam Okafor'), 'both coaches are named');
  ok(/stops coaching you/.test(note), 'and what happens to the first one is stated, not implied');
  ok(/not cancelled/.test(note), 'a booked session is not claimed to be cancelled by this');
  ok(/Nothing changes until/.test(note), 'and nothing is described as having happened yet');
  ok(!/refund|charged|fee/i.test(note), 'no claim is made about money this app does not move');

  const anon = replaceCoachNote(null, '   ');
  ok(!/null|undefined/.test(anon), 'an unread name leaves no hole');
  ok((anon.match(/your coach/g) || []).length >= 2, 'both fall back to a description rather than a blank');
}

/* ── "we could not read it" is not "there is nothing to read" ────────────────
 *
 * `fetchEndRecord` answered `null` for both — a refused read, a database with
 * no `end_reason` column, an empty id, AND `maybeSingle()` finding no ended
 * relationship because the coaching is still running. `endReasonPrompt` is the
 * only thing that consumes that value, and it read every one of them as a
 * failure. Harmless while nothing calls it; wrong the first time something
 * does, and wrong in the direction that sends a coach looking for a fault in a
 * relationship that is perfectly intact.
 */
{
  const unread = endReasonPrompt(END_RECORD_UNREADABLE);
  ok(/could not be read/.test(unread), 'a read that failed says so');
  ok(/not "nothing was recorded"/.test(unread),
    'and says out loud that it is not the same claim as an empty record');

  const noEnding = endReasonPrompt(null);
  ok(!/could not be read/.test(noEnding),
    'a read that worked and found no ended relationship is not reported as a failure');
  ok(/has ended/.test(noEnding), 'it says what it actually found');
  ok(noEnding !== unread, 'the two nulls that used to share a sentence no longer do');

  const rec: EndRecord = {
    reason: null, note: null, recordedByMe: null, endedByMe: null, endedAt: null,
  };
  const unrecorded = endReasonPrompt(rec);
  ok(/Nothing was recorded about why/.test(unrecorded),
    'an ending nobody explained is the one the coach can still go and ask about');
  ok(unrecorded !== noEnding && unrecorded !== unread,
    'and is a third sentence, because it is a third fact');

  eq(endReasonPrompt({ ...rec, reason: 'cost' }), END_REASON_NOTE.cost,
    'a recorded reason gets its own line and none of the three silences');
}

if (errors.length) {
  console.error(`endCoaching: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('endCoaching: ok');
