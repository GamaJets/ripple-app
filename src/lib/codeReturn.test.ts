// What a code cost and what it returned — and the refusal to rank channels on
// numbers too small to rank. Compile with tsc, run with node.
//
// The bug this guards is not an arithmetic one. It is a coach being told
// "Instagram is your best channel" off a 4–1 split across twelve clients,
// moving next month's ad budget onto Instagram, and Repple having presented a
// coin toss as a finding. Most of what follows pins that refusal down from both
// sides of its threshold.
//
// The second thing it guards is the difference between unknown and zero, which
// here is the difference between "I have not told you what this cost" and "this
// cost me nothing". Collapse them and every campaign nobody measured shows an
// infinite return and wins every comparison.
import {
  LAST_TOUCH_NOTE, MIN_CLIENTS_TO_COMPARE, NOISE_P, codeFigures, codeReturn,
  costPerClient, enoughToTell, parseSpend, returnLine, shapeCodeReturns, spendFieldValue,
  splitP, stayedLine, tellApart,
  type Apart, type CodeReturn, type CodeReturnRow, type RawCodeReturn, type Tell,
} from './codeReturn';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const near = (a: number, b: number, msg: string) => ok(Math.abs(a - b) < 1e-9, `${msg} — got ${a}, wanted ${b}`);

// Readers for the discriminated unions, so an assertion about the refused case
// does not have to be written as a nest of ternaries.
const whyApart = (a: Apart): string => (a.tell ? 'told' : a.why);
const whyTell = (t: Tell): string => (t.rankable ? 'rankable' : t.why);
const whyReturn = (r: CodeReturn): string => (r.known ? 'known' : r.why);
const noteReturn = (r: CodeReturn): string => (r.known ? '' : r.note);

const raw = (over: Partial<RawCodeReturn> = {}): RawCodeReturn => ({
  id: 'id-1', code: 'K7M2QX', label: 'Instagram bio',
  created_at: '2026-08-01T10:00:00Z', revoked_at: null, is_default: false,
  joined: 0, active_now: 0,
  revenue_cents: 0, revenue_currency: 'GBP',
  spend_cents: null, spend_currency: null, ...over,
});
const row = (over: Partial<CodeReturnRow> = {}): CodeReturnRow => ({
  id: 'id-1', code: 'K7M2QX', label: 'Instagram bio', isDefault: false, isLive: true,
  createdAt: '2026-08-01T10:00:00Z', clients: 0, activeNow: 0,
  revenue: { cents: 0, currency: 'GBP' }, spend: null, ...over,
});

/* ── too few to tell, from both sides of the line ───────────────────────── */

// The threshold is not a feel. Below six clients across the two codes being
// compared, NO split can clear p < 0.05 — 5–0, the most lopsided result five
// clients can produce, is p = 0.0625. So five is refused however it falls.
eq(MIN_CLIENTS_TO_COMPARE, 6, 'the threshold is the smallest n at which an exact two-sided test can answer at all');
near(splitP(5, 0), 0.0625, 'the most lopsided five-client split still does not clear the noise line');
ok(splitP(5, 0) > NOISE_P, 'which is exactly why five is refused');
near(splitP(6, 0), 0.03125, 'six clients, all one way, is the first split that can be told from chance');
ok(splitP(6, 0) < NOISE_P, 'and it clears the line');

// Both sides of the boundary, on the function the screen actually asks.
const five = tellApart(5, 0);
eq(five.tell, false, 'five clients is not enough to rank two codes, however they split');
eq(whyApart(five), 'too-few', 'and it says so as "too few", not as "too close"');
eq(five.tell === false ? five.have : -1, 5, 'it reports how many there are');
eq(five.tell === false ? five.needed : -1, MIN_CLIENTS_TO_COMPARE, 'and how many it would take');
eq(tellApart(6, 0).tell, true, 'six, all one way, is enough');
eq(tellApart(4, 2).tell, false, 'six that split 4–2 is enough clients and not enough of a gap');
eq(whyApart(tellApart(4, 2)), 'too-close', 'a gap inside the noise is refused for a different reason, and says which');

// The brief's own coach: twelve clients, Instagram 4, TikTok 1. n between the
// two compared codes is five, and even with a hundred clients elsewhere a 4–1
// split is a coin toss.
near(splitP(4, 1), 0.375, 'four against one is what chance does more than a third of the time');
eq(tellApart(4, 1).tell, false, 'a coach with Instagram 4 and TikTok 1 has learned nothing');

/* ── the arithmetic behind that does not fall over on real numbers ──────── */

// Computed in log space precisely so a busy coach's counts do not underflow to
// p = 0, which would read as certainty.
ok(Number.isFinite(splitP(1200, 1000)), 'a two-thousand-client comparison still produces a number');
ok(splitP(1200, 1000) > 0 && splitP(1200, 1000) < NOISE_P, 'a real gap that size is detected, not underflowed to nothing');
ok(splitP(1100, 1100) > 0.9, 'a dead heat over two thousand clients is not a finding');
eq(splitP(0, 0), 1, 'no clients at all is no evidence of anything');
eq(splitP(3, 3), 1, 'an even split is never evidence');

/* ── the ranking the screen asks for, and its refusals ──────────────────── */

const two = (a: number, b: number) => [
  row({ id: 'a', code: 'AAAAAA', label: 'Instagram', clients: a, activeNow: a }),
  row({ id: 'b', code: 'BBBBBB', label: 'TikTok', clients: b, activeNow: b }),
];

const noisy = enoughToTell('ready', two(4, 1));
eq(noisy.rankable, false, 'the twelve-client coach is not given a winner');
eq(whyTell(noisy), 'too-few', 'and the reason is that there are too few, not that it could not be read');
ok(/too few/i.test(noisy.note), 'the screen is told plainly, in place of a comparison');
ok(!/instagram/i.test(noisy.note), 'and no leader is named — naming one IS the comparison');

const clear = enoughToTell('ready', two(9, 0));
eq(clear.rankable, true, 'nine against nil is a finding and is reported as one');
eq(clear.rankable === true ? clear.best.label : '', 'Instagram', 'the leader is the one with more clients');
eq(clear.rankable === true ? clear.runnerUp.label : '', 'TikTok', 'and the one it beat is named too');

// A close race over enough clients is refused for the other reason, and says so
// without picking a side.
const close = enoughToTell('ready', two(11, 9));
eq(whyTell(close), 'too-close', 'twenty clients split 11–9 is still a coin toss');
ok(/too close/i.test(close.note), 'and says which of the two refusals it is');

// An unread list is not a set of channels that brought nobody. Ranking it would
// be ranking a dropped connection.
for (const s of ['loading', 'error', 'partial'] as LoadStatus[]) {
  const t = enoughToTell(s, two(9, 0));
  eq(t.rankable, false, `${s} produces no ranking`);
  eq(whyTell(t), 'unread', `${s} says the read is the problem, not the campaigns`);
  ok(!/instagram/i.test(t.note), `${s} names no winner`);
}

// One named code has nothing to be compared with, and the default code is not a
// channel — it is everybody no named code claims, rotated-away codes included.
const alone = enoughToTell('ready', [row({ id: 'a', clients: 40 })]);
eq(alone.rankable, false, 'one code cannot be compared with anything');
eq(whyTell(alone), 'one-code', 'and it says why, rather than declaring the only code the winner');
const withDefault = enoughToTell('ready', [
  row({ id: null, code: 'DEF123', label: 'Your main code', isDefault: true, clients: 90 }),
  row({ id: 'a', code: 'AAAAAA', label: 'Instagram', clients: 40 }),
]);
eq(whyTell(withDefault), 'one-code', 'the default code is not a rival channel, so one named code is still only one');

/* ── no spend recorded is NOT zero spend ───────────────────────────────── */

const unmeasured = shapeCodeReturns([raw({ spend_cents: null, spend_currency: null, joined: 8 })])[0];
eq(unmeasured.spend, null, 'an absent spend row stays absent — it does not become zero');
eq(costPerClient(unmeasured), null, 'and there is no cost per client to state');
eq(codeFigures('ready', unmeasured).spent, '—', 'the screen shows a dash, not a free campaign');
eq(codeFigures('ready', unmeasured).perClient, '—', 'and no cost per client either');
eq(whyReturn(codeReturn(unmeasured)), 'no-spend', 'no return is claimed, because nobody said what it cost');

// A recorded zero is a real answer — an organic post, a code read out in class —
// and it must behave differently from the above in every one of these.
const free = shapeCodeReturns([raw({ spend_cents: 0, spend_currency: 'GBP', joined: 8, revenue_cents: 90000 })])[0];
eq(free.spend?.cents, 0, 'a recorded zero is kept as a figure');
eq(costPerClient(free)?.cents, 0, 'and eight clients off nothing cost nothing each');
ok(codeFigures('ready', free).spent !== '—', 'a stated zero prints as a zero, not as a dash');
const freeReturn = codeReturn(free);
eq(freeReturn.known, true, 'a free code that earned money has a return');
eq(freeReturn.known === true ? freeReturn.net.cents : -1, 90000, 'which is everything it earned');
eq(freeReturn.known === true ? freeReturn.back : 0, null,
  'but no multiple — money divided by nothing is not a big number, it is not a number');

// Spend recorded, nobody through the door. Cost per client is not zero there
// either; it is the worst outcome the coach had, and a zero would hide it.
const wasted = row({ clients: 0, spend: { cents: 40000, currency: 'GBP' } });
eq(costPerClient(wasted), null, 'spend with no clients has no cost per client — it is not zero each');
eq(codeFigures('ready', wasted).perClient, '—', 'and the screen says so with a dash');
ok(codeFigures('ready', wasted).spent !== '—', 'while still showing the money that went out');

/* ── an unread revenue figure is NOT no revenue ────────────────────────── */

const untotalled = shapeCodeReturns([raw({ revenue_cents: null, revenue_currency: null, joined: 5, spend_cents: 40000, spend_currency: 'GBP' })])[0];
eq(untotalled.revenue, null, 'revenue the server could not total stays unknown');
eq(codeFigures('ready', untotalled).revenue, '—', 'and renders as a dash rather than as nothing earned');
eq(whyReturn(codeReturn(untotalled)), 'no-revenue', 'with no return computed off it');

// Spend in one currency against revenue in another is not a subtraction.
const crossed = row({ clients: 4, spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 90000, currency: 'AED' } });
eq(codeReturn(crossed).known, false, 'two currencies do not net off');
eq(whyReturn(codeReturn(crossed)), 'currency', 'and the reason given is the currencies');
ok(/GBP/.test(noteReturn(codeReturn(crossed))) && /AED/.test(noteReturn(codeReturn(crossed))),
  'both of which are named, so the coach can see what to fix');

// The ordinary case, so the refusals above are not the only path that works.
const worked = row({ clients: 10, activeNow: 7, spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 200000, currency: 'GBP' } });
const wr = codeReturn(worked);
eq(wr.known === true ? wr.net.cents : -1, 160000, 'revenue less spend is the net');
eq(wr.known === true ? wr.back : -1, 5, 'and five pounds back for every pound in');
eq(costPerClient(worked)?.cents, 4000, 'ten clients on four hundred pounds is forty pounds each');
ok(/1,600/.test(returnLine('ready', worked)), 'and the line says what it made, separator and all');
ok(/5\.0×/.test(returnLine('ready', worked)), 'and what that was per pound spent');

// A campaign that lost money says so in words. money() would render the net as
// "GBP -400.00", and a minus sign is the easiest mark on a screen to miss.
const lost = row({ clients: 1, spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 5000, currency: 'GBP' } });
ok(/cost you/i.test(returnLine('ready', lost)), 'a code that lost money says it cost, rather than printing a minus sign');
ok(!/-/.test(returnLine('ready', lost)), 'and never leans on the minus sign to carry it');
eq(returnLine('error', worked), '', 'nothing is said about a return that could not be read');
ok(/cost/i.test(returnLine('ready', row({ clients: 3 }))), 'a code with no recorded spend is asked for one instead of being given a return');

/* ── nothing is a figure under an incomplete read ──────────────────────── */

const busy = row({ clients: 1204, activeNow: 900, spend: { cents: 40000, currency: 'GBP' }, revenue: { cents: 1234500, currency: 'GBP' } });
for (const s of ['loading', 'error', 'partial'] as LoadStatus[]) {
  const f = codeFigures(s, busy);
  eq(`${f.spent}${f.clients}${f.revenue}${f.perClient}`, '————', `${s} states no figure at all`);
  ok(!/nobody/i.test(stayedLine(s, row())), `${s} does not claim nobody came in`);
  ok(!/\b0\b/.test(stayedLine(s, row())), `${s} does not print a zero it did not read`);
}
ok(/nobody/i.test(stayedLine('ready', row())), 'a completed read may say nobody came in');
ok(/900/.test(stayedLine('ready', busy)), 'and states how many of them stayed');
// House rule: any figure that can reach four digits carries its separator.
ok(/1,204/.test(codeFigures('ready', busy).clients), 'a four-figure client count carries its separator');
ok(/12,345/.test(codeFigures('ready', busy).revenue), 'and so does four-figure money');

/* ── shaping, ordering and the bigint that arrives as a string ─────────── */

const shaped = shapeCodeReturns([
  raw({ id: 'b', code: 'aaaaaa', label: 'Old flyer', created_at: '2026-07-01T00:00:00Z', revoked_at: '2026-07-30T00:00:00Z' }),
  raw({ id: 'c', code: 'BBBBBB', label: 'Instagram bio', created_at: '2026-08-20T00:00:00Z' }),
  raw({ id: null, code: 'DEF123', label: 'Your main code', created_at: null, is_default: true }),
  raw({ id: 'd', code: 'CCCCCC', label: 'Gym flyer', created_at: '2026-08-02T00:00:00Z' }),
]);
eq(shaped.map((r) => r.id).join(','), ',c,d,b', 'default first, then live newest first, then revoked — the same order as the codes list');
eq(shaped[3].isLive, false, 'a revoked code is still listed, with what it did');
eq(shaped[3].code, 'AAAAAA', 'a code is rendered in the case it is spoken in');
eq(shapeCodeReturns([raw({ code: '' })]).length, 0, 'a row with no code is not rendered');
eq(shapeCodeReturns(null).length, 0, 'nothing to shape yields nothing');
eq(shapeCodeReturns([raw({ joined: '1204', active_now: '900' })])[0].clients, 1204, 'a bigint client count arrives as a string and is read as a number');
eq(shapeCodeReturns([raw({ revenue_cents: '1234500', revenue_currency: 'gbp' })])[0].revenue?.cents, 1234500, 'so does revenue');
eq(shapeCodeReturns([raw({ revenue_cents: '1234500', revenue_currency: 'gbp' })])[0].revenue?.currency, 'GBP',
  'and its currency is folded, so gbp and GBP cannot look like two currencies');
// An amount with no currency is not an amount of money.
eq(shapeCodeReturns([raw({ spend_cents: 40000, spend_currency: null })])[0].spend, null,
  'a figure with no currency is not money and is not rendered as money');

/* ── what the coach types into the spend field ─────────────────────────── */

eq(parseSpend('').kind, 'clear', 'an empty field clears the record — unknown, which is not zero');
eq(parseSpend('   ').kind, 'clear', 'and so does whitespace');
eq(parseSpend(null).kind, 'clear', 'and nothing at all');
const zero = parseSpend('0');
eq(zero.kind, 'amount', 'a typed zero is a claim the coach is making');
eq(zero.kind === 'amount' ? zero.cents : -1, 0, 'and it is recorded as zero, not as unknown');
const p250 = parseSpend('250');
eq(p250.kind === 'amount' ? p250.cents : -1, 25000, 'whole units in, minor units out');
const p2505 = parseSpend('250.50');
eq(p2505.kind === 'amount' ? p2505.cents : -1, 25050, 'and the pennies survive');
const psym = parseSpend('£1,250');
eq(psym.kind === 'amount' ? psym.cents : -1, 125000, 'a coach asked for an amount types a currency symbol; that is not an error');
eq(parseSpend('-5').kind, 'bad', 'negative spend is refused');
eq(parseSpend('lots').kind, 'bad', 'and so is a word');
eq(parseSpend('999999999999').kind, 'bad', 'an extra run of zeros is caught rather than drowning every other code');

eq(spendFieldValue(row()), '', 'a code with no recorded spend opens with an empty field, not a zero');
eq(spendFieldValue(row({ spend: { cents: 25000, currency: 'GBP' } })), '250', 'a round amount comes back round');
eq(spendFieldValue(row({ spend: { cents: 25050, currency: 'GBP' } })), '250.50', 'and a pennies amount comes back whole');
eq(spendFieldValue(row({ spend: { cents: 0, currency: 'GBP' } })), '0', 'a recorded zero comes back as a zero, so the coach can see they said it');

/* ── the one sentence about attribution ────────────────────────────────── */

ok(/last code/i.test(LAST_TOUCH_NOTE), 'the screen says attribution is last touch');
ok(/instagram/i.test(LAST_TOUCH_NOTE), 'in the terms a coach loses money by not knowing');
// And that these rows are not the whole roster: a client who found the coach by
// browsing the directory is on it and in none of these figures.
ok(/arrived by code/i.test(LAST_TOUCH_NOTE), 'and says the list covers only the people who came in by code');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`codeReturn: ok (${shaped.length} rows shaped, ${MIN_CLIENTS_TO_COMPARE} clients before anything is ranked)`);
