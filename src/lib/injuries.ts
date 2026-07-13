// Injury disclosure model. A client can disclose injuries so the AI coach, the
// trainer, and the workout planner train AROUND them. Each area maps to the
// muscle groups and exercise-name keywords that typically load it, so the Train
// tab can flag risky movements and offer a safer swap. This is guidance, not
// medical advice — the UI always tells the user to see a professional for pain.
export type InjurySeverity = 'mild' | 'moderate' | 'severe';
export type InjuryStatus = 'active' | 'recovered';
export interface Injury {
  id: string;
  area: string;            // one of INJURY_AREAS ids (or 'other')
  severity: InjurySeverity;
  status: InjuryStatus;
  note?: string;
  at: string;              // ISO disclosed-at
}

export interface AreaDef { id: string; label: string; groups: string[]; keywords: string[] }

// Muscle-group names below match src/lib/programs.ts groups exactly:
// Arms, Back, Calves, Chest, Core, Glutes, Hamstrings, Legs, Shoulders.
export const INJURY_AREAS: AreaDef[] = [
  { id: 'lower_back', label: 'Lower back', groups: ['Back', 'Hamstrings', 'Glutes', 'Core'], keywords: ['deadlift', 'rdl', 'romanian', 'good morning', 'bent-over', 'bent over', 'row', 'squat', 'clean', 'swing', 'hyperextension', 'hip thrust'] },
  { id: 'knee', label: 'Knee', groups: ['Legs', 'Glutes'], keywords: ['squat', 'lunge', 'leg press', 'leg extension', 'jump', 'pistol', 'step-up', 'step up', 'box', 'goblet'] },
  { id: 'shoulder', label: 'Shoulder', groups: ['Shoulders', 'Chest'], keywords: ['press', 'overhead', 'bench', 'snatch', 'jerk', 'lateral raise', 'upright row', 'dip', 'push-up', 'push up', 'pull-up', 'pull up', 'pulldown', 'face pull'] },
  { id: 'elbow', label: 'Elbow', groups: ['Arms'], keywords: ['curl', 'extension', 'pushdown', 'skullcrusher', 'chin', 'pull-up', 'pull up', 'dip'] },
  { id: 'wrist', label: 'Wrist / hand', groups: ['Arms', 'Chest'], keywords: ['push-up', 'push up', 'press', 'curl', 'plank', 'clean', 'front squat', 'goblet'] },
  { id: 'hip', label: 'Hip', groups: ['Glutes', 'Legs', 'Core'], keywords: ['squat', 'lunge', 'deadlift', 'hip thrust', 'leg raise', 'abduction', 'step-up', 'step up', 'rdl'] },
  { id: 'ankle', label: 'Ankle / foot', groups: ['Calves', 'Legs'], keywords: ['squat', 'lunge', 'calf', 'jump', 'run', 'box', 'sprint', 'step-up', 'step up'] },
  { id: 'hamstring', label: 'Hamstring', groups: ['Hamstrings'], keywords: ['deadlift', 'rdl', 'romanian', 'leg curl', 'good morning', 'sprint', 'lunge'] },
  { id: 'neck', label: 'Neck', groups: ['Shoulders'], keywords: ['shrug', 'overhead', 'bridge', 'press'] },
  { id: 'chest_rib', label: 'Chest / rib', groups: ['Chest'], keywords: ['bench', 'push-up', 'push up', 'dip', 'fly', 'press'] },
  { id: 'other', label: 'Other', groups: [], keywords: [] },
];

export const areaLabel = (id: string): string => INJURY_AREAS.find((a) => a.id === id)?.label ?? id;

const sevRank = (s: InjurySeverity): number => (s === 'severe' ? 3 : s === 'moderate' ? 2 : 1);

export const activeInjuries = (injs: Injury[] = []): Injury[] => injs.filter((i) => i.status === 'active');

// Does an exercise (name + muscle group) load any ACTIVE injured area? Returns
// the worst matching injury and a plain-language reason, or null if clear.
export function injuryFlag(exName: string, group: string, injs: Injury[] = []): { injury: Injury; reason: string } | null {
  const act = activeInjuries(injs);
  if (!act.length) return null;
  const n = (exName || '').toLowerCase();
  const g = (group || '').toLowerCase();
  let hit: Injury | null = null;
  for (const inj of act) {
    const def = INJURY_AREAS.find((a) => a.id === inj.area);
    if (!def) continue;
    const byGroup = def.groups.some((x) => x.toLowerCase() === g);
    const byKw = def.keywords.some((k) => n.includes(k));
    if (byGroup || byKw) { if (!hit || sevRank(inj.severity) > sevRank(hit.severity)) hit = inj; }
  }
  if (!hit) return null;
  return { injury: hit, reason: 'May stress your ' + areaLabel(hit.area).toLowerCase() };
}

// Compact one-line summary for the AI coach prompt and the trainer's view.
export function injurySummary(injs: Injury[] = []): string {
  const act = activeInjuries(injs);
  if (!act.length) return '';
  return act.map((i) => areaLabel(i.area) + ' (' + i.severity + (i.note ? ', ' + i.note : '') + ')').join('; ');
}

export const newInjuryId = (): string => 'inj_' + Math.random().toString(36).slice(2, 9);

// Proactive-coaching signal: the muscle groups eased off because of a SEVERE
// active injury, so the client dashboard can surface a coach message and the
// plan's auto-hide has something to explain. Null when nothing is severe.
export function severeSummary(injs: Injury[] = []): { areas: string[]; groups: string[] } | null {
  const sev = activeInjuries(injs).filter((i) => i.severity === 'severe');
  if (!sev.length) return null;
  const areas = Array.from(new Set(sev.map((i) => areaLabel(i.area))));
  const groups = Array.from(new Set(sev.flatMap((i) => INJURY_AREAS.find((a) => a.id === i.area)?.groups || [])));
  return { areas, groups };
}
