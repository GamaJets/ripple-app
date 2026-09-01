// RPE, %1RM and tempo — the three things a coach was writing into a free-text
// note because there was nowhere else to put them. Compile with tsc, run with node.
//
// The bug every assertion here is aimed at: a number on a plan is an
// instruction somebody follows under a bar. A silently rounded RPE is a
// prescription nobody wrote; a tempo stored in an order the app does not state
// is a rep performed backwards for four weeks; and a %1RM converted into
// kilograms off an estimated maximum is the app putting weight on a bar on the
// strength of arithmetic it cannot cite.
import {
  RPE_MIN, RPE_MAX, PCT_MIN, PCT_MAX, CLIENT_CANNOT_SEE_INTENSITY,
  readRpe, rpeLabel, rpeMeaning, readPercent1RM, percentLabel, percentLoadKg,
  readTempo, tempoPhases, tempoMeaning, intensityOf, intensityLine,
} from './setIntensity';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── RPE: halves only, refused rather than rounded ──────────────────────── */

eq(readRpe('8'), { ok: true, rpe: 8 }, 'a whole RPE is read');
eq(readRpe('8.5'), { ok: true, rpe: 8.5 }, 'and a half');
eq(readRpe(' 9 '), { ok: true, rpe: 9 }, 'surrounding space is not a value');

// The decimal key on a German, French, Spanish or Italian phone types a COMMA.
// `parseFloat('8,5')` is 8, which is a different prescription, silently. The
// same trap src/lib/units.ts documents for loads.
eq(readRpe('8,5'), { ok: true, rpe: 8.5 }, 'a comma is a decimal point, because on half of Europe it is the key on the pad');

ok(!readRpe('8.3').ok, 'a third of a rep is not a thing anybody can rate a set at');
ok(/halves/.test((readRpe('8.3') as { why: string }).why), 'and the refusal says why in words a coach can act on');
ok(!readRpe('').ok, 'a blank box is not an RPE');
ok(!readRpe('hard').ok, 'nor is a word — that is what `feel` is for, and it belongs to the client');
ok(!readRpe('11').ok, 'there is no eleven: ten is "no further rep was possible"');
ok(!readRpe('3').ok, 'and anything easy enough to be a three is a warm-up, which the method field already says');
eq(readRpe(String(RPE_MIN)), { ok: true, rpe: RPE_MIN }, 'the floor itself is allowed');
eq(readRpe(String(RPE_MAX)), { ok: true, rpe: RPE_MAX }, 'and so is the ceiling');

// Every tenth from the floor to the ceiling, so the halves rule is proved
// across the whole scale rather than at the two values somebody thought of.
// Floating point is the reason: `8.5 * 2` must be exactly 17 and `8.3 * 2`
// must not be an integer, at every magnitude the scale reaches.
for (let tenth = RPE_MIN * 10; tenth <= RPE_MAX * 10; tenth++) {
  const v = tenth / 10;
  const r = readRpe(v.toFixed(1));
  const shouldPass = tenth % 5 === 0;
  ok(r.ok === shouldPass, `RPE ${v.toFixed(1)} should ${shouldPass ? 'be accepted' : 'be refused'}`);
}

eq(rpeLabel(8), '@8', 'the notation is the one coaches already write');
eq(rpeLabel(8.5), '@8.5', 'and a half keeps its half');
eq(rpeLabel(8.0), '@8', 'without a trailing zero, which reads as a precision the scale has not got');
eq(rpeLabel(null), null, 'no RPE renders nothing at all, never "@—"');

// The meaning is reps in reserve, because that is the only phrasing somebody
// under a bar can act on. "Hard" is not an instruction.
ok(/two reps|about 2 reps/.test(rpeMeaning(8) ?? ''), 'RPE 8 is about two reps left');
eq(rpeMeaning(10), 'no further rep was possible', 'and ten is the top of the scale by definition');
eq(rpeMeaning(9), 'one rep left', 'nine is one');
eq(rpeMeaning(null), null, 'and an absent RPE means nothing rather than saying something vague');

/* ── %1RM: whole percentages, and never turned into kilograms alone ─────── */

eq(readPercent1RM('75'), { ok: true, pct: 75 }, 'a whole percentage is read');
eq(readPercent1RM('75%'), { ok: true, pct: 75 }, 'and the sign a coach types is accepted rather than lectured about');
ok(!readPercent1RM('72.5').ok, 'a fraction of a percent of an ESTIMATED maximum is a made-up precision on top of an estimate');
ok(!readPercent1RM('120').ok, 'above a maximum there is no rep — an overload single is a method, not a percentage');
ok(!readPercent1RM('10').ok, 'and a tenth of a maximum is a warm-up');
eq(readPercent1RM(String(PCT_MIN)), { ok: true, pct: PCT_MIN }, 'the floor is allowed');
eq(readPercent1RM(String(PCT_MAX)), { ok: true, pct: PCT_MAX }, 'and so is a hundred');
eq(percentLabel(75), '75%', 'it renders with its sign');
eq(percentLabel(null), null, 'and absent renders nothing');

// THE refusal this module is built around. There is arithmetic here, and it
// takes the maximum as an ARGUMENT so that the claim belongs to whoever
// supplies it — nobody in this app has tested a one-rep max.
eq(percentLoadKg(75, 100), 75, 'a share of a stated maximum is arithmetic');
eq(percentLoadKg(75, null), null, 'a share of no maximum is not a load');
eq(percentLoadKg(75, 0), null, 'and a share of nothing is not nought kilograms on a bar');
eq(percentLoadKg(null, 100), null, 'no percentage is no load');
eq(percentLoadKg(82, 137.5), 112.75, 'rounded to a tenth, and NOT to the nearest plate — a barbell is plateMath.ts’s to invent');

/* ── tempo: one order, spelled out in words wherever it is shown ────────── */

eq(readTempo('3110').ok && (readTempo('3110') as { tempo: string }).tempo, '3-1-1-0',
  'four bare digits are stored dashed, because a client reads it at arm’s length');
eq((readTempo('3-1-1-0') as { tempo: string }).tempo, '3-1-1-0', 'and a dashed one round-trips');
eq((readTempo('3 1 1 0') as { tempo: string }).tempo, '3-1-1-0', 'spaces are separators');
eq((readTempo('3–1–1–0') as { tempo: string }).tempo, '3-1-1-0', 'so is the en dash a phone autocorrects a hyphen into');

// The three-phase form is extremely common and is canonicalised to four, which
// is a real if small loss and is stated in the header rather than hidden.
eq((readTempo('311') as { tempo: string }).tempo, '3-1-1-0', 'a three-phase tempo gains an explicit no-pause at the top');
eq((readTempo('3-1-1') as { tempo: string }).tempo, '3-1-1-0', 'dashed or not');

eq((readTempo('30X1') as { tempo: string }).tempo, '3-0-X-1', 'X is the lifting phase and survives as a letter');
ok(!readTempo('X110').ok, 'an eccentric "as fast as possible" is a drop, not a tempo');
ok(!readTempo('31X').ok === false, 'a three-phase tempo may still end on X in the lifting slot');
ok(!readTempo('3X10').ok, 'and an X in a pause slot is not a length of pause');
ok(!readTempo('31').ok, 'two numbers do not describe a rep');
ok(!readTempo('31100').ok, 'nor do five');
ok(!readTempo('').ok, 'a blank box is not a tempo');
ok(!readTempo('slow').ok, 'and neither is a word');

// X is stored as X and NOT as 0. Zero means "no pause"; X means the opposite of
// a pause — maximum intent — and flattening one into the other turns an
// explosive rep into an unregulated one.
eq(tempoPhases('3-0-X-1')?.concentric, 'X', 'X stays X');
eq(tempoPhases('3-0-0-1')?.concentric, 0, 'and a zero stays a number');
eq(tempoPhases('not a tempo'), null, 'a stored value this build cannot read is null rather than a crash');

// The WORDS are the defence against the notation being ambiguous: a minority of
// coaching literature writes concentric first, and a coach who reads that one
// has to see this app disagreeing with them while they are typing.
ok(/3 sec down/.test(tempoMeaning('3-1-1-0') ?? ''), 'the first number is named as the lowering phase');
ok(/1 sec up/.test(tempoMeaning('3-1-1-0') ?? ''), 'and the third as the lifting phase');
ok(/as fast as you can/.test(tempoMeaning('3-0-X-1') ?? ''), 'X is spelled out rather than left as a letter');
ok(!/pause/.test(tempoMeaning('3-0-1-0') ?? ''), 'a zero pause is not mentioned — a phase of no time is not an instruction');
eq(tempoMeaning('nonsense'), null, 'and an unreadable tempo says nothing rather than a sentence full of dashes');

/* ── absent inherits, present answers ───────────────────────────────────── */

const ex = { rpe: 8, pct1rm: 75, tempo: '3-1-1-0' };

eq(intensityOf(ex, {}), { rpe: 8, pct1rm: 75, tempo: '3-1-1-0' },
  'a row that says nothing follows the exercise');
eq(intensityOf(ex, { rpe: 9 }).rpe, 9, 'a row that says something answers for itself');

// THE assertion. `{ rpe: null }` is a top single with no target inside a block
// written at RPE 8, which is a thing coaches programme on purpose — and a
// resolver that treated null as absence would silently put the 8 back.
eq(intensityOf(ex, { rpe: null }).rpe, null, 'an explicit null is the row taking the target OFF, not the row saying nothing');
eq(intensityOf(ex, { rpe: undefined }).rpe, 8, 'and undefined is absence, which is what survives jsonb and JSON.stringify');
eq(intensityOf(null, null), { rpe: null, pct1rm: null, tempo: null },
  'an exercise with none of the three prescribes none of the three');

eq(intensityLine({ rpe: 8, pct1rm: 75, tempo: '3-1-1-0' }), '@8 · 75% · 3-1-1-0', 'all three read as one line');
eq(intensityLine({ rpe: 8, pct1rm: null, tempo: null }), '@8', 'and one reads as one');
eq(intensityLine({ rpe: null, pct1rm: null, tempo: null }), null,
  'none of them renders NOTHING rather than an empty line under every set of every programme ever written');

/* ── the promise this feature must not make ─────────────────────────────── */

// A coach who types a tempo believes they have told somebody to lower the bar
// over three seconds. Today they have not: the client's Train tab draws reps,
// load and the method badge and knows nothing about these fields. Letting that
// belief stand is worse than not shipping them, because the coach stops writing
// it in the note as well — and then it reaches the client through nothing.
ok(/do not appear on the client/i.test(CLIENT_CANNOT_SEE_INTENSITY),
  'the sentence says plainly that the client does not see these yet');
ok(/exercise note/.test(CLIENT_CANNOT_SEE_INTENSITY),
  'and says where to put what the client does need at the machine');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('setIntensity: ok — halves, whole percents, one tempo order, and a client renderer that is honest about not showing any of it');
