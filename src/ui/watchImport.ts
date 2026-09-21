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
import type { ProviderId, WearableProvider, WorkoutSample } from '../lib/wearables/types';
import type { WorkoutEntry } from '../lib/mockData';
import { hrStats } from '../lib/hr';
import { reportError } from '../lib/reportError';
import { linkFor } from '../lib/wearableLinkLedger';

const IMPORTED_KEY = 'repple.hk.imported';

/**
 * Why a connected-looking provider is not going to be asked for workouts.
 *
 * Kept apart from 'failed' on purpose. A provider that was never asked has
 * produced no evidence at all, and rolling it in with one that was asked and
 * threw would let a screen say "we tried everything" about a device nothing
 * touched.
 */
export type NotAskedWhy =
  /** The app does not remember a connection, or it was disconnected. */
  | 'not-connected'
  /** Connected, and the SERVER has proven the token behind it is dead. Only a
   *  re-authorisation fixes this — see src/lib/wearableLink.ts. */
  | 'token-dead'
  /** Nothing on this platform or this build can talk to it (`isAvailable`). */
  | 'unavailable'
  /** This build has no workout reader for it at all — Oura has no
   *  `fetchWorkouts`, and that is a fact about Repple, not about the device. */
  | 'no-reader';

/**
 * Providers that are connected and can actually answer for past workouts.
 *
 * ── The disagreement this ends ─────────────────────────────────────────────
 *
 * This used to read `states[id] === 'connected'` — the app's own REMEMBERED
 * flag, restored from AsyncStorage on launch with nothing behind it — while
 * every screen that draws a connection badge reads `linkFor(...).connected`,
 * which lets the server's proof of a dead token outrank that memory. So the two
 * disagreed for exactly one member: the one whose token had expired. Watch &
 * Devices drew "Needs reconnecting" on WHOOP, and this function asked WHOOP for
 * workouts anyway, got a refusal, and the refusal became an empty list — which
 * the screen then reported as "no workouts found".
 *
 * One question, one answer, as src/lib/wearableLink.ts insists. A dead token is
 * now `not-asked: 'token-dead'` in `readRecent` below, which is a fact the
 * screen can print, rather than a failure it has to guess at.
 */
export function importSources(states: Record<string, string>) {
  return PROVIDERS.filter((pv) => askability(pv, states) === null);
}

/** `null` when this provider will be asked; otherwise why it will not be. */
function askability(pv: WearableProvider, states: Record<string, string>): NotAskedWhy | null {
  if (typeof pv.fetchWorkouts !== 'function') return 'no-reader';
  if (!pv.isAvailable()) return 'unavailable';
  const link = linkFor(pv.meta.id as ProviderId, pv.meta.name, (states[pv.meta.id] as never) ?? 'disconnected');
  if (!link.connected) {
    // Remembered as connected and refused by the server anyway is the case
    // worth naming separately: the member did connect it, and telling them
    // "not connected" is what sent a tester round the reconnect loop four
    // times.
    return states[pv.meta.id] === 'connected' ? 'token-dead' : 'not-connected';
  }
  return null;
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

/**
 * How ONE provider's read went. Three facts, never two.
 *
 *   'answered'  it was asked and it replied. `samples` is what it held, and an
 *               empty `samples` here is a real answer: this device recorded
 *               nothing in the window.
 *   'failed'    it was asked and it threw. NOTHING is known about what it
 *               holds. There is deliberately no `samples` on this shape, so a
 *               caller cannot read a failure as an empty list by accident —
 *               which is the entire defect this type exists to close.
 *   'not-asked' nothing was sent. `why` says which of the four reasons.
 */
export type ProviderRead =
  | { id: string; name: string; status: 'answered'; samples: WorkoutSample[] }
  | { id: string; name: string; status: 'failed' }
  | { id: string; name: string; status: 'not-asked'; why: NotAskedWhy };

/**
 * How much of the member's kit actually answered.
 *
 *   'whole'   every provider that was asked answered. Only here may a screen
 *             say "nothing found" — it is the one case where the absence of
 *             workouts is a fact about the member rather than about the read.
 *   'partial' some answered and at least one failed. Never counted, never
 *             summed, and never called empty: the honest sentence names the
 *             device that did not answer.
 *   'none'    nothing answered — either nothing was asked, or everything asked
 *             failed. `reads` is what tells those two apart.
 */
export type ImportReach = 'whole' | 'partial' | 'none';

/** The whole outcome of one import attempt, evidence and all. */
export interface RecentRead {
  /** Workouts from providers that ANSWERED, newest first. Never padded out
   *  with an empty list standing in for a failure. */
  samples: WorkoutSample[];
  /**
   * One entry per provider in the catalogue, in `PROVIDERS` order — so a
   * screen's sentence about them is stable, and so a device the member owns is
   * never simply absent from the answer.
   *
   * This includes the rows nobody can connect (Garmin, Fitbit) as
   * `not-asked: 'no-reader' | 'unavailable'`. A screen listing them should
   * filter to the ones the member has connected; `failed` and the `'token-dead'`
   * entries in `notAsked` are the two that always deserve a sentence.
   */
  reads: ProviderRead[];
  answered: ProviderRead[];
  failed: ProviderRead[];
  notAsked: ProviderRead[];
  reach: ImportReach;
  /**
   * True only when every provider that was asked answered AND none of them
   * held anything. This is the ONLY flag a caller may render as "no workouts
   * found"; `samples.length === 0` is not that test and never was.
   */
  emptyAndWhole: boolean;
}

/**
 * Pull recent workouts from every connected source, newest first. Ids are
 * source-prefixed, so one session recorded by two devices stays two rows.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * The per-provider catch returned `[]`. With Apple Health and WHOOP both
 * connected and WHOOP refusing, the two lists flattened to Apple's alone and
 * the caller could not tell that from two devices that had genuinely recorded
 * nothing — so the screen said "No workouts found in the last 14 days from your
 * devices", which is a confident claim about a member's training built out of a
 * read that failed. If they had trained, the sentence was false; and the one
 * control that would have fetched the session again now looked like it had
 * already answered.
 *
 * So nothing is flattened away here. Each provider's outcome is returned as
 * its own fact and the caller renders all three.
 */
export async function readRecent(states: Record<string, string>, sinceDays: number): Promise<RecentRead> {
  const reads: ProviderRead[] = await Promise.all(PROVIDERS.map(async (pv): Promise<ProviderRead> => {
    const id = pv.meta.id;
    const name = pv.meta.name;
    const why = askability(pv, states);
    if (why) return { id, name, status: 'not-asked', why };
    try {
      // `|| []` covers a provider that resolves undefined. That IS an answer —
      // the request completed — and it is the only empty list this function
      // will ever construct on a provider's behalf.
      return { id, name, status: 'answered', samples: (await pv.fetchWorkouts!(sinceDays)) || [] };
    } catch (e) {
      reportError('watchImport.fetch', e, { provider: id });
      return { id, name, status: 'failed' };
    }
  }));
  const answered = reads.filter((r) => r.status === 'answered');
  const failed = reads.filter((r) => r.status === 'failed');
  const notAsked = reads.filter((r) => r.status === 'not-asked');
  const samples = answered
    .flatMap((r) => (r.status === 'answered' ? r.samples : []))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  const reach: ImportReach = failed.length
    ? (answered.length ? 'partial' : 'none')
    : (answered.length ? 'whole' : 'none');
  return { samples, reads, answered, failed, notAsked, reach, emptyAndWhole: reach === 'whole' && samples.length === 0 };
}

/** The devices that did not answer, as the member named them — "WHOOP", or
 *  "WHOOP and Apple Health". Empty string when none failed. */
export function failedNames(r: RecentRead): string {
  const names = r.failed.map((x) => x.name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one sentence to put under an import list, or in the alert after one.
 *
 * `windowLabel` is the lookback as the screen words it ("14 days", "1 year").
 * `sourceLabel` is what the screen calls the member's kit when every source
 * answered ("your devices", or the single device's name).
 *
 * Returns null when there is nothing to say — workouts were found and every
 * device answered. A caller that gets a string must show it.
 */
export function readNote(r: RecentRead, windowLabel: string, sourceLabel: string): string | null {
  if (r.reach === 'partial') {
    const who = failedNames(r);
    return r.samples.length
      ? `${who} did not answer, so this list is not all of your training. It is what your other devices had. Nothing is missing from your log that was not already missing; try again in a moment.`
      : `${who} did not answer, so nothing could be read from ${r.failed.length === 1 ? 'it' : 'them'}. Your other devices recorded nothing in the last ${windowLabel}. This is not "no workouts". Try again in a moment.`;
  }
  if (r.reach === 'none' && r.failed.length) {
    const who = failedNames(r);
    return `${who} did not answer, so your workouts could not be read at all. This is not a list of nothing. It is no list. Try again in a moment.`;
  }
  if (r.reach === 'none') {
    // Nothing was asked. Say which wall it hit rather than "no workouts".
    const dead = r.notAsked.filter((x) => x.status === 'not-asked' && x.why === 'token-dead');
    if (dead.length) {
      const who = dead.map((x) => x.name).join(' and ');
      return `${who} needs reconnecting before workouts can be read from ${dead.length === 1 ? 'it' : 'them'}, so nothing was asked and nothing was read.`;
    }
    return 'No device is connected that can hand over past workouts, so nothing was asked for.';
  }
  if (r.emptyAndWhole) return `No workouts found in the last ${windowLabel} from ${sourceLabel}.`;
  return null;
}

/*
 * `fetchRecent` stood here and is gone.
 *
 * It was the old shape — a plain `WorkoutSample[]` — kept alive only while the
 * two screens that called it were moved across, and its own note said it
 * "should go with the second of them". Both have gone: app/(client)/devices.tsx
 * and app/(client)/workouts.tsx now call `readRecent` and render `readNote`.
 *
 * It is recorded rather than silently deleted because the reason it could not
 * stay is the whole point of this module: an array cannot express a provider
 * that FAILED, so every caller on it was one line from printing "no workouts
 * found in the last 14 days from your devices" over a WHOOP that refused. The
 * replacement's 'failed' variant carries no `samples` field AT ALL, so that
 * sentence is now a type error rather than a judgement call.
 */
