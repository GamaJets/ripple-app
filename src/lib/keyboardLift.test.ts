// Tests for `liftFor` — the arithmetic that keeps a compose bar above the
// keyboard.
//
// This is tested rather than eyeballed because the bug it replaces was itself
// invisible to eyeballing: KeyboardAvoidingView lifted the bar MOST of the way,
// which looks like a working screen until you notice the line you are typing is
// under the keyboard. A screenshot of "nearly right" and a screenshot of "right"
// differ by about eighty points, and the difference is a header height that
// changes between screens.
import { liftFor } from './keyboardLift';

let errors = 0;
function ok(what: string, cond: boolean) {
  if (!cond) { console.error('FAIL: ' + what); errors++; }
}
function eq(what: string, got: unknown, want: unknown) {
  if (got !== want) { console.error(`FAIL: ${what} — got ${String(got)}, want ${String(want)}`); errors++; }
}

// iPhone 17 Pro in points, which is what the simulator this was found on
// reports. The numbers below are that device, not invented ones.
const WINDOW_H = 874;
const KEYBOARD_H = 336;      // keyboard + accessory strip
const KEYBOARD_TOP = WINDOW_H - KEYBOARD_H;   // 538
const BAR_H = 62;

/* ── the reported bug ─────────────────────────────────────────────────────── */

// A compose bar docked at the bottom of a screen that has a tab bar under it.
// Nothing lifted yet.
{
  const TAB_BAR = 83;
  const barY = WINDOW_H - TAB_BAR - BAR_H;   // 729
  const got = liftFor({ barY, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP });
  eq('an unlifted bar rises by its own overlap with the keyboard', got, 253);
  // And the whole point: the bar's bottom now sits exactly on the keyboard's
  // top edge, not eighty points under it.
  eq('after lifting, the bar bottom meets the keyboard top', barY + BAR_H - (got ?? 0), KEYBOARD_TOP);
}

/* ── the property that makes it safe to call on every event ───────────────── */

// The measurement is taken while the previous lift is applied. Feeding the
// result back must return the same number. Without adding `applied` back the
// bar would climb 253 points per keyboard event until it left the screen.
{
  const TAB_BAR = 83;
  const rest = WINDOW_H - TAB_BAR - BAR_H;
  const seen: number[] = [];
  let lift = 0;
  for (let i = 0; i < 6; i++) {
    const measuredY = rest - lift;   // where measureInWindow finds it now
    lift = liftFor({ barY: measuredY, barHeight: BAR_H, applied: lift, keyboardScreenY: KEYBOARD_TOP }) ?? -1;
    seen.push(lift);
  }
  // STABILITY, not the last value. Checking only the final number passes a
  // version that oscillates 253 → 0 → 253 and happens to be sampled on an odd
  // step — which is exactly what dropping `applied` produces, and exactly the
  // bar flickering between the right place and behind the keyboard on every
  // keystroke. Every step after the first must be the same number.
  eq('the first event lifts it', seen[0], 253);
  ok('and every event after that leaves it exactly where it is: ' + seen.join(','),
    seen.every((v) => v === seen[0]));
}

/* ── the header shortfall, stated as a number ─────────────────────────────── */

// What KeyboardAvoidingView computed on the same screen: `frame` in PARENT
// coordinates against `screenY` in window coordinates. The parent starts below
// a navigator header, so its answer is short by exactly that header.
{
  const HEADER = 100;
  const TAB_BAR = 83;
  const sceneH = WINDOW_H - HEADER - TAB_BAR;
  const kavFrameY = 66;                       // KAV below the screen's own header row
  const kavBottomInParent = kavFrameY + (sceneH - kavFrameY);
  const kavAnswer = Math.max(0, kavBottomInParent - KEYBOARD_TOP);
  const measured = liftFor({
    barY: WINDOW_H - TAB_BAR - BAR_H, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP,
  }) ?? -1;
  eq('the old computation falls short by exactly the header height', measured - kavAnswer, HEADER);
  ok('and it fell short rather than over-lifting, which is why it looked nearly right', kavAnswer < measured);
}

/* ── hiding ───────────────────────────────────────────────────────────────── */

// On iOS `keyboardWillChangeFrame` fires for the hide too, reporting the top
// edge as the bottom of the window. That must come out as zero on its own,
// because there is no second listener to say so.
{
  const TAB_BAR = 83;
  const rest = WINDOW_H - TAB_BAR - BAR_H;
  eq('a keyboard at the bottom of the window means no lift',
    liftFor({ barY: rest - 253, barHeight: BAR_H, applied: 253, keyboardScreenY: WINDOW_H }), 0);
}

// A bar that is already above the keyboard asks for nothing. A negative number
// here would be applied as padding and push it DOWN behind the keyboard.
{
  eq('a bar clear of the keyboard is left alone',
    liftFor({ barY: 100, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP }), 0);
  const got = liftFor({ barY: 100, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP }) ?? -1;
  ok('and never negative', got >= 0);
}

/* ── what is not a measurement ────────────────────────────────────────────── */

// `null`, not 0. "I could not measure" and "no lift needed" are different
// answers, and collapsing them drops the bar to its resting place mid-typing.
{
  eq('an unlaid-out view (zero height) is not a measurement',
    liftFor({ barY: 0, barHeight: 0, applied: 0, keyboardScreenY: KEYBOARD_TOP }), null);
  eq('NaN from the platform is not a measurement',
    liftFor({ barY: NaN, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP }), null);
  eq('an infinite keyboard edge is not a measurement',
    liftFor({ barY: 700, barHeight: BAR_H, applied: 0, keyboardScreenY: Infinity }), null);
  eq('a negative height is not a measurement',
    liftFor({ barY: 700, barHeight: -1, applied: 0, keyboardScreenY: KEYBOARD_TOP }), null);
}

/* ── every screen shape the app actually has ──────────────────────────────── */

// The three chat screens differ in header and tab bar, which is exactly why a
// constant offset could not serve all of them. The measured answer must put the
// bar on the keyboard's edge in every one.
{
  const shapes: [string, number, number][] = [
    ['client Messages: navigator header + tab bar', 100, 83],
    ['trainer Chat: no header, tab bar', 0, 83],
    ['AI Coach: navigator header, tab bar', 100, 83],
    ['a sheet with neither', 0, 0],
    ['landscape-ish: short keyboard, no header', 0, 49],
  ];
  for (const [name, , tabBar] of shapes) {
    const barY = WINDOW_H - tabBar - BAR_H;
    const got = liftFor({ barY, barHeight: BAR_H, applied: 0, keyboardScreenY: KEYBOARD_TOP }) ?? -1;
    eq(`${name}: the bar ends level with the keyboard`, barY + BAR_H - got, KEYBOARD_TOP);
  }
}

if (errors) { console.error(`keyboardLift: ${errors} failure(s)`); process.exit(1); }
console.log('keyboardLift: ok (converges, never negative, shortfall measured at one header)');
