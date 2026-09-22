// A remembered filter comes back only if it is still a choice on the screen.
// Compile with tsc, run with node.
import { parseStickyChoice, stickyChoiceKey, STICKY_CHOICE_PREFIX } from './stickyChoice';
import { PERSONAL_DEVICE_KEYS, KEPT_ON_SIGN_OUT, ACCOUNT_SCOPED_PREFIXES } from './signOutState';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const RANGES = ['1M', '3M', '6M', '1Y'] as const;

/* ── parsing ────────────────────────────────────────────────────────────── */

eq(parseStickyChoice('3M', RANGES), '3M', 'a stored choice that is still offered comes back');
eq(parseStickyChoice('1Y', RANGES), '1Y', 'including the last one');
eq(parseStickyChoice('2Y', RANGES), null, 'a range this build no longer offers does not');
eq(parseStickyChoice('3m', RANGES), null, 'nor a differently-spelled one');
eq(parseStickyChoice('"3M"', RANGES), null, 'nor a JSON-quoted one');
eq(parseStickyChoice('', RANGES), null, 'an empty write is nothing');
eq(parseStickyChoice(null, RANGES), null, 'a missing key is nothing');
eq(parseStickyChoice(undefined, RANGES), null, 'nor is undefined');
eq(parseStickyChoice('3M', [] as readonly string[]), null, 'no choices, no match');

/* ── keys ───────────────────────────────────────────────────────────────── */

const k = stickyChoiceKey('progress.range');
ok(k.startsWith(STICKY_CHOICE_PREFIX) && k.endsWith('progress.range'), 'the key is namespaced');
ok(stickyChoiceKey('a') !== stickyChoiceKey('b'), 'two screens do not share one');

/* ── a view preference, not a person's: sign-out does not touch it ─────── */

ok(!PERSONAL_DEVICE_KEYS.some((x) => x.startsWith(STICKY_CHOICE_PREFIX)), 'not on the sign-out clear list');
ok(!KEPT_ON_SIGN_OUT.some((x) => x.startsWith(STICKY_CHOICE_PREFIX)), 'nor on the keep list — it needs no promise either way');
ok(ACCOUNT_SCOPED_PREFIXES.every((p) => !STICKY_CHOICE_PREFIX.startsWith(p)), 'and it is its own prefix');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('stickyChoice: ok');
