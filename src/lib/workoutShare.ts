// Which movements a shared workout card names, and in what order.
//
// "Top exercises" is the work that dominated the session: total reps × load in
// kilograms, with the set count breaking ties so an all-bodyweight or held
// session (no knowable load) still names its movements rather than none.
// Pure: names in, names out. The caller passes the catalogue spelling.

export interface ShareMovement { name: string; sets: readonly (readonly [number, number | null])[] }

export function topMovements(moves: readonly ShareMovement[], n = 3): string[] {
  const score = new Map<string, { vol: number; sets: number; first: number }>();
  moves.forEach((m, idx) => {
    const name = String(m.name ?? '').trim();
    if (!name || !m.sets.length) return;
    const cur = score.get(name) ?? { vol: 0, sets: 0, first: idx };
    for (const [reps, kg] of m.sets) {
      if (reps > 0 && kg != null && kg > 0) cur.vol += reps * kg;
      cur.sets += 1;
    }
    score.set(name, cur);
  });
  return [...score.entries()]
    .sort((a, b) => b[1].vol - a[1].vol || b[1].sets - a[1].sets || a[1].first - b[1].first)
    .slice(0, Math.max(0, n))
    .map(([name]) => name);
}
