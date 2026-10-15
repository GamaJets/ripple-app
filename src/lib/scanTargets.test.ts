import { scanBody, scanBodyOf, scanTuning, coachHoldsTargets } from './scanTargets';
import { macrosFor, maintenanceFor } from './nutrition';

const errors: string[] = [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assert = {
  equal: (a: unknown, b: unknown) => { if (a !== b) throw new Error(`got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); },
  deepEqual: (a: unknown, b: unknown) => { if (!same(a, b)) throw new Error(`got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); },
};
let n = 0;
const t = (name: string, f: () => void) => { try { f(); n++; } catch (e) { errors.push(`${name}: ${(e as Error).message}`); } };

t('no scan figures: Katch–McArdle from body fat', () => {
  const r = scanBody({ weightKg: 80, bodyFatPct: 20 });
  assert.equal(r.lbm, 64); assert.equal(r.bmr, 370 + 21.6 * 64);
  assert.equal(r.bmrSource, 'katch-mcardle'); assert.equal(r.leanSource, 'body-fat');
});
t('measured BMR wins', () => {
  const r = scanBody({ weightKg: 80, bodyFatPct: 20, measuredBmr: 1720 });
  assert.equal(r.bmr, 1720); assert.equal(r.bmrSource, 'scan');
});
t('measured lean mass drives Katch–McArdle when no BMR', () => {
  const r = scanBody({ weightKg: 80, bodyFatPct: 20, leanMassKg: 66 });
  assert.equal(r.lbm, 66); assert.equal(r.bmr, 370 + 21.6 * 66); assert.equal(r.leanSource, 'scan');
});
t('implausible readings are ignored', () => {
  const r = scanBody({ weightKg: 80, bodyFatPct: 20, leanMassKg: 95, measuredBmr: 170 });
  assert.equal(r.lbm, 64); assert.equal(r.bmrSource, 'katch-mcardle');
});
t('maintenance = BMR × activity', () => {
  const m = maintenanceFor({ weightKg: 80, bodyFatPct: 20, activity: 1.5, measuredBmr: 1800 });
  assert.equal(m.tdee, 2700);
});
t('macrosFor: protein from scan lean mass, kcal from scan BMR', () => {
  const m = macrosFor({ weightKg: 80, bodyFatPct: 20, activity: 1.5, goal: 'muscle', diet: 'meat', measuredBmr: 1800, leanMassKg: 66 });
  assert.equal(m.bmr, 1800); assert.equal(m.tdee, 2700);
  assert.equal(m.kcal, Math.round(2700 * 1.12 / 10) * 10);
  assert.equal(m.protein, Math.round(2.0 * 66));
});
t('macrosFor unchanged without scan figures', () => {
  const a = macrosFor({ weightKg: 80, bodyFatPct: 20, activity: 1.45, goal: 'fatloss', diet: 'meat' });
  assert.equal(a.bmr, Math.round(370 + 21.6 * 64)); assert.equal(a.protein, Math.round(2.2 * 64));
});
t('scanBodyOf', () => {
  assert.deepEqual(scanBodyOf({ bmr: 1600, leanMassKg: 60 }), { measuredBmr: 1600, leanMassKg: 60 });
  assert.deepEqual(scanBodyOf(undefined), { measuredBmr: null, leanMassKg: null });
});
t('coach holds', () => {
  assert.equal(coachHoldsTargets(null), false);
  assert.equal(coachHoldsTargets({ kcalDelta: 0, proteinDelta: 0 }), false);
  assert.equal(coachHoldsTargets({ kcalDelta: -200 }), true);
  assert.equal(coachHoldsTargets({ plan: { days: [] } }), true);
  assert.equal(coachHoldsTargets({ mealOverride: { breakfast: 1 } }), true);
});
t('tuning', () => {
  const b = { kcal: 2000, protein: 140, carbs: 200, fat: 60 };
  assert.equal(scanTuning(b, { ...b, kcal: 2003 }, null).kind, 'unchanged');
  assert.equal(scanTuning(b, { ...b, kcal: 2100 }, null).kind, 'apply');
  const p = scanTuning(b, { ...b, kcal: 2100, protein: 150 }, { kcalDelta: -300 });
  assert.equal(p.kind, 'propose'); if (p.kind !== 'unchanged') { assert.equal(p.dKcal, 100); assert.equal(p.dProtein, 10); }
  assert.equal(scanTuning(null, b, null).kind, 'apply');
});
if (errors.length) { console.error(errors.join('\n')); throw new Error(`scanTargets: ${errors.length} failed`); }
console.log(`scanTargets: ${n} passed`);
