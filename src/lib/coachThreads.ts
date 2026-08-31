// What a coach's message list shows, decided away from the screen that draws it.
//
// ── The screen this is for ─────────────────────────────────────────────────
//
// app/(trainer)/messages.tsx — the coach's inbox, which did not exist. The read
// behind it is `coach_threads()` (supabase/parts/148): one row per client on the
// roster, carrying the last message in that thread or nothing at all.
//
// Three decisions live here rather than in the screen, because each of them is
// a claim that can be wrong in a way a person would act on, and each is worth
// asserting directly (coachThreads.test.ts) instead of through a Supabase
// client and a renderer.
//
//   1. WHICH CLIENTS GET A ROW. A coach with twenty clients and two
//      conversations must not open a list of eighteen blanks — but a list that
//      shows only existing threads makes starting one impossible from the only
//      screen in the app about messaging. So the rows are SPLIT: conversations
//      are the list, and everybody else is behind a "Message Someone Else"
//      affordance that is only offered when there is somebody behind it.
//
//   2. WHAT THE PREVIEW LINE SAYS. It has to name the sender, because "can we
//      move to 7?" reads completely differently depending on who asked, and a
//      coach scanning for what they still owe somebody an answer to is reading
//      exactly that. And it has to describe an attachment in words: a message
//      whose whole content is a photograph has an empty `body`, and a blank
//      preview line is indistinguishable from a thread with nothing in it.
//
//   3. THE ORDER. Most recent first — see `sortThreads`.

/** The sides of a thread, as `messages.sender` stores them. */
export type ThreadSender = 'client' | 'coach';

/** What an attachment on the last message was, when there was one. */
export type ThreadKind = 'image' | 'video';

/**
 * One row of `coach_threads()`, parsed.
 *
 * Every field that can be absent is `null` rather than a stand-in, and the two
 * kinds of absence that matter are kept apart by which field is null:
 *
 *   `lastAt === null`   this thread has no messages. A fact from the server.
 *   `unread === null`   the unread count could not be read. NOT zero — zero is
 *                       a claim that nobody is waiting, made on the one screen
 *                       whose entire job is to say who is.
 */
export interface CoachThread {
  clientId: string;
  /** The client's name, or null when nothing readable came back for them. */
  name: string | null;
  /** Their picture, or null to draw a monogram. Never anybody else's. */
  avatar: string | null;
  lastBody: string | null;
  lastSender: ThreadSender | null;
  lastKind: ThreadKind | null;
  /** ISO timestamp of the last message, or null when there are none. */
  lastAt: string | null;
  unread: number | null;
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/**
 * One server row into one thread.
 *
 * `sender` and `attachment_kind` are narrowed rather than cast: a value the
 * database grows that this build does not know is null here, and a null kind
 * renders as an ordinary message rather than as a confident wrong noun.
 *
 * `unread` is null unless a real number came back. `Number(undefined)` is NaN
 * and `Number(null)` is 0 — the second is the dangerous one, because it turns
 * "the count did not come back" into "nobody is waiting" silently, and that is
 * the defect supabase/parts/88 was written to end.
 */
export function rowToThread(r: any): CoachThread {
  const sender = r?.last_sender === 'client' || r?.last_sender === 'coach' ? r.last_sender as ThreadSender : null;
  const kind = r?.last_kind === 'image' || r?.last_kind === 'video' ? r.last_kind as ThreadKind : null;
  const unread = typeof r?.unread === 'number' && Number.isFinite(r.unread) ? Math.max(0, Math.trunc(r.unread)) : null;
  return {
    clientId: String(r?.client_id ?? ''),
    name: str(r?.name),
    avatar: str(r?.avatar),
    lastBody: str(r?.last_body),
    lastSender: sender,
    lastKind: kind,
    lastAt: str(r?.last_at),
    unread,
  };
}

/** True when there is a conversation here, as opposed to a client who could be
 *  written to. The timestamp is the test and not the body, because a message
 *  whose only content is a photograph has no body at all. */
export function hasConversation(t: CoachThread): boolean {
  return t.lastAt !== null && Number.isFinite(Date.parse(t.lastAt));
}

/**
 * Most recent first, and NOT unread first.
 *
 * Unread-first was the alternative and it loses on two counts. The small one is
 * that it reorders the list under the coach's thumb: opening a thread marks it
 * read, so the row they just tapped jumps down the list, and the next tap on
 * "the one below the one I read" lands on somebody else.
 *
 * The disqualifying one is that `unread` is nullable. It comes from a join that
 * can come back empty on its own, and sorting on it would put "we could not
 * read your unread counts" into the ORDER BY — the list would quietly reorder
 * itself into recency on exactly the failure the coach cannot see. A thread's
 * timestamp is known whenever the thread is, so recency is the only key here
 * that cannot change meaning when half the answer is missing. The unread count
 * is still shown, as a badge; it just does not move anybody.
 *
 * Ties break on the client id so the order is total — two messages in the same
 * millisecond must not swap places between renders.
 */
export function sortThreads(rows: CoachThread[]): CoachThread[] {
  return rows.slice().sort((a, b) => {
    const ta = a.lastAt ? Date.parse(a.lastAt) : NaN;
    const tb = b.lastAt ? Date.parse(b.lastAt) : NaN;
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    if (va !== vb) return vb - va;
    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
  });
}

/** By name, for the people there is no conversation with — there is no
 *  timestamp to order them by, and the coach is looking somebody up rather than
 *  scanning. A client with no readable name sorts last, since '—' is not a
 *  place anybody looks. */
export function sortUnstarted(rows: CoachThread[]): CoachThread[] {
  return rows.slice().sort((a, b) => {
    if (!a.name !== !b.name) return a.name ? -1 : 1;
    const na = (a.name ?? '').toLowerCase();
    const nb = (b.name ?? '').toLowerCase();
    if (na !== nb) return na < nb ? -1 : 1;
    return a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0;
  });
}

/** The two lists the screen draws, from the one read. */
export interface SplitThreads {
  /** Threads with something in them, newest first. */
  conversations: CoachThread[];
  /** Clients who could be written to and have not been, by name. */
  unstarted: CoachThread[];
}

/**
 * Split one read into the list and the people who are not on it.
 *
 * The whole argument for splitting rather than filtering: a coach wants to
 * start conversations as well as continue them, and a screen that only lists
 * existing threads makes the first message in a relationship the one thing the
 * messaging screen cannot do. A screen that lists everybody makes the two
 * threads that matter this morning the third and the seventeenth row.
 */
export function splitThreads(rows: CoachThread[]): SplitThreads {
  return {
    conversations: sortThreads(rows.filter(hasConversation)),
    unstarted: sortUnstarted(rows.filter((t) => !hasConversation(t))),
  };
}

/** What the noun for an attachment is in a preview line. Matches
 *  `attachmentNoun` in src/lib/messageAttachments.ts, which is the word both
 *  chat screens and the push notification already use. */
const KIND_NOUN: Record<ThreadKind, string> = { image: 'a photo', video: 'a video' };

/**
 * The line under the client's name.
 *
 * `mine` is what lets the screen mute it: a coach scanning for what they have
 * not answered wants their own last word to recede. It is NOT a claim that the
 * message was read — nothing in this app measures that — only that the coach is
 * the one who wrote it.
 *
 * A message with a body AND an attachment previews as the body: the caption is
 * what the person chose to say, and "Sent you a photo" would replace their
 * words with a description of the envelope.
 */
export interface ThreadPreview {
  text: string;
  /** True when the coach wrote the last message. */
  mine: boolean;
}

export function threadPreview(t: CoachThread): ThreadPreview {
  const mine = t.lastSender === 'coach';
  if (!hasConversation(t)) {
    return { text: 'No messages yet', mine: false };
  }
  if (t.lastBody) {
    // "You: " only on the coach's own side. The client's name is already the
    // heading of the row, so repeating it here would spend a line saying what
    // the row says.
    return { text: mine ? `You: ${t.lastBody}` : t.lastBody, mine };
  }
  if (t.lastKind) {
    const noun = KIND_NOUN[t.lastKind];
    return { text: mine ? `You sent ${noun}` : `Sent you ${noun}`, mine };
  }
  // A row with a timestamp, no body and no attachment kind this build knows.
  // Said out loud rather than drawn as a blank line, which would read as a
  // thread with nothing in it — and there is something in it.
  return { text: mine ? 'You sent a message this app cannot show' : 'A message this app cannot show', mine };
}

/**
 * The badge on a row.
 *
 * Three outcomes, and collapsing any two of them is a lie a coach acts on:
 *
 *   null       nothing to draw. The count came back and it was zero.
 *   a number   that many messages from this client are unopened.
 *   '—'        the count did not come back. NOT zero. A coach told "0" by a
 *              failed read stops looking, which is precisely how the hardcoded
 *              zero on the old roster card went unnoticed for months.
 *
 * Capped in TEXT at 99+ rather than in value, so the number behind it is still
 * the real one for anything that wants to compare.
 */
export function unreadBadgeLabel(unread: number | null): string | null {
  if (unread === null) return '—';
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

/**
 * When the last message was, in the shortest form that is still true.
 *
 * Relative inside a week because that is the unit a coach thinks in ("she wrote
 * this morning"), and a date beyond it because "23d" is arithmetic the reader
 * has to do. `now` is a parameter so the test states its own clock rather than
 * racing one.
 *
 * A timestamp that will not parse returns null: an unreadable date drawn as
 * "just now" is a message that looks like it arrived this minute.
 */
export function threadWhen(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = now - t;
  // A clock skew that puts the message in the future is not an error worth a
  // sentence, but it must not print as "-3m". Anything not yet past reads as now.
  if (ms < 60000) return 'now';
  const mins = Math.floor(ms / 0);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const d = new Date(t);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

/**
 * The sentence an empty list gets.
 *
 * There are four empty lists and only one of them is "nobody has written to
 * you". Getting this wrong is the failure src/ui/loadStatus.ts exists for: a
 * coach told they have no messages, when the read was refused, does not go
 * looking — and the client who wrote to them that morning is waiting.
 *
 * @param status the provider's load status.
 * @param roster how many clients came back at all. Zero of them is a different
 *        sentence from zero conversations, because the fix is different: one
 *        needs a client, the other needs somebody to say something.
 */
export function threadsEmptyNote(status: 'loading' | 'ready' | 'partial' | 'error', roster: number): string | null {
  if (status === 'loading') return null;
  if (status === 'error') {
    return 'We could not load your conversations, so we cannot say whether anybody has written to you.';
  }
  if (roster === 0) {
    return 'You have no clients yet, so there is nobody to message. Add a client from the Clients tab.';
  }
  return 'No conversations yet. Pick a client below to start one.';
}
