// What a member may be told about the invitation their gym sent them.
// Compile with tsc, run with node.
//
// The assertions that matter are about the states that look identical in the
// row: a plan nobody attached against a plan we were not allowed to read, an
// invitation with no deadline against one that has run out, and a gym whose
// name this account cannot yet read against one it can. Every one of those has
// been shipped as the wrong sentence somewhere in this codebase before.
import {
  gymInviteCard, gymInviteCards, invitePlanLine, inviteWindowLine,
  acceptedMessage, acceptFailedMessage, LAPSED_NOTE, ACCEPT_NOTE,
} from './gymInvite';
import type { MemberInvite } from './memberInvites';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-01T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const invite = (o: Partial<MemberInvite> = {}): MemberInvite => ({
  id: 'i1', tenantId: 't1', email: 'jane@example.com', fullName: 'Jane Okafor',
  planId: null, planName: null, invitedBy: null, token: null,
  status: 'pending', createdAt: iso(NOW - 2 * DAY), expiresAt: iso(NOW + 10 * DAY),
  acceptedAt: null, acceptedBy: null, ...o,
});

const named = { byTenant: new Map([['t1', 'Iron Yard']]) };

/* ── the gym's name ────────────────────────────────────────────────────── */

ok(gymInviteCard(invite(), named, NOW).title.includes('Iron Yard'),
  'a gym whose name was read is named');

const anon = gymInviteCard(invite(), undefined, NOW);
ok(!anon.title.includes('undefined') && !anon.title.includes('null'),
  'and a gym whose name could not be read leaves no hole in the title');
ok(/gym/i.test(anon.title), 'it is described instead — never invented, never blank');

ok(!gymInviteCard(invite(), { byTenant: new Map([['t1', '   ']]) }, NOW).title.includes('  '),
  'a whitespace name is not a name');
ok(!gymInviteCard(invite(), { byTenant: new Map([['t2', 'Other Gym']]) }, NOW).title.includes('Other Gym'),
  'and a name read for a DIFFERENT tenant is never borrowed for this one');

/* ── the plan, which has three states and not two ──────────────────────── */

ok(invitePlanLine({ planId: 'p1', planName: 'Off-Peak' })!.includes('Off-Peak'),
  'a plan we read is named');
const unreadable = invitePlanLine({ planId: 'p1', planName: null })!;
ok(/could not be read/.test(unreadable),
  'a plan attached but unreadable says so — it is not reported as no plan');
ok(!/no plan/i.test(unreadable), 'and specifically does not say there is none');
ok(/no plan/i.test(invitePlanLine({ planId: null, planName: null })!),
  'and a gym that attached none says that instead');

/* ── the deadline, which is never invented ─────────────────────────────── */

eq(inviteWindowLine({ expiresAt: null }, NOW), null,
  'no expiry recorded gets no deadline sentence at all');
eq(inviteWindowLine({ expiresAt: 'not a date' }, NOW), null,
  'and neither does one nothing could parse');
ok(inviteWindowLine({ expiresAt: iso(NOW + 10 * DAY) }, NOW)!.includes('10 days'),
  'a real window is counted in whole days');
const almost = inviteWindowLine({ expiresAt: iso(NOW + 9 * 3_600_000) }, NOW)!;
ok(!/1 days/.test(almost), 'and nine hours left is never printed as "1 days"');
ok(/tomorrow/.test(almost), 'it is the day it runs out, in words');
eq(inviteWindowLine({ expiresAt: iso(NOW - DAY) }, NOW), null,
  'something already lapsed has no window left to advertise');

/* ── what the button is allowed to be ──────────────────────────────────── */

const open = gymInviteCard(invite(), named, NOW);
ok(open.canAccept, 'a pending, in-date invitation can be accepted');
ok(!open.lapsed, 'and is not described as lapsed');
ok(open.note.includes(ACCEPT_NOTE), 'the card says what accepting does before it offers the button');

const lapsed = gymInviteCard(invite({ expiresAt: iso(NOW - DAY) }), named, NOW);
ok(!lapsed.canAccept, 'a lapsed invitation cannot be accepted — the SQL would refuse it too');
ok(lapsed.lapsed && lapsed.note.includes(LAPSED_NOTE),
  'and it says so rather than showing a button that fails');
ok(!lapsed.note.includes(ACCEPT_NOTE), 'a lapsed card does not also promise what accepting does');

const noExpiry = gymInviteCard(invite({ expiresAt: null }), named, NOW);
ok(noExpiry.canAccept, 'an invitation with no expiry recorded is open, not lapsed');
ok(!/stays open/.test(noExpiry.note), 'and carries no window sentence');

const taken = gymInviteCard(invite({ status: 'accepted' }), named, NOW);
ok(!taken.canAccept && !taken.lapsed,
  'one that moved under us offers no button and is not called lapsed either');

/* ── the order they are shown in ───────────────────────────────────────── */

const cards = gymInviteCards(
  [invite({ id: 'dead', expiresAt: iso(NOW - DAY) }), invite({ id: 'live' })],
  named, NOW,
);
eq(cards.length, 2, 'a lapsed invitation is still shown — the member was emailed about it');
eq(cards[0].id, 'live', 'and the one with a decision in it comes first');

/* ── after the write ───────────────────────────────────────────────────── */

ok(acceptedMessage('Iron Yard').includes('Iron Yard'), 'the confirmation names the gym when it can');
const anonOk = acceptedMessage(null);
ok(/your gym/.test(anonOk) && !/null/.test(anonOk),
  'and describes it when it cannot, rather than leaving a gap');

// One sentence per `raise exception` in accept_member_invite. The function
// separates these deliberately; the app must not put them back together.
ok(/passed its date/.test(acceptFailedMessage('invite has expired')),
  'an expired accept says which failure it was');
ok(/already accepted/.test(acceptFailedMessage('invite already accepted')),
  'and an invitation already used is not reported as a lapse');
ok(/withdrew/.test(acceptFailedMessage('invite was withdrawn')),
  'a withdrawn invitation says the gym withdrew it, not that it expired');
ok(/different email address/.test(acceptFailedMessage('invite not addressed to you')),
  'the address mismatch names the actual problem, since it is the one the member can fix');
ok(/owns a gym/.test(acceptFailedMessage('an owner cannot join a gym as a member from this account')),
  'an owner is told why their account was refused');
ok(/coaches at another gym/.test(acceptFailedMessage('a trainer cannot be moved to another gym by a member invite')),
  'and so is a coach');
const eight = new Set([
  acceptFailedMessage('not signed in'), acceptFailedMessage('invite not found'),
  acceptFailedMessage('invite not addressed to you'), acceptFailedMessage('invite already accepted'),
  acceptFailedMessage('invite was withdrawn'), acceptFailedMessage('invite has expired'),
  acceptFailedMessage('an owner cannot join a gym as a member from this account'),
  acceptFailedMessage('a trainer cannot be moved to another gym by a member invite'),
]);
eq(eight.size, 8, 'and no two of the server’s refusals collapse into the same sentence');
for (const m of eight) ok(/nothing was accepted|nothing changed/i.test(m),
  'every refusal states that nothing was written');
ok(acceptFailedMessage(null).startsWith('Nothing was accepted'),
  'and an unrecognised failure opens by saying nothing was accepted');
ok(/still waiting|try again/.test(acceptFailedMessage(null)),
  'it tells the member the invitation survives, because it does');
ok(!/permission denied|PGRST|42501/i.test(acceptFailedMessage('permission denied for table memberships')),
  'raw Postgres never reaches the member');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('gymInvite.test.ts — all assertions passed');
