// Which notifications a coach is told about. Compile with tsc, run with node.
//
// The rule that carries the weight here is the one the settings screen would
// otherwise get wrong: AN UNREAD PREFERENCE IS NOT "OPTED IN".
//
// The muted set is empty under 'loading' and under 'error', and an empty muted
// set means "everything on". A screen that only read the set would draw five
// switches in the on position over a read that never happened — the app stating
// five facts about somebody's settings that it has not looked up, on the screen
// they came to in order to control them, and a coach who then taps one has just
// saved the guess. `channelState` is where that is prevented and it takes the
// status first for that reason.
//
// The mirror rule is on the send side: no row is not an answer. The product
// default is on, and the edge function's filter and this switch have to agree —
// a screen showing "on" while the server suppressed the push would be the
// master switch's original bug pointing the other way.
import {
  COACH_CHANNELS, channelDef, mutedFromRows, channelState, channelAllows,
  channelsNote, CHANNEL_MASTER_NOTE, CHANNEL_STILL_RECORDED, CHANNEL_QUIET_COST,
  CHANNEL_ACCOUNT_WIDE, CHANNEL_UNKNOWN_LABEL,
  type CoachChannel,
} from './coachNotify';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the catalogue ─────────────────────────────────────────────────────── */

eq(COACH_CHANNELS.length, 5, 'five channels');
const keys = COACH_CHANNELS.map((c) => c.key);
eq(new Set(keys).size, 5, 'each named once');
for (const k of ['chat', 'bookings', 'money', 'clients', 'admin'] as CoachChannel[]) {
  ok(keys.includes(k), `${k} is one of them`);
  ok(channelDef(k) != null, `and has a definition`);
}
eq(channelDef('nonsense'), null, 'a channel this build has never heard of has no definition');

// Exactly one channel carries the quiet cost, so the warning means something
// when it appears. Five identical warnings is a wall nobody reads.
eq(COACH_CHANNELS.filter((c) => c.quietCost).length, 1, 'one channel is the one that hurts quietly');
eq(COACH_CHANNELS.find((c) => c.quietCost)?.key, 'money',
  'and it is money — a missed chat message is visible next time they open the app, a declined card is not');

/* ── the stored rows ───────────────────────────────────────────────────── */

eq(mutedFromRows(null).size, 0, 'nothing read is nothing muted, as a SET — the status is what says whether that is known');
eq(mutedFromRows([]).size, 0, 'and an empty answer is nobody muted');
eq(mutedFromRows([{ channel: 'chat', enabled: false }]).size, 1, 'an explicit false is a mute');
eq(mutedFromRows([{ channel: 'chat', enabled: true }]).size, 0, 'an explicit true is not');

// Only a real boolean false counts. A string, a null or a number is damage, not
// somebody's answer about their own notifications, and reading one as a mute
// would silence a category they never touched.
for (const bad of ['false', 0, null, undefined, {}]) {
  eq(mutedFromRows([{ channel: 'chat', enabled: bad }]).size, 0, `${JSON.stringify(bad)} is damage rather than an answer`);
}
// A channel a NEWER build wrote and this one does not know is dropped rather
// than kept, so it cannot mute anything here by accident.
eq(mutedFromRows([{ channel: 'something_new', enabled: false }]).size, 0,
  'a channel this build does not recognise mutes nothing');

/* ── THE ONE THAT MATTERS: unread is not on ────────────────────────────── */

const none = mutedFromRows([]);
eq(channelState('chat', none, 'ready'), 'on', 'a whole read with no mute is genuinely on');
eq(channelState('chat', mutedFromRows([{ channel: 'chat', enabled: false }]), 'ready'), 'off', 'and a mute is off');

for (const s of ['loading', 'error', 'partial'] as const) {
  eq(channelState('chat', none, s), 'unknown',
    `under '${s}' the switch shows neither position — an empty muted set is not five facts about somebody's settings`);
}
// Including the case that looks safe: a channel that IS muted, read short.
eq(channelState('chat', mutedFromRows([{ channel: 'chat', enabled: false }]), 'partial'), 'unknown',
  'a partial read is unknown even for a channel that happened to arrive — the one that did not is the one being misreported');

ok(channelsNote('ready') === null, 'nothing is explained when the switches are showing real answers');
for (const s of ['loading', 'error', 'partial'] as const) {
  ok(channelsNote(s) != null, `under '${s}' the reason is on screen`);
}
ok(/saving over|save over/i.test(channelsNote('error') as string),
  'and the failed-read note warns that changing one now would write over what is stored');
ok(!/all on|everything is on/i.test(channelsNote('error') as string),
  'and never says everything is on');
ok(CHANNEL_UNKNOWN_LABEL.length > 0, 'the unknown position has a word for itself');

/* ── the send-side default, which must agree with the switch ───────────── */

eq(channelAllows('money', none), true, 'a channel nobody has answered is sent — the product default is on');
eq(channelAllows('money', mutedFromRows([{ channel: 'money', enabled: false }])), false, 'and a muted one is not');
// The two halves agree: `channelState` shows on for an unanswered channel under
// a whole read, and `channelAllows` sends it. A screen showing on while the
// server suppressed would be the master switch's bug pointing the other way.
for (const c of COACH_CHANNELS) {
  eq(channelState(c.key, none, 'ready') === 'on', channelAllows(c.key, none),
    `${c.key}: what the switch shows and what the server does agree for an unanswered channel`);
}

/* ── the sentences ─────────────────────────────────────────────────────── */

ok(/Push Notifications/i.test(CHANNEL_MASTER_NOTE),
  'the coach is told the master switch outranks these, because the relationship is not guessable');
ok(/notifications list|still written/i.test(CHANNEL_STILL_RECORDED),
  'and that muting stops the buzz and not the record, which is what makes it safe to offer for money at all');
ok(/paying/i.test(CHANNEL_QUIET_COST), 'the money warning names the consequence rather than reassuring');
ok(!/personalis|personaliz|may miss/i.test(CHANNEL_QUIET_COST), 'and does not soften it');
ok(/account/i.test(CHANNEL_ACCOUNT_WIDE) && /phone|handset/i.test(CHANNEL_ACCOUNT_WIDE),
  'and the per-account / per-handset difference is stated, because it is discovered by accident otherwise');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`coachNotify: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('coachNotify: ok (an unread preference shows as unread, not as on, and the switch and the server agree)');
