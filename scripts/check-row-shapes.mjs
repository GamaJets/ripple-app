// A row shape a cast ASSERTED but the query never produced.
//
// ── The bug this exists because of ────────────────────────────────────────
//
// The Statement of Record told a coach, for a whole year, "Marked completed:
// 0 · No-show: 0 · Late-cancelled: 0 · Cancelled: 0", and then, underneath,
// "248 sessions could not be dated and are in no period at all". Both
// sentences were composed correctly from the rows the screen actually held.
// The rows were the problem: the read selected `starts_at`, `StatementSession`
// declares `startsAt`, and `splitByDay` splits on `r.startsAt`. Every row
// carried `undefined` where its date should be, so every session fell into
// `undated` and none into any period.
//
// It reached a device — and an accountant-facing document — because of this,
// on the line under the select:
//
//     .range(f, t) as unknown as PromiseLike<{ data: StatementSession[] | null; error: unknown }>
//
// `as unknown as` is a two-step cast: it launders the Supabase builder's real
// type through `unknown` so the compiler will accept ANY destination. It does
// not derive the row shape from the query, it ASSERTS it, and an assertion
// cannot be wrong at compile time. tsc was not failing to notice; it had been
// told not to look.
//
// The cast is not itself a defect and this gate does not ban it. The generated
// Supabase types do not describe a `.range()` builder in a form `paged` can
// accept, and the alternative — `any` — would lose the row type downstream
// too. What the cast costs is that ONE correspondence, select-string to
// interface, is now maintained by hand. So it gets checked by hand, here,
// mechanically.
//
// ── What is checked ───────────────────────────────────────────────────────
//
// For every `paged<SomeInterface>(...)` whose rows are NOT run through a
// mapper: parse its `.select('...')` string into the field names PostgREST
// will actually put on each row, look up `SomeInterface`, and require that
// every field the interface declares as REQUIRED is one of them.
//
// A read whose `.then` maps the rows (`.map(toInvoice)`) is skipped on
// purpose: there the mapper is the correspondence, it is ordinary typed code,
// and tsc checks it properly.
//
// ── Why "required fields are produced" and not set equality ───────────────
//
// Selecting a column the interface does not declare is legal and sometimes
// deliberate — a column selected to make an `.order()` stable, say. Failing to
// produce a field something downstream will read is the defect, and an
// optional field is by definition one the code is written to survive without.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];

/** Every .ts/.tsx file under a directory, recursively. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const files = [...walk('src/ui'), ...walk('src/lib')];

/**
 * The field names a PostgREST select string puts on each returned row.
 *
 * `a, b:c` gives ['a', 'b'] — an alias is the name the ROW carries, which is
 * the whole point of writing one. Returns null for a select this parser does
 * not claim to understand (an embedded resource, a `*`, a computed cast), so
 * the caller can skip rather than guess: a gate that guesses is worse than no
 * gate, because it fails on correct code and gets deleted.
 */
function selectedNames(sel) {
  if (sel.includes('(') || sel.includes('*') || sel.includes('::')) return null;
  const names = [];
  for (const raw of sel.split(',')) {
    const term = raw.trim();
    if (!term) continue;
    const alias = term.includes(':') ? term.split(':')[0].trim() : term;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) return null;
    names.push(alias);
  }
  return names;
}

/**
 * The fields an interface declares, split by whether they are required.
 *
 * Deliberately a brace-counting scan rather than a regex over the whole body:
 * an interface with a nested object field would otherwise end at the wrong
 * brace and report fields that are not its own.
 */
function interfaceFields(src, name) {
  const open = src.indexOf(`interface ${name} {`);
  if (open < 0) return null;
  let i = src.indexOf('{', open);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start + 1, i);
  const required = [], optional = [];
  // Only top-level members: a member nested inside a field's own object type
  // is not a field of this interface.
  let d = 0;
  for (const line of body.split('\n')) {
    const before = d;
    for (const ch of line) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (before !== 0) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:/);
    if (m) (m[2] ? optional : required).push(m[1]);
  }
  return { required, optional };
}

// Every interface declared anywhere under src/, by name — as a LIST of files,
// not one file. Row shapes live in src/lib beside the pure code that consumes
// them while the reads that produce them live in src/ui, so the lookup has to
// span both; but short names are reused, and the first draft of this gate
// resolved a `Row` declared locally inside coachStatement.ts to an unrelated
// `Row` in glucoseData.ts and reported five missing blood-sugar fields on a
// refunds query. So: a name declared in the reading file wins, a name declared
// in exactly one file is used, and an ambiguous name is skipped rather than
// guessed at.
const declaredIn = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
    if (!declaredIn.has(m[1])) declaredIn.set(m[1], []);
    if (!declaredIn.get(m[1]).includes(f)) declaredIn.get(m[1]).push(f);
  }
}

/** Which file's declaration of `name` a read in `from` means, or null. */
function resolveDecl(name, from) {
  const where = declaredIn.get(name);
  if (!where) return null;
  if (where.includes(from)) return from;
  return where.length === 1 ? where[0] : null;
}

let checked = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('paged<')) continue;

  for (const m of src.matchAll(/paged<([A-Za-z_][A-Za-z0-9_]*)>\(/g)) {
    const typeName = m[1];
    // `unknown`, `any` and a locally-declared `Row` all mean the author is
    // about to map the rows themselves. Nothing downstream reads a field off
    // the raw row, so there is no correspondence to keep.
    if (typeName === 'unknown' || typeName === 'any') continue;

    // The call's own text, to the end of the argument list. Brace/paren
    // counting again rather than a lazy `.*?\)`, because the callback contains
    // plenty of both.
    let i = src.indexOf('(', m.index + m[0].length - 1);
    let depth = 0, end = i;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')') { depth--; if (depth === 0) break; }
    }
    const call = src.slice(m.index, end + 1);
    // A `.then(... .map(...))` immediately after the call is a mapper, and the
    // mapper is ordinary typed code that tsc already checks properly.
    const after = src.slice(end + 1, end + 200);
    if (/^\s*\.then\s*\(/.test(after) && after.includes('.map(')) continue;

    const sel = call.match(/\.select\(\s*'([^']*)'\s*\)/);
    if (!sel) continue;
    const names = selectedNames(sel[1]);
    if (names === null) continue;

    const declFile = resolveDecl(typeName, file);
    if (!declFile) continue;
    const fields = interfaceFields(readFileSync(declFile, 'utf8'), typeName);
    if (!fields) continue;

    checked++;
    const missing = fields.required.filter((f) => !names.includes(f));
    if (missing.length) {
      const line = src.slice(0, m.index).split('\n').length;
      errors.push(
        `${file}:${line} — paged<${typeName}> selects '${sel[1]}', which produces rows with ` +
        `no ${missing.map((x) => `\`${x}\``).join(', ')}. ` +
        `${typeName} (${declFile}) declares ${missing.length === 1 ? 'that field' : 'those fields'} as required, ` +
        `and the cast on this read asserts the shape rather than deriving it, so tsc will not catch this. ` +
        `Either alias the column in the select (\`${missing[0]}:some_column\`) or map the rows in a .then.`,
      );
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`\ncheck:row-shapes — ${errors.length} read${errors.length === 1 ? '' : 's'} would hand a row a field it does not have.`);
  process.exit(1);
}
console.log(`check:row-shapes ok — ${checked} unmapped paged read${checked === 1 ? '' : 's'} produce every field their row type requires.`);
