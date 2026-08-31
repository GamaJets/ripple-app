// Monthly-history hooks — record a monthly snapshot of a metric so a trend
// chart becomes real history over time.
//
// Months with no stored snapshot return null, NOT today's value. The version
// before this one carried the current figure backwards, so a fresh install drew
// a flat six-month line labelled Mar–Aug and the owner read five months of
// trading that never happened. `months` reports how many points are real, and
// the forecast on revenue.tsx uses that instead of assuming six.
//
// That rule now lives in src/lib/monthlyHistory.ts, under a test that puts the
// bug back and watches it fail (`npm run mutate --file src/lib/monthlyHistory.ts`).
// It did not move because the file was crowded — it moved because "a month we
// have no figure for is a gap" is one line of code that four screens depend on
// and that any tidy-up would reintroduce a fallback into.
//
// ── The history used to live only on the handset ───────────────────────────
//
// It was AsyncStorage and nothing else. That is defensible for a cache and
// indefensible for this: the trend is the only record of the past that exists.
// Nothing recomputes March from source — March is a number a phone wrote down
// in March. So a reinstall did not degrade the chart, it permanently deleted
// several months of a business's history, and a coach's second phone drew a
// different chart from their first with no way to tell which was right.
//
// The months now go to `metric_history` (part 129), keyed by the same storage
// key so there is no translation table between what the device wrote and what
// the account holds. AsyncStorage is kept, and kept doing exactly what it did:
// it makes the first paint right, it is the whole store when the backend is off
// or nobody is signed in, and it is what a phone in a basement gym with no
// signal still records into.
//
// ── Three guards, and none of them is optional ─────────────────────────────
//
// 1. **A failed read writes nothing.** Same reasoning as src/ui/settings.tsx:
//    a provider that pushes its state to the server before it has read the
//    server's state overwrites the real answer with a constructed one. Here the
//    constructed answer would be "this account has one month of history",
//    published over an account that has nine.
//
// 2. **The server never prunes.** Only the current month and the months this
//    device has that the server has never heard of are ever sent. A handset is
//    not entitled to delete a month it has not heard of — that is the other
//    phone's record, or the record from before this shipped.
//
// 3. **`status` is carried out to the screens.** An empty series under 'error'
//    means the history could not be read, not that there is none, and a screen
//    about to write "no history yet" has to be able to tell. The existing four
//    fields are unchanged and every existing caller still means what it meant;
//    `status` is additive, and app/(owner)/dashboard.tsx and revenue.tsx
//    compile and behave exactly as before without reading it.
//
// A null `currentValue` is still not recorded, and that has become MORE
// important rather than less. A figure that is wrong because a read failed used
// to be saved to one device; it is now saved to the account, shows on every
// device, and nothing later can tell it from a month that really was that
// quiet. The caller must pass null rather than a zero it is not sure of.
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthRevision } from './authRevision';
import type { LoadStatus } from './loadStatus';
import {
  monthKey, monthWindow, seriesFor, recordedCount, historyDelta,
  sanitiseSnapshots, mergeSnapshots, missingOnServer, type Snapshots,
} from '../lib/monthlyHistory';
import { fetchMetricHistory, saveMetricHistory } from '../lib/metricHistoryStore';

/** How many months a chart shows. Six, as it has always been. */
const WINDOW = 6;

export interface MonthlyHistory {
  series: (number | null)[];
  labels: string[];
  delta: number;
  months: number;
  /** Whether the history above can be trusted. 'error' means the account's
   *  months could not be read and what is drawn is this device's cache — which
   *  may be all of it, some of it, or none of it. Additive: callers that
   *  ignore it behave exactly as they did before. */
  status: LoadStatus;
}

/**
 * Generic: record `currentValue` under `storageKey` for this month, return the
 * six-month series.
 *
 * **A null `currentValue` is not recorded.** See the header — this hook WRITES,
 * and now writes to the account rather than to one phone.
 */
export function useMonthlyHistory(storageKey: string, currentValue: number | null): MonthlyHistory {
  const [hist, setHist] = useState<Snapshots>({});
  const [status, setStatus] = useState<LoadStatus>('loading');
  const rev = useAuthRevision();

  // What the server said, cached for this key and this sign-in. Without it the
  // effect below re-reads the whole history every time `currentValue` changes —
  // and it changes at least once on every screen, as the reads it is derived
  // from land.
  const server = useRef<{ key: string; rev: number; snapshots: Snapshots } | null>(null);
  // The month/value pair last confirmed sent, so an unchanged figure arriving
  // again does not re-upsert the same row on every render.
  const sent = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ── the device cache: what makes the first paint right ───────────────
      let local: Snapshots = {};
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) local = sanitiseSnapshots(JSON.parse(raw));
      } catch { /* a cache that cannot be read is an empty cache, not an error */ }
      if (cancelled) return;

      // ── the account's own months ─────────────────────────────────────────
      let read: { snapshots: Snapshots; status: LoadStatus };
      if (server.current && server.current.key === storageKey && server.current.rev === rev) {
        read = { snapshots: server.current.snapshots, status: 'ready' };
      } else {
        read = await fetchMetricHistory(storageKey);
        if (cancelled) return;
        if (read.status === 'ready') server.current = { key: storageKey, rev, snapshots: read.snapshots };
      }

      // Under 'error' the account's months are unknown, so the merge is skipped
      // entirely and the cache stands alone. Merging with `{}` would produce the
      // same object here, but it would say something different — and the next
      // person to add a fallback to this line would be adding it to a merge that
      // looked authoritative.
      const merged: Snapshots = read.status === 'ready' ? mergeSnapshots(local, read.snapshots) : { ...local };

      // ── this month ───────────────────────────────────────────────────────
      const thisMonth = monthKey(new Date());
      if (currentValue != null) merged[thisMonth] = currentValue;

      // The cache is written whatever happened above: it is the store that
      // works with no signal, and a month recorded offline is uploaded by the
      // backfill on the next launch that can reach the server.
      try { await AsyncStorage.setItem(storageKey, JSON.stringify(merged)); } catch { /* best-effort */ }
      if (cancelled) return;

      // ── the upload ───────────────────────────────────────────────────────
      //
      // Only on a read that succeeded (guard 1), and only the current month
      // plus what the server has never heard of (guard 2). `missingOnServer`
      // deliberately leaves a month the server already holds alone even where
      // the cache disagrees — a handset that has been in a drawer for a month
      // does not get to publish its stale figure over the account.
      if (read.status === 'ready') {
        const upload: Snapshots = missingOnServer(local, read.snapshots);
        if (currentValue != null) upload[thisMonth] = currentValue;
        const stamp = `${storageKey}|${rev}|${thisMonth}|${currentValue}|${Object.keys(upload).sort().join(',')}`;
        if (Object.keys(upload).length && stamp !== sent.current) {
          const written = await saveMetricHistory(storageKey, upload);
          if (cancelled) return;
          // Only remembered as sent when the server confirmed rows. A refused
          // write retried next render is the behaviour we want; a refused write
          // recorded as done is how a month goes missing quietly.
          if (written > 0) {
            sent.current = stamp;
            // Fold the uploaded months into the cached server view so the next
            // pass does not offer them again.
            if (server.current && server.current.key === storageKey) {
              server.current = { key: storageKey, rev, snapshots: { ...server.current.snapshots, ...upload } };
            }
          }
        }
      }

      setHist(merged);
      setStatus(read.status);
    })();
    return () => { cancelled = true; };
  }, [storageKey, currentValue, rev]);

  const cols = monthWindow(new Date(), WINDOW);
  const series = seriesFor(cols, hist);
  return {
    series,
    labels: cols.map((m) => m.label),
    // No previous month recorded, or nothing to compare it against.
    delta: historyDelta(series, currentValue),
    months: recordedCount(series),
    status,
  };
}

/** Owner MRR trend (kept for the owner overview). */
export function useMrrHistory(currentMrr: number): MonthlyHistory {
  return useMonthlyHistory('repple.owner.mrrHistory', currentMrr);
}

/**
 * Sessions delivered per month for the gym owner. Deliberately a different key
 * from the MRR history: that one holds dollars from when the owner portal was a
 * SaaS console, and feeding session counts into it would draw one line out of
 * two different units without saying so.
 */
export function useSessionsHistory(currentSessions: number | null): MonthlyHistory {
  return useMonthlyHistory('repple.owner.sessionsHistory', currentSessions);
}
