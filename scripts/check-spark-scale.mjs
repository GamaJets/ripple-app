#!/usr/bin/env node
// A trend line that draws "nothing changed" and "nothing happened" the same.
//
// ── the incident ──────────────────────────────────────────────────────────
//
// 5 Oct 2026, the coach's client profile. The purple trend beside "Days
// Trained 0" was a flat line along the floor of its band. So was the trend for
// a client who had trained five days a week for eight weeks. Two opposite
// truths, one picture, on the card a coach reads to decide who to chase.
//
// The cause is the divide-by-zero guard every trend in this app had written:
//
//     const rng = (max - min) || 1
//
// It stops the division and then puts the line on the floor. With max === min,
// `(v - min) / 1` is 0 for every point, so every point lands wherever 0 maps
// to in that band — and a flat series is the ORDINARY case for weight, for a
// steady training habit, and for a gym delivering the same number of sessions
// every month.
//
// Four sites had it: the kit's Spark, the kit's KpiTile trend, TrendFigure on
// the client profile, and NightSpark on the owner's board. The first two are
// drawn by all three apps.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// A series' own range is scaled with `sparkY` from src/lib/sparkScale.ts,
// which puts a flat series down the MIDDLE — the only position that says "this
// did not move" without also claiming something about the level, which a band
// holding one value cannot know.
//
// So: a subtraction of a series' own extremes guarded with `|| 1` fails here.
// The names are the tell — `max - min`, `hi - lo`, and the `Math.max(...)` /
// `Math.min(...)` pair — because that shape is only ever a data range.
//
// ── what it deliberately does NOT flag ────────────────────────────────────
//
// `(target || 1)`, `(top || 1)`, `Math.floor(day) || 1`. Those guard a zero
// DENOMINATOR where zero means "no target set" or "no bar to scale against",
// which is a different thing with a different right answer: there the `|| 1`
// is protecting a division that has no meaningful result, not flattening a
// picture of real readings.
//
// ── the escape, and the one thing using it ────────────────────────────────
//
// `spark-ok: <reason>`, on the line or the one above, and a bare marker does
// not count. src/ui/HrZoneChart.tsx is the only user: its `hi - lo` is an AXIS
// derived from the member's age and their recorded range, not from the samples
// being drawn, so no flat series can collapse it. A rule that could not tell
// those apart would be a rule people turn off.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files app src', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.test.ts'));

/** True for every character inside a comment or a string, so this file's own
 *  header — which quotes the broken shape twice — is not read as code. */
function masked(src) {
  const out = new Array(src.length).fill(false);
  let block = false, line = false, str = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1] ?? '';
    if (block) { out[i] = true; if (c === '*' && n === '/') { out[i + 1] = true; i++; block = false; } continue; }
    if (line) { out[i] = true; if (c === '\n') line = false; continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '*') { out[i] = out[i + 1] = true; i++; block = true; continue; }
    if (c === '/' && n === '/') { out[i] = out[i + 1] = true; i++; line = true; continue; }
    if (c === '"' || c === "'" || c === '`') str = c;
  }
  return out;
}

// `max - min || 1`, `(max - min) || 1`, `hi - lo || 1`, and the spelled-out
// `(Math.max(…) - min) || 1`. Anchored on the NAMES, which is what keeps a
// target or a bar ceiling out of it.
const RANGE = /(?:\b(?:max|hi|high|top)\w*\b|Math\.max\([^)]*\))\s*-\s*(?:\b(?:min|lo|low|bottom)\w*\b|Math\.min\([^)]*\))\s*\)?\s*\|\|\s*1/g;
const OK = /spark-ok:\s*(.+)$/;

const offences = [];
let scanned = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('|| 1')) continue;
  scanned++;
  const mask = masked(src);
  const lines = src.split('\n');
  for (const m of src.matchAll(RANGE)) {
    if (mask[m.index]) continue;
    const no = src.slice(0, m.index).split('\n').length;
    const here = lines[no - 1] ?? '';
    const above = lines[no - 2] ?? '';
    const marker = OK.exec(here) ?? OK.exec(above);
    if (marker && marker[1].trim().length > 0) continue;
    offences.push(`  ${file}:${no}  ${here.trim().slice(0, 96)}`);
  }
}

if (offences.length) {
  console.error(`check-spark-scale — ${offences.length} series range guarded with \`|| 1\`:\n`);
  console.error(offences.join('\n'));
  console.error(`
That guard divides safely and then draws every FLAT series along one edge of
its band, so a reading that never moved looks like the lowest it has ever been
— and a client who trained every week draws the same line as one who never did.

Use sparkY from src/lib/sparkScale.ts, which centres a flat series.

If this subtraction is an AXIS rather than the data's own range — bounds that
cannot collapse when the readings are equal — put "spark-ok: <reason>" on that
line or the one above it. A bare marker does not count.`);
  process.exit(1);
}

console.log(`check-spark-scale — ok, ${scanned} files with a \`|| 1\` guard checked; no series range flattens a trend that did not move.`);
