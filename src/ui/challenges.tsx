// Challenges + leaderboards — join a 30-day consistency, streak, or volume
// challenge and track progress toward the goal. Scores are computed live from
// the client's real workout log.
//
// The cohort (`field`) is empty. It previously held six invented athletes
// ("Maya R.", "Devin K.", "Marcus T." …) with invented scores, which shipped in
// the production bundle and presented a real client with a leaderboard of
// people who do not exist — and a rank measured against them. It fills in when
// real multi-athlete challenges ship on the backend. Joined state persists to
// AsyncStorage so it survives restarts. Pure JS — ships over-the-air.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWorkoutLog } from './workoutLog';
import { currentStreak, activeDays } from '../lib/streaks';
import type { WorkoutEntry } from '../lib/mockData';

export type Metric = 'workouts30' | 'streak' | 'volume30';

export interface Challenge {
  id: string;
  title: string;
  blurb: string;
  metric: Metric;
  unit: string;
  goal: number;      // target to "complete" the challenge
  endsInDays: number;
  icon: string;
  field: { name: string; score: number }[]; // seeded cohort
}

const STORE = 'repple.challenges.joined';

// Score the client's live standing for a metric, from their real log (last 30d).
export function scoreFor(metric: Metric, log: WorkoutEntry[]): number {
  const since = Date.now() - 30 * 86400000;
  if (metric === 'streak') return currentStreak(log);
  if (metric === 'workouts30') {
    // distinct training days within the last 30 calendar days
    return activeDays(log).filter((d) => Date.parse(d + 'T00:00:00Z') >= since).length;
  }
  // volume30 — total tonnage (reps × kg) over the last 30 days, in tonnes
  let kg = 0;
  for (const e of log) {
    if (Date.parse(e.t) < since) continue;
    for (const [reps, w] of (e.sets || [])) kg += (reps || 0) * (w || 0);
  }
  return Math.round(kg / 1000);
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'consistency30', title: '30-Day Consistency', blurb: 'Train the most days in 30. Show up, climb the board.',
    metric: 'workouts30', unit: 'days', goal: 20, endsInDays: 30, icon: 'flame',
    field: [],
  },
  {
    id: 'streak', title: 'Streak Club', blurb: 'Longest active training streak wins. Do not break the chain.',
    metric: 'streak', unit: 'day streak', goal: 14, endsInDays: 21, icon: 'trophy',
    field: [],
  },
  {
    id: 'volume30', title: 'Volume Club', blurb: 'Move the most total weight this month. Every rep counts.',
    metric: 'volume30', unit: 't', goal: 40, endsInDays: 30, icon: 'chart',
    field: [],
  },
];

interface ChallengesValue {
  joined: string[];
  isJoined: (id: string) => boolean;
  toggle: (id: string) => void;
  myScore: (metric: Metric) => number;
  // full leaderboard (cohort + "You"), sorted desc
  board: (c: Challenge) => { name: string; score: number; you?: boolean }[];
  myRank: (c: Challenge) => number;
}

const Ctx = createContext<ChallengesValue | null>(null);

export function ChallengesProvider({ children }: { children: ReactNode }) {
  const { log } = useWorkoutLog();
  const [joined, setJoined] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try { const raw = await AsyncStorage.getItem(STORE); if (raw) setJoined(JSON.parse(raw)); } catch { /* ignore */ }
    })();
  }, []);

  const persist = (next: string[]) => {
    setJoined(next);
    try { AsyncStorage.setItem(STORE, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const toggle = (id: string) => {
    persist(joined.includes(id) ? joined.filter((x) => x !== id) : [...joined, id]);
  };

  const myScore = (metric: Metric) => scoreFor(metric, log);

  const board: ChallengesValue['board'] = (c) => {
    const rows = [...c.field.map((f) => ({ ...f })), { name: 'You', score: myScore(c.metric), you: true }];
    return rows.sort((a, b) => b.score - a.score);
  };

  const myRank = (c: Challenge) => {
    const b = board(c);
    return b.findIndex((r) => r.you) + 1;
  };

  const value = useMemo(() => ({
    joined, isJoined: (id: string) => joined.includes(id), toggle, myScore, board, myRank,
  }), [joined, log]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChallenges(): ChallengesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChallenges must be used inside <ChallengesProvider>');
  return v;
}
