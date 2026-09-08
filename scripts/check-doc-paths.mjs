#!/usr/bin/env node
// Every repo path a document names must be a thing that is there.
//
// ── the incident ──────────────────────────────────────────────────────────
//
// `docs/ROADMAP.md` was re-verified against the code and held ELEVEN false
// status claims. Every one of them under-reported: work that had shipped was
// recorded as open. Several were close to costing a rebuild of something that
// already existed, and one nearly did — a lane was briefed to build payroll
// payment recording that `supabase/parts/36-payroll-settlements.sql` has held
// since part 36.
//
// The reason none of it was caught is that `docs/` had no gate on it of any
// kind. `check:prose` walks only `.tsx?` files under `app/`, `src/ui/`,
// `src/lib/` and `studio-web/`. `check:text` lists `.md` in its extensions —
// so it LOOKED covered — but its ROOTS omitted `docs/`, so the extension never
// matched a single planning document. Between the two of them, ROADMAP.md,
// LAUNCH-CHECKLIST.md, OWNER-PORTAL.md, DESIGN.md, WHITE-LABEL.md,
// STUDIO-HUB.md, UNBLOCK-RUNBOOK.md and UNIVERSAL-LINKS.md were read by
// nothing. `check:text` now includes `docs`. This is the second half.
//
// ── what is actually checkable, and what is not ───────────────────────────
//
// A status word is not checkable. Whether "Built" or "Open" or "Done" is TRUE
// of a row in a table is a judgement about a feature, and a gate that guessed
// at it would be wrong often enough to be switched off inside a week. This
// gate never looks at one.
//
// What IS mechanical is the evidence column. ROADMAP.md's own rule is "before
// starting any item, grep for it first", and the documents obey it: nearly
// every claim in them is backed by an inline code span naming a file, a
// directory, a migration part or a line. Those spans are decidable. A document
// that says a feature is unbuilt while citing `src/lib/gymPasses.ts` is making
// a claim this gate cannot judge; a document citing `src/lib/gymPassses.ts` is
// making one it can, and in practice the second is how the first goes wrong —
// a path that has moved, been renamed or never existed is the visible end of a
// belief about the tree that has stopped being true.
//
// So: every inline code span in a `docs/**/*.md` file that LOOKS like a repo
// path must resolve to something on disk, and a `file.ts:123` reference must
// name a line the file has.
//
// ── what it catches ───────────────────────────────────────────────────────
//
//   · a file, directory, migration part or web page that does not exist
//   · a path written relative to a subdirectory (`app/page.tsx` meaning
//     `studio-web/app/page.tsx`), which reads as a claim about a file at the
//     repository root and is not one
//   · `module.symbol` shorthand naming an export the module does not have
//   · a `:N` line reference past the end of the file
//   · a `supabase/parts/129` shorthand for a part number nothing was written at
//
// ── what it CANNOT catch, and you must not read it as claiming ────────────
//
//   · WHETHER THE CLAIM IS TRUE. This is the important one. A path resolving
//     says the writer was looking at a real file. It says nothing about
//     whether the sentence beside it is right. All eleven ROADMAP.md defects
//     cited real files.
//
//   · A LINE NUMBER THAT HAS DRIFTED. The line check is deliberately the
//     weakest thing that cannot false-alarm: the file must HAVE that line.
//     It does not check that the line still says what the document claims,
//     because that is not expressible and because line numbers move on every
//     edit above them — a gate that failed on drift would fire on every
//     commit and be disabled by the second week. The honest consequence is
//     real and was measured while writing this: `docs/WHITE-LABEL.md` cited
//     `studio-web/components/Shell.tsx:170` for a wordmark that is at :437,
//     and `studio-web/app/layout.tsx:28` for a hardcoded title that had since
//     been replaced by a read from `src/lib/brands.ts`. Both files are long
//     enough that both line numbers exist. This gate passed both; a person
//     found them. So `:N` here means "not obviously impossible", not "checked".
//
//   · A BARE FILENAME. `app.json`, `index.ts`, `package.json` — a span with no
//     `/` in it is not checked, because `foo.bar` in prose is far more often a
//     sentence than a file and the noise would swamp the signal.
//
//   · A PATH RELATIVE TO SOMEWHERE THIS CANNOT KNOW. `connect-onboard/index.ts`
//     means `supabase/functions/connect-onboard/index.ts` to a reader who has
//     the section heading. Its first segment is not a top-level directory, so
//     it is skipped rather than guessed at. Writing the full path is better and
//     this gate will then check it.
//
//   · A REFERENCE SHADOWED BY A NEIGHBOUR'S MARKER. `path-ok:` covers its own
//     line and the one below, the same span check-prose uses and for the same
//     reason — prose wraps, and the span a marker is about is often on the next
//     line. The cost is that a marker can excuse a second, unrelated reference
//     that happens to sit beside it. Eight are excused today and seven were
//     meant to be. Keep markers on the line they are about.
//
//   · ANYTHING IN A FENCED CODE BLOCK. Those are commands, SQL and pasted
//     output; a path inside one is an instruction to a shell, not a claim about
//     the tree, and `/tmp/a` is not a defect.
//
// ── the escape hatch, and why it must exist ───────────────────────────────
//
// These documents deliberately record things that are NOT there. That is not a
// bug in them, it is most of their value: `docs/WHITE-LABEL.md` says the
// worked brand example "deliberately does not build — the icon paths point at
// `assets/brands/example/`, which does not exist", and that Supabase's redirect
// allow-list is dashboard-only because "there is no `supabase/config.toml`".
// `docs/history/` is an archive of superseded documents that were accurate when
// they were written and describe a tree that has since been restructured.
// Forcing any of that to be deleted or falsified to make a gate go green would
// be worse than having no gate.
//
// So the same marker convention every other gate here uses — `prose-ok:` in
// check-prose, `grant-ok:` in check-grants, `provider-value-ok:` in
// check-provider-value — applies: `path-ok: <why>` on the line or the one
// above it, and, as in all of those, a bare marker with no reason does not
// count. In markdown put it in an HTML comment, which renders as nothing:
//
//     <!-- path-ok: says in the sentence that this deliberately does not exist -->
//
// A marker is a claim that somebody looked. Write what they saw.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();

/** Where the documents are. One root today; an array because the next one is
 *  cheap and a hardcoded string is how `docs/` came to be missed elsewhere. */
const ROOTS = ['docs'];

/**
 * The repository's own top-level directories, read from disk rather than typed.
 *
 * This single test is what keeps the gate quiet. A code span only becomes a
 * path candidate if its first segment is a real directory at the repository
 * root, which throws away every route (`/join`), every URL, every MIME type
 * (`application/json`), every scheme (`repple://join`) and every `and/or` in
 * prose without needing a rule for any of them. Read from disk so that a new
 * top-level directory is covered the day it appears.
 */
const TOP = new Set(
  readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => e.name),
);

/** Extensions this repo writes. Used to decide whether the tail of a basename
 *  is a file type or a symbol name, and to resolve an extensionless module. */
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.md', '.json',
  '.html', '.css', '.sh', '.yml', '.yaml', '.toml', '.txt', '.xml', '.svg', '.png'];

/** `:12`, `:12-18`, `:12–18` (en dash, which these documents use), `:188,204,218`. */
const LINE_SPEC = /^:\d+(?:[-–—]\d+)?(?:,\d+(?:[-–—]\d+)?)*$/;

const exists = (p) => { try { statSync(join(ROOT, p)); return true; } catch { return false; } };
const isFile = (p) => { try { return statSync(join(ROOT, p)).isFile(); } catch { return false; } };

/** Does anything in the parent directory match this glob? */
function globMatches(p) {
  const dir = dirname(p);
  if (!exists(dir)) return false;
  const re = new RegExp('^' + basename(p)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  try { return readdirSync(join(ROOT, dir)).some((e) => re.test(e)); } catch { return false; }
}

/**
 * `path-ok: <why>` on this line or the one above. The reason is the point of
 * the marker, so a bare marker does not count.
 *
 * The other gates here test that with `/-ok:\s*\S/`, which is right for a `//`
 * comment and WRONG here: these markers live in HTML comments, and `<!--
 * path-ok: -->` puts a `-` after the colon, so the comment's own terminator
 * passed as a reason. Found by writing the bare marker and watching it be
 * accepted. So the terminator is stripped first and the reason must contain
 * real words.
 */
function excused(lines, i) {
  const near = [lines[i], i > 0 ? lines[i - 1] : ''].join('\n');
  for (const m of near.matchAll(/path-ok:([^\n]*)/g)) {
    if (/[A-Za-z]{3}/.test(m[1].replace(/-->.*$/, ''))) return true;
  }
  return false;
}

const files = [];
function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.md')) out.push(p);
  }
}
// Counted per ROOT, through the shared floor, for the reason scripts/gate-floor.mjs
// gives: a total cannot notice a root going missing, and this whole gate exists
// because a root went missing from somebody else's ROOTS array.
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  try { walk(join(ROOT, r), files); } catch { /* a root that is not there yet */ }
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:doc-paths', perRoot);

const problems = [];
let checked = 0;   // path references actually resolved — the second empty-set guard
let excusedCount = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  let fenced = false;

  lines.forEach((line, i) => {
    // A fence toggles. Paths inside are commands and pasted output, not claims.
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;

    for (const m of line.matchAll(/(`+)([^`\n]+?)\1/g)) {
      let span = m[2].trim();

      // Not a path: whitespace, a placeholder (`assets/brands/<brand>/`), a
      // shell variable, a quote, a home-relative path, or a URL scheme.
      if (/[<>$~"'\s]/.test(span) || span.includes('://')) continue;
      if (!span.includes('/')) continue;              // bare filenames are out of scope
      if (span.startsWith('/')) continue;             // an app route or a URL path

      // Split off a trailing line reference. A colon that is not one — a
      // `key: value`, a `POST /x` — disqualifies the span entirely.
      let lineSpec = null;
      const colon = span.indexOf(':');
      if (colon !== -1) {
        const tail = span.slice(colon);
        if (!LINE_SPEC.test(tail)) continue;
        lineSpec = tail.slice(1);
        span = span.slice(0, colon);
      }

      if (!TOP.has(span.split('/')[0])) continue;     // the quiet-keeping test

      const path = span.replace(/\/+$/, '');
      checked++;
      if (excused(lines, i)) { excusedCount++; continue; }

      const where = `${rel}:${i + 1}`;
      let target = path;                              // the file a :N refers to
      let ok = false;

      if (/[*?]/.test(path)) {
        ok = globMatches(path);
        target = null;                                // a glob has no single file
        if (!ok) problems.push({ where, span: m[2], what: `matches no file. Nothing in ${dirname(path)} has that shape.`, fix: 'Name a file that is there, or widen the pattern.' });
      } else if (exists(path)) {
        ok = true;
      } else if (!basename(path).includes('.')) {
        // An extensionless reference: a module (`src/lib/supabase`), a route
        // (`app/(client)/access`), or a migration part number.
        for (const e of EXTS) if (exists(path + e)) { ok = true; target = path + e; break; }
        if (!ok && dirname(path) === 'supabase/parts' && /^\d+$/.test(basename(path))) {
          // `supabase/parts/129` is this repo's shorthand for the part, whose
          // real name is `129-<title>.sql`. The number is the claim.
          ok = globMatches(`${path}-*.sql`);
          target = null;
          if (!ok) problems.push({ where, span: m[2], what: `is not a migration part. Nothing in supabase/parts is numbered ${basename(path)}.`, fix: 'Check the number against `ls supabase/parts`. A part number that does not exist is a claim about applied SQL that was never applied.' });
        }
        if (!ok && target === path) {
          problems.push({ where, span: m[2], what: 'does not exist, as a directory or as a module under any extension this repo uses.', fix: 'Name the real path. If the thing has moved, the sentence around it is probably describing where it used to be.' });
        }
      } else {
        // A basename with a dot whose extension this repo does not write is
        // very likely `module.symbol` shorthand — `src/lib/gymEquipment.capacityFor`.
        const dot = path.lastIndexOf('.');
        const stem = path.slice(0, dot);
        const symbol = path.slice(dot + 1);
        const known = EXTS.includes(path.slice(dot).toLowerCase());
        let modFile = null;
        if (!known) for (const e of EXTS) if (exists(stem + e)) { modFile = stem + e; break; }

        if (modFile) {
          target = modFile;
          const src = readFileSync(join(ROOT, modFile), 'utf8');
          ok = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(src);
          if (!ok) problems.push({ where, span: m[2], what: `reads as \`${symbol}\` in ${modFile}, and that file does not contain \`${symbol}\`.`, fix: `Name the export that is actually there, or write the path and the symbol separately — \`${modFile}\` \`theRealName\` — which is how the rest of these documents do it.` });
        } else {
          problems.push({ where, span: m[2], what: 'does not exist.', fix: 'If it is written relative to a subdirectory, write the full path from the repository root — a reader and this gate both read it as a path from the root. If it has been renamed or deleted, the claim beside it is describing a tree that is gone.' });
        }
      }

      if (!ok || !lineSpec || !target || !isFile(target)) continue;

      const total = readFileSync(join(ROOT, target), 'utf8').split('\n').length;
      for (const n of lineSpec.split(/[,\-–—]/)) {
        if (Number(n) <= total) continue;
        problems.push({ where, span: m[2], what: `points at line ${n} of ${target}, which has ${total} lines.`, fix: 'Re-find what the sentence is citing and write its line. Note that this gate only checks the line EXISTS — a number that has merely drifted passes, so re-read the line rather than trusting the other references around it.' });
      }
    }
  });
}

// The empty-set guards, both of them. The first is per root, above. This is the
// second: the roots can be right and the extraction broken, and a gate that
// resolved nothing would print a confident sentence about documents it never
// parsed. These eight documents carried 250 checkable references on 8 September
// 2026; a hundred is far below that and far above zero.
if (checked < 100) {
  console.error(`check:doc-paths: found only ${checked} path references across ${files.length} documents, which cannot be right.`);
  console.error('The extraction is broken, not the documents. Nothing below would be a claim about anything.');
  process.exit(1);
}

if (problems.length) {
  console.error(`\n${problems.length} path${problems.length === 1 ? '' : 's'} named in docs/ that ${problems.length === 1 ? 'is not' : 'are not'} there:\n`);
  for (const p of problems) {
    console.error(`  ${p.where}`);
    console.error(`    \`${p.span}\` ${p.what}`);
    console.error(`    → ${p.fix}\n`);
  }
  console.error('These documents are what a lane reads before it decides whether to build');
  console.error('something. A path that has moved is the visible end of a belief about this');
  console.error('tree that has stopped being true, and the sentence beside it is the part that');
  console.error('costs a day — eleven false status claims sat in docs/ROADMAP.md, and one of');
  console.error('them nearly bought a second copy of supabase/parts/36-payroll-settlements.sql.');
  console.error('');
  console.error('If the document is deliberately naming something that is NOT there — a worked');
  console.error('example that cannot build, a file Supabase does not give you, an archived');
  console.error('document that was accurate when it was written — say so and keep the prose:');
  console.error('');
  console.error('    <!-- path-ok: the sentence says this deliberately does not exist -->');
  console.error('');
  console.error('on that line or the one above it. A marker with no reason after it does not');
  console.error('count. This gate never asks you to delete an accurate record of a past state.');
  process.exit(1);
}

console.log(`check:doc-paths — ${files.length} documents, ${checked} path reference${checked === 1 ? '' : 's'} all resolve`
  + `${excusedCount ? ` (${excusedCount} marked path-ok)` : ''}.`);
