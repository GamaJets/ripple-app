// Identifying a gym machine from a QR payload or a photographed label.
//
// There was no test file for this module at all, and that is half of why the
// defect below survived: the other half is that `identifyMachine` returned the
// FIRST catalogue entry whose name or any key was a substring of the input in
// either direction, and `Rowing Machine` leads the catalogue carrying the bare
// key 'row'. So every barbell row, cable row and upright row resolved to a
// rowing machine, and 'Cycling' — the one thing a member actually reported —
// resolved to nothing at all, because the bike's key is 'cycle' and 'cycling'
// does not contain it.
//
// What makes a wrong answer expensive here rather than merely untidy: both call
// sites in app/(client)/scan-machine.tsx apply the match silently — exercise
// name, muscle group and the cardio flag — and the screen REMEMBERS it against
// that QR code, so the wrong machine comes back every time it is scanned. When
// identification fails the member is asked instead. Asking is cheap; being
// confidently wrong is not, and this file is written on that asymmetry.
//
// Compile with tsc, then run under plain node.
import { MACHINES, identifyMachine, looksLikeSerial } from './machines';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};
const nameOf = (s: string) => identifyMachine(s)?.name ?? null;
const groupOf = (s: string) => identifyMachine(s)?.group ?? null;

/* ── 1. the catalogue itself ──────────────────────────────────────────────── */

ok(MACHINES.length > 0, 'the catalogue is not empty');
{
  const names = MACHINES.map((m) => m.name);
  eq(new Set(names).size, names.length, 'every machine has a distinct name');
  for (const m of MACHINES) {
    ok(!!m.group, `${m.name} states a muscle group`);
    ok(m.name.trim() === m.name, `${m.name} has no stray whitespace`);
  }
}

// Every machine identifies as ITSELF. This is the floor: a catalogue that
// cannot recognise its own entries has nothing else worth testing.
for (const m of MACHINES) {
  eq(nameOf(m.name), m.name, `${m.name} identifies as itself`);
}

/* ── 2. the rows, which is the defect ─────────────────────────────────────── */

// A barbell row is a back exercise performed with a barbell. It is not a
// rowing machine, and before this rule it resolved to one — along with its
// muscle group, 'Full body · cardio', and its cardio flag.
eq(nameOf('Barbell Row'), null, 'a barbell row is not a rowing machine');
eq(nameOf('Bent Over Row'), null, 'nor is a bent-over row');
eq(nameOf('Upright Row'), null, 'nor an upright row');
eq(nameOf('Pendlay Row'), null, 'nor a pendlay row');

// Null here means the screen ASKS, which is the right outcome for a barbell
// movement that is not in a machine catalogue at all. It is not a failure.

// But a machine row still resolves, and to the BACK machine rather than to the
// cardio one, because 'cable row' explains most of the label and 'row' does not.
eq(groupOf('Seated Cable Row'), 'Back', 'a seated cable row is a back machine');
eq(nameOf('Seated Row'), 'Seated Row', 'and the seated row resolves to itself');

// The rower itself, by every name a gym puts on one.
eq(nameOf('Rowing Machine'), 'Rowing Machine', 'the rower resolves by its name');
eq(nameOf('Rower'), 'Rowing Machine', 'and by the short name');
eq(nameOf('row'), 'Rowing Machine', 'and a label that is only the word row');
eq(nameOf('Concept2'), 'Rowing Machine', 'and by its maker');

/* ── 3. the bike, which is what was reported ──────────────────────────────── */

// 'cycling' does not contain 'cycle'. That is the whole bug, and it meant the
// activity a member was actually doing matched nothing in the catalogue.
eq(groupOf('Cycling'), 'Legs · cardio', 'cycling is a bike');
eq(groupOf('Cycle'), 'Legs · cardio', 'and so is cycle');
eq(groupOf('Stationary Bike'), 'Legs · cardio', 'and a stationary bike');
eq(groupOf('Spin Bike'), 'Legs · cardio', 'and a spin bike');

// An air bike is its own machine and must not be swallowed by the upright one.
eq(nameOf('Assault Bike'), 'Air Bike', 'an assault bike is an air bike');
eq(nameOf('Echo Bike'), 'Air Bike', 'and so is an echo bike');

/* ── 4. specific beats loose, generally ───────────────────────────────────── */

// A key may only claim a label it explains a real share of. These are the cases
// where a short key sits inside a longer, different movement.
eq(nameOf('Leg Curl'), 'Leg Curl', 'leg curl is its own machine, not a bicep curl');
eq(nameOf('Chest Press'), 'Chest Press', 'chest press is not a shoulder press');
eq(groupOf('Leg Press'), 'Legs · quads', 'and a leg press is legs');

/* ── 5. serials, and the difference between no answer and a wrong one ─────── */

ok(looksLikeSerial('O4-253182'), 'an asset tag is a serial');
ok(looksLikeSerial('SN-9931'), 'and so is a stock number');
eq(identifyMachine('O4-253182'), null, 'a serial identifies as nothing rather than as something');
eq(identifyMachine(''), null, 'and so does an empty label');
eq(identifyMachine('   '), null, 'and whitespace');

// A label with a machine word buried in a long asset string is not a confident
// match. The member is asked, and the screen remembers what they pick against
// that QR code — so the cost of asking is one tap, once, ever.
eq(nameOf('TECHNOGYM ARTIS ROW 700 ASSET 41822'), null, 'a long asset label is not resolved on one buried word');

if (errors.length) {
  console.error(`machines.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('machines.test.ts — ok');
