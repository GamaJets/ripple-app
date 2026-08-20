// Monthly-history hooks — record a monthly snapshot of a metric to AsyncStorage
// so a trend chart becomes real history over time.
//
// Months with no stored snapshot return null, NOT today's value. The previous
// version carried the current figure backwards, so a fresh install drew a flat
// six-month line labelled Mar–Aug and the owner read five months of trading
// that never happened. `months` reports how many points are real, and the
// forecast on revenue.tsx uses that instead of assuming six.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MonthlyHistory { series: (number | null)[]; labels: string[]; delta: number; months: number }

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
  const series = months.map((m) => {
    const v = hist[m.key];
    return typeof v === 'number' ? v : null;
  });
  const recorded = series.filter((v): v is number => v != null);
  const prev = series[series.length - 2];
  return {
    series,
    labels: months.map((m) => m.label),
    // No previous month recorded means no month-over-month change to report.
    delta: prev == null ? 0 : currentValue - prev,
    months: recorded.length,
  };
}

/** Owner MRR trend (kept for the owner overview). */
export function useMrrHistory(currentMrr: number): MonthlyHistory {
  return useMonthlyHistory('repple.owner.mrrHistory', currentMrr);
}
