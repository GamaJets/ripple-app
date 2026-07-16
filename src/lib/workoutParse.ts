// Natural-language workout parser (pure, offline). Turns a sentence like
// "bench 3x8 60kg, squat 100kg 5 5 5, 3x12 pushups" into structured lifts.
// Deterministic + unit-tested; no AI backend required.
export interface ParsedLift { exercise: string; sets: [number, number][] }

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function parseWorkoutText(text: string): ParsedLift[] {
  const clauses = (text || '').split(/\n|,|;|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const out: ParsedLift[] = [];
  for (const cl of clauses) {
    const lc = cl.toLowerCase();
    // weight (kg / lb / "@N" / "at N")
    let kg = 0;
    const mKg = lc.match(/(\d+(?:\.\d+)?)\s*kg/);
    const mLb = lc.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)/);
    const mAt = lc.match(/(?:@|\bat)\s*(\d+(?:\.\d+)?)/);
    if (mKg) kg = parseFloat(mKg[1]);
    else if (mLb) kg = Math.round(parseFloat(mLb[1]) * 0.45359 * 2) / 2;
    else if (mAt) kg = parseFloat(mAt[1]);

    let sets: [number, number][] = [];
    const sxr = lc.match(/(\d+)\s*[x×]\s*(\d+)/);
    if (sxr) {
      const a = parseInt(sxr[1], 10), b = parseInt(sxr[2], 10);
      if (kg === 0 && b > 30) sets = [[a, b]];          // "5x100" → 5 reps @ 100kg
      else for (let i = 0; i < a; i++) sets.push([b, kg]); // "3x8" → 3 sets of 8
    } else {
      const nums = (lc.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      const reps = nums.filter((n) => n !== kg && n <= 30 && Number.isInteger(n));
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
