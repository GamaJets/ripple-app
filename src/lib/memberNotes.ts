// What the desk wrote about a member, and when, and who wrote it.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One text column. `gym_member_records.note` is a single line with no author,
// no date and no history, and the form on /members writes it in place — so
// "she complained about the 6am class in March" is gone the moment somebody
// types "renewing in June" over the top of it. There is no undo, nothing says
// it changed, and the record an owner reaches for in a dispute is the one that
// keeps the least.
//
// Every gym keeps this as a running list, because that is what it is: a
// sequence of things that were true on a date. A note with no date is not
// evidence of anything, and a note with no author cannot be asked about.
//
// ── Append-only, on purpose ────────────────────────────────────────────────
//
// Nothing here edits or deletes a note. A record whose author can quietly
// rewrite what they wrote last month is worth less in the dispute it exists
// for than one that cannot be rewritten at all — the same argument
// supabase/parts/187 makes about the export log, and part 690 refuses the
// UPDATE and DELETE grants outright rather than leaving it to a screen to
// remember. A note written in error is answered by a note saying so.
//
// ── The line that was already there ────────────────────────────────────────
//
// The old single note is NOT migrated and NOT deleted. It is still on the
// member record, it is still searchable, and `withLegacy` below puts it at the
// bottom of the list labelled for what it is: a line whose author and date
// nobody kept. Moving it would invent an author; deleting it would lose the
// only note most gyms have.
//
// Framework-agnostic, like every other gym* module here: the Supabase client
// comes in as an argument so the console and the phone app can both use it.

import { assertWhole, capLimit } from './rowCap';

type Queryable = { from: (table: string) => any };

export interface MemberNote {
  /** Null on the legacy line, which is not a row in this table. */
  id: string | null;
  memberId: string;
  body: string;
  /** ISO instant, or null on the legacy line when even that was not kept. */
  writtenAt: string | null;
  writtenBy: string | null;
  /** The author's name, when the join could resolve one. Null is "the account
   *  that wrote this no longer exists", which is not the same as nobody. */
  writtenByName: string | null;
  /** True for the one-line note that predates this table. It is shown, and it
   *  is shown as unattributed rather than dressed up as somebody's entry. */
  legacy: boolean;
}

/* ── pure rules ─────────────────────────────────────────────────────────────*/

/** The longest a note may be. Long enough for a paragraph about an incident,
 *  short enough that nobody pastes a contract into the roster. The column has
 *  the same limit, so this buys a sentence instead of a constraint violation. */
export const MAX_NOTE = 2000;

/** Why this note cannot be saved, or null when it can. Null means go, like
 *  every other blocker in this codebase. */
export function noteBlocker(body: string | null | undefined): string | null {
  const b = (body ?? '').trim();
  if (!b) return 'Write the note first — an empty note records nothing and cannot be taken back once it is in the list.';
  if (b.length > MAX_NOTE) {
    return `That is ${b.length} characters and the limit is ${MAX_NOTE}. Notes are appended and never edited, so put the rest in a second one rather than cutting this short.`;
  }
  return null;
}

/**
 * Newest first, which is the order the desk reads them in.
 *
 * A note with no date sorts to the BOTTOM rather than the top: the only rows
 * without one are the legacy line and a row whose timestamp did not read, and
 * neither should push this morning's entry off the top of the list.
 */
export function newestFirst(notes: MemberNote[]): MemberNote[] {
  return [...notes].sort((a, b) => {
    const ta = a.writtenAt ? Date.parse(a.writtenAt) : Number.NEGATIVE_INFINITY;
    const tb = b.writtenAt ? Date.parse(b.writtenAt) : Number.NEGATIVE_INFINITY;
    if (tb !== ta) return tb - ta;
    return (b.id ?? '').localeCompare(a.id ?? '');
  });
}

/**
 * The list, with the old single note on the end where it belongs.
 *
 * `legacyNote` is `gym_member_records.note`, and `legacyAt` is that record's
 * `updated_at` — which is the last time ANY field on it changed, not the day
 * the note was written. So it is not used as the note's date: the row says its
 * date is unknown, because it is.
 */
export function withLegacy(
  notes: MemberNote[],
  memberId: string,
  legacyBody: string | null | undefined,
): MemberNote[] {
  const body = (legacyBody ?? '').trim();
  const list = newestFirst(notes);
  if (!body) return list;
  return [...list, {
    id: null,
    memberId,
    body,
    writtenAt: null,
    writtenBy: null,
    writtenByName: null,
    legacy: true,
  }];
}

/** Who and when, in the desk's words. Never a bare dash: this line sits inside
 *  a sentence about a person, and an em dash as the subject of one reads as the
 *  screen having broken. */
export function noteAttribution(n: MemberNote): string {
  if (n.legacy) return 'written before notes were kept — no author or date';
  const who = n.writtenByName ?? 'somebody whose account has since gone';
  return n.writtenAt ? `${who}, ${new Date(n.writtenAt).toLocaleString()}` : who;
}

/* ── reads ─────────────────────────────────────────────────────────────────*/

function rowToNote(r: any): MemberNote {
  const author = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    id: r.id,
    memberId: r.member_id,
    body: r.body,
    writtenAt: r.written_at ?? null,
    writtenBy: r.written_by ?? null,
    writtenByName: author?.full_name ?? null,
    legacy: false,
  };
}

/**
 * Every note the gym has written about one member, newest first.
 *
 * Capped through src/lib/rowCap.ts and it REFUSES rather than returning a
 * prefix. A truncated read here is not a smaller number, it is a false
 * statement about what a named person's record says — and this is the record an
 * owner opens in a dispute, where the missing note is the one that mattered.
 */
export async function fetchMemberNotes(
  sb: Queryable, tenantId: string, memberId: string,
): Promise<MemberNote[]> {
  const { data, error } = await sb
    .from('gym_member_notes')
    .select('id, member_id, body, written_at, written_by, profiles!gym_member_notes_written_by_fkey(full_name)')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .order('written_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data as any[] | null, 'the notes on this member').map(rowToNote);
}

/* ── writes ────────────────────────────────────────────────────────────────*/

/**
 * Add a note. There is no other write in this module.
 *
 * `written_by` is sent rather than derived, because the console knows who is
 * signed in; the table's own default is `auth.uid()`, so a caller that omits it
 * still cannot file a note under somebody else's name.
 *
 * The count is not checked here and `.select()` is what makes the refusal
 * visible: `gmn_owner` is `is_owner_of(tenant_id)` and RLS FILTERS rather than
 * refuses, so a trainer reaching this write would otherwise watch the box clear
 * as though the note had been saved. Asking for the row back turns that silence
 * into an error the screen can print.
 */
export async function addMemberNote(
  sb: Queryable,
  tenantId: string,
  memberId: string,
  body: string,
  writtenBy: string | null,
): Promise<void> {
  const blocked = noteBlocker(body);
  if (blocked) throw new Error(blocked);
  const { data, error } = await sb
    .from('gym_member_notes')
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      body: body.trim(),
      written_by: writtenBy ?? null,
    })
    .select('id');
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    throw new Error('That note was not saved — the database accepted nothing back. It is not on the record, so write it again once you know why.');
  }
}
