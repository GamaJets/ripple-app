// The words behind the first-run tour and the in-app user guide.
//
// One source, two presentations: the tour shows these sections once on first
// sign-in, the guide screen shows the same sections whenever someone wants to
// look something up. Keeping them in one place means the tour cannot drift into
// describing a feature the guide contradicts.
//
// Every line here describes something the app actually does. If a feature is
// not built, it does not get a sentence — a tour that promises what the app
// cannot do is the same failure as a screen that invents a number.

import type { AppVariant } from './variant';

export interface GuideSection {
  /** Tab label as it appears in the bar, so the words match the screen. */
  tab: string;
  /** One line on what the tab is for. */
  summary: string;
  /** Concrete things you can do there. */
  points: string[];
}

const CLIENT: GuideSection[] = [
  {
    tab: 'Home',
    summary: 'Where your day starts — how recovered you are and what is next.',
    points: [
      'Readiness needs a night of sleep logged before it can show you anything. Until then it stays blank rather than guessing.',
      'Body shows weight, body fat and muscle from your most recent scan, with the change since the one before it.',
      'The weight line is built from your check-ins, so it only moves when you log one.',
    ],
  },
  {
    tab: 'Train',
    summary: 'Your program, session by session.',
    points: [
      'Tap a day to see that session. Start workout walks you through it exercise by exercise.',
      'Log each set as you go — reps and weight. What you log is what feeds your history and progress.',
      'Book session opens your coach’s available slots. Month calendar shows everything already booked.',
      'Cardio, HIIT and Mobility sit alongside your main program.',
    ],
  },
  {
    tab: 'Meals',
    summary: 'Your calorie and macro targets, and what you actually ate.',
    points: [
      'Targets are scaled from your body — they need a weight and body fat to work from, so add a scan or a check-in first.',
      'Log food three ways: photograph it, scan a barcode, or describe it in words.',
      'Mark the day as training, standard or rest and the targets move with it.',
    ],
  },
  {
    tab: 'Progress',
    summary: 'The long view — scans, measurements and photos.',
    points: [
      'Add scan records an InBody result. Body fat and muscle on Home come from here.',
      'Measurements tracks the tape numbers between scans.',
      'Progress photos stay on your account; add two and you can compare before and after.',
    ],
  },
  {
    tab: 'Me',
    summary: 'Your account, your coach and your settings.',
    points: [
      'Connect a wearable to bring heart rate and sleep in automatically.',
      'Find a coach lists trainers who have opted in, and sends them a request.',
      'Everything you log belongs to your account and follows you across devices.',
    ],
  },
];

const TRAINER: GuideSection[] = [
  {
    tab: 'Clients',
    summary: 'Your roster, and who needs you today.',
    points: [
      'Add client enters someone by hand. Invite by email sends a link they accept in their own app.',
      'Filters split the roster by at-risk, online and in-person.',
      'Needs check-in surfaces the clients who have gone quiet.',
    ],
  },
  {
    tab: 'Programs',
    summary: 'Build a week of training and assign it.',
    points: [
      'Start from a template, or add training days and build from scratch.',
      'Assign to client pushes the program into that client’s Train tab.',
      'Save any program you like as a template to reuse.',
    ],
  },
  {
    tab: 'Schedule',
    summary: 'Your coaching week.',
    points: [
      'Add a session books a client or opens a slot they can book themselves.',
      'Weekly availability sets the times you offer every week.',
      'Group classes schedules classes and checks members in.',
    ],
  },
  {
    tab: 'Videos',
    summary: 'The clips your clients see inside their program.',
    points: [
      'Record a clip, upload one, or paste a hosted link.',
      'Anything in your library appears against the matching exercise for every client.',
    ],
  },
  {
    tab: 'Analytics',
    summary: 'How the coaching business is actually going.',
    points: [
      'Sessions delivered counts what you have actually run this month, not what was booked.',
      'Roster health splits your clients into on track, watch and at risk.',
      'Figures stay empty until there is real activity behind them.',
    ],
  },
];

const OWNER: GuideSection[] = [
  {
    tab: 'Overview',
    summary: 'The gym at a glance.',
    points: ['Members, trainers and activity across the business.'],
  },
  { tab: 'Trainers', summary: 'The coaches working under your brand.', points: ['See your trainers and the clients attached to each.'] },
  { tab: 'Brand', summary: 'How the app looks to your members.', points: ['Your name and colour carry through the client and coach apps.'] },
  { tab: 'Growth', summary: 'Where new members are coming from.', points: ['Referrals, promotions and sign-up trend.'] },
  { tab: 'Ops', summary: 'The day-to-day running of the gym.', points: ['Classes, announcements and operational notes.'] },
];

const BY_VARIANT: Record<Exclude<AppVariant, 'all'>, GuideSection[]> = {
  client: CLIENT,
  trainer: TRAINER,
  owner: OWNER,
};

export function guideFor(v: AppVariant): GuideSection[] {
  return v === 'all' ? CLIENT : BY_VARIANT[v];
}

/** One line under the title on both the tour and the guide. */
export const GUIDE_INTRO: Record<AppVariant, string> = {
  client: 'Five tabs. Here is what each one is for.',
  trainer: 'Five tabs for running your coaching. Here is what each one does.',
  owner: 'Five tabs across the business.',
  all: 'Five tabs. Here is what each one is for.',
};
