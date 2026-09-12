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

// ── And the coach, who has fifty-one screens and had none of these ─────────
//
// SCREEN_HELP covered `home`, `train`, `meals`, `progress` and `me`: the five
// CLIENT tabs, and nothing else. The component was already built and already
// generic, so the coach's half of this feature was one record short of
// existing — which is the cheapest possible version of "the app knows and does
// not say".
//
// The coach's screens need it more, not less. A client's home screen has one
// number on it that needs explaining; the coach's Clients tab has a band
// heading computed from a fourteen-day window against a six-week baseline, and
// the difference between "quiet" and "we could not read them" is a distinction
// the whole retention feature turns on. A coach who reads an empty Quiet
// Clients list as a calm week is the failure mode nudges.tsx spends its header
// on, and one dismissible row is a cheaper defence than a longer banner.
//
// Which screens get a card, and why those:
//
//   coach-clients   the roster's bands, and the dash. The single most-asked
//                   coach question, and the one place a wrong reading costs a
//                   phone call to somebody who trained yesterday.
//   coach-quiet     what "quiet" is measured against, and what it is not.
//   coach-schedule  open slots versus bookings versus blocked time — three
//                   things drawn on one grid.
//   coach-enquiries the join code on an enquiry, and the fact that nothing is
//                   ever sent from here.
//   coach-adspend   matched against unmatched spend, and what "cost unknown"
//                   is actually saying about a code.
//
// Deliberately NOT every screen. The complaint this feature answers is about
// volume; a help row on all fifty-one is the disease wearing the cure's coat.

/** One screen with a card. Keys are storage keys — renaming one resurrects a
 *  dismissed card. The `coach-` prefix is part of the key and not decoration:
 *  the two apps are separate binaries built from one tree and a coach and a
 *  client can share a handset, so a key collision would dismiss one person's
 *  card by the other person reading theirs. */
export type ScreenHelpKey =
  | 'home' | 'train' | 'meals' | 'progress' | 'me'
  | 'coach-clients' | 'coach-quiet' | 'coach-schedule' | 'coach-enquiries' | 'coach-adspend'
  | 'standards' | 'consistency' | 'goal'
  | 'coach-money' | 'coach-analytics' | 'coach-register'
  | 'owner-trainers' | 'owner-classes';

/** The client's five, in tab order. Exported so the test can assert on the two
 *  populations separately — a coach card must never be countable as a client
 *  tab, which is what a bare `Object.keys` length assertion would allow. */
export const CLIENT_HELP_KEYS: readonly ScreenHelpKey[] = ['home', 'train', 'meals', 'progress', 'me'];

/** The coach's, in the order a coach meets them. */
export const COACH_HELP_KEYS: readonly ScreenHelpKey[] =
  ['coach-clients', 'coach-quiet', 'coach-schedule', 'coach-enquiries', 'coach-adspend',
   // ── three more, on the same bar the five above are held to ──────────────
   //
   //   coach-money     "Which Codes Worked" refuses to rank two channels until
   //                   the split could be told from a coin toss, and the
   //                   refusal reads as a missing feature rather than as the
   //                   statistical answer it is. A coach moves real money on
   //                   this screen.
   //   coach-analytics the densest figures screen in either app. Sessions
   //                   Delivered is counted from marked outcomes and not from
   //                   the clock, and Value / Client is over a different
   //                   population than the Clients figure beside it — the file
   //                   already says both in prose to itself.
   //   coach-register  two bare percentages beside a count, on the screen a
   //                   coach opens to check they have been paid right.
   'coach-money', 'coach-analytics', 'coach-register'];

/**
 * Client screens BELOW a tab that grade, project or score something.
 *
 * A third list rather than four more entries in `CLIENT_HELP_KEYS`, because
 * that list means one thing — one card per tab — and the test asserts it. These
 * are not tabs. They are the client-side equivalent of the five coach screens
 * above: a figure a member has to interpret, on a screen whose own name does
 * not explain it.
 *
 * The header's warning about volume stands, and this list is held to the same
 * bar it sets for the coach's — each one named, with the reason:
 *
 *   standards     the level tiers. A member is told they are "Novice" at
 *                 squats with nothing on screen saying the grade is their lift
 *                 divided by their bodyweight against published norms, so it
 *                 reads as a judgement rather than an arithmetic.
 *   consistency   the streak and the heatmap. What counts as a training day,
 *                 and what breaks a streak, decide both figures and neither is
 *                 stated — and a streak somebody believes they have lost is the
 *                 single most discouraging thing this app can get wrong.
 *   goal          the projected finish date. It is a straight line through
 *                 recent weight readings, and it is drawn beside a target date
 *                 the member chose, which makes it look like a promise.
 *
 * Muscles is deliberately NOT here. It draws a body map and a rest count, and
 * it already explains both in a line of its own prose beside them.
 */
export const CLIENT_SCREEN_HELP_KEYS: readonly ScreenHelpKey[] =
  ['standards', 'consistency', 'goal'];

/**
 * The owner's, and the whole app had none.
 *
 * An audit of `app/(owner)/**` found zero `<ScreenHelp>` elements across all
 * twenty-one screens, on the surface that carries a gym's money and headcounts.
 * The two here are the ones where a reader cannot recover the meaning from the
 * screen:
 *
 *   owner-trainers  Trainer Health is a 0-100 composite — client load capped
 *                   at 12 and delivered sessions capped at 20, each worth half
 *                   — printed as a pill with no scale anywhere. A coach sorted
 *                   to the top of a list called "worst first" is a conversation
 *                   with a person, and the owner should know what put them
 *                   there before having it.
 *   owner-classes   Fill and Show are two different denominators sitting next
 *                   to each other. The line saying which is which is a source
 *                   comment — "Fill is booked/capacity; show is
 *                   attended/booked" — and a comment is not on screen.
 */
export const OWNER_HELP_KEYS: readonly ScreenHelpKey[] =
  ['owner-trainers', 'owner-classes'];

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

  /* ── the coach ─────────────────────────────────────────────────────────── */

  'coach-clients': {
    key: 'coach-clients',
    title: 'What This Screen Shows',
    lines: [
      // The band heading, and the thing every coach reads as an absolute.
      { term: 'At Risk', means: 'measured against that client’s own earlier rate, never against a target. Somebody who always trained twice a week is not at risk.' },
      // The band clientDrift deliberately sorts SECOND rather than last.
      { term: 'Nothing to Assess', means: 'the record holds too little to judge them on, which is not the same as fine. They sit high on purpose.' },
      { term: 'A Dash', means: 'not measured, rather than zero. A failed read draws a dash and says so above the list.' },
    ],
  },
  'coach-quiet': {
    key: 'coach-quiet',
    title: 'What Quiet Means Here',
    lines: [
      { term: 'Quiet', means: 'a fall in what the app was told, over two weeks against the six before them. It is not a fall in what they did.' },
      { term: 'Could Not Be Assessed', means: 'people whose record did not come back. They are not on the list below and they are not fine.' },
      { term: 'Write a Message', means: 'a draft in a box for you to edit and send yourself. Nothing on this screen sends anything.' },
    ],
  },
  'coach-schedule': {
    key: 'coach-schedule',
    title: 'What This Grid Shows',
    lines: [
      { term: 'An Open Slot', means: 'time you have offered that nobody has taken. Clients see it and can book it until you withdraw it.' },
      { term: 'Blocked', means: 'time nobody can book across. Blocking withdraws the open slots inside it and refuses if a session is already booked.' },
      { term: 'Unmarked', means: 'a session that has happened and that you have not said what became of. Those sessions count nowhere until you do.' },
    ],
  },
  'coach-enquiries': {
    key: 'coach-enquiries',
    title: 'What This Screen Shows',
    lines: [
      { term: 'An Enquiry', means: 'somebody who filled in your join page and did not make an account. They are not a client yet and not counted as one.' },
      { term: 'The Code', means: 'the join code they arrived through, so you can tell which flyer or post produced them.' },
      { term: 'Contacted', means: 'a note to yourself that you reached out. Nothing is sent from this screen on your behalf.' },
    ],
  },
  'coach-adspend': {
    key: 'coach-adspend',
    title: 'What These Figures Mean',
    lines: [
      { term: 'Matched Spend', means: 'money against an ad whose link carries one of your join codes. Only matched spend can be attributed to anybody.' },
      { term: 'Unmatched', means: 'money the app can see but cannot attribute, because nothing in the ad names a code of yours.' },
      { term: 'Cost Unknown', means: 'a code with joins and no spend behind it. Mark it free and it stops being reported as a gap.' },
    ],
  },
  'coach-money': {
    key: 'coach-money',
    title: 'What These Figures Mean',
    lines: [
      // The one this card exists for. src/lib/codeReturn.ts runs an exact
      // binomial test and declines to rank until it passes; on screen that is
      // a grey box reading "Too early to say".
      { term: 'Not Enough Yet', means: 'two codes are too close for the difference to be real. Repple would rather say nothing than name a winner off a split that could be a coin toss — keep both running and it will tell you.' },
      { term: 'Last Touch', means: 'a client is credited to the code they arrived on, and to that one only. Somebody who saw three of your ads counts once.' },
      { term: 'Cost Unknown', means: 'a code with joins and no spend against it. Mark it free and it stops being counted as a gap.' },
      { term: 'Named Codes Only', means: 'codes you gave a name to. An unnamed code cannot be told from another unnamed one, so neither is ranked.' },
    ],
  },
  'coach-analytics': {
    key: 'coach-analytics',
    title: 'What These Figures Mean',
    lines: [
      // DELIVERED_IS_MARKED, in the member's — here, the coach's — words.
      { term: 'Sessions Delivered', means: 'sessions whose outcome you marked, not bookings whose time has passed. A session nobody marked is not counted.' },
      // The file's own warning, promoted out of a caption under the row.
      { term: 'Value / Client', means: 'this month\u2019s revenue over the clients who actually paid — not over the Clients figure beside it, and not the two of them divided into each other.' },
      { term: 'Avg Adherence', means: 'averaged over clients who have checked in at all. Clients who never have are left out rather than counted as zero.' },
      { term: 'A Dash', means: 'not read, rather than nothing. Every figure here is withheld instead of guessed when its read came back short.' },
    ],
  },
  'coach-register': {
    key: 'coach-register',
    title: 'What These Figures Mean',
    lines: [
      { term: 'Of Booked, Here', means: 'of the people booked into your classes, the share who turned up — your own register, not the gym\u2019s.' },
      { term: 'Off the Waitlist', means: 'people who got in because somebody cancelled. They count as booked once promoted.' },
      { term: 'Classes', means: 'classes in the period with a register you completed. One you never marked is not in any figure on this screen.' },
    ],
  },
  'owner-trainers': {
    key: 'owner-trainers',
    title: 'How Trainer Health Is Worked Out',
    lines: [
      // The formula, in the owner's words. src/lib/ownerAnalytics.ts.
      { term: 'The Score', means: 'half of it is how many clients they carry, counted up to 12; the other half is sessions they delivered, counted up to 20. A full book scores 100 — it is not a mark out of ten for how good they are.' },
      // The distinction the whole band rests on, and the one that shipped wrong
      // once: booked is not delivered.
      { term: 'Delivered', means: 'sessions somebody recorded an outcome for. A session that was booked, has passed, and nobody marked counts for nothing here — which is usually a coach who has not filled their register, not a coach who did not work.' },
      { term: 'Worst First', means: 'the list is sorted by score, lowest at the top. It is where to look, not a ranking to show anybody.' },
    ],
  },
  'owner-classes': {
    key: 'owner-classes',
    title: 'What These Figures Mean',
    lines: [
      { term: 'Fill', means: 'people booked in, over the seats you put on sale. It says whether the timetable matches demand.' },
      // The two denominators, which are the reason this card exists: they sit
      // side by side and are not over the same thing.
      { term: 'Show', means: 'people who turned up, over the people who booked — NOT over capacity. A half-empty class everybody attended is 50% fill and 100% show.' },
      { term: 'A Dash', means: 'no class in the range recorded what it needed. Not zero: a class nobody marked a register for cannot be counted either way.' },
    ],
  },
  standards: {
    key: 'standards',
    title: 'How These Levels Are Worked Out',
    lines: [
      // The whole screen in one sentence, and the one it never said. A tier
      // name reads as a verdict on the person; it is a ratio.
      { term: 'Your Level', means: 'your best lift divided by your bodyweight, against published figures for each level. It is arithmetic, not anybody’s opinion of you.' },
      // The second most confusing thing here: six lifts, six separate answers.
      { term: 'Per Lift', means: 'each lift is graded on its own. Being Intermediate at deadlift and Novice at overhead press is normal, not a mistake.' },
      // Two different absences that look identical on the row.
      { term: 'No Level', means: 'either the lift is not on your log, or we have no bodyweight to divide by. The line under each lift says which.' },
    ],
  },
  consistency: {
    key: 'consistency',
    title: 'What This Screen Shows',
    lines: [
      // Days, anchored at today OR yesterday — see `currentStreak` in
      // src/lib/streaks.ts. Written from that function rather than from the
      // word "streak": a first draft of this card said weeks, and the hero on
      // the screen says days.
      { term: 'Current Streak', means: 'days in a row with something logged, counted back from today or yesterday — so resting today does not break it until tomorrow.' },
      // The one figure on the screen that nothing anywhere explains. "no
      // freezes yet" is printed under the hero and means nothing on its own.
      { term: 'Freezes', means: 'you earn one for every 10 training days on your record, up to two. A freeze bridges a single missed day so it does not reset your streak.' },
      // Exercises, not sessions — `heatmapDayLabel` says so, and the darker
      // square is what a member reads as "a better day".
      { term: 'The Squares', means: 'one per day, darker the more exercises you logged that day. Empty means nothing logged.' },
    ],
  },
  goal: {
    key: 'goal',
    title: 'What This Screen Shows',
    lines: [
      // The reason this card exists. A date beside a target date reads as a
      // commitment; it is an extrapolation of the last few readings.
      // Read off `projectionOf` in src/lib/goalTargets.ts rather than off the
      // words on the screen: the rate is FIRST to LAST reading since the goal
      // was set, which is why a single bad weigh-in moves the date so much.
      { term: 'Projected Finish', means: 'your first and latest readings since you set this goal, turned into a weekly rate and carried forward. It is what would happen if nothing changed — not a promise, and it moves every time you weigh in.' },
      { term: 'Your Target Date', means: 'the date you chose. Nothing computes it and nothing moves it but you.' },
      // The three refusals the function can return, in the member's words. The
      // seven-day floor is MIN_TREND_DAYS and is the one worth naming.
      { term: 'No Finish Date', means: 'your readings are less than a week apart, or flat, or going the other way. A date from any of those would be invented rather than projected.' },
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
