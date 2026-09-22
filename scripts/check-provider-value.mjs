#!/usr/bin/env node
// A React context provider that cannot stop reading.
//
// ── the defect ────────────────────────────────────────────────────────────
//
//     return <Ctx.Provider value={{ rows, status, refresh: () => hydrate() }}>
//
// An inline object literal, so `useThing()` returns a DIFFERENT value on every
// render of the provider, and every function on it is a different function
// again. A consumer then writes the obvious thing —
//
//     useFocusEffect(useCallback(() => { t.refresh(); }, [t]));
//
// — and builds a machine that cannot stop: the effect re-runs when its
// callback's identity changes, `refresh` re-runs the fetch, the fetch ends in a
// setState with a freshly-built array, the provider re-renders, and both
// identities are new again. It never settles and it looks like nothing at all
// on screen.
//
// This was measured, not reasoned: 782 requests in five idle minutes on one
// handset, a getUser → sessions → session_approvals lap about every 490ms, off
// this project's own edge logs. It was src/ui/sessions.tsx. src/ui/roster.tsx
// was the same defect found separately, and app/(trainer)/client.tsx fired nine
// Supabase reads per lap for as long as any coach had a client's page open.
//
// The fix is documented at length in src/ui/roster.tsx (search "handed out
// through a ref"): implementations go in a ref, wrappers are created once with
// `useCallback(…, [])` so they are stable for the life of the provider while
// still closing over the current state, and the value is a `useMemo` whose
// dependencies are only the things a consumer can actually see.
//
// ── the second rule, and why it is not optional ───────────────────────────
//
// Memoising is not enough on its own. src/ui/programTemplates.tsx published
//
//     useMemo(() => ({ templates, status, saveTemplate, … }), [templates, status, uid, reload])
//
// — four writers in the object and none of them in the dependency list. That
// hands consumers whichever copy of those functions happened to exist when one
// of the four listed values last moved, which is a stale closure over an old
// `templates`. Listing them instead would have made the memo do nothing, since
// their identity changes every render. The ref is the only way out of both, so
// a memo that publishes a bare identifier it does not depend on is an error
// here rather than a style note.
//
// ── escapes ───────────────────────────────────────────────────────────────
//
// A value that is genuinely constant is fine, and so is a dependency
// deliberately withheld — src/ui/outbox.tsx withholds `enqueue` on purpose and
// says why. Both are allowed with a marker carrying a REASON:
//
//     // provider-value-ok: <why>
//     // provider-deps-ok: <why>
//
// A marker with no reason after the colon does not count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'app', 'web', 'studio-web'];
const SKIP = new Set(['node_modules', '.expo', '.next', 'dist', 'build', '.tmp']);

function files(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name.startsWith('.') || SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** A marker counts only when it names a reason. */
function marked(lines, i, key) {
  for (let j = Math.max(0, i - 3); j <= i; j++) {
    const m = lines[j] && lines[j].match(new RegExp(key + ':\\s*(\\S.*)$'));
    if (m && m[1].trim().length > 2) return true;
  }
  return false;
}

/** Split a brace-balanced member list on its top-level commas. */
function topLevel(src) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of src) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const errors = [];

for (const root of ROOTS) {
  for (const file of files(root)) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('.Provider')) continue;
    const lines = src.split('\n');

    // ── 1 · an inline object literal handed straight to a Provider ──────────
    lines.forEach((line, i) => {
      if (!/\.Provider\s+value=\{\{/.test(line)) return;
      if (marked(lines, i, 'provider-value-ok')) return;
      errors.push(
        `${file}:${i + 1}  a Provider is handed an inline object literal, so every consumer sees a new value on every render.\n` +
        `    Follow src/ui/roster.tsx: hold the implementations in a ref, wrap them once with useCallback(…, []), and publish a useMemo.`,
      );
    });

    // ── 2 · a value built as a plain object and then handed over ────────────
    if (/\.Provider\s+value=\{value\}/.test(src) || /createElement\(\s*\w+\.Provider,\s*\{\s*value\s*\}/.test(src)) {
      lines.forEach((line, i) => {
        if (!/^\s*const value(\s*:\s*[\w<>[\], |]+)?\s*=\s*\{\s*$/.test(line)) return;
        if (marked(lines, i, 'provider-value-ok')) return;
        errors.push(
          `${file}:${i + 1}  the provider's value is a plain object rebuilt on every render. Memoise it — see src/ui/roster.tsx.`,
        );
      });
    }

    // Names that live at module scope — imports, top-level constants, module
    // functions — cannot change identity between renders, so a memo that
    // publishes one and does not list it is not carrying anything stale.
    const moduleScope = new Set();
    for (const im of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
      for (const n of im[1].split(',')) {
        const name = n.trim().split(/\s+as\s+/).pop().replace(/^type\s+/, '').trim();
        if (name) moduleScope.add(name);
      }
    }
    for (const d of src.matchAll(/^(?:export\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      moduleScope.add(d[1]);
    }

    // ── 3 · a memo that publishes a member it does not depend on ────────────
    const memo = /const value(?:\s*:\s*[\w<>[\], |]+)?\s*=\s*useMemo(?:<[^>]*>)?\(\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\s*,\s*(?:\/\/[^\n]*\n\s*)*\[([\s\S]*?)\]\s*,?\s*\)/g;
    let m;
    while ((m = memo.exec(src)) !== null) {
      const at = src.slice(0, m.index).split('\n').length - 1;
      if (marked(lines, at, 'provider-deps-ok')) continue;
      const deps = new Set(topLevel(m[2]).map((d) => d.trim()).filter(Boolean));
      for (const part of topLevel(m[1])) {
        const expr = part.includes(':') && !part.startsWith('...')
          ? part.slice(part.indexOf(':') + 1).trim()
          : part.trim();
        // Only bare identifiers. An expression is recomputed by the memo
        // itself, so its freshness is the memo's own business.
        if (!/^[A-Za-z_$][\w$]*$/.test(expr)) continue;
        if (deps.has(expr) || moduleScope.has(expr)) continue;
        errors.push(
          `${file}:${at + 1}  the provider's value publishes \`${expr}\` and does not depend on it, so consumers get whichever copy existed when the listed dependencies last moved.\n` +
          `    Either add it, or — if adding it would defeat the memo because its identity changes every render — hold it in a ref as src/ui/roster.tsx does.`,
        );
      }
    }
  }
}

if (errors.length) {
  console.error(`check:provider-value — ${errors.length} problem${errors.length === 1 ? '' : 's'}\n`);
  for (const e of errors) console.error('  ' + e + '\n');
  process.exit(1);
}
console.log('check:provider-value — every context provider publishes a stable value.');
