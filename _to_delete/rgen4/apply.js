const fs = require('fs');
const F = 'app/(client)/workouts.tsx';
let s = fs.readFileSync(F, 'utf8');
function rep(a, b) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('ANCHOR x' + n + ' :: ' + a.slice(0, 70)); process.exit(1); }
  s = s.replace(a, b);
}
// 1) derive today's cardio from the PERSISTED log (survives navigation)
rep(
  "  if (cardioLog.length) workedDates.add(dstr(today0));",
  "  if (cardioLog.length) workedDates.add(dstr(today0));\n" +
  "  // Today's cardio, read from the saved log so it persists across navigation (not just this mount).\n" +
  "  const todayCardio = workoutLog\n" +
  "    .filter((l) => l.cardio && dstr(new Date(l.t)) === dstr(today0))\n" +
  "    .map((l) => ({ type: l.exercise, mins: l.cardio!.mins, dist: l.cardio!.dist, unit: l.cardio!.unit, kcal: l.kcal ?? 0 }));"
);
// 2) render from the persisted-derived list
rep("{cardioLog.length > 0 && (", "{todayCardio.length > 0 && (");
rep("{cardioLog.map((c, i) => (", "{todayCardio.map((c, i) => (");
rep("borderBottomWidth: i < cardioLog.length - 1 ? 1 : 0", "borderBottomWidth: i < todayCardio.length - 1 ? 1 : 0");
fs.writeFileSync(F, s);
console.log('applied OK');
