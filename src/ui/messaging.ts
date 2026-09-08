// Coach ↔ client chat thread. The thread is keyed by the client's id
// (messages.client_id). Live via Supabase Realtime with optimistic send.
// Starts empty — a thread with no messages shows no messages.
//
// ── Two silences this hook used to keep ────────────────────────────────────
//
// Reading: `ready` flipped to true whether the select succeeded or was refused,
// and on failure `messages` stayed `[]`. The chat screen showed its empty state
// — "No messages yet. Say hello." — to a client whose coach had written to them
// that morning. `ready` still means exactly what it meant (the initial load has
// settled, stop showing a spinner) because screens branch on it; `status` is the
// new thing, and it says whether the empty thread is a fact or a failure.
//
// Sending: the insert's `error` was never read, and the catch kept the
// optimistic bubble. So a message the server refused — an expired session, a
// client messaging a coach they are no longer linked to, no signal at all — sat
// in the thread looking exactly like a delivered one. The sender believed their
// coach had it. `send` now reports failure when the row did not land, and the
// ids of those bubbles are listed in `unsent` so the thread can mark them.
//
// ── Attachments, and the third way to fail ────────────────────────────────
//
// A message can now carry one photo or one short video, in both directions —
// the machine a client is standing in front of, the clip of the third rep a
// coach sends back. The rules an attachment obeys are in
// src/lib/messageAttachments.ts; the permissions are in supabase/parts/124,
// which puts the file in a private bucket the two people on this thread can
// read and nobody else can.
//
// What is new here is that sending is now TWO round trips — the file, then the
// row — and either can fail on its own. Both silences above are available again
// in a new form, so the order below is deliberate and is the whole of it:
//
//   1. the file goes up FIRST. If it does not, no row is written at all: a
//      message that says it sent a photo and did not is the exact failure this
//      hook was rewritten to stop telling, and quietly downgrading to a
//      text-only message is the same lie with better manners.
//   2. if the row is then refused, the object we just uploaded is removed, so
//      the bucket does not fill with files nothing points at.
//
// A bubble is `sending` until the row is on the server, and marked in `unsent`
// with WHICH half failed if it never gets there.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { ensureMediaPermission } from './permissions';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';
import type { Message } from '../lib/types';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { cacheKey, cachedAtLine, packCache, readCache, withinHorizon } from '../lib/readCache';
import { classifyWrite } from '../lib/offlineQueue';
import { useOutbox } from './outbox';
import { resolvePeerName, type PeerName } from '../lib/threadPeer';
import { resolvePeerAvatar } from '../lib/peerAvatar';
import {
  blockStateOf, looksLikeThreadRefusal, REPORT_FAILED_NOTE, SEND_REFUSED_NOTE,
  type BlockRow, type BlockState, type ReportCategory,
} from '../lib/threadSafety';
import {
  MESSAGE_MEDIA_BUCKET, MESSAGE_MEDIA_TTL_S, MESSAGE_IMAGE_WIDTH, MESSAGE_VIDEO_MAX_SECONDS,
  messageAttachmentPath, attachmentContentType, attachmentExtension, attachmentKindFor,
  attachmentNoun, attachmentRefusal, hasSomethingToSend, readAttachment,
  type AttachmentKind, type AttachmentRead, type MessageAttachment,
} from '../lib/messageAttachments';

export type ChatRole = 'client' | 'coach';

/** Where a thread is kept on this device, keyed by the thread's own id. */
const THREAD_SCOPE = 'thread';

/**
 * How stale a cached thread may be before it stops being worth opening.
 *
 * Fourteen days, far longer than the timetable's two. The failure a stale
 * timetable causes is somebody turning up to a class that is not on; the
 * failure a stale thread causes is somebody reading a conversation that is
 * genuinely theirs and genuinely happened, missing only whatever came after —
 * and the label says exactly that. The one thing it must not do is silently
 * become the thread, which is what `cachedNote` prevents.
 */
const THREAD_CACHE_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

/** What one queued message carries. Text only — see `send`, and the argument in
 *  src/lib/outbox.ts about why a queued write may not depend on a file. */
export interface QueuedMessage { clientId: string; sender: ChatRole; body: string }

/** Narrow an outbox payload back to a message. Written down once because the
 *  payload crosses AsyncStorage as `unknown` and two places read it. */
export function asQueuedMessage(payload: unknown): QueuedMessage | null {
  const p = payload as any;
  if (!p || typeof p !== 'object') return null;
  const clientId = typeof p.clientId === 'string' ? p.clientId : '';
  const body = typeof p.body === 'string' ? p.body : '';
  const sender = p.sender === 'coach' ? 'coach' : 'client';
  if (!clientId || !body.trim()) return null;
  return { clientId, sender, body };
}

/**
 * A message as this thread holds it.
 *
 * `attachment` is what the ROW is carrying, already judged: 'none', 'ok' with a
 * storage path, or 'unreadable' with a sentence to show. A screen never has to
 * decide what to do with half a pair.
 *
 * `local` and `sending` describe a bubble that is still on its way. They are
 * both about honesty rather than presentation: the picture on screen during an
 * upload is the file on THIS phone, and it must not be dressed as delivered
 * until the row exists.
 */
export interface ThreadMessage extends Message {
  attachment: AttachmentRead;
  /** The picked file on this device, drawn while it uploads and left in place
   *  if it never got there. Null once the row is real — from then on the
   *  picture comes from a signed URL like everybody else's. */
  local: { uri: string; kind: AttachmentKind } | null;
  /** In flight. Not delivered, not failed. */
  sending: boolean;
}

const rowToMsg = (r: any): ThreadMessage => ({
  id: String(r.id), clientId: r.client_id, sender: r.sender, body: r.body, createdAt: r.created_at,
  // Judged against the row's OWN thread key, which is what the storage policy
  // reads. A path pointing anywhere else is not drawn, whatever the row says.
  attachment: readAttachment(r, String(r.client_id ?? '')),
  local: null,
  sending: false,
});

/* ── picking, preparing and storing one attachment ───────────────────────── */

/** A file chosen on this device and not yet anywhere else. */
export interface PendingAttachment {
  uri: string;
  kind: AttachmentKind;
  mimeType: string | null;
  fileName: string | null;
}

/** Where the file is coming from. The library offers both kinds at once,
 *  because a person opening it is looking for "that thing I took", not for a
 *  category. */
export type AttachSource = 'library' | 'photo' | 'video';

/**
 * Open the picker.
 *
 * Returns { attachment: null, error: null } when the person simply backed out —
 * a cancel is not a failure and must not raise anything at them. An `error` is
 * a sentence to show: a permission that cannot be asked for again, or a file
 * that is neither a photo nor a video and would arrive as something the other
 * side cannot open.
 */
export async function pickMessageAttachment(
  source: AttachSource,
): Promise<{ attachment: PendingAttachment | null; error: string | null }> {
  const permission = source === 'library' ? 'library' : 'camera';
  const purpose = source === 'video' ? 'send a video in a message' : 'send a photo in a message';
  // ensureMediaPermission says its own piece — including offering Settings when
  // iOS will not ask again — so a false here is already explained on screen.
  if (!(await ensureMediaPermission(permission, purpose))) return { attachment: null, error: null };

  try {
    const res = source === 'library'
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'] })
      : source === 'photo'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
        // Capped at the recorder rather than after the fact: a clip refused for
        // its size once it is already recorded wastes the take, and the whole
        // useful form check is a few reps long.
        : await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MESSAGE_VIDEO_MAX_SECONDS });
    if (res.canceled || !res.assets || !res.assets[0]) return { attachment: null, error: null };
    const a = res.assets[0];
    const kind = attachmentKindFor(a.mimeType, a.fileName)
      // The picker's own word for it, when it did not give a mime type.
      ?? (a.type === 'image' ? 'image' : a.type === 'video' ? 'video' : null);
    if (!kind) {
      return { attachment: null, error: 'That file is not a photo or a video, so it cannot be sent in a message.' };
    }
    return {
      attachment: { uri: a.uri, kind, mimeType: a.mimeType ?? null, fileName: a.fileName ?? null },
      error: null,
    };
  } catch (e) {
    reportError('messaging.pick', e);
    return { attachment: null, error: 'The picker could not be opened. Try again.' };
  }
}

function newToken(): string {
  return Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '').padEnd(8, '0');
}

/**
 * Put one attachment in the bucket.
 *
 * An image is downscaled and re-encoded as JPEG first. That is not only about
 * size: the picker hands back HEIC on an iPhone, which the bucket does not
 * accept and which half the things that might display it cannot open, so
 * uploading one under an image/jpeg content type would be storing a file whose
 * declared type is a lie. Video is passed through untouched — re-encoding it
 * would need a native dependency this app does not have, and adding one would
 * mean the feature could not ship over the air at all.
 *
 * Resolves { path } only when the object is actually there. Every other
 * outcome is { error } with something a person can read, and the caller must
 * not write a row on the strength of having tried.
 */
export async function uploadMessageAttachment(
  threadId: string,
  senderId: string,
  att: PendingAttachment,
): Promise<{ path: string | null; error: string | null }> {
  const noun = attachmentNoun(att.kind);
  if (!USE_SUPABASE) return { path: null, error: `This build has no server, so the ${noun} has nowhere to go.` };

  let uri = att.uri;
  if (att.kind === 'image') {
    try {
      const out = await ImageManipulator.manipulateAsync(
        att.uri,
        [{ resize: { width: MESSAGE_IMAGE_WIDTH } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      uri = out.uri;
    } catch (e) {
      reportError('messaging.prepare', e);
      return { path: null, error: 'That photo could not be prepared for sending. Try another one.' };
    }
  }

  let bytes: ArrayBuffer;
  try {
    const res = await fetch(uri);
    if (!res.ok) return { path: null, error: `That ${noun} could not be read off your phone.` };
    bytes = await res.arrayBuffer();
  } catch (e) {
    reportError('messaging.read-file', e);
    return { path: null, error: `That ${noun} could not be read off your phone.` };
  }

  // Before a byte leaves. Storage answers an over-large object with a 413 that
  // arrives as an opaque failure; this is the same limit said in advance.
  const refusal = attachmentRefusal(bytes.byteLength, att.kind);
  if (refusal) return { path: null, error: refusal };

  const ext = attachmentExtension(att.kind, att.mimeType, att.fileName);
  const path = messageAttachmentPath(threadId, senderId, Date.now(), newToken(), ext);
  const contentType = attachmentContentType(path);
  if (!contentType) return { path: null, error: `That ${noun} is in a format this app cannot send.` };

  // upsert:false, and the key carries a timestamp and a token, so an upload is
  // always a new object. There is no UPDATE policy on the bucket by design —
  // replacing the bytes behind a key somebody has already been shown is a
  // change nobody could see afterwards (supabase/parts/124).
  const { error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) {
    reportError('messaging.upload', error, { path });
    return { path: null, error: `That ${noun} could not be sent, so nothing was posted to the conversation.` };
  }
  return { path, error: null };
}

/* ── signing, once per path and in one round trip ─────────────────────────── */
//
// Every attachment on screen needs a URL, and a thread is drawn all at once —
// a ScrollView renders all of its children, so a conversation with forty photos
// in it would open forty signing requests at the same moment. They are batched
// instead: a request joins a queue, the queue is flushed a tick later through
// `createSignedUrls`, and the answers are cached until shortly before they
// expire. Re-rendering the thread signs nothing again.
//
// The cache holds URLs, which are bearer strings, and it lives in memory for as
// long as the app is running. That is the same exposure the URLs already have
// once they are in an <Image>, and it ends with the process.

const signed = new Map<string, { url: string; until: number }>();
let signQueue: { path: string; resolve: (url: string | null) => void }[] = [];
let signTimer: ReturnType<typeof setTimeout> | null = null;

/** A minute of headroom, so a URL handed out is never one about to die. */
const SIGN_MARGIN_MS = 60 * 1000;

async function flushSignQueue() {
  signTimer = null;
  const batch = signQueue;
  signQueue = [];
  if (!batch.length) return;
  const paths = Array.from(new Set(batch.map((b) => b.path)));
  const answers = new Map<string, string>();
  try {
    const { data, error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET)
      .createSignedUrls(paths, MESSAGE_MEDIA_TTL_S);
    // A refused batch is not a batch of files that do not exist. Every caller
    // gets null and the screen says it could not load them, which is the
    // difference between a gap with a reason and a photo that vanished.
    if (error) reportError('messaging.sign', error, { count: paths.length });
    for (const s of data ?? []) {
      // Per-item errors ride inside a successful response, so a single
      // unreadable path does not sink the rest of the thread.
      if (!s.error && s.path && s.signedUrl) answers.set(s.path, s.signedUrl);
    }
  } catch (e) {
    reportError('messaging.sign', e, { count: paths.length });
  }
  const until = Date.now() + MESSAGE_MEDIA_TTL_S * 1000 - SIGN_MARGIN_MS;
  for (const [p, u] of answers) signed.set(p, { url: u, until });
  for (const b of batch) b.resolve(answers.get(b.path) ?? null);
}

/**
 * A URL an <Image> or a player can open, for as long as the signature lasts.
 *
 * The signing call is itself checked against the bucket's SELECT policy, so a
 * path belonging to a thread this viewer is not on comes back null here rather
 * than rendering. That is the same rule the row obeys, asked of the file.
 */
export async function signAttachment(path: string): Promise<string | null> {
  if (!USE_SUPABASE || !path) return null;
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  if (hit) signed.delete(path);
  return new Promise<string | null>((resolve) => {
    signQueue.push({ path, resolve });
    if (!signTimer) signTimer = setTimeout(() => { flushSignQueue(); }, 50);
  });
}

/**
 * Take an object back out of the bucket.
 *
 * Called on one path only: an attachment that uploaded and whose message row
 * was then refused. That file is unreachable: nothing points at it.
 *
 * This used to say the account-deletion purge part 124's operator note asked
 * for "does not exist yet". It does now — part 1120 built the queue, the hook
 * and the drain, and `message-media` is one of the six buckets in
 * `object_purge_bucket_is_ours` (1120's three plus 1152's coach-logos,
 * coach-docs and exercise-videos). It is matched on BOTH path segments, so the
 * orphan goes whether the erased account is the thread's or the sender's.
 *
 * That does not make this call redundant, and the difference is the whole
 * reason it is still here. The purge is fired by an account being erased. Both
 * participants may go on using the app for years, and until one of them leaves
 * nothing in the database will ever look at this key. Removing it now is what
 * stops the bucket accumulating photographs nobody can see and nobody asked to
 * keep, for as long as the accounts live.
 *
 * Returns whether it went. Best effort by design: the send has already failed
 * and the sender is being told so, and a failure to clean up must not turn into
 * a second sentence about a file they no longer care about. A DELETE through
 * the Storage API is the only thing that removes the bytes — see the account of
 * `protect_objects_delete` in 45-progress-photos.sql.
 */
export async function removeMessageAttachment(path: string): Promise<boolean> {
  if (!USE_SUPABASE || !path) return false;
  try {
    const { error } = await supabase.storage.from(MESSAGE_MEDIA_BUCKET).remove([path]);
    if (error) { reportError('messaging.orphan-cleanup', error, { path }); return false; }
    return true;
  } catch (e) {
    reportError('messaging.orphan-cleanup', e, { path });
    return false;
  }
}

/**
 * The signed URL for one attachment, resolved once per path.
 *
 * `status` matters as much as `url`: 'loading' is a picture on its way and
 * 'error' is one we could not get a link for. Neither is "there is no picture",
 * which is what a bare null would have to render as — and a message whose photo
 * silently vanishes is indistinguishable from one that was never sent.
 */
export function useAttachmentUrl(attachment: MessageAttachment | null): { url: string | null; status: LoadStatus } {
  const [state, setState] = useState<{ url: string | null; status: LoadStatus }>(
    { url: null, status: attachment ? 'loading' : 'ready' });
  const path = attachment?.path ?? null;

  useEffect(() => {
    if (!path) { setState({ url: null, status: 'ready' }); return; }
    let live = true;
    setState({ url: null, status: 'loading' });
    (async () => {
      const u = await signAttachment(path);
      if (!live) return;
      setState(u ? { url: u, status: 'ready' } : { url: null, status: 'error' });
    })();
    return () => { live = false; };
  }, [path]);

  return state;
}

/**
 * What happened to a send.
 *
 * `reason` is what to put in front of the person. It is null only when there is
 * nothing to say — a cancel, or an empty box — never as a stand-in for a
 * failure whose cause we did not bother to name.
 */
export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason: string | null;
      /**
       * The words are on this device and will be sent when there is signal.
       *
       * Still `ok: false`, deliberately and permanently: `ok` means the other
       * person can read it, and a queued message is exactly the state where
       * they cannot. A caller that wants to say something softer than "that did
       * not send" reads this; a caller that does nothing with it keeps the
       * honest, pessimistic sentence it had before.
       */
      queued?: boolean;
    };

/**
 * What became of a bubble that is not on the server.
 *
 * 'upload' and 'send' are failures: the file did not go, or the row did not.
 * 'queued' is not a failure — the words are on this phone, they are counted,
 * and they go up when there is signal. It has to be a third value rather than
 * a flavour of 'send', because the sentence under the bubble is different and
 * so is what the sender should do about it.
 */
export type UnsentStage = 'upload' | 'send' | 'queued';

/**
 * Chat thread hook.
 * @param clientId thread key (the client's profile id). Pass null for the
 *        signed-in client's own thread (resolved from auth).
 * @param role who I am in this thread ('client' | 'coach').
 */
export function useThread(clientId: string | null, role: ChatRole) {
  const authRev = useAuthRevision();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  // Keyed by bubble id, and the value says WHICH half failed — the file or the
  // row — because the sender can do something different about each.
  const [unsent, setUnsent] = useState<Record<string, UnsentStage>>({});
  const tid = useRef<string | null>(clientId);
  const seen = useRef<Set<string>>(new Set());
  /** The device's outbox, or null in a tree without one. Null is a normal
   *  state, not an error — see `useOutbox`: a thread must still be able to
   *  attempt a send and report honestly that nothing was kept. */
  const outbox = useOutbox();
  /** When the thread on screen was last confirmed by the server, or null when
   *  it just was. Non-null means what is drawn came off this device. */
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  /** The same value as `tid.current`, in state. The ref is what the async
   *  paths read; this is what the merge below needs, because a ref changing
   *  re-renders nothing and the queued bubbles would not appear until something
   *  else happened to cause a render. */
  const [threadId, setThreadId] = useState<string | null>(clientId);
  /** Bumped to re-read the thread. Two things bump it: a queued message of
   *  ours having gone (see the effect below), and `reload` — the screen asking
   *  for the conversation again, which is what a pull-to-refresh on a chat is.
   *
   *  This said "There is no realtime subscription on this thread", and it was
   *  flatly wrong about the code two hundred lines below it: the effect opens
   *  `.channel('msg:' + cid)` and subscribes to INSERTs on `messages` filtered
   *  to this thread, appending anything `seen` has not already got. The false
   *  sentence outlived several readings of this file and generated a roadmap
   *  item to build the subscription that was already here;
   *  app/(client)/messages.tsx carries the same correction against its own
   *  copy of it, and this is the copy that sentence was read from.
   *
   *  What is TRUE, and what `reload` is actually for, is that the subscription
   *  is BEST-EFFORT: it is opened inside a try/catch whose own comment reads
   *  "realtime optional", so a project without the publication, a network that
   *  will not open a websocket, or a socket dropped while the phone was asleep
   *  each leave the thread live-looking and silently static with nothing on
   *  screen to say so. Re-reading is the only way out of that. */
  const [reloadTick, setReloadTick] = useState(0);
  /**
   * Whether there is more thread ABOVE what is on screen.
   *
   * The read below is newest-first with `capLimit()`, so a relationship longer
   * than the cap arrives with its own beginning missing. That was reported as
   * `status: 'partial'` and nothing more: no screen said the word, and there
   * was no `loadOlder` anywhere in this file — so a long coaching relationship
   * lost its own start, unreadable in the product, with nothing admitting it.
   *
   * Set from the first page's `truncated` flag and re-set from every older page
   * afterwards, which is why it is separate from `status`: after one successful
   * step back the thread is still a prefix of itself, and 'partial' has to
   * remain true while "there is a button to press" changes.
   */
  const [hasOlder, setHasOlder] = useState(false);
  /** An older page in flight. Its own flag rather than `status`, because the
   *  thread on screen is fine and the composer must stay usable. */
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** The failure of a step back, or null. Never folded into `status`: the
   *  thread that IS on screen was read successfully and is not in doubt. */
  const [olderError, setOlderError] = useState<string | null>(null);
  const coachId = useRef<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) { setReady(true); setStatus('ready'); return; }
    // EVERY piece of thread state is dropped before the new key is read, and
    // this is the whole of the fix for the worst bug this hook has had.
    //
    // The coach's chat screen is a `Tabs.Screen` with `href: null` and no
    // `unmountOnBlur`, so `router.push('/(trainer)/chat?clientId=…')` for a
    // second client does not mount a second screen — it re-runs this effect on
    // the SAME mounted component, with `messages` still holding the first
    // client's conversation. The read below used to write the state back only
    // `if (rows.length)`, and the error path did not write it at all, so the
    // two cases where the new thread contributes no rows — it is empty, or the
    // read was refused — both left the previous client's private messages on
    // screen, under the new client's name and avatar, with the composer
    // addressed to the new client. A coach reviewing their roster one client at
    // a time would have read one client's messages attributed to another and
    // could have replied into that misattribution. Clearing here means the
    // worst case is now an empty thread, which is a thing we are allowed to be
    // wrong about, rather than a disclosure, which is not.
    //
    // `seen` and `unsent` go with it: both are keyed by message id from the
    // previous thread and would otherwise suppress or annotate bubbles that no
    // longer exist. `status` returns to 'loading' so chat.tsx does not draw its
    // empty state over a thread that has not been read yet.
    setMessages([]);
    setUnsent({});
    seen.current = new Set();
    setReady(false);
    setStatus('loading');
    // Goes with the rest of it. A `hasOlder` left over from the previous thread
    // offers a step back into a conversation that is not this one.
    setHasOlder(false);
    setLoadingOlder(false);
    setOlderError(null);
    let cancelled = false;
    let channel: any = null;
    (async () => {
      let cid = clientId;
      if (!cid && role === 'client') {
        try {
          const { data: sess } = await supabase.auth.getSession();
          if (cancelled) return;
          if (!sess?.session) { setStatus('ready'); setReady(true); return; }
          const { data: auth, error: authErr } = await supabase.auth.getUser();
          // Not knowing who you are is a failure, not an empty thread.
          if (authErr) { if (!cancelled) { setStatus('error'); setReady(true); } return; }
          cid = auth?.user?.id ?? null;
        } catch { if (!cancelled) { setStatus('error'); setReady(true); } return; }
      }
      if (cancelled) return;
      tid.current = cid;
      setThreadId(cid);
      // No thread key at all: there is nothing to read, and nothing was hidden.
      if (!cid) { setReady(true); setStatus('ready'); return; }
      if (role === 'client') {
        // Only used to address the push notification back to the coach. Failing
        // it costs a notification, not the thread, so it stays swallowed — but
        // deliberately, and only here.
        // no-error-ok: a tie-break for which coach to show; absent behaves the same as having no coach
      try { const { data: cr } = await supabase.from('clients').select('trainer_id').eq('id', cid).single(); coachId.current = (cr as any)?.trainer_id ?? null; } catch { /* push addressing only */ }
      }
      // ── this device's copy of the thread, before the network ───────────
      //
      // A member in a basement could not read a word their coach had written.
      // This is the thread as it stood the last time this phone could ask, and
      // `cachedNote` is what stops it reading as the live one.
      //
      // Assigned only when the cache actually parsed AND is inside the horizon.
      // `rows === null` means we learnt nothing from the device, which is not
      // the same as an empty thread and must never render as one — the empty
      // state on this screen is "No messages yet. Say hello.", said to somebody
      // whose coach wrote to them that morning.
      try {
        const cached = readCache<any>(await AsyncStorage.getItem(cacheKey(THREAD_SCOPE, cid)));
        if (cancelled) return;
        if (cached.rows && cached.rows.length && withinHorizon(cached.at, Date.now(), THREAD_CACHE_HORIZON_MS)) {
          const rows = cached.rows.map(rowToMsg);
          seen.current = new Set(rows.map((m: ThreadMessage) => m.id));
          setMessages(rows);
          setCachedAt(cached.at);
          // Not `setStatus('ready')`. Nothing has been confirmed; the read
          // below decides between 'ready' and 'error', and under 'error' this
          // list is exactly the "what we had before the failure" case
          // src/ui/loadStatus.ts describes.
          setReady(true);
        }
      } catch { /* no usable cache; the read below is the only source */ }

      try {
        // Newest-first on the wire, oldest-first in the state. A thread is the
        // one read here where the ascending page is unambiguously the wrong
        // half: a coach and client who have exchanged a thousand messages open
        // the screen to say something now, and the ascending cap would have
        // shown them the conversation they had when they met and silently
        // dropped everything since — including the message that just arrived.
        const { data, error } = await supabase.from('messages').select('*')
          .eq('client_id', cid).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(capLimit());
        if (cancelled) return;
        if (error) { setStatus('error'); }
        else {
          const page = capped(data);
          const rows = page.rows.slice().reverse();
          // `seen` guards the realtime subscription against re-appending a
          // message already on screen. It is keyed on what we HOLD, so it is
          // built from the trimmed page — seeding it with the probe row would
          // have made the realtime handler drop a message we never rendered.
          seen.current = new Set(rows.map((r: any) => String(r.id)));
          // Unconditional. `rows` IS the thread for this key, and an empty one
          // means this pair has never written to each other — a fact the screen
          // is entitled to state. Guarding on `rows.length` only ever preserved
          // whatever happened to be in state, which after a client switch is
          // somebody else's conversation.
          setMessages(rows.map(rowToMsg));
          setStatus(page.truncated ? 'partial' : 'ready');
          // The same fact, said as something the member can act on. `status`
          // stays 'partial' for as long as the thread is a prefix; this is what
          // decides whether there is anything left to fetch.
          setHasOlder(page.truncated);
          setCachedAt(null);
          // …and this is now what a basement gets. The raw rows are cached
          // rather than the ThreadMessage objects, so the cache round-trips
          // through `rowToMsg` — the same converter the server's answer goes
          // through — and cannot grow a second opinion about a column name or
          // about what makes an attachment readable.
          //
          // A truncated page is cached anyway, and this is the one place in
          // this change where that is right: what was dropped is the OLDEST end
          // of a thread that is already longer than the cap, the rows on screen
          // are the same rows the live read shows, and the alternative is a
          // member with a long history having no cached thread at all.
          AsyncStorage.setItem(cacheKey(THREAD_SCOPE, cid), packCache(rows))
            .catch(() => { /* the thread is right this session either way */ });
        }
      } catch { if (!cancelled) setStatus('error'); }
      if (!cancelled) setReady(true);
      // Marking the thread read used to happen HERE, unconditionally, the
      // instant this read settled. It has moved to `useReadReceipt`
      // (src/ui/readReceipts.ts), and the move is the fix rather than a
      // refactor of it:
      //
      //   · opening a thread is not reading it. `mark_thread_read` writes
      //     `now()`, so a thread left at the top — or, on the coach's side, a
      //     chat screen still mounted behind whatever they opened next, which
      //     it always is — cleared every unread message in it. That overstated
      //     to the badge's own owner, and now that the other person is shown
      //     the word "Read" it would overstate to somebody else.
      //   · this hook is mounted for `send` alone by app/(trainer)/nudges.tsx
      //     and app/(trainer)/credentials.tsx. Opening either of those sheets
      //     marked a client's thread read without a word of it being drawn.
      //
      // The two screens that actually draw the conversation mount the hook, and
      // it writes the newest SERVER-CONFIRMED message's own timestamp — the
      // same column `coach_unread_counts()` compares against — only while the
      // end of the list is on screen, focused and in the foreground.
      try {
        channel = supabase
          .channel('msg:' + cid)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'client_id=eq.' + cid }, (payload: any) => {
            const m = rowToMsg(payload.new);
            if (seen.current.has(m.id)) return;
            seen.current.add(m.id);
            setMessages((p) => [...p, m]);
          })
          .subscribe();
      } catch { /* realtime optional: the thread is already loaded, this only adds live updates */ }
    })();
    return () => { cancelled = true; if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } } };
  }, [clientId, role, authRev, reloadTick]);

  /**
   * Re-read the thread when one of OUR queued messages has been sent.
   *
   * Without this the bubble the merge below draws from the outbox simply
   * disappears at the moment it succeeds, and the real row does not arrive
   * until the realtime channel delivers it — which it usually does, and must
   * not be relied on to: a project without the publication, a network that will
   * not open a websocket, and the member watches the message they just sent
   * vanish off the screen.
   *
   * Only on a DECREASE. Queuing a message increases the count and must not
   * trigger a read; the bubble is already on screen from the send path.
   */
  const queuedHere = useMemo(() => {
    const waiting = outbox?.pending;
    if (!waiting || !threadId) return 0;
    let n = 0;
    for (const i of waiting) {
      if (i.kind !== 'message') continue;
      if (asQueuedMessage(i.payload)?.clientId === threadId) n += 1;
    }
    return n;
  }, [outbox?.pending, threadId]);
  const queuedBefore = useRef(queuedHere);
  useEffect(() => {
    const before = queuedBefore.current;
    queuedBefore.current = queuedHere;
    if (queuedHere < before) setReloadTick((n) => n + 1);
  }, [queuedHere]);

  /** Stop a bubble reading as in-flight, and record which half of the send
   *  failed so the screen can say the useful half of it. */
  const markUnsent = (id: string, stage: UnsentStage) => {
    setUnsent((p) => ({ ...p, [id]: stage }));
    setMessages((p) => p.map((m) => (m.id === id ? { ...m, sending: false } : m)));
  };

  /**
   * Nobody answered. Keep the words, if they can be kept.
   *
   * ── Why an attachment is never queued ──────────────────────────────────
   *
   * The outbox holds JSON in AsyncStorage. A photo lives at a file:// URI in a
   * cache directory the operating system is free to empty whenever it likes,
   * so a queued send with an attachment is an intent whose subject may not
   * exist by the time it runs — and the failure mode is the worst one this hook
   * has: a message that says it sent a photograph, delivered days later without
   * one. The file half fails immediately and honestly, and the member still has
   * the picture in their library to send again.
   *
   * ── Why the bubble is re-keyed onto the outbox's id ────────────────────
   *
   * Because the queued intent and the optimistic bubble are otherwise two
   * objects describing one message, and the thread merges the outbox in below.
   * Sharing an id is what stops the member's unsent message being drawn twice.
   */
  const keepForLater = async (localId: string, body: string, att: PendingAttachment | null): Promise<SendResult> => {
    const cid = tid.current;
    const failed = (): SendResult => {
      markUnsent(localId, 'send');
      return { ok: false, reason: 'That message did not reach the server, so it has not been sent.' };
    };
    if (att || !outbox || !cid || !body.trim()) return failed();
    const { result, id } = await outbox.enqueue('message', { clientId: cid, sender: role, body } satisfies QueuedMessage);
    if (result !== 'queued' || !id) {
      // Nothing was kept — the phone is holding as much as it will hold, or its
      // outbox could not be read. The member is told the pessimistic truth
      // rather than a promise this device cannot keep.
      return failed();
    }
    setMessages((p) => p.map((m) => (m.id === localId ? { ...m, id, sending: false } : m)));
    setUnsent((p) => { const n = { ...p }; delete n[localId]; n[id] = 'queued'; return n; });
    return {
      ok: false,
      queued: true,
      reason: 'No signal, so that message is saved on this phone and has not been sent yet. It goes as soon as you are back online.',
    };
  };

  /**
   * Send a message, with at most one photo or video on it.
   *
   * Reports ok only once the ROW is on the server and the other side can read
   * it. Anything else leaves the bubble on screen local: its id goes into
   * `unsent` with the stage that failed, and the caller must not let it read as
   * delivered. `reason` is a sentence to put in front of the sender — an upload
   * that did not go is worth an alert, not only a mark under a bubble, because
   * it is the case where somebody is about to put their phone away believing
   * their coach has seen their form.
   *
   * Note this fails in a no-backend build too, unlike `status`, which is
   * 'ready' there. A local-only read is a complete answer — there is nothing
   * else to know — but a local-only SEND is not a delivery: this thread has no
   * persistence of its own, so the message reaches nobody and does not survive
   * the session.
   *
   * THE ORDER IS THE FEATURE. The file goes first and the row second, so a
   * failed upload writes nothing at all; there is no state in which a message
   * exists claiming a photograph that does not. And a row refused after a
   * successful upload takes the object back out with it.
   */
  const send = async (body: string, attachment?: PendingAttachment | null): Promise<SendResult> => {
    const b = (body || '').trim();
    const att = attachment ?? null;
    if (!hasSomethingToSend(b, !!att)) return { ok: false, reason: null };
    const localId = 'local-' + Date.now();
    const optimistic: ThreadMessage = {
      id: localId, clientId: tid.current ?? 'c1', sender: role, body: b, createdAt: new Date().toISOString(),
      attachment: { state: 'none' },
      local: att ? { uri: att.uri, kind: att.kind } : null,
      sending: true,
    };
    setMessages((p) => [...p, optimistic]);
    if (!USE_SUPABASE || !tid.current) {
      markUnsent(localId, att ? 'upload' : 'send');
      return { ok: false, reason: 'This message could not be sent.' };
    }

    // ── 1 · the file ──────────────────────────────────────────────────────
    let stored: { path: string; kind: AttachmentKind } | null = null;
    if (att) {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      if (authErr || !uid) {
        // The uploader's own id is the second folder in the key and the whole
        // of the write policy, so not knowing it is a refusal, not a retry.
        reportError('messaging.upload-uid', authErr);
        markUnsent(localId, 'upload');
        return { ok: false, reason: `We could not confirm who you are, so the ${attachmentNoun(att.kind)} was not sent.` };
      }
      const up = await uploadMessageAttachment(tid.current, uid, att);
      if (!up.path) {
        markUnsent(localId, 'upload');
        return { ok: false, reason: up.error ?? `That ${attachmentNoun(att.kind)} could not be sent.` };
      }
      stored = { path: up.path, kind: att.kind };
    }

    // ── 2 · the row ───────────────────────────────────────────────────────
    try {
      const { data, error } = await supabase.from('messages').insert({
        client_id: tid.current, sender: role, body: b,
        attachment_path: stored?.path ?? null, attachment_kind: stored?.kind ?? null,
      }).select().single();
      if (error || !data) {
        // The file is up and nothing points at it. Take it back out rather than
        // leave an object in the bucket that no row references. This used to
        // add "and no purge exists for", citing part 124's operator note; part
        // 1120 has since written that purge and `message-media` is in it. But
        // that purge only runs when one of the two accounts is erased, which
        // may be never, so the orphan is still this call's to remove.
        if (stored) await removeMessageAttachment(stored.path);
        // A REFUSAL is not a failure to reach the server, and since part 240 it
        // is a state a member can put this thread into on purpose. Saying "that
        // did not reach the server" to somebody whose coach blocked them sends
        // them to check their signal over and over. The two causes a 42501 can
        // have here are named honestly in SEND_REFUSED_NOTE, because this
        // device cannot tell them apart and must not pick one.
        if (looksLikeThreadRefusal(error)) {
          markUnsent(localId, 'send');
          return { ok: false, reason: SEND_REFUSED_NOTE };
        }
        // Everything else goes through the same classifier every other queue in
        // this app uses. `data` missing with no error is PostgREST having
        // narrowed the insert to nothing, which is a refusal; an error with no
        // SQLSTATE is nobody having answered, which is what may wait.
        if (classifyWrite(error as any, data ? 1 : 0) === 'unsent') return keepForLater(localId, b, att);
        markUnsent(localId, 'send');
        return { ok: false, reason: 'That message did not reach the server, so it has not been sent.' };
      }
      seen.current.add(String(data.id));
      // The row replaces the optimistic bubble, and the file on this phone is
      // kept beside it. It is the same file the row now points at, so drawing
      // it saves the sender watching their own photograph blink out and come
      // back through a signed URL. `sending` is false and `attachment` is the
      // stored one, so nothing about this reads as delivered that is not.
      setMessages((p) => p.map((m) => (m.id === localId
        ? { ...rowToMsg(data), local: att ? { uri: att.uri, kind: att.kind } : null }
        : m)));
      // ── THE PUSH IS THE SERVER'S, AND ONLY THE SERVER'S ──────────────────
      //
      // There used to be a `sendPush` here, and the row's own trigger pushes
      // too, so every message in this product arrived on the recipient's phone
      // TWICE — two banners, seconds apart, in two different wordings. Both
      // halves of the duplicate were written down and neither was removed:
      // supabase/functions/notify-message says "it was masked because
      // src/ui/messaging.ts fires a second, correctly-routed push for the same
      // message", and `PUSHED_BY_ITS_WRITER` in src/lib/notifyDispatch.ts warns
      // that a third pusher "would make every message in the product arrive
      // twice" — of a message that was already arriving twice.
      //
      // It is the same defect supabase/parts/2392 fixed for a coaching request
      // and a called-off class, and 2392's own words for why it matters are
      // src/lib/notifyCopy.ts's: double-pushing "is the thing that gets
      // notifications turned off", and turning them off is what took the money
      // channel down with the chat channel.
      //
      // THE SERVER'S COPY IS THE ONE THAT SURVIVES, for four reasons, none of
      // them a preference:
      //
      //   · it fires on the ROW, so it also covers the outbox flush below, the
      //     coach's fan-out in `sendCoachMessages`, the nudge on the trainer
      //     dashboard and anything else that ever writes a `messages` row. A
      //     handset push covers only the call site that remembered it.
      //   · it writes the inbox row (`icon: 'message'`), and
      //     src/lib/notifyInbox.ts already refuses to record the handset's copy
      //     — so this side has been pushing a banner with no record behind it.
      //   · it titles the client's banner with the COACH'S OWN NAME rather than
      //     'New message from your coach', which is what the bell shows.
      //   · it applies the 'chat' channel mute and quiet hours to BOTH sides.
      //     The push removed from here passed no channel on the coach → client
      //     leg at all, so a member who had muted chat was buzzed anyway.
      //
      // `messagePreview` stays in src/lib/messagePreview.ts and is still
      // asserted by messagePreview.test.ts; notify-message repeats those words
      // under Deno because it cannot import them, which is the duplication that
      // file's own header describes.
      return { ok: true };
    } catch (e) {
      reportError('messaging.send', e);
      // THE FILE IS DELIBERATELY LEFT WHERE IT IS.
      //
      // The `error` branch above removes it, and may: supabase-js resolved with
      // a refusal, so the row certainly does not exist and the object certainly
      // has nothing pointing at it. This branch is the other case, and it is
      // not the same case. A thrown fetch is "no answer" — the insert may have
      // COMMITTED and the response been lost on the way back, which is the
      // ordinary shape of a connection dropping mid-request. Deleting the bytes
      // here on that assumption produces the one state the order of these two
      // steps exists to make impossible: a delivered message pointing at an
      // attachment that is not there, permanently, on the recipient's screen.
      //
      // So the trade is stated rather than taken silently. An unreferenced
      // object costs storage nobody is looking at; a message whose photograph
      // will never load costs the conversation the photograph was the point of.
      // The path is reported so it is findable. That used to read "when the
      // purge described in supabase/parts/124 is eventually written"; it was
      // written, in part 1120, and this key will be queued and deleted when
      // either participant erases their account. Reporting it still matters,
      // because until then nothing else names it: if the insert did commit,
      // the object is referenced and healthy, and if it did not, it is an
      // orphan this branch deliberately declined to remove.
      if (stored) reportError('messaging.maybe-orphan', e, { path: stored.path });
      // Nobody answered at all — the offline case this whole path exists for.
      return keepForLater(localId, b, att);
    }
  };

  /**
   * One page further back into the conversation.
   *
   * Keyset, not offset. The cursor is the oldest row we hold — its timestamp
   * AND its id — because two messages can share a `created_at` and an offset
   * over a thread that is still being written to would skip or repeat rows the
   * moment a new one arrives. The compound predicate is the same tiebreak the
   * first page ordered by, read backwards.
   *
   * Prepends. `seen` is extended with what arrives so the realtime handler
   * still cannot double-append, and the guard against re-entry is
   * `loadingOlder` rather than a ref, because the button that calls this is
   * disabled from the same flag.
   *
   * A failure here is reported through `olderError` and never through `status`:
   * the messages already on screen were read successfully, and turning the
   * whole thread into an error because a step back was refused would take away
   * the part that worked.
   */
  const loadOlder = useCallback(async () => {
    if (!USE_SUPABASE) return;
    const cid = tid.current;
    if (!cid || loadingOlder || !hasOlder) return;
    const oldest = messages[0];
    // Nothing held means there is no cursor, and "load older than nothing" is
    // the first read, not this one.
    if (!oldest) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const { data, error } = await supabase.from('messages').select('*')
        .eq('client_id', cid)
        .or(`created_at.lt.${oldest.createdAt},and(created_at.eq.${oldest.createdAt},id.lt.${oldest.id})`)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(capLimit());
      if (error) {
        reportError('messaging.older', error);
        setOlderError('We could not read any further back just now. What is above is still the rest of the conversation, not the whole of it.');
        return;
      }
      const page = capped(data);
      const rows = page.rows.slice().reverse();
      const fresh = rows.filter((r: any) => !seen.current.has(String(r.id)));
      for (const r of fresh) seen.current.add(String(r.id));
      // An empty page means we have reached the beginning after all — the first
      // read's probe row said there was more and there is not, which happens
      // when the extra rows were deleted between the two reads.
      setHasOlder(fresh.length > 0 && page.truncated);
      if (fresh.length) setMessages((prev) => [...fresh.map(rowToMsg), ...prev]);
      // `status` is only cleared when the whole thread is now on screen. While
      // any of it is still above, the screen keeps saying so.
      if (!(fresh.length > 0 && page.truncated)) setStatus((st) => (st === 'partial' ? 'ready' : st));
    } catch (e) {
      reportError('messaging.older', e);
      setOlderError('We could not read any further back just now. What is above is still the rest of the conversation, not the whole of it.');
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, hasOlder]);

  /**
   * The thread, plus whatever this device is still holding for it.
   *
   * Without this, a message typed with no signal is invisible the moment the
   * screen is left and reopened: it is in the outbox, it will be sent, and the
   * member can see no trace of having written it. That is the same silence this
   * hook was rewritten to end, one layer further out.
   *
   * Keyed by id against what is already on screen, so the bubble the send path
   * re-keyed onto the outbox id is not drawn a second time from here.
   */
  const shown = useMemo(() => {
    const waiting = outbox?.pending;
    if (!waiting || !waiting.length || !threadId) return messages;
    const have = new Set(messages.map((m) => m.id));
    const extra: ThreadMessage[] = [];
    for (const item of waiting) {
      if (item.kind !== 'message' || have.has(item.id)) continue;
      const q = asQueuedMessage(item.payload);
      if (!q || q.clientId !== threadId) continue;
      extra.push({
        id: item.id, clientId: threadId, sender: q.sender, body: q.body, createdAt: item.at,
        // A queued message never carries one — see `keepForLater`.
        attachment: { state: 'none' }, local: null, sending: false,
      });
    }
    if (!extra.length) return messages;
    // Oldest first, like the rest of the thread. A queued message belongs at
    // the moment it was WRITTEN, not at the end: a member who typed two things
    // in a basement and one on the platform should read them back in the order
    // they said them.
    return [...messages, ...extra].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }, [messages, outbox?.pending, threadId]);

  /** The per-bubble marks, plus a 'queued' one for every bubble the merge above
   *  added — otherwise a waiting message renders with a timestamp and reads as
   *  delivered. */
  const shownUnsent = useMemo(() => {
    const waiting = outbox?.pending;
    if (!waiting || !waiting.length) return unsent;
    const out: Record<string, UnsentStage> = { ...unsent };
    for (const item of waiting) if (item.kind === 'message') out[item.id] = 'queued';
    return out;
  }, [unsent, outbox?.pending]);

  return {
    messages: shown,
    send,
    ready,
    status,
    unsent: shownUnsent,
    /** The thread key this hook settled on — the `clientId` it was given, or
     *  the signed-in member's own id when it was given none. Null until it is
     *  resolved, and null again for a screen opened without one. `useReadReceipt`
     *  needs it and the client's screen has no other way to know it. */
    threadId,
    /** The sentence for a thread read off this device rather than the server,
     *  or null when it was confirmed. Goes with `status === 'error'`. */
    cachedNote: cachedAtLine(cachedAt),
    /** True while there is conversation above what is drawn. The screen's cue
     *  to offer `loadOlder`, and the thing `status: 'partial'` never had. */
    hasOlder,
    /** An older page is on its way. The composer stays usable throughout. */
    loadingOlder,
    /** Why the last step back did not happen, or null. Distinct from `status`,
     *  which describes the thread that IS on screen. */
    olderError,
    /** One page further back. Safe to call when there is nothing to fetch. */
    loadOlder,
    /** Read the thread again from the top.
     *
     *  Goes through `reloadTick` rather than calling the read directly, so the
     *  merge rules and the `seen` bookkeeping in that effect are not duplicated
     *  — and so pages already stepped back to with `loadOlder` are handled the
     *  same way they are on any other re-read. */
    reload: () => setReloadTick((n) => n + 1),
  };
}

/**
 * Performs the write for a message that was queued while there was no signal.
 *
 * Renders nothing. Mounted once at the root, NOT inside `useThread`, and that
 * placement is the whole point of it: a message typed in a basement and then
 * left there — the app closed, the chat screen never reopened — would otherwise
 * have no handler registered when the flush ran, and would sit on the phone
 * being counted and never sent. The write is self-contained because the payload
 * carries the thread key and the sender, so nothing about it needs the screen.
 *
 * The push is sent from here too. A queued message that lands silently is a
 * message the other person does not know about until they next open the app,
 * which for a coach is the difference between answering a client the same day
 * and not.
 */
export function MessageOutboxHandler(): null {
  const outbox = useOutbox();
  useEffect(() => {
    if (!outbox) return;
    return outbox.registerHandler('message', async (item) => {
      const q = asQueuedMessage(item.payload);
      // A payload this file cannot read is one nothing can ever send. 'refused'
      // takes it out of the queue rather than leaving it to be retried on every
      // reconnect for the life of the install.
      if (!q) return 'refused';
      try {
        const { data, error } = await supabase.from('messages').insert({
          client_id: q.clientId, sender: q.sender, body: q.body,
          attachment_path: null, attachment_kind: null,
        }).select('id');
        const out = classifyWrite(error as any, data ? data.length : 0);
        if (out !== 'stored') {
          if (out === 'refused') reportError('messaging.outbox', error);
          return out;
        }
        // No push from here either, and this call site is the clearest case of
        // the four. The row has just landed, so the AFTER INSERT trigger on
        // `messages` has already posted it to notify-message — which resolves
        // the recipient itself and therefore needs neither the `clients` read
        // that used to happen here for addressing, nor this device to have
        // remembered which side sent it. See the long note in `send` above for
        // why the server's copy is the one that survives.
        //
        // What is deliberately NOT lost: a message typed in a basement still
        // reaches the other person's phone the moment it goes up, because the
        // push follows the row rather than the send.
        return 'stored';
      } catch {
        // Still no answer. It stays in the outbox, stays counted, and is tried
        // again on the next reconnect.
        return 'unsent';
      }
    });
  }, [outbox]);
  return null;
}

/* ── the coach's words, into several threads at once ───────────────────────── */

/** What became of one of the messages a bulk send fanned out into. */
export interface CoachSendResult {
  clientId: string;
  ok: boolean;
  /** Why not, in the coach's words. Null when the row is on the server. */
  why: string | null;
}

/**
 * Write the coach's message into N threads — one real message each.
 *
 * ── What this is, and the three things it deliberately is not ─────────────
 *
 * IT IS NOT A BROADCAST OBJECT. There is no row anywhere saying "this went to
 * twenty people". Each client gets an ordinary `messages` row in their own
 * thread, which they can reply to and which the coach sees in context beside
 * everything else they have said to that person. A broadcast object would be a
 * different thing wearing a message's clothes: a client replying to it would be
 * replying to nobody.
 *
 * IT DOES NOT COMPOSE ANYTHING. `body` is the coach's typed words and nothing
 * is added to them — see `bulkThreadNote` in src/lib/bulkActions.ts for the
 * full argument, which is the one src/lib/nudge.ts and supabase/parts/140
 * already make: a message that appears to come from a person who did not write
 * it is a defect this codebase has removed once already, and appending a true
 * sentence under the coach's name is the same falsehood with better manners.
 *
 * IT IS NOT A MULTI-ROW INSERT. One statement covering twelve clients is one
 * statement: a coach's book merges linked `clients` with hand-added
 * `coach_clients` rows whose ids have no `clients` row behind them, and
 * `messages.client_id` is a foreign key to `clients(id)` — so a single
 * hand-added person made Postgres reject the whole thing and nobody heard from
 * their coach. Twelve statements fail one at a time, which is what lets the
 * caller name the ones that did.
 *
 * ── Why the row is selected back ──────────────────────────────────────────
 *
 * `.select('id').single()` for the same reason `send` above does it: this
 * function's answer is what a screen will turn into "sent", and it must mean
 * the row exists rather than that the request did not raise. The write policy
 * is `msg_coach` — `is_my_client(client_id) AND sender = 'coach'` — so the
 * server decides both that these are the caller's clients and that the message
 * is from the coach. Neither is taken from this request.
 *
 * Pushes go only to the clients whose row landed, in one call, after all of
 * them: a push about a message that does not exist is worse than no push.
 */
export async function sendCoachMessages(
  clientIds: readonly string[],
  body: string,
): Promise<CoachSendResult[]> {
  const b = (body || '').trim();
  if (!b || !clientIds.length) return [];
  if (!USE_SUPABASE) {
    // A local-only read is a complete answer; a local-only SEND is not a
    // delivery. Nothing persists and the message reaches nobody, so this
    // reports failure rather than letting a screen say it went out.
    return clientIds.map((clientId) => ({
      clientId, ok: false,
      why: 'This build has no server to send to, so nothing was written to their thread.',
    }));
  }

  const results = await Promise.all(clientIds.map(async (clientId): Promise<CoachSendResult> => {
    try {
      const { data, error } = await supabase.from('messages')
        .insert({ client_id: clientId, sender: 'coach', body: b })
        .select('id').single();
      if (error || !data) {
        reportError('messaging.sendCoachMessages', error ?? new Error('insert returned no row'), { clientId });
        return {
          clientId, ok: false,
          // A REFUSAL is a different fact from a client who has no account yet,
          // and since part 240 it is one a member can create on purpose. Left
          // as the sentence below, a coach whose client blocked them would go on
          // believing the problem was a hand-added roster row.
          why: looksLikeThreadRefusal(error)
            ? 'That conversation is closed, so the message was not delivered.'
            : 'That message did not reach their thread. Clients you added by hand have no account to message until they join.',
        };
      }
      return { clientId, ok: true, why: null };
    } catch (e) {
      reportError('messaging.sendCoachMessages', e, { clientId });
      return { clientId, ok: false, why: 'That message did not reach the server, so it has not been sent.' };
    }
  }));

  // No push from here. Each of these is an ordinary `messages` row and the
  // trigger on that table pushes each one, addressed to the client whose row it
  // is — which is the property this call site cared about ("it can never
  // announce one that was not written") arrived at by construction rather than
  // by filtering a list afterwards. A fan-out of twelve used to buzz twelve
  // phones twice. See the note in `send`.
  return results;
}

/**
 * Who the thread is with — for the header, and for nothing else.
 *
 * ── TF-32 ────────────────────────────────────────────────────────────────
 *
 * The client's Messages screen headed the thread from `useCoachProfile()`,
 * which is the coach-side provider: it reads `auth.getUser()` and loads THAT
 * user's own `profiles.full_name`. Signed in as a client, that is the client —
 * so the thread with your coach was labelled with your own name. The messages
 * themselves were never misrouted (the thread is `messages.client_id` and RLS
 * decides who reads it), but a header naming the reader is worse than one
 * naming nobody, because it is a name they recognise.
 *
 * This hook only ever reports a name that came back from a read for the OTHER
 * party's id. When there is none the caller gets 'withheld' and draws a dash
 * with the reason. See src/lib/threadPeer.ts.
 *
 * ── Why the client side goes through an RPC ──────────────────────────────
 *
 * There is still no policy on `profiles` that runs client → coach, and there
 * should not be: one wide enough to let a client read their coach's row would
 * expose the whole row, and writing it as a subquery over `clients` is the
 * recursion 28-fix-profiles-recursion.sql exists to undo. So a client read of
 * `profiles` for their coach's id returns nothing, and this hook used to render
 * a labelled dash for almost every client — honest, and a poor experience in an
 * app whose premise is that somebody is coaching you.
 *
 * `public.my_coach()` (supabase/parts/67, extended by 115) is a security-definer
 * function that takes no arguments and returns two columns for one person.
 * Having no parameter is what makes it safe: there is nothing to probe, and it
 * can only ever answer about the coach of whoever is calling it.
 *
 * ── And the face that goes with the name ─────────────────────────────────
 *
 * `avatar` is the second half of the same answer and obeys the same rule: it is
 * whatever came back from the read for the OTHER party's id, and null the
 * moment that party is not identified. It is deliberately NOT a separate read
 * a screen could satisfy from somewhere else — the whole of TF-32 was a screen
 * finding the reader's own name and the reader's own face because those were
 * the ones it could get. resolvePeerAvatar (src/lib/peerAvatar.ts) is where
 * that is asserted.
 *
 * A caller that only wants the name can keep ignoring the extra field; the
 * value still satisfies PeerName, so app/(client)/calendar.tsx and
 * bookings.tsx are unaffected by its arrival.
 *
 * @param role who I am in this thread.
 * @param clientId the thread key when I am the coach; ignored for a client,
 *        whose coach comes from my_coach().
 */
export type ThreadPeer = PeerName & {
  /** The other party's avatar, or null to draw a monogram instead. Never the
   *  signed-in user's own — see src/lib/peerAvatar.ts. */
  avatar: string | null;
};

export function useThreadPeerName(role: ChatRole, clientId: string | null): ThreadPeer {
  const authRev = useAuthRevision();
  const [peer, setPeer] = useState<ThreadPeer>(() =>
    // With no backend there is no coaching link to read and never will be, so
    // this is settled at 'unlinked' rather than spinning on 'loading' forever.
    USE_SUPABASE ? { kind: 'loading', avatar: null } : { kind: 'unlinked', avatar: null });

  useEffect(() => {
    if (!USE_SUPABASE) { setPeer({ kind: 'unlinked', avatar: null }); return; }
    let cancelled = false;
    (async () => {
      let peerId: string | null = null;
      let linkFailed = false;
      let name: string | null = null;
      let avatar: string | null = null;

      if (role === 'coach') {
        // The coach's peer is handed in by the roster, so there is no link to
        // look up; an absent clientId is a thread with nobody in it.
        peerId = clientId;
      } else {
        try {
          // One call for the link AND the name. The function requires BOTH
          // halves of the coach↔client link to be present and active, the same
          // test fetchMyCoach uses before it will name somebody as able to see
          // your photographs — so "who is my coach" has one answer across the
          // app rather than a stricter one for photos and a looser one here.
          const { data, error } = await supabase.rpc('my_coach');
          if (cancelled) return;
          // A refused or failed RPC is not "you have no coach". No rows is.
          if (error) linkFailed = true;
          else {
            // RETURNS TABLE, so supabase-js hands back an array.
            const row: any = Array.isArray(data) ? data[0] : data;
            peerId = row?.coach_id ?? null;
            // Null here means a coach who has not set a name, which is a
            // different answer from a name we could not read — resolvePeerName
            // reports the first as 'withheld' only because peerId is present.
            name = typeof row?.coach_name === 'string' && row.coach_name ? row.coach_name : null;
            // Same column, same read, same row. A coach who has set no picture
            // is null here, which is the honest input to resolvePeerAvatar and
            // draws a monogram rather than somebody else's face.
            avatar = typeof row?.coach_avatar === 'string' ? row.coach_avatar : null;
          }
        } catch { if (!cancelled) { setPeer({ kind: 'unknown', avatar: null }); } return; }
      }

      // Coach side only. A client's name arrives with the link above, and
      // reading `profiles` for a coach's id from a client session is refused by
      // design — asking anyway would cost a round trip to be told no.
      if (!cancelled && role === 'coach' && peerId && !linkFailed) {
        try {
          // no-error-ok: refused and empty both render as the same labelled dash
          const { data } = await supabase.from('profiles').select('full_name, avatar').eq('id', peerId).single();
          if (cancelled) return;
          name = typeof (data as any)?.full_name === 'string' ? (data as any).full_name : null;
          // `profiles_trainer_read` is what makes this readable, and it runs
          // coach → their own client only. There is no branch on which this row
          // is the reader's; peerId came from the roster.
          avatar = typeof (data as any)?.avatar === 'string' ? (data as any).avatar : null;
        } catch { /* leaves the name unread, which the resolver reports as withheld */ }
      }

      // A coach's manually-added client has no profile row — the only record of
      // their name is the one the coach typed on the roster, which is that
      // client's name and nobody else's, so it is a legitimate second look.
      if (!cancelled && role === 'coach' && peerId && !name) {
        try {
          // no-error-ok: same as above — a name that does not come back leaves
          // the header a labelled dash, which is the honest rendering of it.
          const { data } = await supabase.from('coach_clients').select('name').eq('id', peerId).single();
          if (cancelled) return;
          name = typeof (data as any)?.name === 'string' ? (data as any).name : null;
        } catch { /* as above */ }
      }

      // `identified` is the same condition the name obeys: somebody is there,
      // and the link read is what says so. A failed link read leaves peerId
      // null for the same reason no-coach does, so both draw no face.
      if (!cancelled) setPeer({
        ...resolvePeerName({ settled: true, linkFailed, peerId, name }),
        avatar: resolvePeerAvatar({ identified: !linkFailed && !!peerId, url: avatar }),
      });
    })();
    return () => { cancelled = true; };
  }, [role, clientId, authRev]);

  return peer;
}

/* ── blocking, and reporting what was sent ─────────────────────────────────── */
//
// The moderation path this thread did not have. A repo-wide grep for
// `blockUser`, `report_user` or "report abuse" used to return nothing, on the
// one surface in this product that carries photographs and 30-second video
// between two named adults in a conversation nobody else can see.
//
// Everything enforceable is at the database (supabase/parts/240):
//
//   · a block is a row, and the WITH CHECK on msg_client, msg_coach and
//     msgmedia_obj_insert REFUSES the write. It is not a filter over messages
//     that arrived anyway, and it is not a mute — the file has nowhere to land
//     either, which matters because the upload happens BEFORE the row.
//   · a report COPIES the message into `abuse_reports`. `msg_coach` is
//     `for all using (is_my_client(client_id))`, so the reported person can
//     delete the message; a report that only pointed at an id would be one they
//     could empty.
//
// This hook is therefore thin on purpose. It reads the rows so a screen can say
// what is true, and it makes the two writes. It decides nothing that the
// database does not also decide, so a stale or unread state costs a sentence
// and never costs the protection.

/** What a screen needs to offer a block, an unblock and a report. */
export interface ThreadSafety {
  /** Where this conversation stands. 'unknown' until a read lands — never
   *  softened into 'open', which would tell somebody who blocked their coach
   *  last night that they had not blocked anybody. */
  state: BlockState;
  /** How the read behind `state` went. */
  status: LoadStatus;
  /** The thread key, once resolved. Null means there is nothing to act on —
   *  no signed-in client, or a coach screen with no client selected. */
  threadId: string | null;
  /** Block the other party. Resolves ok only when the row is on the server. */
  block: () => Promise<{ ok: boolean; error: string | null }>;
  /** Lift my own block. Resolves ok only when a row was actually removed. */
  unblock: () => Promise<{ ok: boolean; error: string | null }>;
  /**
   * File one report. `messageId` null reports the conversation rather than one
   * message — which is the case when the abuse was the sum of it, or when the
   * message has already been deleted.
   *
   * Resolves an `id` only when the row exists. A report that "did not raise" is
   * not a report, and somebody who believes one is filed stops looking for
   * another way to get help.
   */
  report: (
    category: ReportCategory,
    note: string | null,
    messageId?: string | null,
  ) => Promise<{ id: string | null; error: string | null }>;
  reload: () => void;
}

export function useThreadSafety(clientId: string | null, role: ChatRole): ThreadSafety {
  const authRev = useAuthRevision();
  const [threadId, setThreadId] = useState<string | null>(role === 'coach' ? clientId : null);
  const [myId, setMyId] = useState<string | null>(null);
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>(USE_SUPABASE ? 'loading' : 'ready');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    // With no server there is no thread_blocks table to read and never will be.
    // 'ready' with no rows is the complete answer here, not a fabricated one.
    if (!USE_SUPABASE) { setStatus('ready'); setRows([]); return; }
    let cancelled = false;
    // Dropped before the new key is read, exactly as useThread drops its
    // messages: a coach moving between two clients on the same mounted screen
    // would otherwise carry the previous client's block state onto this one.
    setRows(null);
    setStatus('loading');
    (async () => {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (cancelled) return;
      // Not knowing who I am is a failed read, not an open thread — blockStateOf
      // returns 'unknown' for a null id and this is why it has that branch.
      if (authErr) { setStatus('error'); return; }
      const uid = auth?.user?.id ?? null;
      setMyId(uid);
      const tid = role === 'coach' ? clientId : uid;
      setThreadId(tid);
      if (!tid) { setStatus('ready'); setRows([]); return; }
      try {
        const { data, error } = await supabase.from('thread_blocks').select('blocker_id').eq('thread_id', tid);
        if (cancelled) return;
        if (error) { reportError('messaging.blocks', error); setStatus('error'); return; }
        setRows(((data ?? []) as any[]).map((r) => ({ blockerId: String(r.blocker_id) })));
        setStatus('ready');
      } catch (e) {
        if (!cancelled) { reportError('messaging.blocks', e); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, role, authRev, tick]);

  const block = async (): Promise<{ ok: boolean; error: string | null }> => {
    if (!USE_SUPABASE) return { ok: false, error: 'This build has no server, so nothing can be blocked on it.' };
    if (!threadId || !myId) return { ok: false, error: 'We could not tell which conversation this is, so nothing was blocked.' };
    try {
      // `ignoreDuplicates` makes a second tap idempotent rather than an error:
      // the state it is asking for is already true. Only `error` is read, and
      // deliberately — an ignored duplicate returns NO rows, so counting rows
      // here would report "not blocked" for the one case where they certainly
      // are. An error-free upsert means the row is there, whichever tap put it
      // there, and `reload()` re-reads the truth for the screen either way.
      const { error } = await supabase.from('thread_blocks')
        .upsert({ thread_id: threadId, blocker_id: myId }, { onConflict: 'thread_id,blocker_id', ignoreDuplicates: true });
      if (error) {
        reportError('messaging.block', error);
        return { ok: false, error: 'That did not save, so nothing has been blocked and they can still message you.' };
      }
      reload();
      return { ok: true, error: null };
    } catch (e) {
      reportError('messaging.block', e);
      return { ok: false, error: 'That did not save, so nothing has been blocked and they can still message you.' };
    }
  };

  const unblock = async (): Promise<{ ok: boolean; error: string | null }> => {
    if (!USE_SUPABASE) return { ok: false, error: 'This build has no server, so there is nothing to unblock on it.' };
    if (!threadId || !myId) return { ok: false, error: 'We could not tell which conversation this is, so nothing was changed.' };
    try {
      // PostgREST reports a delete that matched no rows as a success, which is
      // how "you have unblocked them" gets printed over a row that is still
      // there. The returned rows are what decides.
      const { data, error } = await supabase.from('thread_blocks').delete()
        .eq('thread_id', threadId).eq('blocker_id', myId).select('blocker_id');
      if (error) {
        reportError('messaging.unblock', error);
        return { ok: false, error: 'That did not save, so they are still blocked.' };
      }
      if (!((data ?? []) as any[]).length) {
        return { ok: false, error: 'Nothing was unblocked. Open this screen again — the block may already have been lifted somewhere else.' };
      }
      reload();
      return { ok: true, error: null };
    } catch (e) {
      reportError('messaging.unblock', e);
      return { ok: false, error: 'That did not save, so they are still blocked.' };
    }
  };

  const report = async (
    category: ReportCategory,
    note: string | null,
    messageId?: string | null,
  ): Promise<{ id: string | null; error: string | null }> => {
    if (!USE_SUPABASE) return { id: null, error: 'This build has no server, so a report has nowhere to go.' };
    if (!threadId) return { id: null, error: 'We could not tell which conversation this is, so nothing was reported.' };
    try {
      // `report_abuse` decides who is being reported from the database rather
      // than from this request, and snapshots the message. It raises on every
      // refusal, so an id coming back is the row existing.
      const { data, error } = await supabase.rpc('report_abuse', {
        p_thread: threadId,
        p_category: category,
        p_note: note && note.trim() ? note.trim() : null,
        p_message: messageId ?? null,
      });
      if (error || !data) {
        reportError('messaging.report', error ?? new Error('report_abuse returned no id'));
        return { id: null, error: REPORT_FAILED_NOTE };
      }
      return { id: String(data), error: null };
    } catch (e) {
      reportError('messaging.report', e);
      return { id: null, error: REPORT_FAILED_NOTE };
    }
  };

  return { state: blockStateOf(status, rows, myId), status, threadId, block, unblock, report, reload };
}
