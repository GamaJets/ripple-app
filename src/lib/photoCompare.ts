// Putting two progress photos side by side, and putting the right numbers
// under them.
//
// The compare panel in app/(client)/scans.tsx already showed two pictures, two
// dates and the gap between them. What it did not show was any measurement, and
// TF-23 asks for "the readings from those days". This file is where those
// readings are decided, because deciding them is the entire risk of the
// feature and it is not a thing to do inline in a render.
//
// ── WHY THIS IS NOT read straight off the photo row ───────────────────────
//
// `progress_photos` has `weight_kg` and `body_fat_pct` columns, and
// `ProgressPhoto` carries them through as `weightKg` / `bodyFatPct`. The
// obvious implementation is to print those. It would print a dash for every
// photo anybody has ever taken: `savePhoto()` calls `uploadProgressPhoto(uri)`
// with no `opts`, so both columns are inserted null on every single upload.
// Rendering them would have looked like working code and produced a compare
// panel whose numbers were permanently empty, which reads to the person using
// it as "the app lost my measurements" rather than "nobody wired this up".
//
// The measurement that actually exists for a given day is the InBody scan, in
// `cd.scans`. So a photo's readings are the readings of the scan taken on the
// same calendar day, and nothing else.
//
// ── THE "SAME DAY" TRAP, WHICH IS A REAL BUG AND NOT A HYPOTHETICAL ───────
//
// The two sides are stored as different kinds of value, and comparing them
// naively is wrong west of Greenwich:
//
//   photo.takenAt  `new Date().toISOString()` — an INSTANT, in UTC
//   scan.takenAt   `2026-08-29` — a bare DATE, a calendar day with no zone
//
// `photo.takenAt.slice(0, 10)` takes the UTC day. Somebody in New York who
// photographs themselves at 9pm on the 28th has a `takenAt` of the 29th in
// UTC, so the slice would hunt for a scan dated the 29th, miss the scan they
// took that morning, and show a dash beside a photo whose readings are sitting
// right there. src/lib/localDate.ts exists for exactly this class of bug —
// `dateParts()` reads a bare date as its own written day and a timestamp as
// the LOCAL calendar day of the instant, which is what "the day I took this"
// means to the person holding the phone.
//
// ── WHAT THIS FILE REFUSES TO DO ──────────────────────────────────────────
//
// It does not interpolate, it does not take the nearest scan, and it does not
// carry a reading forward. A scan from four days before a photo is a fact
// about a different day, and printing it under this photo would be attributing
// a measurement to a day on which nobody stood on anything. A day with no scan
// gets a dash, and `compareBasis()` says out loud which day that was, so the
// dash is explained rather than merely blank.
//
// It also computes no change of any kind from the images. `compareDelta` below
// is the difference between two SCANS that both exist; there is no code path
// here that turns two photographs into a number. That is the whole of
// requirement 4, and it is why the delta is null the instant either side is
// unmeasured rather than falling back to something.

import { dateParts } from './localDate';
// TF-37: the two mass rows of this table were printed as kilograms whatever the
// client had chosen, so a pounds reader compared two photographs of themselves
// against figures in a unit they do not think in. The unit is a parameter and
// not a hook because this module is pure and asserted against under plain node.
import { weightIn, weightDeltaIn, type WeightUnit } from './units';

/**
 * The measurement shape this file needs. Deliberately the minimum, so both
 * `Scan` (src/lib/types.ts) and `ScanRec` (src/ui/clientData.tsx) satisfy it
 * structurally without this pure module importing a screen's types — it is
 * covered by a test that runs under plain `node`, and clientData.tsx would drag
 * React in with it.
 */
export interface ScanReading {
  takenAt: string;
  weightKg: number;
  bodyFatPct: number;
  skeletalMuscleKg: number | null;
}

/** One line of the compare table. `before`, `after` and `delta` are null for
 *  "not measured", never 0 — a real 0.0 kg change is a different statement
 *  from no scan at all, and the two must not render alike. */
export interface CompareRow {
  key: 'weightKg' | 'bodyFatPct' | 'skeletalMuscleKg';
  label: string;
  /**
   * The unit the three figures on this row are ALREADY in — the row carries it
   * so `readingText` and `deltaText` cannot be handed a figure in one unit and
   * a label in another. The two mass rows follow the client's preference; body
   * fat is a percentage and is `%` in every unit system.
   */
  unit: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

/** The standing sentence about what a comparison is. Kept here so no screen
 *  can quietly present two photographs as evidence of a measured change. */
export const COMPARE_DISCLAIMER =
  'These are two photographs and the InBody figures recorded on the days they were taken. Nothing here is measured from the pictures themselves.';

/**
 * The selection a route param names, reduced to photos that actually exist.
 *
 * ── Why this is a function and not two `find` calls in the screen ─────────
 *
 * The compare panel became app/(client)/compare.tsx so it could be linked to
 * and returned to, and the two photos are named in the URL. That means the
 * selection now arrives from OUTSIDE the app's own state: a deep link, a
 * restored session, a param left over from a photo that has since been
 * deleted. src/lib/backTo.ts made the same move for its `from` param and its
 * header sets out the rule this follows — a value that came in from a link is
 * looked up rather than trusted, and an unknown one resolves to nothing rather
 * than to something nobody chose.
 *
 * Concretely, the four things it refuses:
 *
 *   · an id that names no photo in the loaded list. Left in the selection it
 *     would sit there as a permanently half-made comparison the person cannot
 *     complete or clear, because the thing they would have to tap does not
 *     exist. It is dropped, and the screen falls back to asking them to pick.
 *   · the same id twice. `comparePair` already refuses it, but a selection that
 *     LOOKS full and produces nothing is a screen with no explanation on it.
 *   · more than two. A link carrying five ids selects the first two rather than
 *     failing, because two is what the screen is for.
 *   · Expo Router hands a repeated query param back as `string[]` and a single
 *     one as `string`. Both shapes arrive here and neither is special-cased at
 *     the call site.
 *
 * It deliberately does NOT order the pair. Which of the two is "before" is a
 * question about their dates, `comparePair` answers it, and answering it twice
 * in two places is how two screens come to disagree about which photo is the
 * earlier one.
 */
export function selectionFromParams(
  raw: string | string[] | null | undefined,
  known: { id: string }[] | null | undefined,
): string[] {
  if (!raw || !known) return [];
  const wanted = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const id of wanted) {
    if (typeof id !== 'string' || !id) continue;
    if (out.includes(id)) continue;
    if (!known.some((p) => p.id === id)) continue;
    out.push(id);
    if (out.length === 2) break;
  }
  return out;
}

/**
 * Are these two values the same calendar day, as the person living that day
 * would count it? See the header for why `slice(0, 10)` is not this function.
 */
export function sameDay(a?: string | null, b?: string | null): boolean {
  const x = dateParts(a);
  const y = dateParts(b);
  if (!x || !y) return false;
  return x[0] === y[0] && x[1] === y[1] && x[2] === y[2];
}

/**
 * The scan taken on the same day as this photo, or null when there is none.
 *
 * Null is a normal, frequent answer: people photograph themselves far more
 * often than they get on an InBody. It is not an error and it must not be
 * reported as one.
 *
 * When a day somehow holds more than one scan the LAST one in the list wins,
 * matching how clientData.tsx collapses its own per-day map ("latest added
 * wins"). Two different answers to "what did I weigh that day" between the
 * chart and this panel would be worse than either answer alone.
 */
export function readingOn(iso: string | null | undefined, scans: ScanReading[] | null | undefined): ScanReading | null {
  if (!iso || !scans) return null;
  let found: ScanReading | null = null;
  for (const s of scans) if (sameDay(s.takenAt, iso)) found = s;
  return found;
}

/** One decimal, and only for a number that is really there. Kept in one place
 *  because 82.4 - 80.1 is 2.3000000000000043 in IEEE754 and a raw subtraction
 *  would put that on screen. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? round1(v) : null;
}

/**
 * The difference between two readings, or null unless BOTH exist.
 *
 * The null-unless-both rule is the load-bearing line of this file. Treating a
 * missing reading as 0 — which is what any `(after ?? 0) - (before ?? 0)`
 * would do — would print "-80.1 kg" under a photo of somebody who simply had
 * not been scanned that day.
 */
export function compareDelta(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return round1(after - before);
}

/**
 * The three rows of the compare table, in the order they are read.
 *
 * Every row is always returned, even when neither day has a figure. A row that
 * vanished when unmeasured would make the panel change shape depending on the
 * pair selected, and — worse — would let somebody scroll past without ever
 * being told that a number they expected to see is absent. A dash on a labelled
 * row is the statement; a missing row is not.
 */
export function compareRows(
  beforeISO: string,
  afterISO: string,
  scans: ScanReading[] | null | undefined,
  unit: WeightUnit = 'kg',
): CompareRow[] {
  const b = readingOn(beforeISO, scans);
  const a = readingOn(afterISO, scans);
  /**
   * `mass` decides two things at once: which unit the row is labelled with,
   * and whether its figures are converted at all. Body fat is a proportion of
   * a body and is the same proportion however that body is weighed — running
   * it through a weight conversion would turn 24.1% into 53.1%, which reads
   * like a measurement and is nonsense.
   */
  const row = (
    key: CompareRow['key'],
    label: string,
    metricUnit: string,
    pick: (s: ScanReading) => number | null,
    mass: boolean,
  ): CompareRow => {
    const beforeKg = b ? num(pick(b)) : null;
    const afterKg = a ? num(pick(a)) : null;
    // The change is taken between the two STORED readings and converted once,
    // as a span. Subtracting the two converted cells instead is the bug
    // `weightDeltaIn` exists to prevent: it would let half a pound of display
    // rounding at each end invent or erase a whole pound, so the same real
    // 0.4 kg loss reports 0 lb one month and 1 lb the next off nothing the
    // client did.
    //
    // The cost is visible here and is accepted with open eyes: this table
    // prints both ends AND the change, so a pair like 81.4 → 81.6 kg reads
    // "179 lb → 180 lb, 0 lb". That is three separately correct statements at
    // whole-pound grain — the two readings are 179.5 and 179.9 lb and the
    // change really is under half a pound — and the alternative is a Change
    // column that claims a pound nobody gained. The reading a client acts on
    // is the change, so the change is the figure kept honest.
    const deltaKg = compareDelta(beforeKg, afterKg);
    // Every conversion here is null-in, null-out, so an unscanned day stays an
    // unscanned day and no amount of unit preference invents a reading for it.
    return {
      key,
      label,
      unit: mass ? unit : metricUnit,
      before: mass ? weightIn(beforeKg, unit) : beforeKg,
      after: mass ? weightIn(afterKg, unit) : afterKg,
      delta: mass ? weightDeltaIn(deltaKg, unit) : deltaKg,
    };
  };
  return [
    row('weightKg', 'Weight', 'kg', (s) => s.weightKg, true),
    row('bodyFatPct', 'Body fat', '%', (s) => s.bodyFatPct, false),
    // Nullable at source: a bathroom scale reports weight and body fat and no
    // muscle figure at all, and types.ts records that this column was read as
    // `?? 0` for a long time. A 0 kg muscle reading is nobody's body.
    row('skeletalMuscleKg', 'Skeletal muscle', 'kg', (s) => s.skeletalMuscleKg, true),
  ];
}

/** A figure for the screen. The house rule in one function: what the record
 *  cannot support is a dash, never a zero. */
export function readingText(v: number | null, unit: string): string {
  return v === null ? '—' : `${v} ${unit}`;
}

/** A change for the screen, signed so the direction is unambiguous. A measured
 *  zero prints as 0, because "you did not change" is something the scans
 *  actually said. */
export function deltaText(v: number | null, unit: string): string {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${v} ${unit}`;
}

/**
 * Why the numbers look the way they do, said in the panel rather than left to
 * be inferred from a dash.
 *
 * The unmeasured cases are the ones that matter. A person who sees an empty
 * column under a photo has no way to tell "no scan that day" from "the app
 * failed to load your scans", and the second of those is a reason to worry
 * about their data. So each case is named.
 */
export function compareBasis(rows: CompareRow[]): string {
  const beforeMeasured = rows.some((r) => r.before !== null);
  const afterMeasured = rows.some((r) => r.after !== null);
  if (beforeMeasured && afterMeasured) {
    return 'The figures under each photo are the InBody scan recorded on that day.';
  }
  if (!beforeMeasured && !afterMeasured) {
    return 'Neither of these days has an InBody scan, so there are no figures to put beside the photos — only the photos themselves.';
  }
  return beforeMeasured
    ? 'Only the earlier day has an InBody scan, so there is nothing to measure the change against.'
    : 'Only the later day has an InBody scan, so there is nothing to measure the change against.';
}

/**
 * The comparison as a few lines of text, for the share sheet.
 *
 * ── Why the FIGURES can be shared and the pictures cannot ─────────────────
 *
 * The comparison became a screen so it could be linked to and returned to, and
 * the third thing asked of it was that it could be shared. What goes out is
 * this: two dates, the readings recorded on them, and the change. It is the
 * same table the screen is showing, in the same units, built from the same
 * rows, so the two cannot disagree.
 *
 * What does NOT go out is either photograph, and that is not an oversight to be
 * fixed later. Progress photos live in a private bucket behind URLs that expire
 * in an hour (src/lib/progressPhotos.ts). A shared message outlives them: put a
 * signed URL in one and it leaks the object path to everybody it is forwarded
 * to and is dead before any of them taps it; attach the image itself and a
 * photograph of somebody's body is in a group chat off a single tap in a share
 * sheet. Sending a photo is already its own deliberate, per-photo, revocable
 * act — see src/lib/photoShare.ts — and it stays that way.
 *
 * The last line says so, because a person who sends this to their coach needs
 * to know whether the pictures went with it, and "I assumed" is the wrong way
 * to find out.
 *
 * The two date labels are ARGUMENTS rather than formatted here: the screen has
 * already put them under the photographs, and a document that dates the same
 * photo differently from the screen that made it is worse than one with no
 * dates at all.
 */
export function compareSummary(
  beforeLabel: string,
  afterLabel: string,
  days: number | null,
  rows: CompareRow[],
): string {
  const head = `Progress comparison — ${beforeLabel} → ${afterLabel} (${spanLabel(days)})`;
  const lines = rows.map(
    (r) => `${r.label}: ${readingText(r.before, r.unit)} → ${readingText(r.after, r.unit)} (${deltaText(r.delta, r.unit)})`,
  );
  return [
    head,
    '',
    ...lines,
    '',
    compareBasis(rows),
    COMPARE_DISCLAIMER,
    'The photographs themselves are not attached — they stay private to this account.',
  ].join('\n');
}

/**
 * How far apart the two photos are. Two photos three days apart are two photos
 * three days apart — this sentence says the interval and claims nothing about
 * what happened during it.
 *
 * `null` days is a photo whose date would not parse, and it prints as a dash
 * rather than as "0 days apart", which would be a specific and wrong claim.
 */
export function spanLabel(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'Same day';
  return `${days} day${days === 1 ? '' : 's'} apart`;
}
