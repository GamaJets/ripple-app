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
// Not wired into `npm test` — package.json and tsconfig.test.json belong to
// another agent this session. Run it with:
//
//   npx tsc src/lib/endCoaching.test.ts --outDir .tmp-endcoaching \
//     --module node16 --moduleResolution node16 --target ES2020 --strict \
//     && node .tmp-endcoaching/endCoaching.test.js
import {
  coachLabel, leaveCoachPrompt, leaveOutcome, endCoachingErrorMessage,
  type EndCoachingResult,
} from './endCoaching';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

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

if (errors.length) {
  console.error(`endCoaching: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('endCoaching: ok');
