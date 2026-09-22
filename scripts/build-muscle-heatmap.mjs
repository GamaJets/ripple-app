#!/usr/bin/env node
// Turn RepDB's muscle-heatmap kit into assets a phone can carry.
//
// ── why this exists rather than the files being copied in ─────────────────
//
// The kit ships at print resolution: the front base is 1510×4064 and 2.9 MB
// on its own, and the seventy-four overlays are 35–130 KB each, about 13 MB
// all told. None of that is wrong — it is source artwork, and RepDB says so —
// but a phone draws this at roughly 320 points tall and would decode a
// four-thousand-pixel image to do it.
//
// At 900px tall the same files are 32 KB for a base and about 2.8 KB for an
// overlay: the whole set is around 270 KB, which is small enough to sit in the
// app's own assets and therefore to ship OVER THE AIR — expo-updates carries
// assets with an update, so this needs no new binary. 900 rather than 640
// because the body is drawn tall and narrow and a member may pinch into it.
//
// ── what it does NOT do ───────────────────────────────────────────────────
//
// It does not re-colour anything. Every overlay is white RGB with the whole
// shape carried in the alpha channel, which is the property that lets the app
// tint them per-intensity at runtime with `tintColor` instead of shipping one
// set of images per colour. Re-encoding preserves alpha (`-alpha_q 90`) and
// touches nothing else.
//
// Usage:  node scripts/build-muscle-heatmap.mjs <path-to-kit>
// Needs:  dwebp, cwebp (libwebp), sips (macOS).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const SRC = process.argv[2];
const OUT = 'assets/muscle-heatmap';
const TALL = 900;

if (!SRC || !existsSync(join(SRC, 'manifest.json'))) {
  console.error('usage: node scripts/build-muscle-heatmap.mjs <dir containing manifest.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
mkdirSync(OUT, { recursive: true });
const tmp = '/tmp/.hm-build';
mkdirSync(tmp, { recursive: true });

let done = 0;
let bytes = 0;
const shrink = (file, alpha) => {
  const png = join(tmp, basename(file) + '.png');
  const small = join(tmp, basename(file) + '.small.png');
  const out = join(OUT, basename(file));
  execFileSync('dwebp', [join(SRC, file), '-o', png], { stdio: 'ignore' });
  execFileSync('sips', ['-Z', String(TALL), png, '--out', small], { stdio: 'ignore' });
  execFileSync('cwebp', ['-quiet', '-q', '82', ...(alpha ? ['-alpha_q', '90'] : []), small, '-o', out], { stdio: 'ignore' });
  done += 1;
  bytes += readFileSync(out).length;
};

const out = { generated: new Date().toISOString().slice(0, 10), tallPx: TALL, sides: {} };
for (const side of ['front', 'back']) {
  const s = manifest[side];
  shrink(s.base, false);
  const muscles = [];
  for (const m of s.muscles) { shrink(m.file, true); muscles.push({ name: m.name, side: m.side, file: m.file }); }
  // The ratio, not the pixels: every file on a side shares one canvas, so the
  // app needs one aspect ratio per side and never a per-overlay offset.
  out.sides[side] = { base: s.base, aspect: +(s.width / s.height).toFixed(6), muscles };
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(`muscle heatmap: ${done} images, ${(bytes / 1024).toFixed(0)} KB total, ${TALL}px tall → ${OUT}`);
