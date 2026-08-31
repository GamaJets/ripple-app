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
// ── What is deliberately NOT listed ────────────────────────────────────────
//
// Explore pushes `route` with no params. So a screen that needs one cannot go in
// this list, however useful it is — the row would open a screen with nothing in
// it, which is a worse answer to a search than no row at all.
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
  { key: 'tools', label: 'Lifting Tools', note: '1RM, plate math & macro reference', route: '/(client)/tools', icon: 'settings', area: 'train', keywords: 'calculator 1rm plates macros' },
  { key: 'recovery', label: 'Recovery', note: 'Hydration, sleep & mobility', route: '/(client)/recovery', icon: 'water', area: 'train', keywords: 'sleep hydration mobility rest' },
  { key: 'habits', label: 'Daily Habits', note: 'Habits & water tracker', route: '/(client)/habits', icon: 'check', area: 'train', keywords: 'water streak daily' },
  { key: 'calendar', label: 'Book a Session', note: 'Month calendar · book your coach', route: '/(client)/calendar', icon: 'calendar', area: 'train', keywords: 'booking session appointment', soloHide: true },
  { key: 'injuries', label: 'Injuries & Limitations', note: 'Train around injuries — safer swaps', route: '/(client)/injuries', icon: 'heart', area: 'train', keywords: 'injury injuries pain limitation niggle shoulder knee back hurt rehab physio safer swaps avoid' },
  // Listed separately from Injuries rather than folded into it: somebody
  // holding a physio report in their hand is looking for "upload", "scan" or
  // "report", not for the manual entry screen, and the two do genuinely
  // different things.
  { key: 'injury-doc', label: 'Read an Injury From a Document', note: 'Photograph a physio or scan report', route: '/(client)/injury-doc', icon: 'camera', area: 'train', keywords: 'injury document physio report scan letter mri x-ray upload photo ocr extract' },
  { key: 'scan-machine', label: 'Scan a Machine', note: 'Point at a gym machine and log the set', route: '/(client)/scan-machine', icon: 'camera', area: 'train', keywords: 'scan machine qr barcode code gym equipment log set cardio rower bike' },
  { key: 'reminders', label: 'Reminders', note: 'Hydration & supplement nudges', route: '/(client)/reminders', icon: 'bell', area: 'train', keywords: 'reminder reminders water hydration supplement nudge alarm notification daily' },

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
  { key: 'pt-sessions', label: 'Personal Training', note: 'Approve delivered PT sessions', route: '/(client)/pt-sessions', icon: 'people', area: 'me', keywords: 'personal training pt sessions approve delivered package trainer' },
  { key: 'bookings', label: 'My Bookings', note: 'Classes & PT in one place', route: '/(client)/bookings', icon: 'check', area: 'me', keywords: 'my bookings booked classes pt sessions upcoming cancel schedule' },

  // ── Progress & Insights ───────────────────────────────────
  { key: 'report', label: 'Weekly Report', note: 'Your week at a glance · share it', route: '/(client)/report', icon: 'chart', area: 'progress', keywords: 'summary' },
  { key: 'consistency', label: 'Consistency', note: '12-week training heatmap', route: '/(client)/consistency', icon: 'flame', area: 'progress', keywords: 'heatmap streak' },
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
  { key: 'checkin', label: 'Weekly Check-in', note: 'Send your coach a weekly pulse', route: '/(client)/checkin', icon: 'pencil', area: 'progress', keywords: 'weight mood energy coach', soloHide: true },
  { key: 'activity', label: 'Activity', note: 'Your training feed & updates', route: '/(client)/activity', icon: 'bell', area: 'progress', keywords: 'feed updates' },
  { key: 'trends', label: 'Trends', note: 'Weekly volume & estimated 1RM over time', route: '/(client)/trends', icon: 'trending', area: 'progress', keywords: 'trend trends graph chart volume tonnage 1rm estimated over time progress' },
  { key: 'body-trends', label: 'Composition Trends', note: 'Weight, body fat, muscle & InBody score over time', route: '/(client)/body-trends', icon: 'trending', area: 'progress', keywords: 'body composition trend weight body fat skeletal muscle inbody score graph over time' },
  // The long view, and the only screen in the app that shows more than ten
  // weeks. 'year' and 'months' are in the keywords because that is what the
  // question sounds like when a member asks it.
  { key: 'history', label: 'Your History', note: 'Months and years, not weeks', route: '/(client)/history', icon: 'clock', area: 'progress', keywords: 'history long view year years months all time how far have i come past archive' },

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
  { key: 'offers', label: 'Offers', note: 'Redeem a code from your gym', route: '/(client)/offers', icon: 'grid', area: 'me', keywords: 'offer offers code promo promotion discount voucher redeem coupon' },
  { key: 'referral', label: 'Invite Friends', note: 'Share the app with a friend', route: '/(client)/referral', icon: 'share', area: 'me', keywords: 'refer referral invite friend share code' },
  { key: 'devices', label: 'Watch & Devices', note: 'Apple Watch, WHOOP, Garmin…', route: '/(client)/devices', icon: 'clock', area: 'me', keywords: 'apple watch wearable heart rate' },
  { key: 'music', label: 'Music & Playlists', note: 'AI workout playlists', route: '/(client)/music', icon: 'play', area: 'me', keywords: 'spotify playlist songs' },
  { key: 'appearance', label: 'Appearance', note: 'Theme & accent colour', route: '/(client)/appearance', icon: 'palette', area: 'me', keywords: 'theme dark light colour' },
  { key: 'settings', label: 'Settings', note: 'Account, notifications, units, legal & version', route: '/(client)/settings', icon: 'settings', area: 'me', keywords: 'notifications units legal about sign out signout log out logout account' },
  { key: 'feedback', label: 'Send Feedback', note: 'Tell us what to improve', route: '/(client)/feedback', icon: 'message', area: 'me', keywords: 'feedback bug idea report suggest' },
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
//   · client, client-body, client-week, client-photos, chat  — all need
//     `clientId`; they are reached by tapping the person on the roster, which is
//     the only place the id exists.
//   · exercise            — needs `name`; the Exercise Library is the way in.
//   · class-checkin       — needs the class `id`. Opened without one it falls
//     back to UNLINKED_CLASS, which both classRoster and setAttendance refuse by
//     name, so the row would lead to a screen that cannot save anything.
//   · log-session         — needs `clientId`, and it does NOT have a client
//     picker. A coach can type out a whole session on it and is only told there
//     is "nobody to log against" when they press save, which is the worst
//     possible moment. It is reached from the client's own screen. Listing it
//     would turn a search result into lost work; give it a picker and it belongs
//     here.
//
// checklists and client-goals both DO have a roster picker built in and open
// perfectly well with no params, which is why they are listed and the rest of
// the per-client screens are not.
export const TRAINER_NAV: NavItem[] = [
  { key: 'clients', label: 'Clients', note: 'Your roster, progress & detail', route: '/(trainer)/dashboard', icon: 'people', keywords: 'roster invite add' },
  { key: 'builder', label: 'Programs', note: 'Build & assign training programs', route: '/(trainer)/builder', icon: 'train', keywords: 'program template workout' },
  { key: 'templates', label: 'Program Templates', note: 'Build once, assign to many clients', route: '/(trainer)/templates', icon: 'grid', keywords: 'template library bulk assign program reuse' },
  { key: 'schedule', label: 'Schedule', note: 'Calendar, availability & bookings', route: '/(trainer)/calendar', icon: 'calendar', keywords: 'sessions availability booking' },
  { key: 'sessions', label: 'Mark What Happened', note: 'Past sessions nobody has recorded yet', route: '/(trainer)/sessions', icon: 'check', keywords: 'sessions outcome mark attended no show noshow completed queue payroll unrecorded' },
  { key: 'classes', label: 'Classes', note: 'Create and manage group classes', route: '/(trainer)/classes', icon: 'calendar', keywords: 'class classes group schedule branch capacity room instructor hiit spin yoga' },
  { key: 'videos', label: 'Videos', note: 'Exercise video library', route: '/(trainer)/videos', icon: 'video', keywords: 'exercise demo upload' },
  { key: 'library', label: 'Exercise Library', note: 'What you can programme, and what you have filmed', route: '/(trainer)/library', icon: 'grid', keywords: 'exercise library catalogue movements coverage filmed clips muscles' },
  { key: 'checklists', label: 'Client Checklists', note: 'The daily lines you set one client', route: '/(trainer)/checklists', icon: 'check', keywords: 'checklist checklists daily tasks habits client adherence ticked' },
  { key: 'client-goals', label: 'Working Toward', note: 'What a client is aiming at, and how it is going', route: '/(trainer)/client-goals', icon: 'target', keywords: 'goal goals target working toward client aim weight measurement' },
  { key: 'broadcast', label: 'Broadcast', note: 'Message a whole segment of clients at once', route: '/(trainer)/broadcast', icon: 'message', keywords: 'broadcast announce message all clients bulk segment tag push' },
  { key: 'broadcast-session', label: 'Share a Session', note: 'Your clip and caption, into any app you post from', route: '/(trainer)/broadcast-session', icon: 'share', keywords: 'publish post social clip session caption platforms share marketing' },
  { key: 'analytics', label: 'Analytics', note: 'Adherence, revenue & at-risk clients', route: '/(trainer)/analytics', icon: 'chart', keywords: 'stats retention revenue' },
  { key: 'ad-spend', label: 'Ad Spend', note: 'What your ads cost, and what they brought in', route: '/(trainer)/ad-spend', icon: 'trending', keywords: 'ads ad spend marketing cost cac attribution campaign meta google leads' },
  { key: 'leaderboard', label: 'Leaderboard', note: 'Rank clients by consistency', route: '/(trainer)/leaderboard', icon: 'trophy', keywords: 'ranking standings' },
  { key: 'payments', label: 'Payments & Packages', note: 'Get paid, and set what you sell', route: '/(trainer)/payments', icon: 'grid', keywords: 'payments payouts stripe connect packages packs memberships sell price get paid earnings' },
  { key: 'billing', label: 'Billing & Subscription', note: 'Your own plan and invoices', route: '/(trainer)/billing', icon: 'grid', keywords: 'billing subscription plan invoice card payment method upgrade downgrade cancel my plan' },
  // The coach's own training, food and body. Three separate screens because a
  // coach looking for their own workout log does not search "nutrition" — and
  // this app spent a long time assuming a trainer never trains.
  { key: 'my-training', label: 'My Training', note: 'Your own workout log', route: '/(trainer)/my-training', icon: 'train', keywords: 'my training own workout log lift my workouts personal record myself' },
  { key: 'my-nutrition', label: 'My Nutrition', note: 'Your own food log, calories & macros', route: '/(trainer)/my-nutrition', icon: 'meals', keywords: 'my nutrition own food log calories macros diet eating myself' },
  { key: 'my-progress', label: 'My Progress', note: 'Your own body stats, weight trend & scans', route: '/(trainer)/my-progress', icon: 'trending', keywords: 'my progress own body weight scan inbody stats trend myself' },
  { key: 'feedback', label: 'Send Feedback', note: 'Report a bug or share an idea', route: '/(trainer)/feedback', icon: 'message', keywords: 'feedback bug idea report suggest' },
  { key: 'profile', label: 'Profile', note: 'Your bio, offers & rate', route: '/(trainer)/profile', icon: 'me', keywords: 'bio rate offers public profile' },
  // Sign out lives here, and it was findable from nowhere.
  { key: 'settings', label: 'Settings', note: 'Account, sign out, your data & version', route: '/(trainer)/settings', icon: 'settings', keywords: 'settings account sign out signout log out logout export my data delete account version build units' },
];

export const OWNER_NAV: NavItem[] = [
  // Six of nineteen screens, and two of the six described the app this used to
  // be: "Platform health" and "Trainers & Billing — Roster, invites, plans &
  // MRR", when what a trainer pays Repple was removed from that screen on the
  // grounds that it is not a gym owner's business. Members, Rota, Equipment,
  // Deletion Requests, Revenue, Financial Health, Promotions, Classes, the
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
  { key: 'financials', label: 'Financial Health', note: 'KPIs and a review of the figures you enter', route: '/(owner)/financials', icon: 'chart', keywords: 'financial health kpi retention margin expenses review' },
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
