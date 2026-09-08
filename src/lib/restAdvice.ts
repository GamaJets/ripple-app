// What the rest-day screen is entitled to say once it has looked at the
// recovery data as well as the training log.
//
// ── The screen this is for, and what it was doing without it ──────────────
//
// `app/(client)/restday.tsx` answers one question — should I train today — and
// until now it answered it from the training log alone. Its own header records
// the cost: "the screen told a client who had trained six days straight that
// they were 'well recovered' with 'room to train'", because an unread log
// infers beautifully. That half is already fixed there: an unread log is
// refused rather than treated as an empty one.
//
// What was left is the other half. The log is only ever a count of sessions.
// `src/lib/readiness.ts` builds a figure out of sleep, the device's own
// recovery verdict, hydration and short-term load, `src/ui/readiness.ts` is the
// one derivation every other screen reads it from — and the screen whose whole
// job is to say "stop" was the one screen that never called it. A member three
// nights into four hours' sleep, who happened to have trained twice this week,
// was told they had room to train, by a screen that had a figure available
// saying otherwise and did not look.
//
// ── The words this file will not use ──────────────────────────────────────
//
// Not "recovered", not "ready", not "fresh", about a body. `src/lib/
// muscleRecovery.ts` makes the argument in full and it applies here without
// modification: those words are a claim about a person, they depend on things
// this app does not measure, and the person reading one may train through
// genuine injury because a screen told them they were ready. `readinessScore`
// carries a `label` of 'Well Recovered' and a `tip` of "Great day to push";
// neither is printed by this file or by the screen that calls it, and that is
// the reason.
//
// What is said instead is what was MEASURED and how long ago: a score, the
// signals behind it, and the number of nights it averages over. Those are
// facts a member can check against their own watch. "You are recovered" is not.
//
// ── Why the four silences are four sentences ──────────────────────────────
//
// A missing readiness figure is not one thing. Nobody has connected anything;
// we asked and could not read it; a device is connected and has recorded
// nothing yet; and — the one it is easiest to collapse into the others — the
// score is genuinely there. `readinessBreakdown` already refuses to fold these
// together one layer down, for the reason written on it: every signal in the
// scale can only ever count AGAINST the member, so a signal that went unread
// can only have flattered them. On this screen that asymmetry is the whole
// point. "We could not read your sleep" is not "you slept well", and on a rest
// day screen the difference is the difference between a caveat and a green
// light.
//
// Pure, and tested in restAdvice.test.ts. No React and no providers: the screen
// collects the state and hands it over, exactly as src/ui/readiness.ts does for
// the score itself.
import type { LoadStatus } from '../ui/loadStatus';

/**
 * The score below which this screen suggests a rest day on the strength of the
 * signals alone.
 *
 * 50, which is the boundary `readinessScore` itself uses between its
 * 'moderate' and 'low' tones — named here rather than typed as a literal so
 * that the screen and the score cannot come to disagree about where "low"
 * starts. It is the same band whose own tip reads "Prioritise sleep, water and
 * a lighter session or rest today", so acting on it here is carrying out what
 * the score already says rather than inventing a second opinion.
 */
export const REST_ON_READINESS_BELOW = 50;

/**
 * What this screen knows about the member's readiness figure.
 *
 *   'scored'   there is a figure, and `note` says what it is made of.
 *   'reading'  a source is still in flight. Not an answer yet, and it must not
 *              be drawn as one.
 *   'unread'   we asked and could not read it. THE ONE THAT MATTERS, for the
 *              reason in the header: an unread signal can only have flattered
 *              the member, so this state may be hiding the argument for rest.
 *   'awaiting' read fine, and a connected device has genuinely recorded
 *              nothing in the window yet. Nothing is broken.
 *   'none'     nothing is connected and no night is logged. Nothing is broken
 *              here either, and telling this member their devices failed would
 *              invent a fault they do not have.
 */
export type RestReadinessState = 'scored' | 'reading' | 'unread' | 'awaiting' | 'none';

export interface RestReadinessRead {
  state: RestReadinessState;
  /** The figure, or null. Rounded, 0–100. */
  score: number | null;
  /**
   * One sentence: what the figure is made of, or why there is not one.
   * Sentence case, ending in a full stop — it is printed on its own.
   */
  note: string;
  /**
   * True when a figure that could only have argued for MORE rest may be
   * missing — either the read failed outright, or it came back short.
   *
   * Deliberately false for 'awaiting' and 'none'. Nothing is missing when a
   * member owns no watch, and warning them about it teaches them to ignore the
   * warning on the days it means something.
   */
  mayBeMissing: boolean;
}

export interface RestReadinessInput {
  /** From `useReadiness().readiness` — null when there was nothing honest to
   *  compute it from. */
  score: number | null;
  /** How many nights the sleep average behind the score was taken over. */
  nights: number;
  /** How far back that window was allowed to reach — READINESS_NIGHTS. */
  windowNights: number;
  /** `readinessBreakdown`'s own status: how complete the read behind it was. */
  status: LoadStatus;
  /** `readinessBreakdown`'s absence sentence, or null when there is a score. */
  absence: string | null;
  /** `readinessMadeOf(readiness)` — "Scored from your sleep and recent
   *  sessions". Empty when there is no score. */
  madeOf: string;
  /**
   * Whether any wearable is connected at all, or **null while nothing has been
   * looked at yet**.
   *
   * Null is not false. `src/ui/wearables.tsx` holds an empty states map until
   * the provider has looked, and reading that emptiness as "no watch is
   * connected" is the defect app/(client)/dashboard.tsx records having shipped:
   * it told a client with a live WHOOP token exactly that.
   */
  deviceConnected: boolean | null;
  /** The training log's own read, because a truncated log withholds the score
   *  for a reason that is not a failure and should not be named as one. */
  logStatus: LoadStatus;
}

/** "over 2 of the last 3 nights" / "over the last 3 nights". */
function nightSpan(nights: number, windowNights: number): string {
  const w = Math.max(1, Math.round(windowNights));
  const n = Math.max(0, Math.round(nights));
  if (n >= w) return `over the last ${w} night${w === 1 ? '' : 's'}`;
  return `over ${n} of the last ${w} night${w === 1 ? '' : 's'}`;
}

/**
 * The readiness figure as this screen is allowed to state it.
 *
 * The scored sentence carries the span on purpose. A score built from one night
 * and a score built from three are different claims and the number cannot tell
 * them apart — which is the argument `readinessMadeOf` already makes about the
 * SIGNALS, extended to the nights, because on a rest-day screen "we averaged
 * one night" is exactly the caveat somebody needs before acting on it.
 */
export function restReadinessRead(i: RestReadinessInput): RestReadinessRead {
  const s = i.score;
  if (s != null && Number.isFinite(s)) {
    const made = i.madeOf.trim().replace(/\.$/, '');
    return {
      state: 'scored',
      score: Math.round(s),
      note: made ? `${made}, ${nightSpan(i.nights, i.windowNights)}.` : `Scored ${nightSpan(i.nights, i.windowNights)}.`,
      // A score standing over a short read is still a score, and it is still
      // missing whatever the failed source would have contributed.
      mayBeMissing: i.status === 'partial',
    };
  }

  // No figure. Which absence it is decides what the member does next — and,
  // above, what this screen is entitled to conclude from its silence.
  if (i.logStatus === 'partial') {
    // Not a failure, and not the member's doing either. `useReadiness` gates
    // the training-load signal on `isWhole`, so a truncated log withholds the
    // score exactly as an unreadable one does — but `readinessBreakdown` has
    // no way to tell the two apart and says "could not be read", which names
    // the wrong problem on a screen that has already explained the right one.
    return {
      state: 'unread',
      score: null,
      note: 'There is no readiness figure while your training log is read in parts, because a score built on half a log is not a smaller version of one built on all of it.',
      mayBeMissing: true,
    };
  }
  if (i.status === 'loading') {
    return {
      state: 'reading',
      score: null,
      note: i.absence ?? 'Still reading your sleep and your devices…',
      mayBeMissing: false,
    };
  }
  if (i.status === 'error') {
    return {
      state: 'unread',
      score: null,
      note: i.absence ?? 'We could not read the signals behind your readiness, so there is no figure to show — it does not mean you slept well.',
      mayBeMissing: true,
    };
  }
  if (i.deviceConnected == null) {
    // We have not established what is connected yet, so neither of the two
    // remaining sentences can be said honestly: one invents a fault and the
    // other invents a device.
    return {
      state: 'reading',
      score: null,
      note: 'Still checking which of your devices are connected…',
      mayBeMissing: false,
    };
  }
  if (i.deviceConnected) {
    return {
      state: 'awaiting',
      score: null,
      note: i.absence ?? `Your devices are connected and nothing has come back for the last ${Math.max(1, Math.round(i.windowNights))} nights yet.`,
      mayBeMissing: false,
    };
  }
  return {
    state: 'none',
    score: null,
    note: i.absence ?? 'Log a night of sleep, or connect a watch, to see your readiness.',
    mayBeMissing: false,
  };
}

/**
 * What this screen is calling it.
 *
 *   'unknown' the training log is not whole, so nothing here is a judgement.
 *   'deload'  a run of hard weeks, from `deloadCheck`.
 *   'rest'    a rest day is suggested today.
 *   'room'    the log is light and nothing measured argues against training.
 */
export type RestCall = 'unknown' | 'deload' | 'rest' | 'room';

/** Which evidence is asking for the rest day. Null when none is. */
export type RestBecause = 'load' | 'signals' | 'both';

export interface RestAdvice {
  call: RestCall;
  because: RestBecause | null;
  /** The one line at the top of the screen. */
  headline: string;
  /** The paragraph under it. Says what was measured, never how a body is. */
  body: string;
}

export interface RestAdviceInput {
  /** The training log's read. `isWhole` is applied here, once. */
  logStatus: LoadStatus;
  /** From `deloadCheck`. */
  deloadDue: boolean;
  deloadReason: string;
  /** Days trained in the ROLLING last seven — `weekStats`, not the calendar
   *  week, which is what the figure under "This Week" is captioned as. */
  weekDays: number;
  trainedToday: boolean;
  /** The readiness read, as `restReadinessRead` classified it. */
  readiness: RestReadinessRead;
}

/** "4 training days" / "1 training day". */
const dayCount = (n: number): string => `${n} training day${n === 1 ? '' : 's'}`;

/**
 * The clause about readiness that goes on the end of a body which is already
 * making its case from the log.
 *
 * Empty for 'awaiting' and 'none': there is nothing to add, and a sentence
 * added for the sake of symmetry would be a member being told about a device
 * they do not own every time they open this screen.
 */
function readinessClause(r: RestReadinessRead): string {
  if (r.state === 'scored' && r.score != null) return ` Your readiness score is ${r.score} out of 100.`;
  if (r.state === 'unread') {
    // The direction matters and is stated. Every signal readiness scores can
    // only count against the member, so the figure we could not see can only
    // have argued for more rest than the log did — never for less.
    return ' Your readiness score could not be read, and a figure we could not see can only ever have argued for more rest, not less.';
  }
  return '';
}

/**
 * Whether to rest, and the sentence explaining it.
 *
 * The load rule is unchanged — four of the last seven days trained, and trained
 * today already. What is new is that a low readiness score reaches the same
 * conclusion on its own. A member two sessions into a week who has slept four
 * hours a night for three nights was previously told they had room to train,
 * by a screen holding a figure that said the opposite.
 *
 * The opposite direction is deliberately NOT symmetrical. A high score never
 * overrides the load rule and never turns into an encouragement to push: the
 * strongest thing said in the 'room' case is what the figure is and what it was
 * built from. A number that can talk somebody out of a rest day is a number
 * this app has not earned.
 */
export function restAdvice(i: RestAdviceInput): RestAdvice {
  // `isWhole` and nothing weaker. 'partial' and 'loading' both make this screen
  // invent its answer, which is what its own header is a record of.
  if (i.logStatus !== 'ready') {
    const headline = i.logStatus === 'loading' ? 'Reading your training log'
      : i.logStatus === 'partial' ? 'More training than this screen can read at once'
      : 'We couldn’t read your training log';
    const body = i.logStatus === 'loading'
      ? 'This screen works from what you have logged and what your devices have measured, and it is still coming back. Nothing here is a judgement about your recovery yet — read it as blank, not as a green light to train.'
      : i.logStatus === 'partial'
      ? 'This screen works from what you have logged, and you have logged more than it can read in one go. Counting consecutive hard weeks against a history that stops part-way through would put a wall where your training carried on, so it says nothing rather than the wrong thing.'
      : 'This screen works from what you have logged, and we could not read it. Nothing here is a judgement about your recovery — read it as blank, not as a green light to train.';
    return { call: 'unknown', because: null, headline, body };
  }

  const r = i.readiness;
  const low = r.state === 'scored' && r.score != null && r.score < REST_ON_READINESS_BELOW;

  if (i.deloadDue) {
    return {
      call: 'deload',
      because: null,
      headline: 'Time for a deload week',
      // The score is appended only when it agrees. A high figure printed under
      // "time for a deload" is an argument against the advice above it, made by
      // a number built from three nights of sleep, and this screen would then
      // be holding both sides of the case at once.
      body: low && r.score != null
        ? `${i.deloadReason} Your readiness score is ${r.score} out of 100 as well.`
        : i.deloadReason,
    };
  }

  const heavy = i.weekDays >= 4 && i.trainedToday;
  if (heavy || low) {
    const because: RestBecause = heavy && low ? 'both' : heavy ? 'load' : 'signals';
    const body = because === 'both' && r.score != null
      ? `You've trained ${i.weekDays} of the last 7 days, and your readiness score is ${r.score} out of 100. Both point the same way: a rest day now protects your progress and lowers injury risk.`
      : because === 'load'
      ? `You've trained ${i.weekDays} of the last 7 days. A rest day now protects your progress and lowers injury risk.${readinessClause(r)}`
      : `Your readiness score is ${r.score} out of 100. Your training log alone would have said you had room — ${dayCount(i.weekDays)} in the last 7 — but the score is built from what was actually measured, and it is the one with a night behind it.`;
    return { call: 'rest', because, headline: 'Take a rest day', body };
  }

  // Room to train. The figure is stated and nothing is concluded from it about
  // the member's body — see the header on the three words this file will not
  // say. `readinessScore`'s own tip in this band is "Great day to push"; it is
  // not printed here, because a screen whose job is to say stop should not be
  // the one telling somebody to go harder.
  const light = `${dayCount(i.weekDays)} in the last 7 — that is light by volume alone.`;
  const tail = r.state === 'scored' && r.score != null
    ? ` Your readiness score is ${r.score} out of 100, and it is a measurement rather than a promise about how today will feel.`
    : r.state === 'unread'
    ? ' Your readiness score could not be read, and a figure we could not see can only ever have argued for more rest, not less — so treat this as your training log and nothing more.'
    : r.state === 'reading'
    ? ' Your readiness score is still being read, so this is your training log and nothing else so far.'
    : r.state === 'awaiting'
    ? ' Your devices have not recorded a night for this yet, so this is your training log and nothing else.'
    : ' This is your training log and nothing else: no night is logged and no watch is connected, so nothing here has looked at your sleep.';
  return { call: 'room', because: null, headline: 'You have room to train', body: `${light}${tail}` };
}
