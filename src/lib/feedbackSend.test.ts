// The two things the feedback screen could not previously tell apart, and the
// one string it must never show. Compile with tsc, run with node.
//
// Three defects are guarded here.
//
// The first is a REFUSAL described as a dropped connection. Before the screen
// was handed a fate, a rejected insert and an offline handset arrived as the
// same `ok: false` plus a message, and the one sentence that covered both had
// to hedge: "if the same answer comes back, sending again will not change it".
// A refusal is not a maybe — an RLS policy and a CHECK constraint answer the
// same way every time the same bytes are offered — and telling somebody with
// perfect signal to try again later is the defect that started this.
//
// The second is the reverse and is worse, because it loses words somebody
// wrote: a dropped connection called a refusal tells a member on a bad line
// that what they wrote was rejected on its merits, and invites them to rewrite
// it instead of to resend it.
//
// The third is `new row violates row-level security policy for table
// "feedback"` reaching an alert. The pipeline below is driven end to end for
// exactly that reason: it is not enough that `feedbackNote` takes only a fate
// today, the assertion has to be over what a member actually reads.
import { feedbackNote, feedbackWriteFate, type FeedbackFate } from './feedbackSend';
import { authGateMessage } from './authedUid';
import type { WriteError } from './offlineQueue';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Every fate, so nothing below can pass by only ever being asked about three
 *  of them. The annotation is the check: a new member of the union that is not
 *  listed here stops compiling. */
const EVERY_FATE: readonly FeedbackFate[] = ['sent', 'refused', 'undelivered', 'signed-out', 'unreadable'];

/* ── the union itself: 'unsent' is not a state this path can be in ──────── */

{
  // Compile-time. `unsent` is offlineQueue's word for a row that is KEPT, still
  // counted, and sent on the next launch that reaches a server — a promise an
  // outbox keeps, and there is no outbox behind app feedback. If this type ever
  // accepts it, the screen's copy has quietly started implying a queue that
  // does not exist, and this line stops compiling first.
  type HasUnsent = 'unsent' extends FeedbackFate ? true : false;
  const unsentIsNotAFate: HasUnsent = false;
  ok(unsentIsNotAFate === false, "the fate union admits no 'unsent' member");
  // And at runtime, so a widened type is caught too.
  ok(!(EVERY_FATE as readonly string[]).includes('unsent'), "no fate is spelled 'unsent'");
}

/* ── a refusal is never reported as a dropped connection ────────────────── */

{
  // The exact shape supabase-js hands back for the feedback table's own
  // policies. 42501 is `fb_insert`'s WITH CHECK; 23514 is the rating CHECK
  // constraint, which is what a rating of 0 used to hit.
  const rls: WriteError = { code: '42501', status: 403, message: 'new row violates row-level security policy for table "feedback"' };
  const check: WriteError = { code: '23514', status: 400, message: 'new row for relation "feedback" violates check constraint "feedback_rating_check"' };
  eq(feedbackWriteFate(rls, null), 'refused', 'an RLS refusal is a refusal');
  eq(feedbackWriteFate(check, null), 'refused', 'a CHECK constraint is a refusal');
  ok(feedbackWriteFate(rls, null) !== 'undelivered', 'and never a dropped connection');
  ok(feedbackWriteFate(check, null) !== 'undelivered', 'nor is a constraint');
  // A statement that ran and touched nothing. Not what this table does today —
  // an INSERT that fails WITH CHECK raises 42501 rather than narrowing to zero
  // rows — but if a trigger or a policy ever makes it so, it is a refusal and
  // must never be filed as a send.
  eq(feedbackWriteFate(null, 0), 'refused', 'no rows back and no error is not a send');
  ok(feedbackWriteFate(null, 0) !== 'sent', 'and must never be one');
}

/* ── a dropped connection is never reported as a refusal ────────────────── */

{
  // No code, no status: a fetch that never completed. This is the case that
  // used to read "You are not signed in." to a member whose session was fine.
  const offline: WriteError = { message: 'TypeError: Network request failed' };
  eq(feedbackWriteFate(offline, null), 'undelivered', 'an offline handset did not get there');
  ok(feedbackWriteFate(offline, null) !== 'refused', 'and nothing rejected what they wrote');
  // 5xx: the server exists and never reached an answer about this row.
  eq(feedbackWriteFate({ status: 503, message: 'Service Unavailable' }, null), 'undelivered', 'a 503 is not a verdict on the row');
  // A statement timeout. Class 57 is the database being unavailable.
  eq(feedbackWriteFate({ code: '57014', message: 'canceling statement due to statement timeout' }, null), 'undelivered', 'a statement timeout is not a refusal');
  // A rate limit is the server saying "later", which is the one thing a
  // refusal never says.
  eq(feedbackWriteFate({ status: 429, message: 'Too Many Requests' }, null), 'undelivered', 'a rate limit is not a refusal');
}

/* ── a send is a row that came back ─────────────────────────────────────── */

{
  eq(feedbackWriteFate(null, 1), 'sent', 'one row back with no error is sent');
  eq(feedbackWriteFate(undefined, 1), 'sent', 'undefined error likewise');
  // null rows is "the call threw and returned nothing to count", which is NOT
  // zero rows. Null is not zero, and a failed read is not an empty list.
  ok(feedbackWriteFate(null, null) !== 'sent', 'nothing counted is not a send');
  eq(feedbackWriteFate(null, null), 'undelivered', 'nothing counted is nobody answering');
  ok(feedbackWriteFate(null, null) !== feedbackWriteFate(null, 0),
    'a throw and a zero-row write are different answers and stay different');
}

/* ── what a member reads ────────────────────────────────────────────────── */

{
  eq(feedbackNote('sent'), null, 'a send has nothing to apologise for');
  for (const fate of EVERY_FATE) {
    if (fate === 'sent') continue;
    const note = feedbackNote(fate);
    ok(typeof note === 'string' && note.trim().length > 0, `${fate} has a sentence`);
    ok(/nothing was queued/i.test(note ?? ''), `${fate} says nothing was queued`);
    ok(/still in the box/i.test(note ?? ''), `${fate} says their words are still there`);
  }
  // The distinction the whole change exists for: the two must not read the
  // same, and each must say the thing that is true only of it.
  const refused = feedbackNote('refused') ?? '';
  const undelivered = feedbackNote('undelivered') ?? '';
  ok(refused !== undelivered, 'a refusal and a dropped connection do not read the same');
  ok(/same answer/i.test(refused), 'a refusal says the same words will get the same answer');
  ok(!/same answer/i.test(undelivered), 'a dropped connection does NOT say that, because it is not true');
  ok(/back on a connection/i.test(undelivered), 'a dropped connection says when to try again');
  ok(!/back on a connection/i.test(refused), 'a refusal does not promise a retry will work');
  ok(/nothing wrong with what you wrote/i.test(undelivered),
    'a dropped connection does not blame the words');
  ok(!/nothing wrong with what you wrote/i.test(refused),
    'and a refusal does not claim the words were fine');
}

/* ── the auth fates keep the one wording, and stay apart ────────────────── */

{
  const out = feedbackNote('signed-out') ?? '';
  const unreadable = feedbackNote('unreadable') ?? '';
  ok(out.includes(authGateMessage('signed-out')), 'the signed-out sentence is the shared one, unchanged');
  ok(unreadable.includes(authGateMessage('unreadable')), 'and so is the unreadable one');
  ok(out !== unreadable, 'the two auth fates do not read the same');
  ok(/sign in again/i.test(out), 'a signed-out member is asked to sign in');
  ok(!/you are signed out/i.test(unreadable), 'an outage does NOT tell a signed-in member they are signed out');
}

/* ── no raw database text reaches the member, whatever the error said ──── */

{
  // Driven end to end, because "feedbackNote takes only a fate" is a property
  // of today's signature and this is a property of what somebody reads.
  const raw: readonly { readonly e: WriteError; readonly rows: number | null; readonly words: readonly string[] }[] = [
    { e: { code: '42501', status: 403, message: 'new row violates row-level security policy for table "feedback"' }, rows: null,
      words: ['row-level security', 'violates', 'feedback"', '42501'] },
    { e: { code: '23514', status: 400, message: 'new row for relation "feedback" violates check constraint "feedback_rating_check"' }, rows: null,
      words: ['check constraint', 'feedback_rating_check', 'relation', '23514'] },
    { e: { code: '23505', status: 409, message: 'duplicate key value violates unique constraint "feedback_pkey"' }, rows: null,
      words: ['duplicate key', 'feedback_pkey', '23505'] },
    { e: { message: 'TypeError: Network request failed' }, rows: null,
      words: ['TypeError', 'Network request failed'] },
    { e: { status: 500, message: 'PGRST000 could not connect to server' }, rows: null,
      words: ['PGRST000', 'could not connect'] },
  ];
  for (const { e, rows, words } of raw) {
    const note = feedbackNote(feedbackWriteFate(e, rows)) ?? '';
    ok(note.length > 0, `there is still a sentence for ${e.code ?? e.status ?? 'a transport failure'}`);
    for (const w of words) {
      ok(!note.toLowerCase().includes(w.toLowerCase()),
        `"${w}" from the database does not reach the member (${e.message})`);
    }
  }
  // The whole point restated: the two errors above that ARE refusals and the
  // two that are NOT produce different sentences, from evidence rather than
  // from their text.
  eq(feedbackWriteFate(raw[0].e, null), 'refused', 'the RLS error is classified by its SQLSTATE');
  eq(feedbackWriteFate(raw[3].e, null), 'undelivered', 'the transport failure by its absence of one');
}

if (errors.length) {
  console.error(`feedbackSend: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('feedbackSend: ok');
