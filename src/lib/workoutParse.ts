// Natural-language workout parser (pure, offline). Turns a sentence like
// "bench 3x8 60kg, squat 100kg 5 5 5, 3x12 pushups" into structured lifts.
// Deterministic + unit-tested; no AI backend required.
//
// ── Why this takes a unit ───────────────────────────────────────────────────
//
// It used to read every UNSUFFIXED number as kilograms. "kg" and "lb" were both
// understood, so the shape looked complete — but a pounds member typing what
// their gym's plates actually say, "bench 3x8 @135", had 135 KILOGRAMS written
// to their log: 297lb, more than double the lift. Nothing showed it, because
// every screen renders back through liftLabel and 135kg is displayed as 297lb,
// which reads as a plausible number rather than as an error.
//
// The unit is the member's own setting, the same one the rest of the screen uses.
// A number with a suffix still means what it says — writing "60kg" while set to
// pounds is a deliberate act, not a mistake to correct.
import { KG_PER_LB, type WeightUnit } from './units';

export interface ParsedLift { exercise: string; sets: [number, number][] }

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Round to the half-unit a gym can actually load, in the unit it was typed in. */
const halves = (n: number) => Math.round(n * 2) / 2;

export function parseWorkoutText(text: string, unit: WeightUnit = 'kg'): ParsedLift[] {
  // A bare number is in the member's unit. Storage is always kilograms.
  const toKg = (n: number) => (unit === 'lb' ? halves(n * KG_PER_LB) : n);

  const clauses = (text || '').split(/\n|,|;|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const out: ParsedLift[] = [];
  for (const cl of clauses) {
    const lc = cl.toLowerCase();
    // weight (kg / lb / "@N" / "at N")
    let kg = 0;
    // The number AS WRITTEN, kept alongside the converted one. The rep scan
    // below removes the weight from the list of numbers by matching it, and
    // once the weight is converted it no longer equals anything in the
    // sentence — so "curl @20 10 10" in pounds would count the 20 as a set of
    // twenty reps. This is what it is compared against.
    let written = NaN;
    const mKg = lc.match(/(\d+(?:\.\d+)?)\s*kg/);
    const mLb = lc.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)/);
    const mAt = lc.match(/(?:@|\bat)\s*(\d+(?:\.\d+)?)/);
    if (mKg) { written = parseFloat(mKg[1]); kg = written; }
    else if (mLb) { written = parseFloat(mLb[1]); kg = halves(written * KG_PER_LB); }
    else if (mAt) { written = parseFloat(mAt[1]); kg = toKg(written); }

    let sets: [number, number][] = [];
    const sxr = lc.match(/(\d+)\s*[x×]\s*(\d+)/);
    if (sxr) {
      const a = parseInt(sxr[1], 10), b = parseInt(sxr[2], 10);
      // "5x100" → 5 reps @ 100, the 100 being in the member's unit like any
      // other bare number.
      if (kg === 0 && b > 30) sets = [[a, toKg(b)]];
      else for (let i = 0; i < a; i++) sets.push([b, kg]); // "3x8" → 3 sets of 8
    } else {
      const nums = (lc.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const reps = nums.filter((n) => n !== written && n <= 30 && Number.isInteger(n));
      if (reps.length >= 1 && reps.length <= 8) reps.forEach((r) => sets.push([r, kg]));
    }
    if (!sets.length) continue;

    let name = cl
      .replace(/(\d+(?:\.\d+)?)\s*(kg|lb|lbs|pounds)/gi, ' ')
      .replace(/(?:@|\bat\b)\s*\d+(?:\.\d+)?/gi, ' ')
      .replace(/\d+\s*[x×]\s*\d+/gi, ' ')
      .replace(/[x×@]/gi, ' ')
      .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
      .replace(/\bsets?\b|\breps?\b|\bkg\b|\blbs?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ exercise: name ? titleCase(name) : 'Exercise', sets });
  }
  return out;
}
