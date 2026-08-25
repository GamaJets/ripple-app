// "Did you know…" — the tour, spread thin.
//
// Asked for by a member who liked the first-run tour:
//
//   "I liked the new getting started intro pages. U can also put random
//    'Did you know…' pages that pop once a workout session or once few days"
//
// WHERE THE CONTENT COMES FROM, and why it is not fitness facts.
//
// Every tip is one of the bullets already written in guide.ts — the same lines
// the tour and the user guide show. That is deliberate. The obvious reading of
// "did you know" is a stream of training trivia, and a fitness app dispensing
// half-remembered physiology is both usually wrong and a liability nobody
// needs. A tip that says what the software can do is true by construction,
// useful at the moment somebody is actually using it, and needs no citation.
//
// It also means the feature ships with a full set on day one — sixteen tips in
// the client app, fourteen in Coach, five in Studio — and grows whenever the
// guide does, rather than needing a content pipeline of its own.
//
// Pure and framework-free, so the rules can be tested without a phone.

import { guideFor } from './guide';
import type { AppVariant } from './variant';

export interface Tip {
  /** Stable identity, so "already seen" survives reordering the guide. */
  id: string;
  /** The tab it belongs to, shown as the kicker. */
  tab: string;
  text: string;
}

export interface TipState {
  /** Ids already shown, most recent last. */
  seen: string[];
  /** When the last tip was shown, ISO. Null when none ever has been. */
  lastShownAt: string | null;
}

export const EMPTY_TIP_STATE: TipState = { seen: [], lastShownAt: null };

/** Every tip available to a build, derived from its own guide. */
export function tipsFor(v: AppVariant): Tip[] {
  const out: Tip[] = [];
  for (const section of guideFor(v)) {
    section.points.forEach((text: string, i: number) => {
      out.push({ id: `${section.tab}:${i}`, tab: section.tab, text });
    });
  }
  return out;
}

/**
 * Whether enough time has passed to show another tip.
 *
 * `minHours` defaults to 20 rather than 24 so somebody who trains each morning
 * is not pushed a little later every day until the tip lands at bedtime and
 * then skips a day entirely. It is a nudge, not an alarm clock.
 *
 * An unparseable timestamp counts as "long enough". A corrupted preference
 * should not silence the feature forever — the cost of one extra tip is
 * nothing, and the cost of a permanently stuck flag is a feature that quietly
 * stops existing.
 */
export function isDue(state: TipState, now: number = Date.now(), minHours = 20): boolean {
  if (!state.lastShownAt) return true;
  const t = Date.parse(state.lastShownAt);
  if (!Number.isFinite(t)) return true;
  return now - t >= minHours * 3_600_000;
}

/**
 * The next tip to show, or null when there is nothing to say.
 *
 * Unseen tips come first, in order, so a new user meets the app in a sensible
 * sequence rather than being dropped somewhere in the middle of the owner
 * console. Once every tip has been seen it starts again from the least
 * recently shown, which keeps the rotation from repeating the same handful.
 *
 * Deliberately not random. Random means somebody can be shown the same tip
 * twice in a week while never seeing another, which is exactly the thing that
 * makes a feature like this feel like noise.
 */
export function nextTip(v: AppVariant, state: TipState): Tip | null {
  const all = tipsFor(v);
  if (all.length === 0) return null;

  const unseen = all.filter((t) => !state.seen.includes(t.id));
  if (unseen.length > 0) return unseen[0];

  // All seen: the one shown longest ago. seen[] is oldest-first.
  const order = new Map(state.seen.map((id, i) => [id, i]));
  return [...all].sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1))[0] ?? null;
}

/**
 * Record that a tip was shown.
 *
 * `seen` is capped at the number of tips that exist. Without a cap it grows
 * without bound across years of use, and every entry past the last full
 * rotation is dead weight in a preference that is read on every launch.
 */
export function markShown(state: TipState, tip: Tip, total: number, nowIso: string): TipState {
  const seen = state.seen.filter((id) => id !== tip.id);
  seen.push(tip.id);
  const cap = Math.max(1, total);
  return { seen: seen.slice(-cap), lastShownAt: nowIso };
}

/**
 * The whole decision in one call: is there a tip to show right now?
 *
 * Returns null when it is too soon, which is the common case — a tip that
 * appears every time you open the app is an interruption, and the request was
 * explicitly "once a workout session or once a few days".
 */
export function tipToShow(
  v: AppVariant,
  state: TipState,
  now: number = Date.now(),
  minHours = 20,
): Tip | null {
  if (!isDue(state, now, minHours)) return null;
  return nextTip(v, state);
}
