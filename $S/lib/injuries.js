"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newInjuryId = exports.activeInjuries = exports.areaLabel = exports.INJURY_AREAS = void 0;
exports.injuryFlag = injuryFlag;
exports.injurySummary = injurySummary;
exports.severeSummary = severeSummary;
// Muscle-group names below match src/lib/programs.ts groups exactly:
// Arms, Back, Calves, Chest, Core, Glutes, Hamstrings, Legs, Shoulders.
exports.INJURY_AREAS = [
    { id: 'lower_back', label: 'Lower Back', groups: ['Back', 'Hamstrings', 'Glutes', 'Core'], keywords: ['deadlift', 'rdl', 'romanian', 'good morning', 'bent-over', 'bent over', 'row', 'squat', 'clean', 'swing', 'hyperextension', 'hip thrust'] },
    { id: 'knee', label: 'Knee', groups: ['Legs', 'Glutes'], keywords: ['squat', 'lunge', 'leg press', 'leg extension', 'jump', 'pistol', 'step-up', 'step up', 'box', 'goblet'] },
    { id: 'shoulder', label: 'Shoulder', groups: ['Shoulders', 'Chest'], keywords: ['press', 'overhead', 'bench', 'snatch', 'jerk', 'lateral raise', 'upright row', 'dip', 'push-up', 'push up', 'pull-up', 'pull up', 'pulldown', 'face pull'] },
    { id: 'elbow', label: 'Elbow', groups: ['Arms'], keywords: ['curl', 'extension', 'pushdown', 'skullcrusher', 'chin', 'pull-up', 'pull up', 'dip'] },
    { id: 'wrist', label: 'Wrist / Hand', groups: ['Arms', 'Chest'], keywords: ['push-up', 'push up', 'press', 'curl', 'plank', 'clean', 'front squat', 'goblet'] },
    { id: 'hip', label: 'Hip', groups: ['Glutes', 'Legs', 'Core'], keywords: ['squat', 'lunge', 'deadlift', 'hip thrust', 'leg raise', 'abduction', 'step-up', 'step up', 'rdl'] },
    { id: 'ankle', label: 'Ankle / Foot', groups: ['Calves', 'Legs'], keywords: ['squat', 'lunge', 'calf', 'jump', 'run', 'box', 'sprint', 'step-up', 'step up'] },
    { id: 'hamstring', label: 'Hamstring', groups: ['Hamstrings'], keywords: ['deadlift', 'rdl', 'romanian', 'leg curl', 'good morning', 'sprint', 'lunge'] },
    { id: 'neck', label: 'Neck', groups: ['Shoulders'], keywords: ['shrug', 'overhead', 'bridge', 'press'] },
    { id: 'chest_rib', label: 'Chest / Rib', groups: ['Chest'], keywords: ['bench', 'push-up', 'push up', 'dip', 'fly', 'press'] },
    { id: 'other', label: 'Other', groups: [], keywords: [] },
];
const areaLabel = (id) => exports.INJURY_AREAS.find((a) => a.id === id)?.label ?? id;
exports.areaLabel = areaLabel;
const sevRank = (s) => (s === 'severe' ? 3 : s === 'moderate' ? 2 : 1);
const activeInjuries = (injs = []) => injs.filter((i) => i.status === 'active');
exports.activeInjuries = activeInjuries;
// Does an exercise (name + muscle group) load any ACTIVE injured area? Returns
// the worst matching injury and a plain-language reason, or null if clear.
function injuryFlag(exName, group, injs = []) {
    const act = (0, exports.activeInjuries)(injs);
    if (!act.length)
        return null;
    const n = (exName || '').toLowerCase();
    const g = (group || '').toLowerCase();
    let hit = null;
    for (const inj of act) {
        const def = exports.INJURY_AREAS.find((a) => a.id === inj.area);
        if (!def)
            continue;
        const byGroup = def.groups.some((x) => x.toLowerCase() === g);
        const byKw = def.keywords.some((k) => n.includes(k));
        if (byGroup || byKw) {
            if (!hit || sevRank(inj.severity) > sevRank(hit.severity))
                hit = inj;
        }
    }
    if (!hit)
        return null;
    return { injury: hit, reason: 'May stress your ' + (0, exports.areaLabel)(hit.area).toLowerCase() };
}
// Compact one-line summary for the AI coach prompt and the trainer's view.
function injurySummary(injs = []) {
    const act = (0, exports.activeInjuries)(injs);
    if (!act.length)
        return '';
    return act.map((i) => (0, exports.areaLabel)(i.area) + ' (' + i.severity + (i.note ? ', ' + i.note : '') + ')').join('; ');
}
const newInjuryId = () => 'inj_' + Math.random().toString(36).slice(2, 9);
exports.newInjuryId = newInjuryId;
// Proactive-coaching signal: the muscle groups eased off because of a SEVERE
// active injury, so the client dashboard can surface a coach message and the
// plan's auto-hide has something to explain. Null when nothing is severe.
function severeSummary(injs = []) {
    const sev = (0, exports.activeInjuries)(injs).filter((i) => i.severity === 'severe');
    if (!sev.length)
        return null;
    const areas = Array.from(new Set(sev.map((i) => (0, exports.areaLabel)(i.area))));
    const groups = Array.from(new Set(sev.flatMap((i) => exports.INJURY_AREAS.find((a) => a.id === i.area)?.groups || [])));
    return { areas, groups };
}
