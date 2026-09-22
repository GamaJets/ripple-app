// The one rule a shareable card cannot break: nothing unread goes out as zero.
import {
  workoutPost, badgePost, progressPost, scanPost, offerPost, spotsPost, joinPost,
  classesPost, promoPost, milestonePost, eventPost, slug, MAX_LINES, type PostBuild,
} from './postCard';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const refuses = (b: PostBuild, msg: string) => ok(!b.ok && b.why.length > 0, `${msg} should refuse`);
const card = (b: PostBuild) => { if (!b.ok) throw new Error(`expected a card: ${b.why}`); return b.card; };

// Empty inputs refuse rather than print a zero.
refuses(workoutPost({ focus: 'Legs', sets: 0, minutes: 50, volume: null, prs: [], brand: 'Gym' }), 'no sets');
refuses(badgePost({ name: '', meaning: 'x', brand: 'Gym' }), 'no badge');
refuses(progressPost({ what: 'Weight', change: null, since: 'Since May', brand: 'Gym' }), 'one reading');
refuses(scanPost({ improving: [], date: '1 May', brand: 'Gym' }), 'nothing improving');
refuses(spotsPost({ times: [' '], brand: 'Gym', link: null }), 'no times');
refuses(joinPost({ code: '', link: 'x', brand: 'Gym' }), 'no code');
refuses(classesPost({ classes: [], brand: 'Gym' }), 'no classes');
refuses(promoPost({ code: 'SAVE', pct: 0, brand: 'Gym' }), 'zero discount');
refuses(milestonePost({ visits: null, classes: 3, period: 'This Month', brand: 'Gym' }), 'unread visits');
refuses(milestonePost({ visits: 0, classes: 3, period: 'This Month', brand: 'Gym' }), 'zero visits');
refuses(eventPost({ title: ' ', when: 'Sat', note: '', brand: 'Gym' }), 'untitled event');

// A workout card carries its PRs and leaves unknown minutes and volume off.
const w = card(workoutPost({ focus: 'Legs', sets: 15, minutes: null, volume: null, prs: ['Leg Extension 55 kg'], brand: 'Ironworks' }));
ok(w.big?.value === '15' && w.big.unit === 'Sets', 'workout big figure');
ok(w.lines.length === 1 && w.lines[0] === 'New Best · Leg Extension 55 kg', `workout lines ${JSON.stringify(w.lines)}`);
ok(!/minutes|volume/i.test(w.lines.join(' ')), 'no unknown figures on the card');
ok(w.footer === 'Ironworks' && w.filename === 'legs-workout.png', 'footer and filename');
ok(card(workoutPost({ focus: 'Legs', sets: 1, minutes: 5, volume: null, prs: [], brand: 'G' })).big?.unit === 'Set', 'one set is singular');

// Progress splits the signed change into figure and unit.
const p = card(progressPost({ what: 'Weight', change: '−3.4 kg', since: 'Since 12 Mar', brand: 'G' }));
ok(p.big?.value === '−3.4' && p.big.unit === 'kg', 'progress figure');

// Line cap and QR.
const many = Array.from({ length: 10 }, (_, i) => ({ title: `Class ${i}`, when: `Mon ${i}:00` }));
ok(card(classesPost({ classes: many, brand: 'G' })).lines.length === MAX_LINES, 'classes capped');
const j = card(joinPost({ code: 'AB4K7M', link: 'https://repple.app/j/AB4K7M', brand: 'G' }));
ok(j.qr === 'https://repple.app/j/AB4K7M' && j.caption.includes('AB4K7M'), 'join card carries the link as a QR');
ok(card(offerPost({ name: 'Starter', price: '£120', detail: null, brand: 'G', link: null })).qr === null, 'no link, no QR');

ok(slug('  Leg Day!! ') === 'leg-day' && slug('!!!') === 'card', 'slug');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('postCard ok');
