// ── Data repository ──────────────────────────────────────────────────────────
// Screens talk to this interface, never to Supabase or mock data directly.
// `mockRepo` runs the app with no backend (Expo Go demo). `supabaseRepo` is the
// real implementation — flip `USE_SUPABASE` (or the env flag) to switch. Screens
// never change.
import {
  MOCK_CLIENT, MOCK_SESSIONS, MOCK_TRAINER, MOCK_MESSAGES, MOCK_FOOD,
  type MockClient, type WorkoutEntry,
} from '../lib/mockData';
import type { TrainingSession, Message, FoodEntry, Scan } from '../lib/types';
import { supabase } from '../lib/supabase';

export interface Repo {
  getClient(id: string): Promise<MockClient>;
  addWorkout(clientId: string, entry: WorkoutEntry): Promise<void>;
  getSessions(trainerId: string): Promise<TrainingSession[]>;
  bookSession(sessionId: string, clientId: string): Promise<void>;
  releaseSession(sessionId: string): Promise<void>;   // cancel → back to available
  getTrainer(id: string): Promise<typeof MOCK_TRAINER>;
  // Phase-4 features
  getMessages(clientId: string): Promise<Message[]>;
  sendMessage(clientId: string, sender: 'client' | 'coach', body: string): Promise<Message>;
  getFoodLog(clientId: string, dayISO?: string): Promise<FoodEntry[]>;
  addFood(clientId: string, food: Omit<FoodEntry, 'id' | 'clientId' | 'loggedAt'>): Promise<FoodEntry>;
  removeFood(foodId: string): Promise<void>;
  addScan(clientId: string, scan: Omit<Scan, 'id' | 'clientId'>): Promise<Scan>;
}

// ── In-memory mock (mutable) — the app runs on this with no backend. ──────────
const state = {
  client: JSON.parse(JSON.stringify(MOCK_CLIENT)) as MockClient,
  sessions: JSON.parse(JSON.stringify(MOCK_SESSIONS)) as TrainingSession[],
  messages: JSON.parse(JSON.stringify(MOCK_MESSAGES)) as Message[],
  food: JSON.parse(JSON.stringify(MOCK_FOOD)) as FoodEntry[],
};
let seq = 1000;
const nextId = (p: string) => `${p}${seq++}`;
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

export const mockRepo: Repo = {
  async getClient() {
    return state.client;
  },
  async addWorkout(_clientId, entry) {
    state.client.log.unshift(entry);
  },
  async getSessions(trainerId) {
    return state.sessions.filter((s) => s.trainerId === trainerId);
  },
  async bookSession(sessionId, clientId) {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (s) { s.status = 'booked'; s.clientId = clientId; s.released = false; }
  },
  async releaseSession(sessionId) {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (s) { s.status = 'available'; s.clientId = null; s.released = true; }
  },
  async getTrainer() {
    return MOCK_TRAINER;
  },
  async getMessages(clientId) {
    return state.messages
      .filter((m) => m.clientId === clientId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async sendMessage(clientId, sender, body) {
    const msg: Message = { id: nextId('m'), clientId, sender, body, createdAt: new Date().toISOString() };
    state.messages.push(msg);
    return msg;
  },
  async getFoodLog(clientId, dayISO) {
    const day = dayISO ?? new Date().toISOString();
    return state.food.filter((f) => f.clientId === clientId && sameDay(f.loggedAt, day));
  },
  async addFood(clientId, food) {
    const entry: FoodEntry = { id: nextId('f'), clientId, loggedAt: new Date().toISOString(), ...food };
    state.food.unshift(entry);
    return entry;
  },
  async removeFood(foodId) {
    const i = state.food.findIndex((f) => f.id === foodId);
    if (i >= 0) state.food.splice(i, 1);
  },
  async addScan(clientId, scan) {
    const s: Scan = { id: nextId('s'), clientId, ...scan };
    state.client.scans.push(s);
    state.client.scans.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    return s;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
// Row shapes come straight from supabase/schema.sql. Mappers convert snake_case
// DB rows to the camelCase domain types the UI expects.
type ClientRow = {
  id: string; sex: 'f' | 'm'; dob: string; height_cm: number;
  goal: MockClient['goal']; diet: MockClient['diet']; activity: number;
  meals_per_day: number;
  scans?: ScanRow[]; workout_logs?: WorkoutRow[];
  profiles?: { full_name: string | null } | null;
};
type ScanRow = {
  id: string; client_id: string; taken_at: string; weight_kg: number;
  body_fat_pct: number; skeletal_muscle_kg: number | null; source: string | null;
};
type WorkoutRow = {
  logged_at: string; exercise_id: string;
  sets: [number, number][] | null; cardio: { mins: number; dist: number; unit: string } | null;
  kcal: number | null;
};
type SessionRow = {
  id: string; trainer_id: string; client_id: string | null; starts_at: string;
  duration_min: number; status: TrainingSession['status']; released: boolean;
};

function mapScan(r: ScanRow): Scan {
  return {
    id: r.id, clientId: r.client_id, takenAt: r.taken_at, weightKg: Number(r.weight_kg),
    bodyFatPct: Number(r.body_fat_pct), skeletalMuscleKg: Number(r.skeletal_muscle_kg ?? 0),
    source: r.source ?? 'InBody',
  };
}
function mapSession(r: SessionRow): TrainingSession {
  return {
    id: r.id, trainerId: r.trainer_id, clientId: r.client_id, startsAt: r.starts_at,
    durationMin: r.duration_min, status: r.status, released: r.released,
  };
}
function mapClient(r: ClientRow): MockClient {
  const scans = (r.scans ?? []).map(mapScan).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  // Derive the body-stat time series from the scan history (matches the prototype).
  const series = (pick: (s: Scan) => number) => scans.map((s) => ({ t: s.takenAt, v: pick(s) }));
  const log = (r.workout_logs ?? [])
    .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
    .map((w) => ({
      t: w.logged_at, exercise: w.exercise_id,
      sets: w.sets ?? undefined, cardio: w.cardio ?? undefined, kcal: w.kcal ?? undefined,
    }));
  return {
    id: r.id,
    name: r.profiles?.full_name ?? 'Client',
    sex: r.sex, dob: r.dob, heightCm: Number(r.height_cm),
    goal: r.goal, diet: r.diet, activity: Number(r.activity),
    mealsPerDay: (r.meals_per_day as 3 | 4 | 5) ?? 4,
    weight: series((s) => s.weightKg),
    bodyFat: series((s) => s.bodyFatPct),
    muscle: series((s) => s.skeletalMuscleKg),
    scans, log,
  };
}

export const supabaseRepo: Repo = {
  async getClient(id) {
    const { data, error } = await supabase
      .from('clients')
      .select('*, profiles(full_name), scans(*), workout_logs(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return mapClient(data as unknown as ClientRow);
  },
  async addWorkout(clientId, e) {
    const { error } = await supabase.from('workout_logs').insert({
      client_id: clientId, exercise_id: e.exercise,
      sets: e.sets ?? null, cardio: e.cardio ?? null, kcal: e.kcal ?? null,
    });
    if (error) throw error;
  },
  async getSessions(trainerId) {
    const { data, error } = await supabase
      .from('sessions').select('*').eq('trainer_id', trainerId).order('starts_at');
    if (error) throw error;
    return (data as SessionRow[] ?? []).map(mapSession);
  },
  async bookSession(id, clientId) {
    const { error } = await supabase.from('sessions')
      .update({ status: 'booked', client_id: clientId, released: false }).eq('id', id);
    if (error) throw error;
  },
  async releaseSession(id) {
    const { error } = await supabase.from('sessions')
      .update({ status: 'available', client_id: null, released: true }).eq('id', id);
    if (error) throw error;
  },
  async getTrainer(id) {
    const { data, error } = await supabase
      .from('trainers')
      .select('id, tenants(session_fee), profiles(full_name), clients(id, goal, profiles(full_name))')
      .eq('id', id)
      .single();
    if (error) throw error;
    const t = data as any;
    return {
      id: t.id,
      name: t.profiles?.full_name ?? 'Coach',
      sessionFee: Number(t.tenants?.session_fee ?? 75),
      clients: (t.clients ?? []).map((c: any) => ({
        id: c.id, name: c.profiles?.full_name ?? 'Client', goal: c.goal, weightDelta: 0,
      })),
    };
  },
  async getMessages(clientId) {
    const { data, error } = await supabase
      .from('messages').select('*').eq('client_id', clientId).order('created_at');
    if (error) throw error;
    return (data ?? []).map((m: any) => ({
      id: m.id, clientId: m.client_id, sender: m.sender, body: m.body, createdAt: m.created_at,
    }));
  },
  async sendMessage(clientId, sender, body) {
    const { data, error } = await supabase
      .from('messages').insert({ client_id: clientId, sender, body }).select().single();
    if (error) throw error;
    return { id: data.id, clientId: data.client_id, sender: data.sender, body: data.body, createdAt: data.created_at };
  },
  async getFoodLog(clientId, dayISO) {
    const day = (dayISO ?? new Date().toISOString()).slice(0, 10);
    const { data, error } = await supabase
      .from('food_logs').select('*').eq('client_id', clientId)
      .gte('logged_at', `${day}T00:00:00`).lte('logged_at', `${day}T23:59:59`)
      .order('logged_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((f: any) => ({
      id: f.id, clientId: f.client_id, loggedAt: f.logged_at, name: f.name,
      kcal: f.kcal, protein: Number(f.protein), carbs: Number(f.carbs), fat: Number(f.fat), via: f.via,
    }));
  },
  async addFood(clientId, food) {
    const { data, error } = await supabase.from('food_logs')
      .insert({ client_id: clientId, name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, via: food.via })
      .select().single();
    if (error) throw error;
    return {
      id: data.id, clientId: data.client_id, loggedAt: data.logged_at, name: data.name,
      kcal: data.kcal, protein: Number(data.protein), carbs: Number(data.carbs), fat: Number(data.fat), via: data.via,
    };
  },
  async removeFood(foodId) {
    const { error } = await supabase.from('food_logs').delete().eq('id', foodId);
    if (error) throw error;
  },
  async addScan(clientId, scan) {
    const { data, error } = await supabase.from('scans').insert({
      client_id: clientId, taken_at: scan.takenAt, weight_kg: scan.weightKg,
      body_fat_pct: scan.bodyFatPct, skeletal_muscle_kg: scan.skeletalMuscleKg, source: scan.source,
    }).select().single();
    if (error) throw error;
    return mapScan(data as ScanRow);
  },
};

// Flip to supabaseRepo once .env has your keys and the schema is applied.
// (Or wire this to an env flag: process.env.EXPO_PUBLIC_USE_SUPABASE === '1'.)
import { USE_SUPABASE } from '../lib/config';
export const repo: Repo = USE_SUPABASE ? supabaseRepo : mockRepo;
