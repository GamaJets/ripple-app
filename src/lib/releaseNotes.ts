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
        title: 'Exercise videos load again',
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
        title: 'Sauna counts as recovery',
        note: 'And Recovery is one thing now, not two screens using the word differently.',
      },
      {
        kind: 'new',
        apps: ['client'],
        title: 'A sign-out button',
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
 * Which releases to show somebody who last opened version `seen`.
 *
 * `null` — a fresh install, or the first run after this feature shipped — shows
 * NOTHING. A brand-new user has nothing to catch up on, and opening an app for
 * the first time to a changelog about things they never saw broken is a poor
 * introduction. They see it from their second version onward.
 */
export function unseenReleases(seen: string | null, current: string, audience: Audience, releases: Release[] = RELEASES): Release[] {
  if (!seen) return [];
  if (seen === current) return [];
  return releasesFor(audience, releases).filter((r) => compareVersions(r.version, seen) > 0);
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
