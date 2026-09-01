// Who a coach's document is actually in front of.
//
// ── What this is for ──────────────────────────────────────────────────────
//
// Part 135 gave a coach paperwork with exactly one audience: everybody they
// coach. Part 156 adds `coach_document_recipients`, and with it the distinction
// this file exists to keep straight:
//
//   OPEN       no recipient rows. Every current client can read it. This is
//              what every document uploaded before part 156 means, and what a
//              newly uploaded one still means until somebody is named.
//   ADDRESSED  one or more rows. Only those people can read it, and only they
//              can accept it.
//
// The consequence a coach has to be told about BEFORE they tap, not after, is
// that the first send NARROWS a document. Send a studio waiver to one person
// and it stops being the studio waiver — it becomes theirs, and everybody else
// who had not already accepted it loses sight of it. `sendWarning` is that
// sentence and the test asserts it says so, for the same reason
// src/lib/coachDocs.ts holds part 135's wording: a promise about what the
// database does belongs beside the code that will be measured against it.
//
// ── The rule about an empty list ──────────────────────────────────────────
//
// Every count here takes rows that were actually read. A failed read is not
// "nobody has it": under `error` the screen must say the audience could not be
// read, and `audienceLine` returns null for a null list so there is no sentence
// to accidentally render. That is the LoadStatus rule this repo keeps relearning
// — an empty list under 'error' must never draw as "there are none".
//
// ── What is NOT here ──────────────────────────────────────────────────────
//
// Nothing in this direction reads anything of the client's. A coach sending a
// document is a coach → client action; the injury document a client uploads
// stays with the client and only the extracted injury reaches the coach (parts
// 91 and 96). No function in this file names that, and none should.

/** A row of `coach_document_audience()`, as PostgREST hands it over. */
export interface RawAudienceRow {
  client_id: string;
  client_name: string | null;
  sent_at: string | null;
  accepted_at: string | null;
}

export interface AudienceMember {
  clientId: string;
  /** Their name, or null when nothing readable came back. Never a stand-in:
   *  the screen decides what to draw for an unreadable name, and it must not be
   *  somebody else's. */
  name: string | null;
  /** When this document was addressed to them, or null when it was not. */
  sentAt: string | null;
  acceptedAt: string | null;
}

export function shapeAudience(rows: RawAudienceRow[] | null | undefined): AudienceMember[] {
  if (!rows || !rows.length) return [];
  return rows
    .map((r) => ({
      clientId: String(r.client_id),
      name: typeof r.client_name === 'string' && r.client_name.trim() ? r.client_name.trim() : null,
      sentAt: r.sent_at ? String(r.sent_at) : null,
      acceptedAt: r.accepted_at ? String(r.accepted_at) : null,
    }))
    // The people this has NOT been sent to first, because the reason a coach
    // opened this panel is to send it to one of them. Then by name, with the
    // unnamed last rather than sorted under an empty string.
    .sort((a, b) =>
      Number(a.sentAt != null) - Number(b.sentAt != null)
      || Number(a.name == null) - Number(b.name == null)
      || (a.name ?? '').localeCompare(b.name ?? '')
      || a.clientId.localeCompare(b.clientId));
}

/** Whether this document names anybody at all. False means it is open to the
 *  whole roster, which is what an unsent document means. */
export function isAddressed(members: AudienceMember[]): boolean {
  return members.some((m) => m.sentAt != null);
}

export function sentCount(members: AudienceMember[]): number {
  return members.filter((m) => m.sentAt != null).length;
}

export function acceptedCount(members: AudienceMember[]): number {
  return members.filter((m) => m.acceptedAt != null).length;
}

/**
 * Who can currently read this document, in one sentence.
 *
 * Null when there is nothing truthful to say: a null list is a read that did
 * not happen, and a roster of nobody is not a fact about a coach's audience.
 * The caller draws its own line for both, and they are different lines.
 */
export function audienceLine(members: AudienceMember[] | null | undefined): string | null {
  if (!members || !members.length) return null;
  const sent = sentCount(members);
  if (sent === 0) return `Everyone you coach can read this — all ${members.length} of them.`;
  if (sent === 1) return 'Sent to 1 client. Nobody else can read it.';
  return `Sent to ${sent} of your ${members.length} clients. Nobody else can read it.`;
}

/**
 * What a coach is told before the FIRST send narrows a document.
 *
 * Two different sentences, because the two situations are genuinely different
 * and one wording cannot be true of both. Sending an open document takes it
 * away from everybody else; sending an addressed one only adds a name.
 */
export function sendWarning(addressed: boolean): string {
  return addressed
    ? 'They are added to the people who can read it. Nobody already on the list loses it.'
    : 'Right now everyone you coach can read this. Sending it to one person makes it theirs alone — '
      + 'everybody else stops seeing it, unless they have already accepted it.';
}

/** The one thing that cannot be undone from this screen, said before the tap. */
export const SEND_IS_ONE_WAY =
  'A document cannot be un-sent. If you address the wrong person, retire it and upload the version you '
  + 'meant — everyone who accepted the old one keeps that record and can still read what they agreed to.';

/** Why a document cannot be sent to anybody at all. */
export type SendBlock = 'retired' | 'no-clients' | 'unread';

/**
 * Whether the picker may be offered, and why not when it may not.
 *
 * `status` is the read behind `members`. 'unread' is deliberately its own
 * answer rather than folding into 'no-clients': a coach with twelve clients and
 * a failed read must not be told they have nobody to send to.
 */
export function sendBlock(o: {
  retired: boolean;
  members: AudienceMember[] | null | undefined;
  read: 'ok' | 'failed';
}): SendBlock | null {
  if (o.retired) return 'retired';
  if (o.read === 'failed' || !o.members) return 'unread';
  if (!o.members.length) return 'no-clients';
  return null;
}

export function sendBlockLine(block: SendBlock): string {
  switch (block) {
    case 'retired':
      return 'This document has been retired, so it cannot be sent to anybody new. Upload the version you want them to read.';
    case 'no-clients':
      return 'You have no clients to send this to yet. Anybody who joins you with your code can be sent it from here.';
    case 'unread':
      return 'Your clients could not be read just now, so there is nobody to choose from. This is not a statement that you have none.';
  }
}

/** What went wrong when a send did not land. */
export type SendFailure = 'refused' | 'unavailable' | 'offline';

/**
 * Which of the three a Supabase failure was.
 *
 * `unavailable` is the one that matters here and is easy to miss: part 156 has
 * to be RUN before `send_coach_document` exists, and PostgREST answers a call
 * to a function it cannot find with PGRST202 and a 404. Reported as a plain
 * failure that reads as "try again", which it is not — trying again will fail
 * forever until somebody applies the SQL.
 *
 * `refused` is the function answering false: not my document, not my client, or
 * retired. A false is not an error, and a screen that only checks `error` would
 * say "sent" over it. That is the 204 trap this repo has been bitten by
 * repeatedly — a PostgREST write that matched nothing is not an error.
 */
export function sendFailure(o: {
  error: { code?: string | null; message?: string | null } | null | undefined;
  returned: unknown;
}): SendFailure | null {
  const err = o.error;
  if (err) {
    const code = (err.code ?? '').toUpperCase();
    const msg = (err.message ?? '').toLowerCase();
    if (code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('does not exist')) {
      return 'unavailable';
    }
    return 'offline';
  }
  if (o.returned !== true) return 'refused';
  return null;
}

export function sendFailureLine(f: SendFailure): string {
  switch (f) {
    case 'refused':
      return 'That was not sent. Either the document has been retired or that person is no longer one of your clients, so nothing has been put in front of anybody.';
    case 'unavailable':
      return 'Sending a document to one client is not switched on for this server yet, so nothing was sent. Every document you add is still readable by everyone you coach.';
    case 'offline':
      return 'That could not be sent just now, so nobody has been shown anything. Try again in a moment.';
  }
}

/** The line under a name in the picker. */
export function memberLine(m: AudienceMember, fmtDay: (iso: string) => string): string {
  if (m.acceptedAt) return `Accepted ${fmtDay(m.acceptedAt)}`;
  if (m.sentAt) return `Sent ${fmtDay(m.sentAt)} · not accepted yet`;
  return 'Has not been sent this';
}
