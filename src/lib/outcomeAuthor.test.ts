// Who recorded a session's outcome. Compile with tsc, run with node.
//
// The assertions here are all about what this feature REFUSES to say, because
// every way it can be wrong is a sentence that sounds authoritative:
//
//   · "Nobody is recorded as having marked this" over a read that failed is an
//     accusation about a gym's records, made by an empty Map.
//   · An author line under a session the server has no outcome for is a
//     signature on a statement that is still sitting in the floor queue on this
//     phone.
//   · "Marked by somebody else" where the name merely could not be read, versus
//     "nobody is recorded", are two different facts and a coach disputing a
//     payroll line acts differently on each.
import { fetchOutcomeAuthors, markedByLine, type OutcomeAuthor } from './outcomeAuthor';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ME = 'coach-1';
const names = new Map<string, string>([['coach-1', 'Dana Reid'], ['coach-2', 'Sam Okoye']]);
const marked = (by: string | null): OutcomeAuthor => ({ markedOnServer: true, by });

/* ── the four things it will say ──────────────────────────────────────────── */

eq(markedByLine(marked(ME), 'ready', ME, names), 'You marked this.',
  'the coach reading their own mark is told so, and no name is needed for it');
eq(markedByLine(marked('coach-2'), 'ready', ME, names), 'Marked by Sam Okoye.',
  'a colleague whose profile this coach may read is named');
ok((markedByLine(marked('owner-9'), 'ready', ME, names) ?? '').includes('somebody else'),
  'an author whose name RLS refuses is still an author — an id was recorded and the name was not readable');
ok((markedByLine(marked(null), 'ready', ME, names) ?? '').startsWith('Nobody is recorded'),
  'a marked session with a null author says nobody signed it, which is what the column holds');

/* ── and the four it refuses to ───────────────────────────────────────────── */

eq(markedByLine(marked(ME), 'loading', ME, names), null,
  'nothing is said while the read is in flight — silence, not a guess');
ok((markedByLine(marked(ME), 'error', ME, names) ?? '').includes('couldn’t be read'),
  'a refused read says the read failed and never that nobody marked it');
eq(markedByLine(undefined, 'ready', ME, names), null,
  'a session missing from the answer is unknown, and unknown is not unsigned');
eq(markedByLine(undefined, 'partial', ME, names), null,
  'the same under a capped read, where a missing row is the cap and nothing else');
eq(markedByLine({ markedOnServer: false, by: null }, 'ready', ME, names), null,
  'a session the SERVER holds no outcome for gets no author line — the screen may be '
  + 'drawing one off a write still queued on this phone, and nobody has signed that yet');

/* ── a null viewer is not a match ─────────────────────────────────────────── */
//
// `uid` is null on this screen while auth settles. `null === null` would make
// every unsigned row read "You marked this", which is the app putting the
// coach's name on a mark they may not have made.

eq(markedByLine(marked(null), 'ready', null, names)?.startsWith('Nobody is recorded'), true,
  'a signed-out viewer does not match a null author');

/* ── the read ─────────────────────────────────────────────────────────────── */

type Row = { id: string; outcome: string | null; outcome_by: string | null };
function fakeDb(rows: Row[], profiles: Array<{ id: string; full_name: string | null }>,
  opts: { sessionError?: unknown; profileError?: unknown } = {}) {
  const q = (table: string) => {
    const state: { ids: string[] } = { ids: [] };
    const self: any = {
      select: () => self,
      order: () => self,
      limit: () => self,
      in: (_col: string, ids: string[]) => { state.ids = ids; return self; },
      then: (res: (v: { data: any[] | null; error: unknown }) => unknown) => {
        if (table === 'sessions') {
          if (opts.sessionError) return Promise.resolve({ data: null, error: opts.sessionError }).then(res);
          return Promise.resolve({ data: rows.filter((r) => state.ids.includes(r.id)), error: null }).then(res);
        }
        if (opts.profileError) return Promise.resolve({ data: null, error: opts.profileError }).then(res);
        return Promise.resolve({ data: profiles.filter((p) => state.ids.includes(p.id)), error: null }).then(res);
      },
    };
    return self;
  };
  return { from: q };
}

void (async () => {
  const db = fakeDb(
    [
      { id: 's1', outcome: 'completed', outcome_by: 'coach-1' },
      { id: 's2', outcome: 'no_show', outcome_by: 'owner-9' },
      { id: 's3', outcome: null, outcome_by: null },
      { id: 's4', outcome: 'completed', outcome_by: null },
    ],
    [{ id: 'coach-1', full_name: 'Dana Reid' }],
  );
  const out = await fetchOutcomeAuthors(db, ['s1', 's2', 's3', 's4']);
  eq(out.status, 'ready', 'a read that came back whole is ready');
  eq(out.bySession.get('s1')?.by, 'coach-1', 'the author id is carried through as it is stored');
  eq(out.bySession.get('s3')?.markedOnServer, false,
    'a row with no outcome is recorded as unmarked on the server, not as an author-less mark');
  eq(out.bySession.get('s4')?.markedOnServer, true, 'a marked row with no author is still marked');
  eq(out.bySession.get('s4')?.by, null, 'and its author is null rather than invented');
  eq(out.names.get('coach-1'), 'Dana Reid', 'a readable profile supplies the name');
  eq(out.names.has('owner-9'), false, 'a profile RLS refuses contributes no name and no placeholder');

  // The whole point of the status. A refused read must not produce a map that
  // answers "nobody" for every session in it.
  const refused = await fetchOutcomeAuthors(
    fakeDb([], [], { sessionError: new Error('permission denied') }), ['s1']);
  eq(refused.status, 'error', 'a refused read says so');
  eq(refused.bySession.size, 0, 'and carries no rows to be misread as answers');
  eq(markedByLine(refused.bySession.get('s1'), refused.status, ME, refused.names)?.includes('couldn’t be read'),
    true, 'which the line then reports as a failed read rather than as an unsigned session');

  // A names read that fails leaves the authors standing. "You marked this"
  // needs no name, and losing it because somebody else's profile was refused
  // would be the second read taking the first one down with it.
  const noNames = await fetchOutcomeAuthors(
    fakeDb([{ id: 's1', outcome: 'completed', outcome_by: 'coach-1' }], [],
      { profileError: new Error('permission denied') }), ['s1']);
  eq(noNames.status, 'ready', 'the sessions read succeeded, so the answer is ready');
  eq(noNames.bySession.get('s1')?.by, 'coach-1', 'and the author survives');
  eq(markedByLine(noNames.bySession.get('s1'), noNames.status, ME, noNames.names), 'You marked this.',
    'the coach is still told they marked it, with no name involved');

  // No ids is not a read at all.
  const none = await fetchOutcomeAuthors(fakeDb([], []), []);
  eq(none.status, 'ready', 'an empty id list is a whole answer about nothing');
  eq(none.bySession.size, 0, 'with nothing in it');

  if (errors.length) {
    console.error(`outcomeAuthor: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('outcomeAuthor: ok');
})();
