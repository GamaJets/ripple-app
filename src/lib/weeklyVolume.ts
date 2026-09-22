// Tonnage per week, for the last N weeks — the loop app/(client)/trends.tsx and
// WeeklyVolumeCard in src/ui/progressCards.tsx both used to write out by hand.
//
// Oldest first. Each week is the seven days from `weekStart` stepped back by
// whole calendar weeks (setDate, so a clock change does not shift a boundary),
// priced by `entryTonnage` against the weight on the day. The unpriced set
// count travels with the kilos: a week of bodyweight work by somebody never
// weighed has real work in it and no load, and that is an unknown, not a
// smaller number.
//
// `days` is distinct local calendar days with anything logged — training days,
// not sessions.
//
// Pure — no react, no clock (the caller passes `weekStart`).
import type { WorkoutEntry } from './mockData';
import { entryTonnage, type BodyweightHistory, type Tonnage } from './bodyweightSets';

export interface VolumeWeek { start: Date; t: Tonnage; days: number }

export function weeklyVolume(
  log: readonly WorkoutEntry[],
  weightSeries: BodyweightHistory,
  weekStart: Date,
  weeks: number,
): VolumeWeek[] {
  const out: VolumeWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(weekStart); start.setDate(weekStart.getDate() - w * 7);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    const inWk = log.filter((e) => { const d = new Date(e.t); return d >= start && d < end; });
    const days = new Set(inWk.map((e) => new Date(e.t).toDateString())).size;
    const t = inWk.reduce<Tonnage>((a, e) => { const x = entryTonnage(e, weightSeries); return { kg: a.kg + x.kg, unknownSets: a.unknownSets + x.unknownSets }; }, { kg: 0, unknownSets: 0 });
    out.push({ start, t, days });
  }
  return out;
}
