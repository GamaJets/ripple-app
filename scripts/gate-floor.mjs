// The empty-set guard, per ROOT rather than per run.
//
// ── Why this file exists ──────────────────────────────────────────────────
//
// Six gates in this directory scan the same five roots — `app`, `src`,
// `studio-web/app`, `studio-web/lib`, `studio-web/components` — and each one
// guards the scan with the same line:
//
//     if (files.length < 150) { …refusing to pass… }
//
// Those five roots hold 781 non-test files. 150 is 19% of that, which means
// the guard cannot notice the loss of a ROOT. Delete `src` from the list and
// 566 files stop being read; 215 remain; the gate prints `ok, 215 files`. For
// `check-frozen-day` that is worse than it sounds: all four of the defects
// named in its own header live under `app/`, so dropping `app` (161 files)
// leaves 620 — comfortably over 150 — and the gate then scans none of the code
// it was written for and says so in a sentence somebody quotes.
//
// A total threshold catches a TYPO in a root name. It does not catch a root
// going missing, because the other roots cover for it. So the floor is per
// root: every root a gate names must produce a plausible number of files of
// its own, or the run refuses.
//
// ── The numbers ───────────────────────────────────────────────────────────
//
// FLOORS below are roughly half of what each root actually held on 3 September
// 2026, rounded down. Half, and not the real count, because these trees are
// written to daily and a gate that fails on a deleted screen is a gate people
// start passing `--force` to. Half is far enough below the truth to be quiet
// and far enough above zero that a root which has moved, been renamed, or been
// dropped from a ROOTS array cannot go unnoticed.
//
// If a root genuinely shrinks past its floor, lower the number here — in one
// place, with a reason — rather than in the gate that tripped.

/** Non-test source files per root, 3 September 2026 → floor at ~half. */
const FLOORS = {
  'app': 80,                        // 161
  'src': 280,                       // 566
  'src/lib': 200,                   // 401
  'src/ui': 80,                     // 163
  'studio-web/app': 18,             // 37
  'studio-web/lib': 5,              // 10
  'studio-web/components': 3,       // 7
  'supabase/functions': 12,         // 25
  'supabase/parts': 130,            // 276
  'scripts': 20,                    // 52
  // Not source files: web/ is the static site, and the count is its *.html
  // pages. It is here rather than in a guard of its own because the failure is
  // identical — a gate that walked the wrong directory reporting the whole site
  // correct — and one floor per root beats a second convention.
  'web': 10,                        // 21
};

/**
 * Refuse the run unless every root produced its floor.
 *
 * @param {string} gate    the npm script name, for the message
 * @param {Map<string, number>|Record<string, number>} counts  root → files found
 */
export function assertRootFloors(gate, counts) {
  const entries = counts instanceof Map ? [...counts] : Object.entries(counts);
  const short = [];
  for (const [root, n] of entries) {
    const floor = FLOORS[root];
    if (floor == null) continue;    // a root nobody has measured yet; not this file's business
    if (n < floor) short.push({ root, n, floor });
  }
  if (!short.length) return;
  console.error(`${gate}: a root this check names produced almost no files, so whatever it is `
    + 'about to print would be a claim about a tree it never opened.\n');
  for (const s of short) {
    console.error(`  ${s.root}: found ${s.n} file${s.n === 1 ? '' : 's'}, expected at least ${s.floor}`);
  }
  console.error('\nRun from the repository root. If the root has genuinely moved or shrunk, '
    + 'change the floor in scripts/gate-floor.mjs — not the gate.');
  process.exit(1);
}
