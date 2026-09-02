// The line under an owner screen's figures that says when they were read.
//
// The React half of src/lib/freshness.ts, which holds every opinion and has a
// test. What is here is the two things that cannot be tested under node: the
// reachability subscription, and a timer — because "read 1 minute ago" has to
// become "read 2 minutes ago" without the owner touching anything, or the
// stamp is itself a stale figure.
//
// ── Why it is one component and not a prop on twenty screens ──────────────
//
// `app/(owner)/revenue.tsx` said the problem out loud: "the retry is the
// provider's own `refresh` — this screen has no pull-to-refresh, so without a
// button there is nothing an owner can actually do about it." Four of the
// twenty owner screens had a `RefreshControl`, none had a stamp, and none
// imported `src/lib/reachability.ts` although it has known the answer since it
// was written. Putting the three together in one place means a screen adopts
// all three or none, and nobody has to remember the third.
//
// ── Colour ────────────────────────────────────────────────────────────────
//
// The mark is a 6pt dot and the sentence stays ink. src/theme/scale.ts:
// "Status colours are reserved for status and are never used as text colour."
// t.warn as 12pt text measures under 4.5:1 on every palette in this app.
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from './components';
import { sp, type as ty } from '../theme/scale';
import { useReachability } from './reachability';
import { fetchedNote, fetchedNeedsMark } from '../lib/freshness';

/** How often the phrase is recomputed. Thirty seconds: fine enough that
 *  "just now" does not sit there for two minutes, coarse enough to be free. */
const TICK_MS = 30_000;

/**
 * When this screen last read, whether the phone can reach us, and a way to ask
 * again.
 *
 * `at` is the ms timestamp of the last SUCCESSFUL read — not of the last
 * attempt. A refresh that failed leaves the stamp where it was, because the
 * figures on screen are still the ones from the earlier read and saying
 * otherwise would be the same lie one layer up.
 *
 * `onRefresh` is optional only because a handful of owner screens genuinely
 * hold no fetched data. Every screen that shows a figure should pass one.
 */
export function Fetched({
  at, onRefresh, busy = false, style,
}: {
  at: number | null;
  onRefresh?: () => void;
  busy?: boolean;
  style?: { marginTop?: number; marginBottom?: number };
}) {
  const t = useTheme();
  const reach = useReachability();
  // Re-render on a timer so the phrase ages. `now` is state and not a ref
  // because the phrase is derived from it and a ref would not redraw.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  // Also recompute the moment a read lands, so "Reading…" becomes "Read just
  // now" without waiting up to thirty seconds for the next tick.
  useEffect(() => { setNow(Date.now()); }, [at]);

  const note = fetchedNote(at, now, reach);
  const marked = fetchedNeedsMark(at, now, reach);

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: sp.sm,
      marginTop: style?.marginTop ?? sp.md, marginBottom: style?.marginBottom ?? 0,
    }}>
      {marked ? (
        <View style={{
          width: 6, height: 6, borderRadius: 3, flexShrink: 0,
          backgroundColor: reach === 'offline' ? t.crit : t.warn,
        }} />
      ) : null}
      {/* One sentence, one stop for a screen reader. `accessible` on the row
          would swallow the Refresh button with it. */}
      <Text style={{ ...ty.caption, color: t.ink3, flex: 1 }}>{note}</Text>
      {onRefresh ? (
        <Pressable
          onPress={onRefresh}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Refreshing' : 'Refresh this screen'}
          accessibilityState={{ disabled: busy }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ ...ty.caption, fontWeight: '500', color: busy ? t.ink3 : t.ink2 }}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The state a screen keeps beside its data: when it last read, and whether a
 * refresh is in flight.
 *
 * `mark()` is called by the screen when a read SUCCEEDS. Deliberately not
 * called for it — a hook that stamped on every settle would stamp on failures
 * too, and a failed refresh must leave the stamp on the read the figures
 * actually came from.
 */
export function useFetchedAt(): {
  at: number | null;
  busy: boolean;
  mark: () => void;
  run: (job: () => Promise<unknown>) => Promise<void>;
} {
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const mark = () => setAt(Date.now());
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
      setAt(Date.now());
    } catch {
      // Swallowed on purpose. The screen's own loader already reports its
      // failure in its own words; this hook's only job is not to move the
      // stamp, and an unhandled rejection out of a refresh button would take
      // the screen down for a read that merely did not come back.
    } finally {
      setBusy(false);
    }
  };
  return { at, busy, mark, run };
}
