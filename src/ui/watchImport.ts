// Bringing workouts recorded on a watch into the training log.
//
// This lived inside the Watch & Devices screen, which is not a tab — you reach
// it only if you go looking. So a session recorded on an Apple Watch was
// importable but never surfaced anywhere near the Train tab, where people go to
// look for it, and the reasonable conclusion was that the app had lost it.
//
// The logic sits here so the Train tab can offer the same import that Watch &
// Devices does, without a second copy of the rules about which provider may
// answer for heart rate or what counts as already logged.
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROVIDERS } from '../lib/wearables/registry';
import type { WorkoutSample } from '../lib/wearables/types';
import type { WorkoutEntry } from '../lib/mockData';
import { hrStats } from '../lib/hr';
import { reportError } from '../lib/reportError';

const IMPORTED_KEY = 'repple.hk.imported';

/** Providers that are connected and can actually answer for past workouts. */
export function importSources(states: Record<string, string>) {
  return PROVIDERS.filter(
    (pv) => typeof pv.fetchWorkouts === 'function' && pv.isAvailable() && states[pv.meta.id] === 'connected',
  );
}

export const toEntry = (sm: WorkoutSample): WorkoutEntry => ({
  t: sm.start,
  exercise: sm.activity,
  cardio: { mins: sm.mins, dist: sm.distanceKm ?? 0, unit: 'km' },
  kcal: sm.kcal ?? undefined,
});

/** Attach average and peak heart rate, from whichever source is entitled to say. */
export async function withHr(sm: WorkoutSample): Promise<WorkoutEntry> {
  const e = toEntry(sm);
  // WHOOP reports avg/max on the workout itself. Prefer that over deriving it,
  // and never ask HealthKit about a session it did not record.
  if (sm.source !== 'apple') {
    if (e.cardio) {
      if (typeof sm.avgHr === 'number') e.cardio.hrAvg = sm.avgHr;
      if (typeof sm.maxHr === 'number') e.cardio.hrHigh = sm.maxHr;
    }
    return e;
  }
  const apple = PROVIDERS.find((p) => p.meta.id === 'apple');
  const fetchHr = apple?.fetchHeartRateSeries;
  if (fetchHr && apple && apple.isAvailable()) {
    try {
      const endISO = new Date(Date.parse(sm.start) + Math.max(1, sm.mins) * 60000).toISOString();
      const st = hrStats(await fetchHr(sm.start, endISO));
      if (st && e.cardio) { e.cardio.hrAvg = st.avg; e.cardio.hrHigh = st.high; }
    } catch (err) { reportError('watchImport.withHr', err); }
  }
  return e;
}

/** The set of sample ids already pulled in, remembered across launches. */
export function useImportedIds() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(IMPORTED_KEY);
        if (raw) setIds(new Set(JSON.parse(raw)));
      } catch { /* ignore */ }
    })();
  }, []);
  const mark = useCallback((add: string[]) => {
    setIds((prev) => {
      const next = new Set(prev);
      add.forEach((i) => next.add(i));
      AsyncStorage.setItem(IMPORTED_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);
  return { ids, mark };
}

/** A sample counts as logged once its id is remembered, or an entry already sits
 *  at the same instant under the same name. */
export const isLogged = (sm: WorkoutSample, ids: Set<string>, log: WorkoutEntry[]) =>
  ids.has(sm.id) || log.some((l) => l.t === sm.start && l.exercise === sm.activity);

/** Pull recent workouts from every connected source, newest first. Ids are
 *  source-prefixed, so one session recorded by two devices stays two rows. */
export async function fetchRecent(states: Record<string, string>, sinceDays: number): Promise<WorkoutSample[]> {
  const lists = await Promise.all(importSources(states).map(async (pv) => {
    try { return (await pv.fetchWorkouts!(sinceDays)) || []; }
    catch (e) { reportError('watchImport.fetch', e, { provider: pv.meta.id }); return []; }
  }));
  return lists.flat().sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}
