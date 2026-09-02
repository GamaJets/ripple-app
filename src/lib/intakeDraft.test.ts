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
import { emptyIntake, type Intake } from './intake';
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

if (errors.length) {
  console.error(`intakeDraft: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('intakeDraft: ok — the words survive, and they never overwrite on their own');
