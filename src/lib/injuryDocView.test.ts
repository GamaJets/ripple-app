// A physiotherapy report does not leave the app. Compile with tsc, run with node.
//
// The defect: app/(client)/injury-doc.tsx called `Linking.openURL` on the
// signed Supabase URL of a stored medical document, which puts it in another
// app's history for the hour that URL stays live. These assertions hold the two
// halves of the replacement — which files this app can render itself, and the
// rule that nothing is ever routed out of the app whatever the file turns out
// to be.
import { injuryDocKind, injuryDocRoute, OPENS_IN_APP_NOTE, type InjuryDocKind } from './injuryDocView';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── what a stored object is ───────────────────────────────────────────── */

// The two this app actually writes. `injuryDocObjectPath` picks 'pdf' or 'jpg'
// from the content type it has just decided, so these are the whole of the
// real-world set.
eq(injuryDocKind('1756700000000-ab12cd34-physio-report.jpg'), 'image', 'a photographed report is an image');
eq(injuryDocKind('1756700000000-ab12cd34-physio-report.pdf'), 'pdf', 'an emailed report is a PDF');

eq(injuryDocKind('scan.JPG'), 'image', 'the extension is matched whatever case it arrives in');
eq(injuryDocKind('scan.PDF'), 'pdf', 'and so is the PDF one');
eq(injuryDocKind('scan.jpeg'), 'image', 'jpeg spelled long is the same file');
eq(injuryDocKind('scan.png'), 'image', 'a PNG chosen from Files is an image');
eq(injuryDocKind('mri.report.2026.pdf'), 'pdf', 'only the LAST dot decides — a dated filename is not an unknown one');

// 'unknown' is an answer, not a stand-in for 'pdf'. Handing an unrecognised
// file to the app's own image decoder because it is probably a photograph is
// exactly the guess this type exists to refuse.
eq(injuryDocKind('report'), 'unknown', 'a name with no extension says so');
eq(injuryDocKind('report.docx'), 'unknown', 'and an extension this app never writes is not quietly assumed to be one that it does');
eq(injuryDocKind(''), 'unknown', 'an empty name is unknown, not an image');
eq(injuryDocKind(null), 'unknown', 'and so is a name that did not come back at all');
eq(injuryDocKind(undefined), 'unknown', 'however it failed to come back');

/* ── where each of them opens ──────────────────────────────────────────── */

eq(injuryDocRoute('image'), 'in-app-viewer', 'an image is drawn by the app itself and the URL reaches nothing else');
eq(injuryDocRoute('pdf'), 'in-app-browser', 'a PDF goes to the sheet this app presents, because nothing in this build renders a PDF');
eq(injuryDocRoute('unknown'), 'in-app-browser', 'and an unrecognised file goes there too rather than to the image decoder');

// THE rule, asserted over every value of the type rather than over the three
// cases above, so a fourth kind added later cannot quietly acquire a route out
// of the app. There is no third route to escape to; this is the check that the
// type has not grown one.
const ALL: InjuryDocKind[] = ['image', 'pdf', 'unknown'];
for (const k of ALL) {
  const r = injuryDocRoute(k);
  ok(r === 'in-app-viewer' || r === 'in-app-browser', `${k}: opens somewhere inside the app`);
  ok(!/system|external|linking/i.test(r), `${k}: nothing is routed to another app`);
}

/* ── and the member is told ────────────────────────────────────────────── */

ok(/inside the app/i.test(OPENS_IN_APP_NOTE), 'the note says where the file opens');
ok(/browser/i.test(OPENS_IN_APP_NOTE), 'and names the thing it is not handed to, because that is the part somebody would otherwise assume');
ok(OPENS_IN_APP_NOTE[0] === OPENS_IN_APP_NOTE[0].toUpperCase() && / [a-z]/.test(OPENS_IN_APP_NOTE),
  'sentence case, because it is prose and not a label');

if (errors.length) {
  for (const e of errors) console.error('  ✗ ' + e);
  console.error(`injuryDocView: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('injuryDocView: ok (an image is drawn in the app, everything else opens in the app’s own sheet, nothing goes to the system browser)');
