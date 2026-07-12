// Trainer weekly availability template. A set of recurring day-of-week + hour
// slots the coach offers every week; "generate" turns them into concrete open
// sessions for the next few weeks. Persists to AsyncStorage (per device). Kept
// as a self-contained hook so it needs no provider wiring.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AvailSlot { id: string; dow: number; hour: number; dur: number }

const KEY = 'repple.trainer.availability';
let SEQ = 1;

export function useAvailability() {
  const [slots, setSlots] = useState<AvailSlot[]>([]);

  useEffect(() => {
    (async () => {
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) setSlots(JSON.parse(raw)); } catch { /* ignore */ }
    })();
  }, []);

  const persist = (next: AvailSlot[]) => {
    const sorted = [...next].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
    setSlots(sorted);
    try { AsyncStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* ignore */ }
  };

  const addSlot = (dow: number, hour: number, dur: number) => {
    if (slots.some((s) => s.dow === dow && s.hour === hour)) return; // no dup
    persist([...slots, { id: 'av' + Date.now().toString(36) + SEQ++, dow, hour, dur }]);
  };
  const removeSlot = (id: string) => persist(slots.filter((s) => s.id !== id));

  return { slots, addSlot, removeSlot };
}

/** Concrete dates for a weekly slot over the next `weeks` weeks (from today). */
export function upcomingDates(dow: number, hour: number, weeks = 4, from = new Date()): Date[] {
  const out: Date[] = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cand = new Date(base);
      cand.setDate(base.getDate() + w * 7 + d);
      if (cand.getDay() === dow) {
        cand.setHours(hour, 0, 0, 0);
        if (cand.getTime() > from.getTime()) out.push(cand);
        break;
      }
    }
  }
  return out;
}
