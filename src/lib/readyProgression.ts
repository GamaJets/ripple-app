// Today's readiness, against what the plan was going to ask for.
//
// ── The opening this fills ────────────────────────────────────────────────
//
// Every strength logger in this category adapts on LOGGED PERFORMANCE — what
// you lifted last time — which is a lagging indicator: it can only notice a bad
// week after the bad week. Fitbod goes further and explicitly refuses HRV,
// sleep and readiness as programming inputs even when a device supplies them.
// Whoop measures recovery superbly and cannot program a lifting session.
//
// Repple already owns both halves and joined neither. `readiness.ts` produces a
// transparent 0–100 from sleep, the device's own recovery verdict, hydration and
// recent load, and says what it is made of; `progression.ts` decides whether to
// add load, chase reps, hold or deload. This is the one line between them.
//
// ── The rule that makes it honest: it only ever TEMPERS ───────────────────
//
// A high readiness score is NOT evidence that somebody can lift more. It is
// four signals about sleep, a wearable's own verdict, water and recent
// training — none of which measures strength, and none of which knows what
// happened in the session that has not started yet. So a good score changes
// nothing at all, and the suggestion stands exactly as `suggestProgression`
// made it.
//
// A low score does not assert a cause either. It does not say "you are not
// recovered" — that is a medical claim this app has no standing to make, and
// `muscleRecovery.ts` refuses the same word for the same reason. What it says
// is what was measured: the signals behind today's score are low, and the plan
// was about to ask for more than last time.
//
// One direction only, and the asymmetry is the point. Tempering a session that
// did not need it costs a member one workout of progress. Adding load on a
// score that cannot see strength costs them a failed set under a loaded bar.
//
// ── And it is never silent ───────────────────────────────────────────────
//
// A suggestion that quietly differs from what the progression rule produced is
// indistinguishable from a broken progression rule. Every change carries the
// sentence that caused it, naming the score and what the score was built from,
// so a member who disagrees can see precisely what the app was reading and
// ignore it. `ProgressionTip.rationale` is left intact and the note is
// separate — overwriting the rationale would destroy the reason the plan
// existed, which is the half the member is actually trying to follow.
import type { ProgressionTip, ProgressAction } from './progression';
import type { Readiness } from './readiness';

/** What readiness did to today's suggestion. */
export type Temper =
  /** Nothing. No reading, a good one, or a suggestion already at its gentlest. */
  | 'as-planned'
  /** Was going to add load; hold the load and chase reps instead. */
  | 'hold-load'
  /** Was going to ask for more; repeat last session instead. */
  | 'repeat-last';

export interface TemperedTip {
  /** The suggestion to follow. Identical to the input unless `temper` says
   *  otherwise — never a new exercise, never a heavier load. */
  tip: ProgressionTip;
  temper: Temper;
  /** Why it differs from the plan, or null when it does not. Always present
   *  when `temper` is not 'as-planned', because a silent change is worse than
   *  no change. */
  note: string | null;
}

/** The gentlest action, which nothing here may make gentler. A deload is
 *  already a lighter week and tempering it twice would compound. */
const ALREADY_GENTLE: ProgressAction[] = ['hold', 'deload'];

/**
 * How the score gets described.
 *
 * The figure AND what it was built from, because `Readiness.from` exists
 * precisely so an 83 from sleep and training alone can be told apart from an 83
 * from all four — and a member deciding whether to ignore this needs to know
 * which they are looking at. `confidence: 'partial'` says the scale was
 * rescaled around a missing signal, which is a weaker basis for changing
 * somebody's session and is said out loud rather than hidden.
 */
function basis(r: Readiness): string {
  const made = r.from.join(', ');
  return r.confidence === 'partial'
    ? `today's readiness is ${r.score} from ${made} — one signal was not recorded, so that is a partial reading`
    : `today's readiness is ${r.score}, from ${made}`;
}

/**
 * Temper one progression suggestion by today's readiness.
 *
 * `readiness` null means there is no reading — no device, no sleep logged, or a
 * read that failed — and then this returns the suggestion untouched with no
 * note. An app that cannot measure readiness must not imply it did.
 */
export function temperByReadiness(
  tip: ProgressionTip,
  readiness: Readiness | null | undefined,
  /**
   * `tip.lastWeight` already rendered in the READER's own unit.
   *
   * Passed in rather than formatted here, because this module holds
   * kilograms — what the database stores — and `clients.weight_unit` is
   * nullable, where NULL means never chosen rather than kilograms. A "kg"
   * typed into a sentence in here is a unit nobody picked, put in front of a
   * member who may well lift in pounds. src/ui/ExerciseHistory.tsx argues the
   * rule at length: the render boundary converts, once.
   *
   * NULL when the member has never chosen a unit, which is what `liftLabel`
   * returns for that case — and then the sentences below name no weight at
   * all rather than one in a unit nobody picked. The advice does not need the
   * figure to be useful: "keeping the same load" is the whole instruction.
   */
  lastWeightLabel: string | null,
): TemperedTip {
  if (!readiness) return { tip, temper: 'as-planned', note: null };
  // A good or moderate-but-not-low day changes nothing: see the header on why
  // readiness may not add load.
  if (readiness.tone === 'good') return { tip, temper: 'as-planned', note: null };
  if (ALREADY_GENTLE.includes(tip.action)) return { tip, temper: 'as-planned', note: null };

  if (readiness.tone === 'moderate') {
    // Only an increase is tempered. Chasing reps at the same load is already
    // the gentler half of progression and does not need softening.
    if (tip.action !== 'increase') return { tip, temper: 'as-planned', note: null };
    return {
      tip: { ...tip, action: 'reps', nextWeight: tip.lastWeight },
      temper: 'hold-load',
      note: `Keeping ${lastWeightLabel ?? 'the same load'} rather than adding to it, because ${basis(readiness)}. `
        + `Add the load next time if today feels easy — nothing here measures how strong you are, only how the last few days went.`,
    };
  }

  // tone 'low'
  return {
    tip: { ...tip, action: 'hold', nextWeight: tip.lastWeight, nextReps: String(tip.lastReps) },
    temper: 'repeat-last',
    note: `Repeating last session${lastWeightLabel ? ` — ${tip.lastReps} at ${lastWeightLabel} — ` : ' '}rather than asking for more, because ${basis(readiness)}. `
      + `That is a reading of your sleep and recent training, not a verdict on you: if it feels wrong, follow the plan instead.`,
  };
}
