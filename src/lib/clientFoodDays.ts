// What a client actually ate, by day, as their coach is allowed to read it.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// `food_logs` has carried a coach read policy since part 01 —
// `food_trainer_read` — and in the whole app there was exactly one coach-side
// read of it: the last six rows on the dashboard's client sheet, as
// `name, kcal, via`. A coach selling online nutrition could see six food names
// and nothing else. Not a day's total, not a week's shape, not how any of it
// compares with the targets they set on app/(trainer)/client-nutrition.tsx.
//
// The permission was never the problem. Nobody wrote the query, which is the
// same sentence src/lib/coachCheckins.ts opens with about the check-in note.
//
// ── What this module will not do ───────────────────────────────────────────
//
// It does not score a day, grade a week, or call anybody compliant. It totals
// what is there and states it beside the target the coach themselves set. A
// day is "over" or "under" a number a person chose; it is never "good" or
// "bad", because this module has no idea what somebody's week was like and the
// coach reading it does.
//
// It does not fill gaps. A day with no rows is a day with NO ROWS — which can
// mean they ate nothing, or logged nothing, or deleted what they logged — and
// this module reports `entries: 0` and leaves the reading of that to the
// person who knows them. Drawing a zero-kcal bar for an unlogged day is the
// app asserting somebody did not eat.
//
// ── Local days, not UTC ones ───────────────────────────────────────────────
//
// A meal at 11pm belongs to the day the person who ate it was living in. The
// grouping key is the local calendar day, built the way src/lib/clientDrift.ts
// builds one, and the span is counted in calendar days so a daylight-saving
// change costs exactly the days it is — see the comment in src/lib/cadence.ts
// about the week eight days measured as seven.

/** One row, as PostgREST hands it back. Everything unknown-typed: numerics
 *  arrive as strings on some columns and a value that will not read must land
 *  on "not a number" rather than on zero. */
export interface FoodLogRow {
  logged_at?: unknown;
  name?: unknown;
  kcal?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
  via?: unknown;
}

export interface FoodDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  entries: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Whether any row that day was logged from a photograph. Carried because
   *  it changes how much a figure is worth — a photo estimate is the app's
   *  reading of a picture, not a label somebody scanned — and a coach about to
   *  tell somebody they are 300 kcal over should know which it was. */
  anyFromPhoto: boolean;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
};

const pad = (x: number) => String(x).padStart(2, '0');

/** The local calendar day an instant fell on, or null when it will not read. */
export function localDayOf(iso: unknown): string | null {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Rows to days, newest first.
 *
 * Rows whose timestamp will not read are DROPPED rather than bucketed into
 * today: a meal with an unreadable date is not evidence about today, and
 * putting it there is how a coach comes to believe somebody ate twice.
 */
export function foodDays(rows: readonly FoodLogRow[] | null | undefined): FoodDay[] {
  const by = new Map<string, FoodDay>();
  for (const r of rows ?? []) {
    const day = localDayOf(r?.logged_at);
    if (!day) continue;
    const cur = by.get(day) ?? { day, entries: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, anyFromPhoto: false };
    cur.entries += 1;
    cur.kcal += n(r?.kcal);
    cur.protein += n(r?.protein);
    cur.carbs += n(r?.carbs);
    cur.fat += n(r?.fat);
    if (String(r?.via ?? '') === 'photo') cur.anyFromPhoto = true;
    by.set(day, cur);
  }
  return [...by.values()]
    .map((d) => ({ ...d, kcal: Math.round(d.kcal), protein: Math.round(d.protein), carbs: Math.round(d.carbs), fat: Math.round(d.fat) }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/**
 * How many of the last `span` days have anything logged at all.
 *
 * This is the number a coach actually needs before reading any of the others:
 * a week's averages computed over two logged days is a statement about two
 * days wearing a week's clothes. Returned as a count and a span so the screen
 * can say "4 of 7" rather than a percentage nobody can act on.
 */
export function loggedOf(days: readonly FoodDay[], span: number): { logged: number; span: number } {
  const want = Math.max(1, Math.trunc(span));
  return { logged: days.filter((d) => d.entries > 0).slice(0, want).length, span: want };
}

/**
 * The sentence above the list, or null when there is nothing honest to say.
 *
 * Four readings and they are not interchangeable:
 *   · nothing logged at all — said as a fact about the RECORD, never about the
 *     person: "nothing logged" is not "they did not eat".
 *   · logged on some days — the count and the span, so the averages below can
 *     be read for what they are.
 *   · logged every day — said, because it is the one case where a week's
 *     figures mean what they look like.
 *   · a truncated read — refused outright. A coach told "3 of 7 days" over a
 *     list that hit its row cap is being told something false about somebody's
 *     week, and the caller has the status to know better.
 */
export function loggedLine(o: { logged: number; span: number; whole: boolean; who: string }): string | null {
  if (!o.whole) {
    return `Only part of ${o.who}'s food log came back, so how many days they logged cannot be counted from it.`;
  }
  if (o.logged === 0) {
    return `Nothing logged in the last ${o.span} days. That is what the record holds, which is not the same as what they ate.`;
  }
  if (o.logged >= o.span) {
    return `Logged on all ${o.span} days.`;
  }
  return `Logged on ${o.logged} of the last ${o.span} days, so anything averaged over the week is averaged over those ${o.logged}.`;
}
