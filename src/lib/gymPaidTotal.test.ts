// One member's lifetime total, when their payments are not all in one money.
//
// The failure this exists to stop is a specific sentence on a specific screen:
// "Paid, all time — AED 4,300" over a list of GBP and AED payments, each of
// which renders its own currency correctly three inches below. That tile was
// `pays.reduce((a, p) => a + p.amountCents, 0)` labelled with the gym's CURRENT
// setting, and it is the figure an owner reads down the phone when a member
// queries their account.
//
// So the assertions below are about the six answers, and about the fact that
// only one of them is a number. Every ternary that tried to express this on a
// screen picked three of the six, and the three it dropped were the ones where
// silence reads as a fact about the member.
//
// Compile with tsc, run with node.
import { paidTotal, paidNote, type PaidRow } from './gymPaidTotal';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const row = (amountCents: number | null, currency: string | null): PaidRow => ({ amountCents, currency });

/* ── the three answers that are not a figure and are not nothing ───────────── */
{
  eq(paidTotal('loading', null).kind, 'loading', 'a read still in flight is not a member who has paid nothing');
  eq(paidTotal('failed', null).kind, 'failed', 'and a refused one certainly is not');
  eq(paidTotal('ready', null).kind, 'failed',
    'null rows under a ready state is a caller that lost the read; it is reported as failed rather than as zero');
  eq(paidNote(paidTotal('loading', null)), undefined, 'nothing is said while it is still reading');
  eq(paidNote(paidTotal('failed', null)), 'payments not read', 'and a failure says which read failed');
}

/* ── a truncated read is not a refused one ─────────────────────────────────── */
{
  // This used to arrive as 'failed', because `rowsOf` hands back null for a
  // partial slice and the null-rows line caught it one branch later. The
  // sentence that reached the tile was "payments not read", under payments that
  // had been read perfectly well — an owner sent looking for a broken query
  // when what they had was a member with more than a thousand payments.
  eq(paidTotal('partial', null).kind, 'partial', 'a read that came back at the ceiling says so');
  eq(paidNote(paidTotal('partial', null)),
    'only part of the payments were read, so a total is withheld',
    'and says it as truncation rather than as failure');

  // The half that had no protection at all: rows DO arrive under 'partial' the
  // moment a caller reaches for `rowsToShow` instead of `rowsOf`, and adding
  // them up would print a subtotal as a lifetime total. The state decides.
  const withRows = paidTotal('partial', [row(1000, 'GBP'), row(2500, 'GBP')]);
  eq(withRows.kind, 'partial',
    'rows under a partial state are a prefix — they are not summed, whichever accessor the caller used');
  eq(paidNote(withRows, 'last 3 March'), 'only part of the payments were read, so a total is withheld',
    'and the recency caption is withheld too, as it is for every other refusing arm');
}

/* ── nothing on record ─────────────────────────────────────────────────────── */
{
  const t = paidTotal('ready', []);
  eq(t.kind, 'none', 'a member with no payments has none');
  eq(paidNote(t), 'nothing recorded', 'and it is said as a fact about the record');
}

/* ── one currency, which is the only case that prints ──────────────────────── */
{
  const t = paidTotal('ready', [row(1000, 'GBP'), row(2500, 'gbp'), row(500, ' GBP ')]);
  eq(t.kind, 'one', 'one currency, however it was cased or spaced in the column');
  ok(t.kind === 'one' && t.currency === 'GBP', 'normalised to the code');
  ok(t.kind === 'one' && t.minorUnits === 4000, 'and added up');
  ok(t.kind === 'one' && t.short === 0, 'with nothing left out');
  eq(paidNote(t, 'last 3 March'), 'last 3 March', 'so the caption is free to say when they last paid');
}

/* ── two currencies are not one total ──────────────────────────────────────── */
{
  const t = paidTotal('ready', [row(430000, 'AED'), row(12000, 'GBP')]);
  eq(t.kind, 'many', 'two currencies produce no figure at all — that is the finding, not a smaller answer');
  const note = paidNote(t, 'last 3 March');
  ok((note ?? '').includes('AED') && (note ?? '').includes('GBP'), 'the note names both');
  ok(!(note ?? '').includes('last 3 March'),
    'and does NOT carry the recency caption — a "last paid" line under a refusing tile reads as though the total were fine');
}

/* ── rows that exist and cannot be added ───────────────────────────────────── */
{
  const t = paidTotal('ready', [row(1000, null), row(null, 'GBP')]);
  eq(t.kind, 'unstated', 'an amount with no currency and a currency with no amount are neither of them nothing');
  ok((paidNote(t) ?? '').includes('2 payments'), 'and the size of the hole is reported');
  ok(paidNote(t) !== 'nothing recorded',
    'this is the substitution the whole module exists to prevent — "we hold nothing" over rows we hold');
}

/* ── a partial figure says how partial ─────────────────────────────────────── */
{
  const t = paidTotal('ready', [row(1000, 'GBP'), row(2000, 'GBP'), row(999, null)]);
  eq(t.kind, 'one', 'one real currency still prints');
  ok(t.kind === 'one' && t.minorUnits === 3000, 'over the rows that stated one');
  ok((paidNote(t, 'last 3 March') ?? '').includes('1 further payment'),
    'and the row it could not include is counted out loud rather than quietly dropped');
}

if (errors.length) {
  console.error(`gymPaidTotal: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymPaidTotal ok');
