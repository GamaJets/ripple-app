// The one rule a shareable card cannot break: nothing unread goes out as zero.
import {
  workoutPost, cardioPost, badgePost, streakPost, liftPost, progressPost, scanPost, offerPost, spotsPost, joinPost,
  classesPost, promoPost, withInvite, milestonePost, eventPost, slug, MAX_LINES, type PostBuild,
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

refuses(streakPost({ days: 0, best: 12, brand: 'G' }), 'no streak');
refuses(liftPost({ lift: 'Bench', figure: '', unit: 'kg', brand: 'G' }), 'unread lift');
ok(card(streakPost({ days: 12, best: 12, brand: 'G' })).lines[0] === 'My Best Ever', 'streak at its best');

refuses(cardioPost({ activity: 'Run', minutes: 0, distance: null, kcal: null, brand: 'G' }), 'no minutes');
ok(card(cardioPost({ activity: 'Run', minutes: 30, distance: '5.2 km', kcal: 0, brand: 'G' })).lines.join('|') === '5.2 km', 'zero kcal left off');

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

const inv = withInvite(w, 'https://repple.app/join?r=TIM4K9');
ok(inv.qr === 'https://repple.app/join?r=TIM4K9' && inv.caption.endsWith('https://repple.app/join?r=TIM4K9') && inv.lines[inv.lines.length - 1] === 'Scan to Train With Me', 'invite added');
ok(withInvite(w, null) === w && withInvite(j, 'https://x') === j, 'no link, or a card with its own QR, is untouched');
ok(slug('  Leg Day!! ') === 'leg-day' && slug('!!!') === 'card', 'slug');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('postCard ok');
