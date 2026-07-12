// Records a monthly MRR snapshot to AsyncStorage so the owner's growth chart
// becomes real history over time (instead of a hardcoded curve). Returns the
// last 6 months as a series + labels + month-over-month delta. Starts flat at
// today's value and diverges as real months pass.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'repple.owner.mrrHistory';
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MrrHistory { series: number[]; labels: string[]; delta: number }

export function useMrrHistory(currentMrr: number): MrrHistory {
  const [hist, setHist] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let stored: Record<string, number> = {};
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) stored = JSON.parse(raw); } catch { /* ignore */ }
      const key = ym(new Date());
      stored[key] = currentMrr;                 // upsert this month
      try { await AsyncStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* ignore */ }
      if (!cancelled) setHist(stored);
    })();
    return () => { cancelled = true; };
  }, [currentMrr]);

  // Build the last 6 calendar months.
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: ym(d), label: MONTHS[d.getMonth()] });
  }
  // Fill each month: recorded value, else carry the last known, else current.
  let last = currentMrr;
  const series = months.map((m) => {
    const v = hist[m.key];
    if (typeof v === 'number') { last = v; return v; }
    return last;
  });
  const prev = series[series.length - 2] ?? currentMrr;
  return { series, labels: months.map((m) => m.label), delta: currentMrr - prev };
}
