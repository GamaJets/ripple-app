// The number a coach rings when a client is on the floor, and the ones that
// only look like numbers.
//
// What is defended here: a screen may offer to DIAL something only when it can
// actually be dialled. The failure this replaces is silent in both directions —
// an emergency contact rendered as un-tappable text, and a tap that opens a
// dialler on an Instagram handle, which the coach discovers after tapping.
import { telUrl, isDialable, DIAL_UNAVAILABLE_NOTE, MIN_DIAL_DIGITS, MAX_DIAL_DIGITS } from './dialling';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── numbers as people actually write them ──────────────────────────────── */

eq(telUrl('07700 900123'), 'tel:07700900123', 'spaces are separators, not part of the number');
eq(telUrl('+44 7700 900123'), 'tel:+447700900123', 'a leading + is a country code and is kept');
eq(telUrl('(020) 7946-0000'), 'tel:02079460000', 'brackets and dashes come out');
eq(telUrl('020.7946.0000'), 'tel:02079460000', 'and dots');
eq(telUrl('  +1 415 555 0132  '), 'tel:+14155550132', 'surrounding space does not defeat it');
eq(telUrl('+1–415–555–0132'), 'tel:+14155550132', 'an en dash is still a separator');

/* ── and the things that are not numbers ────────────────────────────────── */

eq(telUrl(null), null, 'nothing is not a number');
eq(telUrl(''), null, 'nor is an empty string');
eq(telUrl('   '), null, 'nor is whitespace');
eq(telUrl('@zoetrains'), null, 'an Instagram handle is never offered as a call');
eq(telUrl('zoe@example.com'), null, 'and neither is an email address');
eq(telUrl('ask her sister'), null, 'nor a sentence somebody typed into the box');
eq(telUrl('020 7946 0000 x214'), null,
  'an extension is refused rather than dialled with the extension welded on');
eq(telUrl('07700 900123 (mum)'), null,
  'a number with a note beside it is not dialled with the note silently dropped');

/* ── the length bounds, at their edges ──────────────────────────────────── */

eq(telUrl('123456'), null, 'six digits is a room extension, not a subscriber number');
eq(telUrl('1234567'), 'tel:1234567', `and ${MIN_DIAL_DIGITS} is the shortest that is`);
eq(telUrl('123456789012345'), 'tel:123456789012345', `${MAX_DIAL_DIGITS} digits is the E.164 ceiling`);
eq(telUrl('1234567890123456'), null, 'one past it is somebody’s account id in the wrong box');

/* ── the guard and the URL agree, always ────────────────────────────────── */

for (const v of ['07700 900123', '@zoe', '', null, 'ask her sister', '+44 7700 900123', '12345']) {
  eq(isDialable(v), telUrl(v) != null, `the guard and the URL agree about ${JSON.stringify(v)}`);
}

// Whatever comes out is something a dialler can be handed, and nothing else.
for (const v of ['07700 900123', '+44 (0)7700 900-123', '415.555.0132']) {
  const url = telUrl(v);
  ok(!!url && /^tel:\+?\d+$/.test(url), `${v} becomes a clean tel: URL`);
}

/* ── the sentence for a phone that would not dial ───────────────────────── */

ok(!/failed|error/i.test(DIAL_UNAVAILABLE_NOTE), 'nothing was called, so nothing "failed"');
ok(/number is on the screen/i.test(DIAL_UNAVAILABLE_NOTE),
  'and the coach is told where the number still is, because they need it now');

if (errors.length) {
  console.error(`dialling.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('dialling.test.ts — ok: a number is offered as a call only when it is one');
