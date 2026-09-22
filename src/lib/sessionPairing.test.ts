// Tests for sessionPairing — pairing a heart-rate strap without abandoning the
// workout you are in the middle of.
//
// Two properties carry the item. Nothing here is ever reported as connected
// because a call came back: `connect()` resolves void and sets 'error' on
// failure, so the state AFTER the attempt is the only witness. And a member who
// pairs halfway through is never told their whole session has zones — the first
// half was not measured, and a board that implies otherwise is the same lie as
// a null counted as a zero.
//
// Compile with tsc then run with node, like logic.test.ts.
import {
  pairRows, canPairHere, pairInvite, pairInviteAction, pairOutcome, pairResultNote,
  MID_SESSION_GAP_NOTE, LIVE_KINDS,
  type PairableSource,
} from './sessionPairing';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const apple: PairableSource = { id: 'apple', name: 'Apple Watch', kind: 'healthkit', available: true, unavailableReason: null };
const droid: PairableSource = { id: 'hc', name: 'Health Connect', kind: 'health-connect', available: true, unavailableReason: null };
const whoop: PairableSource = { id: 'whoop', name: 'WHOOP', kind: 'cloud', available: true, unavailableReason: null };
const offApple: PairableSource = { ...apple, available: false, unavailableReason: 'Needs an iPhone with Apple Health.' };

// ── only what can stream a sample into a running session ──
const all = pairRows([apple, whoop, droid], {});
ok(all.length === 2, 'a cloud vendor is not offered — it returns day aggregates and can produce no live zone');
ok(all[0].id === 'apple' && all[1].id === 'hc', 'registry order is kept');
ok(LIVE_KINDS.length === 2, 'the two live kinds are the two the zone panel can read');

// ── an unavailable source is listed, not hidden ──
const withOff = pairRows([offApple], {});
ok(withOff.length === 1, 'a source this build cannot run is still shown');
ok(!withOff[0].actionable && withOff[0].action === 'Unavailable',
   'and it is plainly off, rather than a button that does nothing');
ok(withOff[0].unavailableReason === 'Needs an iPhone with Apple Health.',
   'with the provider’s own reason, so the member is not sent to the settings to find out');

// ── the states a source can be in ──
ok(pairRows([apple], { apple: 'connected' })[0].action === 'Connected', 'a connected source says so');
ok(!pairRows([apple], { apple: 'connected' })[0].actionable, 'and offers nothing to press');
ok(pairRows([apple], { apple: 'connecting' })[0].action === 'Asking…', 'a prompt in flight says so');
ok(!pairRows([apple], { apple: 'connecting' })[0].actionable, 'and cannot be pressed twice');
ok(pairRows([apple], { apple: 'error' })[0].action === 'Try again', 'a refusal is retryable');
ok(pairRows([apple], { apple: 'error' })[0].actionable, 'and the retry is live');
ok(pairRows([apple], { apple: 'nonsense' as unknown as string })[0].state === 'disconnected',
   'an unrecognised state is disconnected, never assumed connected');
ok(pairRows([apple], {})[0].action === 'Connect', 'an unknown source offers the connection');

ok(canPairHere(pairRows([apple], {})), 'a fresh Apple Watch is something to press');
ok(!canPairHere(pairRows([offApple], {})), 'an unavailable one is not');
ok(!canPairHere(pairRows([whoop], {})), 'and neither is a cloud vendor, which is not in the list at all');

// ── the invitation on the panel ──
ok(pairInvite('none', true) !== null, 'with a pairable source and nothing connected, the offer is made');
ok(pairInvite('none', false) === null,
   'with nothing pairable there is no offer — a sheet that says "nothing here can do this" is worse than the settings sentence');
ok(pairInvite('live', true) === null, 'a live reading needs no invitation');
ok(/stay exactly where they are/.test(pairInvite('none', true) ?? ''),
   'the offer promises the session survives, which is the whole reason the link was refused before');
ok(!/Watch & Devices|settings/i.test(pairInvite('none', true) ?? ''),
   'and it does not send the member to the settings, because that is the trip being avoided');

// The 'connected-silent' case is the one watchReach.ts exists for: a screen that
// tells somebody with a connected watch to connect a watch.
ok(!/pair one here/.test(pairInvite('connected-silent', true) ?? ''),
   'a member who HAS paired is never told to pair');
ok(/allowed to read/.test(pairInvite('connected-silent', true) ?? ''),
   'they are pointed at the permission instead, which is the half that fails silently');
ok(pairInviteAction('none') === 'Pair a monitor' && pairInviteAction('connected-silent') === 'Check my monitor',
   'the button matches the sentence beside it');
ok(pairInvite('stale', true) === pairInvite('connected-silent', true),
   'a stale reading is a paired device too, and gets the same offer');

// ── the outcome is read off the state, never off the call returning ──
ok(pairOutcome('connected') === 'connected', 'connected is connected');
ok(pairOutcome('error') === 'refused', 'an error state is a refusal, however quietly connect() resolved');
ok(pairOutcome('disconnected') === 'refused', 'so is still-disconnected');
ok(pairOutcome(undefined) === 'refused',
   'and so is a provider the map never heard of — the default is NOT success');
ok(pairOutcome('connecting') === 'pending', 'a prompt still open is neither');

// ── what the member is told ──
ok(/ON THE WATCH/.test(pairResultNote('connected', false)),
   'connecting without a reading asks for the one thing that actually streams samples');
ok(!/zones are building/.test(pairResultNote('connected', false)),
   'and does not promise zones that may never arrive');
ok(/reading is coming through/.test(pairResultNote('connected', true)), 'a real sample is reported as one');
ok(/not counted|not in them|before this/.test(pairResultNote('connected', true)),
   'and the minutes before the pairing are excluded out loud');
ok(/session is untouched/.test(pairResultNote('refused', false)),
   'a refusal reassures about the session, because that is what the member risked by opening the sheet');
ok(/carry on/.test(pairResultNote('refused', false)), 'and leaves them in the workout');
ok(/permission prompt/.test(pairResultNote('pending', false)), 'a pending attempt says what it is waiting for');

ok(/missing rather than empty/.test(MID_SESSION_GAP_NOTE),
   'an unmeasured stretch is absent, not zero — the house rule, on a zone board');

declare const process: { exit(code: number): void };
console.log(errors.length ? 'SESSIONPAIRING FAILURES:\n' + errors.join('\n') : 'ALL SESSIONPAIRING TESTS PASSED');
if (errors.length) process.exit(1);
