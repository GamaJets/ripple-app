"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Who may make somebody else's phone buzz. Compile with tsc, run with node.
//
// The assertion this file exists for is the second block: THE PROJECT'S OWN
// SERVER IS A LEGITIMATE SENDER. A check that only asks "is this a person"
// answers 401 to supabase/parts/900's dispatcher, and a 401 there switches off
// every server-side notification in the product without a single error anywhere
// — the rows go on being written, so nothing looks broken.
const pushSender_1 = require("./pushSender");
const notifyInbox_1 = require("./notifyInbox");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// Stand-ins. The shapes matter, not the values: a service role key is a JWT
// with `{"role":"service_role"}` and no `sub`, which is exactly why
// `auth.getUser()` resolves no user for it.
const SERVICE = 'eyJhbGciOiJIUzI1NiJ9.service-role-no-sub.sig';
const ANON = 'eyJhbGciOiJIUzI1NiJ9.anon-also-no-sub.sig';
const UID = '00000000-0000-0000-0000-000000000001';
/* ── a person ──────────────────────────────────────────────────────────── */
const person = (0, pushSender_1.pushSender)('a-users-access-token', SERVICE, UID);
eq(person.allowed, true, 'a signed-in Repple user may send');
eq(person.senderId, UID, 'and is named by their own id');
eq(person.kind, 'person', 'and recorded as a person');
/* ── the server, which is not a person and is not nobody ───────────────── */
//
// THE assertion. supabase/parts/900 posts here with the Vault secret
// `storage_service_key`, whose claims are {"role":"service_role"} with no
// `sub`. `auth.getUser()` therefore resolves NO USER for it — the same answer
// it gives for the anon key, which is the case the sender check was written
// for. Refusing it is refusing the whole of part 900.
const server = (0, pushSender_1.pushSender)(SERVICE, SERVICE, null);
eq(server.allowed, true, 'the project’s own dispatcher may send');
eq(server.kind, 'server', 'and is recognised as the server, not as a person');
eq(server.senderId, 'server', 'and is named "server" — inventing a uuid would put a person on a send no person made');
// What refusing it would have cost, counted rather than asserted. Every one of
// these kinds reaches a phone only through part 900's dispatcher.
const serverKinds = notifyInbox_1.SERVER_WRITTEN.filter((s) => !/notify-message/.test(s.where)).length;
ok(serverKinds >= 20, `refusing the server would silence ${serverKinds} kinds of notification, and nothing would report it`);
/* ── and nobody ────────────────────────────────────────────────────────── */
//
// The anon key is public by design and inlined into the app bundle, so it is
// the token a stranger actually holds. `verify_jwt` accepts it — it was signed
// by this project — and it resolves to no user, which is the whole reason the
// check exists.
const anon = (0, pushSender_1.pushSender)(ANON, SERVICE, null);
eq(anon.allowed, false, 'the anon key out of the app bundle may not send');
eq(anon.kind, 'nobody', 'and is nobody');
eq(anon.senderId, '', 'with no sender to log');
eq((0, pushSender_1.pushSender)('', SERVICE, null).allowed, false, 'no bearer is not a sender');
eq((0, pushSender_1.pushSender)(null, SERVICE, null).allowed, false, 'and neither is a missing one');
eq((0, pushSender_1.pushSender)('   ', SERVICE, null).allowed, false, 'nor whitespace');
/* ── the service key is compared, never guessed ────────────────────────── */
//
// Against the value THIS FUNCTION holds in its own environment. A claim decoded
// out of the token would be the caller's assertion about itself, and a bearer
// saying `role: service_role` is a string anybody can write.
eq((0, pushSender_1.pushSender)(SERVICE, '', null).allowed, false, 'with no service key configured, a service-role token is just a token');
eq((0, pushSender_1.pushSender)('', '', null).kind, 'nobody', 'and a missing environment variable never turns an empty header into the server');
eq((0, pushSender_1.pushSender)(SERVICE, ANON, null).allowed, false, 'a bearer that is not this project’s service key is not the server, whatever it claims');
eq((0, pushSender_1.pushSender)(SERVICE.slice(0, -1), SERVICE, null).allowed, false, 'and the comparison is the whole string');
// A person's own token never becomes the server by accident, and the service
// key never becomes a person: the service branch short-circuits, so `getUser`
// is not even consulted for it.
eq((0, pushSender_1.pushSender)(SERVICE, SERVICE, UID).kind, 'server', 'the service key is the server even if a user id was somehow resolved for it');
/* ── the fan-out log ───────────────────────────────────────────────────── */
//
// A record, not a limit: the legitimate fan-outs are real. The RECIPIENTS are
// never logged — a log is not a place to write down who was told what.
eq((0, pushSender_1.logFanout)(pushSender_1.PUSH_FANOUT_LOG_AT + 1), true, 'a broadcast past the threshold is logged');
eq((0, pushSender_1.logFanout)(pushSender_1.PUSH_FANOUT_LOG_AT), false, 'the threshold itself is not past it');
eq((0, pushSender_1.logFanout)(1), false, 'and one recipient is a message, not a broadcast');
eq((0, pushSender_1.logFanout)(Number.NaN), false, 'a count that is not a number is not a broadcast');
ok(/Sign in/.test(pushSender_1.PUSH_SENDER_REFUSED), 'the refusal says what to do — the only person who sees it has an expired session');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`pushSender: ok — the server is a sender, and refusing it would have silenced ${serverKinds} kinds`);
