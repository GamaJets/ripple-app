// The two round trips behind "Sent" and "Read", and the four conditions that
// decide when this device is allowed to make the second claim.
//
// Every rule this file obeys is argued in src/lib/readReceipt.ts, which holds
// the pure half and is asserted under plain node. This file is the part that
// needs React and a network: focus, foreground, scroll position, one RPC that
// writes the reader's watermark and one that reads the other person's back.
// The policy — who may see whose watermark, and why that is symmetric — is
// supabase/parts/950.
//
// ── Why the mark moved OUT of useThread ────────────────────────────────────
//
// `useThread` used to call `mark_thread_read(cid)` unconditionally, the instant
// the initial read settled. Two things were wrong with that and both are fixed
// by the move rather than by a patch:
//
//   · IT MARKED READ WHAT NOBODY HAD LOOKED AT. `mark_thread_read` writes
//     `now()`, so a thread opened and left at the top — or a screen still
//     mounted behind the one the coach went on to, which the coach's chat
//     always is (`Tabs.Screen` with `href: null`, no `unmountOnBlur`) — cleared
//     every unread message in it. That was tolerable while the watermark was
//     only ever read back by its own owner as a badge count. It is not
//     tolerable now that the OTHER person is shown the word "Read", because the
//     badge overstated to the person it belonged to and the receipt would
//     overstate to somebody else.
//   · IT FIRED ON SCREENS THAT ARE NOT THE THREAD. `useThread` is mounted for
//     its `send` alone by app/(trainer)/nudges.tsx and app/(trainer)/
//     credentials.tsx. Opening either of those sheets marked the client's
//     thread read without the coach seeing a word of it.
//
// So the write belongs to the two screens that actually draw the conversation,
// and this hook is what they mount.
//
// ── Reading the peer's watermark: a poll, and when it stops ────────────────
//
// There is no realtime subscription on `message_reads` and there deliberately
// is not one: a publication on that table would push one row per thread per
// side to both people on it, and the receipt is worth a poll rather than a
// second live channel. The poll runs only while the screen is focused and the
// app is in the foreground, and only while `receiptWorthPolling` says there is
// something unread to learn about — so a settled conversation costs nothing,
// and asking starts again by itself the moment I send something new.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import type { ChatRole, ThreadMessage, UnsentStage } from './messaging';
import {
  deliveryLine, newestConfirmedAt, nextReadMark, receiptWorthPolling,
  type Bubble,
} from '../lib/readReceipt';

/** How often to ask whether the other person has caught up, while there is
 *  anything of mine they have not. Twelve seconds is slower than a heartbeat
 *  and faster than a conversation: the receipt lands while the sender is still
 *  looking at the thread, and a thread left open on a desk makes five requests
 *  a minute at worst and none at all once everything is read. */
export const RECEIPT_POLL_MS = 12_000;

/** One thread message, as the delivery rules see it. Built here rather than in
 *  each screen so the two chats cannot grow different ideas of what `mine`,
 *  `stage` or `kind` mean for the same bubble. */
function toBubble(m: ThreadMessage, role: ChatRole, unsent: Record<string, UnsentStage>): Bubble {
  return {
    id: m.id,
    mine: m.sender === role,
    sending: m.sending,
    stage: unsent[m.id],
    createdAt: m.createdAt,
    kind: m.local?.kind ?? (m.attachment.state === 'ok' ? m.attachment.attachment.kind : null),
  };
}

export interface ReadReceiptArgs {
  /** The thread key — `messages.client_id`. Null before it is resolved. */
  threadId: string | null;
  /** Which side this reader is. Decides whose bubbles carry delivery state. */
  role: ChatRole;
  /** The thread as drawn, including any bubble merged in from the outbox. */
  messages: ThreadMessage[];
  /** `useThread`'s per-bubble marks. */
  unsent: Record<string, UnsentStage>;
  /** The end of the list is on screen. The screen measures it with `atBottom`
   *  from its own scroll event; this hook cannot see a ScrollView. */
  atEnd: boolean;
  /** Who cannot see an unsent message, for the failure sentences — 'your coach'
   *  on the client side, the client's first name or 'they' on the coach's. */
  them: string;
}

/**
 * The delivery sentence for every bubble on this thread, and the write that
 * earns the other person theirs.
 *
 * Returns a function rather than a map because the screen already has the
 * message in hand at the point it needs the sentence, and because the formatted
 * time is the screen's — the client shows a relative day and the coach a dated
 * one, and neither belongs in a shared module.
 */
export function useReadReceipt(args: ReadReceiptArgs): {
  /** The sentence under one bubble. `time` is the screen's own formatting of
   *  `m.createdAt`; it is returned unchanged for the other person's messages. */
  line: (m: ThreadMessage, time: string) => string;
  /** When the other person last opened this thread, or null. Exposed for a
   *  screen that wants to say something once rather than per bubble. */
  peerReadAt: string | null;
} {
  const { threadId, role, messages, unsent, atEnd, them } = args;

  // ── FOCUSED and FOREGROUND ──────────────────────────────────────────────
  //
  // Two of the four clauses of "what counts as read". Both are about a screen
  // that is mounted and rendering while nobody is looking at it: the coach's
  // chat stays mounted behind whatever they opened next, and any phone can go
  // in a pocket mid-thread.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const onChange = (next: AppStateStatus) => setForeground(next === 'active');
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  const visible = atEnd && focused && foreground;

  const bubbles = useMemo(
    () => messages.map((m) => toBubble(m, role, unsent)),
    [messages, role, unsent],
  );

  /* ── the reader's side: move the watermark ─────────────────────────────── */

  // Server-confirmed rows only. A local bubble carries this phone's clock and
  // may never get a row at all; marking read up to it would mark read whatever
  // the server stored in between.
  const newestAt = useMemo(
    () => newestConfirmedAt(messages.map((m) => ({ id: m.id, createdAt: m.createdAt }))),
    [messages],
  );

  /** The highest watermark the SERVER came back true for. Never set from a
   *  write we merely started — see the failed-write rule in
   *  src/lib/readReceipt.ts. */
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  /** Bumped by the debounce timer to re-run the decision when the gap is up. */
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);
  const lastWriteMs = useRef<number | null>(null);

  // A different thread is a different watermark. Nothing about the previous
  // conversation may be carried into this one — the coach's chat re-runs on the
  // same mounted component for a second client.
  useEffect(() => {
    setConfirmedAt(null);
    lastWriteMs.current = null;
    inFlight.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!USE_SUPABASE || !threadId) return;
    const decision = nextReadMark(
      { newestAt, visible, confirmedAt, inFlight: inFlight.current, lastWriteMs: lastWriteMs.current },
      Date.now(),
    );
    if (decision.act === 'idle') return;
    if (decision.act === 'wait') {
      // The trailing edge is kept rather than dropped: the last message of a
      // fast exchange would otherwise stay unread for good.
      const handle = setTimeout(() => setTick((n) => n + 1), decision.inMs);
      return () => clearTimeout(handle);
    }
    const at = decision.at;
    let cancelled = false;
    inFlight.current = true;
    // STARTED, not finished, so a slow round trip cannot be followed instantly
    // by another.
    lastWriteMs.current = Date.now();
    void (async () => {
      let confirmed = false;
      try {
        const { data, error } = await supabase.rpc('mark_thread_read_at', { p_client: threadId, p_at: at });
        // The function returns false rather than raising for every refusal, so
        // both halves are checked. Anything but an explicit true leaves the
        // watermark exactly where it was.
        confirmed = !error && data === true;
        if (error) reportError('readReceipts.mark', error);
      } catch (e) {
        reportError('readReceipts.mark', e);
      }
      inFlight.current = false;
      if (cancelled) return;
      // Nothing happens on failure, deliberately. There is no retry loop and no
      // queue: the cost of a lost mark is an unread badge that stays up, which
      // overstates what is waiting and never hides it, and the next arriving
      // message or the next time this thread is opened re-runs the decision
      // with signal. See the offline argument in src/lib/readReceipt.ts.
      if (confirmed) setConfirmedAt(at);
    })();
    return () => { cancelled = true; };
  }, [threadId, visible, newestAt, confirmedAt, tick]);

  /* ── the sender's side: read the other person's watermark ──────────────── */

  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  useEffect(() => { setPeerReadAt(null); }, [threadId]);

  // Asking is worth it only while something of mine is still unread. The whole
  // poll stops on a settled thread and starts again by itself when I send.
  const worth = useMemo(() => receiptWorthPolling(bubbles, peerReadAt), [bubbles, peerReadAt]);
  const awake = focused && foreground;

  useEffect(() => {
    if (!USE_SUPABASE || !threadId || !awake || !worth) return;
    let cancelled = false;
    const read = async () => {
      try {
        const { data, error } = await supabase.rpc('thread_read_receipt', { p_client: threadId });
        if (cancelled) return;
        // A refusal is not a receipt. Null is what an unauthorised caller and a
        // peer who has never opened the thread both get, and the pessimistic
        // reading — no receipt — is the only safe one for either.
        if (error) { reportError('readReceipts.peer', error); return; }
        const at = typeof data === 'string' ? data : null;
        if (!at) return;
        // Forward only on this side too. A stale answer arriving after a fresh
        // one must not make the other person's "Read" blink back to "Sent".
        setPeerReadAt((prev) => {
          if (!prev) return at;
          const a = Date.parse(at);
          const b = Date.parse(prev);
          if (!Number.isFinite(a)) return prev;
          return !Number.isFinite(b) || a > b ? at : prev;
        });
      } catch (e) {
        reportError('readReceipts.peer', e);
      }
    };
    void read();
    const handle = setInterval(() => { void read(); }, RECEIPT_POLL_MS);
    return () => { cancelled = true; clearInterval(handle); };
  }, [threadId, awake, worth]);

  const line = useCallback(
    (m: ThreadMessage, time: string) => deliveryLine(toBubble(m, role, unsent), peerReadAt, { them, time }),
    [role, unsent, peerReadAt, them],
  );

  return { line, peerReadAt };
}
