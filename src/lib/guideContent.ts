// The words behind the in-app user guide, and behind the first-run tour.
//
// ── Why this file exists ───────────────────────────────────────────────────
//
// The guide and the tour used to share one list of five short sections. That
// worked while the guide was a caption on the tab bar. It stopped working when
// the app grew things that are not a tab and cannot be described as one — an
// injury that travels from a client's phone through their plan to a control
// their coach cannot press, a booking that two people hold half of each, a
// package that charges again next month. Those are the parts somebody actually
// opens a guide to look up, and each of them needs more than a tab's worth of
// sentences.
//
// So there are now two shapes here. TABS is one section per tab, in bar order.
// TOPICS is the things that cut across tabs. The guide screen shows both; the
// tour shows the tabs only, trimmed (see src/lib/guide.ts), because a first-run
// walkthrough that opens with the release of liability is not a welcome.
//
// ── The one rule ───────────────────────────────────────────────────────────
//
// Every line here describes something the app does TODAY, checked against the
// screen it describes rather than against a commit message. A guide that names
// a button that is not there is worse than no guide: it makes a working app
// look broken to the person reading it, and it is what a store reviewer writes
// down. If a feature is not built, or could not be confirmed on a real screen,
// it does not get a sentence.
//
// The corollary is that these lines say what a thing does NOT do as readily as
// what it does — that Repple sends no email, that a late fee is the coach's and
// not Repple's, that a coach cannot record an injury for a client. Those are
// the sentences that stop somebody concluding the app is broken when it is
// working exactly as intended.

import type { AppVariant } from './variant';

export interface GuideSection {
  /** The heading. For a tab section this is the label as it appears in the bar,
   *  so the guide's words and the screen's words are the same words. */
  title: string;
  /** One line on what it is for. */
  summary: string;
  /** Concrete things you can do, or facts worth knowing before you try. */
  points: string[];
}

/* ── client · Repple ───────────────────────────────────────────────────────── */

const CLIENT_TABS: GuideSection[] = [
  {
    title: 'Home',
    summary: 'Where your day starts — how recovered you are and what is next.',
    points: [
      'Readiness needs a night of sleep behind it, either logged here or brought in from a watch. Until there is one it stays blank rather than guessing.',
      'Body shows body fat and muscle from your most recent scan, with the change since the one before it, beside your latest weight.',
      'While something you have disclosed is severe, a card here names the muscle groups your plan has eased off and why.',
    ],
  },
  {
    title: 'Train',
    summary: 'Your program, session by session.',
    points: [
      'Tap a day to see that session. Start Workout walks you through it exercise by exercise.',
      'Log each set as you go — reps and weight. What you log is what feeds your history and progress.',
      'Book Session opens the times your coach has offered. The month grid shows what is already booked.',
      'A movement that loads an injury you have disclosed is marked with which injury it loads, and offers you the alternatives in your plan that clear it.',
      'Where that injury is severe the swap is already made, if your plan has a safe alternative to swap to. Where it has none the movement is hidden and the row says so rather than quietly dropping it.',
      'Cardio, HIIT, Mobility and Recovery sit alongside your main program.',
    ],
  },
  {
    title: 'Meals',
    summary: 'Your calorie and macro targets, and what you actually ate.',
    points: [
      'Targets are scaled from your body — they need a weight and a body fat to work from, so add a scan or a check-in first.',
      'Log food four ways: photograph it, type in the number under a barcode, search for it, or describe it in words.',
      'Mark the day as training, standard or rest and the targets move with it.',
    ],
  },
  {
    title: 'Progress',
    summary: 'The long view — scans, measurements and photos.',
    points: [
      'Add Scan records an InBody result, typed in or read off a photo of the printout. Body fat and muscle on Home come from here.',
      'Measurements tracks the tape numbers between scans.',
      'Progress photos are saved to your account, so they are still there next time — add two and you can compare before and after.',
      'Your coach can open a progress photo only when you press and hold that one and send it. Sending one does not send the next, and you can take it back.',
      'The screen always says which photos your coach can see. If it could not check, it says that instead of telling you they are private.',
    ],
  },
  {
    title: 'Me',
    summary: 'Your account, your coach and your settings.',
    points: [
      'Connect a wearable to bring heart rate and sleep in automatically.',
      'Find a Trainer lists coaches who have switched themselves on in the directory, and sends them a request. A code from your coach goes in on that same screen, above the list.',
      'Injuries & Limitations, under Training, is where you disclose what you are working around.',
      'Memberships & Packs shows what you have bought, how much of it is left, and anything you are subscribed to.',
      'Everything you log belongs to your account and follows you across devices.',
    ],
  },
];

const CLIENT_TOPICS: GuideSection[] = [
  {
    title: 'Blood sugar',
    summary: 'Readings from a continuous glucose monitor, beside what you ate.',
    points: [
      'Meals › Blood Sugar. Repple does not talk to Dexcom or Abbott — a monitor writes into Apple Health and Repple reads it from there, so any monitor that reaches Health reaches Repple.',
      'Import from Health is on iPhone only. Apple Health asks about blood glucose on its own, the first time you import — nothing else in the app asks for it, and declining it changes nothing else.',
      'You can type a meter reading in by hand as well. It is stored in mmol/L whichever unit you read in, and a number that is only sensible in the other unit is refused rather than saved wrong.',
      'Each meal is shown with the reading before it and the highest one after — up to two hours, or until the next thing you ate. A dash where there was no reading, never a zero.',
      'Your coach sees none of this until you turn on Let my coach see these. Turning it off again hides the history as well as the next reading.',
      'The screen covers the last fourteen days. A share in range is withheld until there are enough readings for one to mean anything.',
      'Repple shows what your monitor recorded and stops there. It does not tell you what to eat, and the range it names is the one commonly quoted for adults, not a target set for you — those come from your clinician.',
    ],
  },
  {
    title: 'Offers',
    summary: 'Membership › Offers, where a code from your gym is redeemed.',
    points: [
      'Type the code in and Redeem. It works once per person, and only at the gym that issued it.',
      'Repple records that you used it and tells your gym. It does not take anything off a payment — the discount comes off through your gym’s own billing, so a price in the app does not change when you redeem.',
      'Codes you have already used are listed underneath, with the discount and the day. A list that could not be read says so rather than telling you that you have used none.',
    ],
  },
  {
    title: 'Injuries',
    summary: 'Telling the app what you are working around, and what changes when you do.',
    points: [
      'Disclose an Injury asks for an area, how bad it is, and a note in your own words.',
      'Read it off a document is the other way in, for a physio report, a scan result or a doctor’s note. Photograph it, or choose a PDF or an image already on your phone.',
      'A document only ever proposes. You read each suggestion, change what is wrong with it, and add the ones you mean — nothing is written on its own, because a disclosure you did not make is the app putting words in your mouth about your own body.',
      'The document itself stays in your account and only you can open it. What your coach sees is the injury you confirmed: the area, the severity and your note, exactly as if you had typed it.',
      'Your plan flags movements that load it, and swaps or hides them while it is severe.',
      'Your coach cannot add, change or remove an injury. If they hear about one standing next to you, all they can do is ask you to record it, and that request arrives in your messages.',
      'Mark Recovered when you heal. It stays on the list, because what you have had is worth knowing when somebody plans what you do next.',
      'None of this is medical advice. For pain, a new injury or a diagnosis, see a doctor or a physio before training.',
    ],
  },
  {
    title: 'Booking a session',
    summary: 'Book Sessions, reached from Train.',
    points: [
      'Your coach opens the times they are free. Those show as open slots on the day you tap, and Book takes one.',
      'Cancelling more than 24 hours ahead costs nothing.',
      'Inside 24 hours the session is still drawn from your package, and your coach’s late-cancellation fee may apply. Repple does not charge it and does not know what it is, so ask them.',
      'Either way the slot goes back on offer to your coach’s other clients.',
      'Plan This Day marks a day with what you intend to do. A planned day is never counted as a session you did — it keeps its own mark even after it has passed.',
      'Add to Calendar sends your booked sessions to the calendar app on your phone.',
    ],
  },
  {
    title: 'Paying your coach',
    summary: 'Memberships & Packs, under Me.',
    points: [
      'A coach can sell one-off packages — a membership, or a pack of a set number of sessions — and packages that charge every month or every year until you cancel.',
      'Paying opens Stripe in your browser. Repple never sees or stores your card. What you bought appears here once Stripe confirms it, which can take a moment.',
      'A subscription can be cancelled here and keeps running to the end of the period you have already paid for. Keep Subscription puts it back before then.',
      'Payment & Invoices opens Stripe’s own portal, where your card and your receipts live.',
      'A price is only ever shown in the currency it is charged in. Where that currency is not known, no figure is shown at all rather than one with the wrong sign on it.',
    ],
  },
  {
    title: 'Signing up',
    summary: 'The confirmation code, and the release you agree to.',
    points: [
      'Confirming your email address is a six-digit code you type into the app, not a link. Mail scanners were opening the links before anybody read them, and a code has no link for them to open.',
      'Before you can use the app you agree to a release of liability: that you should speak to a doctor before starting, and that you take part at your own risk. Both boxes have to be ticked.',
      'The agreement is recorded against your account rather than on this phone, so reinstalling does not ask you twice. If the wording ever changes you are asked again — agreeing to wording nobody has read is not agreeing.',
    ],
  },
];

/* ── trainer · Repple Coach ────────────────────────────────────────────────── */

const TRAINER_TABS: GuideSection[] = [
  {
    title: 'Clients',
    summary: 'Your roster, and who needs you today.',
    points: [
      'Add Client enters somebody by hand. Invite a Client opens your coaching code, and can also record an invite against an email address.',
      'Repple sends no email. An invite waits for that address to sign in, so tell them yourself that it is there.',
      'Filters split the roster by how somebody is going — drifting, or nothing recorded — by online, in-person or hybrid, and by any tag you have put on somebody.',
      'Tap a client for their page: what they have disclosed, how long since anything was recorded, what is outstanding, and the programme you assigned.',
      'Coaching Tools is also where your own training, nutrition and progress live.',
    ],
  },
  {
    title: 'Programs',
    summary: 'Build a week of training and assign it.',
    points: [
      'Start from a template, or add training days and build from scratch.',
      'Assign to Client pushes the program into that client’s Train tab.',
      'Save any program you like as a template to reuse.',
      'Where a client has disclosed an injury, Assign is withheld until you have read the list and confirmed it. The confirmation covers what you were shown, so recovering does not ask you again but a new disclosure does.',
      'Exercises that load what they disclosed are marked while you build, and named again before the programme goes out.',
      'You can programme those on purpose. Confirming records that you chose to, with the date. If the record cannot be saved the programme is not assigned either.',
    ],
  },
  {
    title: 'Schedule',
    summary: 'Your coaching week.',
    points: [
      'Add a Session books a client, or opens a slot they can take themselves. Starts are on the quarter hour, at any hour of the day.',
      'Weekly Availability sets the times you offer every week — on the quarter hour, at any hour of the day — and generates open slots from them for the next four weeks.',
      'Block Out Time marks a period you are not available and withdraws the open slots inside it, so nothing stays advertised that the server will refuse.',
      'A session already booked inside a block is never removed for you. Cancel it yourself — that is what tells the client.',
      'Cancelling a booked session frees the slot. Re-offer pushes your other clients that the time is open.',
      'Group Classes schedules classes and checks members in. Export Schedule sends your booked sessions to your own calendar app.',
    ],
  },
  {
    title: 'Videos',
    summary: 'The clips your clients see inside their program.',
    points: [
      'Record a clip, upload one, or paste a hosted link.',
      'Each clip is set to Only Me, My Clients, Everyone at the Gym, or Anyone on Repple.',
      'You can also name individual clients on a clip. A named client can watch it whatever that setting says, including one set to Only Me.',
      'Somebody you typed in by hand rather than somebody who signed up cannot be named on a clip. The list says which of your clients those are rather than failing at them quietly.',
      'A clip is matched to the movement and shows against it for the clients who can see it, ahead of anything Repple would otherwise have shown them.',
      'What Your Programmes Need lists the movements in your own templates that you have never filmed, and separates the ones the catalogue already illustrates from the ones a client would see nothing for.',
    ],
  },
  {
    title: 'Analytics',
    summary: 'How the coaching business is actually going.',
    points: [
      'Sessions Delivered counts this month’s sessions whose time has already gone by. It is not attendance — somebody who did not turn up is still in it.',
      'Roster health splits your clients into on track, watch and at risk.',
      'What those sessions are worth is your own session rate multiplied out. Repple does not process that money and is not told it, so it is arithmetic rather than a payout.',
      'Figures stay empty until there is real activity behind them, and a read that failed says so rather than showing you a zero.',
    ],
  },
  {
    title: 'Profile',
    summary: 'You, your rate, and how you get paid.',
    points: [
      'List me in Find a Trainer is off until you switch it on. Until then clients browsing for a coach cannot see you.',
      'Payments is where you connect a payout account and put packages on sale.',
      'My Training logs your own workouts, kept separate from every client’s record.',
      'Settings holds who you are signed in as, your data, and deleting your account. Sign Out is on this screen as well.',
    ],
  },
];

const TRAINER_TOPICS: GuideSection[] = [
  {
    title: 'A client’s blood sugar',
    summary: 'What you see when somebody wearing a monitor chooses to show you.',
    points: [
      'It appears on their page, and only if they have turned sharing on in their own app. You cannot turn it on for them — the database refuses it, not just the screen.',
      'When they have not shared, the page says so and says nothing about whether they have readings. Whether a monitor exists is theirs to tell you.',
      'When the read fails, the page says it failed. An empty stretch is only reported as empty when it was actually read.',
      'You see the last fortnight: latest, average, highest, the share inside the commonly quoted range, and the meals that had a reading either side.',
      'It is what their monitor recorded, and nothing more. Repple turns none of it into dietary advice, their targets are set with their clinician, and they can withdraw the whole history at any time.',
    ],
  },
  {
    title: 'Join codes',
    summary: 'How somebody actually gets onto your roster.',
    points: [
      'Your main code is six characters. Tap it to send it to the person in front of you; Copy Link for Your Bio gives the bare address instead, for a caption, a bio, or the destination of an ad.',
      'They enter the code in the client app under Find a Trainer, above the list of coaches. You still approve them before they join your roster.',
      'Named codes run alongside the main one — one for the gym flyer, one for the Instagram bio, both live at once — so you can see which of the things you did brought somebody in.',
      'Turning a named code off stops it taking anybody new and keeps its count, so a campaign that is over still tells you what it did.',
      'New Code replaces your main code and stops the old one working straight away. It is the remedy for a code that has got somewhere you did not put it, not a way to run a second campaign.',
      'What Each Code Returned shows clients in and what they went on to pay. What you spent is not in Repple, so you type it in per code — an empty box means unknown, not free.',
      'Every figure there is last touch: somebody who saw a post and later joined off a friend’s code counts for the friend.',
      'Where two codes are too close to call, no comparison is drawn at all and the screen says why.',
    ],
  },
  {
    title: 'Injuries',
    summary: 'What a client discloses, and what it stops you doing.',
    points: [
      'Disclosures appear on that client’s page, above everything about how they are going.',
      'You cannot add, change or remove one. That is enforced in the database rather than merely left off the screen: a gate the coach can edit their way out of is not a gate.',
      'Ask Them to Record One puts the request in your thread with them, and notifies them where it can. It lands in their injuries once they add it.',
      'Their programme cannot be assigned until you have read the list and confirmed it — see Programs.',
      'Recovered injuries are kept and shown. They light no flag and close no gate; they are there because what somebody has had changes how you plan the next twelve weeks.',
      'A read that failed says so. It never says the client has disclosed nothing.',
    ],
  },
  {
    title: 'Getting paid',
    summary: 'Payments, reached from Profile.',
    points: [
      'Set Up Payouts connects a Stripe account, and you never handle card details. A client cannot check out until Stripe has verified you, so connect it before you put anything on sale.',
      'A one-off package is a membership, or a pack of a set number of sessions.',
      'A recurring package charges every month or every year until the client cancels. A session count is not offered on one: nothing renews a balance, so the second month would charge again for credits already spent.',
      'Prices are in your gym’s currency and in nothing else. A gym that has not set one cannot put a package on sale, and the screen says so instead of picking a currency for you.',
      'Subscribers lists who is paying you, what they pay, and when it renews or ends.',
      'Nothing here is a balance or a payout. Every figure on the screen is a price you typed.',
    ],
  },
  {
    title: 'Your own training',
    summary: 'The three things you could track for everybody except yourself.',
    points: [
      'My Training logs and reviews your own sessions, by text or one lift at a time. It does not program — Programs is for that.',
      'My Nutrition logs your own meals against your own target. Where there is nothing behind the account to store one, the screen says so up front rather than taking a meal it is going to lose.',
      'My Progress holds your own weigh-ins and tape measurements. Its weight trend is built from your check-ins, which are the weekly grain a trend wants.',
      'All three read and write your own rows and cannot show a client’s. Whose they are is stated on the tab, the heading and every empty state.',
    ],
  },
  {
    title: 'Signing up',
    summary: 'The confirmation code.',
    points: [
      'Confirming your email address is a six-digit code you type into the app, not a link. Mail scanners were opening the links before anybody read them, and a code has no link for them to open.',
      'If the code does not arrive you can have another sent. A resend that failed says nothing was sent.',
    ],
  },
];

/* ── owner · Repple Studio ─────────────────────────────────────────────────── */

const OWNER_TABS: GuideSection[] = [
  {
    title: 'Overview',
    summary: 'The gym at a glance.',
    points: [
      'Sessions delivered over the last thirty days, and how that compares with the month before.',
      'How many of your trainers are flagged, and how many clients are with them.',
      'Trainer Health ranks your coaches worst first. Tap one for the detail behind the score.',
      'A sessions trend sits above that ranking, and client load per trainer below it.',
      'Revenue Analytics, Financial Health, Promotions and Classes & Payroll open from the foot of the screen.',
    ],
  },
  {
    title: 'Trainers',
    summary: 'The coaching staff working under your brand.',
    points: [
      'Who they carry and what they actually delivered, per trainer.',
      'Invite a trainer by email and they accept it in their own app.',
      'Delivered sessions can only be given a value once your gym has a session fee. Until it has one, no figure is shown rather than a nought.',
    ],
  },
  {
    title: 'Brand',
    summary: 'How the app looks to your members.',
    points: [
      'Set the app name and pick a palette. It applies live.',
      'The choice is held on this device. It is not pushed to your members’ phones, so a second Studio handset is set up on its own.',
    ],
  },
  {
    title: 'Growth',
    summary: 'Where new members are coming from.',
    points: [
      'Retention, clients across every trainer, cohort retention by signup month, and the trainer acquisition funnel.',
      'Promo and referral codes can be created here and switched on or off. A code you create is still there next time, and on your other devices.',
      'A code row shows its discount and how many members have redeemed it. Where that count could not be read the row shows a dash, which is not the same as nobody.',
    ],
  },
  {
    title: 'Ops',
    summary: 'The day-to-day running of the gym.',
    points: [
      'Activity is your gym’s own feed: members joining, coaches joining, sessions marked delivered or missed, and codes being redeemed, as they happen.',
      'Triage the support inbox — the feedback people send from inside the app, in one list.',
      'Trainer Rota: who is on the floor when, against what is booked.',
      'Equipment Register: what the gym owns, and what is due a service.',
      'Deletion Requests: members who asked to be erased, and the 30-day clock on each.',
      'Every list starts empty and fills from real activity. Nothing is seeded to make a screen look busy.',
      'The feed holds the most recent hundred, and a read that failed says so rather than reporting a quiet month.',
    ],
  },
];

const OWNER_TOPICS: GuideSection[] = [
  {
    title: 'Signing up',
    summary: 'The confirmation code.',
    points: [
      'Confirming your email address is a six-digit code you type into the app, not a link. Mail scanners were opening the links before anybody read them, and a code has no link for them to open.',
      'If the code does not arrive you can have another sent. A resend that failed says nothing was sent.',
    ],
  },
];

/* ── selection ─────────────────────────────────────────────────────────────── */

const TABS_BY_VARIANT: Record<AppVariant, GuideSection[]> = {
  client: CLIENT_TABS,
  trainer: TRAINER_TABS,
  owner: OWNER_TABS,
};

const TOPICS_BY_VARIANT: Record<AppVariant, GuideSection[]> = {
  client: CLIENT_TOPICS,
  trainer: TRAINER_TOPICS,
  owner: OWNER_TOPICS,
};

/** One section per tab, in the order the tab bar shows them. */
export function tabsFor(v: AppVariant): GuideSection[] {
  return TABS_BY_VARIANT[v];
}

/** The things that are not a tab. May be empty. */
export function topicsFor(v: AppVariant): GuideSection[] {
  return TOPICS_BY_VARIANT[v];
}

/** The line under the title on the guide screen. Counts are written out because
 *  they are checked against the tab bar in _layout.tsx — the coach app is SIX
 *  items and was described as five for as long as Profile has been in the bar. */
export const GUIDE_INTRO: Record<AppVariant, string> = {
  client: 'Five tabs, and the things that run across them.',
  trainer: 'Six tabs for running your coaching, and the things that run across them.',
  owner: 'Five tabs across the business.',
};

/** The line under the title on the first-run tour, which shows tabs only. */
export const TOUR_INTRO: Record<AppVariant, string> = {
  client: 'Five tabs. Here is what each one is for.',
  trainer: 'Six tabs for running your coaching. Here is what each one does.',
  owner: 'Five tabs across the business.',
};

/** How many points of a tab section the tour shows.
 *
 *  The tour is one card per tab and somebody is standing between it and the app
 *  they just installed, so it gets the top of each list rather than all of it —
 *  which is why the points above are ordered with the orienting ones first.
 *  Trimming rather than writing a second set of sentences is deliberate: two
 *  hand-written lists are two things to keep true, and the tour is the one
 *  nobody re-reads to notice it has gone stale. */
export const TOUR_POINTS = 3;
