// The summary above a coach's credentials. Compile with tsc, run with node.
//
// Two things are guarded here.
//
// The first is that a reassurance can never be produced from a read that is not
// the whole set. "Nothing has lapsed" is the sentence that puts somebody on a
// gym floor without cover, and a prefix of a list cannot support it. A partial
// read may raise an alarm and may never settle one.
//
// The second is that null in means UNKNOWN out. A failed read is not a coach
// with nothing listed, and a screen that renders the second over the first tells
// a coach their insurance is not on their profile when it is.
import { expirySummary, expirySummaryLine, expirySummaryNeedsMark } from './credentialExpiry';
import { EXPIRING_SOON_DAYS, type Credential } from './coachCredentials';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-13';

let seq = 0;
function cred(over: Partial<Credential> = {}): Credential {
  seq += 1;
  return {
    id: `c${seq}`,
    kind: 'certification',
    title: `Qualification ${seq}`,
    issuer: null,
    reference: null,
    issuedOn: null,
    expiresOn: null,
    verification: 'self_declared',
    ...over,
  };
}

/* ── null is not empty ────────────────────────────────────────────────────── */

eq(expirySummary(null, TODAY, true).kind, 'unknown',
  'a read that produced no list is UNKNOWN, never a coach who has listed nothing');
eq(expirySummaryLine({ kind: 'unknown' }), null,
  'and unknown says nothing at all — the screen already carries a notice for it');
eq(expirySummary([], TODAY, true).kind, 'nothing-listed',
  'an empty list under a whole read really is empty');
eq(expirySummaryLine({ kind: 'nothing-listed' }), null,
  'and that case has its own paragraph on the screen, so this adds no second one');

/* ── the expiries themselves ──────────────────────────────────────────────── */

{
  const s = expirySummary([
    cred({ expiresOn: '2027-06-01' }),
    cred({ expiresOn: null }),
  ], TODAY, true);
  eq(s.kind, 'all-in-date', 'a date well ahead and a lifetime qualification are both fine');
  ok(s.kind === 'all-in-date' && s.undated === 1, 'and the undated one is counted as undated');
  const line = expirySummaryLine(s);
  ok(typeof line === 'string' && line.includes('Nothing has lapsed'), 'which is the sentence the coach reads');
  ok(typeof line === 'string' && line.includes('no expiry date'), 'and the lifetime one is named rather than silently included');
  eq(expirySummaryNeedsMark(s), false, 'nothing in date needs no mark beside it');
}

{
  // Yesterday. A bare YYYY-MM-DD either side, judged by credentialState.
  const s = expirySummary([cred({ expiresOn: '2026-09-12' })], TODAY, true);
  ok(s.kind === 'attention' && s.expired === 1 && s.expiring === 0, 'a date before today has expired');
  eq(expirySummaryNeedsMark(s), true, 'and that is marked');
}

{
  // Today is not yet expired — `credentialState` puts d === 0 in 'expiring'.
  const s = expirySummary([cred({ expiresOn: TODAY })], TODAY, true);
  ok(s.kind === 'attention' && s.expired === 0 && s.expiring === 1,
    'one that runs out today has not expired yet, and is not counted as though it had');
  const line = expirySummaryLine(s);
  ok(typeof line === 'string' && line.includes('runs out today'), 'and the coach is told it is today');
}

{
  const s = expirySummary([
    cred({ kind: 'insurance', expiresOn: '2026-03-01' }),
    cred({ expiresOn: '2026-10-01' }),
    cred({ expiresOn: '2030-01-01' }),
  ], TODAY, true);
  ok(s.kind === 'attention' && s.expired === 1 && s.expiring === 1, 'one lapsed, one falling due, one fine');
  ok(s.kind === 'attention' && s.insuranceExpired, 'and the lapsed one being a policy is carried separately');
  const line = expirySummaryLine(s);
  ok(typeof line === 'string' && line.includes('insurance cover on your profile'),
    'because it is the one a gym turns somebody away over, and it is what clients are being shown');
  ok(typeof line === 'string' && line.includes(String(EXPIRING_SOON_DAYS)),
    'and the window is the constant, not a number typed into prose twice');
}

{
  const s = expirySummary([
    cred({ expiresOn: '2026-03-01' }),
    cred({ kind: 'insurance', expiresOn: '2027-01-01' }),
  ], TODAY, true);
  ok(s.kind === 'attention' && !s.insuranceExpired,
    'a lapsed CERTIFICATION does not claim the insurance has gone');
  const line = expirySummaryLine(s);
  ok(typeof line === 'string' && !line.includes('insurance'), 'and says nothing about the cover, which is current');
}

/* ── a prefix of the set may alarm, and may never reassure ────────────────── */

{
  // Everything in date, but the read was truncated. The reassurance is exactly
  // the claim that cannot be made, and this is the assertion that says so.
  const s = expirySummary([cred({ expiresOn: '2030-01-01' })], TODAY, false);
  eq(s.kind, 'unknown', 'a truncated read holding nothing alarming says nothing — never "nothing has lapsed"');
  eq(expirySummaryLine(s), null, 'so no sentence is drawn over it');
}

{
  const s = expirySummary([
    cred({ expiresOn: '2026-03-01' }),
    cred({ expiresOn: '2030-01-01' }),
  ], TODAY, false);
  ok(s.kind === 'floor' && s.expired === 1, 'a truncated read still reports the lapse it can see');
  const line = expirySummaryLine(s);
  ok(typeof line === 'string' && line.includes('at least'), 'as a floor, in those words');
  ok(typeof line === 'string' && line.includes('not all of your credentials'),
    'and says why the number may be short, rather than leaving it to be read as a total');
  eq(expirySummaryNeedsMark(s), true, 'a floor is marked too — it is an alarm, not a figure');
}

{
  const s = expirySummary(null, TODAY, false);
  eq(s.kind, 'unknown', 'null under a partial read is still unknown');
}

/* ── plurals, because this sentence is read at a glance ───────────────────── */

{
  const two = expirySummary([
    cred({ expiresOn: '2026-03-01' }),
    cred({ expiresOn: '2026-04-01' }),
  ], TODAY, true);
  const line = expirySummaryLine(two);
  ok(typeof line === 'string' && line.includes('2 qualifications or policies of yours have expired'),
    'two reads as a plural');
  const one = expirySummaryLine(expirySummary([cred({ expiresOn: '2026-03-01' })], TODAY, true));
  ok(typeof one === 'string' && one.includes('1 qualification or policy of yours has expired'),
    'and one reads as a singular');
}

if (errors.length) {
  console.error(`credentialExpiry: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('credentialExpiry: ok');
