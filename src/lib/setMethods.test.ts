import { badgeFor, countsToVolume, DEFAULT_METHOD, methodFor, restAfter, SET_METHODS } from './setMethods';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};

// ── The catalogue itself ──────────────────────────────────────────────────
ok(SET_METHODS.length >= 12, 'the catalogue covers more than the four the other app offers');
eq(SET_METHODS.filter((m) => m.id === DEFAULT_METHOD).length, 1, 'exactly one default');
eq(SET_METHODS[0].id, DEFAULT_METHOD, 'the default is offered first');

// Ids are what get STORED in programmes on people's phones, so a duplicate or
// a renamed one is a data bug, not a cosmetic one.
eq(new Set(SET_METHODS.map((m) => m.id)).size, SET_METHODS.length, 'ids are unique');
eq(new Set(SET_METHODS.map((m) => m.label)).size, SET_METHODS.length, 'labels are unique');
ok(SET_METHODS.every((m) => m.short.length > 0 && m.short.length <= 2), 'every badge is one or two characters');
ok(SET_METHODS.every((m) => m.blurb.trim().length > 0), 'every method says what it means');
// Sentence case, matching what check:caps enforces on screen labels.
ok(SET_METHODS.every((m) => m.label === m.label[0].toUpperCase() + m.label.slice(1)), 'labels are sentence case');
ok(SET_METHODS.every((m) => m.label.slice(1) !== m.label.slice(1).toUpperCase()), 'no label shouts');

// ── Volume: the field that stops a lie on the progress chart ──────────────
ok(!countsToVolume('warmup'), 'a warm-up is not training volume');
ok(!countsToVolume('cooldown'), 'a cool-down is not training volume');
ok(countsToVolume('drop'), 'a drop set is');
ok(countsToVolume('failure'), 'a set to failure is');
ok(countsToVolume(null), 'an unset method counts, because it means an ordinary set');

// ── Rest ──────────────────────────────────────────────────────────────────
eq(restAfter('normal', 90), 90, 'an ordinary set rests for the exercise rest');
eq(restAfter('drop', 90), 0, 'a drop set does not rest — that is what makes it one');
eq(restAfter('restpause', 90), 15, 'rest-pause overrides with its own fifteen seconds');
eq(restAfter('cluster', 300), 15, 'and the override ignores a long exercise rest');
eq(restAfter('normal', 0), 0, 'no rest configured means no rest');
eq(restAfter('normal', -5), 0, 'a negative rest is floored, never handed to a countdown');
eq(restAfter('normal', 90.6), 91, 'a fractional rest is rounded, not truncated into a stray millisecond');

// ── An unknown id is a NEWER programme, not a broken one ──────────────────
eq(methodFor('myotatic-crunch-2029').method.id, DEFAULT_METHOD, 'an unknown method falls back to normal');
ok(!methodFor('myotatic-crunch-2029').known, 'and says it was not recognised');
ok(methodFor('drop').known, 'a known one says so');
ok(!methodFor(undefined).known, 'undefined is not a known method');
eq(restAfter('myotatic-crunch-2029', 90), 90, 'an unknown method still rests, rather than silently not');

// ── Badges mark the exception, not every row ──────────────────────────────
eq(badgeFor('normal'), null, 'an ordinary set carries no badge');
eq(badgeFor(null), null, 'nor does an unset one');
eq(badgeFor('myotatic-crunch-2029'), null, 'nor does an unrecognised one — never a badge nobody can read');
eq(badgeFor('warmup'), { short: 'W', label: 'Warm-up' }, 'a warm-up is marked');
eq(badgeFor('drop'), { short: 'D', label: 'Drop set' }, 'so is a drop set');

if (errors.length) { errors.forEach((e) => console.error('FAIL', e)); process.exit(1); }
console.log(`setMethods ok — ${SET_METHODS.length} methods, and warm-ups stay out of the volume chart`);
