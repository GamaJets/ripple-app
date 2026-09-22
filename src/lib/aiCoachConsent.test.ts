// The AI Coach health consent on the account. Compile with tsc, run with node.
//
// Three things are guarded, and each is a way a consent migration loses or
// invents a record.
//
//   · somebody who has answered is never asked again;
//   · an answer already on the account is never overwritten by a handset, in
//     EITHER direction — the case that matters is an account 'no' and a stale
//     handset 'yes', which an "any yes wins" merge would silently re-consent;
//   · a carried-up answer is never given today's date, because the handset
//     never recorded one and today is the day of the migration.
import {
  CARRIED_UP_ANSWERED_AT, CONSENT_CARRIED_UP_NOTE, CONSENT_FOLLOWS_ACCOUNT_NOTE,
  consentFromAccountRow, resolveConsent,
} from './aiCoachConsent';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── reading the row back ─────────────────────────────────────────────────── */

eq(consentFromAccountRow({ shareHealth: true, answeredAt: null, recordedAt: '2026-09-13T10:00:00Z' }), 'yes',
  'a row saying true is a yes');
eq(consentFromAccountRow({ shareHealth: false, answeredAt: null, recordedAt: '2026-09-13T10:00:00Z' }), 'no',
  'and one saying false is a no — which is an ANSWER, not an absence');
eq(consentFromAccountRow(null), 'unasked', 'no row is a question still to put');
eq(consentFromAccountRow({ shareHealth: 'true' }), 'unasked',
  'a row we cannot read as one of the two answers is not somebody’s decision about their medical data');
eq(consentFromAccountRow([{ shareHealth: true }]), 'unasked', 'and neither is an array');

/* ── the account is the record ────────────────────────────────────────────── */

{
  const r = resolveConsent('no', 'yes');
  eq(r.consent, 'no', 'an account NO beats a handset YES — this is somebody who withdrew on another device');
  eq(r.carryUp, false, 'and nothing is written back over it');
}
{
  const r = resolveConsent('yes', 'no');
  eq(r.consent, 'yes', 'and an account YES beats a stale handset NO, for the same reason in the other direction');
  eq(r.carryUp, false, 'still nothing written');
}

/* ── nobody who answered is asked again ───────────────────────────────────── */

{
  const r = resolveConsent('unasked', 'yes');
  eq(r.consent, 'yes', 'a handset answer with nothing on the account IS the answer — this is the reinstall case');
  eq(r.carryUp, true, 'and it is carried up so the next device inherits it');
}
{
  const r = resolveConsent('unasked', 'no');
  eq(r.consent, 'no', 'a decline carries up exactly as an agreement does');
  eq(r.carryUp, true, 'because a "no" is a record too, and losing it re-asks somebody who said no');
}
{
  const r = resolveConsent('unasked', 'unasked');
  eq(r.consent, 'unasked', 'nothing anywhere is a question still to put');
  eq(r.carryUp, false, 'and there is nothing to carry');
}

/* ── a failed account read writes nothing ─────────────────────────────────── */

{
  const r = resolveConsent('unknown', 'yes');
  eq(r.consent, 'yes', 'the handset’s own answer still stands for the session');
  eq(r.carryUp, false,
    'but nothing is written: we do not know what the account holds, and a guess could overwrite a withdrawal');
}
{
  const r = resolveConsent('unknown', 'no');
  eq(r.consent, 'no', 'a decline is honoured under a failed read — nothing starts sending because a read timed out');
  eq(r.carryUp, false, 'and is still not written up');
}
{
  const r = resolveConsent('unknown', 'unknown');
  eq(r.consent, 'unknown',
    'nothing known anywhere is UNKNOWN, not "unasked" — putting the question now is the re-ask this change removes');
  eq(r.carryUp, false, 'and nothing is written on it');
}
{
  const r = resolveConsent('unknown', 'unasked');
  eq(r.consent, 'unknown', 'a handset with no answer and an account we could not read is still unknown');
  eq(r.carryUp, false, 'and writes nothing');
}

/* ── a carried-up answer is not re-dated ──────────────────────────────────── */

eq(CARRIED_UP_ANSWERED_AT, null,
  'the day a carried-up consent was given is NOT today — the handset never recorded one, and today is the migration');

/* ── what the member is told ──────────────────────────────────────────────── */

ok(/asked once/.test(CONSENT_FOLLOWS_ACCOUNT_NOTE),
  'the note says the answer follows the account, because the old note promised the opposite');
ok(/changing it here changes it everywhere/.test(CONSENT_FOLLOWS_ACCOUNT_NOTE),
  'and that a change is not device-local either, which is the other half of moving it');
ok(!/today/.test(CONSENT_CARRIED_UP_NOTE.replace('given today', '')),
  'and the carried-over note does not claim the answer was given today');
ok(/do not know the day/.test(CONSENT_CARRIED_UP_NOTE),
  'it says the date is unknown, in those words, rather than leaving a stamp to be read as one');

if (errors.length) {
  console.error(`aiCoachConsent: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('aiCoachConsent: ok');
