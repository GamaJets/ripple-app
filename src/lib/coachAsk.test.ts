// What leaves the COACH's phone when they ask about a client. Compile with tsc,
// run with node.
//
// The defect these hold shut is the mirror image of the one coachShare.test.ts
// covers, and it was live: `draftNudge` and `genSummary` in
// app/(trainer)/dashboard.tsx posted a NAMED client's adherence, their
// body-composition scan (visceral fat, InBody score, lean and fat mass, a limb
// imbalance) and a list of what they had eaten, through the unfiltered
// `askCoach`, to api.anthropic.com. The member answered a consent question
// about their own AI Coach chat, on their own handset; it has never governed
// this path and nobody on the coach's screen can answer it for them.
//
// Three assertions carry the weight, and none of them is about a toggle:
//
//   1. the NAME never travels, in any shape, from either door;
//   2. no health measurement travels about a client — every key in
//      COACH_CLIENT_HEALTH is stated and every one is dropped, which is a much
//      stronger claim than the absence of a list would be and fails the day
//      somebody adds one of them to COACH_CLIENT_KEYS;
//   3. the filter is an ALLOWLIST, so a field somebody adds to a screen
//      tomorrow and forgets to declare is not sent.
import {
  businessAskContext, clientAskContext, fillName, sharedAreas, sharedInjuries,
  COACH_BUSINESS_KEYS, COACH_CLIENT_KEYS, COACH_CLIENT_HEALTH, NAME_TOKEN,
  COACH_ASK_WHAT_GOES, COACH_ASK_WHAT_NEVER_GOES, COACH_ASK_NOT_ADVICE,
} from './coachShare';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the client's identity does not go ─────────────────────────────────── */

// Deliberately the shape the dashboard actually assembled, plus the fields it
// would grow next.
const CLIENT: Record<string, unknown> = {
  name: 'Ana Ferreira',
  clientName: 'Ana Ferreira',
  firstName: 'Ana',
  email: 'ana@example.com',
  clientId: '11111111-2222-3333-4444-555555555555',
  phone: '+971500000000',
  // What may go.
  goal: 'Lose fat',
  adherence: '78%',
  lastActive: '3d ago',
  coachedMode: 'hybrid',
  programTitle: 'Push Pull Legs',
  injuryAreas: 'Knee (moderate)',
  reason: 'Adherence 78% — below target',
  // What may not.
  weightKg: 63.4,
  bodyFatPct: 27.1,
  muscleKg: 24.2,
  visceralFat: 6,
  inbodyScore: 74,
  leanMassKg: 46.2,
  fatMassKg: 17.2,
  limbImbalance: 'left arm 12% lighter',
  readiness: 61,
  readinessGaps: 'no sleep recorded',
  sleep: '6h 10m over 5 nights, 3 measured',
  focusAreas: 'midsection, upper back',
  injuries: 'Knee (moderate, "grade 2 MCL sprain per MRI 14/03")',
  injuryNote: 'grade 2 MCL sprain per MRI 14/03',
  recentMeals: 'chicken shawarma, protein shake, dates',
};

const sent = clientAskContext(CLIENT);

for (const k of ['name', 'clientName', 'firstName', 'email', 'clientId', 'phone']) {
  eq(sent[k], undefined, `a client's ${k} never reaches a language model`);
}

// The whole health list, stated. This is the assertion that fails the day
// somebody moves one of these into COACH_CLIENT_KEYS to make an answer better.
for (const k of COACH_CLIENT_HEALTH) {
  eq(sent[k], undefined, `${k} is a health measurement about somebody who was never asked, so it does not go`);
}

// And the injury NOTE in particular, which is seeded from the matched line off
// an uploaded physiotherapy report (src/lib/injuryExtract.ts) and breaks a rule
// src/ui/injuryDocs.ts states in so many words.
ok(!JSON.stringify(sent).includes('MCL'), 'nothing off an uploaded document survives the filter, in any field');
ok(!JSON.stringify(sent).includes('Ana'), 'and the name is not smuggled through in another value');

// What a coach IS entitled to send: the training facts they were given in order
// to coach, and the injury AREA, which is what stops a suggestion loading a bad
// knee.
eq(sent.goal, 'Lose fat', 'the goal goes — it is what makes the answer coaching');
eq(sent.adherence, '78%', 'and whether they are turning up');
eq(sent.injuryAreas, 'Knee (moderate)', 'and the injury AREA, which is the field that stops a bad suggestion');

/* ── the allowlist, proven rather than trusted ─────────────────────────── */

const INVENTED = { somethingNobodyDeclared: 'a field added to a screen next March', clientNames: ['Ana', 'Ben'] };
const withNew = clientAskContext({ ...CLIENT, ...INVENTED });
eq(withNew.somethingNobodyDeclared, undefined, 'a field nobody declared is dropped, which is what makes forgetting this file safe');
eq(withNew.clientNames, undefined, 'including the one somebody would add to make the assistant name people');

// Nothing is invented either: a key in the list but absent from the object does
// not arrive as null. The edge function's prompt already has a sentence for an
// absent field, and a literal null prints as data about the person.
const sparse = clientAskContext({ goal: 'Get stronger' });
eq(Object.prototype.hasOwnProperty.call(sparse, 'adherence'), false, 'an undeclared value is absent rather than null');
eq(Object.keys(sparse).length, 1, 'and nothing else is added');

/* ── the coach's own figures ───────────────────────────────────────────── */

const BUSINESS: Record<string, unknown> = {
  sessionsDeliveredThisMonth: 42,
  sessionsStillUnmarked: 9,
  revenueAtOwnRate: 6300,
  takenThisMonth: 'AED 12,400.00',
  currency: 'AED',
  clients: 14,
  avgAdherence: '81%',
  atRiskClients: 3,
  howTheyCoach: 'entirely online',
  // The field somebody adds to the digest six months from now.
  atRiskNames: ['Ana', 'Ben', 'Cara'],
  rosterEmails: ['ana@example.com'],
};
const biz = businessAskContext(BUSINESS);
eq(biz.sessionsDeliveredThisMonth, 42, 'the coach may send their own session count');
eq(biz.currency, 'AED', 'and the ISO code, so the model does not write dollars at a coach in Dubai');
eq(biz.atRiskNames, undefined, 'a list of named clients added to the digest is dropped by the same allowlist');
eq(biz.rosterEmails, undefined, 'and so is anything else that identifies somebody');

// ── the three the Monday digest writes its rules about ──────────────────
//
// The allowlist's one failure mode, and it had happened: analytics.tsx composed
// all three, the prompt spends three sentences on them, and none was declared —
// so the model was told to quote a figure it had never been given, told not to
// add unmarked sessions it could not see, and told to suppress room-based
// suggestions on a signal that never arrived. A model given a rule about an
// absent field writes around the gap in prose, where no formatter can catch it.
eq(biz.takenThisMonth, 'AED 12,400.00',
  'the takings figure the digest is told to quote exactly actually reaches the model');
eq(biz.sessionsStillUnmarked, 9,
  'and the unmarked count, without which "congratulations on a quiet month" is the answer to nine unrecorded sessions');
eq(biz.howTheyCoach, 'entirely online',
  'and how they coach, without which the rule about not suggesting anything needing a room can never fire');
// None of the three is about one person, which is the test that licenses them.
for (const k of ['takenThisMonth', 'sessionsStillUnmarked', 'howTheyCoach']) {
  ok(!(COACH_CLIENT_KEYS as readonly string[]).includes(k),
    `${k} is a fact about the coach's own book, not about a client`);
}

// The two lists must not overlap in a way that lets a client key through the
// business door. Nothing about the business is a fact about one person.
for (const k of COACH_CLIENT_HEALTH) {
  ok(!(COACH_BUSINESS_KEYS as readonly string[]).includes(k), `${k} is not smuggled into the business allowlist`);
}
ok(!(COACH_BUSINESS_KEYS as readonly string[]).includes('name'), 'and neither is a name');
ok(!(COACH_CLIENT_KEYS as readonly string[]).includes('name'), 'the client allowlist does not name anybody either');

/* ── the name comes back locally ───────────────────────────────────────── */

eq(fillName('Hey {name}, good week?', 'Ana Ferreira'), 'Hey Ana, good week?',
  'the reply says {name} and the screen fills it in — which is where the name was always going to end up');
eq(fillName('Hey {name} — {coach}', 'Ana Ferreira', 'Sam Doyle'), 'Hey Ana — Sam',
  'and the coach token too, first names both');

// An unknown name leaves the token VISIBLE. "Hey {name}" is obviously
// unfinished and gets fixed; "Hey ," gets sent.
eq(fillName('Hey {name}', null), 'Hey {name}', 'an unknown name leaves the placeholder rather than a blank');
eq(fillName('Hey {name}', '   '), 'Hey {name}', 'whitespace is not a name');
eq(fillName('Hey {name} and {name}', 'Ana'), 'Hey Ana and Ana', 'every occurrence is filled, not just the first');

/* ── the redaction ─────────────────────────────────────────────────────── */

eq(sharedAreas([]), '', 'no disclosures is an empty string, so the caller writes its own sentence');
eq(sharedAreas([{ area: 'knee', severity: 'moderate' }]), 'Knee (moderate)',
  'area and severity, and nothing else');
ok(!sharedAreas([{ area: 'knee', severity: 'moderate' }]).includes(','),
  'no note is appended, whatever else the row carries');

// `sharedInjuries` still filters by status and still redacts, so the member's
// own screen is unaffected by the coach-side addition.
const injs: Injury[] = [
  { id: '1', area: 'knee', severity: 'moderate', status: 'active', at: '2026-01-01', note: 'grade 2 MCL sprain per MRI' } as Injury,
  { id: '2', area: 'shoulder', severity: 'mild', status: 'recovered', at: '2025-06-01' } as Injury,
];
eq(sharedInjuries(injs), 'Knee (moderate)', 'recovered disclosures are left out and the note still never travels');

/* ── what the screen tells the coach ───────────────────────────────────── */

ok(/name/i.test(COACH_ASK_WHAT_NEVER_GOES), 'the coach is told the name does not go');
ok(/\{name\}/.test(COACH_ASK_WHAT_NEVER_GOES), 'and that the placeholder is why replies read the way they do');
ok(/injur/i.test(COACH_ASK_WHAT_GOES), 'and what does go includes the injury areas, because that is the part that changes an answer');
ok(/document/i.test(COACH_ASK_WHAT_NEVER_GOES), 'and that nothing off a document travels');
ok(COACH_ASK_NOT_ADVICE.length > 40, 'and that it has not met anybody');
ok(NAME_TOKEN === '{name}', 'one placeholder convention for the whole coach app');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`coachAsk: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('coachAsk: ok (no client is named to a model, no measurement about one travels, and the allowlist drops what nobody declared)');
