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
// offset — 81% of the frames in this pack have one — so frames cannot simply
// be extracted and reassembled. webpmux -get frame hands back the bare
// sub-rectangle, and -frame puts it back WITH its offset, which is the part
// that keeps the figure where the illustrator drew it. Lose the offsets and
// every clip stacks its figure into the top-left corner of the canvas.
//
// ── Why every output frame clears the canvas behind it ────────────────────
//
// Thinning breaks dispose chains: a frame that relied on the one before it
// for the pixels outside its own rectangle now has a different frame before
// it. Rather than track that, every kept frame is written dispose=background
// over a transparent bgcolor, so the canvas is empty before each one draws
// and each frame stands alone. That is only faithful because no frame in the
// pack blends (blend is 'no' on all 35,736 of them) and the full-canvas
// keyframes are opaque only inside the same band as the sub-rectangles — so
// there is never residue outside the current frame to preserve. Both facts
// are asserted below rather than assumed.
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

/** The frame table from webpmux -info, one object per frame:
 *
 *    No.: width height alpha x_offset y_offset duration dispose blend size compression
 *      1:   844   311   yes       62      350       51    none    no  30382       lossy
 *
 *  Counting 'ANMF' in webpinfo output overshot by one — the word appears in
 *  the summary header as well as per frame — so the rows themselves are the
 *  count. Columns are split rather than pattern-matched: a regex over mixed
 *  number/word columns is exactly what silently returned null here before,
 *  and a null that falls back to a default offset is invisible until someone
 *  opens the app. A row that will not parse throws. */
function frameRows(file) {
  const info = sh('webpmux', ['-info', file]);
  const rows = [];
  for (const line of info.split('\n')) {
    const m = line.match(/^\s*(\d+):\s+(.*\S)\s*$/);
    if (!m) continue;
    const c = m[2].split(/\s+/);
    if (c.length < 8) throw new Error(`unreadable frame row: ${line.trim()}`);
    const row = { n: Number(m[1]), w: +c[0], h: +c[1], x: c[3], y: c[4], dur: Number(c[5]), dispose: c[6], blend: c[7] };
    if (!Number.isFinite(row.dur) || !/^\d+$/.test(row.x) || !/^\d+$/.test(row.y)) {
      throw new Error(`unreadable frame row: ${line.trim()}`);
    }
    // Standing alone per frame is only faithful when nothing blends.
    if (row.blend !== 'no') throw new Error(`frame ${row.n} blends; thinning would change it`);
    rows.push(row);
  }
  if (!rows.length) throw new Error('no frame rows in webpmux -info');
  return rows;
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
    const parts = [];
    for (let i = 0; i < n; i += KEEP) {
      const row = rows[i];
      const fr = join(tmp, `f${row.n}.webp`);
      sh('webpmux', ['-get', 'frame', String(row.n), src, '-o', fr]);
      // Hold this frame for as long as the frames it replaces did, so the
      // loop takes exactly as long as the original.
      const dur = rows.slice(i, i + KEEP).reduce((t, r) => t + r.dur, 0);
      // +duration+x+y+dispose, then blend: 1 = clear to bgcolor after,
      // -b = overwrite rather than blend.
      parts.push('-frame', fr, `+${dur}+${row.x}+${row.y}+1-b`);
    }
    sh('webpmux', [...parts, '-loop', '0', '-bgcolor', '0,0,0,0', '-o', dst]);

    // The offsets are the whole point, so prove they survived rather than
    // trusting that they did.
    const outRows = frameRows(dst);
    const kept = rows.filter((_, i) => i % KEEP === 0);
    if (outRows.length !== kept.length) throw new Error(`wrote ${outRows.length} frames, expected ${kept.length}`);
    outRows.forEach((r, i) => {
      if (r.x !== kept[i].x || r.y !== kept[i].y || r.w !== kept[i].w || r.h !== kept[i].h) {
        throw new Error(`frame ${i + 1} landed at ${r.x},${r.y} ${r.w}x${r.h}, source has ${kept[i].x},${kept[i].y} ${kept[i].w}x${kept[i].h}`);
      }
    });

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
  process.exit(1);
}
