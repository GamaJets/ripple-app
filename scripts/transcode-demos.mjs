// Halve the frame rate of a bought animation pack, without touching resolution.
//
// ── Why frame rate and not size ────────────────────────────────────────────
//
// The obvious lever is resolution and it is the wrong one. The animation card
// is about 397 points wide, which on a 3x phone is ~1190 physical pixels — so
// the 960px source is ALREADY being upscaled about 24%. Downscaling to 480
// would mean a 2.5x upscale on exactly the screen where somebody is studying
// how a movement is performed.
//
// The clips are all exactly 20fps. Twelve is the standard for animation and
// the eye does not catch the difference on a looping illustrated diagram, so
// dropping every other frame and doubling the remaining durations takes ~40%
// off with no loss of sharpness at all.
//
// ── Frames are sub-rectangles, which is why this is not a one-liner ───────
//
// An animated WebP stores each frame as a cropped rectangle with its own x/y
// offset, so frames cannot simply be extracted and reassembled — they have to
// be composited back onto the full canvas first, or the movement drifts around
// the frame. webpmux -get frame gives the sub-rectangle; -frame puts it back
// with its offset intact, which is the part that keeps the figure still.
import { readdirSync, statSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const SRC = flag('in');
const OUT = flag('out');
const KEEP = Number(flag('keep', 2));     // keep 1 frame in KEEP
const LIMIT = Number(flag('limit', 0));

if (!SRC || !OUT) { console.error('usage: --in <dir> --out <dir> [--keep 2] [--limit N]'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const sh = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

/** The frame table from webpmux -info: one row per frame, carrying its size,
 *  offset and duration. Counting 'ANMF' in webpinfo output overshot by one —
 *  the word appears in the summary header as well as per frame, and asking
 *  webpmux for a frame that does not exist is a hard failure rather than a
 *  short read. The rows ARE the frames, so they are the count. */
function frameRows(file) {
  const info = sh('webpmux', ['-info', file]);
  return info.split('\n').filter((l) => /^\s*\d+:\s+\d+/.test(l));
}

const files = readdirSync(SRC).filter((f) => f.endsWith('.webp'));
const todo = LIMIT ? files.slice(0, LIMIT) : files;
let done = 0, before = 0, after = 0, failed = [];

for (const f of todo) {
  const src = join(SRC, f);
  const dst = join(OUT, f);
  const tmp = join(OUT, `.tmp-${basename(f, '.webp')}`);
  try {
    const rows = frameRows(src);
    const n = rows.length;
    if (n < 4) { // too short to thin; copy as is
      sh('cp', [src, dst]); before += statSync(src).size; after += statSync(dst).size; done++; continue;
    }
    mkdirSync(tmp, { recursive: true });
    // -get frame N keeps the sub-rectangle; the +offsets are read back from
    // webpmux -info so the figure lands in the same place on the canvas.
    const parts = [];
    for (let i = 1; i <= n; i += KEEP) {
      const fr = join(tmp, `f${i}.webp`);
      sh('webpmux', ['-get', 'frame', String(i), src, '-o', fr]);
      const row = rows[i - 1] || '';
      const m = row.match(/(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\w+)/);
      const xo = m ? m[3] : '0', yo = m ? m[4] : '0';
      const dur = m ? Number(m[5]) * KEEP : 100;   // hold each kept frame longer
      parts.push('-frame', fr, `+${dur}+${xo}+${yo}+1+b`);
    }
    sh('webpmux', [...parts, '-loop', '0', '-bgcolor', '0,0,0,0', '-o', dst]);
    before += statSync(src).size; after += statSync(dst).size; done++;
  } catch (e) {
    failed.push(`${f}: ${String(e.message || e).split('\n')[0]}`);
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
  if (done % 25 === 0) process.stdout.write(`  ${done}/${todo.length}\n`);
}

console.log(`\ntranscoded ${done}/${todo.length}`);
console.log(`  before ${(before / 1e6).toFixed(0)} MB → after ${(after / 1e6).toFixed(0)} MB  (${before ? (100 - after / before * 100).toFixed(0) : 0}% smaller)`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  for (const f of failed.slice(0, 8)) console.error('  ' + f);
}
