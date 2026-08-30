// The two guards that decide whether a device's body measurement is put in
// front of a client at all.
//
// Both exist because of a shape this codebase keeps re-encountering: an absent
// figure arriving as a present one. WHOOP returns weight_kilogram as null when
// the client has never entered it, and the scan form will accept a 0 somebody
// tapped in from a prompt that said "WHOOP has you at 0 kg" — and the newest
// scan re-tunes the meal plan. A zero is not a light client. It is a missing
// answer wearing a number's clothes.
import { bodyFigure, hasBodyFigure, type BodyRead } from './vendorBody';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// ── bodyFigure: only a positive, finite number survives ────────────────────
{
  ok(bodyFigure(78.4) === 78.4, 'a real weight passes through');
  ok(bodyFigure('78.4') === 78.4, 'a numeric string is read, since JSON field types vary');
  const absent: unknown[] = [null, undefined, 0, '0', -1, NaN, Infinity, -Infinity, '', ' ', 'abc', {}, []];
  for (const v of absent) {
    ok(bodyFigure(v) === null, `${String(v)} is absent, not a measurement`);
  }
}

// ── hasBodyFigure: a status AND a figure ───────────────────────────────────
const read = (over: Partial<BodyRead>): BodyRead => ({
  provider: 'whoop' as BodyRead['provider'],
  providerName: 'WHOOP',
  status: 'ready',
  weightKg: null, heightM: null, maxHeartRate: null,
  ...over,
});
{
  ok(hasBodyFigure(read({ weightKg: 78.4 })), 'a measured weight is offerable');
  ok(hasBodyFigure(read({ heightM: 1.83 })), 'so is a height on its own');
  // The assertion that names the bug: a successful read holding nothing is a
  // real answer, and must not produce an offer with no number in it.
  ok(!hasBodyFigure(read({})), 'a ready read with three nulls is NOT offerable');
  // The statuses stay apart. An errored read is not offered even carrying a
  // figure, because we do not know that figure is current.
  ok(!hasBodyFigure(read({ status: 'error', weightKg: 78.4, reason: 'x' })),
    'an errored read is not offered even carrying a figure');
  ok(!hasBodyFigure(read({ status: 'unsupported', weightKg: 78.4 })),
    'nor an unsupported one');
}

if (errors.length) {
  console.error(`vendorBody.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('vendorBody.test.ts — ok');
