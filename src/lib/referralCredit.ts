// What a referral is worth saying about, once there is something to say.
//
// ── Why this is a separate file from src/lib/referrals.ts ──────────────────
//
// referrals.ts is the network side: it imports `./supabase`, which imports
// AsyncStorage, which is a React Native module and cannot be `require`d by
// plain node. Every tested module under src/lib is pure for exactly that
// reason — the suite is `tsc && node .tmp/lib/*.test.js`, so a test that pulls
// in the Supabase client does not run at all. The rules below are the ones
// worth asserting on, so they live where a test can reach them, and
// referrals.ts calls in here rather than the other way round.
//
// ── The sentence this file exists to keep honest ───────────────────────────
//
// The Invite screen used to say a referral "can be credited once reward
// attribution is wired on the backend", which is a promise with no date on it,
// and it showed a count that came from `referral_count(code)` — a function that
// counted rows carrying a STRING, for anybody who typed one. There was no
// referrer, so nothing could ever be credited to a person.
//
// There is now attribution (supabase/parts/128), and there is still no reward,
// and those are two different facts that a screen must not blur together.
// Nobody — not the gym, not the coach — has agreed what a referral is worth, so
// this promises nothing and says so out loud. See REWARD_NOTE.
//
// ── Joined is not converted ────────────────────────────────────────────────
//
// A signup, a first session and a first payment are three different promises.
// The database makes the middle one and this module renders it: a referral has
// converted when the person who used the code logged their first workout. That
// distinction is the entire value of the screen — a referrer who is shown "4
// friends joined" learns nothing about whether any of them stayed — so the two
// counts are always rendered together and neither is ever inferred from the
// other.
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

/** A row of my_referrals(), as PostgREST hands it back. */
export interface RawReferral {
  friend_name: string | null;
  joined_at: string | null;
  /** When they logged their first workout, or null: they have not started. */
  started_at: string | null;
}

/** The same row, once it is safe to render. */
export interface ReferralRow {
  /** A first name and nothing else — see my_referrals()'s select list. */
  name: string;
  joinedAt: string;
  startedAt: string | null;
  converted: boolean;
}

/**
 * Raw rows → rows worth rendering, newest first.
 *
 * A row with no join date is dropped. It is the only thing on the row a reader
 * can orient by — "Sam · joined" with no date is a line that could be from
 * today or from March — and a placeholder date would be a made-up one.
 */
export function shapeReferrals(rows: RawReferral[] | null | undefined): ReferralRow[] {
  const out: ReferralRow[] = [];
  for (const r of rows || []) {
    const joinedAt = (r?.joined_at || '').trim();
    if (!joinedAt || !Number.isFinite(Date.parse(joinedAt))) continue;
    const startedAt = (r.started_at || '').trim();
    const started = startedAt && Number.isFinite(Date.parse(startedAt)) ? startedAt : null;
    out.push({
      // The server already coalesces a blank name to 'A friend'; this repeats
      // it rather than trusting it, because an empty string under an avatar
      // circle is a row that looks broken.
      name: (r.friend_name || '').trim() || 'A friend',
      joinedAt,
      startedAt: started,
      converted: started != null,
    });
  }
  return out.sort((a, b) => Date.parse(b.joinedAt) - Date.parse(a.joinedAt));
}

/**
 * The date a friend joined, as a person reads it.
 *
 * Deliberately no year: every referral on this screen is recent enough that the
 * year adds nothing, and a date that reads as a filing reference reads as
 * something official. Local time, like every other date in the app — the
 * referrer is looking at their own calendar, not the server's.
 */
export function joinedLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The line under one friend's name.
 *
 * Says what happened, in the order it happened, and never guesses at the half
 * that has not. "Joined 12 Aug" on its own is the true and complete statement
 * about somebody who has not trained yet; adding "— not converted" would be
 * scoring a person the referrer knows.
 */
export function friendLine(r: ReferralRow): string {
  const joined = `Joined ${joinedLabel(r.joinedAt)}`.trim();
  if (!r.converted) return `${joined} · not training yet`;
  return `${joined} · started training ${joinedLabel(r.startedAt as string)}`;
}

/**
 * The two counts, or an honest refusal to state them.
 *
 * Under anything but 'ready' this states no figure and, critically, does not
 * say "nobody". A referrer shown "nobody has used your code" because a read
 * failed concludes their invitations went nowhere and stops sending them —
 * the same failure src/lib/joinCodes.ts documents for a coach's join codes,
 * arriving through the same door.
 *
 * The counts come from `my_referral_summary()`, which is computed over ALL of
 * the caller's referrals rather than over the page `my_referrals()` returns,
 * so they are safe to state under 'ready' even when the list below them is cut.
 */
export function summaryLine(
  status: LoadStatus,
  joined: number | null,
  converted: number | null,
): string {
  if (status === 'loading') return 'Checking who has joined…';
  if (status === 'error') return 'We couldn’t check who has joined with your code.';
  if (status === 'partial') return 'Not all of your invites could be read.';
  // Null under 'ready' should not happen — but a count that is not a count is
  // not a zero, and this is the one place that could turn it into one.
  if (joined == null || converted == null) return 'We couldn’t check who has joined with your code.';
  if (joined <= 0) return 'Nobody has used your code yet.';
  const j = `${num(joined)} joined`;
  if (converted <= 0) return `${j} · none training yet`;
  const c = converted === 1 ? '1 has started training' : `${num(converted)} have started training`;
  return `${j} · ${c}`;
}

/**
 * What "converts" means, said on the screen rather than left to be inferred.
 *
 * A signup, a first session and a first payment are three different promises
 * and this is the one the database can keep. A first payment would be the
 * strongest claim and it is not available: coaches are not live on Stripe
 * Connect, and most members train under a gym membership that never produces a
 * per-client charge at all. Promising money and reporting workouts would be
 * worse than promising less.
 */
export const CONVERSION_RULE =
  'A referral counts once the friend you invited logs their first workout. '
  + 'Signing up on its own does not count.';

/**
 * The thing this screen must not do, written down so it is not undone.
 *
 * No discount, no free session, no credit balance, no points. Repple is
 * white-label: what a referral is worth is a commercial decision belonging to
 * each gym and each coach, in their own currency and against their own margins.
 * A screen that promised "a free session" would be committing somebody else's
 * business to a cost they never agreed, to a member who would hold them to it.
 */
export const REWARD_NOTE =
  'Repple records who you brought in and whether they started training. What '
  + 'that is worth is up to your gym or coach — nothing here is a discount or '
  + 'a credit, and no reward has been promised on their behalf.';

/** What the referrer sees about a friend, and what the friend sees about them.
 *  Held against my_referrals()'s select list by the test beside this file. */
export const REFERRAL_PRIVACY_NOTE =
  'You see a friend’s first name and whether they have started training — '
  + 'nothing else about them. They are never shown anything about your training.';
