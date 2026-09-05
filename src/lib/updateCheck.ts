// Whether the app asked for an update, and what it was told.
//
// ── the morning this cost ─────────────────────────────────────────────────
//
// Four devices sat on stale bundles while thirteen publishes reported success.
// Two people spent a morning staring at an Update id that would not move, and
// could not tell which of these was happening:
//
//   the check never ran            (something threw before it, or Updates is off)
//   it ran and found nothing       (this device is on a different channel)
//   it found an update and failed  (the download died half way)
//   it worked                      (and applied on a launch nobody noticed)
//
// Those four need four different actions and the app said the same thing to
// all of them: nothing. app/_layout.tsx swallowed the whole sequence in one
// `catch {}` whose comment read "offline or check failed", which is two
// different situations already, and neither was recorded anywhere.
//
// BuildInfo.tsx's own header describes the wrong-channel case as a past bug —
// "several 'shipped' fixes were debugged as code bugs when the code had simply
// never arrived". It made the answer readable in five seconds ONCE the update
// had landed. It still could not say why one had not.
//
// ── what this is ─────────────────────────────────────────────────────────
//
// One module-level record of the last check, written by the launch effect and
// read by the Build screen. Deliberately not persisted: the check runs on every
// launch, so by the time anybody opens Settings the answer on screen is from
// this launch rather than from some earlier one they would have to date.
//
// `at` is on every settled state on purpose. A timestamp is the only thing that
// distinguishes "checked, you are current" from "never checked" — without it
// those two both read as an app with nothing to say, which is exactly the
// ambiguity this file exists to remove.

/** What happened the last time this app asked for an update. */
export type UpdateCheck =
  /** Not asked yet this launch. */
  | { state: 'idle' }
  /** No updates in this build at all — a dev build, or Expo Go. */
  | { state: 'disabled' }
  /** Asked, waiting for an answer. */
  | { state: 'checking'; at: number }
  /** Asked and told this device is already current. */
  | { state: 'current'; at: number }
  /** An update exists and is coming down. */
  | { state: 'downloading'; at: number }
  /** Downloaded; the reload is next, so this is rarely seen. */
  | { state: 'applying'; at: number }
  /**
   * Downloaded, and deliberately not applied yet.
   *
   * `reloadAsync()` tears the tree down, and app/_layout.tsx now refuses to do
   * that while the app is in the background — a slow download outlasts the
   * launch, and the reload then landed on top of a half-written message or a
   * set being logged. The bundle is on the phone and runs at the next launch.
   *
   * Its own state rather than folded into 'current', because this whole module
   * exists so that two situations a person would act on differently are not
   * printed with one sentence: "already up to date" means there is nothing to
   * get, and this means there is, and it is here.
   */
  | { state: 'ready'; at: number }
  /** Asked and it went wrong. `why` is for a person, not a log. */
  | { state: 'failed'; at: number; why: string };

let current: UpdateCheck = { state: 'idle' };
const listeners = new Set<(c: UpdateCheck) => void>();

/** The last thing that happened. */
export function lastUpdateCheck(): UpdateCheck { return current; }

/** Record what just happened, and tell anyone watching. */
export function sayUpdateCheck(next: UpdateCheck): void {
  current = next;
  for (const fn of listeners) { try { fn(next); } catch { /* a bad listener is not this module's problem */ } }
}

/** Watch it. Returns the unsubscribe. */
export function watchUpdateCheck(fn: (c: UpdateCheck) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam: forget everything. Not called by the app. */
export function forgetUpdateCheck(): void {
  current = { state: 'idle' };
  listeners.clear();
}

/**
 * One line for the Build screen.
 *
 * Written for somebody holding a phone that will not update, so each line says
 * what it MEANS rather than what the API returned. "Already up to date" and
 * "Not checked yet" are the pair that mattered: they look identical from the
 * outside and call for opposite next moves.
 */
export function updateCheckLine(c: UpdateCheck, at: (t: number) => string): string {
  switch (c.state) {
    case 'idle':        return 'not checked yet';
    case 'disabled':    return 'off in this build';
    case 'checking':    return 'checking…';
    case 'current':     return `already up to date (${at(c.at)})`;
    case 'downloading': return `downloading an update (${at(c.at)})`;
    case 'applying':    return `applying an update (${at(c.at)})`;
    case 'ready':       return `an update is downloaded and runs next time you open the app (${at(c.at)})`;
    case 'failed':      return `check failed: ${c.why} (${at(c.at)})`;
  }
}

/**
 * A thrown thing, as a sentence somebody can act on.
 *
 * Not `String(e)`: the common failures here are network ones whose messages are
 * either empty or an unhelpfully bare "Network request failed", and a blank
 * reason on a diagnostic screen is the thing this whole module is against.
 */
export function whyFailed(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const msg = raw.trim();
  if (!msg) return 'no reason given';
  if (/network|fetch|timeout|offline|connection/i.test(msg)) return `${msg} — the phone may have been offline`;
  return msg;
}
