// What the member's AI coach is told about them, and whether each line is a fact.
//
// ── Why this is a module and not twenty lines inside the screen ───────────
//
// app/(client)/coach.tsx builds a `context` object and hands it to a language
// model, which writes it back to the member in the second person. That makes
// every field in it a sentence somebody will read about themselves, and the
// fields are not equally safe: some are measurements, and some are the
// CONSTRUCTED DEFAULTS src/ui/clientData.tsx falls back to when the profile read
// fails. Its own header says so —
//
//     "the profiles/clients reads land in `reportError` and then return, leaving
//      name, goal, diet, allergens and injuries at their constructed defaults.
//      A vegetarian with a nut allergy is shown, and fed meal plans, as a
//      meat-eating client with no allergens — the defaults are plausible enough
//      that nothing looks broken."
//
// — and its `status` field is documented as the only thing that can tell the
// two apart: "Under 'error' the fields above are defaults and nulls that were
// never confirmed — a screen must not present them as the client's answers."
//
// On a screen a default is a wrong figure. Here it is a confident paragraph. The
// worst of them is the injury list: `injuries` is `[]` under an unread profile,
// so `sharedInjuries(...) || 'none disclosed'` sent an all-clear assembled out
// of an empty set to a system prompt whose standing instruction is to train
// around disclosed injuries — the same shape as the `atRiskClients: 0` a lane
// found on the coach side, where nobody had been assessed.
//
// The coach's own ask already has this: `clientAskContext` in coachShare.ts is a
// pure function with coachAsk.test.ts behind it. The member's ask was the half
// still assembled inline, where nothing could assert it. This is that half.
//
// Pure — no React, no providers. Every input is a value the screen already has.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';
import { sharedInjuries } from './coachShare';
import type { Injury } from './injuries';
import type { CoachingMode, Diet, Goal } from './types';
import type { ReadinessSleep } from './readiness';

/** The daily targets, once something has been worked out. */
export interface AskMacros { kcal: number; protein: number; carbs: number; fat: number }

export interface MemberAskInput {
  /** Whether name, goal, diet, injuries, focus areas and meals-a-day are the
   *  member's answers. `clientData.profileStatus`. */
  profileStatus: LoadStatus;
  /** Whether the scan history is the server's answer. `clientData.scansStatus`
   *  — weight, body fat and muscle all resolve off it. */
  scansStatus: LoadStatus;
  coachingMode: CoachingMode;
  goal: Goal;
  diet: Diet;
  mealsPerDay: 3 | 4 | 5;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleKg: number | null;
  injuries: readonly Injury[];
  focusAreas: readonly string[];
  /** Null when there was nothing honest to scale a day to. */
  macros: AskMacros | null;
  /**
   * Whether the INPUTS to the target could not be read, as opposed to the member
   * simply having no weight on record. The goal and the diet split a day into
   * protein, carbs and fat, and the coach's adjustment is the correction on top;
   * an unread one of those is a target we could not work out, not a target the
   * member does not have.
   */
  targetInputsUnknown: boolean;
  /** True when the coach's adjustment specifically is the unread half, so the
   *  sentence can name the right read. */
  adjustUnread: boolean;
  programTitle: string;
  programFocus: string;
  /** True when the program is the app's generated one standing in for a coach
   *  assignment we could not read. */
  programUnknown: boolean;
  /** Non-null while the program being served is this device's stored copy of
   *  one the coach may since have replaced. `assignedPrograms.cachedNote`. */
  programCachedNote: string | null;
  /** White-label: never a hardcoded product name. */
  brandLabel: string;
}

/** The fields of the member ask that depend on the profile and scan reads. */
export interface MemberAskFacts {
  coaching: string;
  goal: string;
  diet: string;
  mealsPerDay: number | string;
  weightKg: number | string;
  bodyFatPct: number | string | undefined;
  muscleKg: number | string | undefined;
  kcal: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
  programTitle: string;
  programFocus: string;
  injuries: string;
  focusAreas: string;
}

/**
 * One clause for an unread profile, and it says WHICH silence it is.
 *
 * 'loading' is not a failure and must not be described as one: a member who
 * asked a question two seconds after the screen opened has not had a read fail,
 * they have had one not finish. Everything else — 'error' and 'partial' — is a
 * read that will not answer for this field, because a profile is one row and a
 * partial row is not a shorter list, it is an unfinished one.
 */
export function profileGap(status: LoadStatus): string {
  return status === 'loading'
    ? 'their profile had not finished loading when this was sent'
    : 'their profile could not be read';
}

/** The same, for the scan history behind weight, body fat and muscle. */
export function bodyGap(status: LoadStatus): string {
  return status === 'loading'
    ? 'their check-ins had not finished loading when this was sent'
    : 'their check-ins could not be read';
}

/**
 * How the member is coached, in a sentence the model can act on.
 *
 * `coachingMode` comes off the same `clients` row as the goal and the diet and
 * falls back to 'online' when that read fails, so an unread profile told the
 * model "coached remotely — their coach writes the plan but is never in the
 * room" about somebody training alone, and every answer was then written round
 * a coach who does not exist.
 */
export function coachingFact(mode: CoachingMode, status: LoadStatus): string {
  if (!isWhole(status)) {
    return `not known — ${profileGap(status)}, so do not assume anyone is coaching them and do not refer them to a coach`;
  }
  return mode === 'solo' ? 'training alone — no coach to refer them to'
    : mode === 'inperson' ? 'coached in person — their coach is in the room for their booked sessions'
    : mode === 'hybrid' ? 'coached in person for booked sessions and remotely in between — some weeks they train alone'
    : 'coached remotely — their coach writes the plan but is never in the room';
}

/**
 * The sleep line, and the three silences behind a null average.
 *
 * `readinessSleep` was given a named state for exactly this: 'stale' is nights
 * on record with none inside the window — the case that produced a readiness of
 * 100 out of six-week-old sleep — 'none' is genuinely nothing ever recorded, and
 * 'unknown' is us failing to work out which nights count. They were one
 * sentence, "no nights recorded", which is a claim about what the member has
 * done made partly out of our own failure, and a model handed it will tell
 * somebody who logs every night to start logging.
 */
export function sleepFact(sleep: ReadinessSleep): string {
  if (sleep.avgHours == null) {
    if (sleep.state === 'stale') {
      return `nothing in the last ${sleep.windowNights} nights — they have nights on record, but the most recent is older than that, so do not say they have never logged sleep`;
    }
    if (sleep.state === 'unknown') {
      return 'not known — we could not work out which nights to read, so do not say anything about how they have slept';
    }
    return `no nights recorded in the last ${sleep.windowNights}`;
  }
  const n = sleep.nights.length;
  return `${Math.round(sleep.avgHours * 10) / 10}h average over ${n} night${n === 1 ? '' : 's'}`
    + `, ${sleep.fromDevice ? `${sleep.fromDevice} measured by a device` : 'none measured by a device'}`
    + `${sleep.fromTyped ? `, ${sleep.fromTyped} logged by hand` : ''}`;
}

/**
 * Every profile- and scan-derived field of the member ask, gated on its read.
 *
 * Nothing here is withheld to be safe: where the read landed, the member's own
 * answer goes, unchanged. What is refused is the substitution — a default
 * standing in for an answer, or an empty list standing in for a clear one.
 */
export function memberAskFacts(i: MemberAskInput): MemberAskFacts {
  const pWhole = isWhole(i.profileStatus);
  const pGap = profileGap(i.profileStatus);
  const bWhole = isWhole(i.scansStatus);
  const bGap = bodyGap(i.scansStatus);
  const bodyUnknown = `not known — ${bGap}`;

  return {
    coaching: coachingFact(i.coachingMode, i.profileStatus),
    goal: pWhole ? i.goal : `not known — ${pGap}, so do not assume what they are training for`,
    diet: pWhole ? i.diet : `not known — ${pGap}, so do not assume what they will eat`,
    mealsPerDay: pWhole ? i.mealsPerDay : `not known — ${pGap}`,
    // "not recorded" is a statement about what the member has done, and only a
    // scan read that answered may make it.
    weightKg: i.weightKg != null
      ? Math.round(i.weightKg * 10) / 10
      : bWhole ? 'not recorded' : bodyUnknown,
    // `undefined` rather than null where the read DID land and there is simply
    // no figure: `shareableContext` drops undefined and the edge function's
    // prompt has no line for an absent field, which is what "never invent data
    // you were not given" needs to be true of the prompt as well as the reply.
    bodyFatPct: i.bodyFatPct ?? (bWhole ? undefined : bodyUnknown),
    muscleKg: i.muscleKg ?? (bWhole ? undefined : bodyUnknown),
    // "not set" is the member having no target. An unread goal, diet or coach
    // adjustment is a target we could not WORK OUT, and the figures `macrosFor`
    // returns from the defaults are a bulking day's macros presented as this
    // person's plan.
    kcal: i.macros?.kcal ?? (i.targetInputsUnknown
      ? `not known — ${i.adjustUnread ? 'their coach’s adjustment could not be read' : pGap}, so these were not worked out`
      : 'not set'),
    protein: i.macros?.protein ?? (i.targetInputsUnknown ? 'not known' : 'not set'),
    carbs: i.macros?.carbs ?? (i.targetInputsUnknown ? 'not known' : 'not set'),
    fat: i.macros?.fat ?? (i.targetInputsUnknown ? 'not known' : 'not set'),
    // Whose block it is travels with the block. `?? buildProgram(…)` substitutes
    // the app's automatic program and nothing in the payload distinguished the
    // two, so the model discussed "your plan" about a block nobody assigned; and
    // `getProgram` serves this device's copy for up to thirty days, which the
    // screen flagged to the reader and never to the model.
    programTitle: i.programUnknown
      ? `${i.programTitle} — this is ${i.brandLabel}'s automatic program, not their coach's; we could not read whether a coach has assigned them one, so do not call it their coach's plan`
      : i.programCachedNote ? `${i.programTitle} (${i.programCachedNote})` : i.programTitle,
    programFocus: i.programFocus,
    // The gate that matters most. The empty list and the unread list are the
    // same value; only the status can tell them apart, and "none disclosed" to a
    // prompt that instructs the model to train around disclosed injuries is an
    // all-clear nobody gave.
    injuries: pWhole
      ? (sharedInjuries(i.injuries as Injury[]) || 'none disclosed')
      : `not known — ${pGap}. Do not say they have none, and do not treat any movement as safe on the strength of it.`,
    focusAreas: pWhole
      ? (i.focusAreas.length ? i.focusAreas.join(', ') : 'none set')
      : `not known — ${pGap}`,
  };
}
