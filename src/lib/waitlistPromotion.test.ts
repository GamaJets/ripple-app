// The three answers a waitlist promotion can give. Compile with tsc, run with node.
//
// The assertion worth having is the negative one: 'failed' must never come out
// as 'nobody'. Everything downstream of that confusion is a person losing an
// hour they had been queueing for — the desk reads "nobody was waiting", gives
// the slot to whoever rings next, and the member who was actually promoted, or
// who was actually at the head of a queue nobody could read, is not told.
import {
  readPromotion, mayReoffer, promotionText,
  type WaitlistPromotion,
} from './waitlistPromotion';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(a === b, `${msg} (got ${String(a)}, wanted ${String(b)})`);

// ── a promotion that happened ──────────────────────────────────────────────

const promoted = readPromotion({ data: '9f1c7a52-0000-4000-8000-000000000001', error: null });
eq(promoted.outcome, 'promoted', 'a uuid back is a promotion');
eq(promoted.clientId, '9f1c7a52-0000-4000-8000-000000000001', 'and it carries who got the hour');

eq(readPromotion({ data: '  abc  ', error: null }).clientId, 'abc',
  'an id is trimmed rather than carried with its whitespace');

// ── a promotion that promoted nobody ───────────────────────────────────────

eq(readPromotion({ data: null, error: null }).outcome, 'nobody',
  'null is the function saying nobody got it');
eq(readPromotion({ data: null, error: null }).clientId, null,
  'and there is nobody to name');

// ── everything else is failed, and none of it is empty ─────────────────────

eq(readPromotion({ data: null, error: new Error('That session is not yours.') }).outcome, 'failed',
  'a refusal is failed, even though data came back null beside it');
eq(readPromotion({ data: undefined, error: null }).outcome, 'failed',
  'undefined is not the function saying null — it is an answer we cannot read');
eq(readPromotion({ data: '', error: null }).outcome, 'failed',
  'an empty string is not a client id');
eq(readPromotion({ data: '   ', error: null }).outcome, 'failed',
  'and neither is a blank one');
eq(readPromotion({ data: 0, error: null }).outcome, 'failed', 'a number is not an answer');
eq(readPromotion({ data: {}, error: null }).outcome, 'failed', 'nor is an object');
eq(readPromotion({ data: false, error: null }).outcome, 'failed',
  'nor is false, which is falsy and is still not null');
eq(readPromotion(null).outcome, 'failed', 'no result at all is failed');
eq(readPromotion(undefined).outcome, 'failed', 'and so is a call that returned nothing');

// The whole point of the type, asserted directly: only the proven-empty answer
// carries a client id of null AND licenses the re-offer.
eq(mayReoffer({ outcome: 'nobody', clientId: null }), true,
  'a proven-empty queue is the one case that licenses offering the hour round');
eq(mayReoffer({ outcome: 'failed', clientId: null }), false,
  'a failed call does NOT — unknown is not empty');
eq(mayReoffer({ outcome: 'promoted', clientId: 'x' }), false,
  'and neither does an hour that already has an owner');

// ── the sentence the desk reads ────────────────────────────────────────────

const say = (p: WaitlistPromotion, name?: string | null) => promotionText(p, name);

ok(say({ outcome: 'promoted', clientId: 'x' }, 'Mara Ali').includes('Mara Ali'),
  'a promotion names whoever got the hour when the console knows them');
ok(say({ outcome: 'promoted', clientId: 'x' }, 'Mara Ali').includes('they have been told'),
  'and says they were told, which part 2610 writes in the same transaction');

for (const missing of [undefined, null, '', '   ']) {
  const line = say({ outcome: 'promoted', clientId: 'x' }, missing);
  ok(line.includes('the member who was first in the queue'),
    `a missing name becomes a description, not a hole (${JSON.stringify(missing)})`);
  ok(!line.includes('—') && !line.includes('undefined') && !line.includes('null'),
    `and never a dash or a stringified nothing as the subject (${JSON.stringify(missing)})`);
}

ok(say({ outcome: 'nobody', clientId: null }).includes('open for anyone'),
  'an empty queue says the hour is open, because it is');

const failedLine = say({ outcome: 'failed', clientId: null });
ok(failedLine.includes('could not find out'),
  'a failed call says the queue is unknown');
ok(!failedLine.includes('Nobody was waiting'),
  'and never says nobody was waiting, which is the claim it cannot make');
ok(failedLine.includes('nobody has been given it'),
  'and says what did not happen, so the hour is not quietly assumed handled');

if (errors.length) {
  console.error(`waitlistPromotion: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`waitlistPromotion ok — ${checks} checks`);
