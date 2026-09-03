"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Distance, in the unit the member measures it in.
//
// Compile with tsc, then run under plain node.
//
// Two defects behind this: a cardio log that opened on kilometres for everybody
// including the member who had just run five MILES, and an Apple Health preview
// that printed "km" over a figure whatever the phone was set to. So the
// assertions are about the two things that go wrong when a unit is assumed —
// a number labelled with the wrong word, and a number silently converted when
// it should have been left alone.
const distance_1 = require("./distance");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── 1. which unit, and where it comes from ───────────────────────────────── */
eq((0, distance_1.distanceUnitFor)('in'), 'mi', 'a member who reads their height in inches runs in miles');
eq((0, distance_1.distanceUnitFor)('cm'), 'km', 'and one who reads it in centimetres runs in kilometres');
/* ── 2. the conversion is the definition, not an approximation ────────────── */
eq(distance_1.KM_PER_MI, 1.609344, 'the mile is exactly 1609.344 m — the inch is 25.4 mm, and this is that times 63,360');
eq((0, distance_1.miToKm)(1), 1.609344, 'one mile is that many kilometres');
ok(Math.abs((0, distance_1.kmToMi)(1.609344) - 1) < 1e-12, 'and the trip back is the same mile');
/* ── 3. reading a measured distance out ───────────────────────────────────── */
eq((0, distance_1.distanceIn)(5, 'km'), 5, 'a metric reader gets the figure they were given');
eq((0, distance_1.distanceIn)(5, 'mi'), 3.11, 'and an imperial one gets it converted, to the hundredth');
eq((0, distance_1.distanceIn)(42.195, 'km'), 42.2, 'a marathon rounds to the hundredth like everything else');
eq((0, distance_1.distanceIn)(42.195, 'mi'), 26.22, 'in either unit');
// Null in, null out. A run nobody recorded is not a run of zero, and a zero
// would be printed as a distance the member did not cover.
eq((0, distance_1.distanceIn)(null, 'km'), null, 'nothing is nothing');
eq((0, distance_1.distanceIn)(undefined, 'mi'), null, 'and so is an absent figure');
eq((0, distance_1.distanceIn)(NaN, 'km'), null, 'and so is a NaN');
eq((0, distance_1.distanceLabel)(null, 'km'), null, 'the label withholds rather than printing a unit with nothing in front of it');
// A real zero is kept: a cardio entry with no distance stores 0, and 0 km is
// what a rowing machine session with no distance honestly is.
eq((0, distance_1.distanceIn)(0, 'km'), 0, 'a measured zero is a measured zero');
/* ── 4. the label, which is where the bug was visible ─────────────────────── */
eq((0, distance_1.distanceLabel)(5, 'km'), '5 km', 'no trailing zeroes — 5.00 km is a number nobody writes');
eq((0, distance_1.distanceLabel)(5, 'mi'), '3.11 mi', 'and the unit named is the unit the figure is in');
eq((0, distance_1.distanceLabel)(1.5, 'km'), '1.5 km', 'one decimal stays one decimal');
/* ── 5. metres, which is what a watch actually hands over ─────────────────── */
eq((0, distance_1.metresLabel)(5000, 'km'), '5 km', 'five thousand metres is five kilometres');
eq((0, distance_1.metresLabel)(5000, 'mi'), '3.11 mi', 'and 3.11 miles, which is the line the Apple Health preview could not say');
eq((0, distance_1.metresLabel)(null, 'km'), null, 'a session with no distance recorded prints nothing, not 0 km');
eq((0, distance_1.metresLabel)(1609.344, 'mi'), '1 mi', 'a mile of metres is one mile exactly');
/* ── 6. the words ─────────────────────────────────────────────────────────── */
eq((0, distance_1.distanceUnitName)('mi'), 'miles', 'a screen reader hears the word, not the abbreviation');
eq((0, distance_1.distanceUnitName)('km'), 'kilometres', 'in both units');
if (errors.length) {
    console.error(`distance.test.ts — ${errors.length} failure(s):`);
    for (const e of errors)
        console.error('  · ' + e);
    process.exit(1);
}
console.log('distance.test.ts — ok');
