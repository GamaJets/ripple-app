// The coach's template library: what a read of it is allowed to conclude, and
// what the list on screen is rebuilt to afterwards.
//
// ── The report ─────────────────────────────────────────────────────────────
//
// "I tap to delete a template but it doesn't delete the template."
//
// The delete itself was fine. `removeTemplateFrom` counts the row with
// `{ count: 'exact' }`, runs the result through `writeFailure`, and only takes
// the template out of the list once the server has said it went — and against
// the live database (phgfwzpkkwdysftlgkoq) `program_templates` carries one ALL
// policy whose USING and WITH CHECK are both `coach_id = (select auth.uid())`,
// so a coach deleting their own template is not refused.
//
// What was not fine is what the next READ did with the answer. The list was
// rebuilt only `if (real.length)`, and zero is exactly what the server returns
// once the coach's last template is gone — so the row stayed on the screen, and
// on that screen a delete that worked and a delete that did nothing look the
// same. The first assertion below is that one, stated as a contract: a delete
// that empties the library leaves the library empty.
//
// ── Why the read is in here at all ─────────────────────────────────────────
//
// The other half of the report is a screen that latches. `reload()` sets the
// provider's status to 'loading' synchronously and then re-runs the read, so a
// read that could return without a terminal status would leave the library, the
// builder and every other screen fed by `useProgramTemplates` at 'loading' for
// the life of the process, with no error and nothing to pull. That is not an
// assertion about one branch — it is an assertion about ALL of them, which is
// why the fakes below are a matrix and the check is run over every one.
//
// Compile with tsc, run with node.
import { deleteRefusedLine, isStarterId, mergeLibrary, readLibrary, type LibraryClient, type ProgramTemplate } from './templateLibrary';
import { ROW_CAP } from './rowCap';
import type { Program } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const prog = (title: string): Program => ({ title, days: [] } as unknown as Program);
const tpl = (id: string, name = id): ProgramTemplate => ({ id, name, program: prog(name) });
const seeds = (): ProgramTemplate[] => [tpl('seed_push-pull-legs'), tpl('seed_fat-loss-circuit'), tpl('seed_tone-sculpt')];
const ids = (rows: ProgramTemplate[]) => rows.map((r) => r.id).join(',');

/**
 * A supabase-shaped client that answers one `program_templates` read.
 *
 * `session`, `user` and the row answer are separate knobs because the branches
 * they select are the ones that used to end without a status: no session at
 * all, a session whose user could not be read, and a read the policy refused.
 */
function fakeSb(opts: {
  session?: unknown;
  sessionError?: unknown;
  user?: { id?: string } | null;
  authError?: unknown;
  rows?: any[] | null;
  readError?: unknown;
  throwOn?: 'session' | 'user' | 'read';
}): { sb: LibraryClient; limits: number[] } {
  const limits: number[] = [];
  const sb: LibraryClient = {
    auth: {
      getSession: async () => {
        if (opts.throwOn === 'session') throw new Error('boom');
        return { data: { session: 'session' in opts ? opts.session : {} }, error: opts.sessionError ?? null };
      },
      getUser: async () => {
        if (opts.throwOn === 'user') throw new Error('boom');
        return { data: { user: 'user' in opts ? opts.user : { id: 'coach-1' } }, error: opts.authError ?? null };
      },
    },
    from: (_t: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: (n: number) => { limits.push(n); return chain; },
        then: (res: (v: { data: any[] | null; error: unknown }) => unknown) => {
          if (opts.throwOn === 'read') throw new Error('boom');
          return res({ data: opts.rows ?? null, error: opts.readError ?? null });
        },
      };
      return chain;
    },
  };
  return { sb, limits };
}

const row = (id: string, name: string, program: unknown = { title: name, days: [] }) => ({ id, name, program });

async function main() {
  /* ── the report: deleting the last template empties the library ────────── */
  {
    const before = [tpl('tpl_a'), ...seeds()];
    const after = mergeLibrary([], before);
    eq(ids(after), ids(seeds()), 'a server answer of zero rebuilds the library to the starters alone');
    ok(!after.some((x) => x.id === 'tpl_a'), 'the template the coach deleted is off the list');
  }

  /* ── and it is the ANSWER that decides, not its size ───────────────────── */
  {
    const before = [tpl('tpl_a'), tpl('tpl_b'), ...seeds()];
    const after = mergeLibrary([tpl('tpl_b')], before);
    eq(ids(after), 'tpl_b,' + ids(seeds()), 'one row back means one saved template, whatever was there before');
  }

  /* ── the starters are kept, and only from the previous list ────────────── */
  {
    const after = mergeLibrary([tpl('tpl_a')], seeds());
    eq(after.length, 4, 'the three starters survive a rebuild');
    ok(after.slice(1).every((x) => isStarterId(x.id)), 'the starters come after the coach’s own templates');
    ok(isStarterId('seed_x') && !isStarterId('tpl_x'), 'a starter is recognised by its id and a saved template is not');
  }
  {
    // A server that somehow answered with a seed-prefixed row must not be able
    // to double one up: the starters come from the previous list and nowhere
    // else, because they are compiled into the bundle.
    const after = mergeLibrary([tpl('seed_push-pull-legs'), tpl('tpl_a')], seeds());
    eq(after.filter((x) => x.id === 'seed_push-pull-legs').length, 1, 'a starter is never listed twice');
  }

  /* ── a save still in flight is not wiped by a read that raced it ───────── */
  {
    const before = [tpl('tpl_new'), ...seeds()];
    const after = mergeLibrary([], before, new Set(['tpl_new']));
    eq(ids(after), 'tpl_new,' + ids(seeds()), 'a template whose insert is still out stays on the list');
  }
  {
    // …and once the server has it, it is the server's copy that is listed, in
    // the server's position. Otherwise the row would appear twice.
    const before = [tpl('tpl_new'), ...seeds()];
    const after = mergeLibrary([tpl('tpl_new'), tpl('tpl_old')], before, new Set(['tpl_new']));
    eq(ids(after), 'tpl_new,tpl_old,' + ids(seeds()), 'a landed insert is not listed twice');
  }
  {
    const before = [tpl('tpl_gone'), ...seeds()];
    const after = mergeLibrary([], before, new Set(['tpl_other']));
    eq(ids(after), ids(seeds()), 'a template nobody is writing is not kept back by the pending set');
  }

  /* ── every branch of the read ends in a terminal status ────────────────── */
  const shapes: Array<{ name: string; sb: LibraryClient }> = [
    { name: 'no session', sb: fakeSb({ session: null }).sb },
    { name: 'the session could not be read', sb: fakeSb({ session: null, sessionError: { message: 'storage' } }).sb },
    { name: 'session, auth refused', sb: fakeSb({ authError: { message: 'nope' } }).sb },
    { name: 'session, no user', sb: fakeSb({ user: null }).sb },
    { name: 'session, user with no id', sb: fakeSb({ user: {} }).sb },
    { name: 'read refused', sb: fakeSb({ readError: { message: '42501' } }).sb },
    { name: 'read returned null', sb: fakeSb({ rows: null }).sb },
    { name: 'read returned nothing', sb: fakeSb({ rows: [] }).sb },
    { name: 'read returned rows', sb: fakeSb({ rows: [row('tpl_a', 'A')] }).sb },
    { name: 'getSession threw', sb: fakeSb({ throwOn: 'session' }).sb },
    { name: 'getUser threw', sb: fakeSb({ throwOn: 'user' }).sb },
    { name: 'the read threw', sb: fakeSb({ throwOn: 'read' }).sb },
  ];
  for (const s of shapes) {
    const r = await readLibrary(s.sb);
    ok(r.status !== 'loading', `${s.name}: the read must not come back still loading — the provider latches`);
    ok(['ready', 'partial', 'error'].includes(r.status), `${s.name}: reported a status of ${r.status}`);
  }

  /* ── and each of them ends in the RIGHT one ────────────────────────────── */
  {
    const r = await readLibrary(fakeSb({ session: null }).sb);
    eq(r.status, 'ready', 'no session is a true answer, not a failed check');
    eq(ids(r.rows ?? []), '', 'signed out, the starters are the whole library');
    ok(r.rows !== null, 'signed out rebuilds the list rather than leaving the last account’s work on it');
  }
  {
    // The same session-less shape, and the opposite meaning. A getSession that
    // failed must not empty the library on screen.
    const r = await readLibrary(fakeSb({ session: null, sessionError: { message: 'storage' } }).sb);
    eq(r.status, 'error', 'a session that could not be read is an error, not a signed-out phone');
    eq(r.rows, null, 'and it must not rebuild the list to the starters');
  }
  {
    const r = await readLibrary(fakeSb({ authError: { message: 'nope' } }).sb);
    eq(r.status, 'error', 'an auth error is an error');
    eq(r.rows, null, 'a failed read must not rebuild the list');
  }
  {
    const r = await readLibrary(fakeSb({ readError: { message: '42501' } }).sb);
    eq(r.status, 'error', 'a refused read is an error and not an empty library');
    eq(r.rows, null, 'a refused read must not rebuild the list');
    eq(r.uid, 'coach-1', 'the coach is still known after a refused read');
  }
  {
    const r = await readLibrary(fakeSb({ rows: [] }).sb);
    eq(r.status, 'ready', 'an empty answer from the server is ready, not error');
    eq(r.rows?.length, 0, 'and it is an ANSWER — an empty list, not null');
  }
  {
    const r = await readLibrary(fakeSb({ rows: null }).sb);
    eq(r.status, 'ready', 'a null data with no error is an empty answer');
    eq(r.rows?.length, 0, 'null data reads as no rows, not as a failure');
  }
  {
    const r = await readLibrary(fakeSb({ rows: [row('tpl_a', 'A'), { id: 'tpl_b', name: 'B', program: null }] }).sb);
    eq(r.rows?.length, 1, 'a row with no program in it is not a template');
    eq(r.rows?.[0].name, 'A', 'the template that did come back is kept');
  }
  {
    const f = fakeSb({ rows: Array.from({ length: ROW_CAP + 1 }, (_, i) => row('tpl_' + i, 'T' + i)) });
    const r = await readLibrary(f.sb);
    eq(r.status, 'partial', 'a read that came back at the ceiling is partial, never ready');
    eq(r.rows?.length, ROW_CAP, 'the probe row is not handed on as data');
    eq(f.limits[0], ROW_CAP + 1, 'the read asks for one past the cap so a full page and a truncated one differ');
  }

  /* ── the sentence a refused delete puts in front of the coach ──────────── */
  {
    const line = deleteRefusedLine('Push · Pull · Legs', 'That template was not changed.');
    ok(line.includes('Push · Pull · Legs'), 'the refusal names the template');
    ok(line.includes('still in your library'), 'the refusal says the template is still there');
    ok(line.endsWith('That template was not changed.'), 'the server’s own reason is carried through');
    ok(!deleteRefusedLine('X', null).includes('null'), 'no reason is a sentence, never the word null');
  }

  if (errors.length) {
    console.error(`templateLibrary: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('templateLibrary: ok');
}

// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('templateLibrary — threw:', e); process.exit(1); });
