#!/usr/bin/env node
// Do the app, the repo and the live database agree about what the columns are?
//
// Three things have to say the same thing, and each pair has already been found
// disagreeing:
//
//   the app        the columns .select/.insert/.update/.upsert name
//   the repo       what supabase/parts/*.sql builds, bundled into setup.sql
//   the database   what is actually there
//
// APP vs DATABASE. On 27 Aug 2026 no workout saved for two days, for anybody,
// from any app. `supabase/parts/46-session-duration.sql` adds
// `workouts.session_mins`; it was written, committed, generated into setup.sql,
// and never run. PostgREST rejects the whole row for one unknown column. It was
// found by logging a workout in a simulator.
//
// APP vs REPO. On 29 Aug 2026 `clients` was found carrying five columns —
// injuries, focus_areas, manual_weight_kg, manual_body_fat_pct, manual_at —
// that live in production and were declared in no file in this repo. They were
// added by hand and never written down. src/ui/clientData.tsx selects and
// updates all five, so on any database built from this repo — a new
// environment, a staging copy, a local stack — the profile write fails
// entirely and silently: name, goal, diet, allergens and manual weight lost
// together, having looked saved. Production was fine by accident of history.
//
// The first version of this file could only have caught the first of those, and
// only because somebody had remembered to add `workouts` to a hand-written list
// of ten tables. `clients` — the most-written table in the product — was not on
// it. A list somebody has to remember to extend is a list that is wrong the day
// after it is written, so nothing here is hand-maintained: the tables and
// columns come from reading the source, and the declarations from reading the
// SQL.
//
// ── How the live database is asked ─────────────────────────────────────────
//
// It needs no secret. PostgREST answers a schema question with the publishable
// key alone, because the answer arrives before any row is read.
//
//     known column          200 or 401   the query was valid; RLS refused the ROWS
//     unknown column        400          with 42703 and the column's name
//     unknown table         404
//
// A 401 is therefore a PASS. That reads backwards and is the whole trick. It
// works because Postgres resolves every name while planning, long before a
// policy gets a chance to refuse anything.
//
// The one thing a publishable key cannot do is ENUMERATE. It can confirm or
// deny any name it is given, so every column the repo declares and every column
// the app names is checked in both directions — but a live column that neither
// the repo nor the app mentions cannot be asked about, because nothing here
// knows to ask. Set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) and the
// live schema is listed outright and that last gap closes. Without it the
// summary says how many tables were only spot-checked, rather than claiming a
// coverage it does not have.
//
//     node scripts/check-schema.mjs            the whole check
//     node scripts/check-schema.mjs --offline   app vs repo only, no credentials
//
// Exit codes: 0 agreed, 1 they disagree, 78 the live half could not be run
// because the credentials were absent — which is not a pass and not a failure.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OFFLINE = process.argv.includes('--offline');
// What is covered, table by table, for anyone who wants to see it rather than
// take it on trust. The old version of this file kept a hand-written list of
// ten tables in plain sight; this prints the derived one.
const LIST = process.argv.includes('--list');

// Everything that talks to PostgREST. The edge functions are in here because
// they write to the same tables through the same protocol and fail the same
// way; being server-side buys them nothing.
const CODE_ROOTS = [
  'src', 'app',
  'studio-web/app', 'studio-web/lib', 'studio-web/components',
  'supabase/functions',
];
const SETUP_SQL = 'supabase/setup.sql';

// ═══════════════════════════════════════════════════════════════════════════
// Reading text that contains code
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Replaces every comment with spaces, keeping every other character where it
 * was so that offsets and line numbers still mean something. Comments have to
 * go before anything else looks at the text: src/lib/gdpr.ts documents itself
 * with `await supabase.from(tbl).select('*')` in a comment, and a scanner that
 * cannot tell that from a query reports a table that no code ever touches.
 */
function blankJsComments(src) {
  const out = src.split('');
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; }
    } else if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      out[i] = ' '; out[i + 1] = ' '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i);
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Index just past the string (or template literal) that starts at `i`. */
function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    // A `${…}` can hold anything, brackets and quotes included, so it is walked
    // rather than scanned for the closing backtick.
    if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      i = readBalanced(src, i + 1);
      continue;
    }
    i++;
  }
  return i;
}

/** Index just past the bracket at `i` and everything it encloses. */
function readBalanced(src, i) {
  const open = src[i];
  const close = { '(': ')', '{': '}', '[': ']' }[open];
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (!depth) return i + 1; }
    i++;
  }
  return i;
}

/** Splits on a separator that is not inside a bracket or a string. */
function splitTopLevel(text, sep = ',') {
  const parts = [];
  let start = 0, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '(' || c === '{' || c === '[') { i = readBalanced(text, i); continue; }
    if (c === sep) { parts.push(text.slice(start, i)); start = i + 1; }
    i++;
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The literal value if `text` is a plain quoted string and nothing else. */
function stringLiteral(text) {
  const t = text.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  if (skipString(t, 0) !== t.length) return null;      // 'a' + b, or a template with a hole
  if (q === '`' && t.includes('${')) return null;
  return t.slice(1, -1);
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// ═══════════════════════════════════════════════════════════════════════════
// What the app names
// ═══════════════════════════════════════════════════════════════════════════

const used = new Map();        // table -> Map(column -> "file:line")
const unreadable = [];         // places this file admits it cannot read

function noteColumn(table, column, where) {
  if (!table || !column) return;
  if (!used.has(table)) used.set(table, new Map());
  if (!used.get(table).has(column)) used.get(table).set(column, where);
}

/**
 * The keys of an object literal, the expressions it spreads in, and an honest
 * account of anything else. A computed key means the row carries a column whose
 * name is not written down anywhere, and half a row silently reported as a
 * whole one is the exact failure this check exists to prevent.
 */
function objectKeys(text) {
  const body = text.trim();
  if (!body.startsWith('{')) return { keys: [], spreads: [], gaps: ['not an object literal'] };
  const keys = [], spreads = [], gaps = [];
  for (const item of splitTopLevel(body.slice(1, -1))) {
    if (item.startsWith('...')) { spreads.push(item.slice(3).trim()); continue; }
    if (item.startsWith('[')) { gaps.push('a computed key'); continue; }
    const q = item[0];
    if (q === '"' || q === "'" || q === '`') {
      const end = skipString(item, 0);
      const name = stringLiteral(item.slice(0, end));
      if (name && item.slice(end).trim().startsWith(':')) keys.push(name);
      else gaps.push(`a key this cannot read: ${item.slice(0, 24)}`);
      continue;
    }
    // `{ goal, diet }` is shorthand: the identifier is the column name too.
    const m = /^([A-Za-z_$][\w$]*)\s*(:|$)/.exec(item);
    if (m) keys.push(m[1]);
    else gaps.push(`a key this cannot read: ${item.slice(0, 24).replace(/\s+/g, ' ')}`);
  }
  return { keys, spreads, gaps };
}

/**
 * Reading a file once, blanked of its comments, with its string constants to
 * hand. app/(trainer)/checklists.tsx passes `.select(COLS)`, and a select list
 * that arrives by name is still a select list.
 */
const sources = new Map();
function sourceOf(file) {
  if (!sources.has(file)) {
    let code = '';
    try { code = blankJsComments(readFileSync(file, 'utf8')); } catch { /* nothing to follow */ }
    const consts = new Map();
    for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*('[^'\n]*'|"[^"\n]*")/g)) {
      consts.set(m[1], m[2].slice(1, -1));
    }
    sources.set(file, { code, consts });
  }
  return sources.get(file);
}

/** A select list written as `'a, b, ' + 'c'`, or as a named constant. */
function stringExpr(text, consts) {
  let out = '';
  for (const piece of splitTopLevel(text, '+')) {
    const lit = stringLiteral(piece);
    if (lit != null) { out += lit; continue; }
    const named = consts.get(piece.trim());
    if (named != null) { out += named; continue; }
    return null;
  }
  return out;
}

function moduleFile(spec, from) {
  let base;
  if (spec.startsWith('.')) base = join(dirname(from), spec);
  else if (spec.startsWith('@lib/')) base = join('src/lib', spec.slice(5));
  else return null;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    try { if (statSync(base + ext).isFile()) return base + ext; } catch { /* try the next */ }
  }
  return null;
}

/**
 * Where `name` is defined: the text just after its `=`, or the body of its
 * `function`. Looks in the file that uses it and then along a relative import,
 * and no further — one hop is what the row builders in this codebase need.
 */
function definitionOf(name, file) {
  const { code } = sourceOf(file);
  const decl = new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`, 'm').exec(code);
  if (decl) return { text: code.slice(decl.index + decl[0].length), file };
  const fn = new RegExp(`(?:^|[^\\w$.])(?:async\\s+)?function\\s+${name}\\s*(?:<[^>]*>)?\\s*\\(`, 'm').exec(code);
  if (fn) {
    const params = readBalanced(code, fn.index + fn[0].length - 1);
    const brace = code.indexOf('{', params);
    if (brace !== -1) return { body: code.slice(brace, readBalanced(code, brace)), file };
  }
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim());
    if (!names.includes(name)) continue;
    const target = moduleFile(m[2], file);
    if (target) return definitionOf(name, target);
  }
  return null;
}

/** The `return X` statements of a function body, ignoring any nested function's. */
function topLevelReturns(body) {
  const out = [];
  let i = 1;
  while (i < body.length - 1) {
    const c = body[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(body, i); continue; }
    if (c === '(' || c === '{' || c === '[') { i = readBalanced(body, i); continue; }
    if (/[A-Za-z_$]/.test(c) && !/[\w$.]/.test(body[i - 1] ?? ' ')) {
      const m = /^return\b\s*/.exec(body.slice(i));
      if (m) { out.push(body.slice(i + m[0].length)); i += m[0].length; continue; }
      i += /^[\w$]+/.exec(body.slice(i))[0].length; continue;
    }
    i++;
  }
  return out;
}

/** Every object literal at the top level of `text` — the two arms of a ternary. */
function objectLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(text, i); continue; }
    if (c === '{') { const end = readBalanced(text, i); out.push(text.slice(i, end)); i = end; continue; }
    if (c === '(' || c === '[') { i = readBalanced(text, i); continue; }
    i++;
  }
  return out;
}

/**
 * A PostgREST select list. Embedded resources belong to the embedded table, so
 * `id, profiles(full_name)` is one column of this table and one of profiles.
 */
function selectColumns(list, table, add) {
  for (const raw of splitTopLevel(list)) {
    let item = raw.trim();
    if (!item || item === '*' || item === 'count') continue;
    // `client:clients(id)` and `newest:taken_at` — the alias is ours, not the
    // database's; what follows the colon is the real name.
    const alias = /^[A-Za-z_$][\w$]*\s*:\s*(.+)$/s.exec(item);
    if (alias) item = alias[1].trim();
    const embed = /^([A-Za-z_][\w]*)(?:!\w+)?\s*\(([\s\S]*)\)$/.exec(item);
    if (embed) { selectColumns(embed[2], embed[1], add); continue; }
    item = item.replace(/::[\w\s]+$/, '').trim();          // a cast
    if (/^[A-Za-z_][\w]*$/.test(item)) add(table, item);
    else add(null, null, `select item "${item.slice(0, 40)}"`);
  }
}

// The chain methods whose first argument is a column name. They are read only
// inside a chain that began at .from(), so there is no chance of mistaking
// Array.prototype.filter for a PostgREST filter.
const FILTERS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'overlaps', 'order', 'not',
]);
const WRITES = new Set(['insert', 'update', 'upsert']);

function scanFile(file) {
  const { code, consts } = sourceOf(file);

  for (const m of code.matchAll(/\.\s*from\s*\(/g)) {
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    // Array.from(...) is not a query, and .storage.from(...) names a bucket.
    if (/(?:^|[^\w$])Array\s*\.\s*$/.test(before)) continue;
    if (/storage\s*\.\s*$/.test(before)) continue;

    const open = m.index + m[0].length - 1;
    const end = readBalanced(code, open);
    const table = stringLiteral(code.slice(open + 1, end - 1));
    const where = `${file}:${lineOf(code, m.index)}`;

    // Walk the rest of the chain: .select(…).eq(…).order(…) and so on.
    const claims = [];      // [table|null, column|null, unreadable-description]
    const add = (t, c, why) => claims.push([t, c, why]);
    let i = end;
    for (;;) {
      const rest = code.slice(i);
      const step = /^\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest);
      if (!step) break;
      const argOpen = i + step[0].length - 1;
      const argEnd = readBalanced(code, argOpen);
      const args = splitTopLevel(code.slice(argOpen + 1, argEnd - 1));
      const name = step[1];
      i = argEnd;

      if (name === 'select') {
        if (!args.length) continue;                        // .select() is *
        const list = stringExpr(args[0], consts);
        if (list == null) { add(null, null, `.select(${args[0].slice(0, 30)})`); continue; }
        selectColumns(list, table, add);
      } else if (WRITES.has(name)) {
        if (!args.length) { add(null, null, `.${name}() with no row`); continue; }
        readRow(args[0], table, name, add, file, 0);
        // `.upsert(row, { onConflict: 'coach_id,name' })` names columns too, and
        // a wrong one there fails the write exactly as a wrong one in the row.
        const conflict = args[1] && /onConflict\s*:\s*'([^']*)'/.exec(args[1]);
        if (conflict) for (const c of conflict[1].split(',')) add(table, c.trim());
      } else if (FILTERS.has(name) && args.length) {
        const col = stringLiteral(args[0]);
        // Anything that is not a bare column — a json path, a computed name —
        // is left alone rather than guessed at.
        if (col && /^[A-Za-z_][\w]*$/.test(col)) add(table, col);
      }
    }

    if (!claims.length) continue;
    if (!table) {
      unreadable.push(`${where}  .from(${code.slice(open + 1, end - 1).trim().slice(0, 24)}) — the table is a variable`);
      continue;
    }
    for (const [t, c, why] of claims) {
      if (why) unreadable.push(`${where}  ${why} — on ${table}`);
      else noteColumn(t, c, where);
    }
  }
}

/**
 * The columns a written row carries, or an admission that they cannot be had.
 *
 * Half the writes in this codebase hand .insert() something assembled
 * elsewhere: `entryToRow(uid, e)`, `row(tenantId, c)`, a `patch` object filled
 * a field at a time. Refusing to look inside would leave the most-written
 * tables unchecked — `workouts` among them, and entryToRow is the very function
 * the missing `session_mins` was passing through. So a definition in the same
 * file, or one imported over a relative path, is followed and read the same
 * way. Two hops, and then it says it cannot see.
 */
function readRow(arg, table, method, add, file, depth) {
  // A definition is followed by handing back everything after its `=` or its
  // `return`, so the expression has to be cut out of what comes next.
  const text = splitTopLevel(arg.trim(), ';')[0].trim().replace(/\s+as\s+[\w<>[\]{}|,.\s]+$/, '');
  const again = (t, f = file) => readRow(t, table, method, add, f, depth + 1);
  const giveUp = (why) => add(null, null, `.${method}(${text.slice(0, 40).replace(/\s+/g, ' ')}) — ${why}`);
  if (depth > 6) return giveUp('followed as far as this goes');
  if (!text) return giveUp('the row is an expression this cannot read');

  if (text.startsWith('{')) {
    const { keys, spreads, gaps } = objectKeys(text.slice(0, readBalanced(text, 0)));
    for (const k of keys) add(table, k);
    for (const s of spreads) again(s);
    for (const g of gaps) add(null, null, `.${method}({…}) carries ${g}`);
    return;
  }
  // `.insert([{…}, {…}])` — every row in the array is checked.
  if (text.startsWith('[')) {
    const rows = splitTopLevel(text.slice(1, readBalanced(text, 0) - 1));
    // `const rows: any[] = []` filled by rows.push(…) later. Nothing is read
    // from an empty array, and reading nothing must never look like reading it.
    if (!rows.length) return giveUp('the rows are pushed into an empty array');
    for (const row of rows) again(row);
    return;
  }
  // `...(expiresAt ? { expires_at: expiresAt } : {})` — a spread of a ternary,
  // which is how a row leaves a column out rather than nulling it.
  if (text.startsWith('(')) {
    const inner = text.slice(1, readBalanced(text, 0) - 1);
    const objects = objectLiterals(inner);
    if (objects.length) { for (const o of objects) again(o); return; }
    return again(inner);
  }
  // `rows.map((e) => entryToRow(uid, e))` — the handler returns the row.
  const mapped = /^[\w$.[\]]*\.\s*map\s*\(/.exec(text);
  if (mapped) {
    const open = mapped.index + mapped[0].length - 1;
    const handler = text.slice(open + 1, readBalanced(text, open) - 1);
    const arrow = /=>/.exec(handler);
    if (arrow) return again(handler.slice(arrow.index + 2));
    return giveUp('the rows come from a handler this cannot read');
  }

  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(text);
  const name = call?.[1] ?? /^([A-Za-z_$][\w$]*)$/.exec(text)?.[1];
  if (!name) return giveUp('the row is an expression this cannot read');

  const def = definitionOf(name, file);
  if (!def) return giveUp(`${name} is defined somewhere this cannot follow`);
  const readReturns = (block) => {
    const returns = topLevelReturns(block);
    if (!returns.length) return giveUp(`${name} returns something this cannot read`);
    for (const r of returns) again(r, def.file);
  };
  if (def.body) return readReturns(def.body);       // function name(…) { … }

  const value = def.text.trimStart();
  // `const entryToRow = (uid, e): WorkoutRow => ({ … })`
  const fat = /^(?:async\s*)?(?:\([\s\S]*?\)|[A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=>\s*/.exec(value);
  if (fat && call) {
    const after = value.slice(fat[0].length);
    if (after.startsWith('{')) return readReturns(after.slice(0, readBalanced(after, 0)));
    return again(after, def.file);
  }
  if (fat) return giveUp(`${name} is a function, not a row`);

  if (value.startsWith('{')) {
    again(value.slice(0, readBalanced(value, 0)), def.file);
    // `const row: Record<string, unknown> = {}` filled in afterwards by
    // `row.starts_at = …`. The assignments are the row.
    const { code } = sourceOf(def.file);
    for (const m of code.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)`, 'g'))) add(table, m[1]);
    if (new RegExp(`\\b${name}\\s*\\[`).test(code)) add(null, null, `${name} is also given a computed key`);
    return;
  }
  // `const rows = entries.map(…)` — the initialiser is the row, one step on.
  again(value, def.file);
}

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
}
for (const r of CODE_ROOTS) { try { walk(r); } catch { /* a root that is not there yet */ } }
// A check that inspects nothing passes every time; check-reads.mjs once did
// exactly that for a whole afternoon.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}
for (const f of files) scanFile(f);
if (!used.size) {
  console.error('read the source and found no table at all, which is not a pass.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// What the repo declares
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Blanks SQL comments and string bodies, and hands back the dollar-quoted
 * blocks separately. Function bodies are blanked because a `create table` in a
 * comment inside one is not a declaration — but they are kept to one side and
 * searched afterwards, because DDL assembled with execute format() IS a
 * declaration and this parser cannot read one.
 */
function blankSql(src) {
  const out = src.split('');
  const dollarBlocks = [];
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to && k < src.length; k++) if (src[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    if (src[i] === '-' && src[i + 1] === '-') {
      const nl = src.indexOf('\n', i);
      blank(i, nl === -1 ? src.length : nl);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const to = close === -1 ? src.length : close + 2;
      blank(i, to); i = to; continue;
    }
    if (src[i] === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") { j += 2; continue; }
        if (src[j] === "'") { j++; break; }
        j++;
      }
      blank(i, j); i = j; continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(src.slice(i, i + 32));
    if (tag) {
      const close = src.indexOf(tag[0], i + tag[0].length);
      const to = close === -1 ? src.length : close + tag[0].length;
      dollarBlocks.push({ at: i, text: src.slice(i, to) });
      blank(i, to); i = to; continue;
    }
    i++;
  }
  return { code: out.join(''), dollarBlocks };
}

const declared = new Map();     // table -> Map(column -> part file)
const opaque = new Map();       // table -> why its columns cannot be listed
const unparsed = [];            // SQL this file admits it does not understand

function declare(table, column, part) {
  if (!declared.has(table)) declared.set(table, new Map());
  if (!declared.get(table).has(column)) declared.get(table).set(column, part);
}

// Table constraints share the comma-separated list with columns and are not
// columns. `constraint`, `primary`, `unique`, `foreign`, `check`, `exclude`.
const NOT_A_COLUMN = /^(constraint|primary|unique|foreign|check|exclude|like)\b/i;
const bare = (name) => name.replace(/"/g, '').trim();

function parseSetup(raw) {
  const { code, dollarBlocks } = blankSql(raw);

  // scripts/build-supabase-setup.mjs writes `-- ▶ name.sql` above each part, so
  // a column can be traced back to the file that adds it.
  const marks = [...raw.matchAll(/^-- ▶ (.+\.sql)$/gm)].map((m) => ({ at: m.index, part: m[1] }));
  const partAt = (index) => {
    let name = SETUP_SQL;
    for (const m of marks) { if (m.at > index) break; name = `supabase/parts/${m.part}`; }
    return name;
  };

  // A qualified name in another schema is not ours to check; PostgREST only
  // exposes public.
  const publicName = (name) => {
    const n = bare(name);
    if (!n.includes('.')) return n;
    const [schema, rest] = n.split('.');
    return schema === 'public' ? rest : null;
  };

  for (const m of code.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w".]+)\s*\(/gi)) {
    const table = publicName(m[1]);
    const open = m.index + m[0].length - 1;
    const body = code.slice(open + 1, readBalanced(code, open) - 1);
    if (!table) continue;
    for (const item of splitTopLevel(body)) {
      if (NOT_A_COLUMN.test(item)) continue;
      const name = /^("[^"]+"|[A-Za-z_][\w]*)/.exec(item);
      if (name) declare(table, bare(name[1]), partAt(m.index));
    }
  }

  // One statement may add several columns —
  //
  //     alter table public.coach_requests
  //       add column if not exists source    text,
  //       add column if not exists via_code  text;
  //
  // so the whole statement is taken and every clause in it read. A regex that
  // stopped at the first clause reported `via_code` as undeclared when part 56
  // declares it three lines further down.
  for (const m of code.matchAll(/\balter\s+table\s+(?:only\s+)?([\w".]+)\b/gi)) {
    const table = publicName(m[1]);
    if (!table) continue;
    const semi = code.indexOf(';', m.index);
    const stmt = code.slice(m.index, semi === -1 ? code.length : semi);
    for (const c of stmt.matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[A-Za-z_][\w]*)/gi)) {
      declare(table, bare(c[1]), partAt(m.index));
    }
  }

  // A view's columns come out of a select list this parser does not read. Its
  // name is recorded so that reading one is not mistaken for reading a table
  // the repo never declared.
  for (const m of code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+([\w".]+)/gi)) {
    const view = publicName(m[1]);
    if (view) opaque.set(view, 'a view — its columns are a select list this check does not read');
  }

  // Everything that would change the answer and is not understood. Silence here
  // would be a false pass, which is the one outcome this file may not produce.
  for (const m of code.matchAll(/\b(drop\s+column|rename\s+column|rename\s+to|create\s+table\s+[\w".]+\s+as\b)/gi)) {
    unparsed.push(`${SETUP_SQL}:${lineOf(code, m.index)}  ${m[1].replace(/\s+/g, ' ')}`);
  }
  for (const b of dollarBlocks) {
    if (/\b(create\s+table|add\s+column|drop\s+column|rename\s+column)\b/i.test(b.text)) {
      unparsed.push(`${SETUP_SQL}:${lineOf(code, b.at)}  DDL inside a function body or DO block`);
    }
  }
}

try {
  parseSetup(readFileSync(SETUP_SQL, 'utf8'));
} catch (e) {
  console.error(`could not read ${SETUP_SQL}: ${e.message}`);
  process.exit(1);
}
if (!declared.size) {
  console.error(`read ${SETUP_SQL} and found no table declared, which is not a pass.`);
  process.exit(1);
}

if (LIST) {
  for (const table of [...new Set([...declared.keys(), ...used.keys()])].sort()) {
    console.log(table + (opaque.has(table) ? `  (${opaque.get(table)})` : ''));
    console.log(`  app:  ${[...(used.get(table)?.keys() ?? [])].sort().join(', ') || '—'}`);
    console.log(`  repo: ${[...(declared.get(table)?.keys() ?? [])].sort().join(', ') || '—'}`);
  }
  console.log(`\n${[...used.values()].reduce((n, m) => n + m.size, 0)} columns named by ${files.length} source files across ${used.size} tables;`);
  console.log(`${[...declared.values()].reduce((n, m) => n + m.size, 0)} columns declared by ${SETUP_SQL} across ${declared.size} tables.`);
  for (const u of [...new Set(unreadable)].sort()) console.log(`  could not read: ${u}`);
  for (const u of [...new Set(unparsed)].sort()) console.log(`  did not understand: ${u}`);
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// The app against the repo — no credentials needed
// ═══════════════════════════════════════════════════════════════════════════

const problems = [];
const reported = new Set();
// One line per thing that drifted, whichever check noticed it first.
const report = (what, why, where) => {
  if (reported.has(what)) return;
  reported.add(what);
  problems.push([what, why, where]);
};
// Found without asking anybody: the app names something supabase/setup.sql does
// not build. Held rather than printed, because the live database is about to
// say which of the two directions it is — a column production has and the repo
// forgot, or one that exists nowhere at all — and one line saying which beats
// two saying half each.
const undeclared = new Map();   // "table.column" -> [what, table, column, where]
for (const [table, columns] of used) {
  if (opaque.has(table)) continue;
  const decl = declared.get(table);
  if (!decl) {
    undeclared.set(table, [table, table, null, [...columns.values()][0]]);
    continue;
  }
  for (const [column, where] of columns) {
    if (!decl.has(column)) undeclared.set(`${table}.${column}`, [`${table}.${column}`, table, column, where]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Both of them against the live database
// ═══════════════════════════════════════════════════════════════════════════

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env is fine if the vars are exported */ }
  return null;
}

const url = env('EXPO_PUBLIC_SUPABASE_URL');
const key = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const secret = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');

const notes = [];
let liveChecked = 0;
let liveListed = null;          // table -> Set(column), only with a secret key

async function ask(path, apiKey) {
  const res = await fetch(`${url}${path}`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
  });
  return { status: res.status, body: await res.text().catch(() => '') };
}

/** Present, absent, or unknown — never a guess. */
async function probe(table, columns) {
  const { status, body } = await ask(`/rest/v1/${table}?select=${columns.join(',')}&limit=1`, key);
  if (status === 200 || status === 401) return { present: columns, missing: [] };
  if (status === 404) return { noTable: true, present: [], missing: [] };
  if (status !== 400) return { unknown: `answered ${status}: ${body.slice(0, 120)}`, present: [], missing: [] };
  if (columns.length === 1) return { present: [], missing: columns };
  // PostgREST names only the first offending column, so the rest are asked for
  // one at a time. This costs a request per column of a table that has drifted,
  // and only of a table that has drifted.
  const present = [], missing = [], unknowns = [];
  for (const c of columns) {
    const one = await probe(table, [c]);
    if (one.unknown || one.noTable) unknowns.push(`${c}: ${one.unknown ?? 'the table went away mid-check'}`);
    else if (one.missing.length) missing.push(c);
    else present.push(c);
  }
  return { present, missing, unknown: unknowns.length ? unknowns.join('; ') : undefined };
}

/**
 * The whole live schema, which only a secret key can have. PostgREST serves its
 * OpenAPI description at the root and refuses that document to a publishable
 * key outright ("Only secret API keys can be used for this endpoint"), so this
 * either works completely or is reported as not done.
 */
async function listLive() {
  const { status, body } = await ask('/rest/v1/', secret);
  if (status !== 200) return { failed: `the schema listing answered ${status}: ${body.slice(0, 120)}` };
  let doc;
  try { doc = JSON.parse(body); } catch { return { failed: 'the schema listing was not JSON' }; }
  const defs = doc && doc.definitions;
  if (!defs || typeof defs !== 'object' || !Object.keys(defs).length) {
    return { failed: 'the schema listing carried no table definitions' };
  }
  const map = new Map();
  for (const [table, def] of Object.entries(defs)) {
    const props = def && def.properties;
    if (!props || typeof props !== 'object') return { failed: `the listing gave no columns for ${table}` };
    map.set(table, new Set(Object.keys(props)));
  }
  return { map };
}

if (!OFFLINE) {
  if (!url || !key) {
    notes.push('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set, so the live database was NOT asked anything.');
  } else {
    if (secret) {
      const listed = await listLive().catch((e) => ({ failed: e.message }));
      if (listed.failed) notes.push(`SUPABASE_SECRET_KEY is set but ${listed.failed} — the live schema was not listed.`);
      else liveListed = listed.map;
    }

    const tables = [...new Set([...declared.keys(), ...used.keys()])].sort();
    const wanted = new Map();
    for (const t of tables) {
      const cols = new Set();
      if (!opaque.has(t)) for (const c of declared.get(t)?.keys() ?? []) cols.add(c);
      for (const c of used.get(t)?.keys() ?? []) cols.add(c);
      if (cols.size) wanted.set(t, [...cols]);
    }

    const queue = [...wanted];
    const results = new Map();
    let reachError = null;
    async function worker() {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const [table, cols] = next;
        try { results.set(table, await probe(table, cols)); }
        catch (e) { reachError ??= e.message; return; }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    if (reachError) {
      console.error(`could not reach the database: ${reachError}`);
      process.exit(1);
    }

    for (const [table, r] of results) {
      const usedHere = used.get(table);
      const settle = (key) => undeclared.delete(key);
      if (r.noTable) {
        report(table, 'the table does not exist in the live database', declared.has(table) ? `declared in ${[...declared.get(table).values()][0]}` : [...usedHere.values()][0]);
        settle(table);
        continue;
      }
      if (r.unknown) { notes.push(`${table} could not be checked: ${r.unknown}`); continue; }
      liveChecked += r.present.length + r.missing.length;
      // A table the repo does not build at all is one line, not one per column.
      const wholeTable = undeclared.has(table);
      if (wholeTable) {
        report(table, `live, and named by the app, declared nowhere in ${SETUP_SQL} — a hand change nobody wrote down`, undeclared.get(table)[3]);
        settle(table);
      }
      for (const c of r.missing) {
        const from = declared.get(table)?.get(c);
        report(`${table}.${c}`, from
          ? 'declared in the repo, missing from the live database — a migration has not been run'
          : 'named by the app, and in neither the repo nor the live database',
        from ?? usedHere.get(c));
        settle(`${table}.${c}`);
      }
      for (const c of r.present) {
        // The clients incident, in the direction the old check could not look.
        if (wholeTable || opaque.has(table) || declared.get(table)?.has(c)) continue;
        report(`${table}.${c}`, `live, and named by the app, declared nowhere in ${SETUP_SQL} — a hand change nobody wrote down`, usedHere?.get(c) ?? 'named by the app');
        settle(`${table}.${c}`);
      }
    }

    // With the whole live schema in hand, the columns nobody names are visible
    // too — and they are drift just the same.
    if (liveListed) {
      for (const [table, cols] of liveListed) {
        if (opaque.has(table)) continue;
        const decl = declared.get(table);
        if (!decl) { report(table, `live, declared nowhere in ${SETUP_SQL} — a hand change nobody wrote down`, 'the live schema listing'); undeclared.delete(table); continue; }
        for (const c of cols) {
          if (!decl.has(c) && !used.get(table)?.has(c)) {
            report(`${table}.${c}`, `live, declared nowhere in ${SETUP_SQL} — a hand change nobody wrote down`, 'the live schema listing');
          }
        }
      }
      for (const table of declared.keys()) {
        if (!liveListed.has(table) && !opaque.has(table) && !results.get(table)?.noTable) {
          notes.push(`${table} is declared in the repo and absent from the live schema listing — check the grants before believing it is missing.`);
        }
      }
    }
  }
}

// Whatever the live database did not get to answer for. Offline, or with no
// credentials, or on a table it could not be asked about — the app still names
// a column the repo does not build, and that still fails on a database built
// from this repo.
for (const [what, , , where] of undeclared.values()) {
  report(what, `named by the app, declared nowhere in ${SETUP_SQL}`, where);
}

// ═══════════════════════════════════════════════════════════════════════════
// Saying what happened
// ═══════════════════════════════════════════════════════════════════════════

const tableCount = new Set([...declared.keys(), ...used.keys()]).size;
const columnCount = [...used.values()].reduce((n, m) => n + m.size, 0);

if (unreadable.length) {
  console.error(`${unreadable.length} place${unreadable.length === 1 ? '' : 's'} name${unreadable.length === 1 ? 's' : ''} columns this check cannot read from the source:\n`);
  for (const u of [...new Set(unreadable)].sort()) console.error(`  ${u}`);
  console.error('\nThe columns behind these are checked only where the repo also declares them.');
  console.error('');
}
if (unparsed.length) {
  console.error(`${unparsed.length} SQL construct${unparsed.length === 1 ? '' : 's'} in ${SETUP_SQL} this check does not understand:\n`);
  for (const u of [...new Set(unparsed)].sort()) console.error(`  ${u}`);
  console.error('\nColumns they add or take away are not in the repo-side answer above.');
  console.error('');
}
for (const [table, why] of opaque) {
  if (used.has(table) || declared.has(table)) notes.push(`${table} was not compared: ${why}.`);
}

if (problems.length) {
  console.error(`The app, ${SETUP_SQL} and the live database do not agree:\n`);
  const width = Math.max(...problems.map((p) => p[0].length));
  for (const [what, why, where] of problems.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.error(`  ${what.padEnd(width)}  ${why}`);
    if (where) console.error(`  ${' '.repeat(width)}  ${where}`);
  }
  console.error('\nA column the repo declares and the database lacks means a part in supabase/parts/');
  console.error('has not been run: being in the repo, and being in setup.sql, is not being in the');
  console.error('database. A column the database has and the repo does not means somebody changed');
  console.error('the schema by hand — write the part, or the next environment is built without it.');
  if (notes.length) { console.error(''); for (const n of notes) console.error(`Note: ${n}`); }
  process.exit(1);
}

for (const n of notes) console.log(`Note: ${n}`);

if (OFFLINE) {
  console.log(`schema ok, offline — ${columnCount} columns across ${used.size} tables named by ${files.length} source files, every one of them declared in ${SETUP_SQL}. The live database was not asked.`);
  process.exit(0);
}
if (!url || !key) {
  console.log(`app vs repo ok — ${columnCount} columns across ${used.size} tables are all declared in ${SETUP_SQL}.`);
  console.error('\nThe live half did NOT run and this is not a pass. Set EXPO_PUBLIC_SUPABASE_URL and');
  console.error('EXPO_PUBLIC_SUPABASE_ANON_KEY to check the database, or pass --offline to say so on purpose.');
  process.exit(78);
}

const coverage = liveListed
  ? 'the whole live schema was listed and compared'
  : `${tableCount} tables were asked about by name; a live column that neither the repo nor the app mentions is invisible without SUPABASE_SECRET_KEY`;
console.log(`schema ok — ${liveChecked} columns checked against the live database, ${coverage}.`);
