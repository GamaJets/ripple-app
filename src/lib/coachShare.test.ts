// What leaves the phone when a member talks to the AI Coach. Compile with tsc,
// run with node.
//
// The defect these hold shut: app/(client)/coach.tsx assembled a context object
// carrying the member's NAME, weight, body fat, skeletal muscle, sleep,
// readiness, progress-photo focus areas and `injurySummary(cd.injuries)` — and
// posted it, through the coach-chat edge function, to api.anthropic.com. There
// was no consent line and no disclaimer on that screen, and no way to use the
// coach without sending all of it.
//
// Two of these assertions are the ones that matter most, and neither is about
// the toggle. The first is that the injury NOTE never travels, in any state,
// with any answer — that note is seeded from the matched line off an uploaded
// physiotherapy report, and src/ui/injuryDocs.ts states the rule it would
// break. The second is that the filter is an ALLOWLIST: a field somebody adds
// to the screen tomorrow and forgets to declare here is not sent, and the test
// proves that rather than trusting it.
import {
  consentFromStored, storedConsent, shareableContext, sharedInjuries,
  FITNESS_KEYS, HEALTH_KEYS,
  ALWAYS_SENT, SENT_WITH_PERMISSION, NEVER_SENT,
  WITHHELD_NOTE, NOT_MEDICAL_ADVICE, WHERE_IT_GOES,
  weeklyFacts, REPORT_WITHHELD_NOTE, REPORT_CONSENT_TITLE, REPORT_CONSENT_BODY,
  type ShareConsent,
} from './coachShare';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the stored answer ─────────────────────────────────────────────────── */

eq(consentFromStored(storedConsent('yes')), 'yes', 'an answer of yes is written and read back as yes');
eq(consentFromStored(storedConsent('no')), 'no', 'and an answer of no survives the round trip too');

// Nothing stored is a question still to put, NOT a no. The difference decides
// whether the screen shows the explanation or the chat.
eq(consentFromStored(null), 'unasked', 'a device that has never been asked has not answered');
eq(consentFromStored(undefined), 'unasked', 'however the read came back empty');

// Damage falls to "ask again", and it falls the OPPOSITE way to
// pushConsent.ts's reader, which defaults a corrupt blob to yes because the
// product default for notifications is on. There is no product default for
// somebody's medical data.
eq(consentFromStored('{not json'), 'unasked', 'a blob that will not parse is not an answer');
eq(consentFromStored('null'), 'unasked', 'and neither is a parsed null');
eq(consentFromStored('[]'), 'unasked', 'nor an array');
eq(consentFromStored('"yes"'), 'unasked', 'nor the word yes on its own');
eq(consentFromStored('{"shareHealth":"true"}'), 'unasked',
  'the string "true" is damage, not consent — only a real boolean counts');
eq(consentFromStored('{"somethingElse":true}'), 'unasked', 'a blob from a version that stored a different key has not answered this question');

/* ── nothing goes out without an answer ────────────────────────────────── */

const FULL: Record<string, unknown> = {
  // Identity. Was the first field of the object that went to the model.
  name: 'Sarah Whitfield',
  email: 'sarah@example.com',
  // Fitness.
  coaching: 'training alone', goal: 'lose fat', diet: 'omnivore', mealsPerDay: 4,
  kcal: 2100, protein: 160, carbs: 200, fat: 70,
  programTitle: 'Cut · Upper/Lower', programFocus: 'Chest, Back',
  eatenToday: '1,200/2,100 kcal', streak: 12, lastTrained: 'Bench Press',
  nextLift: 'Bench Press: 62.5 kg x 6 (add weight)',
  // Health.
  weightKg: 68.4, bodyFatPct: 24, muscleKg: 26.1,
  readiness: '83/100 (good)', readinessGaps: 'No hydration was logged.',
  sleep: '6.2h average over 7 nights, 7 measured by a device',
  injuries: 'Left Knee (moderate)', focusAreas: 'glutes, shoulders',
};

eq(shareableContext(FULL, 'unknown'), null,
  'while the stored answer is still being read, nothing may be sent — the read is asynchronous and this window is real');
eq(shareableContext(FULL, 'unasked'), null,
  'and a member who has never been asked has not agreed to anything');

/* ── what goes on each answer ──────────────────────────────────────────── */

const no = shareableContext(FULL, 'no');
const yes = shareableContext(FULL, 'yes');
ok(no != null && yes != null, 'an answered consent produces a payload');

for (const k of FITNESS_KEYS) {
  ok(no != null && k in no, `no: ${k} still goes — declining health details must not break the coach`);
  ok(yes != null && k in yes, `yes: ${k} goes`);
}
for (const k of HEALTH_KEYS) {
  ok(no != null && !(k in no), `no: ${k} is withheld`);
  ok(yes != null && k in yes, `yes: ${k} goes`);
}

// The whole point, stated as one assertion a reader can check at a glance.
eq(no != null && 'weightKg' in no, false, 'a member who said no does not send their weight');
eq(no != null && 'sleep' in no, false, 'or their sleep');
eq(no != null && 'injuries' in no, false, 'or their injuries');

/* ── the allowlist, which is the part that survives the next edit ──────── */

for (const [label, payload] of [['no', no], ['yes', yes]] as const) {
  ok(payload != null && !('name' in payload), `${label}: the name is gone — this is what made the payload a named medical record`);
  ok(payload != null && !('email' in payload), `${label}: and so is anything else that says who they are`);
}

// A field nobody declared. This is the real test of an allowlist: it is about
// the code that has not been written yet.
const withNewField = shareableContext({ ...FULL, homeAddress: '12 Example Street' }, 'yes');
ok(withNewField != null && !('homeAddress' in withNewField),
  'a field added to the screen and not declared here is not transmitted — the default for anything new is "not sent"');

// Undefined is dropped rather than sent as a null the prompt would print.
const sparse = shareableContext({ goal: 'lose fat', streak: undefined }, 'no');
ok(sparse != null && !('streak' in sparse), 'an absent field is absent, not a null for the model to read as data');

// The two lists must not overlap: a key in both would be sent on 'no' while
// being described to the member as needing permission.
for (const k of HEALTH_KEYS) {
  ok(!(FITNESS_KEYS as readonly string[]).includes(k), `${k} is health-only and is not also in the always-sent list`);
}

/* ── the injury note never travels ─────────────────────────────────────── */

const NOTE = 'MRI 12/04: grade II medial meniscus tear, Dr A. Okonjo, hosp no. 88213';
const injuries: Injury[] = [
  { id: 'i1', area: 'knee', severity: 'moderate', status: 'active', note: NOTE, at: '2026-08-01T00:00:00Z' },
  { id: 'i2', area: 'shoulder', severity: 'mild', status: 'active', at: '2026-08-02T00:00:00Z' },
  { id: 'i3', area: 'ankle', severity: 'severe', status: 'recovered', note: 'old', at: '2026-01-01T00:00:00Z' },
];

const line = sharedInjuries(injuries);
eq(line, 'Knee (moderate); Shoulder (mild)', 'the area and how bad it is, and nothing else');
ok(!line.includes('MRI'), 'the document’s own words do not appear');
ok(!line.includes('Okonjo'), 'nor the clinician who wrote them');
ok(!line.includes('88213'), 'nor the hospital number');
ok(!line.includes('meniscus'), 'nor the diagnosis, which is the thing nobody consented to disclose by disclosing an injury');
ok(!/old/.test(line), 'and a recovered injury is not an active limitation, so it is not sent as one');
eq(sharedInjuries([]), '', 'nothing active produces nothing, and the caller decides what to say about that');
eq(sharedInjuries(), '', 'and an undefined list is the same');

// End to end: the note must not reach the payload on the permissive answer
// either. Consent gates whether the injury goes at all; there is no answer that
// unlocks the note.
const withInjuries = shareableContext({ ...FULL, injuries: sharedInjuries(injuries) }, 'yes');
ok(withInjuries != null && !JSON.stringify(withInjuries).includes('meniscus'),
  'even the member who agreed to share their injuries does not send the report’s words');

/* ── the member is told the truth, and it is the same truth ────────────── */

ok(ALWAYS_SENT.length > 0 && SENT_WITH_PERMISSION.length > 0 && NEVER_SENT.length > 0,
  'all three lists say something');
ok(NEVER_SENT.some((s) => /name/i.test(s)), 'the never-sent list names the name, because that is the field that was there and is now gone');
ok(NEVER_SENT.some((s) => /note|document/i.test(s)), 'and the injury note, because that is the rule this was breaking');
ok(ALWAYS_SENT.some((s) => /what you type/i.test(s)),
  'and the always-sent list starts with the obvious one — a chat sends what you typed, and a disclosure that omits it looks like it is hiding something');
ok(/Anthropic|Claude/.test(WHERE_IT_GOES), 'where it goes is named rather than described as "our systems"');

// The withheld note has to state the consequence rather than reassure. "Some
// answers may be less personalised" is the sentence that gets written by
// default and it is not enough to decide on.
ok(/injur/i.test(WITHHELD_NOTE), 'turning it off says what happens to injuries, which is the consequence that can hurt somebody');
ok(!/personalis|personaliz/i.test(WITHHELD_NOTE), 'and does not hide behind "less personalised"');
ok(/doctor|physio/i.test(NOT_MEDICAL_ADVICE), 'the disclaimer sends people to a professional');

// A consent is not a consent if it can only be given. Both answers have to be
// representable and both have to produce a working coach.
const both: ShareConsent[] = ['yes', 'no'];
for (const c of both) ok(shareableContext(FULL, c) != null, `${c} is a usable answer, not just the one we wanted`);


/* ── the Weekly Report's half of the same door ──────────────────────────────
 *
 * app/(client)/report.tsx posted the week's fact list to a language model with
 * `{ week: range, name: c.name }` beside it and no consent question anywhere on
 * the screen — a step worse than the coach screen had been, because the name
 * had already been taken out of that payload for exactly this reason.
 */

const FITNESS = [
  'Week of 26 Aug – 1 Sep.',
  'Trained 4 time(s) across 3 active day(s).',
  'Streak 9 day(s).',
];
const HEALTH = [
  'Weight 82.4 kg (down 1.2 kg overall), body fat 19%, muscle 34.1 kg.',
  'Waist 84 cm (down 1 cm since the previous tape reading).',
  'Check-in energy 4/5, sleep 3/5, mood 4/5, adherence 5/5.',
];

eq(weeklyFacts(FITNESS, HEALTH, 'unknown'), null,
  'nothing is written from a week before the stored answer has been read');
eq(weeklyFacts(FITNESS, HEALTH, 'unasked'), null,
  'and nothing before the question has been put at all');

const noWeek = weeklyFacts(FITNESS, HEALTH, 'no')!;
const yesWeek = weeklyFacts(FITNESS, HEALTH, 'yes')!;

ok(noWeek.length === FITNESS.length, 'a declined answer sends the training half and only that');
for (const h of HEALTH) {
  ok(!noWeek.includes(h), `no health line survives a declined answer — ${h}`);
}
ok(!noWeek.join(' ').includes('82.4'), 'no weight reaches a model that was told not to have it');
ok(!noWeek.join(' ').includes('19%'), 'nor a body fat percentage');
ok(!noWeek.join(' ').includes('sleep'), 'nor how they slept');

for (const line of [...FITNESS, ...HEALTH]) {
  ok(yesWeek.includes(line), `a yes sends everything the screen offered — ${line}`);
}

// Every branch of the screen's list is `cond ? line : ''`, so an empty string
// is a normal value here and a blank fact line is not.
const withBlanks = weeklyFacts(['a fact.', '', '   '], ['', 'another.'], 'yes')!;
eq(withBlanks.length, 2, 'blank lines are dropped rather than sent as facts');

// The name. This is the whole of the item: `askAboutMyWeek` sends no context
// object at all, so the only way a name could travel is inside a fact line, and
// nothing in this function puts one there.
const named = weeklyFacts(['Sarah trained 4 times.'], [], 'yes')!;
eq(named.length, 1, 'this function does not invent or strip prose — the screen owns what it writes');
ok(!JSON.stringify(weeklyFacts(FITNESS, HEALTH, 'yes')).includes('name'),
  'and nothing keyed "name" is added on the way through');

ok(/training only/i.test(REPORT_WITHHELD_NOTE),
  'declining says the summary is still written, from the training half');
ok(/yours to read/i.test(REPORT_WITHHELD_NOTE),
  'and that the figures on the screen are unaffected');
ok(!/personalis|personaliz/i.test(REPORT_WITHHELD_NOTE),
  'and does not hide behind "less personalised"');
ok(String(REPORT_CONSENT_TITLE).length > 10 && String(REPORT_CONSENT_BODY).length > 80,
  'the question put on the report is a real explanation rather than a label');
ok(/language model/i.test(REPORT_CONSENT_BODY),
  'and it names what the paragraph actually is before anybody agrees to it');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`coachShare: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('coachShare: ok (no name, no injury note, nothing at all until the member has answered, and the answer can be no)');
