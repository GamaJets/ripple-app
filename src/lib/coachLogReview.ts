// What a member is allowed to say about a session their coach wrote into their
// own training record — and what the screen says while it does not yet know.
//
// ── the defect this is the rules half of ──────────────────────────────────
//
// A coach logs a session into the client's `workouts` rows with `logged_by` set
// (supabase/parts/53-coach-logged-workouts.sql). The member's only sight of it
// was one caption on app/(client)/workouts.tsx:
//
//     attributionLine(l, null, true)        → "Logged by your coach"
//
// The middle argument is the coach's NAME and it was the literal `null`, with a
// comment saying the client app has no coach-name lookup. It does — `my_coach()`
// (supabase/parts/115) returns the coach's id and name to their own client, and
// src/ui/messaging.ts has called it for the chat header since. So the generic
// six words were not a limit of the data; they were a lookup nobody wired.
//
// Beside that caption there was nothing to press. src/lib/upcomingWindow.ts
// states what that arrangement costs, about a different list and in exactly the
// sentence this module exists for: "the member cannot see what their coach
// recorded and cannot dispute it. Their silence is then read as approval."
//
// ── why the naming rule is "prove it or say 'your coach'" ─────────────────
//
// `logged_by` is a uuid and the member may not read arbitrary `profiles` rows —
// src/lib/threadPeer.ts has the whole argument, including the bug that comes of
// falling back to whichever name IS readable (a client's thread header showed
// the client their own name under the kicker "Your coach"). `my_coach()` answers
// for ONE person: the coach currently linked to this member. A session logged by
// a previous coach, or by another coach at the gym covering a session, has an id
// that does not match — and for that row the honest caption is still the generic
// one. So `coachNameFor` names somebody only when the ids are equal, and the
// three ways it can decline are all the same answer to the reader: "your coach".
//
// ── why a query is a third verb ───────────────────────────────────────────
//
// Delete and amend both already exist and neither is "that is not what
// happened". Deleting destroys the coach's account of the session to object to
// it; amending needs the member to know the right figures, which the member who
// was never in the gym that day does not. The query is a dated mark by the
// person the record is about, carried on the row the coach already reads,
// changing no figure and erasing nothing — a second recorded fact beside the
// first. supabase/parts/2660 is the column, the trigger that makes the date the
// server's, and the argument in full.
//
// Pure, so every sentence and every refusal below can be asserted under plain
// node without a Supabase client or a rendered screen.
import { isWhole, type LoadStatus } from '../ui/loadStatus';

/** The two fields of a workout row this module reasons about. Deliberately a
 *  structural type rather than `WorkoutEntry`: the amend sheet, the day list and
 *  the tests all hold different shapes of the same row. */
export interface AttributedEntry {
  /** The coach who recorded it. Absent means the member logged it themselves. */
  loggedBy?: string;
  /** When the member changed something the coach wrote. Server-stamped. */
  amendedAt?: string;
}

/** Who the client app can prove its coach is. Null when the link read has not
 *  landed or found nobody — which is not the same as "no coach", and is why
 *  nothing downstream turns this into a sentence about the relationship. */
export interface KnownCoach {
  id: string;
  /** Their name, or null for a coach who has set none. A blank name is not a
   *  missing coach and must not become one. */
  name: string | null;
}

/** The query standing on one row, as read back from the server. */
export interface WorkoutQuery {
  /** When the member queried it, ISO. Null means they have not — under a WHOLE
   *  read, and only then. */
  queriedAt: string | null;
  /** What they said, or null for a query with no words on it. */
  note: string | null;
}

/**
 * The coach's name for this row, or null to mean "say 'your coach'".
 *
 * Null is the safe answer and it is never a failure: `attributionLine` renders
 * it as the generic caption, which is true of every coach-logged row whoever
 * wrote it. The three declines are all deliberate:
 *
 *   · no `logged_by`  — the member logged it; there is no coach to name;
 *   · no known coach  — the link read has not landed, or found nobody;
 *   · a DIFFERENT id  — somebody else logged this, and the one name this app
 *                       can read is not theirs. Printing it would attribute a
 *                       session to a coach who did not record it, which is the
 *                       one error worse than saying nothing.
 */
export function coachNameFor(entry: AttributedEntry, coach: KnownCoach | null): string | null {
  if (!entry.loggedBy || !coach) return null;
  if (entry.loggedBy !== coach.id) return null;
  const n = coach.name?.trim();
  return n ? n : null;
}

/** The longest note the sheet will send. Not a database limit — `query_note` is
 *  `text` — but a bound on what one member can put on one row, so a paste of a
 *  whole chat history cannot become a column the coach's screen has to render. */
export const QUERY_NOTE_MAX = 400;

/**
 * What to send as the note, or null for a query with no words.
 *
 * Whitespace-only becomes null rather than `''`: an empty string in the column
 * would render as a query whose explanation is blank, which reads as a note
 * that failed to save. Null reads as what it is — queried, nothing said — and
 * the screen has a sentence for that.
 */
export function cleanQueryNote(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  return s.length > QUERY_NOTE_MAX ? s.slice(0, QUERY_NOTE_MAX).trimEnd() : s;
}

/** A workout row as the query read returns it: `id, queried_at, query_note`.
 *  Spelled out at the `.select()` in src/ui/coachLogQueries.ts rather than
 *  shared as a constant, so scripts/check-schema.mjs can read the columns and
 *  hold them against the ledger — the note there says why that matters here
 *  more than anywhere else. */
export interface QueryRow {
  id: string;
  queried_at: string | null;
  query_note: string | null;
}

/**
 * The patch that raises a query.
 *
 * `queried_at` carries a value only to mean "now": the trigger in part 2660
 * overwrites whatever arrives with `now()`, for the reason `amended_at` is
 * server-stamped too — a date the handset chooses is a date the handset can
 * choose wrongly, and this one is a member's objection to a record about them.
 * The ISO string is sent rather than a bare `true` because the column is a
 * timestamptz and PostgREST would refuse anything else before the trigger ever
 * ran.
 *
 * Note what is NOT in here: no `logged_by`, no `amended_at`, and none of the
 * figures. A query changes nothing about what the coach recorded. That is the
 * whole of its design — a correction is a second fact, never an erasure.
 */
export function queryPatch(note: string | null, nowIso: string): { queried_at: string; query_note: string | null } {
  return { queried_at: nowIso, query_note: cleanQueryNote(note) };
}

/**
 * The patch that withdraws one.
 *
 * The note goes with it, explicitly, rather than being left for the trigger to
 * clear: a screen that sends only `queried_at: null` and then renders its own
 * optimistic copy would show the withdrawn sentence until the next read.
 */
export function withdrawPatch(): { queried_at: null; query_note: null } {
  return { queried_at: null, query_note: null };
}

/** What the member may do to this row right now. */
export interface ReviewActions {
  /** Offer "This is not right". */
  query: boolean;
  /** Offer to take a standing query back. */
  withdraw: boolean;
  /** Offer the amend sheet. Always true for a coach-logged row: correcting the
   *  figures is permitted by policy and stamped by the trigger whatever the
   *  query state is, and the two are independent answers to different problems. */
  amend: boolean;
}

/** What the strip under a coach-logged entry says and offers. */
export interface Review {
  /** True when there is nothing to render: the member logged this themselves. */
  own: boolean;
  /** The caption — "Logged by Dave", "Logged by your coach · changed after it was filed".
   *  Null only when `own`. Produced by `attributionLine`, not here; this module
   *  decides the NAME that goes into it. */
  coachName: string | null;
  /** The sentence under the caption. Never null for a coach-logged row: the
   *  point of the whole item is that this row stops being silent. */
  line: string;
  actions: ReviewActions;
}

/**
 * Everything the strip needs, from the row, the query read and that read's
 * status.
 *
 * ── why `status` is an argument, and why it is the SECOND question ────────
 *
 * `isWhole` is the house rule (src/ui/loadStatus.ts) and this is exactly the
 * case it names: a query read that failed comes back with no rows, and no rows
 * is indistinguishable from "this member has queried nothing" unless somebody
 * asks. Saying "you have not queried this" off a refused read would be the app
 * asserting the member's silence — which is the thing this item exists to stop
 * it doing.
 *
 * But the status is asked about the ABSENCE of a row, not about a row that
 * came back. loadStatus.ts is explicit that under 'partial' "the rows are real,
 * and there are more of them than came back" — so a row this read DID return is
 * known, whole or not, and refusing to render a query the server just handed us
 * would hide a live objection to make a point about a cap. `query != null` is
 * therefore the first question and `isWhole` the second.
 *
 * Under an unknown state the query action stays OFFERED: being unable to read a
 * member's objections must never be a reason they cannot make one.
 */
export function reviewFor(
  entry: AttributedEntry,
  query: WorkoutQuery | null,
  status: LoadStatus,
  coach: KnownCoach | null,
): Review {
  if (!entry.loggedBy) {
    return { own: true, coachName: null, line: '', actions: { query: false, withdraw: false, amend: false } };
  }
  const coachName = coachNameFor(entry, coach);
  const whose = coachName ?? 'your coach';

  // No row for this id AND no whole read: the app does not know, and says so.
  // A row it does have is a row the server sent, which is knowledge whatever
  // else the read left behind.
  if (!query && !isWhole(status)) {
    return {
      own: false,
      coachName,
      // Two facts, in the order the reader needs them: we cannot say where this
      // stands, and you can still object. 'error' and 'partial' share the
      // sentence on purpose — neither is a state in which this row is known.
      line: status === 'loading'
        ? 'Checking whether you have already queried this…'
        : 'We could not check whether you have already queried this, so what you see here may not be the whole story.',
      actions: { query: true, withdraw: false, amend: true },
    };
  }

  if (query?.queriedAt) {
    const on = stampOf(query.queriedAt);
    return {
      own: false,
      coachName,
      line: `You queried this${on}. ${whose} can see it. Nothing has been deleted. The record still says what they wrote.`,
      actions: { query: false, withdraw: true, amend: true },
    };
  }

  return {
    own: false,
    coachName,
    // The second sentence is the item. A member who reads this and does nothing
    // has now chosen to do nothing, which is a different thing from never
    // having been shown the row.
    line: `${whose} recorded this for you. If it is not what happened, say so: not saying anything is not agreeing.`,
    actions: { query: true, withdraw: false, amend: true },
  };
}

/**
 * " on 3 Sep", or the empty string when the stamp will not parse.
 *
 * The reader's own locale, through Intl, for the reason src/ui/SessionHrSheet.tsx
 * records at length: a hand-built `d/m` is 9 December in Britain and 12
 * September in the United States, and this one dates somebody's objection.
 *
 * An unparseable stamp loses the date and keeps the sentence. The alternative —
 * printing "Invalid Date", or dropping the whole line — would either lie about
 * the day or hide a query that genuinely stands.
 */
function stampOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return ` on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/**
 * The query state for a row id, from rows keyed by id.
 *
 * A row id the map does not hold is `null`, not an empty query: the caller pairs
 * it with the read's status, and `reviewFor` is what decides whether "we have no
 * row for this" may be spoken as "not queried".
 */
export function queryFor(byId: ReadonlyMap<string, WorkoutQuery>, id: string | undefined): WorkoutQuery | null {
  if (!id) return null;
  return byId.get(id) ?? null;
}

/** The rows of a query read, indexed by workout id. Rows with no
 *  `queried_at` are kept: their presence is the evidence that the row was READ
 *  and carries no query, which is what separates a known "no" from an unknown. */
export function indexQueries(rows: readonly QueryRow[]): Map<string, WorkoutQuery> {
  const m = new Map<string, WorkoutQuery>();
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    m.set(r.id, {
      queriedAt: typeof r.queried_at === 'string' && r.queried_at ? r.queried_at : null,
      note: typeof r.query_note === 'string' && r.query_note.trim() ? r.query_note : null,
    });
  }
  return m;
}
