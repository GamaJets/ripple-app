"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Addressing a coach's document to one client. Compile with tsc, run with node.
//
// Three things are guarded, and each of them is a claim somebody would act on.
//
// The first is that a failed read is never reported as an empty roster. A coach
// told "you have no clients to send this to" while twelve people are on their
// roster will go and re-add them.
//
// The second is that a send which did not happen is never reported as one. The
// RPC returns false for "not my document, not my client, retired" and PostgREST
// calls that a success, so `sendFailure` has to look at the RETURN VALUE and not
// only at `error`. This is the same 204 trap parts 129 and 135 both had to write
// functions for.
//
// The third is that the warning before the first send says what the first send
// actually does — it takes the document away from everybody else. Part 156's
// audience clause is `no rows means everybody`, so naming one person is a
// narrowing, and a coach who was not told that has just retracted their studio
// waiver from their whole roster by tapping a name.
const coachDocAudience_1 = require("./coachDocAudience");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const A = '15600000-0000-0000-0000-0000000000a1';
const B = '15600000-0000-0000-0000-0000000000b1';
const C = '15600000-0000-0000-0000-0000000000c1';
const rows = [
    { client_id: A, client_name: 'Zoe Adeyemi', sent_at: '2026-08-30T09:00:00Z', accepted_at: null },
    { client_id: B, client_name: '  ', sent_at: null, accepted_at: null },
    { client_id: C, client_name: 'Ali Rahman', sent_at: null, accepted_at: null },
];
/* ── Shaping ──────────────────────────────────────────────────────────────── */
{
    const m = (0, coachDocAudience_1.shapeAudience)(rows);
    eq(m.length, 3, 'every client on the roster gets a row, sent or not');
    // The panel is opened to send, so the people who have not had it come first.
    eq(m[0].clientId, C, 'a client who has not been sent it sorts above one who has');
    eq(m[1].clientId, B, 'and an unnamed one sorts below a named one, not under an empty string');
    eq(m[2].clientId, A, 'the client it was already sent to is last');
    eq(m[1].name, null, 'a blank name is null, never an empty string a screen would render as a hole');
    eq(m[0].name, 'Ali Rahman', 'a real name survives intact');
}
eq((0, coachDocAudience_1.shapeAudience)(null).length, 0, 'nothing read shapes to nothing');
eq((0, coachDocAudience_1.shapeAudience)([]).length, 0, 'and so does an empty read');
/* ── Open versus addressed ────────────────────────────────────────────────── */
{
    const open = (0, coachDocAudience_1.shapeAudience)(rows.map((r) => ({ ...r, sent_at: null })));
    eq((0, coachDocAudience_1.isAddressed)(open), false, 'no recipient rows means the document is open to the roster');
    eq((0, coachDocAudience_1.sentCount)(open), 0, 'and nobody has been sent it');
    eq((0, coachDocAudience_1.audienceLine)(open), 'Everyone you coach can read this — all 3 of them.', 'an open document says so plainly, because that is what every pre-156 document is');
    const m = (0, coachDocAudience_1.shapeAudience)(rows);
    eq((0, coachDocAudience_1.isAddressed)(m), true, 'one recipient row makes it addressed');
    eq((0, coachDocAudience_1.sentCount)(m), 1, 'and one person has it');
    eq((0, coachDocAudience_1.audienceLine)(m), 'Sent to 1 client. Nobody else can read it.', 'the singular does not say "1 of your 3", which reads as two people being owed it');
    const two = (0, coachDocAudience_1.shapeAudience)(rows.map((r, i) => (i < 2 ? { ...r, sent_at: '2026-08-30T09:00:00Z' } : r)));
    eq((0, coachDocAudience_1.audienceLine)(two), 'Sent to 2 of your 3 clients. Nobody else can read it.', 'past one, the count is worth having beside the roster size');
}
// A null list is a read that did not happen. There is no sentence for it here
// on purpose: the screen draws a failure, and any string returned from this
// function would be a claim about an audience nobody counted.
eq((0, coachDocAudience_1.audienceLine)(null), null, 'an unread audience produces no sentence at all');
eq((0, coachDocAudience_1.audienceLine)([]), null, 'and neither does an empty one — the caller says which of the two it was');
eq((0, coachDocAudience_1.acceptedCount)((0, coachDocAudience_1.shapeAudience)(rows)), 0, 'nobody has accepted this one');
eq((0, coachDocAudience_1.acceptedCount)((0, coachDocAudience_1.shapeAudience)([{ ...rows[0], accepted_at: '2026-08-31T10:00:00Z' }])), 1, 'and an acceptance counts once');
/* ── The warning, which has to describe what actually happens ─────────────── */
ok(/everybody else stops seeing it/i.test((0, coachDocAudience_1.sendWarning)(false)), 'the first send NARROWS an open document, and the coach is told so before the tap, not after it');
ok(/already accepted/i.test((0, coachDocAudience_1.sendWarning)(false)), 'and told the exception, because part 156 keeps an accepted document readable to whoever accepted it');
ok(!/everybody else stops seeing it/i.test((0, coachDocAudience_1.sendWarning)(true)), 'adding a second name takes nothing from the first, and must not claim it does');
ok(/Nobody already on the list loses it/i.test((0, coachDocAudience_1.sendWarning)(true)), 'which is the sentence for that case');
ok(/cannot be un-sent/i.test(coachDocAudience_1.SEND_IS_ONE_WAY), 'there is no DELETE policy on coach_document_recipients, so nothing may offer to un-send');
ok(/retire it/i.test(coachDocAudience_1.SEND_IS_ONE_WAY), 'and the way out is the one part 135 already provides');
/* ── When the picker may not be offered ───────────────────────────────────── */
const three = (0, coachDocAudience_1.shapeAudience)(rows);
eq((0, coachDocAudience_1.sendBlock)({ retired: true, members: three, read: 'ok' }), 'retired', 'a retired document cannot be sent to anybody new — send_coach_document returns false for it');
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: [], read: 'ok' }), 'no-clients', 'a coach with an empty roster is told they have nobody yet');
// The one that matters. An empty list under a failed read is not "you have no
// clients"; it is "we could not ask".
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: [], read: 'failed' }), 'unread', 'a failed read is its own answer and must never be reported as an empty roster');
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: three, read: 'failed' }), 'unread', 'even with stale rows in hand, a failed read is not a roster');
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: null, read: 'ok' }), 'unread', 'and neither is a list that was never populated');
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: three, read: 'ok' }), null, 'otherwise the picker is offered');
ok(/not a statement that you have none/i.test((0, coachDocAudience_1.sendBlockLine)('unread')), 'the failed-read sentence says outright that it is not a claim about the roster');
ok(/no clients to send this to yet/i.test((0, coachDocAudience_1.sendBlockLine)('no-clients')), 'and the empty one is a different sentence');
ok(/retired/i.test((0, coachDocAudience_1.sendBlockLine)('retired')), 'and so is the retired one');
/* ── A send that did not land ─────────────────────────────────────────────── */
// No error and `true` back is the only success. Everything else is a failure
// with its own sentence.
eq((0, coachDocAudience_1.sendFailure)({ error: null, returned: true }), null, 'true and no error is the one success');
eq((0, coachDocAudience_1.sendFailure)({ error: null, returned: false }), 'refused', 'false with no error is a refusal — PostgREST calls that a 200 and a screen reading only `error` says "sent"');
eq((0, coachDocAudience_1.sendFailure)({ error: null, returned: null }), 'refused', 'and so is nothing at all coming back');
eq((0, coachDocAudience_1.sendFailure)({ error: { code: 'PGRST202', message: 'Could not find the function public.send_coach_document' }, returned: null }), 'unavailable', 'a missing function is not a transient failure — part 156 has to be run, and "try again" would be a lie');
eq((0, coachDocAudience_1.sendFailure)({ error: { code: null, message: 'function public.send_coach_document(uuid, uuid) does not exist' }, returned: null }), 'unavailable', 'the same fault reported by Postgres rather than by PostgREST');
eq((0, coachDocAudience_1.sendFailure)({ error: { code: '08006', message: 'network error' }, returned: null }), 'offline', 'anything else is the wire, and that one really can be retried');
ok(/nothing has been put in front of anybody/i.test((0, coachDocAudience_1.sendFailureLine)('refused')), 'a refusal says what did NOT happen, because the coach is about to tell the client it is there');
ok(/not switched on for this server yet/i.test((0, coachDocAudience_1.sendFailureLine)('unavailable')), 'and the unapplied-migration case does not read as a network blip');
ok(/still readable by everyone you coach/i.test((0, coachDocAudience_1.sendFailureLine)('unavailable')), 'and says what IS true meanwhile, so the coach knows the document is not lost');
ok(/Try again in a moment/i.test((0, coachDocAudience_1.sendFailureLine)('offline')), 'only the wire failure invites a retry');
/* ── The line under a name ────────────────────────────────────────────────── */
const day = (iso) => iso.slice(0, 10);
const member = (o) => ({ clientId: A, name: 'Zoe', sentAt: null, acceptedAt: null, ...o });
eq((0, coachDocAudience_1.memberLine)(member({}), day), 'Has not been sent this', 'the ordinary case in an open picker');
eq((0, coachDocAudience_1.memberLine)(member({ sentAt: '2026-08-30T09:00:00Z' }), day), 'Sent 2026-08-30 · not accepted yet', 'sent and outstanding are two facts and the line carries both');
eq((0, coachDocAudience_1.memberLine)(member({ sentAt: '2026-08-30T09:00:00Z', acceptedAt: '2026-08-31T10:00:00Z' }), day), 'Accepted 2026-08-31', 'an acceptance is the end of the story and replaces the line rather than appending to it');
/* ── a read that stopped at the cap is not a smaller audience ───────────── */
//
// It is an unknown one, and the send under it cannot be undone. `isAddressed`
// picks which of the two `sendWarning` sentences a coach reads BEFORE that tap,
// and a recipient row beyond the cap makes it pick the wrong one.
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: three, read: 'truncated' }), 'part-read', 'a truncated audience blocks the picker rather than being offered as the whole one');
eq((0, coachDocAudience_1.sendBlock)({ retired: false, members: [], read: 'truncated' }), 'part-read', 'and is never reported as "you have no clients"');
eq((0, coachDocAudience_1.sendBlock)({ retired: true, members: three, read: 'truncated' }), 'retired', 'retirement still comes first — it is a fact about the document, not about the read');
ok(!/no clients/i.test((0, coachDocAudience_1.sendBlockLine)('part-read')), 'the truncated sentence never says the coach has nobody');
ok(/more clients than this list could bring back/i.test((0, coachDocAudience_1.sendBlockLine)('part-read')), 'it says what actually happened');
ok(/cannot be undone|held/i.test((0, coachDocAudience_1.sendBlockLine)('part-read')), 'and why sending is held rather than offered');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`coachDocAudience: ok (${three.length} in the audience, ${(0, coachDocAudience_1.sentCount)(three)} sent)`);
