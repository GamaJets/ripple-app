// ── The bar at the bottom, instead of the dialog in the middle ───────────────
//
// 227 `Alert.alert` calls in the client app. Every one of them stops the
// person, dims the screen and waits for a tap, including the ones whose entire
// content is "Saved". There was no toast, no snackbar and no undo anywhere in
// the kit, so a success had no quieter way to be said and a delete had no way
// to be taken back.
//
// This is both of those. `say()` is the quiet channel: a line at the bottom of
// the screen, gone in a few seconds, nothing to dismiss. `remove()` is the
// destructive one: it does the thing straight away, says what it did, and
// holds the write for six seconds behind an Undo — see src/lib/undoable.ts for
// why the write is HELD rather than reversed.
//
// ── What this deliberately does not replace ───────────────────────────────
//
// A question. "Delete your account?" and "Sign out" are real questions with
// real consequences and they still belong in a modal, because a modal is what
// a question looks like. What a modal is wrong for is a STATEMENT — "Saved",
// "Logged", "Removed" — and for a delete that could simply be reversible
// instead of confirmed. The rule this file is written to: interrupt somebody
// to ask, never to tell.
//
// ── Reachability ─────────────────────────────────────────────────────────
//
// A toast that a screen reader never mentions is a toast that does not exist
// for the reader most likely to need the undo. Every message is announced, and
// the Undo button is a real button with a real label. The bar sits above the
// tab bar rather than over it, because covering the app's own navigation for
// six seconds is a worse interruption than the alert this replaces.
import { createContext, useCallback, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './components';
import { sp, radius, hairline, elevation, type as ty, grown } from '../theme/scale';
import { UNDO_WINDOW_MS, due, stage, undo, type Undoable } from '../lib/undoable';

/** How long a plain message stays. Shorter than the undo window: there is
 *  nothing to do about it, so it should be out of the way sooner. */
export const SAY_MS = 3200;

type Commit = () => void | Promise<void>;

interface ToastState {
  text: string;
  /** Present only while an action can still be taken back. */
  undoId: string | null;
}

export interface ToastValue {
  /** Say something and get out of the way. Never asks for a tap. */
  say: (text: string) => void;
  /**
   * A destructive action that can be taken back.
   *
   * `onCommit` is the real write and runs AFTER the window closes, or
   * immediately if the person navigates away or does something else first.
   * `onUndo` is called only when the window was still open — it puts the row
   * back on screen, and nothing has been written, so it cannot fail.
   *
   * The screen is expected to hide the row itself the moment this is called.
   * That is the point: the app looks like it has done the thing, because it
   * has, and the only question left is whether it stays done.
   */
  remove: (opts: { id: string; text: string; onCommit: Commit; onUndo: () => void }) => void;
}

const Ctx = createContext<ToastValue | null>(null);

/**
 * The hook every screen uses.
 *
 * Returns a working no-op pair outside the provider rather than throwing.
 * A missing provider must not be able to turn a delete into a crash, and the
 * three portals mount this in one place — if it is ever missing, the delete
 * still has to happen. So `remove` outside the provider commits immediately,
 * which is exactly the behaviour the app had before this file existed.
 */
export function useToast(): ToastValue {
  const c = useContext(Ctx);
  return c ?? FALLBACK;
}

const FALLBACK: ToastValue = {
  say: () => {},
  remove: ({ onCommit }) => { void onCommit(); },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState<ToastState | null>(null);

  // The queue and the timers live in refs, not state: a pending WRITE must not
  // depend on a re-render happening, and unmount must be able to flush it.
  const queue = useRef<Undoable<Commit>[]>([]);
  const undoHandlers = useRef<Map<string, () => void>>(new Map());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((text: string) => {
    try { AccessibilityInfo.announceForAccessibility(text); } catch { /* not fatal */ }
  }, []);

  const runCommits = useCallback((items: Undoable<Commit>[]) => {
    for (const item of items) {
      undoHandlers.current.delete(item.id);
      try { void item.payload(); } catch { /* the caller owns its own failure copy */ }
    }
  }, []);

  /** Write everything still pending. Called when a second action arrives, when
   *  the window closes, and when this provider goes away. */
  const flush = useCallback(() => {
    const items = queue.current;
    queue.current = [];
    if (commitTimer.current) { clearTimeout(commitTimer.current); commitTimer.current = null; }
    runCommits(items);
  }, [runCommits]);

  useEffect(() => () => {
    // Unmount. The write is held, so leaving without this would silently undo
    // something nobody undid — the one outcome src/lib/undoable.ts says must
    // not exist.
    if (hideTimer.current) clearTimeout(hideTimer.current);
    flush();
  }, [flush]);

  const say = useCallback((text: string) => {
    if (!text) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShown({ text, undoId: null });
    announce(text);
    hideTimer.current = setTimeout(() => setShown(null), SAY_MS);
  }, [announce]);

  const remove = useCallback(({ id, text, onCommit, onUndo }: {
    id: string; text: string; onCommit: Commit; onUndo: () => void;
  }) => {
    const now = Date.now();
    const next: Undoable<Commit> = { id, atMs: now, payload: onCommit };
    const staged = stage(queue.current, next, now);
    queue.current = staged.queue;
    runCommits(staged.commit);
    undoHandlers.current.set(id, onUndo);

    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setShown({ text, undoId: id });
    announce(`${text}. Undo is available for a few seconds.`);

    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      // `due` rather than `flush`: the timer says a window has closed, not that
      // everything pending should be written. They are the same thing today —
      // stage() leaves one action in the queue — and this is the version that
      // stays correct if a design ever shows two.
      const settled = due(queue.current, Date.now());
      queue.current = settled.queue;
      runCommits(settled.commit);
      setShown((s) => (s && s.undoId === id ? null : s));
    }, UNDO_WINDOW_MS);
  }, [announce, runCommits]);

  const takeBack = useCallback((id: string) => {
    const result = undo(queue.current, id, Date.now());
    queue.current = result.queue;
    const handler = undoHandlers.current.get(id);
    undoHandlers.current.delete(id);
    // Null means the window had already closed and the write has gone. Saying
    // so is the whole reason `undo` reports it: putting the row back on screen
    // when the server no longer has it is the same lie as a delete that
    // silently failed.
    if (result.undone && handler) {
      handler();
      say('Put back.');
    } else {
      say('Too late to undo that one.');
    }
  }, [say]);

  // Memoised, not an inline literal. See the long note in src/ui/roster.tsx
  // (search "handed out through a ref"): a provider that hands out
  // `value={{ … }}` returns a different object on every render, and a consumer
  // that keys an effect on it — `useFocusEffect(useCallback(() => { x.reload();
  // }, [x]))` — builds a read loop that cannot settle. Everything below is
  // already stable for the life of the provider, so the value changes identity
  // only when something a consumer can actually see has changed.
  const value = useMemo<ToastValue>(() => ({ say, remove }), [say, remove]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {shown ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute', left: sp.md, right: sp.md,
            // Above the tab bar, not over it. The bar grows with the reader's
            // text (see app/(client)/_layout.tsx), so this offset grows with it.
            bottom: insets.bottom + grown(56) + sp.sm,
          }}
        >
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row', alignItems: 'center', gap: sp.md,
              backgroundColor: t.surface3, borderRadius: radius.sm,
              borderWidth: hairline, borderColor: t.ring,
              paddingVertical: sp.md, paddingHorizontal: sp.lg,
              ...elevation.e2,
            }}
          >
            <Text style={{ ...ty.label, color: t.ink, flex: 1 }}>{shown.text}</Text>
            {shown.undoId ? (
              <Pressable
                onPress={() => takeBack(shown.undoId as string)}
                accessibilityRole="button"
                accessibilityLabel={`Undo. ${shown.text}`}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brand }}>Undo</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}
