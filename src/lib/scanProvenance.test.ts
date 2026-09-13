// What the record says about how a body figure was taken, and the several
// things it must refuse to say.
//
// Compile with tsc, then run under plain node.
import {
  readSource, sourceChip, evidenceNote, sameEvidence, changeAcrossSources, mixedSourcesNote,
} from './scanProvenance';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1. the three strings this app actually writes ────────────────────────── */

// The table default, and what a read of a photographed printout stores.
eq(readSource('InBody (OCR)').kind, 'machine-ocr', 'an OCR’d printout is a machine reading nobody retyped');
// src/lib/recordQueue.ts line 313.
eq(readSource('InBody (manual)').kind, 'machine-typed', 'a manually entered InBody figure is a machine reading a person typed');
// app/(trainer)/my-progress.tsx.
eq(readSource('Entered by me').kind, 'typed', 'a figure with no machine named is typed, not measured');

/* ── 2. the column is free text, so every branch has to survive one ───────── */

eq(readSource(null).kind, 'unrecorded', 'a null column is unrecorded');
eq(readSource(undefined).kind, 'unrecorded', 'and so is an absent one');
eq(readSource('').kind, 'unrecorded', 'and so is an empty string');
eq(readSource('   ').kind, 'unrecorded', 'whitespace is not a source');
eq(readSource('inbody (ocr)').kind, 'machine-ocr', 'the match is case-insensitive');
eq(readSource('  InBody (OCR)  ').recorded, 'InBody (OCR)', 'and the stored string is trimmed but otherwise untouched');
eq(readSource('Tanita, typed in').kind, 'machine-typed', 'a second machine by name is still a machine');
eq(readSource('DEXA scan photo').kind, 'machine-ocr', 'and so is a third');

// The refusal that is the point of the free-text column: a string this file
// cannot interpret is reported as such and never filed under the nearest match.
eq(readSource('imported from MyFitnessPal').kind, 'unrecognised', 'an unknown source is not quietly bucketed');
// A machine named with nothing about how the figure travelled off it. Neither
// machine kind may be claimed — both assert a transcription step this string
// does not make.
eq(readSource('InBody').kind, 'unrecognised', 'a machine with no route recorded is not assigned a route');
eq(readSource('InBody').recorded, 'InBody', 'though the word the record holds is still carried through');

/* ── 3. the chip prints the record, not a plausible default ───────────────── */

eq(sourceChip(readSource('InBody (OCR)')), 'InBody (OCR)', 'the chip is the recorded string verbatim');
eq(sourceChip(readSource('imported from MyFitnessPal')), 'imported from MyFitnessPal',
  'including one this app does not understand — it is what the record says');
eq(sourceChip(readSource(null)), 'Source not recorded', 'an empty column says it is empty');
ok(sourceChip(readSource(null)) !== 'InBody (OCR)', 'and is never dressed up as the table default');

/* ── 4. the sentence is about the row, never about the person ─────────────── */

ok(evidenceNote(readSource('Entered by me')).includes('No machine is named'),
  'a typed figure says what is missing from the record');
ok(!/guess|lied|inaccurate|unreliable/i.test(evidenceNote(readSource('Entered by me'))),
  'and never calls the client’s own figure a guess');
ok(evidenceNote(readSource(null)).includes('gap in the record'),
  'an unrecorded source is a gap in the record rather than a kind of measurement');

/* ── 5. two readings, and whether they are the same kind of evidence ──────── */

ok(sameEvidence(readSource('InBody (OCR)'), readSource('InBody (OCR)')), 'two OCR readings agree');
ok(!sameEvidence(readSource('InBody (OCR)'), readSource('InBody (manual)')),
  'an OCR reading and a typed-in machine reading are not the same evidence');
ok(!sameEvidence(readSource('InBody (OCR)'), readSource('Entered by me')),
  'and a machine reading and a typed one certainly are not');

// Two rows that both fail to say where they came from have not been shown to
// agree. Treating "both unknown" as "both the same" is how a change between two
// different machines gets published with no caveat at all.
ok(!sameEvidence(readSource(null), readSource(null)), 'two unrecorded sources do not match each other');
ok(!sameEvidence(readSource('from the gym'), readSource('from the gym')),
  'nor do two identical strings this app cannot classify');

/* ── 6. the caveat that has to travel with a change ───────────────────────── */

eq(changeAcrossSources(readSource('InBody (OCR)'), readSource('InBody (OCR)')), null,
  'a change between two readings of one kind needs no caveat');

{
  const note = changeAcrossSources(readSource('InBody (OCR)'), readSource('Entered by me'));
  ok(note != null, 'a change across two kinds carries one');
  ok((note ?? '').includes('inbody (ocr)') && (note ?? '').includes('entered by me'),
    'and names both sides rather than saying "mixed"');
  ok(/equipment/.test(note ?? ''), 'and says what else is in the difference');
  // It says the number may be partly equipment. It does not say the number is
  // wrong, and it does not suppress it.
  ok(!/wrong|invalid|ignore/i.test(note ?? ''), 'without calling the reading wrong');
}

eq(changeAcrossSources(readSource(null), readSource(null)) == null, false,
  'two silent records still get the caveat — neither has been shown to match the other');

/* ── 7. the note over a whole series ──────────────────────────────────────── */

eq(mixedSourcesNote([]), null, 'an empty series is not reassured that it is consistent');
eq(mixedSourcesNote([readSource('InBody (OCR)')]), null, 'and neither is a series of one');
eq(mixedSourcesNote([readSource('InBody (OCR)'), readSource('InBody (OCR)')]), null,
  'a series that really is all one kind says nothing');

{
  const note = mixedSourcesNote([
    readSource('InBody (OCR)'), readSource('InBody (manual)'),
    readSource('Entered by me'), readSource(null), readSource('from the gym'),
  ]);
  ok(note != null, 'a mixed series says so');
  ok((note ?? '').includes('2 off a machine'), 'and counts the machine readings');
  ok((note ?? '').includes('1 typed in'), 'and the typed ones');
  ok((note ?? '').includes('1 with no source recorded'), 'and the silent ones');
  // A row that records a source this app cannot read is a DIFFERENT defect
  // from a row that records none. Counting them together would send a coach
  // looking for a blank column that is not blank.
  ok((note ?? '').includes('1 recording a source this app cannot classify'),
    'and keeps an unreadable source apart from an absent one');
}

if (errors.length) {
  console.error(`scanProvenance: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('scanProvenance: ok');
