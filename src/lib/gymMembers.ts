// What the gym itself knows about a person.
//
// The table is `gym_member_records`, added by
// 197-a-member-the-gym-knows-nothing-about.sql, and its header argues why it
// exists at length. The short version: grep this schema for a member's phone
// number, their next of kin, or a note the desk wrote about them and there is
// nothing at all. `profiles` has a name and an avatar; `memberships.note` is
// attached to the contract and is therefore thrown away the moment somebody
// upgrades.
//
// Framework-agnostic, like every other gym* module here: the Supabase client
// comes in as an argument so the console and the phone app can both use it and
// neither owns it.
//
// ── One rule, and it is the only one that matters here ────────────────────
//
// A MEMBER WITH NO RECORD AND A RECORD THAT DID NOT READ ARE DIFFERENT FACTS.
// Every read below throws rather than defaulting, and every consumer holds
// `Map | null` rather than a Map that is empty for both reasons. An owner told
// "no emergency contact" for a member who has one, because the query failed,
// will not go and ask again.

import { assertWhole, capLimit } from './rowCap';
import { assertWrote } from './wroteRows';

type Queryable = { from: (table: string) => any };

export interface GymMemberRecord {
  memberId: string;
  phone: string | null;
  email: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  /** What the gym was told, for the people standing on the floor. NOT the
   *  client's own `injuries` — see the note in part 197. */
  medicalNote: string | null;
  note: string | null;
  tags: string[];
  updatedAt: string | null;
}

/** The writable half. An absent key means "leave it alone", which is not the
 *  same as null — null is "the gym is recording that there isn't one". */
export interface MemberRecordPatch {
  phone?: string | null;
  email?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  medicalNote?: string | null;
  note?: string | null;
  tags?: string[];
}

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/**
 * Tags from the box somebody typed them into.
 *
 * Comma OR newline separated, trimmed, blanks dropped, case-folded for
 * comparison but stored as typed. Deduplicated case-insensitively, because
 * "Student" and "student" are one tag to everybody except a database, and a
 * roster that filters on tags would otherwise show a member under one spelling
 * and hide them under the other.
 */
export function parseTags(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[,\n]/)) {
    const t = part.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Tags back into the box they were typed in. */
export function tagsText(tags: string[] | null | undefined): string {
  return (tags ?? []).join(', ');
}

/**
 * Whether the gym can reach this person at all.
 *
 * The question /passes' call list is built on: an owner told to ring twenty
 * lapsed pass holders needs to know which of the twenty they actually have a
 * number for, before they start.
 */
export function isReachable(r: GymMemberRecord | null | undefined): boolean {
  if (!r) return false;
  return !!(r.phone?.trim() || r.email?.trim());
}

/**
 * One line naming how to reach somebody, or null.
 *
 * Null rather than an empty string, so a caller renders a dash with its own
 * words rather than an invisible cell. The phone comes first: this line is read
 * by somebody with a telephone in their hand.
 */
export function contactLine(r: GymMemberRecord | null | undefined): string | null {
  if (!r) return null;
  const bits = [r.phone?.trim(), r.email?.trim()].filter((b): b is string => !!b);
  return bits.length ? bits.join(' · ') : null;
}

/** Everything the gym knows, as one searchable string per member. Used by the
 *  console's search boxes so a member can be found by their phone number or by
 *  a tag, not only by their name. */
export function searchableFields(r: GymMemberRecord | null | undefined): string[] {
  if (!r) return [];
  return [r.phone, r.email, r.emergencyName, r.note, ...r.tags]
    .filter((s): s is string => !!s && !!s.trim());
}

/** True when there is something to store. An upsert of an all-empty patch would
 *  write a row that says nothing and then read back as "a record exists". */
export function isEmptyPatch(p: MemberRecordPatch): boolean {
  const keys = Object.keys(p) as (keyof MemberRecordPatch)[];
  if (!keys.length) return true;
  return keys.every((k) => {
    const v = p[k];
    if (Array.isArray(v)) return v.length === 0;
    return v == null || String(v).trim() === '';
  });
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

function rowToRecord(r: any): GymMemberRecord {
  return {
    memberId: r.member_id,
    phone: blankToNull(r.phone),
    email: blankToNull(r.email),
    emergencyName: blankToNull(r.emergency_name),
    emergencyPhone: blankToNull(r.emergency_phone),
    medicalNote: blankToNull(r.medical_note),
    note: blankToNull(r.note),
    tags: Array.isArray(r.tags) ? r.tags.filter((t: any) => typeof t === 'string' && t.trim()) : [],
    updatedAt: r.updated_at ?? null,
  };
}

/** '' and null both mean "nothing recorded", and only one of them renders as a
 *  dash unless they are collapsed here. */
function blankToNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

/**
 * Every gym-side record in one gym.
 *
 * Capped rather than paginated. This is one row per person the gym has written
 * anything about, so a truncated read is a roster that silently loses its tail —
 * and the columns it carries are an emergency contact and a medical note, which
 * are the two things in this product that must never come back blank because a
 * query stopped at a thousand rows.
 */
export async function fetchMemberRecords(
  sb: Queryable, tenantId: string,
): Promise<GymMemberRecord[]> {
  const { data, error } = await sb
    .from('gym_member_records')
    .select('member_id, phone, email, emergency_name, emergency_phone, medical_note, note, tags, updated_at')
    .eq('tenant_id', tenantId)
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data as any[] | null, "this gym's member records").map(rowToRecord);
}

/** The same rows, keyed by member, for a screen joining them onto a roster. */
export function byMember(rows: GymMemberRecord[]): Map<string, GymMemberRecord> {
  return new Map(rows.map((r) => [r.memberId, r]));
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Write the gym's record of one person.
 *
 * An upsert on (tenant_id, member_id), because the row is a fact about a person
 * in a gym rather than an event — there is exactly one, it is created the first
 * time anybody types anything, and every later edit is the same row. An insert-
 * then-update dance in the caller would be two round trips and a race between
 * two people at two desks.
 *
 * The count is checked, not `error` alone — see src/lib/wroteRows.ts. `gmr_owner`
 * is `is_owner_of(tenant_id)`, and RLS FILTERS rather than refuses: a trainer at
 * the desk who reaches this write gets no error and no row, and would watch the
 * form clear as though the emergency contact had been saved. That is the one
 * field in this product where a silent failure has a physical consequence.
 *
 * Only the keys present in `patch` are sent. `updateMemberRecord({ note: 'x' })`
 * must not blank an emergency contact somebody else entered — which is exactly
 * what a full-row upsert built from a partially-filled form would do, and the
 * form on /members fills one section at a time.
 */
export async function saveMemberRecord(
  sb: Queryable,
  tenantId: string,
  memberId: string,
  patch: MemberRecordPatch,
  updatedBy: string | null,
): Promise<void> {
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    member_id: memberId,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy ?? null,
  };
  if (patch.phone !== undefined) row.phone = nullIfBlank(patch.phone);
  if (patch.email !== undefined) row.email = nullIfBlank(patch.email);
  if (patch.emergencyName !== undefined) row.emergency_name = nullIfBlank(patch.emergencyName);
  if (patch.emergencyPhone !== undefined) row.emergency_phone = nullIfBlank(patch.emergencyPhone);
  if (patch.medicalNote !== undefined) row.medical_note = nullIfBlank(patch.medicalNote);
  if (patch.note !== undefined) row.note = nullIfBlank(patch.note);
  if (patch.tags !== undefined) row.tags = patch.tags;

  const r = await sb
    .from('gym_member_records')
    .upsert(row, { onConflict: 'tenant_id,member_id', count: 'exact' })
    .select('member_id');
  if (r.error) throw r.error;
  assertWrote('That member record', r);
}

function nullIfBlank(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s || null;
}
