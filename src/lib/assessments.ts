// Coach assessments: the four standard tests, one record both apps read.
//
// A coach records a test; the client sees the same row, read-only, in their
// own app. There is no copy and no push: both screens select from the one
// `assessments` table (supabase/parts/3280-coach-assessments-both-apps-read.sql),
// so the two apps cannot disagree about what was recorded.
//
// The rules this file holds, and why:
//
//   · UNKNOWN IS NEVER ZERO. A movement screen with a pattern left unscored has
//     no total, not a total with a 0 in it. Every test here must be complete to
//     be saved, and a total that arrives unreadable off the wire is null.
//   · BETTER DEPENDS ON THE TEST. A higher score is better on the movement
//     screen, the mobility check and an estimated 1RM; a coach's own test can
//     be lower-is-better (a 2 km row time). `compareToPrevious` reads the
//     direction off the test, never assumes one.
//   · WEIGHT IS STORED IN KILOGRAMS. The strength test's load and its estimate
//     are kilograms on the row and printed in the viewer's unit.
//
// Pure: no react, no storage, asserted by src/lib/assessments.test.ts.
import { est1RM } from './streaks';
import { EPLEY_MAX_REPS } from './repEstimate';
import { est1RMIn, liftLabel, plain, kgToLb, type WeightUnit } from './units';
import { deltaLabel } from './deltaLabel';

export type AssessmentKind = 'movement' | 'strength' | 'mobility' | 'custom';
export type Direction = 'higher' | 'lower';
export type Grade = 'pass' | 'partial' | 'fail';

// ── The catalogue ─────────────────────────────────────────────────────────

/** Seven patterns scored 0-3, the familiar functional movement screen shape. */
export const MOVEMENT_PATTERNS = [
  { key: 'deep_squat', label: 'Deep Squat' },
  { key: 'hurdle_step', label: 'Hurdle Step' },
  { key: 'inline_lunge', label: 'Inline Lunge' },
  { key: 'shoulder_mobility', label: 'Shoulder Mobility' },
  { key: 'active_slr', label: 'Active Straight Leg Raise' },
  { key: 'trunk_pushup', label: 'Trunk Stability Push-Up' },
  { key: 'rotary_stability', label: 'Rotary Stability' },
] as const;
export const MOVEMENT_SCORE_MAX = 3;
export const MOVEMENT_TOTAL_MAX = MOVEMENT_PATTERNS.length * MOVEMENT_SCORE_MAX; // 21

export const STRENGTH_LIFTS = [
  { key: 'back_squat', label: 'Back Squat' },
  { key: 'bench_press', label: 'Bench Press' },
  { key: 'deadlift', label: 'Deadlift' },
  { key: 'overhead_press', label: 'Overhead Press' },
] as const;

export const MOBILITY_CHECKS = [
  { key: 'ankle_dorsiflexion', label: 'Ankle Dorsiflexion' },
  { key: 'hip_rotation', label: 'Hip Rotation' },
  { key: 'thoracic_rotation', label: 'Thoracic Rotation' },
  { key: 'shoulder_flexion', label: 'Shoulder Flexion' },
  { key: 'hamstring_length', label: 'Hamstring Length' },
] as const;
export const GRADE_POINTS: Record<Grade, number> = { pass: 2, partial: 1, fail: 0 };
export const GRADE_LABEL: Record<Grade, string> = { pass: 'Pass', partial: 'Partial', fail: 'Fail' };
export const MOBILITY_TOTAL_MAX = MOBILITY_CHECKS.length * GRADE_POINTS.pass; // 10

export const ASSESSMENT_TYPES: readonly { kind: AssessmentKind; label: string; note: string }[] = [
  { kind: 'movement', label: 'Movement Screen', note: `Seven patterns scored 0 to 3, out of ${MOVEMENT_TOTAL_MAX}` },
  { kind: 'strength', label: 'Strength Test', note: 'A lift, a load and reps, as an estimated 1RM' },
  { kind: 'mobility', label: 'Mobility Check', note: 'Five joint checks graded Pass, Partial or Fail' },
  { kind: 'custom', label: 'Custom Test', note: 'Your own test, with its value and unit' },
];

export const KINDS: readonly AssessmentKind[] = ['movement', 'strength', 'mobility', 'custom'];
export const NOTES_MAX = 2000;
export const NAME_MAX = 60;
export const UNIT_MAX = 20;

// ── What a coach types, and what gets saved ─────────────────────────────────

export type RecordInput =
  | { kind: 'movement'; scores: Record<string, number | null | undefined> }
  | { kind: 'strength'; lift: string; weightKg: number | null; reps: number | null }
  | { kind: 'mobility'; grades: Record<string, Grade | null | undefined> }
  | { kind: 'custom'; name: string; value: number | null; unit: string; direction: Direction };

/** The columns an insert carries, less the ones the server stamps. */
export interface RecordRow {
  kind: AssessmentKind;
  test_key: string;
  results: Record<string, unknown>;
  total: number;
  unit: string;
}

export type Built = { ok: true; row: RecordRow } | { ok: false; reason: string };

/** A custom test's name as a series key: 'Row 2km' and 'row 2KM' are one test. */
export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate a test and compute its total, or say what is missing. */
export function buildRecord(input: RecordInput): Built {
  switch (input.kind) {
    case 'movement': {
      const scores: Record<string, number> = {};
      for (const p of MOVEMENT_PATTERNS) {
        const s = input.scores[p.key];
        if (!isNum(s) || !Number.isInteger(s) || s < 0 || s > MOVEMENT_SCORE_MAX) {
          return { ok: false, reason: `Score ${p.label} from 0 to ${MOVEMENT_SCORE_MAX} before saving.` };
        }
        scores[p.key] = s;
      }
      const total = Object.values(scores).reduce((a, b) => a + b, 0);
      return { ok: true, row: { kind: 'movement', test_key: 'fms', results: { scores }, total, unit: 'points' } };
    }
    case 'strength': {
      const lift = STRENGTH_LIFTS.find((l) => l.key === input.lift);
      if (!lift) return { ok: false, reason: 'Pick the lift that was tested.' };
      if (!isNum(input.weightKg) || input.weightKg <= 0) return { ok: false, reason: 'Enter the load that was lifted.' };
      const reps = input.reps;
      if (!isNum(reps) || !Number.isInteger(reps) || reps < 1 || reps > EPLEY_MAX_REPS) {
        return { ok: false, reason: `Enter the reps completed, from 1 to ${EPLEY_MAX_REPS}.` };
      }
      return {
        ok: true,
        row: {
          kind: 'strength', test_key: lift.key,
          results: { weightKg: input.weightKg, reps },
          total: est1RM(input.weightKg, reps), unit: 'kg',
        },
      };
    }
    case 'mobility': {
      const grades: Record<string, Grade> = {};
      for (const c of MOBILITY_CHECKS) {
        const g = input.grades[c.key];
        if (g !== 'pass' && g !== 'partial' && g !== 'fail') {
          return { ok: false, reason: `Grade ${c.label} before saving.` };
        }
        grades[c.key] = g;
      }
      const total = Object.values(grades).reduce((a, g) => a + GRADE_POINTS[g], 0);
      return { ok: true, row: { kind: 'mobility', test_key: 'standard', results: { grades }, total, unit: 'points' } };
    }
    case 'custom': {
      const name = input.name.trim();
      const key = slug(name);
      if (!name || !key) return { ok: false, reason: 'Name the test.' };
      if (name.length > NAME_MAX) return { ok: false, reason: `Keep the name under ${NAME_MAX} characters.` };
      if (!isNum(input.value)) return { ok: false, reason: 'Enter the result as a number.' };
      const unit = input.unit.trim();
      if (unit.length > UNIT_MAX) return { ok: false, reason: `Keep the unit under ${UNIT_MAX} characters.` };
      if (input.direction !== 'higher' && input.direction !== 'lower') return { ok: false, reason: 'Say whether higher or lower is better.' };
      return {
        ok: true,
        row: { kind: 'custom', test_key: key, results: { name, direction: input.direction }, total: input.value, unit },
      };
    }
  }
}

// ── Reading rows back ─────────────────────────────────────────────────────

export interface Assessment {
  id: string;
  clientId: string;
  coachId: string;
  kind: AssessmentKind;
  testKey: string;
  recordedAt: string;
  results: Record<string, unknown>;
  /** Null when the row carries no readable total. Never a stand-in zero. */
  total: number | null;
  unit: string;
  notes: string | null;
}

/** A row as PostgREST returns it. Everything unknown-typed because it is parsed
 *  off the wire. src/ui/assessments.ts holds the one read both apps use. */
export interface AssessmentWire {
  id?: unknown; client_id?: unknown; coach_id?: unknown; kind?: unknown; test_key?: unknown;
  recorded_at?: unknown; results?: unknown; total?: unknown; unit?: unknown; notes?: unknown;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Rows off the wire, oldest first. Unknown kinds and undated rows are dropped. */
export function readAssessments(rows: readonly AssessmentWire[] | null | undefined): Assessment[] {
  const out: Assessment[] = [];
  for (const r of rows ?? []) {
    const kind = r.kind as AssessmentKind;
    const at = typeof r.recorded_at === 'string' ? r.recorded_at : '';
    if (!KINDS.includes(kind) || !Number.isFinite(Date.parse(at)) || typeof r.test_key !== 'string') continue;
    const results = r.results && typeof r.results === 'object' && !Array.isArray(r.results)
      ? (r.results as Record<string, unknown>) : {};
    const notes = typeof r.notes === 'string' && r.notes.trim() ? r.notes.trim() : null;
    out.push({
      id: String(r.id ?? ''), clientId: String(r.client_id ?? ''), coachId: String(r.coach_id ?? ''),
      kind, testKey: r.test_key, recordedAt: at, results, total: numOrNull(r.total),
      unit: typeof r.unit === 'string' ? r.unit : '', notes,
    });
  }
  return out.sort(byTime);
}

function byTime(a: Assessment, b: Assessment): number {
  const d = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  return d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function directionOf(a: Pick<Assessment, 'kind' | 'results'>): Direction {
  return a.kind === 'custom' && a.results.direction === 'lower' ? 'lower' : 'higher';
}

export function seriesKey(a: Pick<Assessment, 'kind' | 'testKey'>): string {
  return `${a.kind}:${a.testKey}`;
}

export function testLabel(a: Pick<Assessment, 'kind' | 'testKey' | 'results'>): string {
  switch (a.kind) {
    case 'movement': return 'Movement Screen';
    case 'mobility': return 'Mobility Check';
    case 'strength': return STRENGTH_LIFTS.find((l) => l.key === a.testKey)?.label ?? 'Strength Test';
    case 'custom': return typeof a.results.name === 'string' && a.results.name.trim() ? a.results.name.trim() : 'Custom Test';
  }
}

export interface Series {
  key: string;
  kind: AssessmentKind;
  label: string;
  direction: Direction;
  /** Oldest first. */
  history: Assessment[];
}

/** One series per test, the most recently recorded test first. */
export function groupSeries(list: readonly Assessment[]): Series[] {
  const map = new Map<string, Assessment[]>();
  for (const a of [...list].sort(byTime)) {
    const k = seriesKey(a);
    const h = map.get(k);
    if (h) h.push(a); else map.set(k, [a]);
  }
  const out: Series[] = [];
  for (const [key, history] of map) {
    const last = history[history.length - 1];
    out.push({ key, kind: last.kind, label: testLabel(last), direction: directionOf(last), history });
  }
  return out.sort((a, b) => byTime(b.history[b.history.length - 1], a.history[a.history.length - 1]));
}

export type Verdict = 'better' | 'worse' | 'same';

export interface Comparison {
  latest: Assessment;
  previous: Assessment | null;
  /** latest minus previous, in the stored unit. Null when either is unknown. */
  change: number | null;
  /** Null when there is nothing to compare. */
  verdict: Verdict | null;
}

/** The latest result against the one before it, judged by the test's direction. */
export function compareToPrevious(history: readonly Assessment[], direction?: Direction): Comparison | null {
  if (!history.length) return null;
  const sorted = [...history].sort(byTime);
  const latest = sorted[sorted.length - 1];
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  if (!previous || latest.total == null || previous.total == null) {
    return { latest, previous, change: null, verdict: null };
  }
  const change = latest.total - previous.total;
  const dir = direction ?? directionOf(latest);
  const verdict: Verdict = Math.abs(change) < 1e-9 ? 'same'
    : (change > 0) === (dir === 'higher') ? 'better' : 'worse';
  return { latest, previous, change, verdict };
}

// ── How a result is said ──────────────────────────────────────────────────

/** "15/21", "Est. 1RM 120 kg", "7:45 min". Null when there is no total. */
export function totalLabel(a: Assessment, wu: WeightUnit): string | null {
  if (a.total == null) return null;
  switch (a.kind) {
    case 'movement': return `${plain(a.total)}/${MOVEMENT_TOTAL_MAX}`;
    case 'mobility': return `${plain(a.total)}/${MOBILITY_TOTAL_MAX}`;
    case 'strength': return `Est. 1RM ${est1RMIn(a.total, wu)} ${wu}`;
    case 'custom': return a.unit ? `${plain(a.total)} ${a.unit}` : plain(a.total);
  }
}

/** The total as a plotted number in the viewer's unit. */
export function chartValue(a: Assessment, wu: WeightUnit): number | null {
  if (a.total == null) return null;
  return a.kind === 'strength' ? est1RMIn(a.total, wu) : a.total;
}

export function chartUnit(a: Pick<Assessment, 'kind' | 'unit'>, wu: WeightUnit): string {
  return a.kind === 'strength' ? wu : a.kind === 'custom' ? a.unit : 'points';
}

/** "+5 kg since 12 Aug", "No earlier result". `since` is already formatted. */
export function changeLabel(c: Comparison, wu: WeightUnit, since: string | null): string {
  const k = c.latest.kind;
  const change = c.change == null ? null
    : k === 'strength' ? Math.round(wu === 'lb' ? kgToLb(c.change) : c.change) : c.change;
  return deltaLabel(change, {
    since,
    unit: k === 'strength' ? wu : k === 'custom' ? c.latest.unit || null : 'points',
    decimals: k === 'custom' ? 2 : 0,
    noBaseline: 'First result on record',
  });
}

/** The detail under a result: each pattern's score, each check's grade, the set. */
export function detailLines(a: Assessment, wu: WeightUnit): string[] {
  const r = a.results;
  switch (a.kind) {
    case 'movement': {
      const s = (r.scores ?? {}) as Record<string, unknown>;
      return MOVEMENT_PATTERNS.map((p) => `${p.label} ${isNum(s[p.key]) ? `${s[p.key]}/${MOVEMENT_SCORE_MAX}` : 'not scored'}`);
    }
    case 'mobility': {
      const g = (r.grades ?? {}) as Record<string, unknown>;
      return MOBILITY_CHECKS.map((c) => `${c.label} ${GRADE_LABEL[g[c.key] as Grade] ?? 'not graded'}`);
    }
    case 'strength': {
      const load = liftLabel(isNum(r.weightKg) ? r.weightKg : null, wu);
      return load && isNum(r.reps) ? [`${load} × ${r.reps} reps`] : [];
    }
    case 'custom':
      return [r.direction === 'lower' ? 'Lower is better' : 'Higher is better'];
  }
}
