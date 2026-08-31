// The handover document. Compile with tsc, then run under plain node.
//
// Almost every assertion here is about a thing the document must NOT do. That
// is deliberate and it is the shape of the risk: a report that prints four
// tables of real figures is easy to write and easy to test, and the versions of
// it that would do harm all look identical on a screen —
//
//   · an Injuries table that is empty because the read was refused, handed to a
//     physiotherapist who reads it as "nothing disclosed";
//   · a total, or a first-to-latest change, computed over a truncated read and
//     stated with full confidence;
//   · a sentence of interpretation ("body fat is in the healthy range") in a
//     document with a logo on it that the client did not write;
//   · a signed photo URL, or an embedded photograph, inside a file that will be
//     forwarded and kept.
//
// So the bulk of what follows asserts absence, and each block says which of
// those four it is watching.
import {
  clientReportDoc,
  sectionState,
  countable,
  sectionCaveat,
  reportCaveats,
  escapeHtml,
  toProgressRows,
  reportShareBlurb,
  REPORT_LIMITS,
  REPORT_NO_PHOTOS,
  REPORT_PROVENANCE,
  TRAINING_DAYS_SHOWN,
  type ClientReportInput,
  type ReportScan,
  type ReportTraining,
  type ReportTrainingDay,
  type ReportInjury,
} from './clientReport';

/** The document's own section headings, used to aim an assertion at one table
 *  rather than at the whole page — "no zero cell anywhere" would be a false
 *  assertion, because a day of nothing but bodyweight sets genuinely has zero
 *  loaded ones and says so. */
const sectionOf = (html: string, heading: string): string =>
  (html.split('<h2>' + heading)[1] ?? '').split('<h2>')[0];

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); };

/* ── the fixtures ──────────────────────────────────────────────────────────
   A client with four months of record: three scans, two tape entries, four
   logged days and two disclosed injuries, one of them recovered. */

const SCANS: ReportScan[] = [
  { takenAt: '2026-04-02', weightKg: 82.4, bodyFatPct: 24.1, muscleKg: 33.2, source: 'InBody (OCR)' },
  { takenAt: '2026-06-14', weightKg: 81.0, bodyFatPct: 23.2, muscleKg: null, source: 'InBody (manual)' },
  { takenAt: '2026-08-11', weightKg: 80.1, bodyFatPct: 22.6, muscleKg: 33.9, source: 'InBody (OCR)' },
];

const MEASURES = [
  { at: '2026-04-02', values: { waist: 88, chest: 104, arm: 36 } },
  { at: '2026-08-11', values: { waist: 84.5, chest: 105, arm: null } },
];

const COLS = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'arm', label: 'Arm' },
];

const TRAINING: ReportTraining = {
  state: 'some',
  dayCount: 4,
  entryCount: 5,
  sets: 61,
  volumeKg: 48250,
  newestDay: '2026-08-28',
  undatedCount: 0,
  days: [
    { day: '2026-08-28', exercises: 5, sets: 18, bodyweightSets: 2, volumeKg: 14200 },
    { day: '2026-08-26', exercises: 4, sets: 15, bodyweightSets: 0, volumeKg: 12800 },
    { day: '2026-08-24', exercises: 6, sets: 20, bodyweightSets: 20, volumeKg: null },
    { day: '2026-08-21', exercises: 3, sets: 8, bodyweightSets: 0, volumeKg: 21250 },
  ],
};

const INJURIES: ReportInjury[] = [
  { label: 'Shoulder', severity: 'moderate', status: 'active', note: 'aches on overhead press', at: '2026-05-04' },
  { label: 'Ankle / Foot', severity: 'mild', status: 'recovered', at: '2026-02-19' },
];

const base = (over: Partial<ClientReportInput> = {}): ClientReportInput => ({
  name: 'Dana Okafor',
  brand: 'Repple',
  generatedOn: '2026-08-31',
  weightUnit: 'kg',
  lengthUnit: 'cm',
  composition: { status: 'ready', items: SCANS },
  measurements: { status: 'ready', items: MEASURES },
  measureColumns: COLS,
  training: { status: 'ready', items: TRAINING },
  injuries: { status: 'ready', items: INJURIES },
  ...over,
});

/* ── 1. read honesty: which statuses may be spoken for ─────────────────────
   'loading' collapsing into 'unreadable' is the load-bearing line of the
   module. A document is built and sent in one gesture; a section still in
   flight will never be filled in, so treating it as read would print an empty
   table for anybody who tapped Share while the screen was opening. */

eq(sectionState('ready'), 'whole', 'a landed read is whole');
eq(sectionState('partial'), 'partial', 'a truncated read is partial, not whole');
eq(sectionState('error'), 'unreadable', 'a refused read is unreadable');
eq(sectionState('loading'), 'unreadable', 'a read still in flight is unreadable, NOT whole — this is the one that would print an empty injuries table');

ok(countable('ready'), 'only a whole read may be totalled');
ok(!countable('partial'), 'a truncated read may not be totalled');
ok(!countable('loading'), 'and neither may one that has not landed');
ok(!countable('error'), 'nor a failed one');

eq(sectionCaveat('Injuries disclosed', 'ready'), null, 'a whole read carries no caveat');
{
  const c = sectionCaveat('Injuries disclosed', 'error') ?? '';
  ok(c.includes('Injuries disclosed'), 'the caveat names the section, so a reader knows WHICH part is missing');
  ok(/not.*because there is nothing|FAILED READ/i.test(c), 'and says the emptiness is a failure, not an absence');
}

/* ── 2. a failed section is never an empty section ────────────────────────
   The single most dangerous false statement this app can make is an empty
   Injuries table shown to a clinician. */

{
  const d = clientReportDoc(base({ injuries: { status: 'error', items: [] } }));
  ok(!d.complete, 'a document with a failed read must not report itself complete');
  eq(d.caveats.length, 1, 'exactly the one failed section is caveated');
  ok(d.html.includes('Not read.'), 'the failure is stated where the table would be, not only in a footnote below it');
  ok(d.html.includes('This record is incomplete'), 'and again at the top, above everything the reader would otherwise believe');
  ok(!/No injuries have been recorded/.test(d.html), 'and the document must NEVER say "no injuries have been recorded" over a read that failed');
  ok(/NOT A STATEMENT THAT NONE WERE DISCLOSED/i.test(d.text), 'the plain-text fallback carries the same warning — a client on a build with no PDF sends this one');
  ok(d.text.includes('THIS RECORD IS INCOMPLETE'), 'and the incompleteness banner too, rather than only the HTML having it');
}

{
  // The other half of the same rule: under a WHOLE read, an empty list really
  // is empty and the document is allowed to say so plainly.
  const d = clientReportDoc(base({ injuries: { status: 'ready', items: [] } }));
  ok(d.complete, 'a genuinely empty section, read whole, leaves the document complete');
  ok(d.html.includes('No injuries have been recorded'), 'and it may say so');
  eq(d.caveats.length, 0, 'with no caveat');
}

{
  // All four can fail at once, and all four must be named.
  const d = clientReportDoc(base({
    composition: { status: 'error', items: [] },
    measurements: { status: 'error', items: [] },
    training: { status: 'error', items: { ...TRAINING, state: 'unreadable', days: [] } },
    injuries: { status: 'error', items: [] },
  }));
  eq(d.caveats.length, 4, 'every failed section is named separately');
  ok(d.html.split('Not read.').length - 1 === 4, 'and every one of the four says so where its table would be');
  ok(!d.complete, 'and the document is not complete');
  for (const what of ['Body composition', 'Tape measurements', 'Training', 'Injuries disclosed']) {
    ok(d.caveats.some((c) => c.startsWith(what)), `${what} is named in the caveats rather than folded into "some data unavailable"`);
  }
}

/* ── 3. no total, and no overall change, over a truncated read ─────────────
   A capped read is a prefix of an unknown whole (src/lib/rowCap.ts), so its
   earliest scan is not the person's first and a "first to latest" line over it
   is a change between two arbitrary points sold as a span of their record. */

{
  const whole = clientReportDoc(base());
  ok(whole.html.includes('First reading to latest'), 'a whole read states the change between the first and latest readings');
  ok(/82\.4/.test(whole.html) && /80\.1/.test(whole.html), 'and prints both endpoints beside it rather than the change alone');

  const part = clientReportDoc(base({ composition: { status: 'partial', items: SCANS } }));
  ok(!part.html.includes('First reading to latest'), 'a truncated read states NO overall change');
  ok(part.html.includes('may not be their first'), 'and says why, on the page, rather than leaving a silent gap');
  ok(!part.complete, 'a truncated read is not a complete record either');
  // The rows themselves are real and stay listed — truncation removes the
  // claim, not the evidence.
  ok(part.html.includes('24.1'), 'the readings that WERE read are still listed under a partial status');
}

{
  // A truncated section says so beside its own table too, not only in the
  // banner at the top. Somebody who scrolls to the tape measurements and starts
  // counting rows needs the sentence next to what they are counting.
  const d = clientReportDoc(base({
    measurements: { status: 'partial', items: MEASURES },
    training: { status: 'partial', items: TRAINING },
    injuries: { status: 'partial', items: INJURIES },
  }));
  ok(sectionOf(d.html, 'Tape measurements').includes('it is not all of it'), 'the tape section carries its own truncation note');
  ok(sectionOf(d.html, 'Training logged').includes('it is not all of it'), 'and so does the training section');
  ok(sectionOf(d.html, 'Injuries disclosed').includes('it is not all of it'), 'and the injuries section, where it matters most');
  ok(!sectionOf(d.html, 'Body composition').includes('it is not all of it'), 'a section that was read whole says nothing of the kind');
}

/* ── 3b. a unit is never attached to a dash ────────────────────────────────
   "— lb" and "— muscle" are what naive concatenation gives, and a unit hung on
   nothing reads as a measurement whose value failed to print rather than as one
   that was never taken. The HTML puts units in the column headings; the plain
   text has no headings and has to say it per figure. */

{
  const d = clientReportDoc(base());
  ok(!/— kg|— muscle|— lb|— %/.test(d.text), 'no dash in the text fallback carries a unit after it');
  ok(d.text.includes('33.2 kg muscle'), 'while a figure that IS there keeps its unit and its label');
}

{
  // The training totals arrive already nulled by clientTraining.ts under a
  // capped read. This asserts the document prints the dash rather than
  // helpfully substituting a zero.
  const capped: ReportTraining = { ...TRAINING, dayCount: null, entryCount: null, sets: null, volumeKg: null };
  const d = clientReportDoc(base({ training: { status: 'partial', items: capped } }));
  ok(!/Days trained<\/td><td class="r">0</.test(d.html), 'a null day count must not render as 0');
  ok(d.html.includes('Days trained</td><td class="r">—'), 'it renders as a dash');
  ok(d.html.includes('Sets recorded</td><td class="r">—'), 'and so does a null set count');
  ok(d.html.includes('Total load moved (kg)</td><td class="r">—'), 'and a null tonnage');
  // The days themselves are still printed. A capped read is twenty real days,
  // and dropping them would throw away evidence to make a point about totals.
  ok(d.html.includes('2026'), 'the days that were read are still listed under a partial status');
}

/* ── 4. it never interprets ────────────────────────────────────────────────
   The house rule against medical advice, asserted rather than trusted. A
   body-composition document is exactly where somebody would add a helpful
   sentence, and this is the test that fails when they do. */

{
  const d = clientReportDoc(base());
  // The three standing statements are cut out before the scan. They are the
  // one place the document is ALLOWED to use these words, because they use them
  // to deny them — "should not be read as a diagnosis" is the sentence this
  // whole test exists to protect, and scanning it would make the rule fail on
  // its own disclaimer. Everything else on the page is fair game.
  let prose = (d.html + '\n' + d.text).toLowerCase();
  for (const stated of [REPORT_LIMITS, REPORT_NO_PHOTOS, ...REPORT_PROVENANCE]) {
    prose = prose.split(stated.toLowerCase()).join(' ').split(escapeHtml(stated).toLowerCase()).join(' ');
  }
  const forbidden = [
    'healthy range', 'normal range', 'ideal weight', 'overweight', 'obese',
    'you should', 'we recommend', 'recommended', 'diagnos', 'suggests that',
    'consistent with', 'indicates', 'concerning', 'improvement', 'on track',
  ];
  for (const f of forbidden) {
    ok(!prose.includes(f), `the document must contain no interpretation — found "${f}"`);
  }
  ok(d.html.includes(escapeHtml(REPORT_LIMITS).slice(0, 60)), 'and it says outright that it contains no assessment or advice');
  ok(d.text.includes(REPORT_LIMITS), 'in the text fallback as well as the HTML');
}

{
  // The limits statement survives even the emptiest possible document — the one
  // built for somebody with no record at all, where there is least to say and
  // most temptation to fill the page.
  const d = clientReportDoc(base({
    composition: { status: 'ready', items: [] },
    measurements: { status: 'ready', items: [] },
    training: { status: 'ready', items: { state: 'none', dayCount: 0, entryCount: 0, sets: 0, volumeKg: null, newestDay: null, days: [], undatedCount: 0 } },
    injuries: { status: 'ready', items: [] },
  }));
  ok(d.complete, 'an empty record read whole is a complete document');
  ok(d.text.includes(REPORT_LIMITS), 'and still carries the limits statement');
  ok(d.text.includes(REPORT_NO_PHOTOS), 'and still says no photographs are included');
}

/* ── 5. no photograph and no URL leaves in this file ───────────────────────
   Photos live in a private bucket behind URLs that expire in an hour. A
   document outlives them and gets forwarded; a signed URL in one leaks an
   object path to every onward reader and is dead before any of them taps it. */

{
  const d = clientReportDoc(base());
  ok(!/<img/i.test(d.html), 'no image tag anywhere in the document');
  ok(!/https?:\/\//i.test(d.html), 'no http(s) URL — a signed photo URL would arrive as one');
  ok(!/https?:\/\//i.test(d.text), 'nor in the text fallback');
  ok(!/file:|blob:|data:image/i.test(d.html), 'and no local, blob or embedded-image reference either');
  ok(!/token=|X-Amz-|supabase\.co/i.test(d.html), 'and nothing that looks like the query half of a signed URL');
  ok(d.html.includes('No photographs are included'), 'the absence is stated, because a reader cannot see what is not there');
}

/* ── 6. units: the client's own, and never mislabelled ─────────────────────
   TF-37's rule reaching the one document that leaves the phone for a
   professional. NULL is never kilograms: the caller resolves the preference
   and passes it, so this module has one job — not to mix them up. */

{
  const d = clientReportDoc(base({ weightUnit: 'lb', lengthUnit: 'in' }));
  ok(d.html.includes('Weight (lb)'), 'a pounds reader gets a column headed lb');
  ok(!d.html.includes('Weight (kg)'), 'and no column of theirs is headed kg');
  ok(!d.html.includes('Muscle (kg)'), 'including the muscle column, which is also a mass');
  ok(d.html.includes('Waist (in)'), 'and the tape columns are in inches');
  ok(!/Waist \(cm\)/.test(d.html), 'not centimetres');
  ok(d.html.includes('Converted from the kilograms'), 'with the line saying the record itself is metric — otherwise the clinic sheet and this document look like two different readings');
  ok(d.html.includes('Converted from the centimetres'), 'and the same for the tape measurements');
  // 82.4 kg is 182 lb. The document must not print 82.4 under a pounds header.
  ok(d.html.includes('>182<'), 'the weight is actually converted, not merely relabelled');
  ok(!d.html.includes('>82.4<'), 'and the stored kilograms are not sitting under the lb heading');
  // Body fat is a proportion of a body and is the same proportion however that
  // body is weighed. Running it through a mass conversion turns 24.1% into
  // 53.1%, which looks like a measurement and is nonsense.
  ok(d.html.includes('>24.1<'), 'body fat passes through a pounds document unconverted');
}

{
  const d = clientReportDoc(base());
  ok(d.html.includes('Weight (kg)'), 'a metric reader gets kilograms');
  ok(!d.html.includes('Converted from'), 'and no conversion note, because nothing was converted');
}

/* ── 7. a missing reading is a dash, never a zero ──────────────────────────
   The scan of 14 June recorded no skeletal muscle. Nobody carries 0 kg of it. */

{
  const d = clientReportDoc(base());
  const comp = sectionOf(d.html, 'Body composition');
  ok(comp.includes('—'), 'the 14 June scan recorded no skeletal muscle, and it renders as an em-dash');
  ok(!/>0<\/td>/.test(comp), 'and never as a zero cell — nobody carries 0 kg of skeletal muscle');
  ok(comp.includes('33.2') && comp.includes('33.9'), 'while the two scans that DID record muscle print their figures');

  // The 24 August session was twenty bodyweight sets and no external load. Its
  // tonnage is absent, not zero: printing 0 kg beside twenty sets of chin-ups
  // would describe an hour of work as no work.
  const train = sectionOf(d.html, 'Training logged');
  const bwDay = train.split('<tr>').find((r) => r.includes('>20</td>'));
  ok(!!bwDay, 'the bodyweight-only day is in the table');
  ok(!!bwDay && bwDay.includes('—'), 'and its load column is a dash');
  ok(!!bwDay && !/>0<\/td><\/tr>/.test(bwDay), 'rather than a zero at the end of the row');
}

/* ── 8. escaping — a note nobody can break the page with ───────────────────
   "pain < 4/10 on press" in an injury note truncates the document from that
   character onward in some renderers, swallowing the rest of the injury list
   in the one document where a missing injury matters most. */

eq(escapeHtml('pain < 4/10'), 'pain &lt; 4/10', 'a less-than is escaped');
eq(escapeHtml('S&C coach'), 'S&amp;C coach', 'an ampersand is escaped — it is in ordinary names');
eq(escapeHtml('a "quote"'), 'a &quot;quote&quot;', 'and a double quote');
eq(escapeHtml(null), '', 'a missing value escapes to nothing rather than to "null"');

{
  const nasty: ReportInjury[] = [
    { label: 'Shoulder', severity: 'moderate', status: 'active', note: '<script>alert(1)</script> pain < 4/10', at: '2026-05-04' },
  ];
  const d = clientReportDoc(base({ name: 'Ann & Bob <b>', injuries: { status: 'ready', items: nasty } }));
  ok(!d.html.includes('<script>'), 'markup inside a note never reaches the document as markup');
  ok(d.html.includes('&lt;script&gt;'), 'it is printed as the text the person typed');
  ok(d.html.includes('Ann &amp; Bob'), 'and the same for the name in the heading');
  ok(!/<b>/.test(d.html.split('</div>')[0]), 'a tag in a name does not become a tag in the header');
}

/* ── 9. the day table says which slice of the record it is ─────────────────
   A reader counting rows must not mistake them for the whole history. */

{
  const many: ReportTrainingDay[] = [];
  for (let i = 0; i < TRAINING_DAYS_SHOWN + 12; i++) {
    many.push({ day: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, exercises: 3, sets: 9, bodyweightSets: 0, volumeKg: 5000 });
  }
  const d = clientReportDoc(base({ training: { status: 'ready', items: { ...TRAINING, days: many } } }));
  ok(d.html.includes(`most recent of the ${many.length} days read`), 'the table says how many of how many it is showing');
  const printed = d.html.split('<td class="r">3</td>').length - 1;
  eq(printed, TRAINING_DAYS_SHOWN, 'and prints exactly that many day rows, not all of them');
}

{
  const d = clientReportDoc(base());
  ok(d.html.includes('All 4 logged days are listed'), 'a short history says outright that it is all of it');
}

/* ── 9b. sessions with no readable date are stated, not vanished ───────────
   trainingBoard puts a session whose timestamp will not parse in `undated`
   rather than filing it under today. Its sets and its load ARE in the totals,
   and it cannot be in the day table, so the two would silently disagree unless
   the document says why. And a record whose EVERY session is undated has no
   days at all — which is not the same as never having trained, and must not be
   printed as "no training sessions are logged". */

{
  ok(!clientReportDoc(base()).html.includes('timestamp that could not be read'),
    'a record with nothing undated says nothing about undated events');
  const d = clientReportDoc(base({ training: { status: 'ready', items: { ...TRAINING, undatedCount: 2 } } }));
  ok(d.html.includes('could not be read, so they do not appear in the table'), 'undated events are named rather than dropped in silence');
  ok(d.html.includes('counted in the figures above'), 'and the document says they ARE inside the totals');
  ok(d.html.includes('All 4 logged days are listed'), 'while the dated days still get their table');
}

{
  const allUndated: ReportTraining = { ...TRAINING, days: [], newestDay: null, undatedCount: 3 };
  const d = clientReportDoc(base({ training: { status: 'ready', items: allUndated } }));
  ok(!d.html.includes('No training sessions are logged'), 'a record of nothing but undated sessions is NOT an empty training history');
  ok(d.html.includes('no day-by-day table'), 'it says there is no table and why');
  ok(d.html.includes('Sets recorded</td><td class="r">61'), 'and the totals, which include those sessions, are still stated');
}

{
  // ONE undated session, and nothing else. The boundary: a record holding a
  // single session whose timestamp will not parse is still a record of
  // training, and the sentence about it is in the singular.
  const single: ReportTraining = { ...TRAINING, days: [], newestDay: null, undatedCount: 1 };
  const d = clientReportDoc(base({ training: { status: 'ready', items: single } }));
  ok(!d.html.includes('No training sessions are logged'), 'one undated session is not an empty training history either');
  ok(d.html.includes('1 logging event carries a timestamp'), 'and it is described in the singular');
  ok(!d.html.includes('events carry'), 'not in the plural');
  ok(d.html.includes('no day-by-day table'), 'with no table, because it has no day to sit under');
}

{
  // The genuinely empty case still reads as empty — the branch above must not
  // have swallowed it.
  const none: ReportTraining = { state: 'none', dayCount: 0, entryCount: 0, sets: 0, volumeKg: null, newestDay: null, days: [], undatedCount: 0 };
  const d = clientReportDoc(base({ training: { status: 'ready', items: none } }));
  ok(d.html.includes('No training sessions are logged'), 'nothing dated and nothing undated really is nothing');
  ok(!d.html.includes('no day-by-day table'), 'and it does not also claim a table is missing');
}

/* ── 10. figures a reader can take in ─────────────────────────────────────
   48,250 kg, not 48250. The house rule about thousands separators applies with
   more force here than on a screen: this page gets printed. */

{
  const d = clientReportDoc(base());
  ok(d.html.includes('48,250'), 'a five-figure tonnage carries a thousands separator');
  ok(!/>48250</.test(d.html), 'and not the raw digits');
}

/* ── 11. rows go into the document oldest first ───────────────────────────
   A record of a body over time is read forward, and the change line under the
   table is first-to-latest. If the rows arrived newest-first and were printed
   in that order, the "first reading" named under the table would be the last
   row above it. The providers hand these over in both orders — clientData
   sorts ascending, useMeasurements descending — so the module sorts rather
   than trusting either. */

{
  const reversed = [...SCANS].reverse();
  const d = clientReportDoc(base({ composition: { status: 'ready', items: reversed } }));
  const iFirst = d.html.indexOf('82.4'), iLast = d.html.indexOf('80.1');
  ok(iFirst >= 0 && iLast >= 0 && iFirst < iLast, 'the oldest scan is printed above the newest whichever order it arrived in');
  const rows = toProgressRows(reversed);
  eq(rows[0].date, '2026-04-02', 'and the progress rows are ordered oldest-first for the change line');
  eq(rows[2].date, '2026-08-11', 'with the newest last');
  // And the resulting change is a loss, stated as one.
  ok(d.html.includes('−2.3') || d.html.includes('-2.3'), 'so the weight change reads as the 2.3 kg it is');
}

/* ── 12. what the client is told before it leaves the phone ───────────────*/

{
  const good = reportShareBlurb(clientReportDoc(base()));
  ok(good.includes('No photographs'), 'the share sheet says what is not in it');
  ok(!/could not be read/i.test(good), 'and says nothing about failures when there were none');

  const bad = reportShareBlurb(clientReportDoc(base({ injuries: { status: 'error', items: [] } })));
  ok(/BEFORE YOU SEND IT/.test(bad), 'a partial record warns the client BEFORE the file is in somebody else\'s inbox');
  ok(bad.includes('1 part of your record'), 'and says how many parts are missing, in the singular where it is one');

  const worse = reportShareBlurb(clientReportDoc(base({
    injuries: { status: 'error', items: [] },
    measurements: { status: 'error', items: [] },
  })));
  ok(worse.includes('2 parts'), 'and in the plural where it is more');
}

/* ── 13. the board is not trusted over the status that produced it ────────
   trainingBoard() already returns an unreadable board on a failed status, so
   the two agree today. They are checked SEPARATELY here because the caller
   holds a board in a variable across a re-read: a status that has just gone to
   'error' beside a board still holding last minute's sessions must produce the
   "not read" block, not a confident table of stale days. */

{
  const d = clientReportDoc(base({ training: { status: 'error', items: TRAINING } }));
  ok(d.html.includes('Not read.'), 'a failed status wins over a board that still holds rows');
  ok(!d.html.includes('Days trained'), 'and no totals are printed from them');
  ok(!d.complete, 'and the document is not complete');
}

/* ── 14. white label: the brand is the tenant's, never a constant ─────────
   This app ships under other people's names. A document that says "Repple" on
   a gym's own client's handover is the one artefact of the lot that leaves the
   building. */

{
  const d = clientReportDoc(base({ brand: 'Ironhaus Strength' }));
  ok(d.html.includes('Ironhaus Strength'), 'the tenant brand reaches the document heading');
  ok(!d.html.includes('Repple'), 'and the platform name does not appear anywhere on it');
  ok(d.text.includes('Ironhaus Strength'), 'in the text fallback as well');
  // A missing brand is the only case that falls back, and it falls back to
  // something rather than printing "undefined" on a clinical handover.
  ok(clientReportDoc(base({ brand: '' })).html.includes('Repple'), 'an empty brand falls back rather than printing nothing');
}

/* ── 15. the caveat list is exactly the sections that are not whole ───────*/

{
  eq(reportCaveats(base()).length, 0, 'four whole reads produce no caveats at all');
  eq(reportCaveats(base({ training: { status: 'loading', items: TRAINING } })).length, 1,
    'a section still loading produces a caveat — it is not silently treated as read');
}

declare const process: { exit(code: number): void };
console.log(errors.length ? 'CLIENT REPORT FAILURES:\n' + errors.join('\n') : 'ALL CLIENT REPORT TESTS PASSED');
if (errors.length) process.exit(1);
