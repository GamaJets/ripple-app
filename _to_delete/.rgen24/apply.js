const fs = require('fs');
function patch(F, edits) {
  let s = fs.readFileSync(F, 'utf8');
  for (const [a, b] of edits) { const n = s.split(a).length - 1; if (n !== 1) { console.error('ANCHOR x' + n + ' in ' + F + ' :: ' + a.slice(0, 50)); process.exit(1); } s = s.replace(a, b); }
  fs.writeFileSync(F, s); console.log('patched ' + F);
}
// music.ts — clearer intensity→energy band + intensity-aware ordering + title
patch('src/lib/music.ts', [
  ["function targetEnergy(p: GenParams): [number, number] {\n  if (p.mode === 'mobility') return [1, 2];\n  if (p.mode === 'hiit') return [4, 5];\n  if (p.mode === 'cardio') return p.intensity >= 2 ? [4, 5] : [3, 4];\n  // strength\n  return p.intensity >= 3 ? [4, 5] : p.intensity === 2 ? [3, 5] : [3, 4];\n}",
   "function targetEnergy(p: GenParams): [number, number] {\n  if (p.mode === 'mobility') return p.intensity >= 3 ? [2, 3] : [1, 2];\n  const band: Record<number, [number, number]> = { 1: [2, 3], 2: [3, 4], 3: [4, 5] };\n  const bump = p.mode === 'hiit' ? 1 : 0; // HIIT skews a notch harder\n  const lo = Math.min(5, band[p.intensity][0] + bump);\n  const hi = Math.min(5, band[p.intensity][1] + bump);\n  return [lo, hi];\n}"],
  ["  const sorted = [...pool].sort((a, b) => (p.mode === 'mobility' ? a.bpm - b.bpm : b.energy - a.energy || b.bpm - a.bpm));",
   "  // Easy / mobility → calmest & slowest first; moderate / hard → hardest & fastest first.\n  const calm = p.mode === 'mobility' || p.intensity === 1;\n  const sorted = [...pool].sort((a, b) => (calm ? (a.energy - b.energy || a.bpm - b.bpm) : (b.energy - a.energy || b.bpm - a.bpm)));"],
  ["    title: `${MODE_LABEL[p.mode]} — ${p.minutes} min`,",
   "    title: `${MODE_LABEL[p.mode]} · ${intensityWord} — ${p.minutes} min`,"],
]);
// music.tsx — auto-regenerate the shown playlist when mode/intensity/length change
patch('app/(client)/music.tsx', [
  ["  const generate = (nextSalt = salt, nextIntensity = intensity) => {",
   "  // When a playlist is on screen, changing mode/intensity/length re-matches it live.\n  useEffect(() => { setPl((cur) => cur ? generatePlaylist({ mode, intensity, minutes }, salt) : cur); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode, intensity, minutes]);\n  const generate = (nextSalt = salt, nextIntensity = intensity) => {"],
]);
