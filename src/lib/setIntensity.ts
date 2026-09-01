/**
 * HOW HARD, AT WHAT SHARE OF A MAX, AND AT WHAT SPEED — the three things a
 * coach could write down everywhere except in this app.
 *
 * ── What a coach was doing instead ────────────────────────────────────────
 *
 * A programme could say "4 × 6 at 100 kg" and nothing else. Everything a coach
 * actually adds to that — "@8", "@75%", "3-1-1" — went into
 * `ProgramExercise.note`, as free text, because there was nowhere else for it.
 * That is not a cosmetic problem. A note is a sentence rendered under a
 * movement; it is not a column, it does not line up with the set it describes,
 * and on a four-row table where set 1 is a warm-up and set 4 is a top single
 * there is exactly one note for all four. So the coach wrote "sets 3 and 4 at
 * RPE 8" and the client read a sentence at the machine and worked out which
 * rows it meant, in the middle of a session, under load.
 *
 * `tempo` compounds it. It already exists in this app — as one of the twelve
 * ids in src/lib/setMethods.ts, where it is a LABEL saying "this set is a tempo
 * set" and carries no notation at all. A set marked `method: 'tempo'` says the
 * speed matters and cannot say what the speed is. The notation went in the
 * note, in whichever of the four common orders the coach happened to learn.
 *
 * ── Why these are three fields and not one ────────────────────────────────
 *
 * They are three different KINDS of claim and the app must never convert
 * between them:
 *
 *   · RPE is what the lifter reports. It is subjective, it is theirs, and it
 *     is the only one of the three that survives a bad night's sleep honestly.
 *   · %1RM is arithmetic against a maximum. It needs a maximum, and this app
 *     does not have a tested one for most people — `priorBest1RM` in
 *     src/lib/progression.ts estimates from logged sets and is explicitly an
 *     estimate.
 *   · Tempo is a description of the rep itself and has nothing to do with how
 *     heavy it is.
 *
 * There are published tables that map RPE to %1RM at a given rep count. NONE
 * of them is used here and none will be. Turning "@8" into "at 82.5 kg" is the
 * app putting a load on a bar that the coach did not write, derived from a
 * one-rep max nobody tested, on the strength of a table whose author this app
 * cannot cite to the person lifting it. `pct1RMLoad` below therefore does not
 * exist; the only arithmetic offered is `percentLoadKg`, which needs a maximum
 * the CALLER states and is documented as the caller's claim, not this file's.
 *
 * ── absent inherits, present answers ──────────────────────────────────────
 *
 * The same rule the rest of src/lib/setRows.ts follows, for the same reason.
 * These three fields are OPTIONAL on both `ProgramExercise` and `SetRow`, and
 * absent on a row means "the exercise's own answer". Every programme already
 * written carries none of them, and every one of those must render and run in
 * a new build exactly as it does in the old one — a programme lives in
 * `program_templates`, on each client's `assigned_programs` row, and in the
 * coach's on-device AsyncStorage draft, and no migration reaches all three.
 *
 * ── Who sees them ─────────────────────────────────────────────────────────
 *
 * BOTH SIDES, now. `app/(client)/workouts.tsx` draws `intensityLine` beside the
 * movement and beside each set of a table, and the guided runner draws it for
 * the set the client is standing in front of the bar for. `intensityMeaning`
 * below is what goes with it: RPE and tempo spelled out in words, because "@8"
 * and "3-1-1-0" are notations a coach knows and a client may be reading for the
 * first time.
 *
 * There WAS a constant here — `CLIENT_CANNOT_SEE_INTENSITY` — printed in the
 * builder the moment a coach typed one of the three, saying the client's Train
 * tab would not show it. It is deleted rather than softened, because the thing
 * it described is no longer true. A warning that is no longer true is worse
 * than no warning: it tells a coach to go on writing the tempo into the
 * exercise note as well, which is the duplication these three fields exist to
 * end.
 *
 * Everything here is pure and framework-free so a test can hold all of it
 * without a database or a device.
 */

/* ── RPE ──────────────────────────────────────────────────────────────────── */

/**
 * The lowest RPE worth writing on a plan. Six, because RPE below six is "this
 * was easy" and a coach who means that writes a warm-up — which this app
 * already has a field for, in `method`. Refused rather than clamped: a coach
 * who typed 3 meant something, and silently storing 6 would put a number on a
 * client's screen that nobody chose.
 *
 * Not 1. The full Borg CR10 scale runs from 1, and a rating of 2 is a real
 * thing a LIFTER can report after the fact — but this field is a PRESCRIPTION,
 * written before the set, and prescribing an RPE of 2 is prescribing nothing.
 * `feel` in src/lib/mockData.ts is the post-hoc side and has its own vocabulary.
 */
export const RPE_MIN = 6;

/** Ten is the top of the scale by definition: no further rep was possible. */
export const RPE_MAX = 10;

/**
 * What an RPE box accepted, or the sentence saying why it did not.
 *
 * A discriminated union rather than `number | null`, because "not a number" and
 * "a number outside the scale" are two different things to say to a coach and
 * a null collapses them into one.
 */
export type ReadRpe =
  | { ok: true; rpe: number }
  | { ok: false; why: string };

/**
 * Read what the coach typed into the RPE box.
 *
 * HALVES ONLY, and this is the whole reason the function exists rather than a
 * `Number()` call at the call site. RPE 8.5 is a real and widely used
 * prescription — "one to two reps left" — and RPE 8.3 is not a thing anybody
 * can rate a set at. A field that accepted 8.3 would render "@8.3" on a plan
 * and imply a precision the scale does not have. Refused, not rounded, for the
 * reason src/lib/packageEdit.ts gives about prices: a silent correction shows
 * somebody a number they did not enter.
 *
 * A COMMA is a decimal point. The keyboard under this field is the decimal pad,
 * and on a German, French, Spanish or Italian phone the decimal key on that pad
 * types a comma — `parseFloat('8,5')` is 8, which is a different prescription
 * silently. src/lib/units.ts documents the same trap for loads at length.
 *
 * Blank is `ok: false` with the "nothing here" sentence rather than a thrown
 * error, and callers clearing a field do not call this at all — they write
 * `null`, which is the coach saying there is no RPE on this set. Blank and null
 * are the same intent and the caller decides; this function's job is to refuse
 * a value it cannot store faithfully.
 */
export function readRpe(text: string | null | undefined): ReadRpe {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s) return { ok: false, why: 'Nothing was typed, so there is no effort target to save.' };
  if (!/^\d{1,2}(\.\d)?$/.test(s)) {
    return { ok: false, why: 'An effort target is a number on the RPE scale, like 8 or 8.5.' };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, why: 'That is not a number this app can read.' };
  if (n < RPE_MIN || n > RPE_MAX) {
    return { ok: false, why: `RPE runs from ${RPE_MIN} to ${RPE_MAX} on a written plan. Anything easier than ${RPE_MIN} is a warm-up, and the set method already says that.` };
  }
  // Halves. `n * 2` is integral for 8 and 8.5 and is not for 8.3, and the
  // multiplication is exact for one decimal place in binary floating point at
  // this magnitude — 8.5 * 2 is 17, not 16.999999999999996. Tested rather than
  // trusted; see setIntensity.test.ts, which sweeps every tenth from 6 to 10.
  if (!Number.isInteger(n * 2)) {
    return { ok: false, why: 'RPE is written in halves — 8 or 8.5, not 8.3.' };
  }
  return { ok: true, rpe: n };
}

/**
 * How an RPE reads beside a set. `@8`, `@8.5`.
 *
 * The `@` is the notation every coach already writes and it is what makes the
 * number legible without a label taking a column. A bare "8" in a row of
 * numbers is indistinguishable from a rep count, which is the column
 * immediately to its left.
 *
 * Null in, null out — an absent RPE is not "@—". A dash inside a notation is
 * the exact shape scripts/check-prose.mjs exists to catch, and the caller
 * renders nothing at all.
 */
export function rpeLabel(rpe: number | null | undefined): string | null {
  if (typeof rpe !== 'number' || !Number.isFinite(rpe)) return null;
  // No trailing zero: 8, not 8.0. `Number.prototype.toString` already does
  // this and does not need a decimal-place count that would have to be kept in
  // step with the halves rule above.
  return `@${rpe}`;
}

/**
 * What an RPE MEANS, spelled out. Shown once on the screen rather than beside
 * every row.
 *
 * A coach knows this and their client may not, and the sentence is the reason
 * the number is worth prescribing at all: RPE 8 is not "hard", it is "two reps
 * left". Written as reps in reserve because that is the only phrasing a person
 * under a bar can act on.
 */
export function rpeMeaning(rpe: number | null | undefined): string | null {
  if (typeof rpe !== 'number' || !Number.isFinite(rpe)) return null;
  const left = RPE_MAX - rpe;
  if (left <= 0) return 'no further rep was possible';
  if (left < 1) return 'about half a rep left';
  if (left === 1) return 'one rep left';
  return `about ${left % 1 === 0 ? left : left.toFixed(1)} reps left`;
}

/* ── %1RM ─────────────────────────────────────────────────────────────────── */

/** The narrowest share of a maximum worth writing on a plan. Below this is
 *  warm-up territory and the method field already says warm-up. */
export const PCT_MIN = 30;
/** Above 100% of a one-rep max there is no rep. Accepted up TO 100 and not
 *  past it: an overload single at 102% is a real method in powerlifting, but it
 *  is not a percentage of a max any more, it is a partial or an eccentric, and
 *  both of those are set methods this app already has. */
export const PCT_MAX = 100;

export type ReadPercent =
  | { ok: true; pct: number }
  | { ok: false; why: string };

/**
 * Read what the coach typed into the %1RM box.
 *
 * WHOLE PERCENTAGES. Not because a fraction is meaningless in principle but
 * because it is meaningless against THIS input: the maximum it is a percentage
 * of is, for almost every client in this app, an estimate derived from logged
 * sets by `priorBest1RM`. 72.5% of an estimate is a made-up precision on top of
 * an estimate. Whole percents keep the notation honest about what it is.
 *
 * The trailing `%` a coach types is accepted and stripped, because they will
 * type it and refusing it would be the app being pedantic about its own box.
 */
export function readPercent1RM(text: string | null | undefined): ReadPercent {
  const s = String(text ?? '').trim().replace(/%\s*$/, '').trim();
  if (!s) return { ok: false, why: 'Nothing was typed, so there is no percentage to save.' };
  if (!/^\d{1,3}$/.test(s)) {
    return { ok: false, why: 'A share of a one-rep max is a whole percentage, like 75.' };
  }
  const n = Number(s);
  if (n < PCT_MIN || n > PCT_MAX) {
    return { ok: false, why: `Write a share between ${PCT_MIN}% and ${PCT_MAX}%. Lighter than that is a warm-up, and the set method already says so.` };
  }
  return { ok: true, pct: n };
}

/** `75%`. Null in, null out, for the reason `rpeLabel` gives. */
export function percentLabel(pct: number | null | undefined): string | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  return `${pct}%`;
}

/**
 * The load a percentage names, GIVEN a maximum the caller states.
 *
 * This is the only arithmetic in this file and it is deliberately awkward to
 * call: it takes `oneRepMaxKg` as an argument rather than reaching for one,
 * because there is no maximum in this app that is a fact. `priorBest1RM` is an
 * Epley estimate off logged sets; a coach's own figure is a memory of a gym day.
 * A function that fetched one itself would let a screen print "82.5 kg" beside
 * "@75%" with nothing on that screen saying whose 110 kg it divided.
 *
 * Returns null rather than 0 for an unusable maximum, so a caller cannot print
 * a bar with nothing on it as though it were a prescription.
 *
 * Rounded to one decimal place and NOT to the nearest plate. Plate maths is
 * src/lib/plateMath.ts's job and needs to know the bar and the plates available
 * in that gym; rounding here would be this file inventing a barbell.
 */
export function percentLoadKg(pct: number | null | undefined, oneRepMaxKg: number | null | undefined): number | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (typeof oneRepMaxKg !== 'number' || !Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return null;
  return Math.round(oneRepMaxKg * pct) / 100;
}

/* ── tempo ────────────────────────────────────────────────────────────────── */

/**
 * A tempo as this app stores it: four phases, in the conventional order.
 *
 * ── Why four, and why THIS order ──────────────────────────────────────────
 *
 * The near-universal notation is four digits read as
 * eccentric · pause at the bottom · concentric · pause at the top, so "3-1-1-0"
 * on a squat is three seconds down, one second in the hole, one second up, no
 * pause standing. That order is the one printed on the wall of most gyms and it
 * is what a coach typing "3110" means.
 *
 * The trap is that it is not universal — a minority of coaching literature
 * writes concentric first — and a stored ambiguity is worse than no field. So
 * this app never stores four bare digits and hopes: `tempoPhases` names each
 * number, `tempoMeaning` spells the whole thing out in words, and the builder
 * prints that sentence under the box while the coach is typing. A coach who
 * reads the other convention sees immediately that this one disagrees, which is
 * the only defence against a silently reversed rep.
 *
 * 'X' is accepted in the concentric slot and means "as fast as you can move
 * it", which is the one phase that has a standard non-numeric value. It is
 * stored as the letter rather than as 0, because 0 means "no pause / no time
 * under tension" and X means the opposite of a pause — maximum intent. Storing
 * X as 0 would flatten an explosive rep into an unregulated one.
 */
export type TempoPhases = {
  /** Seconds lowering, or null when the phase is not a count. */
  eccentricSec: number | null;
  /** Seconds held at the bottom. */
  bottomSec: number | null;
  /** Seconds lifting, or 'X' for as fast as possible. */
  concentric: number | 'X';
  /** Seconds held at the top. */
  topSec: number | null;
};

export type ReadTempo =
  | { ok: true; tempo: string; phases: TempoPhases }
  | { ok: false; why: string };

/** The most seconds a single phase may name. Nine, because the notation is one
 *  character per phase — "10" in a four-slot string is unreadable, and a ten
 *  second eccentric is written as a note, not as a tempo. */
const PHASE_MAX = 9;

/**
 * Read a tempo the coach typed, in any of the spellings they will type it in.
 *
 * Accepted: "3110", "3-1-1-0", "3 1 1 0", "30X1", "3-0-X-1", and the
 * THREE-phase forms "311" and "3-1-1" — which are extremely common and mean
 * eccentric, pause, concentric with no pause at the top. A three-phase tempo is
 * canonicalised to four by appending a 0, because the stored value must have
 * one meaning; the coach's own three characters are not preserved, and that is
 * a real if small loss stated here rather than hidden.
 *
 * CANONICAL FORM IS DASHED: "3-1-1-0". A stored "3110" is indistinguishable
 * from a rep scheme at a glance and a client reading it on a phone at arm's
 * length has to count characters. The dashes cost three bytes in a jsonb column
 * and remove that entirely.
 */
export function readTempo(text: string | null | undefined): ReadTempo {
  const raw = String(text ?? '').trim().toUpperCase();
  if (!raw) return { ok: false, why: 'Nothing was typed, so there is no tempo to save.' };
  // Every separator a coach might reach for, including the en dash a phone
  // autocorrects a hyphen into mid-string.
  const parts = raw.split(/[\s\-–—:.]+/).filter((p) => p !== '');
  // "3110" arrives as one part of four characters and is split here rather than
  // in the regex, so a mixed spelling like "31-10" reaches the same place.
  const chars = parts.length === 1 ? parts[0].split('') : parts;
  if (chars.length !== 3 && chars.length !== 4) {
    return { ok: false, why: 'A tempo is three or four numbers — down, pause, up, and a pause at the top if there is one. Like 3-1-1 or 3-0-X-1.' };
  }
  const slots = chars.length === 3 ? [...chars, '0'] : chars;
  for (let i = 0; i < slots.length; i++) {
    const c = slots[i];
    if (c === 'X') {
      // Only the CONCENTRIC may be X. An eccentric "as fast as possible" is a
      // drop, not a tempo, and an X in a pause slot is not a length of pause —
      // it is a coach typing in the wrong box, and storing it would render a
      // rep instruction nobody can follow.
      if (i !== 2) {
        return { ok: false, why: 'X means "as fast as you can" and only fits the lifting phase — the third number.' };
      }
      continue;
    }
    if (!/^\d$/.test(c) || Number(c) > PHASE_MAX) {
      return { ok: false, why: `Each phase is a single number of seconds, 0 to ${PHASE_MAX}, or X for the lifting phase.` };
    }
  }
  const n = (c: string): number | null => (c === 'X' ? null : Number(c));
  return {
    ok: true,
    tempo: slots.join('-'),
    phases: {
      eccentricSec: n(slots[0]),
      bottomSec: n(slots[1]),
      concentric: slots[2] === 'X' ? 'X' : Number(slots[2]),
      topSec: n(slots[3]),
    },
  };
}

/**
 * The phases of an already-stored tempo, or null when the stored string is not
 * one this build can read.
 *
 * Null is a real answer and the caller must handle it. A jsonb column can hold
 * anything a past or future build wrote, and a renderer that assumed four
 * phases would either crash or print `undefined` under somebody's squat.
 */
export function tempoPhases(tempo: string | null | undefined): TempoPhases | null {
  const r = readTempo(tempo);
  return r.ok ? r.phases : null;
}

/**
 * A tempo in words, which is what stops the notation being ambiguous.
 *
 * "3 sec down · 1 sec pause · 1 sec up" — printed under the field in the
 * builder while the coach types, so a coach who reads the other convention sees
 * this one disagreeing with them immediately rather than after their client has
 * done four weeks of reversed reps.
 *
 * Returns null for an unreadable tempo rather than a sentence full of dashes.
 */
export function tempoMeaning(tempo: string | null | undefined): string | null {
  const p = tempoPhases(tempo);
  if (!p) return null;
  const bits: string[] = [];
  bits.push(`${p.eccentricSec} sec down`);
  if (p.bottomSec) bits.push(`${p.bottomSec} sec pause`);
  bits.push(p.concentric === 'X' ? 'up as fast as you can' : `${p.concentric} sec up`);
  if (p.topSec) bits.push(`${p.topSec} sec at the top`);
  return bits.join(' · ');
}

/* ── resolving a row against its exercise ────────────────────────────────── */

/** The three fields, wherever they sit. Structural so both a `SetRow` and a
 *  `ProgramExercise` — and the builder's own `BEx`, which carries fields this
 *  file has no opinion about — satisfy it without conversion. */
export type IntensitySpec = {
  rpe?: number | null;
  pct1rm?: number | null;
  tempo?: string | null;
};

/** All three resolved: what this set actually prescribes. */
export type Intensity = {
  rpe: number | null;
  pct1rm: number | null;
  tempo: string | null;
};

const own = (o: object | null | undefined, k: string): boolean =>
  !!o && Object.prototype.hasOwnProperty.call(o, k) && (o as Record<string, unknown>)[k] !== undefined;

/**
 * A row's intensity, falling back to the exercise's.
 *
 * The same absent-inherits / present-answers rule the rest of `setRows` uses,
 * and it matters in exactly the same way: `{ rpe: null }` on a row is a set the
 * coach deliberately took the RPE off, inside an exercise that carries one, and
 * it must not silently pick the exercise's back up. That is a top single with
 * no target inside a block written at RPE 8, which is a thing coaches programme
 * on purpose.
 */
export function intensityOf(ex: IntensitySpec | null | undefined, row: IntensitySpec | null | undefined): Intensity {
  const pick = <K extends keyof IntensitySpec>(k: K): IntensitySpec[K] =>
    (own(row, k) ? (row as IntensitySpec)[k] : (ex ? ex[k] : null)) ?? null;
  return {
    rpe: (pick('rpe') as number | null) ?? null,
    pct1rm: (pick('pct1rm') as number | null) ?? null,
    tempo: (pick('tempo') as string | null) ?? null,
  };
}

/**
 * The one line a set's intensity reads as, or null when it prescribes none.
 *
 * `@8 · 75% · 3-1-1-0`. Middle dots rather than commas because the row already
 * uses them and because these are three independent facts rather than a list of
 * one kind of thing.
 *
 * Null rather than an empty string when nothing is set, so a caller renders
 * NOTHING rather than an empty line taking vertical space under every set of
 * every programme ever written — which is every programme, since none of them
 * carry these fields.
 */
export function intensityLine(i: Intensity): string | null {
  const bits = [rpeLabel(i.rpe), percentLabel(i.pct1rm), i.tempo].filter((x): x is string => !!x);
  return bits.length ? bits.join(' · ') : null;
}

/**
 * The three notations spelled out for the person doing the lifting.
 *
 * One sentence per field that is actually set, so a caller renders a line each
 * and an exercise carrying none of the three renders nothing at all. An empty
 * array rather than a joined paragraph: three of these on one line is a wall of
 * prose under a movement name, and the client is reading it standing up.
 *
 * ── Why the percentage does not become a weight ───────────────────────────
 *
 * `percentLoadKg` exists, takes a maximum as an argument, and is called from
 * NOWHERE. That is deliberate and this sentence is where it is defended to the
 * client rather than only in a comment: there is no tested one-rep max anywhere
 * in this app. `priorBest1RM` in src/lib/progression.ts and `est1RM` in
 * src/lib/streaks.ts are both Epley estimates off logged sets, and turning
 * "@75%" into "82.5 kg" off an estimate is the app putting a weight on a bar
 * that nobody chose, in a number the client will then load. So the percentage
 * is shown as a percentage and the line says why. If a real recorded maximum
 * ever exists here, the figure derived from it must say what it was derived
 * from, on the same line, in the same breath.
 *
 * The RPE sentence is reps in reserve, from `rpeMeaning`, because that is the
 * only phrasing somebody under a bar can act on. The tempo sentence is
 * `tempoMeaning`, which is the whole defence against the minority convention
 * that writes the concentric first: a client whose coach reads that convention
 * sees this one disagreeing in words before they lower anything.
 */
export function intensityMeaning(i: Intensity): string[] {
  const out: string[] = [];
  const rpe = rpeMeaning(i.rpe);
  if (i.rpe != null && rpe) out.push(`RPE ${i.rpe} means ${rpe}.`);
  if (i.pct1rm != null) {
    out.push(
      `${i.pct1rm}% is the share of a one rep max your coach wrote. It stays a percentage here: `
      + 'this app has no tested maximum for you, so it will not work out a weight for the bar from it.',
    );
  }
  const tempo = tempoMeaning(i.tempo);
  if (tempo) out.push(`Tempo ${i.tempo} is ${tempo}.`);
  return out;
}
