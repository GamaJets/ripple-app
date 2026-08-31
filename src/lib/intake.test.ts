// The intake, and the two things about it that are not features.
// Compile with tsc, run with node.
//
// Half of these assertions are about what this module must NOT do. It must not
// score a readiness questionnaire, must not rank its own questions, and must
// not let a screen say "they have not filled it in" on the strength of a read
// that failed. Those are the failures that would matter; the parsing is the
// easy half.
import {
  INTAKE_SECTIONS, INTAKE_VERSION, READINESS_QUESTIONS, READINESS_NOT_ADVICE,
  READINESS_SEE_A_DOCTOR, askIntakeMessage, emptyIntake, intakeLine, intakeOwnership,
  intakeProgress, intakePrompt, intakeState, parseIntake, readinessDisclosed,
  readinessNote, readinessUnanswered,
  type Intake,
} from './intake';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = '2026-08-31T09:00:00.000Z';

/** A document with every section answered. Built by filling the empty one, so
 *  a section added later fails these tests loudly rather than silently
 *  reporting itself complete. */
function fullIntake(): Intake {
  const i = emptyIntake(NOW);
  for (const q of READINESS_QUESTIONS) i.readiness[q.id] = { answer: 'no' };
  i.history = { years: 'oneToThree', doingNow: 'Parkrun most Saturdays', kinds: ['running'], coachedBefore: 'no' };
  i.want = { headline: 'Deadlift my bodyweight', by: 'By Christmas', why: 'I want to feel strong again' };
  i.tried = { worked: 'Couch to 5k', didnt: 'Six am spin classes', wont: 'Anything involving burpees' };
  i.availability = { daysPerWeek: 3, sessionMins: 45, times: ['evening'], place: 'gym', equipment: 'Full commercial gym' };
  i.practical = { work: 'desk', sleepHours: 6.5, anythingElse: '' };
  i.emergency = { name: 'Sam Okafor', phone: '07700 900123', relation: 'Partner' };
  return i;
}

/* ── the seven questions ────────────────────────────────────────────────── */

eq(INTAKE_VERSION, 1, 'the document format on disk is version 1');
eq(emptyIntake(NOW).version, INTAKE_VERSION, 'and a fresh document is stamped with it');

eq(READINESS_QUESTIONS.length, 7, 'seven readiness questions');
eq(new Set(READINESS_QUESTIONS.map((q) => q.id)).size, 7, 'and each has its own id');
ok(READINESS_QUESTIONS.every((q) => q.prompt.trim().endsWith('?')), 'every one of them is asked as a question');

/* ── nothing here scores anybody ────────────────────────────────────────── */
//
// The rule that matters most in this file. A readiness questionnaire produces a
// referral, not a grade, and this app is not entitled to a clinical opinion
// about the person answering it.

{
  const i = fullIntake();
  i.readiness.heart = { answer: 'yes', note: 'Told at 40, cleared since' };
  i.readiness.joints = { answer: 'yes' };

  const disclosed = readinessDisclosed(i);
  eq(disclosed.length, 2, 'both yeses come back');
  // In the order ASKED. `heart` happens to be first in the list, so this only
  // proves anything alongside the reversed case below.
  eq(disclosed[0].id, 'heart', 'in the order the questions were asked');
  eq(disclosed[1].id, 'joints', 'and the second is the second');
  eq(disclosed[0].note, 'Told at 40, cleared since', 'with the client’s own words attached');
  eq(disclosed[1].note, null, 'and null, not empty string, where they said nothing');

  // The real test of "not ranked": a cardiac answer given LATER than another
  // one must still come later. A screen that floated it to the top would be
  // ranking these by how dangerous it thought they were.
  const j = fullIntake();
  j.readiness.joints = { answer: 'yes' };
  j.readiness.medication = { answer: 'yes' };
  const order = readinessDisclosed(j).map((d) => d.id);
  eq(order.join(','), 'joints,medication', 'a cardiac-adjacent answer is not floated above a joint one');

  // And no number anywhere claims to summarise them.
  const note = readinessNote(disclosed, readinessUnanswered(i), 'Priya');
  // A grade, a rating, a clearance or a refusal — the four things this app is
  // not entitled to say about somebody's answers. "does not score it" is in the
  // sentence on purpose and is not one of them, so the shapes matched here are
  // verdicts rather than the bare words.
  ok(!/\b(high|low|moderate|elevated|severe)[- ]?risk\b/i.test(note)
     && !/\brisk (score|level|rating|category)\b/i.test(note)
     && !/\b(cleared|not cleared|unfit|fit) to (train|exercise)\b/i.test(note)
     && !/\b\d+\s*(\/|out of)\s*\d+\b/.test(note),
    `the coach's sentence grades nobody — got: ${note}`);
  ok(/does not score it/i.test(note), 'and says outright that nothing scored it');
  ok(note.includes(READINESS_NOT_ADVICE), 'and says plainly what this is and is not');
  ok(note.includes(READINESS_SEE_A_DOCTOR), 'and carries the referral where something was answered yes');
  ok(note.startsWith('Priya answered yes to the following'),
    `two yeses and nothing unanswered opens by saying so — got: ${note}`);
}

// The three openings `readinessNote` can take are three different claims about
// somebody, and each is only true in its own case. Asserted separately because
// a note that opened with the wrong one would still contain every disclaimer
// and still pass everything above it.
{
  const allNo = fullIntake();
  const clean = readinessNote([], readinessUnanswered(allNo), 'Priya');
  ok(clean.startsWith('Priya answered no to every readiness question'),
    `all seven answered no says exactly that — got: ${clean}`);
  ok(!/still unanswered/.test(clean), 'and does not mention unanswered questions when there are none');

  const halfWay = emptyIntake(NOW);
  halfWay.readiness.heart = { answer: 'no' };
  const partial = readinessNote([], readinessUnanswered(halfWay), 'Priya');
  ok(partial.startsWith('Priya answered no to the readiness questions they have answered so far'),
    `one answered no out of seven is hedged, not a clean sheet — got: ${partial}`);

  const oneYes = emptyIntake(NOW);
  oneYes.readiness.joints = { answer: 'yes' };
  const single = readinessNote(readinessDisclosed(oneYes), readinessUnanswered(oneYes), 'Priya');
  ok(single.startsWith('Priya answered yes to the following'),
    `a single yes among unanswered questions still opens with the yes — got: ${single}`);
  ok(/6 of the 7 questions are still unanswered/.test(single),
    'and says how many are outstanding');
  // ONE yes carries the referral. A form that only mentioned seeing a doctor
  // once somebody had said yes twice would be counting answers to decide how
  // seriously to take them, which is the entire thing this module refuses to
  // do — and the single answer it would swallow is the commonest case there is.
  ok(single.includes(READINESS_SEE_A_DOCTOR),
    'a single yes carries the referral, exactly as two do');

  // One question left is still a question left.
  const nearlyDone = fullIntake();
  delete nearlyDone.readiness[READINESS_QUESTIONS[6].id];
  const nearly = readinessNote([], readinessUnanswered(nearlyDone), 'Priya');
  ok(/1 of the 7 questions is still unanswered/.test(nearly),
    `one outstanding question is still reported — got: ${nearly}`);
}

// A yes to the cardiac question and a yes to the joint question produce the
// same SHAPE of output. If one of them ever grows a branch of its own, this
// fails.
{
  const heart = emptyIntake(NOW);
  heart.readiness.heart = { answer: 'yes', note: 'the same note' };
  const joints = emptyIntake(NOW);
  joints.readiness.joints = { answer: 'yes', note: 'the same note' };
  const a = readinessDisclosed(heart)[0];
  const b = readinessDisclosed(joints)[0];
  eq(Object.keys(a).sort().join(','), Object.keys(b).sort().join(','),
    'a cardiac yes is not a different kind of object from a joint yes');
  eq(a.note, b.note, 'and carries the same note the same way');
}

// Nobody is told a client is clear when the questions were never answered.
{
  const half = emptyIntake(NOW);
  half.readiness.heart = { answer: 'no' };
  eq(readinessDisclosed(half).length, 0, 'no yeses is no yeses');
  eq(readinessUnanswered(half).length, 6, 'and the other six are unanswered, not "no"');
  const note = readinessNote([], readinessUnanswered(half), 'Priya');
  ok(note.includes('not a no'), 'the sentence says an unanswered question is not a no');
  ok(!note.includes(READINESS_SEE_A_DOCTOR),
    'and does not issue a referral where nothing was answered yes');
}
eq(readinessUnanswered(null).length, 7, 'with no document at all, all seven are unanswered');
eq(readinessDisclosed(null).length, 0, 'and nothing is disclosed');

/* ── an empty answer is only "nothing" when the read finished ───────────── */
//
// Same rule as ackState in injuryGate.ts, and the same failure if it is missed:
// a coach's screen accusing somebody of not filling in a form, generated by a
// network error.

for (const s of ['loading', 'error', 'partial'] as const) {
  eq(intakeState(s, null), 'unknown', `a ${s} read says nothing about whether they filled it in`);
  eq(intakeState(s, fullIntake()), 'unknown', `and a ${s} read does not confirm a complete one either`);
}
eq(intakeState('ready', null), 'none', 'a finished read of nothing is genuinely nothing');
eq(intakeState('ready', emptyIntake(NOW)), 'started', 'a document with no answers in it is started, not absent');
eq(intakeState('ready', fullIntake()), 'complete', 'and a full one is complete');

// The sentence follows the state, and the unknown one blames nobody.
{
  const p = intakeProgress(null);
  const unknown = intakeLine('unknown', p, 'Priya');
  ok(/could not be read/i.test(unknown), 'the unknown line says the read failed');
  ok(!/has not (filled|started|answered)/i.test(unknown.replace('This is not a statement that they have not.', '')),
    `the unknown line does not accuse them — got: ${unknown}`);
  ok(intakeLine('none', p, 'Priya').includes('Priya'), 'the others are addressed to them by name');
  eq(intakePrompt('unknown', p, 'Priya'), null,
    'and a failed read produces no instruction to chase anybody');
  eq(intakePrompt('complete', intakeProgress(fullIntake()), 'Priya'), null, 'nor does a finished one');
  ok(intakePrompt('none', p, 'Priya') !== null, 'an unstarted intake does prompt');
  ok(intakePrompt('none', p, 'Priya')!.includes('cannot fill it in for them'),
    'and says the coach cannot do it for them');
}

/* ── progress ───────────────────────────────────────────────────────────── */

{
  const empty = intakeProgress(emptyIntake(NOW));
  eq(empty.done, 0, 'an empty document has nothing done');
  eq(empty.of, INTAKE_SECTIONS.length, 'and counts every section');
  ok(!empty.complete, 'and is not complete');
  eq(empty.nextId, INTAKE_SECTIONS[0].id, 'the next thing to do is the first section');

  const full = intakeProgress(fullIntake());
  eq(full.done, full.of, 'a filled document has every section done');
  ok(full.complete, 'and is complete');
  eq(full.nextId, null, 'with nothing left to carry on to');

  eq(intakeProgress(null).done, 0, 'no document is no progress');
  ok(!intakeProgress(null).complete, 'and is never complete');
}

// Each section is genuinely load-bearing: knock one field out and completion
// goes with it. Without this, a `done` predicate that always returned true
// would pass every other assertion in this file.
{
  const cases: { id: string; break_: (i: Intake) => void }[] = [
    { id: 'readiness', break_: (i) => { delete i.readiness[READINESS_QUESTIONS[3].id]; } },
    { id: 'history', break_: (i) => { i.history.years = null; } },
    { id: 'want', break_: (i) => { i.want.headline = '   '; } },
    { id: 'tried', break_: (i) => { i.tried = { worked: '', didnt: '', wont: '' }; } },
    { id: 'availability', break_: (i) => { i.availability.place = null; } },
    { id: 'practical', break_: (i) => { i.practical.work = null; } },
    { id: 'emergency', break_: (i) => { i.emergency.phone = ''; } },
  ];
  eq(cases.length, INTAKE_SECTIONS.length,
    'every section has a case here — a new one added without a case is not covered');
  for (const c of cases) {
    const i = fullIntake();
    c.break_(i);
    const p = intakeProgress(i);
    ok(!p.complete, `breaking ${c.id} makes the intake incomplete`);
    eq(p.done, p.of - 1, `and exactly one section — ${c.id} — goes down with it`);
    eq(p.sections.find((s) => s.id === c.id)?.done, false, `and it is ${c.id} that is marked undone`);
    eq(p.nextId, c.id, `and ${c.id} is what they are sent back to`);
  }
}

// Whitespace is not an answer.
{
  const i = fullIntake();
  i.emergency.name = '   ';
  ok(!intakeProgress(i).complete, 'a name of spaces is not a name');
}

// But a short answer is an answer. "Did they type anything" is the question;
// whether they typed enough is a judgement about the quality of somebody's
// reply. A minimum length here would hold the form open with nothing on screen
// saying why — and the first people it would hold it open on are the ones whose
// name really is one character.
{
  const i = fullIntake();
  i.emergency.name = '李';
  i.want.headline = '5';
  ok(intakeProgress(i).complete, 'a one-character name is a name, and a one-character goal is a goal');
}

// "What you have tried" takes ANY of its three. Somebody whose honest answer is
// only "I will not do burpees again" has told their coach the most useful thing
// on the page, and a section that demanded all three would hold their form open
// forever for the two they have nothing to say about.
{
  for (const field of ['worked', 'didnt', 'wont'] as const) {
    const i = fullIntake();
    i.tried = { worked: '', didnt: '', wont: '' };
    i.tried[field] = 'something';
    ok(intakeProgress(i).complete, `${field} on its own finishes what you have tried`);
  }
}

/* ── reading a document back ────────────────────────────────────────────── */

eq(parseIntake(null), null, 'no column is no document');
eq(parseIntake(undefined), null, 'and neither is undefined');
eq(parseIntake('{}'), null, 'a string is not a document');
eq(parseIntake([1, 2, 3]), null, 'nor is an array');
ok(parseIntake({}) !== null, 'but {} IS a document — somebody who started and saved nothing');
eq(intakeState('ready', parseIntake({})), 'started',
  'and that is "started", never "they have not filled it in"');

{
  // A round trip keeps every answer.
  const before = fullIntake();
  const after = parseIntake(JSON.parse(JSON.stringify(before)))!;
  eq(JSON.stringify(after.readiness), JSON.stringify(before.readiness), 'readiness survives a round trip');
  eq(after.history.doingNow, before.history.doingNow, 'and so does what they are doing now');
  eq(after.want.headline, before.want.headline, 'and what they want');
  eq(after.tried.wont, before.tried.wont, 'and what they will not do again');
  eq(after.availability.daysPerWeek, 3, 'and how many days');
  eq(after.availability.place, 'gym', 'and where');
  eq(after.practical.sleepHours, 6.5, 'and a fractional sleep figure');
  eq(after.emergency.phone, before.emergency.phone, 'and the number to ring');
  eq(intakeProgress(after).complete, true, 'and it is still complete afterwards');
}

{
  // Rubbish in the column does not throw and does not invent answers.
  const junk = parseIntake({
    version: 'one', readiness: 'yes', history: 7, want: null,
    availability: { daysPerWeek: 'three', place: 'moon', times: [1, 'evening'] },
    practical: { work: 'astronaut' }, emergency: [],
  })!;
  ok(junk !== null, 'a malformed document still opens');
  eq(junk.version, INTAKE_VERSION, 'a non-numeric version falls back to this build’s');
  eq(Object.keys(junk.readiness).length, 0, 'a readiness field that is not an object yields no answers');
  eq(junk.availability.daysPerWeek, null, 'a non-numeric day count is null, not 0');
  eq(junk.availability.place, null, 'a place that is not one of ours is null');
  eq(junk.availability.times.join(','), 'evening', 'and non-strings are dropped from the lists');
  eq(junk.practical.work, null, 'as is a work kind nobody offers');
  eq(junk.emergency.name, '', 'and a missing contact is empty, never undefined');
  ok(!intakeProgress(junk).complete, 'and none of that reads as a completed intake');
}

{
  // An answer that is not yes/no is not an answer.
  const i = parseIntake({ readiness: { heart: { answer: 'maybe' }, joints: { answer: 'yes' } } })!;
  eq(Object.keys(i.readiness).join(','), 'joints', 'only yes and no are answers');
  eq(readinessUnanswered(i).length, 6, 'and the rejected one counts as unanswered');
}

{
  // An empty note is no note, so the coach's screen never renders empty quotes.
  const i = parseIntake({ readiness: { heart: { answer: 'yes', note: '   ' } } })!;
  eq(readinessDisclosed(i)[0].note, null, 'a whitespace note is no note');
}

{
  // `typeof null === 'object'`, which is the trap every tolerant parser in this
  // repo has fallen into once. A null where an object was expected must be
  // skipped, not walked into — a parser that throws here takes the whole screen
  // down over one bad field and the client is shown nothing they wrote.
  let threw = false;
  let parsed: ReturnType<typeof parseIntake> = null;
  try { parsed = parseIntake({ readiness: null, history: null, emergency: null }); }
  catch { threw = true; }
  ok(!threw, 'a null readiness block does not throw');
  eq(Object.keys(parsed?.readiness ?? { x: 1 }).length, 0, 'and yields no answers');

  threw = false;
  try { parsed = parseIntake({ readiness: { heart: null, joints: { answer: 'yes' } } }); }
  catch { threw = true; }
  ok(!threw, 'a null answer inside the readiness block does not throw either');
  eq(Object.keys(parsed?.readiness ?? {}).join(','), 'joints', 'and the good answer beside it survives');
}

/* ── the ownership rule ─────────────────────────────────────────────────── */
//
// The app-side statement of `clients_intake_guard` (supabase/parts/127). The
// database is what refuses a coach — with 42501, proved against the live one —
// and this is what stops a screen offering the control in the first place.

{
  eq(intakeOwnership('u1', 'u1').mayEdit, true, 'the person it is about may edit it');
  eq(intakeOwnership('u1', 'u1').reason, null, 'with no reason to give');

  const coach = intakeOwnership('coach', 'u1');
  eq(coach.mayEdit, false, 'their coach may not');
  ok(coach.reason !== null && coach.reason.length > 0, 'and is told why');
  ok(/only they can change it/i.test(coach.reason!), 'in terms that say whose it is');

  // Two unknowns are not a match. This is the shape of every "signed-out user
  // edits everything" bug, and `a === b` alone would pass it.
  eq(intakeOwnership(null, null).mayEdit, false, 'two nulls are not the same person');
  eq(intakeOwnership(null, 'u1').mayEdit, false, 'an unknown viewer may not edit');
  eq(intakeOwnership('u1', null).mayEdit, false, 'nor may anyone edit an unknown subject');
  eq(intakeOwnership('', '').mayEdit, false, 'and two empty strings are not a person either');
  ok(intakeOwnership(null, null).reason !== null, 'and an unknown says so rather than going quiet');

  // An unknown is refused for a DIFFERENT reason from a coach, and the client
  // reads the reason. Somebody whose session had not loaded yet being told
  // their own intake belongs to somebody else is a worse sentence than the
  // true one, and both refuse the edit, so only the wording catches it.
  for (const pair of [[null, 'u1'], ['u1', null], [null, null]] as const) {
    const g = intakeOwnership(pair[0], pair[1]);
    ok(/could not tell whose intake this is/i.test(g.reason ?? ''),
      `an unread id says we do not know whose it is — got: ${g.reason}`);
  }
  ok(!/could not tell whose/i.test(coach.reason!),
    'and a coach is told whose it is, not that we could not tell');

  // Case and whitespace are not the same id. A uuid comparison that had been
  // loosened would let a near-miss through.
  eq(intakeOwnership('U1', 'u1').mayEdit, false, 'ids are compared exactly, not case-insensitively');
  eq(intakeOwnership(' u1', 'u1').mayEdit, false, 'and not after trimming');
}

/* ── what the client is asked ───────────────────────────────────────────── */

{
  const fresh = askIntakeMessage('none', intakeProgress(null));
  ok(fresh.includes('can’t fill it in for you'), 'the ask says the coach cannot do it for them');
  const partial = fullIntake();
  partial.emergency = { name: '', phone: '', relation: '' };
  const p = intakeProgress(partial);
  const nudge = askIntakeMessage('started', p);
  ok(nudge.includes(`${p.done} of ${p.of}`), 'a partly-done one says how far they got');
  ok(!nudge.includes('readiness question'), 'and does not repeat the health questions into a chat thread');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('intake: ok');
