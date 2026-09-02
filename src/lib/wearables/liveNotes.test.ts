// The Live Today panel's copy, asked the questions an Android member would ask.
//
// The defect being guarded: the panel is gated on ANY provider being connected
// and its empty state named an Apple Watch and an iPhone. `./registry.ts` lists
// Google Fit / Health Connect as connectable and reading five metrics, and
// WHOOP as reading no steps at all. So the two assertions that matter here are
// negative ones: no sentence this module produces may name a device the member
// has not connected, and no sentence may promise a metric the connected device
// does not report.
import {
  awaitingNote, liveFootnote, namesOf, permissionsNote, providersFor, reportsMetric,
} from './liveNotes';
import type { ProviderMeta } from './types';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// The four rows from src/lib/wearables/registry.ts that can actually connect,
// copied field for field. Copied rather than imported because importing the
// registry pulls in Apple HealthKit's provider, which reaches for a native
// module; these are the catalogue's own words either way.
const apple: ProviderMeta = {
  id: 'apple', name: 'Apple Watch', icon: '⌚', kind: 'healthkit',
  blurb: 'Heart rate, calories, steps & workouts via Apple Health',
  metrics: ['Heart rate', 'Active calories', 'Steps', 'Resting HR', 'Workouts'],
};
const whoop: ProviderMeta = {
  id: 'whoop', name: 'WHOOP', icon: '🔴', kind: 'cloud',
  blurb: 'Strain, recovery, sleep & heart rate via the WHOOP API',
  metrics: ['Strain', 'Recovery', 'Sleep', 'Heart rate', 'Calories'],
};
const oura: ProviderMeta = {
  id: 'oura', name: 'Oura Ring', icon: '💍', kind: 'cloud',
  blurb: 'Readiness, HRV & sleep via the Oura API',
  metrics: ['Readiness', 'HRV', 'Sleep', 'Resting HR'],
};
const hc: ProviderMeta = {
  id: 'googlefit', name: 'Google Fit / Health Connect', icon: '🟢', kind: 'health-connect',
  blurb: 'Android’s health store',
  metrics: ['Steps', 'Heart rate', 'Calories', 'Workouts', 'Sleep'],
};

/* ── what a device reports, read off the catalogue ───────────────────────── */

{
  ok(reportsMetric(apple, 'steps'), 'Apple Watch reports steps');
  ok(reportsMetric(hc, 'steps'), 'and so does Health Connect');
  ok(!reportsMetric(whoop, 'steps'), 'WHOOP does not report steps, and never has');
  ok(!reportsMetric(oura, 'steps'), 'nor does an Oura ring');
  ok(reportsMetric(whoop, 'heartRate'), 'WHOOP reports heart rate');
  ok(reportsMetric(oura, 'heartRate'), 'and Resting HR counts as heart rate');
  ok(reportsMetric(whoop, 'energy'), 'WHOOP reports calories');
  ok(reportsMetric(apple, 'energy'), 'and Active calories is energy too');
  eq(providersFor([whoop, apple, oura], 'steps').map((m) => m.id), ['apple'],
    'only the ones that report it are named');
}

/* ── the Android member, who is the whole point ──────────────────────────── */

{
  const note = awaitingNote('heartRate', [hc]);
  ok(!/Apple/i.test(note), `NO APPLE DEVICE MAY BE NAMED TO AN ANDROID MEMBER — got "${note}"`);
  ok(!/iPhone/i.test(note), `nor an iPhone — got "${note}"`);
  ok(note.includes('Google Fit / Health Connect'), 'their own device is named instead');

  const steps = awaitingNote('steps', [hc]);
  ok(!/Apple|iPhone/i.test(steps), `and the steps row is the same — got "${steps}"`);

  const foot = liveFootnote([hc]);
  ok(!/Apple|iPhone/i.test(foot), `the footnote too — got "${foot}"`);
  ok(foot.includes('Google Fit / Health Connect'), 'and it names what is actually feeding the panel');

  eq(permissionsNote([hc], 'Repple'),
    'Manage what Repple can read in Health Connect ▸ App permissions ▸ Repple.',
    'and the permission instruction points at the store Android actually uses');
}

/* ── the WHOOP-only member, told to wear a watch harder ──────────────────── */

{
  const steps = awaitingNote('steps', [whoop]);
  ok(!/Apple|iPhone/i.test(steps), `no Apple hardware for a WHOOP member either — got "${steps}"`);
  ok(steps.includes('WHOOP') && steps.includes('not report'),
    `the honest answer is that the device does not report steps — got "${steps}"`);
  ok(!/yet today/.test(steps),
    'and never "not in yet", which would have them waiting for a figure that is not coming');

  const hr = awaitingNote('heartRate', [whoop]);
  ok(hr.includes('WHOOP') && hr.includes('yet today'),
    `heart rate IS reported, so the answer is that it has not arrived — got "${hr}"`);

  eq(permissionsNote([whoop], 'Repple'),
    'Manage what Repple can read in your WHOOP account settings.',
    'and a cloud connection is managed at the vendor, not in a phone health store');
}

/* ── the iPhone member, who must not be made worse off ───────────────────── */

{
  const hr = awaitingNote('heartRate', [apple]);
  ok(hr.includes('Apple Watch'), 'an Apple member is still told about their Apple Watch');
  eq(permissionsNote([apple], 'Repple'),
    'Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.',
    'and Apple Health is still where the permission lives');
  // A phone health store wins over a cloud account when both are connected:
  // it is the one that can silently withhold a metric.
  eq(permissionsNote([whoop, apple], 'Repple'),
    'Manage what Repple can read in Apple Health ▸ Sharing ▸ Repple.',
    'with both connected, the phone store is the one that gates the read');
}

/* ── several devices, and none ───────────────────────────────────────────── */

{
  eq(namesOf([]), '', 'no devices is no phrase at all');
  eq(namesOf([apple]), 'Apple Watch', 'one device is its name');
  eq(namesOf([apple, whoop]), 'Apple Watch and WHOOP', 'two are joined with "and"');
  eq(namesOf([apple, whoop, oura]), 'Apple Watch, WHOOP and Oura Ring', 'three take a comma and an "and"');

  const both = awaitingNote('steps', [whoop, apple, hc]);
  ok(!both.includes('WHOOP'),
    `a device that cannot report steps is not named in a note about waiting for steps — got "${both}"`);
  ok(both.includes('Apple Watch') && both.includes('Google Fit / Health Connect'),
    'the two that can are');

  ok(awaitingNote('steps', []).length > 0, 'nothing connected still gets a sentence');
  ok(!/Apple|iPhone|WHOOP/i.test(awaitingNote('steps', [])), 'and it names no brand at all');
  eq(permissionsNote([], 'Repple'), null, 'and no permission instruction about a permission nobody granted');
  ok(liveFootnote([]).length > 0, 'the footnote survives an empty list rather than reading as a blank line');
}

/* ── the copy rules this app holds every string to ───────────────────────── */

{
  const all = [
    awaitingNote('heartRate', [apple]), awaitingNote('steps', [whoop]),
    awaitingNote('energy', [oura]), awaitingNote('steps', [hc]),
    awaitingNote('steps', []), liveFootnote([apple, whoop]), liveFootnote([]),
    permissionsNote([apple], 'Repple')!, permissionsNote([hc], 'Repple')!,
  ];
  for (const s of all) {
    ok(!s.includes(' — '), `no dash inside a sentence: "${s}"`);
    ok(/[.]$/.test(s), `every sentence ends in a full stop: "${s}"`);
    ok(!s.includes('undefined') && !s.includes('null'), `nothing interpolated a hole: "${s}"`);
  }
}

if (errors.length) {
  console.error(`liveNotes: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('liveNotes: ok — the panel names the device the member actually connected');
