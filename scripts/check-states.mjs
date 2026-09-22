#!/usr/bin/env node
// Large text and dark mode, the two states nobody looks at until a member does.
//
// ── why this exists ───────────────────────────────────────────────────────
//
// Phase 6 of docs/claude-handoff/CLAUDE-CODE-DATA-LAYOUT-AND-FLOW-REVIEW.md asks
// every priority screen to be seen at Dynamic Type, in dark mode and under a
// tenant accent. The other gates already cover their own corners: check-a11y
// (names, twice-scaled line heights), check-fit (shrink-to-fit at 4pt),
// check-contrast (status colours as ink), check-console-ink (hex in the
// console). None of them looks at the three shapes that break a screen when
// the reader turns their text up or their phone dark:
//
//   · 21 Sep 2026, simulator at accessibility-large: "My Program" split across
//     half a screen (check-a11y Rule 2). The same pass showed rows whose text
//     grew and whose box did not — a `height: 44` row clips its second line.
//   · A colour typed as a string does not follow the palette. `color: '#fff'`
//     is white ink on the light palettes' white ground; a grey typed as hex is
//     never measured by src/lib/a11y.test.ts, which walks the tokens.
//   · A title held to one line at 3x text reads "My Prog…". The screen still
//     "works", and says nothing.
//
// docs/STATE-MATRIX.md is the manual pass these rules cannot replace.
//
// ── what this checks (app/ only; src/ui is the kit and is reviewed there) ──
//
//   height  A <View>/<Pressable>/<TouchableOpacity> whose opening tag sets a
//           literal `height: N` (N >= 24) with no `width:` beside it (a fixed
//           square is an avatar or an icon well, and is left alone), no
//           `minHeight`, and a <Text> inside. Use minHeight + padding.
//   ink     A colour property (`color`, `backgroundColor`, `borderColor`,
//           `tintColor`, or a JSX `color=`/`placeholderTextColor=`) set to a
//           quoted literal. Black scrims (`rgba(0,0,0,…)`, `#000x`) and
//           'transparent' are allowed: dimming is dimming in both modes.
//           Use a token from the theme (`t.*`).
//   title   A <Text numberOfLines={1}> that spreads a title step (ty.hero,
//           display, title, section, page) without adjustsFontSizeToFit.
//           Let it wrap, or shrink it with HERO_FIT (see check-fit).
//
// `states-ok: <reason>` on the tag or the line above excuses one. A bare
// marker does not count.
//
// ── ratchet ───────────────────────────────────────────────────────────────
// KNOWN holds what stood on the day this was written, keyed by file + rule +
// the tag's own text (not the line, which moves). New ones fail; fixed ones
// are reported as stale — `node scripts/check-states.mjs --prune` reprints the
// list. A static lint cannot see a colour reached through a variable, a height
// set in a StyleSheet, or a Text inside a child component; it claims only the
// inline shapes above.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Index of the `>` that closes the opening tag starting at `i`, skipping braces and strings. */
function tagEnd(src, i) {
  let depth = 0, q = null;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return j;
  }
  return -1;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 120);
const found = [];
let scanned = 0;

for (const f of walk(join(ROOT, 'app'))) {
  const src = readFileSync(f, 'utf8');
  const rel = relative(ROOT, f);
  const lines = src.split('\n');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const excused = (i, tag) => {
    const above = lines[lineOf(i) - 2] ?? '';
    return /states-ok:\s*\S/.test(tag) || /states-ok:\s*\S/.test(above);
  };
  const push = (rule, i, text) => {
    if (excused(i, text)) return;
    found.push({ key: `${rel}|${rule}|${norm(text)}`, file: rel, line: lineOf(i), rule, text: norm(text) });
  };

  for (const m of src.matchAll(/<(View|Pressable|TouchableOpacity|Text)\b/g)) {
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    scanned++;
    const tag = src.slice(m.index, end + 1);
    if (m[1] === 'Text') {
      if (/numberOfLines=\{1\}/.test(tag) && /\.\.\.ty\.(hero|display|title|section|page)\b/.test(tag)
        && !/adjustsFontSizeToFit/.test(tag)) push('title', m.index, tag);
      continue;
    }
    const h = tag.match(/[^A-Za-z]height\s*:\s*(\d+)/);
    if (!h || Number(h[1]) < 24 || /[^A-Za-z]width\s*:|minHeight/.test(tag) || tag.endsWith('/>')) continue;
    const close = src.indexOf(`</${m[1]}>`, end);
    if (close > 0 && /<Text\b/.test(src.slice(end, close))) push('height', m.index, tag);
  }

  const INK = /\b(color|backgroundColor|borderColor|tintColor)\s*:\s*(['"])([^'"]+)\2|\b(color|placeholderTextColor)=\{?(['"])([^'"]+)\5/g;
  for (const m of src.matchAll(INK)) {
    const v = (m[3] ?? m[6]).toLowerCase();
    if (v === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,/.test(v) || /^#000[0-9a-f]?$/.test(v)) continue;
    const ln = lines[lineOf(m.index) - 1];
    push('ink', m.index, ln);
  }
}

// The empty-set guard: a walk that saw almost nothing has not passed.
if (scanned < 1000) {
  console.error(`check-states: only scanned ${scanned} tags under app/, which cannot be right. Refusing to pass.`);
  process.exit(1);
}

const KNOWN = new Set([
  // Standing on 22 Sep 2026. access.tsx, injury-doc.tsx and scan-machine.tsx draw on a
  // fixed-black camera/pass ground, so their white ink is right today but untokenised.
  "app/(client)/access.tsx|ink|<Icon name={BACK_ICON} size={20} color=\"#fff\" />",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.body, ...numeric, color: '#8a8a8a', marginBottom: sp.huge }}>{appName} ID {memberNo}</Text>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.caption, color: '#8a8a8a', textAlign: 'center', marginTop: sp.lg }}>{MEMBER_NO_CHANGED_NOTE}</Text>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.label, ...font('500'), color: '#fff' }}>Try Again</Text>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.md }}>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.label, color: '#8a8a8a', textAlign: 'center', marginTop: sp.xxl }}>This is your {appName} ID, not a",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.title, color: '#fff', marginBottom: 4 }}>{c.name || 'Member'}</Text>",
  "app/(client)/access.tsx|ink|<Text style={{ ...ty.title, color: '#fff', textAlign: 'center' }}>",
  "app/(client)/access.tsx|ink|<View style={{ backgroundColor: '#fff', borderRadius: radius.md, paddingVertical: sp.xl, paddingHorizontal: sp.xl, align",
  "app/(client)/access.tsx|ink|style={{ marginTop: sp.xl, paddingVertical: 13, paddingHorizontal: sp.xxl, borderRadius: radius.sm, backgroundColor: '#1",
  "app/(client)/attendance.tsx|height|<View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 84, marginTop: sp.lg }}>",
  "app/(client)/injury-doc.tsx|ink|<Text style={{ ...ty.body, ...font('500'), color: '#fff' }} numberOfLines={1}>",
  "app/(client)/injury-doc.tsx|ink|<Text style={{ ...ty.body, ...font('500'), color: '#fff', textAlign: 'center' }}>",
  "app/(client)/injury-doc.tsx|ink|<Text style={{ ...ty.caption, color: '#999', marginTop: 2 }}>",
  "app/(client)/injury-doc.tsx|ink|<Text style={{ ...ty.label, ...font('600'), color: '#fff' }}>Close</Text>",
  "app/(client)/injury-doc.tsx|ink|<Text style={{ ...ty.label, color: '#fff', opacity: 0.8, textAlign: 'center' }}>",
  "app/(client)/library.tsx|title|<Text style={{ ...ty.title, color: t.ink, flex: 1 }} numberOfLines={1}>",
  "app/(client)/nutrition.tsx|height|<View style={{ height: 180, borderRadius: radius.md, backgroundColor: t.surface2, alignItems: 'center', justifyContent: ",
  "app/(client)/scan-machine.tsx|ink|<Text style={{ ...ty.label, ...font('500'), color: '#fff', marginTop: sp.lg }}>Point at the code on the machine</Text>",
  "app/(client)/trends.tsx|title|<Text numberOfLines={1} style={{ ...ty.section, ...font('600', 'display'), color: t.ink2, marginStart: 6, flexShrink: 0 ",
  "app/(trainer)/dashboard.tsx|title|<Text style={{ ...ty.title, color: t.ink, textTransform: 'capitalize', flex: 1 }} numberOfLines={1}>",
]);

if (process.argv.includes('--prune')) {
  console.log([...new Set(found.map((f) => f.key))].sort().map((k) => `  ${JSON.stringify(k)},`).join('\n'));
  process.exit(0);
}

const fresh = found.filter((f) => !KNOWN.has(f.key));
const standing = found.length - fresh.length;
const stale = [...KNOWN].filter((k) => !found.some((f) => f.key === k));

const WHY = {
  height: 'a fixed height around text — at large text the text grows and the box does not. Use minHeight + padding.',
  ink: 'a colour typed as a literal — it does not follow dark mode or the tenant palette. Use a t.* token.',
  title: 'a title held to one line — at large text it truncates to "My Prog…". Let it wrap, or add adjustsFontSizeToFit + HERO_FIT.',
};

if (fresh.length) {
  console.error('New large-text / dark-mode offences — see the header of scripts/check-states.mjs.\n');
  for (const f of fresh) console.error(`  ${f.file}:${f.line}  ${WHY[f.rule]}\n    ${f.text}\n`);
  console.error('`states-ok: <reason>` on the tag or the line above excuses one that is right as it is.');
  process.exit(1);
}
if (stale.length) console.log(`states: ${stale.length} standing offence${stale.length === 1 ? '' : 's'} no longer present — run with --prune to reprint the list.`);
console.log(`states: ok — ${scanned} tags scanned, no new fixed-height text boxes, literal colours or one-line titles`
  + (standing ? `, ${standing} standing (listed in the gate)` : ''));
