// Monthly-history hooks — record a monthly snapshot of a metric to AsyncStorage
// so a trend chart becomes real history over time (instead of a hardcoded curve).
// Returns the last 6 months as a series + labels + month-over-month delta.
// Starts flat at today's value and diverges as real months pass.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthlyHistory { series: number[]; labels: string[]; delta: number }

/** Generic: record `currentValue` under `storageKey` for this month, return 6-mo series. */
export function useMonthlyHistory(storageKey: string, currentValue: number): MonthlyHistory {
  const [hist, setHist] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored: Record<string, number> = {};
      try { const raw = await AsyncStorage.getItem(storageKey); if (raw) stored = JSON.parse(raw); } catch { /* ignore */ }
      stored[ym(new Date())] = currentValue;
      try { await AsyncStorage.setItem(storageKey, JSON.stringify(stored)); } catch { /* ignore */ }
      if (!cancelled) setHist(stored);
    })();
    return () => { cancelled = true; };
  }, [storageKey, currentValue]);

  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: ym(d), label: MONTHS[d.getMonth()] });
  }
  let last = currentValue;
  const series = months.map((m) => {
    const v = hist[m.key];
    if (typeof v === 'number') { last = v; return v; }
    return last;
  });
  const prev = series[series.length - 2] ?? currentValue;
  return { series, labels: months.map((m) => m.label), delta: currentValue - prev };
}

/** Owner MRR trend (kept for the owner overview). */
export function useMrrHistory(currentMrr: number): MonthlyHistory {
  return useMonthlyHistory('repple.owner.mrrHistory', currentMrr);
}
