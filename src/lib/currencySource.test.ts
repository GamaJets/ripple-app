// One coach, one currency, and one place that decides which. Compile with tsc,
// run with node.
//
// The bugs these guard, in order of how much money they cost:
//
//  1. A SECOND ANSWER. `fetchInvoiceCurrency` read `trainers.tenant_id` and
//     every other screen read `profiles.tenant_id`. Part 711 leaves those two
//     naming different gyms the moment somebody is taken off a staff roster,
//     so an independent coach's invoices were denominated in the gym they had
//     left while the rest of the app showed them a dash. Both rendered
//     perfectly. `resolveMyCurrency` is the single answer.
//  2. A GYM COACH PRICING THEMSELVES. If the coach's own column were consulted
//     whenever nothing else had answered, a coach inside a gym whose owner has
//     not set a currency yet would price their packages in something else —
//     differently from the coach at the next desk, and differently from what
//     their clients are charged. The guard is "no gym", never "no answer".
//  3. A FAILED READ BECOMING "UNSET". The whole reason src/lib/currencyGap.ts
//     exists, doubled: a gym read that failed must not fall through to the
//     coach's own half, because "there is no gym" is then not established and
//     a picker offered on the strength of it writes a currency onto an account
//     that may already have one.
import { resolveMyCurrency, myCurrencyLine, currencyFromNote, type MyCurrencyGap, type GymCurrencyRead, type OwnCurrencyRead } from './currencySource';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const gym = (over: Partial<GymCurrencyRead> = {}): GymCurrencyRead =>
  ({ hasGym: false, currency: null, failed: false, ...over });
const own = (over: Partial<OwnCurrencyRead> = {}): OwnCurrencyRead =>
  ({ hasRow: true, currency: null, failed: false, unavailable: false, ...over });

/* ── the gym is the authority wherever there is one ───────────────────────── */

{
  const r = resolveMyCurrency(gym({ hasGym: true, currency: 'AED' }), own({ currency: 'GBP' }));
  eq(r.currency, 'AED', 'a coach in a gym is priced in the gym’s currency');
  eq(r.from, 'gym', 'and the screen can say where that came from');
  eq(r.gap, null, 'an answer has nothing to explain');
  eq(r.canSetOwn, false, 'and there is nothing for them to choose');
}

// THE precedence test. The coach's own column holds a different currency and it
// changes nothing: a second answer that can disagree is the defect, not a
// fallback.
eq(resolveMyCurrency(gym({ hasGym: true, currency: 'GBP' }), own({ currency: 'JPY' })).currency, 'GBP',
  'the coach’s own column never outranks their gym');

// And the one that would be easiest to get wrong: a gym that exists and has
// chosen nothing. The coach's own column is NOT consulted.
{
  const r = resolveMyCurrency(gym({ hasGym: true, currency: null }), own({ currency: 'JPY' }));
  eq(r.currency, null, 'a gym with no currency withholds — it does not fall through to the coach');
  eq(r.gap, 'gym-unset', 'and the gap names the gym, because an owner is who fixes it');
  eq(r.canSetOwn, false, 'a coach in a gym is not offered a picker of their own');
}

/* ── the coach's own currency, and only with no gym ───────────────────────── */

{
  const r = resolveMyCurrency(gym(), own({ currency: 'jpy' }));
  eq(r.currency, 'JPY', 'a coach with no gym is priced in their own currency');
  eq(r.from, 'own', 'and it is labelled as theirs');
  eq(r.canSetOwn, false, 'already set is not offered again — that would be a reprice');
}
eq(resolveMyCurrency(gym(), own({ currency: '  gbp  ' })).currency, 'GBP', 'trimmed and upper-cased on the way out');
eq(resolveMyCurrency(gym(), own({ currency: '   ' })).gap, 'own-unset', 'whitespace is not a currency');

{
  const r = resolveMyCurrency(gym(), own());
  eq(r.gap, 'own-unset', 'no gym and nothing chosen is the coach’s own question to answer');
  eq(r.canSetOwn, true, 'and it is the ONE state in which a picker may be drawn');
}

/* ── a failed read is not "unset", at either half ─────────────────────────── */

// Bug 3. `failed` is checked before `hasGym`, because a refused profiles read
// arrives as `hasGym: false` and reading that as "independent" hands a coach in
// a gym a picker that writes over their gym's setting.
{
  const r = resolveMyCurrency(gym({ failed: true }), own({ currency: 'JPY' }));
  eq(r.gap, 'unreadable', 'a failed gym read is unknown, never "you have no gym"');
  eq(r.currency, null, 'and it does not answer from the coach’s own column');
  eq(r.canSetOwn, false, 'and offers nothing to tap');
}
eq(resolveMyCurrency(gym({ failed: true, hasGym: true, currency: 'AED' }), own()).gap, 'unreadable',
  'a failed read is failed even when something came back with it');

{
  const r = resolveMyCurrency(gym(), own({ failed: true }));
  eq(r.gap, 'unreadable', 'a failed read of the coach’s own row is unknown too');
  eq(r.canSetOwn, false, 'and a picker over it could overwrite a currency that is already there');
}

// The migration not being applied. A deploy step, and it must never reach a
// coach as a refusal or as a setting nobody has made.
{
  const r = resolveMyCurrency(gym(), own({ unavailable: true }));
  eq(r.gap, 'unavailable', 'a missing column is a deploy step, not a choice nobody made');
  eq(r.canSetOwn, false, 'and nothing may be offered that cannot be written');
}

// No gym and no coach row: nowhere for a currency to live.
{
  const r = resolveMyCurrency(gym(), own({ hasRow: false }));
  eq(r.gap, 'nowhere', 'no record to hold a currency is its own answer');
  eq(r.canSetOwn, false, 'a picker here would write nothing and say it had worked');
}

/* ── still reading beats every other branch ───────────────────────────────── */

for (const g of [gym(), gym({ failed: true }), gym({ hasGym: true, currency: 'AED' })]) {
  eq(resolveMyCurrency(g, own({ currency: 'GBP' }), true).gap, 'reading',
    'nothing is known while a read is in flight, whatever half-answers are lying around');
}
eq(resolveMyCurrency(gym({ hasGym: true, currency: 'AED' }), own(), true).currency, null,
  'and no code is printed from a read that has not finished');

/* ── canSetOwn is true in exactly one state ───────────────────────────────── */

const STATES: { g: GymCurrencyRead; o: OwnCurrencyRead; label: string }[] = [
  { g: gym(), o: own(), label: 'no gym, row present, nothing set' },
  { g: gym(), o: own({ currency: 'GBP' }), label: 'already set' },
  { g: gym(), o: own({ hasRow: false }), label: 'no row' },
  { g: gym(), o: own({ failed: true }), label: 'own read failed' },
  { g: gym(), o: own({ unavailable: true }), label: 'column missing' },
  { g: gym({ failed: true }), o: own(), label: 'gym read failed' },
  { g: gym({ hasGym: true }), o: own(), label: 'in a gym, gym unset' },
  { g: gym({ hasGym: true, currency: 'AED' }), o: own(), label: 'in a gym, gym set' },
];
for (const s of STATES) {
  const want = s.label === 'no gym, row present, nothing set';
  eq(resolveMyCurrency(s.g, s.o).canSetOwn, want, `canSetOwn for "${s.label}"`);
}
eq(resolveMyCurrency(gym(), own(), true).canSetOwn, false, 'and never while the read is in flight');

/* ── six causes, six different sentences ──────────────────────────────────── */

const GAPS: MyCurrencyGap[] = ['reading', 'unreadable', 'unavailable', 'nowhere', 'gym-unset', 'own-unset'];
const CONSEQUENCE = 'there is no unit to price these sessions in';
const lines = GAPS.map((g) => [g, myCurrencyLine(g, CONSEQUENCE)] as const);

eq(new Set(lines.map(([, l]) => l)).size, GAPS.length, 'loading, failed and empty are never the same sentence');
for (const [gap, line] of lines) {
  ok(line.includes(CONSEQUENCE), `${gap} says what is actually lost by it`);
  ok(/\.$/.test(line), `${gap} ends as a sentence`);
  // Only the gym branch may send the coach to a gym owner. Every other branch
  // that said it was addressing a person who does not exist, or a person with
  // nothing to fix.
  eq(/owner/.test(line), gap === 'gym-unset', `${gap} names an owner only when there is one to name`);
}
ok(/yours to choose/.test(myCurrencyLine('own-unset', CONSEQUENCE)),
  'the independent coach is told the choice is theirs, which is the whole fix');
ok(/waiting to be applied/.test(myCurrencyLine('unavailable', CONSEQUENCE)),
  'an unapplied migration reads as a deploy step, not as the coach’s fault');
ok(/try again/.test(myCurrencyLine('unreadable', CONSEQUENCE)),
  'and only the failed read tells them to try again, because only that one is fixed by trying');

// The consequence is a fragment. A caller that passes a full stop must not
// produce two.
ok(!/\.\./.test(myCurrencyLine('own-unset', 'nothing can be priced.')), 'a trailing stop on the fragment is absorbed');

/* ── where a figure came from ─────────────────────────────────────────────── */

eq(currencyFromNote(null, 'AED'), null, 'no source is nothing to say');
eq(currencyFromNote('gym', null), null, 'and no code is nothing to say either');
ok((currencyFromNote('gym', 'aed') || '').includes('AED'), 'the note carries the code, upper-cased');
ok(/gym/.test(currencyFromNote('gym', 'AED') || ''), 'a gym figure says so');
ok(/you set/.test(currencyFromNote('own', 'JPY') || ''), 'and the coach’s own says that instead');
ok(currencyFromNote('gym', 'AED') !== currencyFromNote('own', 'AED'),
  'the two sources never read identically — they are acted on differently');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('currencySource: ok');
