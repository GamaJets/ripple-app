// Which pack a deadline sentence is about when a member holds more than one.
// Compile with tsc, run with node.
//
// The defect this is written against was a silence, not a wrong number: both
// client screens computed `windowed.length === 1 ? windowed[0] : null` and then
// returned early on null, so a member holding TWO closing packs — the one with
// the most at stake — was told nothing at all about either. `packDeadline` was
// built for that case and says so in its own header; nothing was calling it
// with the null coverage it was written to accept.
import { closingPack, otherWindowsNote, type WindowedPack } from './closingPack';
import { EXPIRING_SOON_DAYS } from './packExpiry';
import { packDeadline } from './packDeadline';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-03';
/** `d` days after TODAY, as the bare day a pack expires on. Built on Date.UTC
 *  parts and printed back out, so `npm run test:zones` reads the same day in
 *  Kiritimati and in Midway. */
const inDays = (d: number): string => {
  const x = new Date(Date.UTC(2026, 8, 3 + d));
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};
const pack = (expiresOn: string | null, left: number, expired?: boolean): WindowedPack =>
  (expired === undefined ? { expiresOn, left } : { expiresOn, left, expired });

/* ── nothing to say, and the two different reasons for it ──────────────── */

eq(closingPack(null, TODAY), null, 'a read that did not land chooses no pack');
eq(closingPack(undefined, TODAY), null, 'and neither does one that was never made');
eq(closingPack([], TODAY), null, 'a member holding nothing has nothing closing');
eq(closingPack([pack(null, 5)], TODAY), null, 'a pack with no window is not closing');
eq(closingPack([pack('12 Sep', 5)], TODAY), null, 'a date that will not read expires nothing');
eq(closingPack([pack(inDays(200), 5)], TODAY), null, 'a window two hundred days out is not news');
eq(closingPack([pack(inDays(-1), 5)], TODAY), null, 'a window that has already passed is expiryLine’s to narrate');
eq(closingPack([pack(inDays(2), 5, true)], TODAY), null,
  'a pack the nightly pass has already closed is not a deadline anybody can act on');

// The boundary is packExpiry's and is never re-derived here.
ok(closingPack([pack(inDays(EXPIRING_SOON_DAYS - 1), 5)], TODAY) != null,
  'inside packExpiry’s own soon window, a pack is chosen');
eq(closingPack([pack(inDays(EXPIRING_SOON_DAYS + 1), 5)], TODAY), null,
  'and outside it, none is');

/* ── one window: the diary may be counted against it ───────────────────── */

const one = closingPack([pack(inDays(4), 3)], TODAY);
eq(one?.pack.left, 3, 'the one closing pack is the one chosen');
eq(one?.attributable, true, 'with a single window, an upcoming booking can only come off that pack');
eq(one?.otherWindows, 0, 'and there are no others to mention');

/* ── two windows: the nearer one, and NO coverage claim ────────────────── */

const two = closingPack([pack(inDays(9), 4), pack(inDays(2), 1)], TODAY);
eq(two?.pack.left, 1, 'the pack that closes first is the one the sentence is about');
eq(two?.attributable, false,
  'with two windows nothing can say which pack a Thursday booking is going to spend');
eq(two?.otherWindows, 1, 'and the member is told there is another');

// A second window that is nowhere near closing still blocks attribution: it is
// still a pack the booking might be spent on. This is the case the old
// `windowed.length === 1` guard got right and the reason it is kept.
const far = closingPack([pack(inDays(2), 1), pack(inDays(300), 8)], TODAY);
eq(far?.pack.left, 1, 'the far window does not win the contest');
eq(far?.attributable, false, 'but it does stop the diary being counted as coverage');

// A pack with no window at all is not a window, and does not block anything.
const withUnexpiring = closingPack([pack(inDays(2), 1), pack(null, 8)], TODAY);
eq(withUnexpiring?.attributable, true, 'a pack that never expires is not a second window');

// One already closed by the nightly pass: it cannot draw, so it is not counted
// as a rival for the sentence — but it still carries a date, and a screen
// listing it still has to explain the nought beside it, so it is a window.
const withClosed = closingPack([pack(inDays(2), 1), pack(inDays(-30), 0, true)], TODAY);
eq(withClosed?.pack.left, 1, 'a closed pack cannot be the one at risk');

/* ── two closing on the SAME day ───────────────────────────────────────── */

const tie = closingPack([pack(inDays(3), 2), pack(inDays(3), 6)], TODAY);
eq(tie?.pack.left, 6, 'on the same day, the bigger balance is the one named');
eq(tie?.attributable, false, 'and coverage is still not claimed');

/* ── the sentence that says this is one pack of several ────────────────── */

eq(otherWindowsNote(0), null, 'a member with one pack is not told there are no others');
eq(otherWindowsNote(-1), null, 'nor is a count that cannot be right printed');
ok((otherWindowsNote(1) ?? '').includes('one other pack'), 'one other is written as one');
ok((otherWindowsNote(3) ?? '').includes('3 other packs'), 'and three as three');

/* ── the whole point: two closing packs now produce a sentence ─────────── */

const lines = [pack(inDays(9), 4), pack(inDays(2), 3)];
const chosen = closingPack(lines, TODAY);
const said = packDeadline({
  left: chosen?.pack.left ?? null,
  expiresOn: chosen?.pack.expiresOn ?? null,
  today: TODAY,
  // Null, never a count and never zero: zero is what produces 'covered'.
  bookedByThen: chosen?.attributable ? 0 : null,
});
eq(said.kind, 'unknown', 'two closing packs are told about the nearer deadline');
ok(typeof said.text === 'string' && said.text.length > 0, 'and there is a sentence to print');
ok(!/nothing here is going to be lost/i.test(said.text ?? ''),
  'and it never claims the diary covers a pack nothing can attribute a booking to');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('closingPack: ok — the pack that closes first is named, and coverage is claimed only when it can be');
