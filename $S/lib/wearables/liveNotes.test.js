"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The Live Today panel's copy, asked the questions an Android member would ask.
//
// The defect being guarded: the panel is gated on ANY provider being connected
// and its empty state named an Apple Watch and an iPhone. `./registry.ts` lists
// Google Fit / Health Connect as connectable and reading five metrics, and
// WHOOP as reading no steps at all. So the two assertions that matter here are
// negative ones: no sentence this module produces may name a device the member
// has not connected, and no sentence may promise a metric the connected device
// does not report.
const liveNotes_1 = require("./liveNotes");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
// The four rows from src/lib/wearables/registry.ts that can actually connect,
// copied field for field. Copied rather than imported because importing the
// registry pulls in Apple HealthKit's provider, which reaches for a native
// module; these are the catalogue's own words either way.
const apple = {
    id: 'apple', name: 'Apple Watch', icon: '⌚', kind: 'healthkit',
    blurb: 'Heart rate, calories, steps & workouts via Apple Health',
    metrics: ['Heart rate', 'Active calories', 'Steps', 'Resting HR', 'Workouts'],
};
const whoop = {
    id: 'whoop', name: 'WHOOP', icon: '🔴', kind: 'cloud',
    blurb: 'Strain, recovery, sleep & heart rate via the WHOOP API',
    metrics: ['Strain', 'Recovery', 'Sleep', 'Heart rate', 'Calories'],
};
const oura = {
    id: 'oura', name: 'Oura Ring', icon: '💍', kind: 'cloud',
    blurb: 'Readiness, HRV & sleep via the Oura API',
    metrics: ['Readiness', 'HRV', 'Sleep', 'Resting HR'],
};
const hc = {
    id: 'googlefit', name: 'Google Fit / Health Connect', icon: '🟢', kind: 'health-connect',
    blurb: 'Android’s health store',
    metrics: ['Steps', 'Heart rate', 'Calories', 'Workouts', 'Sleep'],
};
/* ── what a device reports, read off the catalogue ───────────────────────── */
{
    ok((0, liveNotes_1.reportsMetric)(apple, 'steps'), 'Apple Watch reports steps');
    ok((0, liveNotes_1.reportsMetric)(hc, 'steps'), 'and so does Health Connect');
    ok(!(0, liveNotes_1.reportsMetric)(whoop, 'steps'), 'WHOOP does not report steps, and never has');
    ok(!(0, liveNotes_1.reportsMetric)(oura, 'steps'), 'nor does an Oura ring');
    ok((0, liveNotes_1.reportsMetric)(whoop, 'heartRate'), 'WHOOP reports heart rate');
    ok((0, liveNotes_1.reportsMetric)(oura, 'heartRate'), 'and Resting HR counts as heart rate');
    ok((0, liveNotes_1.reportsMetric)(whoop, 'energy'), 'WHOOP reports calories');
    ok((0, liveNotes_1.reportsMetric)(apple, 'energy'), 'and Active calories is energy too');
    eq((0, liveNotes_1.providersFor)([whoop, apple, oura], 'steps').map((m) => m.id), ['apple'], 'only the ones that report it are named');
}
/* ── the Android member, who is the whole point ──────────────────────────── */
{
    const note = (0, liveNotes_1.awaitingNote)('heartRate', [hc]);
    ok(!/Apple/i.test(note), `NO APPLE DEVICE MAY BE NAMED TO AN ANDROID MEMBER — got "${note}"`);
    ok(!/iPhone/i.test(note), `nor an iPhone — got "${note}"`);
    ok(note.includes('Google Fit / Health Connect'), 'their own device is named instead');
    const steps = (0, liveNotes_1.awaitingNote)('steps', [hc]);
    ok(!/Apple|iPhone/i.test(steps), `and the steps row is the same — got "${steps}"`);
    const foot = (0, liveNotes_1.liveFootnote)([hc]);
    ok(!/Apple|iPhone/i.test(foot), `the footnote too — got "${foot}"`);
    ok(foot.includes('Google Fit / Health Connect'), 'and it names what is actually feeding the panel');
    eq((0, liveNotes_1.permissionsNote)([hc], 'Repple'), 'Manage what Repple can read in Health Connect ▸ App permissions ▸ Repple.', 'and the permission instruction points at the store Android actually uses');
}
/* ── the WHOOP-only member, told to wear a watch harder ──────────────────── */
{
    const steps = (0, liveNotes_1.awaitingNote)('steps', [whoop]);
    ok(!/Apple|iPhone/i.test(steps), `no Apple hardware for a WHOOP member either — got "${steps}"`);
    ok(steps.includes('WHOOP') && steps.includes('not report'), `the honest answer is that the device does not report steps — got "${steps}"`);
    ok(!/yet today/.test(steps), 'and never "not in yet", which would have them waiting for a figure that is not coming');
    const hr = (0, liveNotes_1.awaitingNote)('heartRate', [whoop]);
    ok(hr.includes('WHOOP') && hr.includes('yet today'), `heart rate IS reported, so the answer is that it has not arrived — got "${hr}"`);
    eq((0, liveNotes_1.permissionsNote)([whoop], 'Repple'), 'Manage what Repple can read in your WHOOP account settings.', 'and a cloud connection is managed at the vendor, not in a phone health store');
}
/* ── the iPhone member, who must not be made worse off ───────────────────── */
{
    const hr = (0, liveNotes_1.awaitingNote)('heartRate', [apple]);
    ok(hr.includes('Apple Watch'), 'an Apple member is still told about their Apple Watch');
    eq((0, liveNotes_1.permissionsNote)([apple], 'Repple'), 'Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.', 'and Apple Health is still where the permission lives');
    // A phone health store wins over a cloud account when both are connected:
    // it is the one that can silently withhold a metric.
    eq((0, liveNotes_1.permissionsNote)([whoop, apple], 'Repple'), 'Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.', 'with both connected, the phone store is the one that gates the read');
}
/* ── several devices, and none ───────────────────────────────────────────── */
{
    eq((0, liveNotes_1.namesOf)([]), '', 'no devices is no phrase at all');
    eq((0, liveNotes_1.namesOf)([apple]), 'Apple Watch', 'one device is its name');
    eq((0, liveNotes_1.namesOf)([apple, whoop]), 'Apple Watch and WHOOP', 'two are joined with "and"');
    eq((0, liveNotes_1.namesOf)([apple, whoop, oura]), 'Apple Watch, WHOOP and Oura Ring', 'three take a comma and an "and"');
    const both = (0, liveNotes_1.awaitingNote)('steps', [whoop, apple, hc]);
    ok(!both.includes('WHOOP'), `a device that cannot report steps is not named in a note about waiting for steps — got "${both}"`);
    ok(both.includes('Apple Watch') && both.includes('Google Fit / Health Connect'), 'the two that can are');
    ok((0, liveNotes_1.awaitingNote)('steps', []).length > 0, 'nothing connected still gets a sentence');
    ok(!/Apple|iPhone|WHOOP/i.test((0, liveNotes_1.awaitingNote)('steps', [])), 'and it names no brand at all');
    eq((0, liveNotes_1.permissionsNote)([], 'Repple'), null, 'and no permission instruction about a permission nobody granted');
    ok((0, liveNotes_1.liveFootnote)([]).length > 0, 'the footnote survives an empty list rather than reading as a blank line');
}
/* ── the copy rules this app holds every string to ───────────────────────── */
{
    const all = [
        (0, liveNotes_1.awaitingNote)('heartRate', [apple]), (0, liveNotes_1.awaitingNote)('steps', [whoop]),
        (0, liveNotes_1.awaitingNote)('energy', [oura]), (0, liveNotes_1.awaitingNote)('steps', [hc]),
        (0, liveNotes_1.awaitingNote)('steps', []), (0, liveNotes_1.liveFootnote)([apple, whoop]), (0, liveNotes_1.liveFootnote)([]),
        (0, liveNotes_1.permissionsNote)([apple], 'Repple'), (0, liveNotes_1.permissionsNote)([hc], 'Repple'),
    ];
    for (const s of all) {
        ok(!s.includes(' — '), `no dash inside a sentence: "${s}"`);
        ok(/[.]$/.test(s), `every sentence ends in a full stop: "${s}"`);
        ok(!s.includes('undefined') && !s.includes('null'), `nothing interpolated a hole: "${s}"`);
    }
}
if (errors.length) {
    console.error(`liveNotes: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('liveNotes: ok — the panel names the device the member actually connected');
