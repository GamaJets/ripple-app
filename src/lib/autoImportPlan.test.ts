import { autoImportPlan, mayMarkImported } from './autoImportPlan';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(m); };
const eq = (a: unknown, b: unknown, m: string) => {
  if (a !== b) errors.push(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const sm = (id: string, start: string, activity = 'Cycling') => ({ id, start, activity });
const S1 = sm('hk-1', '2026-10-14T06:00:00.000Z');
const S2 = sm('hk-2', '2026-10-13T06:00:00.000Z');
const none = new Set<string>();

/* ── the one that would duplicate a fortnight ────────────────────────────
   A failed read of the training log is an EMPTY log, so every sample looks
   new. This import is unprompted — nobody is looking at a list — so there is
   nothing between that and a second copy of every session in the member's
   record, which their coach reads and their streak counts. */
eq(autoImportPlan([S1, S2], 'error', none, []).length, 0, 'a failed log read imports nothing');
eq(autoImportPlan([S1, S2], 'loading', none, []).length, 0, 'and neither does one still in flight');
eq(autoImportPlan([S1, S2], 'partial', none, []).length, 0, 'a partial log is not a log to diff against');

/* ── a whole read is the only one that may write ─────────────────────────── */
eq(autoImportPlan([S1, S2], 'ready', none, []).length, 2, 'a whole read imports what is new');

/* ── neither of the two ways a sample is already in ──────────────────────── */
eq(autoImportPlan([S1, S2], 'ready', new Set(['hk-1']), []).map((s) => s.id).join(), 'hk-2',
  'a remembered id is not imported again');
eq(autoImportPlan([S1, S2], 'ready', none, [{ t: S1.start, exercise: 'Cycling' }]).map((s) => s.id).join(), 'hk-2',
  'and neither is one already sitting in the log at that instant');
// The queued-but-unsent case: the entry is in the log, the id is not marked.
// This is what makes leaving an unsent write unmarked safe.
eq(autoImportPlan([S1], 'ready', none, [{ t: S1.start, exercise: 'Cycling' }]).length, 0,
  'an unsent write already in the log is not written a second time while it waits');

/* ── the same instant under a different name is a different session ─────── */
eq(autoImportPlan([S1], 'ready', none, [{ t: S1.start, exercise: 'Rowing' }]).length, 1,
  'two activities at one instant are two sessions, not a duplicate');

/* ── nothing to do is not an error ───────────────────────────────────────── */
eq(autoImportPlan([], 'ready', none, []).length, 0, 'no samples is simply no import');

/* ── what may be remembered ──────────────────────────────────────────────── */
ok(mayMarkImported('stored'), 'a stored write is remembered');
ok(!mayMarkImported('unsent'), 'an unsent one is NOT — it would be struck off for good if the queue never drained');
ok(!mayMarkImported('failed'), 'nor is a refused one');
ok(!mayMarkImported(''), 'nor is an outcome we do not recognise');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('autoImportPlan: ok (a failed log read writes nothing, and only a stored write is remembered)');
