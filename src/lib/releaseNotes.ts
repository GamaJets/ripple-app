// What changed, written for the person who will read it.
//
// One source of truth for three places: the What's New sheet inside each app,
// the "What to Test" text pasted into TestFlight, and the Play release notes.
// They drifted before because each was written by hand at a different moment;
// scripts/release-notes.mjs now prints the store text from this file, so a
// change described to a tester is the same change described in the app.
//
// ── House rules for writing these ─────────────────────────────────────────
//
// Say what the reader can now do, or what stopped being wrong for them. Not
// the mechanism. "Exercise videos load again" — not "fixed RLS recursion in
// exercise_videos". A tester cannot act on the second one and does not care.
//
// Fixes for things people actually hit are worth listing even when they are
// embarrassing: somebody spent twenty minutes failing to reset a password, and
// seeing it named is how they learn to try again.
//
// Every entry names the apps it applies to. The three share a codebase and
// almost nothing else from a user's point of view, and a coach reading about
// a client-only change learns only that the notes are not for them.

import { VARIANT, type AppVariant } from './variant';

export type Audience = AppVariant; // 'client' | 'trainer' | 'owner'

export interface ReleaseEntry {
  /** One line, sentence case, no trailing full stop. What the reader can do. */
  title: string;
  /** Optional second line: the detail that makes it actionable. */
  note?: string;
  /** Which apps this appears in. */
  apps: Audience[];
  /** 'new' adds something; 'fixed' stops something being wrong. */
  kind: 'new' | 'fixed';
}

export interface Release {
  /** Marketing version, matching app.json. */
  version: string;
  /** ISO date the build went out. */
  date: string;
  /**
   * One sentence for the top of the sheet, per app.
   *
   * Per app, not shared: the first draft promised Studio owners they could now
   * "join your coach with a code", which is a client feature they will never
   * see. A headline naming things the reader does not get is worse than none,
   * because it is the only line most people read.
   */
  headlines?: Partial<Record<Audience, string>>;
  entries: ReleaseEntry[];
}

const ALL: Audience[] = ['client', 'trainer', 'owner'];

/**
 * Newest first. Add to the top; never rewrite a shipped entry — somebody has
 * already read it, and a note that changes after the fact is worse than none.
 */
export const RELEASES: Release[] = [
  {
    version: '1.2.0',
    date: '2026-08-31',
    headlines: {
      client:  'Injuries your plan works around, bookings that no longer claim to have happened, and a release to read before you start.',
      trainer: 'Injuries in front of you before you write the plan, a package that renews, time you can block out, and your own training in the same app.',
      owner:   'Figures that say when they could not be read, and an account that opens only in your own gym’s app.',
    },
    entries: [
      {
        kind: 'new',
        apps: ['client'],
        title: 'Blood sugar from your monitor, beside what you ate',
        note: 'Meals › Blood Sugar. A Dexcom, or a Libre through its own app, writes into Apple Health and Repple reads it from there. Your coach sees none of it until you turn sharing on, and turning it off again hides the history too.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'A client can choose to show you their glucose readings',
        note: 'On their page, when they have turned it on. Readings and what they ate — not advice, and not something you can switch on for them.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'Tell your coach about an injury, and have your plan work around it',
        note: 'Me › Injuries. Type it in, or photograph a physio report or pick a PDF and we will read it back to you. Nothing is saved until you confirm it, and your coach is told the injury, never the document.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'Injuries a client discloses reach you before you write their plan',
        note: 'They sit on the client’s page, and the program builder waits until you have read them. A new disclosure asks again; a client recovering does not.',
      },
      {
        kind: 'fixed',
        apps: ['client', 'trainer'],
        title: 'A disclosed injury no longer vanishes on the way to the coach',
        note: 'It was written in one shape and read back in another, so it arrived as nothing at all.',
      },
      {
        kind: 'fixed',
        apps: ['client', 'trainer'],
        title: 'A booking that did not save no longer says it did',
        note: 'The confirmation waits for the server. Two people can no longer hold the same time, and the diary you are shown is the one the server has.',
      },
      {
        kind: 'fixed',
        apps: ['client', 'trainer'],
        title: 'Cancelled time is free to book again straight away',
        note: 'The slot used to be announced as free before it was released, so the next person to try it was refused.',
      },
      {
        kind: 'new',
        apps: ['client', 'trainer'],
        title: 'Sessions can start on any quarter hour, at any hour of the day',
        note: 'And a day with nothing to book says why, instead of showing an empty week.',
      },
      {
        kind: 'new',
        apps: ['trainer', 'client'],
        title: 'A coach can block out time they are not available',
        note: 'Schedule › Manage › Block Out Time, for a whole day or a from-and-until pair. Blocked time is not an open slot and nobody can book it.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'Sell a package that renews every month',
        note: 'Choose a billing interval when you create it. Packages already on sale are unchanged, and a price you raise later applies only to people who subscribe after it.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'See what each of your join codes actually returned',
        note: 'Clients it brought, how many are still with you, what they have spent, and what you say the campaign cost. Two codes are only ranked when there are enough clients to tell them apart.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'Track your own training, meals and progress',
        note: 'Clients › Coaching Tools. It is your log, not a client’s, and nobody you coach can see it.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'A release of liability, asked once and recorded against your account',
        note: 'It appears however you signed in, and only asks again if the wording changes. Clearing the app does not clear your agreement.',
      },
      {
        kind: 'new',
        apps: ALL,
        title: 'Confirm your email with a six-digit code instead of a link',
        note: 'The code is in the same email. Asking for another one tells you plainly when nothing was sent.',
      },
      {
        kind: 'fixed',
        apps: ['trainer'],
        title: 'Unread message counts are read rather than assumed',
        note: 'The roster printed “Unread 0” beside every client, the ones waiting on a reply included. A count that cannot be read now shows a dash.',
      },
      {
        kind: 'fixed',
        apps: ['client', 'trainer'],
        title: 'A message can no longer be sent in your coach’s name',
        note: 'Who sent a message is decided where it is stored, not by the app that sent it.',
      },
      {
        kind: 'fixed',
        apps: ['trainer'],
        title: 'Your roster stops listing the same client twice, and stops failing quietly',
        note: 'A roster that could not be read looked exactly like a roster with nobody on it.',
      },
      {
        kind: 'new',
        apps: ['client', 'trainer'],
        title: 'Every movement in the exercise library shows how it is done',
        note: 'Overhead Press and five others had nothing to show. The demos are served by Repple now, so they load in a gym with poor signal.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'A movement you type in is added to the library',
        note: 'So a program you build from it shows your client the same demo as everything else.',
      },
      {
        kind: 'fixed',
        apps: ['owner'],
        title: 'Console figures show a dash when they could not be read',
        note: 'Members, revenue and payroll totals used to report nought for a read that failed, which is indistinguishable from genuinely none.',
      },
      {
        kind: 'fixed',
        apps: ALL,
        title: 'Your account opens only in the app for your gym',
        note: 'Signing in to another brand’s app signs you straight back out and says why, rather than showing you somebody else’s gym.',
      },
      {
        kind: 'fixed',
        apps: ALL,
        title: 'Back returns to where you came from',
        note: 'It used to go to the tab a screen belonged to, which is rarely where you were.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-27',
    headlines: {
      client:  'Face ID, joining your coach with a code, and a long list of things that were quietly wrong.',
      trainer: 'Face ID, a coaching code that reaches anyone, and logging the session you just ran.',
      owner:   'Face ID, and figures that admit when they could not be read instead of showing you a zero.',
    },
    entries: [
      {
        kind: 'new',
        apps: ALL,
        title: 'Face ID and Touch ID',
        note: 'Turn it on under Settings › Security. Your passcode still works if a face will not read in a dark gym.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'Join your coach with a six-character code',
        note: 'Ask your coach for their code and enter it under Find a trainer. It works even if they are not listed in the directory.',
      },
      {
        kind: 'new',
        apps: ['trainer'],
        title: 'A coaching code you can read out',
        note: 'Under Clients › Add a client. It reaches people whatever address they signed up with, which an email invitation cannot.',
      },
      {
        kind: 'new',
        apps: ['trainer', 'client'],
        title: 'Coaches can log the session they just ran',
        note: 'It lands in the client’s own history and counts towards their progress, PRs and calories. The client can correct it, and both sides see who logged it.',
      },
      {
        kind: 'fixed',
        apps: ['trainer', 'client'],
        title: 'Exercise Videos Load Again',
        note: 'The library was returning nothing for everyone signed in. It was not empty; it could not be read.',
      },
      {
        kind: 'fixed',
        apps: ALL,
        title: 'Password rules are shown before you are refused',
        note: 'Eight characters with a capital, a number and a symbol — all listed as you type. The apps used to say six and then refuse it.',
      },
      {
        kind: 'fixed',
        apps: ['client'],
        title: 'Your session pack is no longer reported as empty when it cannot be read',
        note: 'A pack you have paid for showed as nothing at all if the read failed, and the warning that a booking had not been deducted was hidden.',
      },
      {
        kind: 'fixed',
        apps: ALL,
        title: 'Figures we cannot read show a dash instead of a zero',
        note: 'A roster, an inbox or a payroll total that failed to load used to render as 0 — indistinguishable from genuinely none.',
      },
      {
        kind: 'fixed',
        apps: ['client', 'trainer'],
        title: 'Class spaces are honest about what is unknown',
        note: 'A full class could show every place free, and never showed as full to the coach.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'Sauna Counts as Recovery',
        note: 'And Recovery is one thing now, not two screens using the word differently.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'A Sign-out Button',
        note: 'Under Me › Settings. There was not one.',
      },
      {
        kind: 'fixed',
        apps: ALL,
        title: 'The signup screen no longer asks which kind of account you want',
        note: 'The app you downloaded already decided. Picking the other one led nowhere.',
      },
      {
        kind: 'fixed',
        apps: ['owner'],
        title: 'The owner app calls itself Repple Studio',
        note: 'It introduced itself as Repple HQ in places, and averaged figures over trainers who were not there.',
      },
    ],
  },
];

/** The releases relevant to one app, with entries for other apps removed. */
export function releasesFor(audience: Audience, releases: Release[] = RELEASES): Release[] {
  return releases
    .map((r) => ({ ...r, entries: r.entries.filter((e) => e.apps.includes(audience)) }))
    .filter((r) => r.entries.length > 0);
}

/**
 * The newest release this bundle carries, and therefore the one the reader is
 * running.
 *
 * NOT the marketing version out of app.json. These notes ship inside the
 * JavaScript bundle, and expo-updates replaces that bundle over the air without
 * touching app.json — the app auto-applies an update on launch (see
 * app/_layout.tsx), so somebody can be running four releases' worth of changes
 * while `expoConfig.version` still reads 1.1.0. Keyed on the version stamped in
 * the marketing version, a reader who took every OTA update would be told about
 * nothing and a reader who took none would be told about everything.
 *
 * The list is the honest answer to "what is in this build", because the list is
 * IN this build.
 */
export const CURRENT_RELEASE: string = RELEASES[0]?.version ?? '0.0.0';

/**
 * Whether a stored value is something this module is willing to compare.
 *
 * The stored "last seen" comes off the device, and a device is not a promise.
 * It can hold a truncated write, a value from a much older shape of this
 * feature, or somebody's debugging. compareVersions() would happily read
 * "corrupt" as 0 and conclude the reader has seen nothing since the beginning
 * of time — which is the loud failure, not the quiet one: every note ever
 * written, to somebody who has read them all.
 */
export function isVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d+(\.\d+)*$/.test(v.trim());
}

/**
 * Which releases to show somebody who was last shown release `seen`, running
 * release `current`.
 *
 * `null` — a brand-new account, or the first run after this feature shipped —
 * shows NOTHING. A new account has missed nothing; the whole app is new to
 * them, and opening it for the first time to a list of things that used to be
 * broken explains nothing and is the single most common way this feature turns
 * into an annoyance. They are told from their second release onward.
 *
 * Anything unreadable is treated the same way, deliberately: a value we cannot
 * place is not evidence that somebody is behind.
 *
 * Capped at `current` because a release the running bundle does not contain has
 * not happened for this reader, whatever the list says. Notes are written and
 * committed before the build that carries them goes out.
 */
export function unseenReleases(seen: string | null, current: string, audience: Audience, releases: Release[] = RELEASES): Release[] {
  if (!isVersion(seen) || !isVersion(current)) return [];
  const from = seen.trim();
  const to = current.trim();
  if (from === to) return [];
  return releasesFor(audience, releases).filter(
    (r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0,
  );
}

/** Semver-ish compare on dot-separated numbers. Returns >0 when a is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Plain-text notes for App Store Connect / Play, for one app and version. */
export function storeNotes(audience: Audience, version: string, releases: Release[] = RELEASES): string {
  const r = releasesFor(audience, releases).find((x) => x.version === version);
  if (!r) return '';
  const lines: string[] = [];
  const headline = r.headlines?.[audience];
  if (headline) { lines.push(headline, ''); }
  const news = r.entries.filter((e) => e.kind === 'new');
  const fixes = r.entries.filter((e) => e.kind === 'fixed');
  if (news.length) {
    lines.push('NEW');
    for (const e of news) lines.push(`• ${e.title}${e.note ? ` — ${e.note}` : ''}`);
    if (fixes.length) lines.push('');
  }
  if (fixes.length) {
    lines.push('FIXED');
    for (const e of fixes) lines.push(`• ${e.title}${e.note ? ` — ${e.note}` : ''}`);
  }
  return lines.join('\n');
}

/** This build's audience. */
export const MY_AUDIENCE: Audience = VARIANT;
