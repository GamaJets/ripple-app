// ── Core domain types (shared by app + backend) ─────────────────────────────
export type Role = 'client' | 'trainer' | 'owner';
export type Goal = 'fatloss' | 'tone' | 'muscle';
export type Diet = 'meat' | 'vegetarian' | 'vegan' | 'paleo' | 'keto';
export type Sex = 'f' | 'm';

export interface Macros {
  kcal: number;
  protein: number;   // grams
  carbs: number;     // grams
  fat: number;       // grams
  lbm: number;       // lean body mass kg
  bmr: number;
  tdee: number;
}

export interface BodyStats {
  weightKg: number;
  bodyFatPct: number;
  activity: number;  // 1.3 light .. 1.6 high
  goal: Goal;
  diet: Diet;
}

export interface Scan {
  id: string;
  clientId: string;
  takenAt: string;   // ISO date
  weightKg: number;
  bodyFatPct: number;
  skeletalMuscleKg: number;
  source: string;
}

export type SessionStatus = 'available' | 'booked' | 'blocked';

export interface TrainingSession {
  id: string;
  trainerId: string;
  clientId: string | null;
  startsAt: string;      // ISO datetime
  durationMin: number;
  status: SessionStatus;
  released: boolean;      // re-offered after a cancellation
  /** What actually happened, once somebody has said. `status` is the SLOT's
   *  state and is not the delivery result: a session stays `booked` whether it
   *  was completed, no-showed or cancelled. Null means unmarked — an unknown
   *  outcome, which src/lib/gymSessions.ts is careful never to read as either a
   *  yes or a no. The column has always been there; the phone app simply
   *  dropped it on the floor, so every screen here inferred delivery from
   *  "booked, and the clock has passed" — the exact inference that module was
   *  written to end. */
  outcome?: import('./gymSessions').SessionOutcome | null;
  /** When the client confirmed the session was delivered. From `session_approvals`,
   *  not from `sessions` — the note beside it is private to the client and their
   *  trainer, and RLS cannot hide a single column. */
  approvedAt?: string | null;
  /** The comment the client left when approving. */
  approvalNote?: string | null;
}

export interface CancellationResult {
  charged: boolean;
  feeAmount: number;
  notifyClientIds: string[];   // other clients to push the opened slot to
  notifyTrainer: boolean;
}

export type MsgSender = 'client' | 'coach';
export interface Message {
  id: string;
  clientId: string;   // the thread this message belongs to
  sender: MsgSender;
  body: string;
  createdAt: string;  // ISO
}

export type FoodVia = 'search' | 'barcode' | 'photo' | 'manual';
export interface FoodEntry {
  id: string;
  clientId: string;
  loggedAt: string;   // ISO
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  via: FoodVia;
}
