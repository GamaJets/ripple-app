// What this screen is for, said on the screen, once.
//
// ── Why not the tour ───────────────────────────────────────────────────────
//
// There is one, at app/tour.tsx, and a reference version of it at app/guide.tsx.
// Both are good and neither answers the report. A carousel is shown before the
// member has seen the thing it describes, in one sitting, and is then gone: by
// the time somebody is actually looking at a hero reading 62 /100 and wondering
// what it is, the card that explained it was five screens and one session ago.
// That is the shape of every walkthrough complaint — "I swiped past it" is not
// a failure of attention, it is a question asked before there was anything to
// be curious about.
//
// So this is the other half. The tour stays where it is, openable from the
// guide; these are the same facts, moved to the moment of confusion. One row
// per tab, shut until it is tapped, gone for good once it is dismissed.
//
// ── The rules the strip has to keep ────────────────────────────────────────
//
//   · Dismissible. One control, and it says so.
//   · Never blocking. It is a row in the scroll view, not a modal, not an
//     overlay, and nothing waits on it.
//   · Never twice. Dismissed is permanent — a help card that comes back is the
//     nag the report is complaining about, wearing a different hat.
//   · Never lost. The words below are also in app/guide.tsx, which is in the Me
//     hub and stays there. Dismissing takes the row off the screen, not the
//     explanation out of the app.
//
// ── Voice ──────────────────────────────────────────────────────────────────
//
// Each line names one thing that is really on that screen and says what it
// means. Not what it is good for, not why it matters — what the number IS. The
// term is Title Case because it is quoting a label the reader can see; the
// explanation is a sentence and is punctuated as one.

/** One tab. Keys are storage keys — renaming one resurrects a dismissed card. */
export type ScreenHelpKey = 'home' | 'train' | 'meals' | 'progress' | 'me';

export interface HelpLine {
  /** The label as it appears on the screen, so the reader can find it. */
  term: string;
  /** What it means. One sentence. */
  means: string;
}

export interface ScreenHelp {
  key: ScreenHelpKey;
  /** The collapsed row's label. Title Case — it is a control. */
  title: string;
  /** Four at most. A fifth line is a page, and a page is the guide's job. */
  lines: HelpLine[];
}

export const SCREEN_HELP: Record<ScreenHelpKey, ScreenHelp> = {
  home: {
    key: 'home',
    title: 'What This Screen Shows',
    lines: [
      // The hero, and the single most-asked question in the app. The score is
      // built in src/lib/readiness.ts out of sleep, water and how recently the
      // member trained, and the screen already prints which of those it could
      // see — but not what the score is.
      { term: 'Readiness', means: 'a score out of 100 from your sleep, your water and how recently you trained. Tap it to see which of those it used.' },
      // The ActionCard. Two numbers on it that are about different things, which
      // its own source comments already flag as confusing.
      { term: 'The Card Below It', means: 'the one thing to do today. The ring on it is this week’s sessions; the number inside the ring is days in a row.' },
      // The thing no first-time reader knows, and the reason the screen looks
      // broken rather than empty.
      { term: 'A Dash', means: 'not measured, rather than zero. Sections appear here as you fill them in.' },
    ],
  },
  train: {
    key: 'train',
    title: 'What This Screen Shows',
    lines: [
      { term: 'Today', means: 'the session your plan has for today, and how many of its exercises you have ticked off.' },
      { term: 'Go To', means: 'everything else this tab holds — cardio, mobility, stretches, recovery and the exercise library.' },
      { term: 'Log by Text', means: 'type what you did in plain words and it becomes a logged session. Nothing has to be planned first.' },
    ],
  },
  meals: {
    key: 'meals',
    title: 'What These Numbers Mean',
    lines: [
      // The exact sentence the report was written about.
      { term: 'Calories Left', means: 'your target for the day, minus what you have logged, plus anything a watch says you burned beyond a normal day.' },
      { term: 'Burned All Day', means: 'a whole-day figure from your watch, resting included — not the calories of one session.' },
      { term: 'Macros', means: 'protein, carbs and fat. The bars fill as you log food; the targets come from your weight and your goal.' },
    ],
  },
  progress: {
    key: 'progress',
    title: 'What This Screen Shows',
    lines: [
      { term: 'Body Fat', means: 'the newest reading, with the day and the instrument that measured it underneath.' },
      { term: 'A Change', means: 'always measured from a named day. If no day is named, nothing has moved enough to report.' },
      { term: 'Progress Photos', means: 'stored on your account. Your coach sees one only when you send it.' },
    ],
  },
  me: {
    key: 'me',
    title: 'What This Screen Shows',
    lines: [
      { term: 'The Groups', means: 'every screen in the app, sorted. Tap a heading to fold one away.' },
      { term: 'Coaching', means: 'whether a coach programs for you, trains you in the room, both, or neither. It decides what the other tabs offer.' },
      { term: 'Search', means: 'the magnifier on the home screen finds any of these by name — faster than scrolling this list.' },
    ],
  },
};

const KEYS: readonly string[] = Object.keys(SCREEN_HELP);

/** Whether a value names a screen that still exists. A key stored by an older
 *  build for a tab that has since gone is dropped rather than kept, so the set
 *  cannot grow forever on names nothing reads. */
export function isHelpKey(v: unknown): v is ScreenHelpKey {
  return typeof v === 'string' && KEYS.includes(v);
}

/**
 * The screens whose card has been dismissed, from whatever was in storage.
 *
 * Tolerant, and deliberately so: the consequence of a bad parse here is a help
 * card coming back, which is the exact nag this file exists to prevent. So a
 * corrupt or older preference keeps every key it can still recognise instead of
 * starting again — the opposite of the setup draft in src/lib/firstRun.ts,
 * where starting again costs a tap and nothing else.
 */
export function dismissedFrom(raw: unknown): ScreenHelpKey[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreenHelpKey[] = [];
  for (const v of raw) if (isHelpKey(v) && !out.includes(v)) out.push(v);
  return out;
}

/** Whether this screen's card is done with. */
export function isDismissed(list: readonly ScreenHelpKey[], k: ScreenHelpKey): boolean {
  return list.includes(k);
}

/**
 * The set with one more screen dismissed. Idempotent — dismissing twice must
 * not write the same key twice, because the list is round-tripped through
 * storage on every dismissal and a duplicate would compound.
 */
export function withDismissed(list: readonly ScreenHelpKey[], k: ScreenHelpKey): ScreenHelpKey[] {
  return list.includes(k) ? [...list] : [...list, k];
}
