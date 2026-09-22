// The intake draft's rules. Compile with tsc, run with node.
//
// The screen's header states the position everything here has to hold:
//
//     "It must not save over a document it could not read. If the read failed,
//      what is on screen is an empty form standing in for one that may be full,
//      and saving it would replace a real disclosure with a blank."
//
// Keeping a draft on the phone is what makes that rule survivable rather than
// expensive — the words are no longer the price of obeying it. So the
// assertions that matter here are the ones that stop a draft turning into the
// very overwrite the rule forbids.
import { INTAKE_VERSION, TRAINING_YEARS, TIME_WINDOWS, emptyIntake, type Intake } from './intake';
import {
  INTAKE_DRAFT_PREFIX, draftDecision, draftHasContent, intakeDraftKey,
  parseIntakeDraft, serialiseIntakeDraft, type IntakeDraft,
} from './intakeDraft';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const filled = (at: string, note = 'a bad knee'): Intake => {
  const i = emptyIntake(at);
  i.want = { ...i.want, headline: note };
  return i;
};
const draft = (at: string, basedOn: string | null, intake?: Intake): IntakeDraft =>
  ({ at, basedOn, intake: intake ?? filled(at, 'typed on the phone') });

/* ── the key is per account ──────────────────────────────────────────────── */

{
  ok(intakeDraftKey('u1') !== intakeDraftKey('u2'),
    'TWO PEOPLE SHARING A PHONE MUST NOT INHERIT EACH OTHER’S MEDICAL HISTORY');
  ok(intakeDraftKey('u1').startsWith(INTAKE_DRAFT_PREFIX), 'and every key is under the one prefix');
  ok(intakeDraftKey(null).length > INTAKE_DRAFT_PREFIX.length,
    'a signed-out draft still has somewhere to go rather than a key ending in "null"');
}

/* ── the decision, which is the whole file ───────────────────────────────── */

{
  eq(draftDecision(null, null), 'none', 'no draft is nothing to decide');
  eq(draftDecision(null, filled('2026-09-01T10:00:00.000Z')), 'none', 'even with a server copy');

  // Nothing on the server: there is nothing to lose, so the draft goes up.
  eq(draftDecision(draft('2026-09-02T10:00:00.000Z', null), null), 'restore',
    'a draft with no server document behind it is just the form');

  // Built from THIS server copy: it is the next few sentences of it.
  const server = filled('2026-09-01T10:00:00.000Z');
  eq(draftDecision(draft('2026-09-02T10:00:00.000Z', '2026-09-01T10:00:00.000Z'), server), 'restore',
    'a draft built from this exact document continues it');

  // The offline case, and the one that matters: the read failed, so the draft
  // was started from a blank, and the server turns out to hold a real
  // disclosure. Nothing may be decided by the app here.
  eq(draftDecision(draft('2026-09-02T10:00:00.000Z', null), server), 'ask',
    'A DRAFT STARTED FROM A BLANK MUST NEVER SILENTLY REPLACE A REAL DISCLOSURE');

  // Built from an OLDER copy than the one that came back: somebody edited the
  // form somewhere else in between, and that is two accounts of one person.
  eq(draftDecision(draft('2026-09-02T10:00:00.000Z', '2026-08-01T00:00:00.000Z'), server), 'ask',
    'and neither may a draft built from a version that has since moved on');

  // A newer draft never wins on recency alone. Recency is not authority here:
  // the blank-started draft is newer precisely because the read failed.
  eq(draftDecision(draft('2030-01-01T00:00:00.000Z', null), server), 'ask',
    'being newer is not the same as being right');
}

/* ── round trip ──────────────────────────────────────────────────────────── */

{
  const d = draft('2026-09-02T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  const back = parseIntakeDraft(serialiseIntakeDraft(d));
  ok(back != null, 'a draft survives the disk');
  eq(back!.at, d.at, 'with its own moment');
  eq(back!.basedOn, d.basedOn, 'and with what it was built from, which is the whole decision');
  eq(back!.intake.want.headline, 'typed on the phone', 'and with the words in it');

  eq(parseIntakeDraft(null), null, 'nothing stored is no draft');
  eq(parseIntakeDraft('{not json'), null, 'unreadable bytes are no draft');
  eq(parseIntakeDraft('[]'), null, 'nor is a list');
  eq(parseIntakeDraft('{"basedOn":null,"intake":{}}'), null, 'nor one with no moment on it');
  eq(parseIntakeDraft(JSON.stringify({ at: 'x' })), null, 'nor one with no document in it');
  // A draft whose `basedOn` is missing reads as "started from a blank", which
  // is the CAUTIOUS answer: it forces 'ask' rather than 'restore'.
  const noBase = parseIntakeDraft(JSON.stringify({ at: 'x', intake: emptyIntake('x') }));
  eq(noBase?.basedOn, null, 'a missing basedOn is null');
  eq(draftDecision(noBase, filled('2026-09-01T10:00:00.000Z')), 'ask',
    'and null is the cautious answer, not the permissive one');
}

/* ── is there anything in it ─────────────────────────────────────────────── */

{
  eq(draftHasContent(null), false, 'no document has nothing in it');
  eq(draftHasContent(emptyIntake('2026-09-01T00:00:00.000Z')), false,
    'and a blank form is not worth offering to restore over anything');
  eq(draftHasContent(filled('2026-09-01T00:00:00.000Z')), true, 'one sentence is worth keeping');

  const oneAnswer = emptyIntake('2026-09-01T00:00:00.000Z');
  oneAnswer.readiness = { chest: { answer: 'no' } };
  eq(draftHasContent(oneAnswer), true, 'and so is one readiness answer');

  const oneNumber = emptyIntake('2026-09-01T00:00:00.000Z');
  oneNumber.availability = { ...oneNumber.availability, daysPerWeek: 3 };
  eq(draftHasContent(oneNumber), true, 'and so is one number');

  const whitespace = emptyIntake('2026-09-01T00:00:00.000Z');
  whitespace.want = { ...whitespace.want, headline: '   ' };
  eq(draftHasContent(whitespace), false, 'three spaces are not an answer');
}

/* ── the answer that did not count as an answer ────────────────────────────
 *
 * `history.years` was tested with `typeof n === 'number'` and `TrainingYears`
 * is a string union, so no value it can hold ever passed. It is the FIRST
 * question of the FIRST section and the only one of the six choice fields not
 * caught by another line, and `draftHasContent` is the early return on the only
 * write to disk. */

{
  const AT = '2026-09-01T00:00:00.000Z';

  // Every value the field can hold, from the catalogue rather than from three
  // hand-picked ones — a fix that happened to catch 'threeToTen' and missed
  // 'none' would be the same defect one option along.
  for (const y of TRAINING_YEARS) {
    const only = emptyIntake(AT);
    only.history = { ...only.history, years: y.id };
    eq(draftHasContent(only), true,
      `"${y.label}" as somebody's first and only answer is content and must survive backing out of the screen`);
  }

  // The second shape, and the worse one. Clearing the free text while a chip
  // stands must still be worth writing: a false answer here does not merely
  // skip a save, it LEAVES THE PREVIOUS DRAFT ON THE DISK, to be handed back
  // later as the member's current answers. Deleting a sentence and being given
  // it again is worse than losing it.
  const cleared = emptyIntake(AT);
  cleared.want = { ...cleared.want, headline: 'lose two stone' };
  cleared.history = { ...cleared.history, years: 'oneToThree', doingNow: 'parkrun' };
  eq(draftHasContent(cleared), true, 'a form with text and a chip is content');
  cleared.want = { ...cleared.want, headline: '' };
  cleared.history = { ...cleared.history, doingNow: '' };
  eq(draftHasContent(cleared), true,
    'and with every word deleted and only the chip left it is STILL content, so the stale draft is overwritten rather than left to be offered back');

  // The rest of the field's neighbourhood, so the fix is a rule and not a
  // patch: a null choice is still nothing, and the other choice fields were
  // already right and must stay right.
  const none = emptyIntake(AT);
  none.history = { ...none.history, years: null };
  eq(draftHasContent(none), false, 'and an unanswered one is still an empty form');

  const coached = emptyIntake(AT);
  coached.history = { ...coached.history, coachedBefore: 'no' };
  eq(draftHasContent(coached), true, '"have you been coached before" was already counted and still is');

  const times = emptyIntake(AT);
  times.availability = { ...times.availability, times: [TIME_WINDOWS[0].id] };
  eq(draftHasContent(times), true, 'and so was a picked time window');

  // The draft round-trips through JSON, so the answer that was being dropped
  // has to come back out again as itself.
  const kept = draft(AT, null, cleared);
  const back = parseIntakeDraft(serialiseIntakeDraft(kept));
  eq(back?.intake.history.years, 'oneToThree', 'and it survives the disk it can now reach');
  eq(back?.intake.version, INTAKE_VERSION, 'under the version it was written at');
}

if (errors.length) {
  console.error(`intakeDraft: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('intakeDraft: ok — the words survive, and they never overwrite on their own');
