// Correcting a disclosure instead of deleting and re-adding it.
// Compile with tsc, run with node.
//
// Two things are pinned here, and both are about the coach's acknowledgement:
// that fixing a typo does NOT reset it, and that changing what the injury
// actually is DOES. The first is the whole reason edit exists; the second is
// the reason edit is not a way round the gate.
import { injuryPatch, editResetsAck, editAckWarning, deleteInjuryConfirm, editSheetTitle } from './injuryEdit';
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
ok(/not changed/.test(del.body), 'and does not overclaim: a programme written around it is untouched');

/* ── the sheet ─────────────────────────────────────────────────────────── */

eq(editSheetTitle(true), 'Edit This Injury', 'an edit says so');
eq(editSheetTitle(false), 'Disclose an Injury', 'and a first disclosure keeps its own words');

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
