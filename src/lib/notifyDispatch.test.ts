// Which switch a written notification answers to. Compile with tsc, run with node.
//
// The assertion this file exists for is the third block down: EVERY SERVER-
// WRITTEN KIND HAS A CHANNEL. `SERVER_WRITTEN` in src/lib/notifyInbox.ts is the
// hand-maintained catalogue of every row a trigger, a nightly pass or an edge
// function writes, and until part 900 not one of them reached a phone. The
// dispatcher refuses to push a row it cannot classify — deliberately, because
// supabase/functions/send-push does not filter a channelless send at all and an
// unmutable push would make all six switches liars — so an unclassified kind is
// a kind that stays silent. This test is the thing that makes that visible: add
// a trigger, add a line to the catalogue, and if its route is not in the table
// the build fails here rather than a coach quietly never hearing about it.
//
// The mirror rule is the one that matters on the other side: a row already
// pushed by whoever wrote it must not be pushed again. Chat is the whole of
// that set, and doubling every message in the product is the failure mode.
import {
  channelForRoute, channelForTitle, notificationChannel, dispatchDecision,
  PUSHED_BY_ITS_WRITER,
} from './notifyDispatch';
import { SERVER_WRITTEN } from './notifyInbox';
import { COACH_CHANNELS, channelDef, type CoachChannel } from './coachNotify';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the mapping only ever names a switch that exists ──────────────────── */
//
// A channel string this build does not know is worse than none: send-push
// filters on an exact match against `notify_channel_prefs`, so a typo produces
// a channel nobody can ever have a row for — a push that looks filtered and is
// not, on a switch that does not appear on the settings screen.

const KNOWN = new Set<string>(COACH_CHANNELS.map((c) => c.key));

const ROUTES_TRIED = [
  '/(client)/messages', '/(trainer)/chat',
  '/(trainer)/calendar', '/(client)/calendar', '/(client)/bookings',
  '/(client)/pt-sessions', '/(client)/classes', '/(client)/request-session',
  '/(trainer)/payments', '/(client)/packages', '/(client)/explore', '/(client)/offers',
  '/(trainer)/dashboard', '/(trainer)/leads', '/(trainer)/client-goals',
  '/(trainer)/client-training', '/(trainer)/client-photos',
  '/(client)/my-coach', '/(client)/trainers',
  '/(trainer)/documents', '/(trainer)/client-intake', '/(trainer)/credentials',
  '/(client)/intake',
  '/(trainer)/invoices', '/(trainer)/nudges', '/(trainer)/builder',
];
for (const r of ROUTES_TRIED) {
  const c = channelForRoute(r);
  ok(c != null, `${r} is classified`);
  ok(c != null && KNOWN.has(c), `${r} names a channel this build has a switch for`);
  ok(c != null && channelDef(c) != null, `${r}'s channel has a definition`);
}

/* ── the two channels that had no sender ───────────────────────────────── */
//
// The whole point. Before part 900 nothing in the codebase passed 'money' or
// 'admin' to sendPushChecked, so a coach could mute two switches that had never
// sent anything. These two assertions fail the moment somebody deletes the
// mapping that gave them a sender.

eq(channelForRoute('/(trainer)/payments'), 'money',
  'a subscription failing, a package bought and a pack running out are money');
eq(channelForRoute('/(trainer)/documents'), 'admin',
  'a document a client accepted is paperwork');
eq(channelForRoute('/(trainer)/client-intake'), 'admin', 'and so is an intake coming back');

/* ── every server-written kind has a channel ───────────────────────────── */
//
// THE assertion. See the header.

const byChannel = new Map<string, number>();
for (const s of SERVER_WRITTEN) {
  const c = notificationChannel(s.route, s.title);
  ok(c != null,
    `${s.where} writes '${s.title}' and nothing says which switch governs it — `
    + `a row with no channel is never pushed, so this kind is as silent as it was before part 900`);
  if (c) byChannel.set(c, (byChannel.get(c) ?? 0) + 1);
}

// And they are spread across the switches rather than piled onto one. If this
// ever reads 1 for money or admin, the mapping has collapsed back towards the
// defect it was written for.
ok((byChannel.get('money') ?? 0) >= 5,
  'the money switch governs the several money kinds parts 158–612 write, not one of them');
ok((byChannel.get('admin') ?? 0) >= 3, 'and paperwork governs more than one kind too');
ok((byChannel.get('clients') ?? 0) >= 3, 'and so does joining, leaving and what a client did');
ok((byChannel.get('book') ?? 0) >= 2,
  'the coach\'s own book is written by a nightly pass as well as computed on the handset');

/* ── the three that carry no route ─────────────────────────────────────── */
//
// Matched on the title, and the titles are the literals in parts 146 and 159. A
// reword there without one here loses the classification and the notification
// goes back to being silent — which is why the block above checks these
// through `SERVER_WRITTEN` rather than trusting the table on its own.

eq(channelForTitle('An invoice from your gym'), 'money', 'the gym invoice has no screen and is still money');
eq(channelForTitle('Your coaching has ended'), 'clients', 'a coaching ending is joining and leaving');
eq(channelForTitle('A client has signed the release'), 'admin', 'and a signed release is paperwork');
eq(channelForTitle('A client has signed the'), null, 'matched whole, not as a prefix');
eq(channelForTitle('a client has signed the release'), null, 'and not case-insensitively — these are literals from SQL');
eq(channelForTitle('  Your coaching has ended  '), 'clients', 'though surrounding space is not a difference');

/* ── whole-route matching, as inboxIcon does it ────────────────────────── */
//
// Not prefix matching. Somebody who believed it was prefix matching would
// "fix" a wrong channel by reordering the table, and nothing would change.

eq(channelForRoute('/(trainer)/client-goals?clientId=abc'), 'clients',
  'a query string is part of the route and not part of the match');
eq(channelForRoute('/(trainer)/client-goals-archive'), null,
  'a longer route that happens to start with a known one is a different screen');
eq(channelForRoute('/(trainer)/payments/history'), null, 'and so is a child of one');
eq(channelForRoute('/(trainer)/nowhere'), null, 'a route this build does not know names no switch');
eq(channelForRoute(null), null, 'and neither does no route');
eq(channelForRoute(''), null, 'nor an empty one');
eq(channelForRoute('   '), null, 'nor whitespace');

/* ── route first, then title ───────────────────────────────────────────── */

eq(notificationChannel('/(trainer)/payments', 'A client has signed the release'), 'money',
  'the route is the structural signal and it wins');
eq(notificationChannel(null, 'A client has signed the release'), 'admin',
  'the title is only reached when there is no route');
eq(notificationChannel('/(trainer)/nowhere', 'An invoice from your gym'), 'money',
  'and also when there is a route nobody has classified — a classification beats none');
eq(notificationChannel(null, null), null, 'nothing to go on is nothing decided');

/* ── what the dispatcher will not send ─────────────────────────────────── */

// 1. A row whose writer already pushed it. Chat, and doubling every message in
//    the product is what this prevents.
for (const r of PUSHED_BY_ITS_WRITER) {
  const d = dispatchDecision(r, 'anything', false);
  eq(d.dispatch, false, `${r} is pushed by notify-message and must not be pushed again`);
  eq(d.channel, 'chat', 'and it is still classified — the switch and the sender are different questions');
}
eq(dispatchDecision('/(trainer)/chat?clientId=abc', 'Sam', false).dispatch, false,
  'the coach\'s thread carries a clientId and is still the chat that is already pushed');

// 2. A row written through notify_users(). Its callers are handsets that either
//    send their own push or decided not to, and both are answers.
const viaCaller = dispatchDecision('/(trainer)/payments', 'A package was bought', true);
eq(viaCaller.dispatch, false, 'a handset-written row is not pushed a second time by the server');
eq(viaCaller.channel, 'money', 'though it is still classified');
ok(/notify_users/.test(viaCaller.why), 'and the reason says which writer it was');

// 3. A row nobody has classified. NOT sent, which is the one place this
//    codebase does not err towards the notification — see the module header.
const unknown = dispatchDecision('/(trainer)/nowhere', 'Something new', false);
eq(unknown.dispatch, false, 'an unclassified row is not pushed');
eq(unknown.channel, null, 'and says so rather than naming a channel it guessed');
ok(/filter/.test(unknown.why),
  'and the reason names the consequence: send-push does not filter a channelless send at all');

/* ── and what it will ──────────────────────────────────────────────────── */

for (const s of SERVER_WRITTEN) {
  const bare = (s.route ?? '').split('?')[0];
  const isChat = PUSHED_BY_ITS_WRITER.includes(bare);
  const d = dispatchDecision(s.route, s.title, false);
  eq(d.dispatch, !isChat,
    `${s.where} · '${s.title}' — ${isChat ? 'chat is already pushed' : 'nothing else pushes this and it must be dispatched'}`);
  if (d.dispatch) {
    ok(d.channel != null && KNOWN.has(d.channel as CoachChannel),
      `${s.title} is sent on a switch the coach actually has`);
  }
}

// A dispatched row ALWAYS carries a channel. This is the invariant send-push
// depends on: it drops muted recipients only when one is passed, so a dispatch
// with a null channel would be a push no preference can stop.
for (const route of ROUTES_TRIED) {
  const d = dispatchDecision(route, '', false);
  if (d.dispatch) ok(d.channel != null, `${route} is never dispatched without a channel`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('notifyDispatch: ok');
