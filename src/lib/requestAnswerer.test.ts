// Who answered a session request. Compile with tsc, run with node.
//
// The column this module reads has been written by three different code paths
// since part 740 and read by nobody, so every assertion here is about a
// sentence the app has never yet printed. Three of them are attributions, and
// an attribution is the kind of thing that is worse wrong than absent:
//
//   · a refusal attributed to the member's CURRENT coach when an earlier one
//     made it. `clients.trainer_id` moves; the request does not.
//   · a refusal attributed to a coach when the column is null. Null is a row
//     from before the column, or an account since deleted — neither of which
//     is "your coach said this".
//   · "Declined by your coach" over a request the member withdrew themselves,
//     which reverses who did what.
import { answeredByLine, answererOf } from './requestAnswerer';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'client-1';
const COACH = 'coach-1';

/* ── 1. reading the column against the ids the row already carries ────────*/

{
  eq(answererOf({ clientId: ME, trainerId: COACH, answeredBy: COACH }), 'coach', 'the coach it was addressed to');
  eq(answererOf({ clientId: ME, trainerId: COACH, answeredBy: ME }), 'you',
    'withdraw_session_request is client-only, so the member is the one case we can be certain of');
  eq(answererOf({ clientId: ME, trainerId: COACH, answeredBy: 'coach-0' }), 'someone-else',
    'a coach the member has since left still answered what they answered');
  eq(answererOf({ clientId: ME, trainerId: COACH, answeredBy: null }), 'unrecorded',
    'null is not the coach — it is a row from before the column, or an account deleted since');
}

/* ── 2. the sentence, and the four states it will not write ───────────────*/

{
  eq(answeredByLine('declined', 'coach', 'Dayne Foster', '3 September'),
    'Declined by Dayne Foster on 3 September.', 'a refusal names who and when');
  eq(answeredByLine('accepted', 'coach', 'Dayne Foster', '3 September'),
    'Accepted by Dayne Foster on 3 September.', 'and so does an acceptance');
  eq(answeredByLine('withdrawn', 'you', 'Dayne Foster', '3 September'),
    'Taken back by you on 3 September.', 'the member took this one back, and the sentence says so');

  // The name is missing far more often than it is present on this side: no
  // profiles policy runs client → coach for most accounts.
  const noName = answeredByLine('declined', 'coach', null, '3 September');
  eq(noName, 'Declined by your coach on 3 September.', 'an unreadable name falls back to a description');
  ok(!!noName && !noName.includes('—') && !noName.includes('null'),
    'and never to a dash or a printed absence');

  // No date either. Still worth saying who.
  eq(answeredByLine('declined', 'coach', 'Dayne Foster', null), 'Declined by Dayne Foster.',
    'a missing stamp costs the date and not the attribution');

  const stranger = answeredByLine('declined', 'someone-else', 'Dayne Foster', '3 September');
  ok(!!stranger && !stranger.includes('Dayne Foster'),
    'the coach they have NOW is never named over an answer an earlier coach gave');

  eq(answeredByLine('declined', 'unrecorded', 'Dayne Foster', '3 September'),
    'Answered on 3 September. The record does not say by whom.',
    'a null column is stated as unknown, not filled in from the trainer id');
  eq(answeredByLine('declined', 'unrecorded', 'Dayne Foster', null), null,
    'neither a name nor a date is nothing worth printing');

  // Nobody answered these, so nobody is named for them. 'expired' in
  // particular was settled by the clock, and naming a person for it would be
  // an accusation.
  eq(answeredByLine('asked', 'coach', 'Dayne Foster', '3 September'), null, 'a live question has no answerer');
  eq(answeredByLine('expired', 'coach', 'Dayne Foster', '3 September'), null, 'the clock is not a person');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'REQUEST ANSWERER FAILURES:\n' + errors.join('\n') : 'requestAnswerer: ok — a refusal names who and when, and never names the wrong coach');
if (errors.length) process.exit(1);
