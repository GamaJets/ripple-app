// Inviting people to become members of a gym.
//
// memberships.member_id references profiles(id), so until somebody has a Repple
// account they cannot hold a membership. That is correct — a membership belongs
// to a person, not to a row of spreadsheet text — but it left the gym owner
// with nowhere to put the two hundred members they already have. An invite is
// the intermediate record: the gym's intention to enrol somebody, held until
// that person exists and claims it.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts and src/lib/gymSchedule.ts for the same shape.
// Importing ./supabase here would drag AsyncStorage in and make every pure
// rule below untestable under plain node.
//
// The rules that decide whether an invite is still good are pure functions,
// separate from the queries. They have to be: the same question is asked by the
// owner's list screen, by the invitee's "you have been invited" banner, and by
// accept_member_invite in 37-member-invites.sql. Three answers that disagree is
// a support ticket, so there is one implementation and the SQL mirrors it.

type Queryable = { from: (table: string) => any; rpc?: (fn: string, args?: any) => any };

/** What the table stores: the three states a person actually decided. */
export type MemberInviteStatus = 'pending' | 'accepted' | 'revoked';

/** What a screen shows. Adds 'expired', which nothing ever writes down —
 *  it is what "pending" becomes once the clock passes. */
export type MemberInviteState = MemberInviteStatus | 'expired';

export interface MemberInvite {
  id: string;
  tenantId: string;
  email: string;
  /** What the gym calls them. Null means the gym only had an address — show
   *  the address, do not invent a name. */
  fullName: string | null;
  planId: string | null;
  planName: string | null;
  invitedBy: string | null;
  /** The share-link secret. */
  token: string | null;
  status: MemberInviteStatus;
  createdAt: string;
  /** Null means no expiry was recorded. Not the same as "expired". */
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

/** How long a new invite stays open. Long enough to survive a holiday, short
 *  enough that a leaked link from last season is already dead. */
export const DEFAULT_VALID_DAYS = 30;

/* ── pure rules (no database, so they are testable and shared) ─────────────── */

/**
 * The address as it will be compared.
 *
 * Returns null rather than a best guess for anything that is not an address —
 * the caller shows "that does not look like an email", which is far better than
 * sending an invitation into a typo and reporting success.
 *
 * Only case and surrounding whitespace are normalised. Notably `.` and `+` are
 * left alone: they are significant on plenty of mail servers, and a gym whose
 * members are `first.last@` would find their invites silently collapsing into
 * one another if we stripped them.
 */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const e = raw.trim().toLowerCase();
  if (!e) return null;
  // Deliberately loose. Strict RFC validation rejects real, deliverable
  // addresses, and the only test that settles it is delivery.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/**
 * Has the invite passed its expiry at `now`?
 *
 * An invite with no expiry recorded is NOT expired — that is a gap in the
 * record, and treating a gap as a lapse would lock a real member out. An
 * unparseable timestamp is treated the same way, for the same reason.
 */
export function isExpired(
  inv: Pick<MemberInvite, 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  if (!inv.expiresAt) return false;
  const t = Date.parse(inv.expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= now;
}

/**
 * What to show for this invite.
 *
 * A decision somebody made outranks the clock: an invite that was accepted or
 * withdrawn keeps saying so even long after its expiry would have passed, since
 * "expired" would misdescribe what happened to it.
 */
export function inviteState(
  inv: Pick<MemberInvite, 'status' | 'expiresAt'>,
  now: number = Date.now(),
): MemberInviteState {
  if (inv.status !== 'pending') return inv.status;
  return isExpired(inv, now) ? 'expired' : 'pending';
}

/** Whether accept_member_invite would accept this one. The SQL applies exactly
 *  these two conditions, so the button and the server agree. */
export function isRedeemable(
  inv: Pick<MemberInvite, 'status' | 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  return inviteState(inv, now) === 'pending';
}

/**
 * Whole days left before the invite lapses.
 *
 * Null when no expiry was recorded — the honest answer is "not known", never 0,
 * because 0 reads as "expires today" and would have the desk chasing somebody
 * who has no deadline at all.
 *
 * Rounded up, so an invite with nine hours left says "1 day", not "0 days".
 * Never negative: something already lapsed has 0 days left, not -4.
 */
export function daysUntilExpiry(
  inv: Pick<MemberInvite, 'expiresAt'>,
  now: number = Date.now(),
): number | null {
  if (!inv.expiresAt) return null;
  const t = Date.parse(inv.expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

/** The expiry an invite created at `fromISO` should carry. Null validDays means
 *  no expiry, and yields null — the caller then leaves the column to its
 *  default rather than writing a date it made up. */
export function expiryFor(
  fromISO: string,
  validDays: number | null | undefined = DEFAULT_VALID_DAYS,
): string | null {
  if (validDays == null) return null;
  const t = Date.parse(fromISO);
  if (Number.isNaN(t)) return null;
  return new Date(t + validDays * 86_400_000).toISOString();
}

/**
 * Why this invite cannot be sent, or null when it can.
 *
 * Checked before the insert so the owner gets a sentence instead of a Postgres
 * unique-violation, and so a CSV import can report the bad rows without
 * attempting two hundred round trips. Same shape as settleBlocker in
 * gymSessions.ts: null means go.
 *
 * `openTo` is the set of addresses this gym already has an open invite for —
 * the partial unique index in 37-member-invites.sql enforces the same rule, and
 * this is the readable half of it.
 */
export function inviteBlocker(
  email: string | null | undefined,
  openTo: string[] = [],
  existingMemberEmails: string[] = [],
): string | null {
  const e = normaliseEmail(email);
  if (!e) return 'That does not look like an email address.';
  const open = new Set(openTo.map((x) => normaliseEmail(x)).filter(Boolean) as string[]);
  if (open.has(e)) return 'There is already an invitation waiting for that address.';
  const members = new Set(
    existingMemberEmails.map((x) => normaliseEmail(x)).filter(Boolean) as string[],
  );
  if (members.has(e)) return 'That person is already a member here.';
  return null;
}

/**
 * Drop the rows that cannot be sent, and say which — the shape a bulk import
 * needs. Duplicates WITHIN the batch are caught too: a spreadsheet listing the
 * same address twice would otherwise pass row-by-row validation and then fail
 * halfway through the insert, leaving the gym with a partial import and no idea
 * where it stopped.
 */
export function screenInvites<T extends { email: string | null }>(
  rows: T[],
  openTo: string[] = [],
  existingMemberEmails: string[] = [],
): { send: T[]; rejected: { row: T; reason: string }[] } {
  const send: T[] = [];
  const rejected: { row: T; reason: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const reason = inviteBlocker(row.email, openTo, existingMemberEmails);
    if (reason) { rejected.push({ row, reason }); continue; }
    const e = normaliseEmail(row.email)!;
    if (seen.has(e)) {
      rejected.push({ row, reason: 'That address appears more than once in this file.' });
      continue;
    }
    seen.add(e);
    send.push(row);
  }
  return { send, rejected };
}

export interface InviteSummary {
  total: number;
  /** Still open and still redeemable. */
  pending: number;
  accepted: number;
  revoked: number;
  /** Open, but past their date. Nobody wrote this down; it is derived. */
  expired: number;
  /**
   * Of the invites that have been settled one way or another, the share that
   * were accepted. Null while none have settled — a gym that sent its first
   * batch this morning has no acceptance rate, which is emphatically not 0%.
   * Pending invites are excluded from the denominator rather than counted as
   * failures; they have not failed, they have not answered.
   */
  acceptanceRate: number | null;
}

export function summariseInvites(
  invites: Pick<MemberInvite, 'status' | 'expiresAt'>[],
  now: number = Date.now(),
): InviteSummary {
  let pending = 0, accepted = 0, revoked = 0, expired = 0;
  for (const inv of invites) {
    switch (inviteState(inv, now)) {
      case 'pending': pending++; break;
      case 'accepted': accepted++; break;
      case 'revoked': revoked++; break;
      case 'expired': expired++; break;
    }
  }
  const settled = accepted + revoked + expired;
  return {
    total: invites.length,
    pending, accepted, revoked, expired,
    acceptanceRate: settled > 0 ? accepted / settled : null,
  };
}

/* ── the database ──────────────────────────────────────────────────────────── */

export interface NewMemberInvite {
  email: string;
  fullName?: string | null;
  planId?: string | null;
  /** Days the invite stays open. Null means it does not expire, and leaves the
   *  column to the schema default rather than writing an invented date. */
  validDays?: number | null;
}

/** The gym's invites, newest first. */
export async function fetchInvites(
  sb: Queryable, tenantId: string,
): Promise<MemberInvite[]> {
  const { data, error } = await sb
    .from('member_invites')
    .select('id, tenant_id, email, full_name, plan_id, invited_by, token, status, created_at, expires_at, accepted_at, accepted_by')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return [];

  // One query for every plan name rather than one per invite — the same reason
  // fetchMemberships batches it in gymRecord.ts.
  const planNames = await planNamesFor(sb, rows.map((r: any) => r.plan_id).filter(Boolean));
  return rows.map((r: any) => toInvite(r, planNames));
}

/**
 * The invites addressed to the signed-in person, across every gym.
 *
 * No tenant filter and none wanted: the point is that this runs BEFORE the
 * person belongs to a gym, so there is no tenant to filter by. The mi_invitee_
 * read policy scopes it to their own email address on the server.
 */
export async function fetchMyInvites(sb: Queryable): Promise<MemberInvite[]> {
  const { data, error } = await sb
    .from('member_invites')
    .select('id, tenant_id, email, full_name, plan_id, invited_by, token, status, created_at, expires_at, accepted_at, accepted_by')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => toInvite(r, new Map()));
}

/**
 * Invite one person. Throws with a readable reason when the address is not
 * usable, rather than letting a constraint violation surface as raw Postgres.
 */
export async function createInvite(
  sb: Queryable,
  tenantId: string,
  inv: NewMemberInvite,
  invitedBy?: string | null,
): Promise<void> {
  const blocked = inviteBlocker(inv.email);
  if (blocked) throw new Error(blocked);
  const { error } = await sb.from('member_invites').insert(row(tenantId, inv, invitedBy));
  if (error) throw error;
}

/**
 * Invite a batch — the CSV importer's path.
 *
 * Screens first and inserts only what can go, returning the rejects so the
 * import screen can show the gym exactly which lines of their spreadsheet did
 * not make it. A batch is never silently trimmed.
 */
export async function createInvites(
  sb: Queryable,
  tenantId: string,
  rows: NewMemberInvite[],
  invitedBy?: string | null,
): Promise<{ sent: number; rejected: { row: NewMemberInvite; reason: string }[] }> {
  const { send, rejected } = screenInvites(
    rows.map((r) => ({ ...r, email: r.email ?? null })),
  );
  if (!send.length) return { sent: 0, rejected };
  const { error } = await sb
    .from('member_invites')
    .insert(send.map((r) => row(tenantId, r as NewMemberInvite, invitedBy)));
  if (error) throw error;
  return { sent: send.length, rejected: rejected as { row: NewMemberInvite; reason: string }[] };
}

/**
 * Withdraw an invite.
 *
 * Marked, not deleted — for the same reason setPlanActive retires a plan rather
 * than removing it. "We never invited them" and "we invited them and changed
 * our mind" are different answers to the same question from a member standing
 * at the desk, and only one of them is true.
 */
export async function revokeInvite(sb: Queryable, inviteId: string): Promise<void> {
  const { error } = await sb
    .from('member_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('status', 'pending'); // never reopen a decision by overwriting 'accepted'
  if (error) throw error;
}

/** Push an invite's expiry out — the "they were away, send it again" case.
 *  Measured from now, not from the old expiry, so extending a lapsed invite
 *  gives a full window rather than a date still in the past. */
export async function extendInvite(
  sb: Queryable, inviteId: string, validDays: number = DEFAULT_VALID_DAYS,
): Promise<void> {
  const expiresAt = expiryFor(new Date().toISOString(), validDays);
  if (!expiresAt) throw new Error('An invite extension needs a number of days.');
  const { error } = await sb
    .from('member_invites')
    .update({ expires_at: expiresAt })
    .eq('id', inviteId)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Accept the invite addressed to me. Returns the id of the membership that is
 * now open.
 *
 * Everything real happens in accept_member_invite (37-member-invites.sql): the
 * writes cross rows the invitee has no rights over, and the validation has to
 * be on the server or it is not validation. This is the call, not the logic —
 * which is why isRedeemable exists separately for the button's enabled state.
 */
export async function acceptInvite(sb: Queryable, inviteId: string): Promise<string> {
  if (!sb.rpc) throw new Error('This Supabase client cannot call functions.');
  const { data, error } = await sb.rpc('accept_member_invite', { p_invite: inviteId });
  if (error) throw error;
  return data as string;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function row(tenantId: string, inv: NewMemberInvite, invitedBy?: string | null) {
  const expiresAt = expiryFor(new Date().toISOString(), inv.validDays ?? DEFAULT_VALID_DAYS);
  return {
    tenant_id: tenantId,
    email: inv.email.trim(),
    full_name: inv.fullName?.trim() || null,
    plan_id: inv.planId ?? null,
    invited_by: invitedBy ?? null,
    // Omitted rather than nulled when there is no expiry to write: expires_at is
    // NOT NULL with a default, so sending null would fail where leaving it out
    // correctly falls back to the schema's own window.
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

function toInvite(r: any, planNames: Map<string, string>): MemberInvite {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    email: r.email,
    fullName: r.full_name?.trim() || null,
    planId: r.plan_id ?? null,
    planName: r.plan_id ? planNames.get(r.plan_id) ?? null : null,
    invitedBy: r.invited_by ?? null,
    token: r.token ?? null,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
    acceptedAt: r.accepted_at ?? null,
    acceptedBy: r.accepted_by ?? null,
  };
}

async function planNamesFor(sb: Queryable, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  // no-error-ok: an unreadable plan name becomes null and renders as a dash; the invite is still listed
  const { data } = await sb.from('membership_plans').select('id, name').in('id', unique);
  return new Map((data ?? []).map((p: any) => [p.id, p.name]));
}
