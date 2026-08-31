// The coach's handover document. Compile with tsc, then run under plain node.
//
// Like src/lib/clientReport.test.ts, almost every assertion here is about a
// thing the document must NOT do — and for the same reason: the versions that
// would do harm all look identical on a screen.
//
//   · an Injuries table that is empty because the read was refused, handed to
//     the coach taking this person on next, who reads it as "nothing
//     disclosed";
//   · a session tally that folds "nobody recorded an outcome" into "did not
//     attend", handing over a client who looks like they stopped turning up;
//   · a count or a first-to-latest change computed over a truncated read and
//     stated with full confidence;
//   · a sentence of judgement — "good adherence", "on track" — in a document
//     with a logo on it, about a person, that the person did not write;
//   · a progress photograph the client shared with ONE coach, forwarded to
//     everybody the file reaches.
//
// Each block below says which of those it is watching.
import {
  coachClientReportDoc,
  coachReportCaveats,
  coachReportShareBlurb,
  sessionTally,
  COACH_REPORT_LIMITS,
  COACH_REPORT_NO_PHOTOS,
  COACH_REPORT_NO_RATE,
  COACH_REPORT_PROVENANCE,
  COACH_TRAINING_DAYS_SHOWN,
  type CoachClientReportInput,
  type CoachSessionRow,
  type ReportScan,
  type ReportTraining,
  type ReportInjury,
} from './coachClientReport';
import { escapeHtml } from './clientReport';

/** The document's own section headings, used to aim an assertion at one table
 *  rather than at the whole page. */
const sectionOf = (html: string, heading: string): string =>
  (html.split('<h2>' + heading)[1] ?? '').split('<h2>')[0];

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

/* ── fixtures: a client twelve weeks in ────────────────────────────────────*/

const SESSIONS: CoachSessionRow[] = [
  { startsAt: '2026-06-02T09:00:00Z', outcome: 'completed' },
  { startsAt: '2026-06-05T09:00:00Z', outcome: 'completed' },
  { startsAt: '2026-06-09T09:00:00Z', outcome: 'no_show' },
  { startsAt: '2026-06-12T09:00:00Z', outcome: 'cancelled' },
  { startsAt: '2026-06-16T09:00:00Z', outcome: 'late_cancelled' },
  // The two that decide whether this document can be trusted: nobody ever
  // marked them, and they are neither attended nor missed.
  { startsAt: '2026-08-25T09:00:00Z', outcome: null },
  { startsAt: '2026-08-28T09:00:00Z', outcome: null },
];

const SCANS: ReportScan[] = [
  { takenAt: '2026-06-02', weightKg: 82.4, bodyFatPct: 24.1, muscleKg: 33.2, source: 'InBody (OCR)' },
  { takenAt: '2026-08-28', weightKg: 80.1, bodyFatPct: 22.6, muscleKg: 33.9, source: 'InBody (manual)' },
];

const MEASURES = [
  { at: '2026-06-02', values: { waist: 88, chest: 104 } },
  { at: '2026-08-28', values: { waist: 84.5, chest: 105 } },
];

const COLS = [{ key: 'waist', label: 'Waist' }, { key: 'chest', label: 'Chest' }];

const TRAINING: ReportTraining = {
  state: 'some',
  dayCount: 3, entryCount: 4, sets: 44, volumeKg: 31000, newestDay: '2026-08-28', undatedCount: 0,
  days: [
    { day: '2026-08-28', exercises: 5, sets: 18, bodyweightSets: 2, volumeKg: 14200 },
    { day: '2026-08-26', exercises: 4, sets: 15, bodyweightSets: 0, volumeKg: 16800 },
    { day: '2026-08-24', exercises: 6, sets: 11, bodyweightSets: 11, volumeKg: null },
  ],
};

const INJURIES: ReportInjury[] = [
  { label: 'Shoulder', severity: 'moderate', status: 'active', note: 'aches on overhead press', at: '2026-06-04' },
];

const base = (over: Partial<CoachClientReportInput> = {}): CoachClientReportInput => ({
  clientName: 'Dana Okafor',
  coachName: 'Sam Whitfield',
  coachStatus: 'ready',
  brand: 'Ironhaus Strength',
  generatedOn: '2026-08-31',
  weightUnit: 'kg',
  lengthUnit: 'cm',
  unitNote: null,
  sessions: { status: 'ready', items: SESSIONS },
  training: { status: 'ready', items: TRAINING },
  composition: { status: 'ready', items: SCANS },
  measurements: { status: 'ready', items: MEASURES },
  measureColumns: COLS,
  injuries: { status: 'ready', items: INJURIES },
  coachNote: 'Twelve weeks of lower-body work. Shoulder still limits overhead pressing, so we pressed to a landmine instead.',
  ...over,
});

/* ── 1. the session tally: a null outcome is not a missed session ──────────
   The trap this document exists around. A coach who marks outcomes for a month
   and then stops leaves a client whose record is mostly nulls; folding those
   into no-show hands the next coach somebody who appears to have stopped
   turning up, and folding them into completed is the same invention pointing
   the other way. */

{
  const t = sessionTally(SESSIONS, 'ready');
  eq(t.state, 'some', 'seven sessions is a record');
  eq(t.booked, 7, 'every booked session is counted');
  eq(t.completed, 2, 'only the ones marked completed are completed');
  eq(t.noShow, 1, 'only the one marked no_show is a no-show');
  eq(t.cancelled, 1, 'a cancellation is its own thing');
  eq(t.lateCancelled, 1, 'and a late one is not the same as an ordinary one');
  eq(t.unrecorded, 2, 'the two nobody marked are counted as unrecorded and nowhere else');
  eq((t.completed ?? 0) + (t.noShow ?? 0) + (t.cancelled ?? 0) + (t.lateCancelled ?? 0) + (t.unrecorded ?? 0), t.booked,
    'and the five figures account for every booked session exactly once');
  eq(t.firstDay, '2026-06-02', 'the earliest day read');
  eq(t.lastDay, '2026-08-28', 'and the latest');
}

{
  // An outcome a later migration adds that this build has never heard of is
  // UNRECORDED, not silently dropped and not guessed at.
  const t = sessionTally([{ startsAt: '2026-08-01T09:00:00Z', outcome: 'rescheduled_by_gym' }], 'ready');
  eq(t.unrecorded, 1, 'an outcome this build does not know is unrecorded, not invented');
  eq(t.booked, 1, 'and it is still a booked session');
}

{
  eq(sessionTally(null, 'error').state, 'unreadable', 'a failed read is unreadable');
  eq(sessionTally(null, 'error').booked, null, 'and states no count at all');
  eq(sessionTally(SESSIONS, 'loading').state, 'unreadable', 'a read still in flight is unreadable, NOT whole');
  eq(sessionTally([], 'ready').state, 'none', 'a landed empty read is genuinely none');
  eq(sessionTally([], 'ready').booked, 0, 'and zero there is a real figure');
  const p = sessionTally(SESSIONS, 'partial');
  eq(p.state, 'some', 'a truncated read still has real sessions in it');
  eq(p.booked, null, 'but no count is stated — a tally over a prefix is wrong, not small');
  eq(p.completed, null, 'none of them');
  eq(p.unrecorded, null, 'including the unrecorded count');
  eq(p.firstDay, '2026-06-02', 'the span is still real: both endpoints are sessions that exist');
}

/* ── 2. it never interprets ────────────────────────────────────────────────
   The client's own report scans for sixteen phrases. This one scans for those
   plus the ones a COACH reaches for, because a coach genuinely has an opinion
   and this document looks like the place to put it. It is — in the quoted
   block below, attributed, and nowhere else. */

const FORBIDDEN = [
  // the client report's sixteen
  'healthy range', 'normal range', 'ideal weight', 'overweight', 'obese',
  'you should', 'we recommend', 'recommended', 'diagnos', 'suggests that',
  'consistent with', 'indicates', 'concerning', 'improvement', 'on track',
  // and the ones a coach writes
  'compliant', 'compliance', 'adherence', 'excellent', 'well done',
  'good progress', 'great work', 'needs to', 'should focus', 'attendance rate',
];

{
  const d = coachClientReportDoc(base({ coachNote: null }));
  // The standing statements are cut out first: they use these words in order to
  // deny them, and scanning them would make the rule fail on its own
  // disclaimer.
  let prose = (d.html + '\n' + d.text).toLowerCase();
  for (const stated of [COACH_REPORT_LIMITS, COACH_REPORT_NO_PHOTOS, COACH_REPORT_NO_RATE, ...COACH_REPORT_PROVENANCE]) {
    prose = prose.split(stated.toLowerCase()).join(' ').split(escapeHtml(stated).toLowerCase()).join(' ');
  }
  for (const f of FORBIDDEN) {
    ok(!prose.includes(f), `the document must contain no judgement — found "${f}"`);
  }
  ok(d.html.includes(escapeHtml(COACH_REPORT_LIMITS).slice(0, 60)), 'and it says outright that it contains no assessment or rating');
  ok(d.text.includes(COACH_REPORT_LIMITS), 'in the text fallback as well as the HTML');
}

{
  // The emptiest possible document — a client with no record at all, where
  // there is least to say and most temptation to fill the page.
  const d = coachClientReportDoc(base({
    sessions: { status: 'ready', items: [] },
    training: { status: 'ready', items: { state: 'none', dayCount: 0, entryCount: 0, sets: 0, volumeKg: null, newestDay: null, days: [], undatedCount: 0 } },
    composition: { status: 'ready', items: [] },
    measurements: { status: 'ready', items: [] },
    injuries: { status: 'ready', items: [] },
    coachNote: null,
  }));
  ok(d.complete, 'an empty record read whole is a complete document');
  ok(d.text.includes(COACH_REPORT_LIMITS), 'and still carries the limits statement');
  ok(d.text.includes(COACH_REPORT_NO_PHOTOS), 'and still says no photographs are included');
  ok(d.text.includes('The coach did not write anything here'),
    'and says the coach wrote nothing rather than leaving a heading over a blank a reader would hunt for');
}

/* ── 3. the coach's own words are the ONE opinion, and are labelled as one ─*/

{
  const d = coachClientReportDoc(base({ coachNote: 'She is on track and adherence has been excellent.' }));
  ok(d.html.includes('on track'), 'a coach may write whatever they like in their own block');
  ok(d.text.includes('written by Sam Whitfield, in their own words'), 'and it is attributed to them by name');
  ok(d.text.includes('not a finding of this app and not a clinical assessment'),
    'and disclaimed as their opinion rather than the app’s');
  // The attribution must come BEFORE the quote. A reader who meets the opinion
  // first has already read it as the document's own voice.
  ok(d.html.indexOf('in their own words') < d.html.indexOf('on track'),
    'the attribution is printed above the quote, not under it');
  const own = sectionOf(d.html, 'In the coach');
  ok(own.includes('on track'), 'the opinion sits inside the coach’s own section');
  ok(!sectionOf(d.html, 'Sessions booked').includes('on track'), 'and nowhere near the figures');
}

{
  // An unreadable coach read still labels the block as somebody's opinion,
  // without inventing a name for them.
  const d = coachClientReportDoc(base({ coachStatus: 'error', coachName: null, coachNote: 'Solid block.' }));
  ok(d.text.includes('written by the coach preparing this, in their own words'), 'the block is still attributed');
  ok(!d.text.includes('written by , in their own'), 'and never to an empty name');
}

/* ── 4. no false claim of completeness ─────────────────────────────────────
   Six independent reads, any of which can fail while the others land. */

{
  eq(coachReportCaveats(base()).length, 0, 'six whole reads produce no caveats at all');
  eq(coachReportCaveats(base({ injuries: { status: 'loading', items: INJURIES } })).length, 1,
    'a section still loading produces a caveat — it is not silently treated as read');
  eq(coachReportCaveats(base({ coachStatus: 'error' })).length, 1, 'including the read that names the author');
}

{
  const d = coachClientReportDoc(base({ injuries: { status: 'error', items: [] } }));
  ok(!d.complete, 'a failed injuries read means the document is not complete');
  const inj = sectionOf(d.html, 'Injuries disclosed');
  ok(inj.includes('Not read.'), 'the injuries section says NOT READ where its table would be');
  ok(!inj.includes('No injuries have been recorded'),
    'and never prints "no injuries recorded" over a refused read — the most dangerous sentence this app can produce');
  ok(d.text.includes('THIS IS NOT A STATEMENT THAT NONE WERE DISCLOSED'), 'said in the text fallback too, in as many words');
  ok(d.text.includes('*** THIS RECORD IS INCOMPLETE ***'), 'and repeated at the top where it cannot be scrolled past');
}

{
  const d = coachClientReportDoc(base({ sessions: { status: 'error', items: null } }));
  const s = sectionOf(d.html, 'Sessions booked');
  ok(s.includes('Not read.'), 'a failed session read says so where the tally would be');
  ok(!/>\s*0\s*</.test(s), 'and prints no zero anywhere in it — a zero is a claim that none were booked');
}

{
  const d = coachClientReportDoc(base({ sessions: { status: 'partial', items: SESSIONS } }));
  const s = sectionOf(d.html, 'Sessions booked');
  ok(s.includes('—'), 'a truncated session read prints dashes rather than counts');
  ok(!/>\s*7\s*</.test(s), 'and never the count of the page it happened to receive');
  ok(d.text.includes('any total would be a total of part of them'), 'and says why there is no figure');
}

/* ── 5. no rate, no percentage, no grade ──────────────────────────────────
   "Attended 22 of 24 — 92%" is the one figure on this page that reads as a
   score, and it is arithmetic over a set containing sessions nobody marked. */

{
  const d = coachClientReportDoc(base());
  const s = sectionOf(d.html, 'Sessions booked');
  ok(!/%/.test(s), 'no percentage anywhere in the sessions section');
  ok(d.text.includes(COACH_REPORT_NO_RATE), 'and the document says why there is none');
  ok(d.text.includes('It is not a session that was missed and it is not one that went ahead'),
    'and states outright what an unrecorded outcome is not');
  ok(s.includes('No outcome recorded either way'), 'the unrecorded count is a labelled row of its own');
}

/* ── 6. no photograph and no URL leaves in this file ───────────────────────
   Worse for a coach than for a client: photographs reach a coach because the
   client shared them with THAT COACH, one at a time. A forwarded file would
   turn a share with one person into a share with everybody it reaches. */

{
  const d = coachClientReportDoc(base());
  ok(!/<img/i.test(d.html), 'no image tag anywhere in the document');
  ok(!/https?:\/\//i.test(d.html), 'no http(s) URL — a signed photo URL would arrive as one');
  ok(!/https?:\/\//i.test(d.text), 'nor in the text fallback');
  ok(!/file:|blob:|data:image/i.test(d.html), 'and no local, blob or embedded-image reference either');
  ok(!/token=|X-Amz-|supabase\.co/i.test(d.html), 'and nothing that looks like the query half of a signed URL');
  ok(d.html.includes('No photographs are included'), 'the absence is stated, because a reader cannot see what is not there');
  ok(d.text.includes('shared by the client with one coach at a time'), 'and the reason is given');
}

/* ── 7. units: whoever's they are, never mislabelled ──────────────────────*/

{
  const d = coachClientReportDoc(base({ weightUnit: 'lb', lengthUnit: 'in', unitNote: 'Shown in pounds, which is what Dana reads in.' }));
  ok(d.html.includes('Weight (lb)'), 'a pounds document gets a column headed lb');
  ok(!d.html.includes('Weight (kg)'), 'and no column of theirs is headed kg');
  ok(!d.html.includes('Muscle (kg)'), 'including the muscle column, which is also a mass');
  ok(d.html.includes('Waist (in)'), 'and the tape columns are in inches');
  ok(d.html.includes('Converted from the kilograms'), 'with the line saying the record itself is metric');
  ok(d.text.includes('which is what Dana reads in'), 'and the caller’s note about whose unit this is survives onto the page');
  ok(d.html.includes('Load moved (lb)'), 'the training tonnage carries the same unit as the scale figures');
}

/* ── 8. a change is subtraction over a WHOLE read, and never over a prefix ─*/

{
  const d = coachClientReportDoc(base());
  ok(d.text.includes('First reading to latest'), 'two whole scans get a first-to-latest line');
  const p = coachClientReportDoc(base({ composition: { status: 'partial', items: SCANS } }));
  ok(!p.text.includes('First reading to latest'), 'a truncated scan read states no overall change');
  ok(p.text.includes('the earliest one listed may not be their first'), 'and says exactly why');
}

/* ── 9. every typed value is escaped ──────────────────────────────────────
   Four typed values land in this markup: the client's name, the coach's name,
   the white-label brand — a customer's own string — and the coach's note. A
   note reading "<3 weeks off pressing" would take the injuries table with it. */

{
  const d = coachClientReportDoc(base({
    clientName: 'Ann & Bob <script>',
    coachName: 'S & M Coaching',
    brand: 'Ann & Bob <b>Fit</b>',
    coachNote: 'Pain <4/10 on press & no overhead work for now.',
    injuries: { status: 'ready', items: [{ label: 'Shoulder', severity: 'mild', status: 'active', note: 'twinges > 90°', at: '2026-06-04' }] },
  }));
  ok(!/<script>/.test(d.html), 'a typed tag never reaches the markup');
  ok(!/<b>Fit<\/b>/.test(d.html), 'nor one typed into the white-label brand');
  ok(d.html.includes('Ann &amp; Bob'), 'an ampersand survives as an entity rather than eating the next word');
  ok(d.html.includes('&lt;4/10'), 'and a less-than in a coach’s note is shown, not obeyed');
  ok(d.html.includes('twinges &gt; 90'), 'as is a greater-than in the client’s injury note');
  // The proof the escaping mattered: the sections AFTER the note are still on
  // the page, which is what a swallowed tag would have removed.
  ok(d.html.includes('Injuries disclosed in the app'), 'and every section after the escaped values is still rendered');
  ok(d.html.includes('class="foot"'), 'right down to the footer');
}

/* ── 10. the training day table is capped, and says which slice it shows ──*/

{
  const many = Array.from({ length: 40 }, (_, i) => ({
    day: `2026-0${i < 9 ? '7' : '8'}-${String((i % 28) + 1).padStart(2, '0')}`,
    exercises: 3, sets: 9, bodyweightSets: 0, volumeKg: 5000,
  }));
  const d = coachClientReportDoc(base({
    training: { status: 'ready', items: { ...TRAINING, dayCount: 40, days: many } },
  }));
  ok(d.text.includes(`The ${COACH_TRAINING_DAYS_SHOWN} most recent of the 40 days read are listed`),
    'a long history says which slice of it is printed');
  ok(d.text.includes('The figures above cover all of them'), 'and that the totals are over the whole of it');
}

/* ── 11. the share sheet warns BEFORE the file leaves the phone ───────────*/

{
  const whole = coachClientReportDoc(base());
  ok(!coachReportShareBlurb(whole, 'Dana Okafor').includes('BEFORE YOU SEND IT'), 'a complete document needs no warning');
  ok(coachReportShareBlurb(whole, 'Dana Okafor').includes('no assessment or rating of any kind'),
    'but it does say what the document is not, every time');
  const broken = coachClientReportDoc(base({ injuries: { status: 'error', items: [] }, composition: { status: 'error', items: [] } }));
  const b = coachReportShareBlurb(broken, 'Dana Okafor');
  ok(b.includes('BEFORE YOU SEND IT: 2 parts'), 'and an incomplete one names how many parts are missing, before it is sent');
}

/* ── 12. the brand is the tenant's, and the platform name is not on it ────*/

{
  const d = coachClientReportDoc(base());
  ok(d.html.includes('Ironhaus Strength'), 'the tenant brand reaches the document heading');
  ok(!d.html.includes('Repple'), 'and the platform name does not appear anywhere on it');
  ok(coachClientReportDoc(base({ brand: '' })).html.includes('Repple'),
    'an empty brand falls back to something rather than printing nothing on a handover');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'COACH CLIENT REPORT FAILURES:\n' + errors.join('\n') : 'ALL COACH CLIENT REPORT TESTS PASSED');
if (errors.length) process.exit(1);
