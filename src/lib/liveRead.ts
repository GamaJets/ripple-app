// Re-reading a read that WORKED, because somebody else changed the answer.
//
// ── The half src/lib/readRefresh.ts deliberately left ──────────────────────
//
// That file recovers reads that FAILED, and says so about the case this one
// exists for, in as many words:
//
//     'ready' — it worked. Re-reading it costs the member bytes on a
//               connection that has just come back and changes nothing on
//               screen. This is the difference between recovering and
//               refreshing, and this file is only the first.
//
// "Changes nothing on screen" is true of every read whose answer only that
// phone can change. It is not true of a read whose answer somebody ELSE can
// change, and this app has one that matters:
//
//   A coach logs a session into their client's record. The row's `user_id` is
//   the client's, so it is part of the client's own log — their streak, their
//   personal records, their week's volume, their weekly report. The client's
//   provider read `workouts` on mount and has held a correct-as-of-then list
//   ever since. There is no realtime subscription and no refetch on
//   foreground, so that session is invisible on their phone until the app is
//   cold-started or somebody pulls to refresh.
//
// Reported exactly that way: a coach recorded a session and it was not in the
// client app. (In that instance the write had not landed at all — a separate
// fault — but the gap this file closes was real and would have hidden it for
// hours anyway, which is worse: the coach and the client would each have had
// good reason to believe the other was wrong.)
//
// ── Why this is a sibling and not a flag on the other one ─────────────────
//
// `needsRefetch` is `s === 'error'` and its ceiling, its attempt counting and
// its give-up rule are all built on that meaning one thing. Widening it to
// include 'ready' would make MAX_ATTEMPTS — which exists because an 'error'
// might be an RLS refusal that will never succeed — count attempts against
// reads that are working fine. The two predicates want opposite treatment, so
// they get two registries and one set of triggers.
//
// ── What must NOT happen ──────────────────────────────────────────────────
//
// A refresh here runs over a list the member is looking at. So:
//
//   · never over a read in flight. Two hydrates racing on a provider that
//     merges server rows with a device queue is a race over the same list, and
//     src/ui/workoutLog.tsx is exactly that provider.
//   · never over a read that FAILED. That is the other file's job, it counts
//     attempts, and doing it from here as well would double the requests on
//     the connection least able to afford them.
//   · not on every flick between apps. A floor applies to 'foreground' for the
//     same reason it does there, and the same constant is imported rather than
//     re-chosen, so the two cannot drift apart.
//
// A 'changed' trigger is exempt from the floor, because unlike a foreground
// transition it carries actual news: the server told us this member's rows
// moved. Bursts are the caller's problem — one coach-logged session is one row
// per set, and twenty rows must be one refetch. src/ui/liveRead.tsx owns that
// timer; `CHANGE_DEBOUNCE_MS` is the number it uses.
import type { LoadStatus } from '../ui/loadStatus';
import { FOREGROUND_GAP_MS } from './readRefresh';

export { FOREGROUND_GAP_MS };

/**
 * A provider that can be asked to read again.
 *
 * Same shape as `Refreshable` in ./readRefresh on purpose: a provider adopting
 * both should not have to hold two different ideas of what it is offering.
 */
export interface LiveReadable {
  status: () => LoadStatus;
  refetch: () => void | Promise<unknown>;
}

/**
 * Why a refresh is being asked for.
 *
 *  'reconnect'  — the offline→online edge. The phone may have missed a change
 *                 while it had no signal, and there is no way to know.
 *  'foreground' — somebody is looking at the screen again. Floored.
 *  'changed'    — the server said this member's rows moved. Never floored.
 *  'manual'     — a person pulled to refresh. Never floored.
 */
export type LiveTrigger = 'reconnect' | 'foreground' | 'changed' | 'manual';

/**
 * Did the last read LAND?
 *
 * 'partial' counts. A truncated read is a whole answer about the newest page
 * (src/ui/loadStatus.ts), and the newest page is precisely what a coach writing
 * a session changes — so refusing to refresh it would withhold the one change
 * this file exists to deliver. Truncation itself is not fixed by re-reading and
 * nothing here pretends otherwise; the status comes back 'partial' again.
 */
export const landed = (s: LoadStatus): boolean => s === 'ready' || s === 'partial';

/** How long a burst of change events is gathered into one refetch.
 *
 *  A coach saving a session inserts one row per set, so a six-exercise day is
 *  twenty-odd events arriving within a second of each other. Refetching per
 *  event would be twenty reads of the member's whole log to show one session.
 *  Long enough to swallow the burst, short enough that somebody watching the
 *  screen sees it land. */
export const CHANGE_DEBOUNCE_MS = 700;

/**
 * `lastRunAt` when nothing has run yet.
 *
 * A sentinel rather than 0, and the reason is written down in
 * src/lib/readRefresh.ts about its own copy of this: "a zero must not be read
 * as 'ran at the epoch, therefore long enough ago' BY ACCIDENT — it happens to
 * give the right answer here". It happens to, because `Date.now()` is a large
 * number and `now - 0 >= 15000` is therefore true. That is correctness resting
 * on the clock's magnitude, which is not correctness. A negative sentinel can
 * never be a real `Date.now()`, so "never run" is a state rather than a
 * coincidence — and 0 goes back to being an ordinary instant, which is what a
 * test with an injected clock will hand it.
 */
export const NEVER = -1;

/**
 * May a refresh start now?
 *
 * Only 'foreground' is floored. See `LiveTrigger`: the other three either
 * carry news the phone could not have had, or are a person asking.
 */
export function mayRefreshNow(
  trigger: LiveTrigger,
  lastRunAt: number,
  now: number,
  gapMs: number = FOREGROUND_GAP_MS,
): boolean {
  if (trigger !== 'foreground') return true;
  if (lastRunAt < 0) return true;
  return now - lastRunAt >= gapMs;
}

/** Whether this provider, in this state, should be asked to read again. */
export function shouldRefresh(status: LoadStatus): boolean {
  return landed(status);
}

const live = new Map<string, LiveReadable>();

/**
 * Offer this provider for live refreshing. Registering by key REPLACES, so a
 * provider whose effect re-runs on a new auth revision cannot leave the
 * previous account's refetch behind — the same rule `registerRefresh` states.
 */
export function registerLive(key: string, r: LiveReadable): () => void {
  live.set(key, r);
  return () => {
    // Identity check: only remove the registration THIS call made. A later
    // re-registration under the same key must survive this one's cleanup.
    if (live.get(key) === r) live.delete(key);
  };
}

export const liveCount = (): number => live.size;

/** For tests. */
export function resetLive(): void { live.clear(); }

export interface LivePass {
  /** Keys that were asked to read again. */
  ran: string[];
  /** Keys skipped, and why — 'in-flight', 'failed' (the other file's job), or
   *  'too-soon' when the foreground floor declined the whole pass. */
  skipped: { key: string; why: 'in-flight' | 'failed' }[];
  /** True when the floor declined the pass before any provider was consulted. */
  declined: boolean;
}

const emptyPass = (declined: boolean): LivePass => ({ ran: [], skipped: [], declined });

export interface LivePassDeps {
  now?: () => number;
  gapMs?: number;
  /** Only this key, for a 'changed' event that names one provider. */
  only?: string;
}

let lastRunAt = NEVER;

/** For tests. */
export function resetLiveClock(): void { lastRunAt = NEVER; }

/**
 * Ask every landed provider to read again.
 *
 * Failures are swallowed per provider: one refetch that throws must not stop
 * the others, and a refresh is by definition running over an answer the member
 * already has — so there is nothing to report and nothing to blank. The
 * provider's own status is what tells them if the new read failed.
 */
export function refreshLive(trigger: LiveTrigger = 'manual', deps: LivePassDeps = {}): LivePass {
  const now = (deps.now ?? Date.now)();
  if (!mayRefreshNow(trigger, lastRunAt, now, deps.gapMs)) return emptyPass(true);
  lastRunAt = now;

  const pass = emptyPass(false);
  const keys = deps.only ? (live.has(deps.only) ? [deps.only] : []) : [...live.keys()];
  for (const key of keys) {
    const r = live.get(key);
    if (!r) continue;
    let st: LoadStatus;
    try { st = r.status(); } catch { continue; }
    if (st === 'loading') { pass.skipped.push({ key, why: 'in-flight' }); continue; }
    if (!landed(st)) { pass.skipped.push({ key, why: 'failed' }); continue; }
    try { void r.refetch(); } catch { /* the provider publishes its own status */ }
    pass.ran.push(key);
  }
  return pass;
}
