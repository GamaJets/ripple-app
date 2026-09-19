// What the server actually said, in words a person can be shown — or a named
// unknown that admits it said nothing.
//
// ── why a module rather than `String(err)` at the call site ────────────────
//
// src/ui/groupProgram.ts fans one tap out to everybody a coach ticked, and the
// causes genuinely differ per person inside that one tap: the policy refuses a
// hand-added client silently while writing the linked one beside them, and a
// statement that fails outright fails for a reason of its own. Grouping the
// failures BY REASON is only worth anything if the reason is the server's, so
// something has to get the server's words out of whatever object supabase-js
// handed back, and get them out without ever inventing one.
//
// Three shapes reach here and they are not interchangeable:
//
//   · a `PostgrestError` — `{ message, details, hint, code }`, a plain object
//     and NOT an Error, so `err instanceof Error` is false and `err.message`
//     is the only thing on it worth reading. This is the ordinary case.
//   · an `Error` thrown by the fetch layer — offline, aborted, timed out.
//   · anything at all, because a `catch` binding is `unknown` and a library may
//     reject with a string, a number, or null.
//
// ── and the one thing it must never do ────────────────────────────────────
//
// Answer with something that reads like a reason when there is not one. A
// blank `message`, a `{}`, a null — all of them land on the same sentence,
// which SAYS that nothing was given rather than dressing the absence up. A
// coach reading "the server did not say why" knows to look at the logs; a
// coach reading "undefined" or an empty string after a colon has been told
// there is a reason and shown a blank where it should be.

/** What a PostgREST failure looks like on the wire. Structural, not imported:
 *  `src/lib` is shared by the phone apps and the web console and takes a
 *  compile-time dependency on neither copy of `@supabase/postgrest-js`. */
export interface ServerErrorLike {
  readonly message?: unknown;
  readonly code?: unknown;
  readonly details?: unknown;
}

/** The sentence for a failure that carried no words of its own. Exported so a
 *  caller can tell "the server said nothing" from "the server said this"
 *  without matching on prose. */
export const NO_REASON_GIVEN = 'the server did not say why';

/**
 * How much of a server message is worth putting in front of somebody.
 *
 * PostgREST messages are short; a Postgres one carried through `details` can
 * be a paragraph with a query plan in it. Cut rather than let a dialog grow a
 * scrollbar, and cut at a length that still holds a whole `permission denied
 * for table …`, which is the message this feature is mostly about.
 */
const MAX = 200;

/** One line. A message with newlines in it breaks the sentence it is
 *  interpolated into, and the whitespace carries nothing. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The server's own words for a failure, or `NO_REASON_GIVEN`.
 *
 * Never throws and never returns an empty string: every path ends either in
 * text the server sent or in the named unknown. The result is safe to put
 * straight into a sentence after a colon.
 *
 * The `code` is appended when there is one, because it is the half a coach can
 * quote at support and the half that is stable across locales — `42501` is the
 * permission refusal this whole path exists for, and it survives a message
 * being reworded by a future PostgREST.
 */
export function serverSaid(err: unknown): string {
  const text = messageOf(err);
  if (text === null) return NO_REASON_GIVEN;
  const code = codeOf(err);
  return code ? `${text} (${code})` : text;
}

/** The message, or null when there is not one. Null rather than '' so the
 *  caller above cannot accidentally interpolate an absence. */
function messageOf(err: unknown): string | null {
  if (typeof err === 'string') {
    const s = clamp(oneLine(err));
    return s || null;
  }
  if (typeof err !== 'object' || err === null) return null;
  const m = (err as ServerErrorLike).message;
  if (typeof m === 'string') {
    const s = clamp(oneLine(m));
    if (s) return s;
  }
  // `details` only when there was no message. It is the more technical half and
  // is not shown in preference to words that were written for a reader — but a
  // refusal that carries only details still carries more than nothing.
  const d = (err as ServerErrorLike).details;
  if (typeof d === 'string') {
    const s = clamp(oneLine(d));
    if (s) return s;
  }
  return null;
}

/** The code, as a string, or ''. Numbers are accepted because an HTTP status
 *  arrives as one and a Postgres SQLSTATE arrives as a string. */
function codeOf(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const c = (err as ServerErrorLike).code;
  if (typeof c === 'string') return oneLine(c).slice(0, 32);
  if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  return '';
}

/** Cut at MAX, and say that it was cut. A silently truncated message reads as
 *  a message the server sent in that form. */
function clamp(s: string): string {
  return s.length <= MAX ? s : s.slice(0, MAX - 1) + '…';
}
