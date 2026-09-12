// What one square of the consistency heatmap actually says.
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// `app/(client)/consistency.tsx` drew twelve weeks as
//
//     {col.map((d, di) => <View key={di} style={[{ width: 14, height: 14 }, cell(d)]} />)}
//
// — eighty-four `View`s with no `accessibilityLabel`, no text and no date on
// any of them, under a column axis that did not exist. Only the weekday
// initials down the left-hand side were readable at all.
//
// A sighted member could see a gap in their training and had no way to tell
// which week it was. A member using VoiceOver got eighty-four unnamed views and
// could not read the screen. The rest of this app already knows better:
// `records.tsx` builds a full spoken sentence per row, and `trends.tsx` passes
// ISO dates into its sparkline under the argument that "ten bars of tonnage
// with no dates under them told a member the shape of their training and not
// when any of it happened."
//
// ── Why the count is nullable ─────────────────────────────────────────────
//
// The grid is drawn from a log that may not have been read. Zero sessions and
// an unread log are the same blank square on screen and must not be the same
// sentence: "you did not train that day" said to somebody whose log we could
// not open is the single most discouraging thing this screen can get wrong,
// and the file's own header says so. `null` is the unread case.
//
// Pure: takes a date, a count and today. No react-native, no provider.
import { appLocale } from './locale';

/** How one square reads to a screen reader, and to the readout under the grid.
 *
 *  @param d       the day this square is.
 *  @param count   sessions logged that day, or null when the log was not read.
 *  @param today   the reader's today, at local midnight.
 */
export function heatmapDayLabel(d: Date, count: number | null, today: Date): string {
  const when = d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  if (d.getTime() > today.getTime()) return `${when}, still to come`;
  if (count == null) return `${when}, not read`;
  // EXERCISES, not sessions. The caller counts `workouts` rows and this app
  // writes one per movement, so this said "7 sessions" over one visit to the
  // gym — to the one reader who cannot see the grid and check.
  if (count === 0) return `${when}, nothing logged`;
  return count === 1 ? `${when}, 1 exercise` : `${when}, ${count} exercises`;
}

/**
 * The month label for a column, or null when the column carries no label.
 *
 * A label per column would be twelve repetitions of three month names. A label
 * only when the month CHANGES inside that column is the axis a person actually
 * reads — the same convention every contribution grid uses, and the reason the
 * old grid was unreadable is that it had neither.
 *
 * `prev` is the column before this one, or null for the first, which always
 * takes a label so the axis has a left-hand anchor.
 */
export function heatmapColumnLabel(col: Date[], prev: Date[] | null): string | null {
  const first = col[0];
  if (!first) return null;
  const month = (x: Date) => x.toLocaleDateString(appLocale(), { month: 'short' });
  // The month of a week is the month its last day falls in as often as its
  // first, so the change is judged on the whole column: a column is labelled
  // when it CONTAINS the first day of a month.
  const startsMonth = col.some((x) => x.getDate() === 1);
  // ── the first column follows the same rule, and used to not ────────────
  //
  // It returned `month(first)` — the month of its first DAY — while every
  // other column is named for the month it ENTERS. When the oldest week
  // straddles a month start, which is roughly one week in four, those two
  // disagree: a column running 29 Jun to 5 Jul was labelled "Jun", and because
  // it had already consumed July's 1st, no later column could label July
  // either. A whole month disappeared from the axis of a consistency chart.
  //
  // The same column with any `prev` returns "Jul". Now so does this one — it
  // simply also guarantees a label, because the axis needs a left-hand anchor.
  if (!prev || !prev[0]) return startsMonth ? month(col[col.length - 1] ?? first) : month(first);
  return startsMonth ? month(col[col.length - 1] ?? first) : null;
}

/** The sentence under the grid that says what the whole thing is, so a screen
 *  reader arriving at it is not handed a wall of squares with no frame. */
export function heatmapSummary(weeks: number, known: boolean): string {
  if (!known) return `Training days over the last ${weeks} weeks. Your log has not been read, so none of these squares is an answer yet.`;
  return `Training days over the last ${weeks} weeks, oldest week first. Each square is one day.`;
}
