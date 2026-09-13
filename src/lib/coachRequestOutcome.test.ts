// A request to be coached, read back by the person who made it. Compile with
// tsc, run with node.
//
// Four things are asserted here and each of them is a defect this feature has
// already caused, or would cause the first time somebody wrote the obvious
// version:
//
//   · a DECLINED request that says nothing about who or when. That is what the
//     app did before this module — the row was never read at all — and the
//     cost is somebody reading a months-old answer as this morning's, or
//     asking the same coach again.
//   · an unrecognised status read as 'accepted'. A member told they have a
//     coach on the strength of a string is the one wrong answer here that
//     cannot be walked back by refreshing.
//   · a sentence whose subject is a name that could not be read. The coach may
//     be unnameable for an ordinary reason — they left the directory — and
//     scripts/check-prose.mjs exists because a screen shipped that lost the
//     first word of its sentence exactly this way.
//   · "you have not asked anybody" printed over a read that failed. The empty
//     list and the refused read are the same `[]` and must never be the same
//     sentence: see src/ui/loadStatus.ts.
import {
  COACH_REQUEST_LABEL, coachRequestAnswerLine, coachRequestLine, coachRequestSourceNote,
  coachRequestWaitingNote, coachRequestsUnreadNote, myCoachRequestsNewestFirst,
  openCoachRequests, shapeMyCoachRequests, type MyCoachRequest,
} from './coachRequestOutcome';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const req = (p: Partial<MyCoachRequest> = {}): MyCoachRequest => ({
  id: 'r1', trainerId: 'coach-1', mode: 'online', status: 'pending',
  note: null, source: 'directory',
  createdAt: '2026-09-01T10:00:00.000Z', respondedAt: null,
  ...p,
});

/* ── 1. shaping a row nobody can vouch for ────────────────────────────────*/

{
  const rows = shapeMyCoachRequests([
    { id: 'a', trainer_id: 'c1', status: 'declined', mode: 'inperson', source: 'code', created_at: '2026-09-01T10:00:00.000Z', responded_at: '2026-09-02T09:00:00.000Z' },
    // No coach on it. Dropped: a row that cannot say who it went to has no
    // sentence and no button.
    { id: 'b', status: 'pending' },
    // No id. Same.
    { trainer_id: 'c2', status: 'pending' },
  ]);
  eq(rows.length, 1, 'a request with no coach and one with no id are both dropped');
  eq(rows[0].status, 'declined', 'the status is read');
  eq(rows[0].source, 'code', 'the source is read — supabase/parts/56 added it and nothing ever read it');
  eq(rows[0].respondedAt, '2026-09-02T09:00:00.000Z', 'the answer stamp is read');

  // THE ONE THAT MATTERS. A status this build has never heard of must not be
  // read as an acceptance.
  const odd = shapeMyCoachRequests([{ id: 'x', trainer_id: 'c1', status: 'approved' }]);
  eq(odd[0].status, 'pending', 'an unrecognised status falls back to the one that claims nothing');
  ok(odd[0].status !== 'accepted', 'and never to accepted');

  // Absent is absent. A row from a database without part 56 has no source, and
  // null must survive as null rather than settling on 'directory'.
  const old = shapeMyCoachRequests([{ id: 'y', trainer_id: 'c1', status: 'pending' }]);
  eq(old[0].source, null, 'no source column is no source, not a guessed one');
  eq(shapeMyCoachRequests(null).length, 0, 'a null read is no rows, and does not throw');
}

/* ── 2. the order somebody reads their own history in ─────────────────────*/

{
  const sorted = myCoachRequestsNewestFirst([
    req({ id: 'old', createdAt: '2026-08-01T10:00:00.000Z' }),
    req({ id: 'new', createdAt: '2026-09-01T10:00:00.000Z' }),
  ]);
  eq(sorted[0].id, 'new', 'newest question first');

  // A tie is broken on the id rather than left to the sort's own stability,
  // because two requests made in the same second are a real thing and a list
  // that reorders itself between renders looks like a list that is changing.
  const tied = myCoachRequestsNewestFirst([
    req({ id: 'aaa', createdAt: '2026-09-01T10:00:00.000Z' }),
    req({ id: 'bbb', createdAt: '2026-09-01T10:00:00.000Z' }),
  ]);
  eq(tied[0].id, 'bbb', 'a same-second tie is broken, and broken the same way every time');
}

/* ── 3. the four sentences, and the name that is not there ────────────────*/

{
  const declined = coachRequestLine(req({ status: 'declined' }), 'Dayne Foster');
  ok(declined.startsWith('Dayne Foster said no'), 'the coach is named where they can be named');
  ok(!/reason|because|not taking/i.test(declined),
    'and no reason is invented — coach_requests has no decline note, so there is none to report');

  const nameless = coachRequestLine(req({ status: 'declined' }), null);
  ok(nameless.startsWith('The coach you asked'),
    'an unreadable name becomes a description that is true whatever it was');
  ok(!nameless.includes('—') && !nameless.includes('null') && !nameless.includes('undefined'),
    'never a dash and never a printed absence at the head of a sentence');

  // Four statuses, four different sentences. Collapsing any two of them is the
  // whole defect: "we have your request" reads identically over a yes and a no.
  const said = new Set([
    coachRequestLine(req({ status: 'pending' }), 'Dayne'),
    coachRequestLine(req({ status: 'accepted' }), 'Dayne'),
    coachRequestLine(req({ status: 'declined' }), 'Dayne'),
    coachRequestLine(req({ status: 'withdrawn' }), 'Dayne'),
  ]);
  eq(said.size, 4, 'four statuses, four sentences');

  // The pending one is the only one somebody acts on while it is still true,
  // so it has to refuse the arrangement outright.
  const pending = coachRequestLine(req({ status: 'pending' }), 'Dayne');
  ok(/not answered yet/.test(pending) && /Nothing is arranged/.test(pending),
    'a request nobody has answered says so, and says nothing is arranged');

  eq(coachRequestLine(req({ status: 'withdrawn' }), null).includes('The coach you asked'), false,
    'the one sentence with no coach in it does not need a subject it cannot fill');
}

/* ── 4. who refused it, and when ──────────────────────────────────────────*/

{
  const line = coachRequestAnswerLine(req({ status: 'declined' }), 'Dayne Foster', '3 September');
  eq(line, 'Declined by Dayne Foster on 3 September.', 'a refusal names who and when');

  eq(coachRequestAnswerLine(req({ status: 'accepted' }), 'Dayne Foster', '3 September'),
    'Accepted by Dayne Foster on 3 September.', 'and so does an acceptance');

  // The stamp is nullable and rows answered before it was written carry none.
  // Said out loud: a date quietly dropped leaves somebody reading an answer
  // from March as one that arrived this morning.
  eq(coachRequestAnswerLine(req({ status: 'declined' }), 'Dayne Foster', null),
    'Declined by Dayne Foster. The record does not say when.',
    'a missing stamp is stated, never hidden and never guessed at');

  eq(coachRequestAnswerLine(req({ status: 'declined' }), null, '3 September'),
    'Declined by the coach you asked on 3 September.',
    'an unreadable name still leaves a sentence that reads');

  eq(coachRequestAnswerLine(req({ status: 'pending' }), 'Dayne', null), null,
    'nothing has been answered, so nothing is said about who answered it');
  eq(coachRequestAnswerLine(req({ status: 'withdrawn' }), 'Dayne', '3 September'), null,
    'a request the member took back is not something the coach did');
}

/* ── 5. how they reached this coach ───────────────────────────────────────*/

{
  eq(coachRequestSourceNote('code'), 'You asked them with their coaching code.', 'the code path');
  eq(coachRequestSourceNote('directory'), 'You found them in the directory.', 'the directory path');
  eq(coachRequestSourceNote(null), null,
    'a row that predates the column says nothing, rather than claiming the commoner of the two');
}

/* ── 6. the list, when the list is not the whole list ─────────────────────*/

{
  eq(coachRequestsUnreadNote('ready'), null, 'a landed read needs no caveat');

  const failed = coachRequestsUnreadNote('error');
  ok(!!failed && /couldn’t read/.test(failed), 'a failed read says it failed');
  ok(!!failed && /not us saying you have none/.test(failed),
    'and refuses the empty claim outright — this is the screen a waiting member reads');

  const short = coachRequestsUnreadNote('partial');
  ok(!!short && /most recent/.test(short), 'a truncated read says the set is a prefix');

  // Three different situations, three different sentences. One shared "we
  // could not check" would tell somebody mid-read that something had failed.
  const notes = new Set([
    coachRequestsUnreadNote('loading'), coachRequestsUnreadNote('partial'), coachRequestsUnreadNote('error'),
  ]);
  eq(notes.size, 3, 'loading, partial and error are not one sentence');
}

/* ── 7. the count, which is only ever drawn over a whole read ─────────────*/

{
  const list = [req({ id: '1', status: 'pending' }), req({ id: '2', status: 'declined' }), req({ id: '3', status: 'pending' })];
  eq(openCoachRequests(list).length, 2, 'only the ones still with a coach are outstanding');
  eq(coachRequestWaitingNote(0), null, '"0 coaches have not answered" is not a sentence');
  eq(coachRequestWaitingNote(1), '1 coach has not answered you yet.', 'singular');
  eq(coachRequestWaitingNote(2), '2 coaches have not answered you yet.', 'plural');
}

/* ── 8. the labels beside them ────────────────────────────────────────────*/

{
  const labels = Object.values(COACH_REQUEST_LABEL);
  eq(new Set(labels).size, 4, 'four statuses, four labels');
  ok(!labels.some((l) => /reject/i.test(l)),
    'a coach declined a request; they did not pass judgement on the person who made it');
  // Title Case, like every other label in this app — see scripts/check-caps.mjs.
  ok(labels.every((l) => /^[A-Z]/.test(l)), 'each opens in capitals');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH REQUEST OUTCOME FAILURES:\n' + errors.join('\n') : 'coachRequestOutcome: ok — a refusal names who and when, an unknown status is never an acceptance, and a failed read never says you asked nobody');
if (errors.length) process.exit(1);
