const fs = require('fs');
const F = 'src/lib/music.ts';
let s = fs.readFileSync(F, 'utf8');
const tracks = fs.readFileSync('.rgen25/tracks.txt', 'utf8');
function rep(a, b) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 50)); process.exit(1); } s = s.replace(a, b); }
// 1) append new tracks before POOL close
rep("  { title: 'Instant Crush', artist: 'Daft Punk', bpm: 109, energy: 3, genre: 'Electronic' },\n];",
    "  { title: 'Instant Crush', artist: 'Daft Punk', bpm: 109, energy: 3, genre: 'Electronic' },\n" + tracks + "];");
// 2) add a seeded PRNG (deterministic shuffle) before generatePlaylist
rep("/** Deterministic-ish pick so the same params give a stable list, varied by `salt`. */",
    "// Small seeded PRNG so a given salt yields a stable, well-shuffled order.\nfunction mulberry32(seed: number) {\n  let a = seed >>> 0;\n  return function () {\n    a = (a + 0x6d2b79f5) | 0;\n    let t = Math.imul(a ^ (a >>> 15), 1 | a);\n    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;\n    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;\n  };\n}\n\n/** Deterministic-ish pick so the same params give a stable list, varied by `salt`. */");
// 3) replace wrap-around selection with shuffle + unique slice
rep("  // Easy / mobility → calmest & slowest first; moderate / hard → hardest & fastest first.\n  const calm = p.mode === 'mobility' || p.intensity === 1;\n  const sorted = [...pool].sort((a, b) => (calm ? (a.energy - b.energy || a.bpm - b.bpm) : (b.energy - a.energy || b.bpm - a.bpm)));\n  const tracks: Track[] = [];\n  for (let i = 0; i < want; i++) tracks.push(sorted[(i + salt) % sorted.length]);",
    "  // Deterministic shuffle by salt so each regenerate pulls a genuinely different,\n  // non-repeating set from the whole in-band pool (no recycling the same few songs).\n  const calm = p.mode === 'mobility' || p.intensity === 1;\n  const rng = mulberry32((salt * 2654435761 + lo * 131 + hi * 17 + want * 7) >>> 0);\n  const shuffled = [...pool];\n  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }\n  const tracks = shuffled.slice(0, Math.min(want, shuffled.length));\n  tracks.sort((a, b) => (calm ? (a.energy - b.energy || a.bpm - b.bpm) : (b.energy - a.energy || b.bpm - a.bpm)));");
fs.writeFileSync(F, s); console.log('applied OK');
