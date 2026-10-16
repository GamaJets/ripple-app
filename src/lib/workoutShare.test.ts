import { topMovements } from './workoutShare';
import { workoutPost } from './postCard';
const errors: string[] = [];
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${m}: got ${JSON.stringify(a)}`); };

eq(topMovements([
  { name: 'Curl', sets: [[10, 15], [10, 15]] },
  { name: 'Squat', sets: [[5, 100]] },
  { name: 'Pull-Up', sets: [[8, null], [8, null], [8, null]] },
  { name: 'Plank', sets: [] },
  { name: 'Bench', sets: [[5, 80], [5, 80]] },
]), ['Bench', 'Squat', 'Curl'], 'by volume');
eq(topMovements([{ name: 'Pull-Up', sets: [[8, null]] }, { name: 'Dip', sets: [[8, null], [8, null]] }]), ['Dip', 'Pull-Up'], 'set count breaks ties');

const b = workoutPost({ focus: 'Push', sets: 12, minutes: 50, volume: '6.2 t', prs: ['Bench 100 kg'], brand: 'Repple', date: 'Fri 16 Oct', top: ['Bench Press', 'Overhead Press', 'Dip', 'Fly'] });
if (!b.ok) errors.push('card refused'); else {
  eq(b.card.kicker, 'Workout Complete · Fri 16 Oct', 'date in kicker');
  eq(b.card.lines, ['50 Minutes', 'Volume 6.2 t', 'New Best · Bench 100 kg', '1. Bench Press', '2. Overhead Press', '3. Dip'], 'lines');
}
const many = workoutPost({ focus: 'Legs', sets: 9, minutes: null, volume: null, prs: ['A 1', 'B 2', 'C 3'], brand: 'R' });
if (many.ok) eq(many.card.lines, ['3 New Bests', 'New Best · A 1'], 'pr count line');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('workoutShare: ok');
