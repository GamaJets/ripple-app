// Single source of truth for the client app's secondary features. Drives the
// Explore/search directory. Each feature is "owned" by the primary tab it
// belongs under (rebalanced IA):
//   train · meals · progress · me
//
// ── This file used to say "and the slimmed Me hub" ─────────────────────────
//
// It did not drive the hub — app/(client)/profile.tsx has its own HUB_GROUPS —
// but that sentence was the justification for slimming it, and the slimming was
// only safe if this list really did contain everything. It did not. Ten client
// screens were missing from it, and one of them (Reminders) was in the group the
// hub had stopped rendering, so between the two files that screen had no route
// into it from anywhere in the app. Both halves are fixed: the hub shows every
// group again, and the ten are below.
//
// ── And it happened again, to eight more ───────────────────────────────────
//
// account, attendance, compare, gym-plans, notices, receipts and standing were
// in neither this list nor HUB_GROUPS, so between the two files a member had no
// way to reach any of them: no way to change their own password, no way to see
// the register their gym ticks about them, no way to re-read the notice they
// missed, no way to see what they had been charged, and no way to end a
// standing appointment except by cancelling every occurrence of it one at a
// time, each inside a notice window that charges for it. `intake` was the
// eighth — on the hub, and missing from here, so it existed on the Me screen
// and not in search. All eight are listed below.
//
// The hub is still its own hand-written list and this file still does not drive
// it. That is the standing hazard: the fix for a missing screen goes HERE, and
// a row added to the hub instead is how the two lists disagreed in the first
// place.
//
// ── What is deliberately NOT listed ────────────────────────────────────────
//
// Explore pushes `route` with no params. So a screen that NEEDS one cannot go in
// this list, however useful it is — the row would open a screen with nothing in
// it, which is a worse answer to a search than no row at all. A screen that
// merely accepts an optional param and falls back to its own picker is a
// different thing and is listed; /(client)/compare is one, and says so on its
// own row.
//
//   · /(client)/exercise needs `name`, and with none it renders an exercise
//     with no title, no muscles and no clip. The Exercise Library is the way in
//     and it IS listed.
//
// And one screen is left out on judgement rather than on mechanics:
//
//   · /(client)/onboarding is the first-run intake. It is not a feature to go
//     back to, it is a wizard that WRITES goal, stats, diet and allergens
//     straight into the client record, and it is reached from the dashboard's
//     "personalise" banner when it is actually due. A member who searched
//     "start" and tapped it out of curiosity would be walked through
//     overwriting their own profile, and the last step marks onboarding
//     complete, so the banner that was legitimately offering it disappears.
//     A search result should not be able to do that.
import type { IconName } from '../ui/Icon';

export type FeatureArea = 'train' | 'meals' | 'progress' | 'me';

export interface Feature {
  key: string;
  label: string;
  note: string;
  route: string;
  icon: IconName;
  area: FeatureArea;
  keywords?: string;   // extra search terms
  soloHide?: boolean;  // hidden for self-managed (solo) clients
}

export const AREA_LABEL: Record<FeatureArea, string> = {
  train: 'Training',
  meals: 'Nutrition',
  progress: 'Progress & Insights',
  me: 'Coaching & Account',
};

export const CLIENT_FEATURES: Feature[] = [
  // ── Training ──────────────────────────────────────────────
  { key: 'week', label: 'This Week', note: 'Your week of training at a glance', route: '/(client)/week', icon: 'calendar', area: 'train', keywords: 'plan schedule' },
  { key: 'library', label: 'Exercise Library', note: 'How-to videos from your coach', route: '/(client)/library', icon: 'video', area: 'train', keywords: 'videos how to form' },
  // Directly under the Exercise Library, because the two answer the halves of
  // one question and a member who found only the first has been handed six
  // hundred movements with no order to do them in. `workout_templates` had been
  // live and populated since supabase/parts/2600 and was read by nothing, so
  // this row is the whole difference between fifteen programmes existing and
  // fifteen programmes being reachable.
  //
  // Not `soloHide`. A member training themselves is the person these are FOR;
  // the note is what keeps them from reading as a coach's work.
  { key: 'programmes', label: 'Programmes', note: 'Ready-made plans to follow — not written by your coach', route: '/(client)/programmes', icon: 'grid', area: 'train', keywords: 'programme programmes program plan plans routine routines workout plan template templates split ppl push pull legs upper lower full body 5x5 stronglifts beginner strength hypertrophy bodyweight home dumbbell kettlebell hiit mobility core ready made follow' },
  { key: 'tools', label: 'Lifting Tools', note: '1RM, plate math & macro reference', route: '/(client)/tools', icon: 'settings', area: 'train', keywords: 'calculator 1rm plates macros' },
  { key: 'recovery', label: 'Recovery', note: 'Hydration, sleep & mobility', route: '/(client)/recovery', icon: 'water', area: 'train', keywords: 'sleep hydration mobility rest' },
  { key: 'habits', label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits', icon: 'check', area: 'train', keywords: 'water streak daily' },
  { key: 'calendar', label: 'Book a Session', note: 'Month calendar · book your coach', route: '/(client)/calendar', icon: 'calendar', area: 'train', keywords: 'booking session appointment', soloHide: true },
  // Listed beside Book a Session rather than folded into it, because they are
  // two different situations and a member in the second one has already looked
  // at the first and found nothing. Book a Session shows the hours a coach has
  // opened; this is for when none of them suit, or there are none at all —
  // which, until this week, was every coach on the platform.
  //
  // It was reachable ONLY from three hardcoded pushes: no row here meant it was
  // unsearchable and absent from the Me hub, so a member who had dismissed the
  // prompt on the booking screen had no way back to it. That is the same defect
  // item 49 is about, recurring on the newest screen in the app.
  { key: 'request-session', label: 'Ask for a Time', note: 'Ask your coach for an hour they have not opened', route: '/(client)/request-session', icon: 'clock', area: 'train', keywords: 'request ask booking session appointment time slot propose suggest', soloHide: true },
  { key: 'injuries', label: 'Injuries & Limitations', note: 'Train around injuries — safer swaps', route: '/(client)/injuries', icon: 'heart', area: 'train', keywords: 'injury injuries pain limitation niggle shoulder knee back hurt rehab physio safer swaps avoid' },
  // Listed separately from Injuries rather than folded into it: somebody
  // holding a physio report in their hand is looking for "upload", "scan" or
  // "report", not for the manual entry screen, and the two do genuinely
  // different things.
  // On the Me hub since the coach's "Ask Them to Finish It" push needed
  // somewhere to land, and missing from here — so a member who had been asked
  // to finish it, and went looking for it in search, found nothing. It sits
  // beside Injuries because they are the same kind of thing: what a coach needs
  // to know about your body, written only by you.
  { key: 'intake', label: 'Your Intake', note: 'What your coach should know before they train you', route: '/(client)/intake', icon: 'pencil', area: 'train', keywords: 'intake form questionnaire par-q parq health history medical conditions medication surgery before we start finish it what my coach needs to know about me answers' },
  { key: 'injury-doc', label: 'Read an Injury From a Document', note: 'Photograph a physio or scan report', route: '/(client)/injury-doc', icon: 'camera', area: 'train', keywords: 'injury document physio report scan letter mri x-ray upload photo ocr extract' },
  { key: 'scan-machine', label: 'Scan a Machine', note: 'Point at a gym machine and log the set', route: '/(client)/scan-machine', icon: 'camera', area: 'train', keywords: 'scan machine qr barcode code gym equipment log set cardio rower bike' },
  { key: 'reminders', label: 'Reminders', note: 'Hydration, training, weigh-in and your own nudges', route: '/(client)/reminders', icon: 'bell', area: 'train', keywords: 'reminder reminders water hydration supplement training weigh-in photo nudge alarm notification daily weekday' },
  // Listed separately from Reminders, because the two answer different
  // questions and somebody looking to stop a 6am class alert will search for
  // "notifications" and "quiet", not for "reminders".
  { key: 'notification-prefs', label: 'Notifications', note: 'Which kinds reach you, and quiet hours', route: '/(client)/notification-prefs', icon: 'bell', area: 'train', keywords: 'notification notifications push quiet hours silence mute class session badge streak turn off' },

  // ── Nutrition ─────────────────────────────────────────────
  { key: 'foodlog', label: 'Food Log', note: 'Search, barcode or photo', route: '/(client)/foodlog', icon: 'meals', area: 'meals', keywords: 'calories macros barcode photo diary' },
  { key: 'restaurant', label: 'Eating Out', note: 'Estimate restaurant macros', route: '/(client)/restaurant', icon: 'meals', area: 'meals', keywords: 'restaurant eating out dining takeout macros estimate cuisine' },
  // Filed under Nutrition because the screen reads CGM values against the meals
  // they surround — that is what somebody is looking at it FOR. The label is
  // the phrase a member uses; 'cgm', 'libre' and 'dexcom' are the words the
  // person who actually wears one will type.
  { key: 'glucose', label: 'Blood Sugar', note: 'CGM readings from Health, against your meals', route: '/(client)/glucose', icon: 'water', area: 'meals', keywords: 'blood sugar glucose cgm libre dexcom diabetes diabetic health continuous monitor' },
  { key: 'classes', label: 'Classes', note: 'Book gym group classes', route: '/(client)/classes', icon: 'calendar', area: 'train', keywords: 'classes group class booking gym schedule hiit spin yoga crossfit waitlist branch' },
  { key: 'membership', label: 'Membership', note: 'Card, entry pass & visits', route: '/(client)/membership', icon: 'grid', area: 'me', keywords: 'membership member card gym access barcode entry pass visits plan renew' },
  { key: 'access', label: 'Gym Access', note: 'Entry barcode', route: '/(client)/access', icon: 'grid', area: 'me', keywords: 'access barcode entry scan gym door turnstile membership' },
  // Under Membership, which could READ a plan and offered no action of any
  // kind. This is the first screen in the client app from which a member can
  // buy anything their gym sells — and the price is always in the currency the
  // row itself carries, never a default, because Repple is white-labelled.
  //
  // 'renew' and 'upgrade' are here rather than on Membership: they are what
  // somebody types when they want to DO something about their plan, and until
  // this screen existed those searches landed on the one that could only
  // describe it.
  { key: 'gym-plans', label: 'Plans & Passes', note: 'What your gym sells, and buying it', route: '/(client)/gym-plans', icon: 'grid', area: 'me', keywords: 'plan plans pass passes price prices cost how much membership join sign up buy purchase pay renew renewal upgrade downgrade change plan day pass month monthly term contract what my gym sells' },
  { key: 'pt-sessions', label: 'Personal Training', note: 'Approve delivered PT sessions', route: '/(client)/pt-sessions', icon: 'people', area: 'me', keywords: 'personal training pt sessions approve delivered package trainer' },
  { key: 'bookings', label: 'My Bookings', note: 'Classes & PT in one place', route: '/(client)/bookings', icon: 'check', area: 'me', keywords: 'my bookings booked classes pt sessions upcoming cancel schedule' },
  // Under My Bookings, because that screen lists the OCCURRENCES and this one
  // is the arrangement behind them. A member with a standing Tuesday at seven
  // watched sessions appear on their calendar from a thing they could not see,
  // could not name and could not leave; their only exit was to cancel each one
  // in turn, which is the single most expensive way out — every occurrence
  // inside the coach's notice window records its own late fee.
  //
  // Hidden from a self-managed member, like Book a Session and Messages: a
  // standing appointment is an agreement with a coach, and somebody with no
  // coach cannot have one.
  { key: 'standing', label: 'Standing Appointments', note: 'Your repeating slot, and the way out of it', route: '/(client)/standing', icon: 'calendar', area: 'me', keywords: 'standing appointment appointments recurring repeat repeating every week weekly same time regular slot series ongoing arrangement stop end cancel all future stop the sessions', soloHide: true },

  // ── Progress & Insights ───────────────────────────────────
  { key: 'report', label: 'Weekly Report', note: 'Your week at a glance · share it', route: '/(client)/report', icon: 'chart', area: 'progress', keywords: 'summary' },
  { key: 'consistency', label: 'Consistency', note: '12-week training heatmap', route: '/(client)/consistency', icon: 'flame', area: 'progress', keywords: 'heatmap streak' },
  // Beside Consistency, and they are not the same thing: that one is drawn from
  // what was LOGGED, this is the gym's own two registers — the class register a
  // coach ticks and the door log. The gym has held both since the beginning and
  // the member could see neither, so a row generated about somebody walking
  // through a door was readable by everyone except them. The note says
  // "recorded" rather than "attended" for the reason the screen does: an
  // unticked register is not an absence.
  { key: 'attendance', label: 'Attendance', note: 'Every time your gym recorded you in', route: '/(client)/attendance', icon: 'check', area: 'progress', keywords: 'attendance attended attend visits visit been in went in check in checkin checked in register door entry swipe scan turned up showed up class register how often do i go my visits history' },
  // The label answers the question a member actually has. 'Deload' and
  // 'training load' both stay in the keywords: a coach or an experienced
  // lifter will search for those words, and a rename that makes a screen
  // unfindable to the people most likely to want it is a worse bug than the
  // jargon was. The label is for the person who does not know the term; the
  // keywords are for the person who does.
  { key: 'restday', label: 'When to Rest', note: 'When to rest or back off, read from your log', route: '/(client)/restday', icon: 'moon', area: 'train', keywords: 'rest day deload recovery fatigue overtraining overreaching planner training load back off easy week' },
  { key: 'records', label: 'Personal Records', note: 'Your best lifts, ranked', route: '/(client)/records', icon: 'trophy', area: 'progress', keywords: 'pr prs best lifts' },
  { key: 'progression', label: 'Next-session Targets', note: 'Auto progression from your lifts', route: '/(client)/progression', icon: 'trending', area: 'train', keywords: 'progression overload progressive weight increase targets next' },
  { key: 'standards', label: 'Strength Standards', note: 'How your lifts stack up', route: '/(client)/standards', icon: 'chart', area: 'progress', keywords: 'benchmark bodyweight' },
  { key: 'goal', label: 'Goal Tracker', note: 'Target weight & projected finish', route: '/(client)/goal', icon: 'target', area: 'progress', keywords: 'target projection' },
  { key: 'measurements', label: 'Body Measurements', note: 'Waist, chest, arms over time', route: '/(client)/measurements', icon: 'ruler', area: 'progress', keywords: 'waist chest arms tape' },
  { key: 'achievements', label: 'Achievements', note: 'Badges and milestones', route: '/(client)/achievements', icon: 'trophy', area: 'progress', keywords: 'badges milestones' },
  { key: 'challenges', label: 'Challenges', note: 'Join challenges · climb the leaderboard', route: '/(client)/challenges', icon: 'trophy', area: 'progress', keywords: 'challenge leaderboard competition streak rankings compete' },
  { key: 'cards', label: 'Milestone Cards', note: 'Shareable cards of your wins', route: '/(client)/cards', icon: 'share', area: 'progress', keywords: 'share card' },
  // Takes `before` and `after` and is listed anyway, which the rule at the top
  // of this file allows and this is the shape it allows it for: both params are
  // OPTIONAL, and with neither the screen renders its own thumbnail strip and
  // says "tap two photos below to compare them". A bare push lands on a working
  // picker rather than on an empty screen, which is the whole of the test.
  //
  // 'before and after' and 'transformation' are what a member types; 'compare'
  // is what the route is called and almost nobody searches for it.
  { key: 'compare', label: 'Before & After', note: 'Two progress photos side by side, with the readings from those days', route: '/(client)/compare', icon: 'camera', area: 'progress', keywords: 'compare comparison before and after before after side by side progress photos photo transformation how far have i come then and now difference change' },
  { key: 'checkin', label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin', icon: 'pencil', area: 'progress', keywords: 'weight mood energy coach', soloHide: true },
  { key: 'activity', label: 'Activity', note: 'Your training feed & updates', route: '/(client)/activity', icon: 'bell', area: 'progress', keywords: 'feed updates' },
  { key: 'trends', label: 'Trends', note: 'Weekly volume & estimated 1RM over time', route: '/(client)/trends', icon: 'trending', area: 'progress', keywords: 'trend trends graph chart volume tonnage 1rm estimated over time progress' },
  { key: 'body-trends', label: 'Composition Trends', note: 'Weight, body fat, muscle & InBody score over time', route: '/(client)/body-trends', icon: 'trending', area: 'progress', keywords: 'body composition trend weight body fat skeletal muscle inbody score graph over time' },
  // The long view, and the only screen in the app that shows more than ten
  // weeks. 'year' and 'months' are in the keywords because that is what the
  // question sounds like when a member asks it.
  { key: 'history', label: 'Your History', note: 'Months and years, not weeks', route: '/(client)/history', icon: 'clock', area: 'progress', keywords: 'history long view year years months all time how far have i come past archive' },
  // The finer half of History's own muscle-group board: the same log joined
  // against the catalogue's `primary_muscles` / `secondary_muscles` rather than
  // its eleven display groups, so it can light a body. 'heatmap', 'recovery'
  // and 'rest' are in the keywords because that is what the question sounds
  // like — "which muscles have I not trained", "is my chest recovered" — even
  // though the screen itself will not use the third of those words about a
  // body. See src/lib/muscleRecovery.ts.
  { key: 'muscles', label: 'Your Muscles', note: 'The body, what you worked, and how long it has rested', route: '/(client)/muscles', icon: 'dumbbell', area: 'progress', keywords: 'muscle muscles heatmap heat map body diagram anatomy recovery map rest rested days since last trained which muscles have i not trained neglected chest back legs shoulders arms most trained least trained ranking' },

  // ── Coaching & Account ────────────────────────────────────
  { key: 'trainers', label: 'Find a Trainer', note: 'Browse coaches · online or in-person', route: '/(client)/trainers', icon: 'people', area: 'me', keywords: 'coach hire book' },
  { key: 'coach', label: 'AI Coach', note: 'Chat with your AI coach', route: '/(client)/coach', icon: 'chat', area: 'me', keywords: 'ai assistant chat' },
  { key: 'messages', label: 'Messages', note: 'Chat with your coach', route: '/(client)/messages', icon: 'message', area: 'me', keywords: 'chat dm coach', soloHide: true },
  // The note used to read "Post progress to Instagram / TikTok". It never did.
  // social.tsx has one `Share.share()` call and nothing else — the NETWORKS
  // list whose Connect button flipped a local boolean and relabelled itself
  // "Connected" was deleted from that screen as fabricated state, and the two
  // registries went on advertising the thing that had just been removed. The
  // note now describes the OS share sheet, which is all that happens.
  //
  // 'instagram' and 'tiktok' stay in the KEYWORDS deliberately: that is what
  // somebody types when they want to put a result on Instagram, and this screen
  // is what gets them there, via the share sheet Instagram appears in. Searching
  // for a word must not be the same thing as being promised a feature.
  { key: 'social', label: 'Share & Social', note: 'Share your progress from the share sheet', route: '/(client)/social', icon: 'share', area: 'me', keywords: 'instagram tiktok share social post story sheet' },
  { key: 'packages', label: 'Memberships & Packs', note: 'What you have bought, and what is left', route: '/(client)/packages', icon: 'trophy', area: 'me', keywords: 'package packages pack sessions left remaining credits subscription membership purchase bought paid renew' },
  // Listed separately from Memberships & Packs, because the two answer
  // different questions: that screen says how many are left, this one says
  // which hours used the rest and which booked hours are going to use these.
  { key: 'session-credits', label: 'Session Credits', note: 'Which sessions used a credit, and when', route: '/(client)/session-credits', icon: 'calendar', area: 'me', keywords: 'credit credits session sessions pack pass drawn used left remaining balance ledger history gym pass pt entitlement covered' },
  // The gym's side of the money, and the one record a member wants when a
  // charge looks wrong. `gym_payments` says of itself that a row means somebody
  // took money — and until now the only people who could read it were the gym's
  // owners. Listed separately from Memberships & Packs because that screen is
  // what a member HAS and this is what they were CHARGED, and somebody
  // disputing a payment is not looking for a list of credits.
  { key: 'receipts', label: 'Payments', note: 'What your gym has recorded taking from you', route: '/(client)/receipts', icon: 'grid', area: 'me', keywords: 'payment payments paid charge charged charges receipt receipts invoice bill money taken took my money how much have i paid history statement direct debit card refund wrong charge double charged dispute' },
  { key: 'offers', label: 'Offers', note: 'Redeem a code from your gym', route: '/(client)/offers', icon: 'grid', area: 'me', keywords: 'offer offers code promo promotion discount voucher redeem coupon' },
  // The coach you HAVE, which Explore did not list at all while listing that
  // coach's DOCUMENTS one line down — so searching "coach" found the paperwork
  // and not the person. The Me hub has had the row since part 130 made the
  // screen possible; this is the other way in, and the keywords are what
  // somebody types when they are looking for a name, a qualification or a way
  // to reach them rather than for a form.
  { key: 'my-coach', label: 'Your Coach', note: 'Who is coaching you, and what they can see', route: '/(client)/my-coach', icon: 'people', area: 'me', keywords: 'coach trainer pt my coach personal trainer who qualification qualifications insurance credentials review message contact reach bio' },
  // Your coach's own paperwork, not Repple's. The release signed on joining is
  // a different document belonging to a different party and is not on this
  // screen — see the header of coach-documents.tsx. 'waiver', 'par-q' and
  // 'consent' are in the keywords because those are the words printed on the
  // thing the member is holding when they come looking for it.
  { key: 'coach-documents', label: "Your Coach's Documents", note: 'Waivers and forms your coach asks you to read', route: '/(client)/coach-documents', icon: 'pencil', area: 'me', keywords: 'document documents waiver par-q parq form consent house rules paperwork sign accept read coach studio' },
  // The bell in the dashboard header still opens the message thread, so this
  // row and the hub row are the only ways in. Listed as an inbox rather than as
  // "notifications", which in this app is also the name of a settings toggle —
  // 'push', 'alerts' and 'inbox' all land here.
  { key: 'notifications', label: 'Notifications', note: 'Bookings, cancellations and anything your gym has sent you', route: '/(client)/notifications', icon: 'bell', area: 'me', keywords: 'notification notifications inbox alerts push updates announcements bookings cancellations unread bell' },
  // Directly under Notifications, and they are different things: that is the
  // inbox addressed to this member, this is what the gym POSTED to everybody.
  // The dashboard showed the latest announcement and nothing else, so the day
  // after "we are closed Monday" was pushed out of that one slot it was
  // readable nowhere in the product — including by the members who never opened
  // the app on the day it was up.
  { key: 'notices', label: 'Notices', note: 'Everything your gym has posted, the older ones too', route: '/(client)/notices', icon: 'message', area: 'me', keywords: 'notice notices announcement announcements posted post news bulletin board update updates closed closure opening hours bank holiday what did they say earlier previous older missed it' },
  { key: 'referral', label: 'Invite Friends', note: 'Share the app with a friend', route: '/(client)/referral', icon: 'share', area: 'me', keywords: 'refer referral invite friend share code' },
  { key: 'devices', label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices', icon: 'clock', area: 'me', keywords: 'apple watch wearable heart rate' },
  { key: 'music', label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music', icon: 'play', area: 'me', keywords: 'spotify playlist songs' },
  { key: 'appearance', label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance', icon: 'palette', area: 'me', keywords: 'theme dark light colour' },
  { key: 'settings', label: 'Settings', note: 'Account, notifications, units, legal & version', route: '/(client)/settings', icon: 'settings', area: 'me', keywords: 'notifications units legal about sign out signout log out logout account' },
  // Directly under Settings, which offered sign-out and account deletion and
  // nothing in between. Both of these have been supported by the backend from
  // the start and neither was reachable: a member who wanted to change their
  // password had to trigger a "forgotten password" email for a password they
  // had not forgotten, and a member changing email address had no route at all
  // — so somebody leaving a provider lost the account, because the reset email
  // is the only way back in and it goes to the address they no longer have.
  //
  // 'hacked', 'someone else' and 'security' are in the keywords because that is
  // what somebody types at the moment this matters most.
  { key: 'account', label: 'Password & Email', note: 'Change the password or the address you sign in with', route: '/(client)/account', icon: 'lock', area: 'me', keywords: 'password change password new password reset email change email email address sign in signin login credentials security account hacked someone else knows my password forgot old email new address' },
  { key: 'feedback', label: 'Send Feedback', note: 'Tell us what to improve', route: '/(client)/feedback', icon: 'message', area: 'me', keywords: 'feedback bug idea report suggest' },
  // Reported as "Repple Coach has a Getting Started, however Client doesn't."
  // It is listed here and NOT excluded the way /(client)/onboarding is, because
  // the two are different things: onboarding is a wizard that overwrites goal,
  // stats and injuries and would do that to somebody who tapped it out of
  // curiosity, and this is a read-only list of what has and has not been done.
  // Opening it costs nothing. 'tutorial', 'how do i' and 'help' are all here
  // because they are what somebody types when they are lost.
  { key: 'getting-started', label: 'Getting Started', note: 'What is set up, and what is still worth doing', route: '/(client)/getting-started', icon: 'sparkle', area: 'me', keywords: 'getting started get started setup set up onboarding first run new tutorial guide help how do i where do i begin checklist what next lost confused' },
];

export function searchFeatures(list: Feature[], q: string): Feature[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((f) =>
    f.label.toLowerCase().includes(s) ||
    f.note.toLowerCase().includes(s) ||
    (f.keywords ? f.keywords.toLowerCase().includes(s) : false) ||
    AREA_LABEL[f.area].toLowerCase().includes(s)
  );
}

// ── Trainer & Owner portal directories (flat, searchable) ────────────────────
export interface NavItem {
  key: string; label: string; note: string; route: string; icon: IconName; keywords?: string;
}

// ── The coach's directory ───────────────────────────────────────────────────
//
// This had nine entries against thirty-two screens in app/(trainer)/, and
// Explore is the coach app's only search. So a coach looking for the screen that
// records what they were paid, or their own training log, or the queue of
// sessions nobody has marked off yet, searched, found nothing, and reasonably
// concluded the app did not do it. Every one of those screens existed.
//
// The same rule as the client list applies and is why this is not simply all
// thirty-two: Explore pushes `route` with no params, so a screen that needs one
// is not listed. Deliberately absent for that reason —
//
//   · client, chat  — both need `clientId`; they are reached by tapping the
//     person on the roster, which is the only place the id exists.
//
// client-body, client-week, client-photos, client-training and client-intake
// were on that list and are not any more, because the reason they were on it
// stopped being true. Every one of them acquired a roster picker — each reads
// `clientId` if it is given one and falls back to its own list if it is not —
// and none was added here, so a coach searching "body fat", "photos", "their
// week", "what have they logged" or "intake" found nothing at all while five
// working screens sat behind those exact words. That is the same failure the
// paragraph above this list describes about log-session, arriving five more
// times.
//   · exercise            — needs `name`; the Exercise Library is the way in.
//   · explore             — is this list. A search result that opens the search
//     screen is a row that does nothing.
//   · class-checkin       — needs the class `id`. Opened without one it falls
//     back to UNLINKED_CLASS, which both classRoster and setAttendance refuse by
//     name, so the row would lead to a screen that cannot save anything.
//
// log-session WAS on this list, for the reason the rule exists: it needed
// `clientId`, it had no picker, and a coach could type out a whole session on it
// and only be told there was "nobody to log against" when they pressed save —
// the worst possible moment, because the sets are gone with the screen. The last
// sentence of that entry read "give it a picker and it belongs here". It has one
// now (a roster field, the same matcher the Clients screen searches with, seeded
// from the param when there is one so the way in from a client's own screen is
// unchanged) and the save button is HELD until somebody is chosen rather than
// refusing after the typing. So it is listed below.
//
// checklists and client-goals both DO have a roster picker built in and open
// perfectly well with no params, which is why they are listed and the rest of
// the per-client screens are not. client-nutrition and client-report are the
// same shape — each reads `clientId` if it is given one and falls back to its
// own picker if it is not — so both are listed here AND pushed with the id from
// app/(trainer)/client.tsx, which is the way a coach actually reaches them.
export const TRAINER_NAV: NavItem[] = [
  { key: 'clients', label: 'Clients', note: 'Your roster, progress & detail', route: '/(trainer)/dashboard', icon: 'people', keywords: 'roster invite add' },
  { key: 'builder', label: 'Programs', note: 'Build & assign training programs', route: '/(trainer)/builder', icon: 'train', keywords: 'program template workout' },
  { key: 'templates', label: 'Program Templates', note: 'Build once, assign to many clients', route: '/(trainer)/templates', icon: 'grid', keywords: 'template library bulk assign program reuse' },
  // The keywords are longer than they look like they need to be, and that is
  // deliberate: for a coach who has said they work online this row is where the
  // calendar goes when the dashboard stops leading with it. Hidden is not
  // deleted, and the only thing that makes that true is that the words a coach
  // types still find it — "calendar", "diary", "my hours", "slots", "in person".
  { key: 'schedule', label: 'Schedule', note: 'Calendar, availability & bookings', route: '/(trainer)/calendar', icon: 'calendar', keywords: 'sessions availability booking calendar diary slots my hours when i work open hours in person book me appointments week month' },
  { key: 'sessions', label: 'Mark What Happened', note: 'Past sessions nobody has recorded yet', route: '/(trainer)/sessions', icon: 'check', keywords: 'sessions outcome mark attended no show noshow completed queue payroll unrecorded' },
  // Beside Mark What Happened, because the two are the same act at different
  // times: that screen records that an hour took place, this one records what
  // was done in it. 'in person' and 'on the floor' are here because a coach
  // looking for this is standing in front of somebody, and 'for them' and
  // 'their record' because the thing that makes this screen different from My
  // Training is whose history it writes to.
  { key: 'log-session', label: 'Log a Session', note: 'Type up what you just ran, into their record', route: '/(trainer)/log-session', icon: 'pencil', keywords: 'log a session log session record write up sets reps weights workout for them their record in person on the floor pt session just did today did with client entered typed' },
  { key: 'classes', label: 'Classes', note: 'Create and manage group classes', route: '/(trainer)/classes', icon: 'calendar', keywords: 'class classes group schedule branch capacity room instructor hiit spin yoga' },
  // Directly under Classes, because it is the other end of the same act: that
  // screen is where a register is taken and this is what the register said. The
  // figures were readable by the coach the whole time — `class_attendance_summary`
  // admits the class's own trainer — and surfaced only on the owner's console.
  //
  // Keyworded with the words a coach types when they are checking they were paid
  // right: "how many turned up", "show rate", "walk-ins", "headcount". It
  // carries 'pay' and 'payroll' while printing no amount at all, for the same
  // reason the Money row carries 'profit' — those are the words people search
  // with, and landing them on the screen that explains why no amount is shown
  // beats landing them nowhere.
  { key: 'my-register', label: 'Your Register', note: 'What the registers you took actually say', route: '/(trainer)/my-register', icon: 'check', keywords: 'register attendance check in checkin checked in turned up showed up show rate fill rate headcount how many came walk in walkins waitlist my classes classes i taught taught teaching pay payroll per attendee per head paid right am i owed numbers from my check ins' },
  { key: 'videos', label: 'Videos', note: 'Exercise video library', route: '/(trainer)/videos', icon: 'video', keywords: 'exercise demo upload' },
  { key: 'library', label: 'Exercise Library', note: 'What you can programme, and what you have filmed', route: '/(trainer)/library', icon: 'grid', keywords: 'exercise library catalogue movements coverage filmed clips muscles' },
  { key: 'checklists', label: 'Client Checklists', note: 'The daily lines you set one client', route: '/(trainer)/checklists', icon: 'check', keywords: 'checklist checklists daily tasks habits client adherence ticked' },
  { key: 'client-goals', label: 'Working Toward', note: 'What a client is aiming at, and how it is going', route: '/(trainer)/client-goals', icon: 'target', keywords: 'goal goals target working toward client aim weight measurement' },
  { key: 'client-nutrition', label: "A Client's Nutrition", note: 'Their targets, and the week of meals you write them', route: '/(trainer)/client-nutrition', icon: 'meals', keywords: 'nutrition meals macros calories diet plan client food week allergens targets deltas' },
  { key: 'client-report', label: 'Client Report', note: 'The handover document at the end of a block', route: '/(trainer)/client-report', icon: 'pencil', keywords: 'report handover document summary end of block twelve week pdf share export client progress what we did' },
  // ── the five per-client screens that had no way in but a client's page ──
  //
  // Each takes an optional clientId and falls back to its own roster picker, so
  // a bare push from search opens something usable — the same test
  // client-nutrition and client-report already passed. Keyworded with what a
  // coach TYPES rather than what the screen is called: "body fat" and "inbody"
  // find the scans screen, "photos" and "progress pics" find the inbox, "what
  // have they logged" finds their training, "par-q" and "readiness" find the
  // intake.
  { key: 'client-body', label: "A Client's Body", note: 'Their scans, their measurements and which way they are going', route: '/(trainer)/client-body', icon: 'scale', keywords: 'body composition scan scans inbody dexa body fat bodyfat percent muscle mass skeletal lean weight kg lbs measurements tape waist trend gaining losing progress' },
  { key: 'client-training', label: 'What They Have Logged', note: 'Their sessions against the programme you wrote', route: '/(trainer)/client-training', icon: 'dumbbell', keywords: 'training log logged workouts sessions what have they done did they train volume sets reps weights lifted plan vs actual adherence stuck to the plan off plan swapped exercises' },
  { key: 'client-week', label: 'Their Week', note: 'The days they have marked, against what you programmed', route: '/(trainer)/client-week', icon: 'calendar', keywords: 'their week planned days rest day deload travelling holiday marked ahead clash conflict schedule what are they doing this week day plan' },
  { key: 'client-photos', label: 'Photos They Sent', note: 'Progress photographs a client shared with you', route: '/(trainer)/client-photos', icon: 'camera', keywords: 'photos photographs progress pics pictures shared sent me front back side comparison before after gallery images' },
  { key: 'client-intake', label: 'Their Intake', note: 'What they told you before you trained them', route: '/(trainer)/client-intake', icon: 'pencil', keywords: 'intake onboarding form questionnaire par q parq readiness health screening history injuries surgery medication availability when can they train emergency contact next of kin what did they tell me' },
  // Beside Quiet Clients on purpose: both are read before ringing somebody, and
  // this is the one that says whether there is anything to ring about. The
  // member has been able to see this record since part 136 and the coach could
  // not, which left the retention conversation being had off a register nobody
  // ticked. Takes an optional clientId and falls back to its own picker, so a
  // bare push from search opens something useful.
  //
  // 'missed' and 'no show' are here because they are what a coach types, and the
  // screen exists to tell them that the record cannot answer that question —
  // landing them on the honest answer beats landing them on nothing.
  { key: 'client-attendance', label: 'Their Attendance', note: 'Every time your gym recorded a client coming in', route: '/(trainer)/client-attendance', icon: 'check', keywords: 'attendance attended visits been in came in turned up showed up register door entry swipe scan class register how often do they come missed no show absent stopped coming retention drop off client history' },
  // The screen that does something with the drift figure. 'quiet', 'ghosting'
  // and 'churn' are the words a coach uses for this; 'drift' is the word the
  // code uses, and both have to find it.
  { key: 'nudges', label: 'Quiet Clients', note: 'Who has gone quiet, and a draft you send yourself', route: '/(trainer)/nudges', icon: 'bell', keywords: 'nudge nudges quiet drift lapsed inactive ghosting churn at risk reach out check in draft message' },
  { key: 'invoices', label: 'Invoices', note: 'Issue a document for what somebody paid you', route: '/(trainer)/invoices', icon: 'grid', keywords: 'invoice invoices bill receipt issue self employed paid cash transfer document statement number vat tax owed overdue due date chase unpaid outstanding who owes me money ageing aging' },
  // The half of a coach's income Stripe never sees. Listed rather than left as
  // a row on the Money screen because the words a coach types for it — "cash",
  // "bank transfer", "paid me" — are the words they type when their takings
  // figure looks too small, and until this screen existed those searches landed
  // on Invoices, which is a different act with a document attached to it.
  //
  // Deliberately NOT keyworded with "earnings" or "pay". Those are the words
  // for a gym paying an employed trainer, which is read-only to that trainer
  // and is a different thing entirely; a coach searching them should not be
  // landed on a screen that lets them type.
  { key: 'receipts', label: 'Cash and Transfers', note: 'Record a payment a client made outside this app', route: '/(trainer)/receipts', icon: 'grid', keywords: 'cash transfer bank paid me record payment received outside app front desk manual money in takings not on stripe' },
  // The other side of Cash and Transfers, and the reason the Statement of
  // Record was one-sided by construction: rent, insurance, CPD, kit, travel and
  // the accountant had nowhere to be written down, so every figure this app
  // held about a coach's year was money in. Carries no 'profit' and no 'net' —
  // deliberately, and unlike the Money row, because those two words belong to
  // the screen that explains why the halves are never subtracted, and a coach
  // typing them should land there rather than on the table that would make the
  // subtraction look available.
  { key: 'costs', label: 'What It Costs You', note: 'Rent, insurance, courses, kit, travel and the accountant', route: '/(trainer)/costs', icon: 'wrench', keywords: 'cost costs expense expenses outgoings going out spend rent gym rent chair fee desk fee insurance liability cpd course qualification equipment kit travel mileage petrol accountant bookkeeper subscription overheads what i pay out bills' },
  // Named 'statement' and never 'tax', because the screen deliberately is not
  // one — but 'tax', 'accountant' and 'year end' are the words a coach types
  // when they go looking for it, so search has to land them on the thing that
  // honestly helps rather than on nothing at all.
  { key: 'statement', label: 'Statement of Record', note: 'What this app recorded in a year or a quarter, to hand to an accountant', route: '/(trainer)/statement', icon: 'chart', keywords: 'statement record year end year-end annual accountant accounts tax export summary period quarter earnings takings what i earned bookkeeping csv' },
  { key: 'credentials', label: 'Credentials & Reviews', note: 'Your qualifications, and replying to what clients wrote', route: '/(trainer)/credentials', icon: 'trophy', keywords: 'credential credentials qualification qualifications certification insured insurance review reviews rating reply cpd rep level' },
  { key: 'documents', label: 'Your Documents', note: 'Your own waivers and forms, and who has accepted them', route: '/(trainer)/documents', icon: 'pencil', keywords: 'document documents waiver par-q parq form consent house rules paperwork upload accepted acceptance required studio' },
  { key: 'broadcast', label: 'Broadcast', note: 'Message a whole segment of clients at once', route: '/(trainer)/broadcast', icon: 'message', keywords: 'broadcast announce message all clients bulk segment tag push' },
  { key: 'broadcast-session', label: 'Share a Session', note: 'Your clip and caption, into any app you post from', route: '/(trainer)/broadcast-session', icon: 'share', keywords: 'publish post social clip session caption platforms share marketing' },
  // ── the three that took no params and were listed nowhere ────────────────
  //
  // The exclusion rule above is about screens that need a route PARAM, and none
  // of these three takes one: grep `useLocalSearchParams` across brand.tsx,
  // group.tsx and share-kit.tsx returns nothing, so all three open perfectly
  // well from a search result. They were missing anyway, and each was reachable
  // from exactly one deep link — brand from a row at the bottom of Profile,
  // group from a Ghost inside Program Templates, share kit from a card at the
  // bottom of Share a Session. That is the same class of bug this file's own
  // header describes finding once already: a screen that exists, compiles, and
  // is findable only by somebody who already knows where it is.
  //
  // It was three again. The same grep now returns nothing for assistant.tsx,
  // costs.tsx and templates-messages.tsx either, and each of those was reachable
  // from exactly one deep link too — the assistant from a card at the bottom of
  // Analytics, costs from a row on Money, saved messages from a Ghost inside the
  // template picker inside a chat thread. All three are listed above, beside the
  // screen each is the other half of. What is left absent from this list is only
  // ever a screen that needs a param, and every one of those is named at the top
  // of this comment block with the reason.
  //
  // The keywords are what a coach TYPES rather than what the screen is called.
  // Nobody searches "share kit"; they search "poster", "story", "instagram" or
  // "graphic". Nobody searches "brand"; they search "my logo" or "my colour".
  { key: 'share-kit', label: 'Share Kit', note: 'Your real numbers as a card you can post', route: '/(trainer)/share-kit', icon: 'share', keywords: 'share kit card graphic poster image story post instagram facebook social marketing promo advert testimonial results numbers screenshot' },
  { key: 'brand', label: 'Your Branding', note: 'The name and colour your clients see around your coaching', route: '/(trainer)/brand', icon: 'sparkle', keywords: 'brand branding logo colour color accent trading name business name my brand white label look identity theme' },
  { key: 'group', label: 'Program Groups', note: 'One programme, assigned to a whole group at once', route: '/(trainer)/group', icon: 'people', keywords: 'group groups bootcamp cohort squad team program programme assign many bulk class block eight week challenge' },
  { key: 'analytics', label: 'Analytics', note: 'Adherence, revenue & at-risk clients', route: '/(trainer)/analytics', icon: 'chart', keywords: 'stats retention revenue' },
  // Under Analytics, because it answers the same figures in sentences. Reached
  // from one card at the bottom of that screen and from nowhere else, while the
  // MEMBER has had a conversational coach on their own tab since it shipped.
  //
  // The keywords are the question rather than the noun: nobody searches
  // "assistant", they search "how am I doing" or "why is my revenue down". It
  // deliberately carries no client word — it cannot name a client and will not
  // rank them, and a coach searching "who should I message" must land on Quiet
  // Clients, which can actually answer that.
  { key: 'assistant', label: 'Ask About Your Business', note: 'A conversation about your own numbers, not your clients', route: '/(trainer)/assistant', icon: 'chat', keywords: 'ask assistant ai chat question questions how am i doing how is my business going what should i do advice digest monday summary explain my numbers why is revenue down retention adherence talk to' },
  { key: 'ad-spend', label: 'Ad Spend', note: 'What your ads cost, and what they brought in', route: '/(trainer)/ad-spend', icon: 'trending', keywords: 'ads ad spend marketing cost cac attribution campaign meta google leads' },
  // The other half of the funnel. Ad Spend above carries 'leads' as a keyword
  // and always has, from back when there was nothing to land on — so this row
  // has to out-describe it for the word that used to find only the money.
  // 'enquiry', 'enquiries' and 'inquiry' are all here because the coach who
  // types one of them is not going to try the others, and 'form', 'contact' and
  // 'waiting list' are what the same thing is called by the coaches who have
  // run one on a different platform.
  { key: 'leads', label: 'Enquiries', note: 'People who asked about coaching without joining', route: '/(trainer)/leads', icon: 'message', keywords: 'lead leads enquiry enquiries inquiry inquiries prospect prospects form contact details signup sign up waiting list interested asked about follow up followup capture funnel join link' },
  { key: 'leaderboard', label: 'Leaderboard', note: 'Rank clients by consistency', route: '/(trainer)/leaderboard', icon: 'trophy', keywords: 'ranking standings' },
  // The growth channel that costs a coach nothing and that they could not see.
  // `referrals` carries one select policy and it is the referred user's, so a
  // client who had brought four people onto the book looked identical to one who
  // had brought none. Counts only — the keywords carry 'reward', 'credit' and
  // 'discount' because they are what a coach searches, and the screen's whole
  // job is to say that this app has not decided any of them.
  { key: 'referrals', label: 'Who Brings You Clients', note: 'The clients bringing you other clients, and how far they got', route: '/(trainer)/referrals', icon: 'people', keywords: 'referral referrals referred refer a friend word of mouth recommend recommendation brought in introduced invite code who is sending me clients reward credit discount thank you loyalty advocate' },
  // The answer to "where is my code?", which had none. The six characters lived
  // on a modal sheet on the Clients tab titled Invite a Client, and nothing on
  // any screen said the sheet held them; /(trainer)/money and /(trainer)/ad-spend
  // show the same codes answering a different question — what each one returned.
  //
  // Keyworded with what a coach says out loud rather than what the field is
  // called. "my code", "coach code", "trainer code", "join code" and "invite
  // code" are the same thing to five different people; "how do clients find me"
  // and "sign up with me" are what somebody types who does not know a code
  // exists at all. 'qr' is deliberately here and the screen has none — landing
  // that search on the screen that offers the link and the share sheet beats
  // landing it nowhere.
  { key: 'join-code', label: 'Your Code', note: 'The code and link you hand somebody standing in front of you', route: '/(trainer)/join-code', icon: 'share', keywords: 'code my code coach code coaching code trainer code join code invite code join link invite link share code give out hand out sign up with me add me how do clients find me how do they join onboard new client six characters qr' },
  // Searched for with the words a coach actually types when they are worried
  // about money — "how much did I make", "profit", "income" — none of which
  // matched anything before this screen existed. It carries 'profit' and 'net'
  // as keywords while deliberately printing neither figure: those are the words
  // people search with, and landing them on the screen that explains why the
  // two halves are never subtracted is better than landing them nowhere.
  //
  // The channel words are here for the same reason and are not duplicates of
  // the Ad Spend row below. That row is the CONNECTION — an ad account, and the
  // spend that matched no code. This screen is the ANSWER: what each code cost,
  // what the people off it paid, what each of them cost to get, and whether the
  // gap between two channels means anything at all. A coach typing "which of my
  // ads is working" or "cost per client" wants the second, and until this
  // section existed the only screen that held it was a sheet inside the Clients
  // screen that search cannot reach and no coach would think to open.
  { key: 'money', label: 'Money', note: 'What came in and what went out, kept apart', route: '/(trainer)/money', icon: 'chart', keywords: 'money earnings income takings revenue paid profit net owe owed outgoings expenses spend overview how much did i make ledger join code codes channel channels which ads are working cost per client cac acquisition attribution last touch return on ad spend roas campaign worked' },
  { key: 'payments', label: 'Payments & Packages', note: 'Get paid, and set what you sell', route: '/(trainer)/payments', icon: 'grid', keywords: 'payments payouts stripe connect packages packs memberships sell price get paid earnings' },
  { key: 'billing', label: 'Billing & Subscription', note: 'Your own plan and invoices', route: '/(trainer)/billing', icon: 'grid', keywords: 'billing subscription plan invoice card payment method upgrade downgrade cancel my plan' },
  // The coach's own training, food and body. Three separate screens because a
  // coach looking for their own workout log does not search "nutrition" — and
  // this app spent a long time assuming a trainer never trains.
  { key: 'my-training', label: 'My Training', note: 'Your own workout log', route: '/(trainer)/my-training', icon: 'train', keywords: 'my training own workout log lift my workouts personal record myself' },
  { key: 'my-nutrition', label: 'My Nutrition', note: 'Your own food log, calories & macros', route: '/(trainer)/my-nutrition', icon: 'meals', keywords: 'my nutrition own food log calories macros diet eating myself' },
  { key: 'my-progress', label: 'My Progress', note: 'Your own body stats, weight trend & scans', route: '/(trainer)/my-progress', icon: 'trending', keywords: 'my progress own body weight scan inbody stats trend myself' },
  // The fourth of the coach's own screens, and the one that feeds the other
  // three. Until it existed the only way a coach could connect anything was
  // the single Apple Health button inside My Nutrition, so a coach wearing a
  // WHOOP searched 'whoop', found nothing, and had no reason to think the app
  // could read it — while the client build had read WHOOP for months. The
  // keywords carry the brand names for exactly that search.
  { key: 'devices', label: 'Watch & Devices', note: 'Connect your own watch, ring or strap', route: '/(trainer)/devices', icon: 'clock', keywords: 'watch devices wearable apple watch healthkit health whoop oura ring garmin fitbit google fit health connect heart rate hrv resting steps calories strap band connect my watch myself' },
  { key: 'feedback', label: 'Send Feedback', note: 'Report a bug or share an idea', route: '/(trainer)/feedback', icon: 'message', keywords: 'feedback bug idea report suggest' },
  // 'how i coach', 'online', 'in person' and 'hybrid' are here because Profile
  // is where the answer is CHANGED (part 410), and a coach who wants their
  // calendar back, or who has stopped training people in the room, will search
  // for the situation rather than for the setting.
  { key: 'profile', label: 'Profile', note: 'Your bio, offers, rate & how you coach', route: '/(trainer)/profile', icon: 'me', keywords: 'bio rate offers public profile how i coach how you coach online in person inperson hybrid remote delivery mode both change how i work set up' },
  // Sign out lives here, and it was findable from nowhere.
  { key: 'settings', label: 'Settings', note: 'Account, sign out, your data & version', route: '/(trainer)/settings', icon: 'settings', keywords: 'settings account sign out signout log out logout export my data delete account version build units' },
  // The coach's own Getting Started, and it is listed for the same reason the
  // client's is: the dashboard row disappears the moment the list is finished,
  // and a screen reachable only from a row that removes itself is a screen that
  // becomes unreachable by being used. 'tutorial', 'how do i' and 'lost' are
  // here because they are what somebody types when they are.
  { key: 'getting-started', label: 'Getting Started', note: 'What is set up, and what is still worth doing', route: '/(trainer)/getting-started', icon: 'sparkle', keywords: 'getting started get started setup set up onboarding first run new tutorial guide help how do i where do i begin checklist what next lost confused currency rate stripe package join code availability waiver how i coach online in person hybrid' },
  { key: 'notifications', label: 'Notifications', note: 'Coaching requests, bookings, subscriptions and anything sent to you', route: '/(trainer)/notifications', icon: 'bell', keywords: 'notification notifications inbox alerts push updates announcements unread bell request requests coaching request join code accepted document documents paperwork waiver signed subscription subscriptions payment failed past due churn cancelled ended booking cancellation' },
  // The coach's thread list. It carries 'inbox' and 'unread' as keywords even
  // though the row above does too, and that is deliberate rather than sloppy:
  // both are words a coach uses for this, and a search that returns only the
  // bell for "unread" sends somebody looking for a client's message to a list
  // of booking confirmations they cannot reply from. The notes are what
  // separate them.
  { key: 'messages', label: 'Messages', note: 'Every client conversation, and who is waiting on a reply', route: '/(trainer)/messages', icon: 'message', keywords: 'message messages chat thread threads conversation conversations inbox unread reply client dm talk wrote' },
  // Directly under Messages, and reachable until now from ONE place: a Ghost
  // inside the template picker inside a chat thread. So the library a coach
  // writes once and reuses thirty times could only be edited by opening a
  // conversation with somebody, which is the wrong moment to be editing a
  // template — see the header of templates-messages.tsx.
  //
  // Not keyworded 'template' alone: that word already belongs to the PROGRAMME
  // library two rows from the top, and a coach who types it wants whichever of
  // the two they were thinking of. Both rows carry it and their notes are what
  // separate them.
  { key: 'templates-messages', label: 'Saved Messages', note: 'The replies you write once and send again', route: '/(trainer)/templates-messages', icon: 'message', keywords: 'saved messages message template templates canned reply quick reply snippet shortcut boilerplate welcome message check in message write once reuse again standard wording' },
];

export const OWNER_NAV: NavItem[] = [
  // Six of nineteen screens, and two of the six described the app this used to
  // be: "Platform health" and "Trainers & Billing — Roster, invites, plans &
  // MRR", when what a trainer pays Repple was removed from that screen on the
  // grounds that it is not a gym owner's business. Members, Rota, Equipment,
  // Deletion Requests, Revenue, Financial Checks, Promotions, Classes, the
  // Library and Settings were all unreachable from search.
  //
  // Ops carries the session-fee keyword deliberately: three screens tell an
  // owner to "set a session fee in Ops", so a search for "fee" has to land
  // there. `explore` is the search screen itself, and `exercise` needs a name
  // param it cannot be given from a bare route push — both stay out.
  { key: 'overview', label: 'Overview', note: 'Your gym at a glance', route: '/(owner)/dashboard', icon: 'grid', keywords: 'dashboard home metrics' },
  { key: 'trainers', label: 'Trainers', note: 'Your coaching staff, what they delivered, and invites', route: '/(owner)/trainers', icon: 'people', keywords: 'roster invite staff coach delivered sessions health' },
  { key: 'members', label: 'Members', note: 'Memberships, freezes, cancellations and taking a payment', route: '/(owner)/members', icon: 'people', keywords: 'member membership freeze cancel payment plan renew desk' },
  { key: 'revenue', label: 'Revenue', note: 'Sessions delivered, the trend and value per client', route: '/(owner)/revenue', icon: 'trending', keywords: 'revenue forecast unit economics value per client sessions trend' },
  // `gym_orders` has been written by the checkout function since part 281 and
  // read by nothing on the gym's side, so the one question a desk is actually
  // asked — did my payment go through — had no screen to answer it.
  { key: 'orders', label: 'Online Orders', note: 'What members bought from your Stripe account, and what needs a person', route: '/(owner)/orders', icon: 'chart', keywords: 'order orders online checkout stripe receipt bought purchase paid refund payout reconcile' },
  { key: 'financials', label: 'Financial Checks', note: 'KPIs and a rule-based read of the figures you enter', route: '/(owner)/financials', icon: 'chart', keywords: 'financial health kpi retention margin expenses review' },
  { key: 'classes', label: 'Classes & Payroll', note: 'Class fill rates, and trainer pay from check-ins', route: '/(owner)/class-analytics', icon: 'calendar', keywords: 'class attendance fill rate payroll pay per attendee analytics' },
  { key: 'brand', label: 'Brand Studio', note: "Your gym's name and colour, saved to the gym", route: '/(owner)/brand', icon: 'palette', keywords: 'white label brand name colour theme palette rename' },
  { key: 'growth', label: 'Growth', note: 'Signups, funnel & promos', route: '/(owner)/growth', icon: 'trending', keywords: 'marketing funnel promos' },
  { key: 'promotions', label: 'Promotions', note: 'Create a code and push it to every member', route: '/(owner)/promotions', icon: 'sparkle', keywords: 'promo promotion code discount push offer campaign' },
  { key: 'ops', label: 'Operations', note: 'Session fee, announcements, support & gym activity', route: '/(owner)/ops', icon: 'wrench', keywords: 'session fee rate payroll basis support inbox announce activity log' },
  { key: 'rota', label: 'Trainer Rota', note: 'Who is on the floor when, against what is booked', route: '/(owner)/rota', icon: 'calendar', keywords: 'rota shift roster cover floor schedule staffing' },
  { key: 'equipment', label: 'Equipment Register', note: 'What the gym owns, and what is due a service', route: '/(owner)/equipment', icon: 'wrench', keywords: 'equipment kit machine service maintenance repair register asset' },
  { key: 'library', label: 'Exercise Library', note: 'Every movement the app can teach, and the kit each one needs', route: '/(owner)/library', icon: 'dumbbell', keywords: 'exercise library movement catalogue video demo coverage' },
  { key: 'deletions', label: 'Deletion Requests', note: 'Members who asked to be erased, and the 30-day clock', route: '/(owner)/deletions', icon: 'clock', keywords: 'delete deletion erase gdpr account removal request privacy' },
  { key: 'feedback', label: 'Feedback Inbox', note: 'What testers are saying', route: '/(owner)/feedback', icon: 'message', keywords: 'feedback testers bugs ideas reviews' },
  { key: 'settings', label: 'Settings', note: 'Who you are signed in as, your data, and deleting your account', route: '/(owner)/settings', icon: 'settings', keywords: 'settings account sign out signout log out logout export data delete account' },
  { key: 'notifications', label: 'Notifications', note: 'What the gym has been told, in one list', route: '/(owner)/notifications', icon: 'bell', keywords: 'notification notifications inbox alerts push updates announcements unread bell' },
];

export function searchNav(list: NavItem[], q: string): NavItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((f) =>
    f.label.toLowerCase().includes(s) ||
    f.note.toLowerCase().includes(s) ||
    (f.keywords ? f.keywords.toLowerCase().includes(s) : false)
  );
}
