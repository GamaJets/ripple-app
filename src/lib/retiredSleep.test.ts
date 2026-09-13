// A disconnected watch's nights, kept rather than destroyed.
//
// The assertions that matter here are the ones about order and refusal: a copy
// that fails must not be reported as a copy that worked, because the caller
// deletes the originals on the strength of the answer; and a restore must never
// put a shelved night over a live one.
//
// The Supabase client is a stub. Every call is recorded, so the tests can
// assert what was SENT as well as what came back — which is the only way to
// check that the restore filtered before it wrote rather than after.
//
// Compile with tsc, then run under plain node.
import {
  rowToKept, keptToRow, nightsToRestore, keepNightsBeforeDisconnect,
  restoreRetiredNights, discardKept,
  disconnectNightsLine, keepFailedLine, restoredNightsLine,
  LIVE_TABLE, SHELF_TABLE, type KeptNight,
} from './retiredSleep';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const UID = '11111111-1111-4111-8111-111111111111';

/** A live row exactly as `device_sleep_nights` returns one. */
const liveRow = (night: string, minutes = 451, provider = 'whoop') => ({
  night, minutes_asleep: minutes, provider,
  source_id: provider, source_name: 'WHOOP', family: 'strap',
  basis: 'asleep', recorded_at: '2026-09-01T07:00:00.000Z',
});

/* ── the stub ─────────────────────────────────────────────────────────────── */

interface Answer { data?: unknown; error?: unknown; count?: number | null }
interface Call { table: string; op: string; rows?: unknown[]; opts?: unknown }

/**
 * A Supabase double whose builders are thenable, like the real one.
 *
 * `answers` is keyed `table:op` and each entry is consumed in order, so a test
 * can make the first read succeed and the write that follows it fail — which is
 * the case the whole file is about.
 */
function stub(answers: Record<string, Answer[]>) {
  const calls: Call[] = [];
  const take = (key: string): Answer => {
    const list = answers[key];
    if (!list || !list.length) return { data: [], error: null, count: 0 };
    return list.shift()!;
  };
  const builder = (table: string, op: string, rows?: unknown[], opts?: unknown) => {
    calls.push({ table, op, rows, opts });
    const result = take(`${table}:${op}`);
    const self: any = {
      eq: () => self,
      in: () => self,
      then: (res: (v: Answer) => unknown) => Promise.resolve(result).then(res),
    };
    return self;
  };
  const sb = {
    from: (table: string) => ({
      select: () => builder(table, 'select'),
      upsert: (rows: unknown[], opts: unknown) => builder(table, 'upsert', rows, opts),
      delete: (opts: unknown) => builder(table, 'delete', undefined, opts),
    }),
  };
  return { sb, calls };
}

/* ── 1 · reading a row, strictly ──────────────────────────────────────────── */

{
  const n = rowToKept(liveRow('2026-09-01'));
  ok(n != null, 'a well-formed row becomes a kept night');
  eq(n?.minutesAsleep, 451, 'with its duration');
  eq(n?.sourceName, 'WHOOP', 'and the name the member is shown');
}

eq(rowToKept(null), null, 'nothing is not a night');
eq(rowToKept({ ...liveRow('2026-09-01'), night: '1 Sep' }), null, 'a night that is not a date is dropped');
// The live table's own check constraints. A row that cannot pass them is a row
// that would fail on the way back, and failing then is failing after the
// original has been deleted.
eq(rowToKept({ ...liveRow('2026-09-01'), minutes_asleep: 0 }), null, 'a zero duration is dropped, not kept as a sleepless night');
eq(rowToKept({ ...liveRow('2026-09-01'), minutes_asleep: 1441 }), null, 'and so is one longer than a day');
eq(rowToKept({ ...liveRow('2026-09-01'), source_name: '' }), null, 'an unattributed figure is not kept');
eq(rowToKept({ ...liveRow('2026-09-01'), family: '   ' }), null, 'nor is one with no device kind');
eq(rowToKept({ ...liveRow('2026-09-01'), recorded_at: '' }), null, 'nor one that cannot say how old it is');
// Normalised on the way IN, so a third value can never reach the shelf and fail
// the constraint on the way back.
eq(rowToKept({ ...liveRow('2026-09-01'), basis: 'guessed' })?.basis, 'asleep', 'an unknown basis reads as asleep, as it does everywhere else');
eq(rowToKept({ ...liveRow('2026-09-01'), basis: 'in-bed' })?.basis, 'in-bed', 'and time in bed survives, because the wording depends on it');

{
  const row = keptToRow(UID, rowToKept(liveRow('2026-09-01'))!);
  eq(row.user_id, UID, 'the owner comes from the session, not from the row');
  eq(row.recorded_at, '2026-09-01T07:00:00.000Z', 'and recorded_at travels rather than being re-stamped');
}

/* ── 2 · a restore never covers a live night ──────────────────────────────── */

const shelf: KeptNight[] = ['2026-08-01', '2026-08-02', '2026-08-03']
  .map((d) => rowToKept(liveRow(d))!);

{
  const all = nightsToRestore(shelf, []);
  eq(all.length, 3, 'with nothing live, every shelved night goes back');
}
{
  const some = nightsToRestore(shelf, ['2026-08-02']);
  eq(some.length, 2, 'a night the live table already holds is skipped');
  ok(!some.some((n) => n.night === '2026-08-02'), 'and it is the right one that is skipped');
}
{
  const none = nightsToRestore(shelf, ['2026-08-01', '2026-08-02', '2026-08-03']);
  eq(none.length, 0, 'a shelf entirely covered by live nights restores nothing');
}
// Two shelf rows for one night cannot happen — the primary key forbids it — but
// an upsert carrying two rows for one key is rejected outright by PostgREST, so
// one malformed read must not fail the whole restore.
{
  const dup = nightsToRestore([shelf[0], shelf[0]], []);
  eq(dup.length, 1, 'a duplicated night is sent once');
}

// The rest reaches the stubbed client, so it runs inside an async IIFE —
// tsconfig.test.json compiles these to CommonJS, where a top-level await is
// not available. Same shape as src/lib/cappedByIds.test.ts.
(async () => {
  /* ── 3 · keeping, before the device is unlinked ───────────────────────────── */

  {
    const { sb, calls } = stub({
      [`${LIVE_TABLE}:select`]: [{ data: [liveRow('2026-09-01'), liveRow('2026-09-02')], error: null }],
      [`${SHELF_TABLE}:upsert`]: [{ error: null, count: 2 }],
    });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, true, 'two measured nights are kept');
    eq(res.ok && res.nights, 2, 'and the count is the number now safe');
    eq(calls[1]?.table, SHELF_TABLE, 'the copy goes to the shelf');
    eq((calls[1]?.rows as unknown[])?.length, 2, 'carrying both nights');
    eq((calls[1]?.opts as any)?.count, 'exact', 'and it asks the server to count what it wrote');
  }

  // The ordinary case for somebody who connected a watch this morning. Zero is a
  // success: there is nothing to protect, so the disconnect may go ahead.
  {
    const { sb } = stub({ [`${LIVE_TABLE}:select`]: [{ data: [], error: null }] });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, true, 'no stored nights is a success, not a failure');
    eq(res.ok && res.nights, 0, 'with nothing kept');
  }

  // The refusals. Each one is a case where the caller must NOT go on to delete.
  {
    const { sb } = stub({ [`${LIVE_TABLE}:select`]: [{ data: null, error: { message: 'network' } }] });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, false, 'a failed read of the nights refuses');
  }
  {
    const { sb } = stub({
      [`${LIVE_TABLE}:select`]: [{ data: [liveRow('2026-09-01')], error: null }],
      [`${SHELF_TABLE}:upsert`]: [{ error: { message: 'refused' }, count: null }],
    });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, false, 'a refused copy refuses');
  }
  // The one this codebase keeps producing: no error, no rows. An insert RLS
  // declined is a 201 with `error: null`, and believing it would delete the
  // member's history on the strength of a write that never happened.
  {
    const { sb } = stub({
      [`${LIVE_TABLE}:select`]: [{ data: [liveRow('2026-09-01')], error: null }],
      [`${SHELF_TABLE}:upsert`]: [{ error: null, count: 0 }],
    });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, false, 'a copy that matched no rows is NOT a copy, however quiet the server was');
  }
  {
    const { sb } = stub({
      [`${LIVE_TABLE}:select`]: [{ data: [liveRow('2026-09-01')], error: null }],
      [`${SHELF_TABLE}:upsert`]: [{ error: null, count: null }],
    });
    const res = await keepNightsBeforeDisconnect(sb, UID, 'whoop');
    eq(res.ok, false, 'and neither is one nobody counted');
  }
  {
    const { sb } = stub({});
    eq((await keepNightsBeforeDisconnect(sb, '', 'whoop')).ok, false, 'signed out keeps nothing');
    eq((await keepNightsBeforeDisconnect(sb, UID, '')).ok, false, 'and an unnamed device keeps nothing');
  }

  /* ── 4 · restoring, when the device comes back ────────────────────────────── */

  {
    const { sb, calls } = stub({
      [`${SHELF_TABLE}:select`]: [{ data: [liveRow('2026-08-01'), liveRow('2026-08-02')], error: null }],
      [`${LIVE_TABLE}:select`]: [{ data: [{ night: '2026-08-02' }], error: null }],
      [`${LIVE_TABLE}:upsert`]: [{ error: null, count: 1 }],
      [`${SHELF_TABLE}:delete`]: [{ error: null, count: 2 }],
    });
    const res = await restoreRetiredNights(sb, UID, 'whoop');
    eq(res.ok, true, 'a reconnect puts the kept nights back');
    eq(res.ok && res.nights, 1, 'and restores only the night that was not already there');
    const put = calls.find((c) => c.table === LIVE_TABLE && c.op === 'upsert');
    eq((put?.rows as any[])?.length, 1, 'one row is sent, not two');
    eq((put?.rows as any[])?.[0]?.night, '2026-08-01', 'and it is the absent night');
    eq((put?.opts as any)?.ignoreDuplicates, true, 'a night written between the two reads is left alone');
    // The shelf is cleared including the skipped night: it has been answered by a
    // newer measurement, and keeping it only means offering it again next time.
    ok(calls.some((c) => c.table === SHELF_TABLE && c.op === 'delete'), 'the shelf is cleared afterwards');
  }

  // Nothing shelved. A true answer, because the read was checked.
  {
    const { sb, calls } = stub({ [`${SHELF_TABLE}:select`]: [{ data: [], error: null }] });
    const res = await restoreRetiredNights(sb, UID, 'whoop');
    eq(res.ok, true, 'a first connection has nothing to restore and says so');
    eq(res.ok && res.nights, 0, 'with a count of none');
    eq(calls.length, 1, 'and writes nothing at all');
  }

  // A failed read of the live nights must not be treated as "there are none".
  {
    const { sb, calls } = stub({
      [`${SHELF_TABLE}:select`]: [{ data: [liveRow('2026-08-01')], error: null }],
      [`${LIVE_TABLE}:select`]: [{ data: null, error: { message: 'network' } }],
    });
    const res = await restoreRetiredNights(sb, UID, 'whoop');
    eq(res.ok, false, 'we do not restore over nights we could not see');
    ok(!calls.some((c) => c.op === 'upsert'), 'and nothing is written');
    ok(!calls.some((c) => c.op === 'delete'), 'and the shelf is left intact to try again');
  }

  // A refused write leaves the shelf alone, so the next reconnect can try again.
  {
    const { sb, calls } = stub({
      [`${SHELF_TABLE}:select`]: [{ data: [liveRow('2026-08-01')], error: null }],
      [`${LIVE_TABLE}:select`]: [{ data: [], error: null }],
      [`${LIVE_TABLE}:upsert`]: [{ error: { message: 'refused' }, count: null }],
    });
    const res = await restoreRetiredNights(sb, UID, 'whoop');
    eq(res.ok, false, 'a refused restore refuses');
    ok(!calls.some((c) => c.op === 'delete'), 'and does not throw the shelf away');
  }

  // The nights are back and only the tidying failed. Telling the member their
  // history was not restored would be false.
  {
    const { sb } = stub({
      [`${SHELF_TABLE}:select`]: [{ data: [liveRow('2026-08-01')], error: null }],
      [`${LIVE_TABLE}:select`]: [{ data: [], error: null }],
      [`${LIVE_TABLE}:upsert`]: [{ error: null, count: 1 }],
      [`${SHELF_TABLE}:delete`]: [{ error: { message: 'refused' }, count: null }],
    });
    const res = await restoreRetiredNights(sb, UID, 'whoop');
    eq(res.ok, true, 'a shelf that would not clear does not turn a restore into a failure');
    eq(res.ok && res.nights, 1, 'the night is back and is reported as back');
  }

  /* ── 5 · discarding a shelf nobody needed ─────────────────────────────────── */

  {
    const { sb, calls } = stub({ [`${SHELF_TABLE}:delete`]: [{ error: null, count: 3 }] });
    const res = await discardKept(sb, UID, 'whoop');
    eq(res.ok, true, 'a copy made for a disconnect that did not happen is cleared');
    eq((calls[0]?.opts as any)?.count, 'exact', 'counting, like every other write here');
  }
  {
    const { sb } = stub({ [`${SHELF_TABLE}:delete`]: [{ error: { message: 'no' }, count: null }] });
    eq((await discardKept(sb, UID, 'whoop')).ok, false, 'and a refusal is reported rather than assumed away');
  }

  /* ── 6 · what the member is told ──────────────────────────────────────────── */

  // The confirmation must not promise a destruction the code no longer does.
  {
    const line = disconnectNightsLine('Repple', 'WHOOP');
    ok(!/removed from your record/.test(line), 'the alert no longer says the nights are removed from the record');
    ok(!/fresh record/.test(line), 'nor that reconnecting starts a fresh one');
    ok(/not deleted/.test(line), 'it says they are not deleted');
    ok(/go back/.test(line), 'and that reconnecting brings them back');
    // The half the original got right and must keep: only one of the two
    // things that happen is what the word "disconnect" promises.
    ok(/sleep week/.test(line), 'while still saying they come out of the sleep week meanwhile');
    ok(/WHOOP app itself/.test(line), 'and that the vendor app is untouched');
    ok(line.includes('Repple'), 'the brand is the tenant label, never hardcoded');
  }

  {
    const line = keepFailedLine('Oura');
    ok(/still connected/.test(line), 'a failed copy says the device is still connected');
    ok(/nothing was changed/i.test(line), 'and that nothing was changed');
    ok(line.includes('Oura'), 'naming the device, because the screen lists six');
  }

  ok(/12 nights/.test(restoredNightsLine(12, 'WHOOP') ?? ''), 'a restore says how many nights came back');
  ok(/The night /.test(restoredNightsLine(1, 'Oura') ?? ''), 'one night is not "1 nights"');
  // Nothing restored is no sentence. "0 nights restored" reads as a loss where
  // there was nothing to lose.
  eq(restoredNightsLine(0, 'WHOOP'), null, 'nothing restored says nothing');
  eq(restoredNightsLine(NaN, 'WHOOP'), null, 'and a count we do not have says nothing either');

  if (errors.length) {
    console.error(`retiredSleep.test.ts — ${errors.length} failure(s):`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('retiredSleep.test.ts — ok');
})();
