// Tests for pushConsent — the answer that has to be known BEFORE a push token
// is registered against somebody's account.
//
// The defect: src/ui/auth.tsx called registerForPush() on every sign-in without
// reading the preference, so a member who had turned Push Notifications off got
// the OS permission prompt anyway and got a live row in `push_tokens` anyway.
// The gate is only worth anything if it is right about three things, and each
// of them is a different way of getting it wrong:
//
//   · a stored `false` is an ANSWER and must be honoured. This is the member
//     the bug was about.
//   · a blob with no answer in it is a FRESH INSTALL, and the product default
//     is on. Reading "absent" as "no" would silently switch push off for
//     everybody who has never opened Settings, while the switch on that screen
//     goes on showing them On — the original bug pointing the other way.
//   · a blob we cannot read is not an answer either, and it is indistinguishable
//     from a fresh install, so it resolves the same way src/ui/settings.tsx
//     resolves it: to the default. The two must not disagree.
//
// 'unknown' is deliberately not testable here. It is a fact about time — the
// window before the AsyncStorage read lands — not a fact about the blob, and
// consentFromStored is only ever called on a read that completed.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import { consentFromStored, pushConsent, recordPushConsent } from './pushConsent';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ── a stored answer is honoured, in both directions ───────────────────────
eq(consentFromStored('{"notifPush":false}'), 'no',
  'A STORED false IS THE WHOLE POINT — this is the member who turned the switch off and was registered anyway');
eq(consentFromStored('{"notifPush":true}'), 'yes',
  'a stored true is an answer too, and it is yes');
eq(consentFromStored('{"notifPush":false,"weightUnit":"lb","lengthUnit":"in"}'), 'no',
  'the answer survives the rest of the settings blob being present around it');

// ── no answer in the blob means the product default, which is ON ──────────
//
// DEFAULTS.notifPush is true in src/ui/settings.tsx, and that screen renders
// the switch from the same default. A version that read absence as "no" would
// leave every member who has never opened Settings looking at a switch that
// says On while nothing was ever registered.
eq(consentFromStored(null), 'yes',
  'nothing has ever been stored — a fresh install, whose answer is the default');
eq(consentFromStored(undefined), 'yes',
  'AsyncStorage handing back undefined is the same absence as null');
eq(consentFromStored('{"weightUnit":"kg"}'), 'yes',
  'A BLOB THAT PREDATES THE KEY IS NOT A NO — absent is the default, not a refusal');
eq(consentFromStored('{}'), 'yes',
  'an empty object carries no answer, so the default stands');

// ── damage is not an answer either ────────────────────────────────────────
eq(consentFromStored('not json at all'), 'yes',
  'an unparseable blob must not throw and must not invent a refusal');
eq(consentFromStored('null'), 'yes',
  'valid JSON that is null has no notifPush to read');
eq(consentFromStored('[]'), 'yes',
  'an array has no notifPush either, and reading one off it must not crash');
eq(consentFromStored('"off"'), 'yes',
  'a bare string is corruption, not a preference');
eq(consentFromStored('{"notifPush":"false"}'), 'yes',
  'the STRING "false" is damage, not somebody choosing no — settings.tsx accepts only booleans, and accepting more here would let the switch and the token store disagree');
eq(consentFromStored('{"notifPush":0}'), 'yes',
  'nor is 0 an answer; only a real boolean is');

// ── the latch starts unknown, which is the state that stops the prompt ────
eq(pushConsent(), 'unknown',
  'AT MODULE LOAD NOBODY HAS READ ANYTHING — if this started at yes, a sign-in that beat the AsyncStorage read would ask the OS for permission on behalf of somebody who said no');
recordPushConsent('no');
eq(pushConsent(), 'no', 'a recorded answer is what the latch reports');
recordPushConsent('yes');
eq(pushConsent(), 'yes', 'and it can be changed by the member tapping the switch back on');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('pushConsent tests passed');
