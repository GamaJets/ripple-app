// The overwrite guard — the refusals, not the permissions. Compile with tsc
// then run with node.
//
// The assertion that matters here is the negative one. A test that only checked
// "'ready' is allowed" would pass against a guard that allowed everything, and
// allowing everything is precisely the bug: a coach's Assign button offered over
// a programme the screen never read, replacing somebody's training with the
// generic auto plan and reporting success.
//
// So most of what follows asserts that the three unsound statuses are each
// refused, that the refusal says what would have been lost, and that nothing
// ever reaches the coach with a placeholder in it where a client's name should
// be.
//
// Not wired into `npm test` — package.json and tsconfig.test.json belong to
// another agent this session. Run it with:
//
//   npx tsc src/lib/overwriteGuard.test.ts --outDir .tmp-overwriteguard \
//     --module node16 --moduleResolution node16 --target ES2020 --strict \
//     --ignoreConfig ; node .tmp-overwriteguard/lib/overwriteGuard.test.js
//
// `--ignoreConfig` because naming a file on the command line means tsconfig.json
// is not loaded and the current TypeScript errors rather than proceeding
// silently. It also takes @types/node with it, so the one `process.exit` at the
// bottom reports TS2591 while still emitting — hence `;` rather than `&&`. Under
// tsconfig.test.json, where this belongs, "types": ["node"] settles it.
import { guardOverwrite } from './overwriteGuard';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const SUBJECT = "Priya's current programme";
const UNSOUND: LoadStatus[] = ['loading', 'partial', 'error'];

// ── only a whole read licenses a write ──
//
// 'ready' is the single status that means the server answered and what came
// back is all of it. Every other one leaves a client's saved programme either
// unknown or possibly missing from the page that arrived, and both read at the
// call site as "nothing assigned".
ok(guardOverwrite('ready', SUBJECT).allowed, 'a whole read must let the coach save');
ok(guardOverwrite('ready', SUBJECT).reason === null, 'an allowed write must not carry a refusal to render');
ok(guardOverwrite('ready', SUBJECT).label === null, 'an allowed write must leave the control label alone');

for (const s of UNSOUND) {
  const g = guardOverwrite(s, SUBJECT);
  ok(!g.allowed, `'${s}' must not license a write over something unread`);
  ok(typeof g.reason === 'string' && g.reason.length > 0, `'${s}' must say why the control is withheld`);
  ok(typeof g.label === 'string' && g.label.length > 0, `'${s}' must give the withheld control something to say`);
  ok((g.reason as string).includes(SUBJECT), `'${s}' must name what would have been overwritten`);
  ok(!/undefined|null|\[object/i.test(`${g.reason} ${g.label}`), `'${s}' must not leak a placeholder to the coach`);
}

// ── the refusals are not interchangeable ──
//
// 'partial' and 'error' both mean the programme is unknown, but they are not
// the same event and a coach acts on them differently: one is retried, the
// other is waited out. Identical wording would have hidden that, and would also
// have let a future edit collapse the three branches into one without any test
// noticing.
const reasons = UNSOUND.map((s) => guardOverwrite(s, SUBJECT).reason as string);
ok(new Set(reasons).size === UNSOUND.length, 'each unsound status must explain itself in its own words');

// ── a held write says there is no undo ──
//
// This is the whole point of holding it. A coach who believes the save is
// reversible will find a way to make it, and there is no history table behind
// assigned_programs to recover from.
for (const s of ['partial', 'error'] as LoadStatus[]) {
  const r = guardOverwrite(s, SUBJECT).reason as string;
  ok(/no undo|cannot be undone|can’t be undone/i.test(r), `'${s}' must say the overwrite is irreversible`);
}

// 'loading' is the one refusal that is not a failure, and must not be dressed
// as one — a coach told their data could not be read while it is still in
// flight goes looking for a problem that does not exist.
const loadingReason = guardOverwrite('loading', SUBJECT).reason as string;
ok(!/could not be read|failed|no signal/i.test(loadingReason),
  'a read still in flight must not be reported to the coach as a failure');

if (errors.length) {
  console.error(`overwriteGuard.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('overwriteGuard.test: ok');
