// Reading a physio report is a guess, and these assertions are about the guess
// being honest rather than about it being clever. Compile with tsc, run with
// node.
//
// The happy path is the easy half and it is the smaller half of this file. What
// matters is the three ways an extractor lies: it proposes something the
// document does not say, it grades a severity nobody wrote down, and it reports
// "nothing found" for a page it could not read. Each has assertions below.
import {
  extractFromDocument,
  extractInjuryCandidates,
  candidateToInjury,
  candidateNote,
  outcomeMessage,
  segments,
  readableLetters,
  severityRank,
  AREA_TERMS,
} from './injuryExtract';
import { INJURY_AREAS } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// Joined, because `eq` is Object.is and two equal arrays are not the same array.
const areasOf = (text: string) => extractInjuryCandidates(text).map((c) => c.area).join(',');
const one = (text: string, area: string) => extractInjuryCandidates(text).find((c) => c.area === area);

/* ── it reads a real report ────────────────────────────────────────────────
   A believable physiotherapy note. Nothing here is subtle; if this does not
   work the rest of the file is measuring nothing. */

const PHYSIO = [
  'PHYSIOTHERAPY ASSESSMENT — 12 Feb 2026',
  'Subjective: 6 weeks of anterior right knee pain, worse on deep squats and stairs.',
  'Imaging: grade 2 tear of the medial meniscus.',
  'Plan: avoid loaded knee flexion beyond 90 degrees for 4 weeks.',
].join('\n');

const knee = one(PHYSIO, 'knee');
ok(!!knee, 'a physiotherapy note about a knee proposes a knee');
eq(knee?.severity, 'moderate', 'and takes its severity from "grade 2"');
ok((knee?.evidence ?? '').length > 0, 'and carries the line it came from, so the client can see why it asked');
ok((knee?.movements ?? []).includes('squat'),
  'the exercise keywords the document mentions ride along as context');
eq(extractFromDocument(PHYSIO).outcome, 'candidates', 'and the outcome says there is something to confirm');

// One report, one knee — not one candidate per line about it.
eq(extractInjuryCandidates(PHYSIO).filter((c) => c.area === 'knee').length, 1,
  'several lines about the same area are one disclosure, not three');

// The worst grading in the document is the one that survives the merge. A note
// that says "mild swelling" on one line and "full-thickness tear" on another
// has said full-thickness.
const mixed = one('Mild swelling of the right shoulder.\nFull-thickness tear of the supraspinatus.', 'shoulder');
eq(mixed?.severity, 'severe', 'merging two lines keeps the worse grading, not the first one');
ok((mixed?.evidence ?? '').toLowerCase().includes('full-thickness'),
  'and keeps the line that justifies it, so the evidence still matches the grade shown');

// A physio writes structures, not areas.
eq(areasOf('Achilles tendinopathy on the left, ongoing 3 months.'), 'ankle',
  'a clinical term with no body-part word in it still finds its area');
eq(areasOf('Chronic L5/S1 disc herniation with radiculopathy.'), 'lower_back',
  'so does an anatomical level');
eq(one('Right lateral epicondylitis, tender to palpation.', 'elbow')?.matched, 'epicondylitis',
  'and the term reported is the specific one that matched');

/* ── THE UNCERTAINTY: nothing recognised is nothing proposed ───────────────
   The assertion this whole module exists for. An extractor that guesses when
   it does not know is worse than no extractor, because the client believes it
   read their document. */

const SHOPPING = 'Weekly shop: chicken, rice, oats, blueberries, olive oil, coffee beans, laundry tablets.';
eq(extractInjuryCandidates(SHOPPING).length, 0,
  'a document with nothing recognisable in it proposes NOTHING — it does not guess');
eq(extractFromDocument(SHOPPING).outcome, 'nothing-recognised',
  'and says it read the page and found no injury, which is a different claim from failing to read it');

// Unreadable and empty are also different from each other, and both are
// different from "there is nothing wrong with you".
eq(extractFromDocument('').outcome, 'unreadable', 'no text at all is a failed read, not an empty document');
eq(extractFromDocument('   \n\t \n ').outcome, 'unreadable', 'nor is whitespace a read');
eq(extractFromDocument('|| >< 8# ~~ ^^').outcome, 'unreadable',
  'and OCR noise with no letters in it is a failed read, however many characters it has');
eq(extractFromDocument(SHOPPING).candidates.length, 0, 'every outcome that is not "candidates" carries none');

// A body part with nothing wrong with it is not an injury. This is the half of
// the rule that a keyword matcher always gets wrong.
eq(extractInjuryCandidates('Chest x-ray clear. Knee and ankle within normal limits on examination today.').length, 0,
  'naming a body part is not disclosing an injury — a complaint has to be in the line too');
eq(extractInjuryCandidates('The patient reports ongoing pain and stiffness following the incident described.').length, 0,
  'and a complaint with no body part named does not get one assigned to it');

// Exercise keywords must never be the reason a candidate exists: 'squat' sits
// under four different areas, so a candidate built from it would be a coin
// toss presented as a reading of the document.
eq(extractInjuryCandidates('Sore after heavy squats and deadlifts on Tuesday.').length, 0,
  'an exercise name is not a body area — INJURY_AREAS keywords never propose on their own');

// A negated finding means the opposite of a finding.
eq(extractInjuryCandidates('MRI shows no evidence of a meniscal tear in the right knee.').length, 0,
  'a ruled-out finding is not proposed');
eq(areasOf('MRI: no evidence of meniscal tear.\nGrade 2 sprain of the medial ankle ligament.'), 'ankle',
  'but ruling one thing out does not suppress a real finding on another line');

/* ── severity is allowed to be unknown ─────────────────────────────────── */

const ungraded = one('Ongoing lower back pain when lifting.', 'lower_back');
ok(!!ungraded, 'an ungraded complaint is still a candidate');
eq(ungraded?.severity, null,
  'a document that does not grade the injury yields severity null — NOT a default of moderate');
eq(severityRank(null), 0, 'and unknown ranks below every real severity');
ok(severityRank('severe') > severityRank('moderate') && severityRank('moderate') > severityRank('mild'),
  'which are ranked in the order they read');

// "grade iii" must not be read by the pattern that looks for "grade i".
eq(one('Grade III rupture of the ACL.', 'knee')?.severity, 'severe', 'roman numerals are read at their real grade');
eq(one('Grade I strain of the left hamstring.', 'hamstring')?.severity, 'mild', 'including the smallest one');

/* ── it proposes; it never applies ─────────────────────────────────────── */

const c = one(PHYSIO, 'knee')!;
// The candidate is not an Injury and has no shape that could be mistaken for
// one: no id, no status, and a severity that may be null.
ok(!('status' in (c as object)) && !('id' in (c as object)),
  'a candidate carries no id and no status — it is a question, not a disclosure');

const built = candidateToInjury(c, { id: 'inj_test', severity: 'mild', at: '2026-02-12T09:00:00Z', note: '  read off my physio report  ' });
eq(built.area, 'knee', 'confirming builds an Injury for the proposed area');
eq(built.severity, 'mild',
  'at the severity the CLIENT passed in, not the one the document suggested');
eq(built.status, 'active', 'as an active disclosure');
eq(built.note, 'read off my physio report', 'with the note trimmed');
eq(built.id, 'inj_test', 'and an id supplied from outside, so this stays pure');

eq(candidateToInjury(c, { id: 'x', severity: 'mild', at: 'now', note: '    ' }).note, undefined,
  'a note the client cleared is absent, not an empty string');
eq(candidateToInjury(c, { id: 'x', severity: 'severe', at: 'now', area: 'hip' }).area, 'hip',
  'and the client may move it to an area they think fits better — it is their disclosure');

ok(INJURY_AREAS.some((a) => a.id === built.area),
  'whatever comes out names an area the rest of the app knows');
eq(candidateNote(c), c.evidence, 'the note starts as the evidence, for the client to edit or clear');

/* ── the copy ──────────────────────────────────────────────────────────── */

const failed = outcomeMessage('unreadable');
const none = outcomeMessage('nothing-recognised');
ok(failed.title !== none.title,
  'a failed read and an empty result do not say the same thing to the client');
ok(/could not|failing to read/i.test(failed.note), 'the failed read says the failure is ours');
ok(/could not tell/i.test(none.note), 'and the empty result says we could not tell, not that there is nothing wrong');
ok(/not a diagnosis/i.test(outcomeMessage('candidates').note),
  'and the proposals are introduced as suggestions rather than as a diagnosis — this app is not a medical provider');

/* ── the small pieces ──────────────────────────────────────────────────── */

eq(segments('One line.\nTwo; three. Four').length, 4, 'segments split on newlines and on sentence ends');
eq(segments('   ').length, 0, 'and whitespace is not a segment');
eq(readableLetters('a1b2c3 !!'), 3, 'readable length counts letters, not characters');

ok(!AREA_TERMS.some((t) => t.area === 'other'),
  '"other" is never proposed — its label is a word that appears in ordinary prose');
ok(AREA_TERMS.every((t) => INJURY_AREAS.some((a) => a.id === t.area)),
  'every term maps to a real INJURY_AREAS id');
for (let i = 1; i < AREA_TERMS.length; i++) {
  if (AREA_TERMS[i - 1].term.length < AREA_TERMS[i].term.length) {
    errors.push('terms are longest-first, so the most specific match is the one reported');
    break;
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('injuryExtract: ok');
