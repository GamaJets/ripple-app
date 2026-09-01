// What a brand-new client is asked, and what a brand-new client is shown.
//
// ── The report this exists for ─────────────────────────────────────────────
//
//   "They need a tutorial on how to use the app and what it has to offer. Also
//    create an initial set up process to help users get started. There is a lot
//    of information being presented and if users don't know what they are
//    looking at or how to understand it, they will simply find it too
//    complicated and not use the app."
//
// The instinct is to add: a longer intake, a bigger walkthrough. That is the
// wrong direction — the complaint is about VOLUME, and both halves of it are
// answered by asking less and drawing less.
//
// ── What was actually there ────────────────────────────────────────────────
//
// A new client answered TWO wizards. app/onboarding.tsx (post sign-up) asked
// photo, goal, diet, then weight, height and coaching mode; then the dashboard
// banner sent them to app/(client)/onboarding.tsx, which asked name, goal,
// weight, height, body fat, diet, allergens and injuries. Goal, diet, weight
// and height were each asked twice, and the first wizard asked for weight in a
// box labelled "kg" whatever unit the account reads in — so an American member
// answered the same question twice and got a different body out of it.
//
// Eight steps across two screens, and at the end of them the app knew four
// things it could not have worked out on its own. This file is the list of
// those four, each with the sentence that justifies asking it.
//
// ── The rule every question here has to pass ───────────────────────────────
//
// Name what breaks if it is never answered — not what would be nicer with it.
// A question that only makes a screen prettier is asked later, in context, at
// the moment it first matters, and is not on this list. Deferred, in this app:
//
//   · Name        — the header says "Good morning" instead of "Good morning,
//                   Tim", and app/(client)/profile.tsx already renders "Add
//                   your name" as its own tap target. Nothing computes from it.
//   · Photo       — nothing at all reads it but an avatar. Same tap target.
//   · Diet        — macrosFor() does not take it; only the meal plan does. Ask
//                   it on Meals, above the plan it changes.
//   · Allergens   — same screen, same moment, and a list of fourteen pills is
//                   a wall on a first run.
//   · Body fat    — optional on the body step and stays optional: it sharpens
//                   focusAreas() and a scan fills it in by itself.
//   · Water goal  — the dashboard already offers "Set a daily goal" beside the
//                   count, which is exactly the in-context ask this file is
//                   arguing for. Adding it here would be the nag.
import type { LoadStatus } from '../ui/loadStatus';
import { isWhole } from '../ui/loadStatus';

/** The four questions, in the order they are asked. */
export type SetupStep = 'coaching' | 'goal' | 'body' | 'injuries';

export interface SetupQuestion {
  id: SetupStep;
  /** What is wrong, invented or missing if this is never answered. */
  breaks: string;
}

/**
 * The questions, and the reason each one survives.
 *
 * Order is not arbitrary. Coaching is first because it decides what the rest of
 * the app even offers — a member training alone should not be walked past a
 * booking calendar and a weekly check-in on their way in. Body is third rather
 * than second because a goal is a tap and a body is typing, and the cheap
 * question goes first.
 */
export const SETUP_QUESTIONS: readonly SetupQuestion[] = [
  {
    id: 'coaching',
    // src/ui/clientData.tsx defaults coachingMode to 'online' and nothing ever
    // asks again. So an unanswered account is not undecided, it is WRONG: the
    // home screen offers a weekly check-in "your coach reads it" to somebody
    // with no coach, Explore stops hiding the rows marked soloHide, and the
    // dashboard looks for a coach-written program before falling back to the
    // automatic one.
    breaks: 'the app assumes you have a coach and offers you check-ins nobody reads',
  },
  {
    id: 'goal',
    // buildProgram(goal, bodyFat) picks the whole training split from this, and
    // macrosFor() splits the calories by it. The default is 'muscle', so a
    // member who came to lose fat is handed a push/pull/legs plan and a
    // muscle-building macro split without being asked.
    breaks: 'your plan and your macros are built for building muscle whatever you came for',
  },
  {
    id: 'body',
    // macrosFor needs weightKg, and the dashboard's `macros` is null without
    // it — so the Fuel section has no target at all, the Meals tab has no
    // target at all, and the home screen says "add your weight for a target".
    breaks: 'there are no calorie or macro targets anywhere, because there is nothing to scale them to',
  },
  {
    id: 'injuries',
    // The automatic program is built without them, so it loads whatever hurts.
    // This is the one question on the list whose absence is a safety question
    // rather than an accuracy one, and it is why it is asked rather than
    // deferred to the screen that owns it.
    breaks: 'the plan loads the areas you need it to leave alone',
  },
];

/** What the account already knows before the first question is put. */
export interface SetupKnown {
  /**
   * A coach and this member have settled the mode between them — an accepted
   * invitation, or a join code spent. Asking again offers one party a control
   * over a two-party fact.
   */
  coachingAgreed: boolean;
  /**
   * A weight is on record from a scan or a weigh-in. Asking somebody to type a
   * figure the app is already holding is its own small insult, and the answer
   * they type is likelier to be wrong than the one that was measured.
   */
  weighed: boolean;
}

/**
 * The questions this account still has to be asked.
 *
 * This is the "shorter path" half of the brief: a member whose coach invited
 * them and who has stood on an InBody scan is asked two questions, not four,
 * and neither of the two was answerable from anything the app held.
 *
 * Goal and injuries are never dropped. Nothing else in the app can supply
 * either — the goal has a default that is a guess, and an injury is only ever
 * known because somebody said so.
 */
export function questionsToAsk(known: SetupKnown): SetupStep[] {
  return SETUP_QUESTIONS
    .filter((q) => {
      if (q.id === 'coaching') return !known.coachingAgreed;
      if (q.id === 'body') return !known.weighed;
      return true;
    })
    .map((q) => q.id);
}

/**
 * Where setup got to. Held on the DEVICE, in AsyncStorage — see the header of
 * app/(client)/onboarding.tsx. The answers themselves go through clientData and
 * are on the account; only this position is local, so setup resumed on a second
 * handset starts at the first question that handset has not seen. That is the
 * right way round: losing a position costs a tap, and losing an answer costs
 * the answer.
 */
export interface SetupDraft {
  /** The step last shown, or null if setup has not been opened. */
  at: SetupStep | null;
}

export const EMPTY_DRAFT: SetupDraft = { at: null };

const STEPS: readonly string[] = SETUP_QUESTIONS.map((q) => q.id);

/** Whether a value is one of the four ids. Narrow, so a stored string from an
 *  older build with a step that no longer exists resolves to null rather than
 *  to an index nothing can render. */
export function isSetupStep(v: unknown): v is SetupStep {
  return typeof v === 'string' && STEPS.includes(v);
}

/**
 * Read a stored draft. Tolerant by construction: a preference written by an
 * older build, hand-edited, or half-written by a crash must not stop somebody
 * setting up their account. Anything unreadable starts at the beginning, which
 * costs taps and never an answer.
 */
export function readDraft(raw: unknown): SetupDraft {
  if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
  const at = (raw as { at?: unknown }).at;
  return { at: isSetupStep(at) ? at : null };
}

/**
 * The index to open setup at, given the questions this account is being asked.
 *
 * Never past the end and never negative — a resume that lands outside the list
 * renders nothing at all, which is how a half-finished setup becomes a blank
 * screen somebody force-quits.
 *
 * A stored step that is not in `steps` resolves to 0 rather than being hunted
 * for: it means the question was dropped since (a coach linked the account, a
 * scan arrived), and the honest restart is the first thing still being asked.
 */
export function resumeAt(steps: readonly SetupStep[], draft: SetupDraft): number {
  if (draft.at == null) return 0;
  // Math.max rather than `i < 0 ? 0 : i`, which no test could ever tell apart
  // from `i <= 0 ? 0 : i` — both return 0 at zero. A comparison whose two
  // spellings are indistinguishable is a line the suite cannot watch, and
  // scripts/mutate.mjs reported it as exactly that. There is nothing to
  // compare here: indexOf returns -1 or an index, and the floor is zero.
  return Math.max(0, steps.indexOf(draft.at));
}

// ── What the home screen shows before there is anything to show ────────────
//
// The other half of "too much information", and the half that is not a wizard.
// On a brand-new account app/(client)/dashboard.tsx drew ten sections, and
// three of them were entirely em dashes: a Body row of three unmeasured
// figures, a Fuel section whose heading stood over no meters at all because
// `macros` is null without a weight, and This Week reading 0 sessions, 0 lifted
// and 0 PRs over seven empty dots.
//
// A dash under a label is the right answer to "not measured" and every reader
// understands it. Nine of them stacked on the first screen of a new app is not
// nine answers, it is the app looking broken. These sections come back the
// moment they have something to say, which is the same moment the member has
// done the thing that fills them.
//
// ── The rule that makes this safe ─────────────────────────────────────────
//
// A section is hidden only when we KNOW there is nothing in it. `LoadStatus`
// exists because an empty list under 'error' means unknown, not none, and
// hiding a section on a failed read would tell a member who has trained for a
// year that they have never trained. Under anything but 'ready' every section
// stays, dashes and all, alongside the warnings the dashboard already prints.

/** What the home screen knows about itself. */
export interface HomeFacts {
  /** The read behind the body figures — clientData's own `status`. */
  bodyStatus: LoadStatus;
  /** Any of weight, body fat or skeletal muscle on record. */
  measured: boolean;
  /** The read behind the training log. */
  logStatus: LoadStatus;
  /** Sessions in the log, ever — not this week. */
  loggedEver: number;
  /** Whether calorie and macro targets could be computed. Null when they could
   *  not, which on this screen is always for want of a weight. */
  hasTargets: boolean;
}

/**
 * Whether to draw the Body row of weight, body fat and muscle.
 *
 * Hidden only on a settled read that found nothing. The Progress tab is in the
 * bar and the quick-action row still points at it, so nothing becomes
 * unreachable by this — the row comes back with the first figure.
 */
export function showBody(f: HomeFacts): boolean {
  return f.measured || !isWhole(f.bodyStatus);
}

/**
 * Whether to draw Fuel Today.
 *
 * Without a weight there is no target, so the section rendered a heading, a
 * note reading "0 kcal eaten — add your weight for a target", and no meters
 * under it. That note is a good sentence in the wrong place: the ask belongs on
 * the body step of setup and on the Meals tab, not as a section that exists to
 * explain why it is empty.
 */
export function showFuel(f: HomeFacts): boolean {
  return f.hasTargets;
}

/**
 * Whether to draw This Week.
 *
 * Gated on the log ever having anything in it rather than on this week's count:
 * a member who trains Monday and Tuesday and opens the app on a Sunday has an
 * empty week and eleven months of history, and hiding it from them would be a
 * statement about their training rather than about their data.
 */
export function showWeek(f: HomeFacts): boolean {
  return f.loggedEver > 0 || !isWhole(f.logStatus);
}

/**
 * How many of the three the screen is drawing. Not used to lay anything out —
 * it is what the test asserts against, because the claim worth pinning is
 * "a brand-new account sees none of these and a used one sees all three".
 */
export function homeSectionsShown(f: HomeFacts): number {
  return (showBody(f) ? 1 : 0) + (showFuel(f) ? 1 : 0) + (showWeek(f) ? 1 : 0);
}

// ── Getting Started: the client's, and why it is a list rather than a tour ──
//
// Reported directly:
//
//   "Repple Coach has a Getting Started, however Client doesn't have this.
//    This is needed on the Client app to better help Clients understand the app
//    and its features."
//
// There is no screen called Getting Started in the coach app either. What the
// coach app did was SHOW THE TOUR — `repple.tour.seen.trainer` was unset on a
// fresh install — while the client app did not, because its own key had been
// set on an earlier launch. So the difference reported is behavioural, and the
// defect it exposes is that a one-shot, skippable, per-device carousel is not a
// Getting Started at all. Once it is consumed it is gone; somebody who skipped
// it on day one, or reinstalled, or moved handset, has no way back to it that
// they would ever find.
//
// This is the persistent version. It is a list of things worth doing, each
// naming the screen that does it, and it says how far through you are. It is on
// the home screen while it has anything left to say and in the Me hub forever.
//
// ── The two rules it has to keep ───────────────────────────────────────────
//
//   · It goes away when it is finished. A checklist stuck at 5 of 5 is clutter,
//     and clutter is the complaint this whole piece of work answers. The home
//     row disappears; the screen stays reachable from the hub, because a screen
//     nothing links to is the other failure.
//   · Nothing reads as "not done" off a failed read. Every fact below is
//     `boolean | null`, and null is the caller saying its provider did not
//     answer. An unread item draws a dash, is not counted as outstanding, and
//     — this is the part that matters — does not let the list call itself
//     finished either. "You have never logged a workout" is not a claim to make
//     out of a refused query.

export type ChecklistItemId = 'setup' | 'guide' | 'coach' | 'workout' | 'meal' | 'device';

export interface ChecklistItem {
  id: ChecklistItemId;
  /** Title Case — it renders as a <ListRow title>. */
  title: string;
  /** Sentence case. What doing it gets them, in their words. */
  note: string;
  /** The screen that does it. Pushed with no params, so every one of these must
   *  open on its own — the same rule src/lib/features.ts keeps for Explore. */
  route: string;
}

/**
 * In the order they are worth doing, which is not the order they are easiest.
 * Setup first because everything downstream is computed from it; the guide
 * second because it is the answer to "what is all this", and it was previously
 * findable only as one row inside the Me hub.
 */
export const CHECKLIST: readonly ChecklistItem[] = [
  { id: 'setup', title: 'Finish Setting Up', note: 'four questions that decide your plan and your targets', route: '/(client)/onboarding' },
  { id: 'guide', title: 'Read the User Guide', note: 'what each tab is for, in one screen', route: '/guide' },
  { id: 'coach', title: 'Connect With Your Coach', note: 'enter their code, or accept the invitation they sent', route: '/(client)/trainers' },
  { id: 'workout', title: 'Log Your First Session', note: 'anything you did — it can be typed in plain words', route: '/(client)/workouts' },
  { id: 'meal', title: 'Log Something You Ate', note: 'search, scan a barcode, or photograph the plate', route: '/(client)/foodlog' },
  { id: 'device', title: 'Connect a Watch', note: 'where your sleep, steps and readiness come from', route: '/(client)/devices' },
];

/** Done, still to do, or nobody could tell us. */
export type ItemState = 'done' | 'todo' | 'unknown';

/**
 * What the app knows about each item. `null` means the read behind it did not
 * answer — NOT that the thing has not been done.
 */
export interface ChecklistFacts {
  setup: boolean | null;
  guide: boolean | null;
  coach: boolean | null;
  workout: boolean | null;
  meal: boolean | null;
  device: boolean | null;
  /** They told us they train alone. There is no coach step to take, so the row
   *  is dropped rather than left permanently outstanding — which is how a
   *  checklist that can never be finished happens. */
  solo: boolean;
}

export interface ChecklistRow {
  item: ChecklistItem;
  state: ItemState;
}

const stateOf = (v: boolean | null): ItemState => (v == null ? 'unknown' : v ? 'done' : 'todo');

/** The rows this client actually has, each with where it stands. */
export function checklist(f: ChecklistFacts): ChecklistRow[] {
  return CHECKLIST
    .filter((it) => !(it.id === 'coach' && f.solo))
    .map((it) => ({ item: it, state: stateOf(f[it.id]) }));
}

/** How many are done. Never counts an unread one. */
export function checklistDone(rows: readonly ChecklistRow[]): number {
  return rows.filter((r) => r.state === 'done').length;
}

/** How many are known to be outstanding. Never counts an unread one either —
 *  "3 left" over a failed read is a number made out of our own failure. */
export function checklistLeft(rows: readonly ChecklistRow[]): number {
  return rows.filter((r) => r.state === 'todo').length;
}

/** The next thing worth doing, or null when there is nothing known to do. */
export function nextTodo(rows: readonly ChecklistRow[]): ChecklistItem | null {
  return rows.find((r) => r.state === 'todo')?.item ?? null;
}

/**
 * Whether the home screen still carries the row.
 *
 * True while anything is outstanding — and true while anything is merely
 * UNKNOWN, which is the LoadStatus rule applied to a checklist: a list that
 * congratulates somebody on finishing because three of its reads failed is
 * worse than one that stays a day too long.
 */
export function showChecklist(rows: readonly ChecklistRow[]): boolean {
  return rows.some((r) => r.state !== 'done');
}
