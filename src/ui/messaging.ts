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
import { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { sendPush } from './pushNotifications';
import { ensureMediaPermission } from './permissions';
import { useAuthRevision } from './authRevision';
import { reportError } from '../lib/reportError';
import type { Message } from '../lib/types';
import type { LoadStatus } from './loadStatus';
import { capLimit, capped } from '../lib/rowCap';
import { resolvePeerName, type PeerName } from '../lib/threadPeer';
import { resolvePeerAvatar } from '../lib/peerAvatar';
import {
  MESSAGE_MEDIA_BUCKET, MESSAGE_MEDIA_TTL_S, MESSAGE_IMAGE_WIDTH, MESSAGE_VIDEO_MAX_SECONDS,
  messageAttachmentPath, attachmentContentType, attachmentExtension, attachmentKindFor,
  attachmentNoun, attachmentRefusal, hasSomethingToSend, readAttachment,
  type AttachmentKind, type AttachmentRead, type MessageAttachment,
} from '../lib/messageAttachments';

export type ChatRole = 'client' | 'coach';

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
 * was then refused. That file is unreachable — nothing points at it, and the
 * account-deletion purge described in supabase/parts/124 does not exist yet —
 * so removing it here is what stops the bucket accumulating photographs nobody
 * can see and nobody asked to keep.
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
export type SendResult = { ok: true } | { ok: false; reason: string | null };

/** Which half of an attached send failed, kept per bubble. */
export type UnsentStage = 'upload' | 'send';

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
  const coachId = useRef<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) { setReady(true); setStatus('ready'); return; }
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
      // No thread key at all: there is nothing to read, and nothing was hidden.
      if (!cid) { setReady(true); setStatus('ready'); return; }
      if (role === 'client') {
        // Only used to address the push notification back to the coach. Failing
        // it costs a notification, not the thread, so it stays swallowed — but
        // deliberately, and only here.
        // no-error-ok: a tie-break for which coach to show; absent behaves the same as having no coach
      try { const { data: cr } = await supabase.from('clients').select('trainer_id').eq('id', cid).single(); coachId.current = (cr as any)?.trainer_id ?? null; } catch { /* push addressing only */ }
      }
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
          if (rows.length) setMessages(rows.map(rowToMsg));
          setStatus(page.truncated ? 'partial' : 'ready');
        }
      } catch { if (!cancelled) setStatus('error'); }
      if (!cancelled) setReady(true);
      // Opening the thread is what marks it read, for whichever side opened it.
      // The side is inferred server-side from who is calling, so this cannot
      // clear the other person's unread count. Failing costs an unread badge
      // that stays up, which is the harmless direction — it never hides a
      // message, it only keeps claiming one is waiting.
      // no-error-ok: an unmarked thread keeps showing as unread, which overstates rather than hides
      try { await supabase.rpc('mark_thread_read', { p_client: cid }); } catch { /* the badge stays up */ }
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
  }, [clientId, role, authRev]);

  /** Stop a bubble reading as in-flight, and record which half of the send
   *  failed so the screen can say the useful half of it. */
  const markUnsent = (id: string, stage: UnsentStage) => {
    setUnsent((p) => ({ ...p, [id]: stage }));
    setMessages((p) => p.map((m) => (m.id === id ? { ...m, sending: false } : m)));
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
        // leave an object in the bucket that no row references and no purge
        // exists for (the operator note in supabase/parts/124).
        if (stored) await removeMessageAttachment(stored.path);
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
      // What the push says when the message is a photograph and nothing else.
      // It does not quote a caption that was never written, and it does not say
      // "sent you a message" either — the notification is most of what the
      // other person sees before they open it.
      const preview = b || (stored ? `Sent you a ${attachmentNoun(stored.kind)}` : '');
      // notify the other side (coach -> client push; client side needs the coach id, skipped)
      if (role === 'coach' && tid.current) sendPush([tid.current], 'New message from your coach', preview, { route: '/(client)/messages' });
      // The coach's route carries the thread key. It used to be the bare
      // '/(trainer)/chat', and the tap handler pushes that string straight at
      // the router — so a coach who opened the notification landed on a chat
      // with no clientId: an empty thread headed "Client", and a reply that went
      // nowhere because `send` has no thread to insert into. The client's route
      // needs no key; their thread is their own id, resolved from auth.
      else if (role === 'client' && coachId.current && tid.current) sendPush([coachId.current], 'New message from your client', preview, { route: '/(trainer)/chat?clientId=' + encodeURIComponent(tid.current) });
      return { ok: true };
    } catch (e) {
      reportError('messaging.send', e);
      if (stored) await removeMessageAttachment(stored.path);
      markUnsent(localId, 'send');
      return { ok: false, reason: 'That message did not reach the server, so it has not been sent.' };
    }
  };

  return { messages, send, ready, status, unsent };
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
