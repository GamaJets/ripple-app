// Noticing that a badge just unlocked.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// Badges were computed at render on app/(client)/achievements.tsx and nowhere
// else in the app. Nothing was notified, nothing celebrated, nothing shared —
// a member earned Fifty Club on a Tuesday and found out about it whenever they
// next happened to open a screen most people never open. Confetti exists in
// this codebase and fires for a PR and for finishing a session, which are the
// two moments the app already knows how to celebrate; a badge is the third and
// had nothing.
//
// This provider watches the training log, works out which badges are earned,
// and compares that against what the member has already been told. Anything new
// produces exactly one banner and is offered to whichever screen is in front as
// something to celebrate.
//
// ── The rule that makes this safe ──────────────────────────────────────────
//
// IT NEVER ANNOUNCES OFF AN INCOMPLETE READ, AND IT NEVER UN-ANNOUNCES.
//
// Under 'error' the workout log is EMPTY — not because nothing was logged but
// because nothing was read — so every threshold evaluates false. A watcher that
// took that at face value would do nothing on the way down (which is fine) and
// then, on the next successful read, see twelve badges "appear" and fire twelve
// notifications at somebody who earned them last year. So:
//
//   · the seen-set is loaded from storage BEFORE anything is compared, and
//     nothing is announced until it has been. A first launch that compared
//     against an empty set would congratulate a five-year member on their
//     first rep.
//   · only a WHOLE read (`isWhole`) is allowed to announce. A truncated read
//     holds real rows and its earned badges are genuinely earned — see the
//     monotonicity note in src/lib/badges.ts — but it can also LOSE a badge
//     that a fuller read would have found, and the seen-set must not be
//     written from a set that might be short.
//   · a badge that disappears is ignored. That can only happen when the log
//     shrank, and taking a badge back is worse than letting a stale one stand.
//
// ── Why the seen-set is on the device and not on the server ───────────────
//
// "Have I already told this person about this badge" is a fact about a
// CONVERSATION, not about the member's record. The record is the log, and the
// badges are derived from it — so a reinstall re-deriving the same twelve
// badges is correct, and the only thing lost is that the device will not
// re-announce them, because the seed below marks everything already-earned as
// already-told on the first run. That is the right failure: a reinstalled app
// that fires eleven congratulation banners on launch is a bug, and one that
// stays quiet about badges the member earned in 2024 is not.
import { createContext, useCallback, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWorkoutLog } from './workoutLog';
import { useClientData } from './clientData';
import { isWhole } from './loadStatus';
import { badgeAnnouncement, badgeFigures, earnedKeys, newlyEarned, type BadgeKey } from '../lib/badges';
import { scheduleLocal } from './pushNotifications';

const SEEN_KEY = 'repple.badges.seen';

interface Value {
  /**
   * A badge the member has not been told about yet, for a screen to celebrate,
   * or null.
   *
   * Only ever ONE at a time, even when several land together — three confetti
   * bursts for one session is not three times the celebration. Which one is
   * decided in src/lib/badges.ts: the furthest along.
   */
  pending: BadgeKey | null;
  /** How many others unlocked in the same moment, so the celebration can say so. */
  alsoUnlocked: number;
  /** Called by whichever screen showed the celebration. Idempotent. */
  acknowledge: () => void;
  /** Every badge already announced, so Achievements can mark what is new. */
  seen: readonly string[];
}

const Ctx = createContext<Value | null>(null);

export function BadgeWatchProvider({ children }: { children: ReactNode }) {
  const { log, status } = useWorkoutLog();
  const cd = useClientData();
  const [seen, setSeen] = useState<readonly string[]>([]);
  // Null until storage has answered. NOTHING may be compared before this is
  // true — see the header; comparing against an empty set on a first launch
  // congratulates a long-standing member on their first rep.
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<BadgeKey | null>(null);
  const [alsoUnlocked, setAlsoUnlocked] = useState(0);
  // Whether this install has ever recorded a seen-set. The first run SEEDS
  // rather than announces.
  const seededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SEEN_KEY);
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setSeen(parsed.filter((x) => typeof x === 'string'));
            seededRef.current = true;
          }
        }
      } catch {
        // An unreadable store is not a reason to announce everything. It leaves
        // `seededRef` false, so the next whole read seeds silently and the
        // member is simply not told about badges they already had — which is
        // the same outcome as a reinstall and is the safe direction.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (keys: readonly string[]) => {
    setSeen(keys);
    seededRef.current = true;
    try { await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(keys)); } catch {
      // The badge was announced and the note of it was not stored, so it may be
      // announced once more at the next launch. One duplicate banner is a much
      // smaller failure than a silent unlock, so nothing is rolled back.
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    // Only a whole read may move this. See the header.
    if (!isWhole(status)) return;
    // The body-weight history, so a calisthenics member's pull-ups count toward
    // volume and PRs. Without it their log reads back as empty and four of the
    // twelve badges could never unlock. Only offered when the SCAN read was
    // itself whole — a history assembled from a failed read is a shorter
    // history, which would under-count volume and could hold a badge back.
    const history = isWhole(cd.scansStatus) ? cd.weightSeries : [];
    const now = earnedKeys(badgeFigures(log, history));

    if (!seededRef.current) {
      // First run on this install. Everything already earned is recorded as
      // told, and nothing is announced — the alternative is a launch that fires
      // a congratulation for every badge the member earned over two years.
      void persist(now);
      return;
    }

    const fresh = newlyEarned(now, seen);
    if (!fresh.length) return;

    // The furthest along is the headline; the rest are counted. Somebody whose
    // fiftieth session unlocks Ten Sessions and Fifty Club at once is
    // congratulated on Fifty Club.
    const head = fresh[fresh.length - 1];
    setPending(head);
    setAlsoUnlocked(fresh.length - 1);

    // The banner. `scheduleLocal` two seconds out rather than immediately: an
    // unlock happens in the same tick the member taps Finish, and a system
    // banner landing on top of the finish screen covers the thing they are
    // looking at. It also NEVER requests the notification permission — see
    // scheduleRestOverAlert on why a badge is not worth spending the one
    // system prompt an install ever gets — so on a phone that has not granted
    // it, nothing is sent and the in-app celebration is the whole of it.
    const note = badgeAnnouncement(head, fresh.length - 1);
    if (note) {
      void scheduleLocal(note.title, note.body, new Date(Date.now() + 2000), { route: '/(client)/achievements' });
    }

    // Recorded as told at the moment it is announced, not when the celebration
    // is dismissed. A member who closes the app mid-confetti has been told.
    void persist([...seen, ...fresh]);
  }, [loaded, status, log, cd.weightSeries, cd.scansStatus, seen, persist]);

  const acknowledge = useCallback(() => { setPending(null); setAlsoUnlocked(0); }, []);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<Value>(() => ({ pending, alsoUnlocked, acknowledge, seen }), [pending, alsoUnlocked, acknowledge, seen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Returns a safe empty view rather than throwing when the provider is absent.
 *
 * Every other provider in this app throws, and this one deliberately does not:
 * a badge celebration is decoration, and taking a screen down because the
 * decoration is not mounted would be the largest possible failure for the
 * smallest possible feature. The coach and owner builds contain neither the
 * provider nor a reason to.
 */
export function useBadgeWatch(): Value {
  return useContext(Ctx) ?? { pending: null, alsoUnlocked: 0, acknowledge: () => {}, seen: [] };
}
