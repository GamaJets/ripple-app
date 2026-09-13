// Do package.json and package-lock.json agree about what this app depends on?
//
// ── The build this exists to stop ─────────────────────────────────────────
//
// A lane added `qrcode-generator` to package.json and nothing wrote it into
// package-lock.json. Everything local kept working, because `npm install` had
// already put the package in node_modules and nothing on this machine reads
// the lock again afterwards. Then an owner ran `eas build`, EAS ran
// `npm ci --include=dev`, and it refused in the Install dependencies phase:
//
//   npm error `npm ci` can only install packages when your package.json and
//   npm error package-lock.json are in sync.
//   npm error Missing: qrcode-generator@1.5.0 from lock file
//
// The build number had already been incremented, credentials had already been
// synced with Apple, and 170 MB had already been uploaded. The failure message
// EAS surfaces first is "Unknown error. See logs of the Install dependencies
// build phase", which names neither the package nor the cause.
//
// It is invisible locally by construction: the whole point of a lockfile is
// that the machine which wrote it does not need to read it.
//
// ── What this checks, and what it does not ────────────────────────────────
//
// Every name in `dependencies`, `devDependencies` and `optionalDependencies`
// must appear in the lock's root `packages[""]` block with the SAME spec
// string. That catches the two shapes that actually happen: a dependency added
// to one file and not the other, and a version edited by hand in package.json.
//
// It does NOT resolve the tree. A lock whose transitive dependencies are stale
// still passes here and can still fail `npm ci` — that needs npm itself, which
// is what `npm ci --dry-run` is for and what this deliberately is not, because
// it must run in under a second on every change.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const root = lock.packages?.[''] ?? {};

const problems = [];
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  const declared = pkg[field] ?? {};
  const locked = root[field] ?? {};
  for (const [name, spec] of Object.entries(declared)) {
    if (!(name in locked)) {
      problems.push(`  ${name}@${spec}\n    in package.json ${field}, absent from the lockfile — npm ci will refuse the build`);
    } else if (locked[name] !== spec) {
      problems.push(`  ${name}\n    package.json says ${spec}, the lockfile says ${locked[name]} — npm ci compares these as strings`);
    }
  }
  for (const name of Object.keys(locked)) {
    if (!(name in declared)) {
      problems.push(`  ${name}\n    in the lockfile's ${field}, absent from package.json — a removal that was not locked`);
    }
  }
}

if (problems.length) {
  console.error(`\n${problems.length} dependency disagreement${problems.length === 1 ? '' : 's'} between package.json and package-lock.json:\n`);
  console.error(problems.join('\n'));
  console.error(`\nEAS runs \`npm ci --include=dev\`, which refuses outright rather than`);
  console.error(`reconciling. Run \`npm install\` and commit BOTH files.\n`);
  process.exit(1);
}

const n = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
console.log(`check-lockfile — ok, ${n} declared dependencies all match the lockfile`);
