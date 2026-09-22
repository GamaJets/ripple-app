// Correcting a disclosure instead of deleting and re-adding it.
// Compile with tsc, run with node.
//
// Two things are pinned here, and both are about the coach's acknowledgement:
// that fixing a typo does NOT reset it, and that changing what the injury
// actually is DOES. The first is the whole reason edit exists; the second is
// the reason edit is not a way round the gate.
import {
  injuryPatch, editResetsAck, editAckWarning, deleteInjuryConfirm, editSheetTitle,
  injuryOpenDays, injuryStanding, INJURY_RECHECK_DAYS,
} from './injuryEdit';
import { injuryKey } from './injuryGate';
import type { Injury } from './injuries';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const knee: Injury = {
  id: 'inj-1', area: 'knee', severity: 'moderate', status: 'active',
  note: 'sharp on deep squats', at: '2026-05-04T09:00:00Z',
};

/* ── the patch ─────────────────────────────────────────────────────────── */

const p = injuryPatch({ area: 'knee', severity: 'severe', note: '  worse since Tuesday  ' });
eq(p.area, 'knee', 'the area is carried through');
eq(p.severity, 'severe', 'and the new severity');
eq(p.note, 'worse since Tuesday', 'and the note is trimmed');

// The id and the disclosure date are absent ON PURPOSE. Re-stamping `at` would
// date a torn shoulder to the day somebody fixed a spelling, and minting a new
// id is exactly what delete-and-re-add did — the behaviour this replaces.
ok(!('id' in p), 'the patch does not carry an id, so the disclosure keeps the one it had');
ok(!('at' in p), 'nor a date, so a correction does not re-date the injury');
ok(!('status' in p), 'nor a status: Mark Recovered and Reactivate are their own controls');

eq(injuryPatch({ area: 'knee', severity: 'mild', note: '   ' }).note, undefined,
  'a note cleared to whitespace becomes undefined, not an empty string');
eq(injuryPatch({ area: 'knee', severity: 'mild' }).note, undefined, 'and an absent one stays absent');

/* ── what the edit does to the coach's acknowledgement ─────────────────── */

// Fixing the note. The key is unchanged, so the acknowledgement stands. This is
// the case the whole feature exists for: under the old screen this required
// Delete and re-add, which minted a new id and reset the coach to "not read".
ok(!editResetsAck(knee, { area: 'knee', severity: 'moderate', note: 'sharp on deep squats, better warm' }),
  'fixing the note does not disturb what the coach acknowledged');
eq(editAckWarning(knee, { area: 'knee', severity: 'moderate', note: 'typo fixed' }), null,
  'and the member is not warned about something that is not going to happen');

// Changing the severity. A mild knee that is now severe is news, and injuryKey
// says so — this test would fail if this module ever grew its own comparison.
ok(editResetsAck(knee, { area: 'knee', severity: 'severe' }),
  'changing the severity is a new disclosure');
ok(injuryKey({ area: 'knee', severity: 'moderate' }) !== injuryKey({ area: 'knee', severity: 'severe' }),
  'because injuryKey says it is, and this module asks injuryKey rather than deciding for itself');
const sevWarn = editAckWarning(knee, { area: 'knee', severity: 'severe' })!;
ok(/how bad this is/.test(sevWarn), 'and the member is told which change caused it');
ok(/read your injuries again/.test(sevWarn), 'and what their coach will be asked to do');

ok(editResetsAck(knee, { area: 'shoulder', severity: 'moderate' }), 'so is changing the area');
ok(/which part of your body/.test(editAckWarning(knee, { area: 'shoulder', severity: 'moderate' })!),
  'with its own sentence, because it is a different mistake to have made');

// A recovered injury gates nobody, so there is nothing to warn about.
eq(editAckWarning({ ...knee, status: 'recovered' }, { area: 'shoulder', severity: 'severe' }), null,
  'a recovered disclosure is not gating anybody, so no warning is invented for it');

/* ── deleting ──────────────────────────────────────────────────────────── */

const del = deleteInjuryConfirm(knee);
ok(/knee/.test(del.title), 'the confirm names which injury — "are you sure?" over five rows does not');
ok(/for good/.test(del.body), 'says it is permanent');
ok(/coach stops seeing it/.test(del.body), 'and what the coach loses');
ok(/Mark Recovered/.test(del.body),
  'and offers the thing most people reaching for Delete actually want');
ok(!/Mark Recovered/.test(deleteInjuryConfirm({ area: 'knee', status: 'recovered' }).body),
  'but not to somebody who has already marked it recovered');
ok(/not changed/.test(del.body), 'and does not overclaim: a program written around it is untouched');

/* ── the sheet ─────────────────────────────────────────────────────────── */

eq(editSheetTitle(true), 'Edit This Injury', 'an edit says so');
eq(editSheetTitle(false), 'Disclose an Injury', 'and a first disclosure keeps its own words');

/* ── how long a disclosure has been standing ───────────────────────────── */
//
// The gap this closes: `at` has been on every injury since the type was
// written and nothing has ever printed it, so a knee from a walk-in clinic two
// years ago reads exactly like this morning's and goes on hiding movements
// from somebody's program.
//
// Every case below is built from LOCAL date arithmetic rather than from a
// literal instant, because that is the whole point — the answer must be the
// same day's answer in Auckland and in Los Angeles. A fixture pinning an hour
// in UTC and calling it "five days" is a test that is wrong east of about
// UTC+7 rather than code that is.

/** Local midnight, `n` whole calendar days before the day `from` falls in. */
const daysBefore = (n: number, from = new Date()) => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() - n);
  return d;
};
const NOW = Date.now();

eq(injuryOpenDays(daysBefore(5).toISOString(), NOW), 5, 'five calendar days back is five days');
eq(injuryOpenDays(daysBefore(0).toISOString(), NOW), 0, 'this morning is nought');
eq(injuryOpenDays(daysBefore(400).toISOString(), NOW), 400, 'and the arithmetic rolls years');

// Null is not zero. A disclosure with no date is one whose age we do not know,
// and rendering it as "disclosed today" would invent a fact about a knee.
eq(injuryOpenDays(null, NOW), null, 'no date is not today');
eq(injuryOpenDays(undefined, NOW), null, 'nor is a missing one');
eq(injuryOpenDays('not a date', NOW), null, 'nor is an unreadable one');
eq(injuryOpenDays(daysBefore(-3).toISOString(), NOW), null,
  'a disclosure dated in the future has no age — "disclosed in 3 days" is worse than silence');

// A BARE YYYY-MM-DD is a calendar day, and is read as local midnight. Parsed
// as UTC it is the day before west of Greenwich, which is the trap
// src/lib/localDate.ts exists for.
const t = new Date();
const bareToday = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
eq(injuryOpenDays(bareToday, NOW), 0,
  "today's bare date is nought days old in every zone, not minus one west of Greenwich");

/* the sentence, and when the question is put */

const standing = (days: number, status: Injury['status'] = 'active') =>
  injuryStanding({ status, at: daysBefore(days).toISOString() }, NOW);

eq(standing(0).line, 'Disclosed today.', 'today says today, not "0 days ago"');
eq(standing(1).line, 'Disclosed yesterday.', 'and one day says yesterday');
eq(standing(5).line, 'Disclosed 5 days ago.', 'and the rest count');
ok(!standing(5).recheck, 'a recent disclosure is not questioned');
ok(!standing(INJURY_RECHECK_DAYS - 1).recheck, 'nor is one the day before the threshold');
ok(standing(INJURY_RECHECK_DAYS).recheck, 'the threshold itself asks');
ok(/mark it recovered/.test(standing(INJURY_RECHECK_DAYS + 200).line ?? ''),
  'and the question names the control that answers it');
ok(/still training around it/.test(standing(INJURY_RECHECK_DAYS).line ?? ''),
  'and says why it matters — the plan is still acting on this');

// A RECOVERED injury gets no line. Its age means nothing and inviting somebody
// to act on it is inviting them to act on nothing.
eq(standing(400, 'recovered').line, null, 'a healed injury is not asked about');
ok(!standing(400, 'recovered').recheck, 'and never prompts a recheck');
eq(standing(400, 'recovered').days, 400, 'though its age is still reported to a caller that wants it');

// An undated ACTIVE injury says nothing rather than hedging.
const undated = injuryStanding({ status: 'active', at: '' }, NOW);
eq(undated.days, null, 'an undated disclosure has no age');
eq(undated.line, null, 'and no sentence');
ok(!undated.recheck, 'and is never prompted on the strength of one');

// This module still says nothing about the document the injury may have been
// read off. The recheck prompt is about the INJURY.
ok(!/document|report|file/i.test(standing(400).line ?? ''),
  'the recheck sentence never mentions the document');

/* ── the line that must never move ─────────────────────────────────────── */
//
// Nothing in this module may reach a document. The injury may have been read
// off a physiotherapy report, and that report is private to the client by
// design (supabase/parts/91, coachShare.ts, injuryDocView.ts). Asserted on the
// module's own surface rather than by reading the file, so a function added
// later that takes a path fails here.
import * as injuryEdit from './injuryEdit';
for (const [name, value] of Object.entries(injuryEdit)) {
  ok(!/doc|file|path|bucket|upload|url/i.test(name),
    `injuryEdit exports nothing about documents, and ${name} looks like it might`);
  void value;
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('injuryEdit.test.ts — ok');
