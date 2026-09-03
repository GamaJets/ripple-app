// Who is training which saved programme, and the read that is not allowed to
// answer that question.
//
// ── The property that matters most ────────────────────────────────────────
//
// `getProgram` returns null both for a client who is on nothing and for a
// client whose row did not come back. Every count in this file is built over
// that map, so the first block below is not about arithmetic — it is that under
// 'loading', 'partial' and 'error' there is NO number anywhere in the returned
// value. A library row reading "nobody is training this" over a refused read is
// a statement about a coach's business made out of a failed query.
//
// ── And the one that would be silently wrong ──────────────────────────────
//
// `on` and `from` must never overlap. A coach told "6 clients training this
// now, and 6 on edited copies of it" about six people stops believing both
// figures, and nothing on the screen would give it away.
//
// Compile with tsc, run with node.
import { templateUsage, type UsableTemplate } from './templateUsage';
import type { Program, ProgramDay } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const day = (d: string, ...names: string[]): ProgramDay => ({
  day: d, focus: 'Upper', exercises: names.map((name) => ({ key: name, name, group: 'Chest', sets: 3, reps: '8-10', alternatives: [] })),
});
const prog = (title: string, ...days: ProgramDay[]): Program =>
  ({ title, focus: [], note: '', days });

const PPL = prog('Push · Pull · Legs', day('Mon', 'Bench Press'), day('Wed', 'Back Squat'));
const EDITED = prog('Push · Pull · Legs', day('Mon', 'Incline Dumbbell Press'), day('Wed', 'Back Squat'));
const OTHER = prog('Fat-loss Circuit', day('Tue', 'Plank'));
const tpl = (id: string, name: string, program: Program): UsableTemplate => ({ id, name, program });

/* ── nothing is counted over a read that did not come back whole ─────────── */
{
  const library = [tpl('t1', 'Push · Pull · Legs', PPL)];
  const book = { a: PPL, b: PPL, c: PPL };
  for (const status of ['loading', 'partial', 'error'] as const) {
    const u = templateUsage(library, book, status);
    ok(!!u.withheld, `${status}: a sentence says why there is no count`);
    eq(u.byId.t1.on.length, 0, `${status}: nobody is counted as on it`);
    eq(u.byId.t1.from.length, 0, `${status}: nobody is counted as on a copy of it`);
    eq(u.byId.t1.line, null, `${status}: the row carries no sentence about people`);
    ok(!/^\s*$/.test(String(u.withheld)), `${status}: the reason is a sentence`);
  }
  const loading = String(templateUsage(library, book, 'loading').withheld);
  const failed = String(templateUsage(library, book, 'error').withheld);
  const part = String(templateUsage(library, book, 'partial').withheld);
  ok(loading !== failed && failed !== part && loading !== part, 'loading, failed and truncated are three different sentences');
  ok(/not be read/.test(failed), 'a failed read says the read failed');
  eq(templateUsage(library, book, 'ready').withheld, null, 'a whole read withholds nothing');
  eq(templateUsage(library, book, 'ready').byId.t1.on.length, 3, 'a whole read counts everybody on it');
}

/* ── who is on it ───────────────────────────────────────────────────────── */
{
  const library = [tpl('t1', 'Push · Pull · Legs', PPL), tpl('t2', 'Fat-loss Circuit', OTHER)];
  const book = { ana: PPL, ben: PPL, cal: EDITED, dee: OTHER };
  const u = templateUsage(library, book, 'ready');

  eq(u.withheld, null, 'a whole read carries no withholding sentence');
  eq(u.byId.t1.on.join(','), 'ana,ben', 'the clients whose programme fingerprints identically are the ones on it');
  eq(u.byId.t1.from.join(','), 'cal', 'a client on the same title with different training is on an edited copy');
  ok(!u.byId.t1.on.includes('cal'), 'somebody on an edited copy is not also counted as on it');
  eq(u.byId.t2.on.join(','), 'dee', 'a second template counts its own people');
  eq(u.byId.t2.from.length, 0, 'a template nobody has edited has nobody on a copy of it');

  ok(!!u.byId.t1.line && u.byId.t1.line.includes('2 clients'), 'the line says how many are training it');
  ok(!!u.byId.t1.line && /edited cop/.test(u.byId.t1.line), 'the line says the edited copies are edited copies');
  ok(!!u.byId.t1.line && !/complet|finish/i.test(u.byId.t1.line), 'nothing claims anybody finished anything');
  ok(!!u.byId.t2.line && u.byId.t2.line.includes('1 client') && !u.byId.t2.line.includes('1 clients'), 'one client is not "1 clients"');
}

/* ── the template nobody is on ──────────────────────────────────────────── */
{
  const u = templateUsage([tpl('t1', 'Unused', prog('Unused', day('Fri', 'Deadlift')))], { ana: PPL }, 'ready');
  eq(u.byId.t1.on.length, 0, 'nobody is on it');
  eq(u.byId.t1.line, null, 'a template nobody is on says nothing rather than reporting an absence per row');
}

/* ── the edge cases that would otherwise invent a match ─────────────────── */
{
  // An untitled programme must not sweep up every other untitled programme.
  const blank = prog('', day('Mon', 'Bench Press'));
  const blankOther = prog('', day('Tue', 'Plank'));
  const u = templateUsage([tpl('t1', 'No name', blank)], { ana: blankOther }, 'ready');
  eq(u.byId.t1.from.length, 0, 'two untitled programmes are not copies of each other');

  // A client with no programme is in the map as nothing at all, and a null in
  // it must not fingerprint as an empty programme.
  const withNull = templateUsage([tpl('t1', 'PPL', PPL)], { ana: null as unknown as Program, ben: PPL }, 'ready');
  eq(withNull.byId.t1.on.join(','), 'ben', 'a client with no programme is not on anything');

  // An empty library and an empty book are both answerable rather than errors.
  eq(Object.keys(templateUsage([], {}, 'ready').byId).length, 0, 'an empty library has no rows');
  eq(templateUsage([tpl('t1', 'PPL', PPL)], {}, 'ready').byId.t1.line, null, 'an empty book leaves every row silent');
  eq(templateUsage(null, null, 'ready').withheld, null, 'a missing library is answered rather than thrown at');

  // Every template handed in gets an entry, under every status. A screen that
  // indexed `byId[id]` and got undefined would crash on the row.
  const all = templateUsage([tpl('t1', 'PPL', PPL), tpl('t2', 'Other', OTHER)], { ana: PPL }, 'error');
  ok(!!all.byId.t1 && !!all.byId.t2, 'every template has an entry even when the count is withheld');
}

/* ── weeks two onward are part of the fingerprint ───────────────────────── */
{
  // `programSignature` covers the whole block, so a six-week template and a
  // one-week programme that share a Monday are not the same programme. A
  // library that said otherwise would tell a coach six people were on a block
  // they had never been sent.
  const oneWeek = prog('Block', day('Mon', 'Bench Press'));
  const sixWeek: Program = { ...oneWeek, weeks: [{ days: oneWeek.days }, { days: oneWeek.days }] };
  const u = templateUsage([tpl('t1', 'Block', sixWeek)], { ana: oneWeek }, 'ready');
  eq(u.byId.t1.on.length, 0, 'a one-week programme is not the same as the block it was cut from');
  eq(u.byId.t1.from.join(','), 'ana', 'it is reported as an edited copy instead, which is what it is');
}

if (errors.length) {
  console.error(`templateUsage: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('templateUsage: ok');
