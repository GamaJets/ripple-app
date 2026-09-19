// The device half of the AI Coach conversation store.
//
// src/lib/coachChat.ts is the whole of the policy — where the thread lives
// and why it is not a table, why the key names the side as well as the account,
// what the trim is for, and what happens to a thread when the member withdraws
// the health consent it was written under. This file is only the store: the
// AsyncStorage key, the read, and the write behind each turn of the
// conversation.
//
// A hook rather than a provider, for the reason src/ui/coachShare.tsx gives for
// the consent answer it sits beside: two screens ask, two screens keep, and
// mounting a read of somebody's health conversation on the launch path of all
// three apps to serve two routes would be the wrong trade.
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportError } from '../lib/reportError';
import type { ChatMsg } from '../lib/coach';
import { coachChatKey, readThread, threadForConsent, writeThread, type ThreadSide } from '../lib/coachChat';
import { sessionUid } from '../lib/sessionUid';
import type { LoadStatus } from './loadStatus';
import { useAuthRevision } from './authRevision';

export interface CoachChat {
  /** The conversation so far. Empty under 'loading' means "not looked yet" and
   *  under 'partial' means "this phone is holding something we could not read"
   *  — neither is the claim that nothing was said. The usual rule, and it bites
   *  here because the screen's other empty state is a greeting and a row of
   *  suggestions, which is a confident "you have not asked me anything". */
  msgs: ChatMsg[];
  status: LoadStatus;
  /**
   * Whether what is on screen is being kept.
   *
   * False before the read lands, false when this device's stored thread could
   * not be parsed (writing over bytes we could not read is how a fortnight of
   * somebody's conversation goes in one line), false with nobody signed in, and
   * false for the rest of the session once the member has withdrawn the health
   * consent this thread was written under. A screen that says "kept on this
   * phone" has to answer to it.
   */
  kept: boolean;
  /** True when a stored thread was dropped on this read because the member has
   *  turned their health sharing off since writing it. The screen says so —
   *  src/lib/coachChat.ts · `WITHDRAWN_THREAD_NOTE`. */
  withdrawn: boolean;
  /** Replace the conversation and write it behind. */
  set: (next: ChatMsg[]) => void;
  /** The member's own delete. Removes the device copy and empties the screen. */
  clear: () => void;
}

/**
 * @param side which conversation — see src/lib/coachChat.ts on why one uid
 *   can legitimately have both.
 * @param opts.ready whether the caller knows enough to read or write yet. The
 *   client's AI Coach passes false until the consent question has an answer,
 *   because 'unknown' is a real state and restoring a health thread during it
 *   would be restoring it before being allowed to. The coach's Assistant passes
 *   true: there is no question in front of it.
 * @param opts.health whether THIS thread may contain health-tier material —
 *   the client's answer, false for the Assistant. It is written into the blob
 *   and it is what a later withdrawal is enforced against.
 */
export function useCoachChat(side: ThreadSide, opts: { ready: boolean; health: boolean }): CoachChat {
  const { ready, health } = opts;
  const authRev = useAuthRevision();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [withdrawn, setWithdrawn] = useState(false);

  const uidRef = useRef<string | null>(null);
  /** False once this device's thread could not be parsed, and once the member
   *  has withdrawn. Both mean the same thing to a write: do not. */
  const writable = useRef(false);
  /** Whether the thread on screen may hold health-tier material. Sticky: once a
   *  reply written from somebody's sleep is in it, the whole thread is that,
   *  and it stays that until it is cleared. */
  const isHealth = useRef(false);
  /**
   * True once this session has written a turn.
   *
   * Guards the read against a late landing overwriting a live conversation —
   * the same race, and the same guard, as `answered` in src/ui/coachShare.tsx.
   * A member quick enough to tap a suggestion before AsyncStorage comes back
   * would otherwise watch their question disappear.
   */
  const touched = useRef(false);

  /* ── read the device ─────────────────────────────────────────────────── */

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      // getSession() and not getUser(): the first reads the session already on
      // the device and answers offline, the second goes to the network to
      // revalidate and resolves with a null user when there is no signal. Every
      // provider in this folder fronts it for that reason, and src/ui/
      // glucoseData.ts records what the other way round cost.
      //
      // ── but a null session was two answers and this read only had one ─────
      //
      // It was `const { data } = await supabase.auth.getSession()` with the
      // error discarded, and `catch { /* treated as signed out */ }` underneath
      // saying so out loud. getSession() resolves with `{ session: null, error }`
      // when the stored access token has expired and the refresh cannot reach
      // the server — src/lib/sessionUidRead.ts quotes `__loadSession` — so an
      // outage arrived as the same null a phone with nothing in storage gives.
      //
      // That was the worst possible branch to get wrong HERE, and not because
      // of the sentence. The thread lives on this device under a key that names
      // the account: `coachChatKey(uid, side)`. With no uid there is no key, so
      // the branch below does not merely draw an empty screen — it cannot open
      // the copy that is sitting on the disk. Offline is exactly the condition
      // under which that copy is the only copy, and it was exactly the
      // condition that made this read call itself signed out and skip it. The
      // member then saw the empty state, which for this screen is a greeting
      // and a row of suggestions: a confident "you have not asked me anything"
      // over a fortnight of conversation that is still on the phone.
      const who = await sessionUid('coachChat.read');
      if (cancelled) return;
      uidRef.current = who.uid;
      if (who.fate === 'signed-out') {
        // Nobody signed in: there is no account to key a thread by, so nothing
        // is read and nothing will be kept. A settled empty rather than an
        // unread one, and the screen says "not kept" rather than spinning.
        writable.current = false;
        if (!touched.current) setMsgs([]);
        setStatus('ready');
        return;
      }
      if (who.fate !== null) {
        // 'unreadable'. We could not find out whose thread to open, so we do
        // not open one and we do not claim there is none. 'partial' is this
        // hook's existing word for "this phone is holding something we could
        // not read", which is the truth: the bytes are there and the key is
        // not. Nothing is written either — a turn written under no account
        // would be written to no key at all.
        writable.current = false;
        setStatus('partial');
        return;
      }
      // Narrowed on `fate`, never on `!who.uid`: UidRead's members are told
      // apart by fate, and `string` includes '', so `!who.uid` would leave the
      // failure branch holding an `AuthReadFate | null`. The two guards above
      // are exhaustive, so this is the signed-in member and `uid` is a string.
      const uid = who.uid;
      let raw: string | null = null;
      let failed = false;
      try { raw = await AsyncStorage.getItem(coachChatKey(uid, side)); }
      catch (e) { failed = true; reportError('coachChat.read', e); }
      if (cancelled) return;
      const got = failed ? { thread: null, read: false } : readThread(raw);
      if (!got.read) {
        // Bytes nobody could parse. What this session says is still shown; what
        // is on the disk is left exactly where it is until a launch can read it.
        writable.current = false;
        setStatus('partial');
        return;
      }
      const kept = threadForConsent(got.thread, health);
      if (kept.dropped && uid) {
        // The member turned their health sharing off between sessions. The copy
        // goes now rather than at the next write, because "removed" has to be
        // true at the moment they are told it.
        AsyncStorage.removeItem(coachChatKey(uid, side)).catch((e) => reportError('coachChat.drop', e));
        setWithdrawn(true);
      }
      isHealth.current = health || (!kept.dropped && !!got.thread?.health);
      writable.current = true;
      if (!touched.current) setMsgs(kept.msgs);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
    // `health` deliberately absent: a change to it is a withdrawal, and that is
    // handled below rather than by re-reading a key this effect has just been
    // told to stop trusting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRev, ready, side]);

  /* ── the member turns their health sharing off, mid-session ──────────── */

  useEffect(() => {
    if (health) { if (status !== 'loading') isHealth.current = true; return; }
    if (!isHealth.current) return;
    // What is on screen stays: nothing a member has already read changes under
    // them, which is the rule app/(client)/coach.tsx already keeps for its own
    // greeting. What stops is the keeping — the stored copy goes immediately,
    // and this session's remaining turns are not written, because they would be
    // written into a thread whose earlier half is exactly the material that was
    // just withdrawn.
    isHealth.current = false;
    writable.current = false;
    setWithdrawn(true);
    const uid = uidRef.current;
    if (uid) AsyncStorage.removeItem(coachChatKey(uid, side)).catch((e) => reportError('coachChat.withdraw', e));
  }, [health, status, side]);

  /* ── write ───────────────────────────────────────────────────────────── */

  const set = useCallback((next: ChatMsg[]) => {
    touched.current = true;
    // The screen keeps the whole conversation; the disk keeps the tail. Trimming
    // what is rendered would make a message the member is still reading vanish
    // at the moment they send the next one.
    setMsgs(next);
    const uid = uidRef.current;
    if (!uid || !writable.current) return;
    AsyncStorage.setItem(coachChatKey(uid, side), writeThread(next, isHealth.current))
      .catch((e) => reportError('coachChat.write', e));
  }, [side]);

  const clear = useCallback(() => {
    touched.current = true;
    setMsgs([]);
    setWithdrawn(false);
    const uid = uidRef.current;
    if (!uid) return;
    // Removed rather than written empty. An empty blob is still a row holding
    // whatever the platform has not yet reclaimed, and "cleared" should mean the
    // key is not there.
    AsyncStorage.removeItem(coachChatKey(uid, side)).catch((e) => reportError('coachChat.clear', e));
  }, [side]);

  return { msgs, status, kept: writable.current && status === 'ready', withdrawn, set, clear };
}
