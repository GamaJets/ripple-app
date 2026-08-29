// ── Core domain types (shared by app + backend) ─────────────────────────────
export type Role = 'client' | 'trainer' | 'owner';
export type Goal = 'fatloss' | 'tone' | 'muscle';
export type Diet = 'meat' | 'vegetarian' | 'vegan' | 'paleo' | 'keto';
export type Sex = 'f' | 'm';

// ── How somebody is coached ─────────────────────────────────────────────────
//
// This lived as an inline `'online' | 'inperson'` union in eight files, which
// is why adding a third answer needed a sweep rather than an edit. It is one
// vocabulary now: the type, the words shown for it, and the two questions the
// rest of the app actually asks of it.
//
// All four answers are storable. Every `mode` column was CHECK-constrained to
// ('online','inperson') until part 57 widened them, and the app spent that
// period narrowing 'hybrid' to 'inperson' on the way out and reassembling the
// full answer from device storage on the way back. None of that survives here:
// what the client chose is what the column holds.
//
// The two original values differed only in the noun printed beside them —
// picking one over the other changed nothing a client could see, which is the
// first half of TF-30. `booksInPerson` and `coachedRemotely` below are what
// make the answer load-bearing; every screen that branches on coaching should
// go through one of them rather than comparing to a literal.

/** A client's answer to how they train. 'solo' means nobody is coaching them. */
export type CoachingMode = 'online' | 'inperson' | 'hybrid' | 'solo';
/** The delivery of a real coaching relationship. 'solo' is the absence of one,
 *  so it cannot describe an invite, a request, or a roster entry. */
export type CoachedMode = 'online' | 'inperson' | 'hybrid';

export const COACHED_MODES: readonly CoachedMode[] = ['online', 'inperson', 'hybrid'];

/** For a coach's own surfaces, where the subject is the client, not the reader. */
export const COACHED_MODE_SHORT: Record<CoachedMode, string> = {
  online: 'Online',
  inperson: 'In-person',
  hybrid: 'Hybrid',
};

export const COACHING_MODE_LABEL: Record<CoachingMode, string> = {
  online: 'Online coach',
  inperson: 'In-person coach',
  hybrid: 'Hybrid coach',
  solo: 'On my own',
};

/** One line, in the client's own voice, saying what picking this changes. It
 *  travels with the option everywhere it is offered — "Hybrid" on its own is
 *  a word, not a choice anybody can make. */
export const COACHING_MODE_NOTE: Record<CoachingMode, string> = {
  online: 'Your coach programs and checks in remotely — no sessions to book.',
  inperson: 'Your coach trains you in the room — book sessions with them.',
  hybrid: 'Both — book sessions with them, and check in for the weeks you train alone.',
  solo: 'No coach. AI plans and tools, and nothing sent to anybody.',
};

/** The same three, in the coach's voice, for the add-client and invite sheets. */
export const COACHED_MODE_NOTE_COACH: Record<CoachedMode, string> = {
  online: 'You program and check in remotely. They get no booking calendar.',
  inperson: 'You train them in the room. They can book your open slots.',
  hybrid: 'Both — they book your slots, and check in for the weeks they train alone.',
};

/** Whether this person has sessions with their coach to book. The booking
 *  calendar is in-person by construction (see the header of calendar.tsx), so
 *  an online-only client has nothing there to book. */
export function booksInPerson(m: CoachingMode): boolean {
  return m === 'inperson' || m === 'hybrid';
}

/** Whether their coach is working with them at a distance, and therefore only
 *  learns how the week went if the client writes it down. */
export function coachedRemotely(m: CoachingMode): boolean {
  return m === 'online' || m === 'hybrid';
}

/** Tolerant read of a `mode` column, for the surfaces that must show something.
 *  Anything unrecognised settles on 'online', which is the column's own default. */
export function readCoachedMode(v: unknown): CoachedMode {
  return v === 'inperson' || v === 'hybrid' ? v : 'online';
}

/** The same read for surfaces that can say "we do not know". A coach's roster
 *  is one: reporting an unclassified client as Online tells them somebody is
 *  remote on the strength of an empty column. */
export function readCoachedModeOrNull(v: unknown): CoachedMode | null {
  return v === 'online' || v === 'inperson' || v === 'hybrid' ? v : null;
}

export function readCoachingMode(v: unknown, fallback: CoachingMode = 'online'): CoachingMode {
  return v === 'online' || v === 'inperson' || v === 'hybrid' || v === 'solo' ? v : fallback;
}


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
  /** null when the scan did not report it. `scans.skeletal_muscle_kg` is the
   *  one nullable column of the three — a bathroom scale gives weight and body
   *  fat and no muscle figure at all — and this was read as `?? 0` for a long
   *  time. Nobody has 0 kg of skeletal muscle, so that zero was a reading
   *  nobody took, charted as a real point and differenced against the scan
   *  before it. */
  skeletalMuscleKg: number | null;
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
