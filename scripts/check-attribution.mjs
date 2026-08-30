// Prove every app that ships the RepDB catalogue actually credits it.
//
// The exercise catalogue — 601 illustrated movements, every description, the
// naming itself — is licensed under a free tier whose one condition is a
// visible credit. Breaching it is not a bug that degrades a feature; it is
// using somebody's work without the thing they asked for in return, and the
// way it will happen is nobody deciding to. Somebody rewrites a settings
// screen, the credit goes with it, and no test notices because nothing is
// broken.
//
// So this checks the three things that must all be true together:
//
//   1. every app variant that reads the exercise catalogue renders
//      <RepdbAttribution/> somewhere;
//   2. the credit string is the exact wording the licence asks for;
//   3. the string is reachable — the component is actually imported and used,
//      not merely defined.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const CREDIT = 'Exercise data by RepDB (repdb.co)';
const COMPONENT = 'RepdbAttribution';
// Every variant the app ships as its own binary. A variant that renders the
// catalogue and not the credit is the failure this exists for.
const APPS = ['client', 'trainer', 'owner'];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const problems = [];

// 1. the wording, at its source
const src = readFileSync(join(ROOT, 'src/ui/Attribution.tsx'), 'utf8');
if (!src.includes(CREDIT)) {
  problems.push(
    `src/ui/Attribution.tsx no longer contains the exact credit "${CREDIT}". `
    + 'The licence asks for that wording; a paraphrase is not it.',
  );
}

// 2. each variant that uses the catalogue must render the component
const CATALOGUE_USE = /useExerciseCatalogue|useExerciseDetail|from '\.\.\/\.\.\/src\/ui\/exerciseDetail'/;
for (const app of APPS) {
  const dir = join(ROOT, `app/(${app})`);
  const files = walk(dir);
  if (!files.length) continue;
  const usesCatalogue = files.some((f) => CATALOGUE_USE.test(readFileSync(f, 'utf8')));
  if (!usesCatalogue) continue;
  const credits = files.some((f) => {
    const s = readFileSync(f, 'utf8');
    // Imported AND rendered. A file that imports it and never puts it on screen
    // satisfies a grep and not the licence.
    return s.includes(COMPONENT) && new RegExp(`<${COMPONENT}\\s*/?>`).test(s);
  });
  if (!credits) {
    problems.push(
      `app/(${app}) reads the exercise catalogue but never renders <${COMPONENT}/>. `
      + 'The RepDB free tier is free because of that credit — without it this build is unlicensed.',
    );
  }
}

if (problems.length) {
  console.error(`${problems.length} attribution problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log(`attribution ok — every app shipping the exercise catalogue renders the RepDB credit, verbatim.`);
