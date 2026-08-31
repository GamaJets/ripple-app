// The rules an attachment on a message obeys, with no I/O in sight.
//
// The thread has been text since the app existed, and both sides ask for the
// same two things constantly: a client wants to photograph the machine they are
// standing in front of, and a coach wants to send back a clip of the third rep
// with the cue on it. This file is the part of that which can be decided
// without a network — what an object key looks like, what a row is allowed to
// claim, and what to say when something will not go.
//
// The I/O lives in src/ui/messaging.ts (pick, downscale, upload, sign) and the
// permissions live in supabase/parts/124-a-photo-of-the-machine.sql. Every rule
// below has a counterpart there; where that is true it is said in the comment,
// because a client-side check that has quietly drifted from the policy it
// mirrors is worse than no check at all — it produces a friendly sentence about
// a refusal that is not the one that happened.
//
// ── THE ONE THING THIS FILE EXISTS TO PREVENT ─────────────────────────────
//
// A bubble that says a photo was sent when it was not.
//
// That is the failure this codebase keeps finding and removing: `send` used to
// keep the optimistic bubble when the insert was refused (src/ui/messaging.ts
// says so at length), the video library said "Added" over a row that never
// landed (part 49), and the injury reader had to separate "stored" from "read"
// for the same reason (src/ui/injuryDocs.ts). An attachment doubles the number
// of ways to get it wrong, because there are now two round trips — the file and
// the row — and either can fail on its own.
//
// So the shapes here refuse to represent the lie. There is no "sent, probably":
// `readAttachment` answers 'none', 'ok' or 'unreadable' and never guesses, and
// a row that claims a kind with no path is not a message with a picture in it,
// it is a message this app will say it cannot show.

/** What to draw with the path. The database check constraint on
 *  `messages.attachment_kind` allows exactly these two. */
export type AttachmentKind = 'image' | 'video';

export interface MessageAttachment {
  /** Storage key in the private `message-media` bucket. */
  path: string;
  kind: AttachmentKind;
}

/** Private. Read through a signed URL, never getPublicUrl() — which hands back
 *  a working-looking string for a private object that then 400s. */
export const MESSAGE_MEDIA_BUCKET = 'message-media';

/**
 * How long a signed URL lives.
 *
 * Short, because it is a link to a private photograph between two people and
 * anyone holding the string can open it. Not so short that a clip cannot finish
 * buffering: a signature is checked when the request starts, so fifteen minutes
 * covers opening the thread, scrolling back through it and playing a 30-second
 * video, and a thread left open longer than that re-signs on its next load.
 */
export const MESSAGE_MEDIA_TTL_S = 60 * 15;

/**
 * The hard byte cap, and it is the bucket's own figure (67108864 = 64 MiB in
 * `file_size_limit`, part 124 section 2). Checked before uploading because
 * storage answers an over-large object with a 413 that arrives as an opaque
 * failure, and "that clip is too long to send" is a sentence somebody can act
 * on. If the part changes, change this with it — a client-side cap that is
 * larger than the bucket's produces a refusal we did not predict, and one that
 * is smaller refuses files that would have been fine.
 */
export const MESSAGE_MEDIA_MAX_BYTES = 67108864;

/** What the recorder is capped at. A form check is a few reps, not a session,
 *  and the byte cap above is what this keeps a clip under. */
export const MESSAGE_VIDEO_MAX_SECONDS = 30;

/** Downscale width before upload. Wide enough to read the label on a machine
 *  or the plate on a bar; small enough that a photo sends on gym wifi. */
export const MESSAGE_IMAGE_WIDTH = 1600;

/**
 * The object key shape, mirrored from the storage policies:
 *
 *     <client_id>/<sender_uid>/<file>
 *
 * Segment 1 is the THREAD and decides who may read. Segment 2 is WHO PUT IT
 * THERE and is the only folder that person may write into — the anti-forgery
 * half, and the reason this is two segments rather than one. Part 83 has the
 * story: a client could once write a message that appeared to come from their
 * own coach, and a bucket keyed only by thread would let the same thing happen
 * to a file.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export const MESSAGE_ATTACHMENT_PATH_RE =
  new RegExp(`^${UUID}/${UUID}/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,118}[A-Za-z0-9])?\\.[a-z0-9]{1,5}$`);

/** Allowed extensions, one per thing the bucket's `allowed_mime_types` accepts.
 *  A HEIC never reaches here: images are re-encoded as JPEG before upload, and
 *  a HEIC uploaded under an image/jpeg content type is a lie the bucket would
 *  otherwise store. */
const EXT_MIME: Record<string, { mime: string; kind: AttachmentKind }> = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
};

/** Build the key. `atMs` and `token` together are what make it unique, so an
 *  upload is always a new object and never an overwrite — there is no UPDATE
 *  policy on the bucket, deliberately (part 124). */
export function messageAttachmentPath(
  threadId: string,
  senderId: string,
  atMs: number,
  token: string,
  ext: string,
): string {
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'jpg';
  const safeToken = /^[A-Za-z0-9]{1,16}$/.test(token) ? token : 'x';
  return `${threadId}/${senderId}/${Math.floor(atMs)}-${safeToken}.${safeExt}`;
}

/** The same test the storage policies apply, asked here so a mismatch fails
 *  with a readable message rather than as a bare 403 the app renders as sent. */
export function isThreadAttachmentPath(path: string, threadId: string): boolean {
  if (!MESSAGE_ATTACHMENT_PATH_RE.test(path)) return false;
  return path.slice(0, path.indexOf('/')).toLowerCase() === String(threadId).toLowerCase();
}

/** Who uploaded it, from the key alone — segment 2, which the INSERT policy
 *  pins to the uploader's own uid. Null when the path is not one of ours. */
export function attachmentUploaderId(path: string): string | null {
  if (!MESSAGE_ATTACHMENT_PATH_RE.test(path)) return null;
  return path.split('/')[1] ?? null;
}

/** The content type to upload under, from the key we are about to write to.
 *  Null for anything the bucket would refuse, so the refusal happens here with
 *  a reason rather than at the far end as a 400. */
export function attachmentContentType(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_MIME[ext]?.mime ?? null;
}

/**
 * The extension to store a picked asset under.
 *
 * Images are always 'jpg' because they are re-encoded on the way out — the
 * picker hands back HEIC on an iPhone and the manipulator turns it into JPEG,
 * so the extension states what the bytes are rather than what the file was
 * called. Video is passed through untouched (there is no re-encoder in this
 * app that does not need a native dependency), so its extension has to follow
 * the actual container: quicktime from an iPhone camera, mp4 from most else.
 */
export function attachmentExtension(kind: AttachmentKind, mimeType?: string | null, name?: string | null): string {
  if (kind === 'image') return 'jpg';
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/mp4') return 'mp4';
  const ext = String(name ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (ext === 'mov' || ext === 'mp4') return ext;
  // The picker did not say, and the name did not either. MP4 is the honest
  // default: it is what the bucket accepts and what every player opens, and a
  // container mismatch shows up immediately as a clip that will not play rather
  // than as something subtly wrong later.
  return 'mp4';
}

/**
 * What a picked asset IS, decided from the mime type first and the filename
 * only as a fallback.
 *
 * Returns null for anything that is neither — a PDF, an audio memo, a file the
 * picker described as nothing at all. Null is a refusal with a reason attached
 * by the caller, never a silent send of a file the other side cannot open.
 */
export function attachmentKindFor(mimeType?: string | null, name?: string | null): AttachmentKind | null {
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  const ext = String(name ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1];
  if (!ext) return null;
  return EXT_MIME[ext]?.kind ?? null;
}

/**
 * What a message row is carrying.
 *
 * Three answers, and the third is the point of the type. 'unreadable' is a row
 * that claims an attachment this app cannot draw — a kind it does not know, a
 * path that is not in this thread, half a pair. The database constraints in
 * part 124 make each of those impossible to write TODAY; the app still refuses
 * to guess, because a row written by a future version of the app, or by hand,
 * or by a version of these rules that has moved on, must not silently render as
 * a message with nothing attached. The reader is told there is something there
 * and that this app cannot show it, which is true and actionable.
 */
export type AttachmentRead =
  | { state: 'none' }
  | { state: 'ok'; attachment: MessageAttachment }
  | { state: 'unreadable'; why: string };

const UNREADABLE = 'This message has an attachment this version of the app cannot show.';

export function readAttachment(
  row: { attachment_path?: unknown; attachment_kind?: unknown },
  threadId: string,
): AttachmentRead {
  const path = typeof row?.attachment_path === 'string' ? row.attachment_path : null;
  const kind = typeof row?.attachment_kind === 'string' ? row.attachment_kind : null;
  if (!path && !kind) return { state: 'none' };
  // Half a pair. A kind with no path is a bubble claiming a photograph that
  // does not exist, which is the exact lie this whole feature is built around
  // not telling.
  if (!path || !kind) return { state: 'unreadable', why: UNREADABLE };
  if (kind !== 'image' && kind !== 'video') return { state: 'unreadable', why: UNREADABLE };
  if (!isThreadAttachmentPath(path, threadId)) return { state: 'unreadable', why: UNREADABLE };
  return { state: 'ok', attachment: { path, kind } };
}

/** The word for this kind, for use in a sentence. */
export function attachmentNoun(kind: AttachmentKind): string {
  return kind === 'image' ? 'photo' : 'video';
}

/**
 * Why this file cannot be sent, or null when it can.
 *
 * Size is checked against the bucket's own limit before a byte leaves the
 * phone. An empty file is refused too: a zero-byte object uploads perfectly
 * happily and is a grey box at the other end.
 */
export function attachmentRefusal(bytes: number, kind: AttachmentKind): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `That ${attachmentNoun(kind)} came back empty from your phone, so there was nothing to send.`;
  }
  if (bytes > MESSAGE_MEDIA_MAX_BYTES) {
    const mb = Math.round(MESSAGE_MEDIA_MAX_BYTES / (1024 * 1024));
    return kind === 'video'
      ? `That video is too large to send (the limit is ${mb} MB). A shorter clip of the movement itself will go through.`
      : `That photo is too large to send (the limit is ${mb} MB).`;
  }
  return null;
}

/**
 * Is there anything here to send at all?
 *
 * A caption is optional when there is a file — a photograph of a machine says
 * what it says. Nothing here invents one from the filename: "IMG_4821" under a
 * picture is not a thing the sender wrote.
 */
export function hasSomethingToSend(body: string, hasAttachment: boolean): boolean {
  return hasAttachment || (body || '').trim().length > 0;
}

/**
 * What goes under a bubble the server refused.
 *
 * `them` completes "…so <them> cannot see it": 'your coach' on the client side,
 * 'they' on the coach's. Attachments get their own sentence because the two
 * failures are different and the sender can do different things about them: a
 * refused row means try again, and a refused upload means the file itself did
 * not go, which is worth knowing before you put your phone away.
 */
export function unsentNote(them: string, stage: 'upload' | 'send', kind: AttachmentKind | null): string {
  if (stage === 'upload' && kind) {
    return `Not sent — the ${attachmentNoun(kind)} did not upload, so ${them} cannot see it`;
  }
  if (kind) return `Not sent — ${them} cannot see this ${attachmentNoun(kind)}`;
  return `Not sent — ${them} cannot see this`;
}
