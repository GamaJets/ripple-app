// The record that a message went out, and to whom.
//
// ── What was missing ───────────────────────────────────────────────────────
//
// /members can post to a segment: one `announcements` row and one inbox row per
// named recipient, written by `notify_users`. The announcement carries the body
// and the author, so "who wrote it" survives. Nothing at all carries the
// RECIPIENTS. `notify_users` returns a count and inserts rows that point back
// at no announcement, so a message that landed in forty inboxes cannot be
// traced to the forty people who got it — not by the owner who sent it, not by
// the owner who inherits the gym, and not by anybody answering for it later.
//
// The same screen, thirty lines further down, carefully writes a
// `gym_export_runs` row when a CSV of those same members leaves the browser.
// Taking the list out was audited and shouting at everybody on it was not.
//
// ── Why the console writes this and a trigger does not ────────────────────
//
// supabase/parts/187 makes the argument against console-written audit tables
// and it is right: a trigger cannot be forgotten, cannot be skipped by the next
// code path, and cannot be forged by the party being audited. Part 690 does
// exactly that for the half a trigger can see — an `announcements` insert
// becomes a `notice-posted` event, unforgeable, written by the data.
//
// The recipient list is the half no trigger can see. It exists only in the
// argument the console passed to `notify_users`, which stores it nowhere, and
// it is the half the question is actually about. So it is written from here,
// for the same reason and with the same caveat as `gym_export_runs`: it records
// what the client says it did. Insert-only, no update and no delete, because a
// record of a broadcast that the sender can then remove is worth less than no
// record at all — its absence would be read as "nothing was sent".
//
// Framework-agnostic: the Supabase client comes in as an argument.

import { capLimit, capped } from './rowCap';
import { readByIds } from './idLookup';

type Queryable = { from: (table: string) => any };

export interface BroadcastRecord {
  tenantId: string;
  sentBy: string | null;
  /** The segment as the screen named it — 'unseen', 'lapsing' — and its label. */
  segmentId: string;
  segmentLabel: string;
  /** Everybody it was addressed to. The half nothing else keeps. */
  memberIds: string[];
  /**
   * How many inboxes `notify_users` said it wrote. Null is UNKNOWN — the RPC
   * answered in a shape this build does not understand, or errored after the
   * notice had already posted — and it is stored as null rather than as the
   * intended count, because a log that rounds an unknown up to "all of them" is
   * the one thing this table must never do.
   */
  delivered: number | null;
  body: string;
}

/**
 * What to store as the body.
 *
 * The whole message, trimmed, up to the column's limit. Not a summary and not
 * the first line: the question this row answers later is "what were these
 * people told", and an abridged answer to that is worse than none because it
 * reads as complete.
 */
export const MAX_LOGGED_BODY = 4000;

/** One sentence for the owner when the send worked and the record of it did
 *  not. Null when there is nothing to say. */
export function loggingNote(err: string | null): string | null {
  if (!err) return null;
  return `The message went out, but the record of who it went to was not written: ${err}. Nothing can now say who received it. Take a note of the group and the time yourself.`;
}

/**
 * Record one broadcast.
 *
 * Returns the failure as a STRING rather than throwing, and never rejects. The
 * message is already in people's inboxes by the time this runs, so reporting a
 * logging failure as a send failure would be false — and an owner who is told
 * "nothing was posted" about a notice that was posted will send it again.
 * `loggingNote` above turns the string into the sentence the screen prints, so
 * the gap is visible as a gap rather than swallowed.
 */
export async function logBroadcast(
  sb: Queryable, r: BroadcastRecord,
): Promise<string | null> {
  if (!r.tenantId) return 'the gym could not be identified';
  try {
    const { error } = await sb.from('gym_broadcast_sends').insert({
      tenant_id: r.tenantId,
      sent_by: r.sentBy ?? null,
      segment_id: r.segmentId,
      segment_label: r.segmentLabel,
      member_ids: r.memberIds,
      recipients: r.memberIds.length,
      delivered: r.delivered,
      body: r.body.trim().slice(0, MAX_LOGGED_BODY),
    });
    return error ? (error.message ?? 'the write was refused') : null;
  } catch (e: any) {
    return e?.message ?? 'the write could not be made';
  }
}

/* ── reading it back ───────────────────────────────────────────────────────── */

// The table was written and never read. Everything above this line existed and
// `gym_broadcast_sends` was, in the product's own terms, a drawer nobody could
// open: the console's own failure copy already told an owner to "read the list
// of sent notices below before posting it again", and there was no list below.
//
// An audit record that cannot be read is not an audit record. It is a cost —
// storage, a policy, a trigger — paid for a promise nothing keeps, and the
// owner who inherits the gym is exactly as unable to answer "what were these
// people told" as they were before it was added.
//
// Part 691 grants `select` to `authenticated` and confines it with
// `is_owner_of(tenant_id)`, so nothing new is needed in the schema.

/**
 * How many notices one read brings back.
 *
 * Fifty rather than everything, because this is a screen an owner reads and not
 * a ledger anything is reconciled against — and because the alternative to a
 * bound is not "all of them", it is PostgREST's own thousand with nothing said
 * about it. The count is bounded and the screen SAYS it is bounded; see
 * `logCaption`.
 */
export const BROADCAST_PAGE = 50;

/** One message, as it was sent. */
export interface Broadcast {
  id: string;
  /** `sent_at`, a full timestamp. Formatted by the caller, in the gym's zone. */
  sentAt: string;
  /** Null means the account has been removed — part 691 is `on delete set
   *  null` on purpose. It does NOT mean nobody sent it. */
  sentBy: string | null;
  /** Resolved separately, and null for three different reasons. `senderLine`
   *  is what keeps them apart. */
  sentByName: string | null;
  segmentId: string;
  segmentLabel: string;
  /** Who it was addressed to. The half nothing else in the schema keeps. */
  memberIds: string[];
  recipients: number;
  /** What `notify_users` reported writing. Null is UNKNOWN. */
  delivered: number | null;
  body: string;
}

/** A page of the log, and the two things a screen must know about it before it
 *  says anything in its own voice. */
export interface BroadcastLog {
  rows: Broadcast[];
  /** There are older notices than these. A count over `rows` is then a
   *  subtotal, and `logCaption` refuses to present it as a total. */
  truncated: boolean;
  /**
   * Why the senders' names could not be looked up, or null when they could.
   *
   * A separate read from the notices themselves, and a separate failure. The
   * notices are worth showing without the names; a name that is missing because
   * a lookup failed must not be shown as an account that no longer exists,
   * which is what a single null would have made them indistinguishable from.
   */
  namesError: string | null;
}

/**
 * The most recent notices this gym posted from the console.
 *
 * `sent_at` alone is not a total order — two notices posted in the same
 * millisecond are two rows Postgres may hand back in either order — so `id`
 * breaks the tie, for the same reason `fetchPayments` does it.
 */
export async function fetchBroadcasts(
  sb: Queryable, tenantId: string, limit: number = BROADCAST_PAGE,
): Promise<BroadcastLog> {
  const { data, error } = await sb
    .from('gym_broadcast_sends')
    .select('id, sent_at, sent_by, segment_id, segment_label, member_ids, recipients, delivered, body')
    .eq('tenant_id', tenantId)
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    // One past the bound, so a full page and a cut-off one stop looking
    // identical. `capped` takes the probe row back off.
    .limit(capLimit(limit));
  if (error) throw error;
  const page = capped<any>((data ?? []) as any[], limit);

  const rows: Broadcast[] = page.rows.map((r: any) => ({
    id: String(r.id),
    sentAt: String(r.sent_at),
    sentBy: r.sent_by ?? null,
    sentByName: null,
    segmentId: String(r.segment_id ?? ''),
    segmentLabel: String(r.segment_label ?? ''),
    memberIds: Array.isArray(r.member_ids) ? r.member_ids.map((x: any) => String(x)) : [],
    recipients: Number(r.recipients ?? 0),
    // NOT `?? 0`. Null is unknown and zero is "it reached nobody", and the
    // column exists as nullable precisely so those two can be told apart.
    delivered: r.delivered == null ? null : Number(r.delivered),
    body: String(r.body ?? ''),
  }));

  let namesError: string | null = null;
  const senders = rows.map((b) => b.sentBy).filter((x): x is string => !!x);
  if (senders.length) {
    try {
      const found = await readByIds<any>(
        senders,
        (chunk, from, to) => sb.from('profiles').select('id, full_name').in('id', chunk)
          .order('id', { ascending: true }).range(from, to),
        'the names of the people who sent these notices',
      );
      const byId = new Map<string, string>();
      for (const p of found) if (p?.id) byId.set(String(p.id), String(p.full_name ?? '').trim());
      for (const b of rows) if (b.sentBy) b.sentByName = byId.get(b.sentBy) ?? null;
    } catch (e: any) {
      // Kept as a sentence and handed up, not swallowed and not thrown. The
      // notices landed; only the names did not, and `senderLine` says which of
      // the two silences this is.
      namesError = e?.message ?? 'the lookup was refused';
    }
  }

  return { rows, truncated: page.truncated, namesError };
}

/**
 * Who sent it, in the words that keep the three silences apart.
 *
 * They look identical in the data and mean entirely different things: the
 * account is gone, the name could not be read, and the account has no name on
 * it. The first is a fact this record is designed to preserve, the second is a
 * failed request, and reporting either as the other is how an audit trail
 * starts lying quietly.
 */
export function senderLine(b: Broadcast, ctx: { meId?: string | null; namesError?: string | null }): string {
  if (!b.sentBy) return 'Sent by an account that has since been removed from this gym.';
  if (ctx.meId && b.sentBy === ctx.meId) return 'Sent by you.';
  if (ctx.namesError) return 'Sent by somebody whose name could not be read. The record names them; the lookup failed.';
  return b.sentByName ? `Sent by ${b.sentByName}.` : 'Sent by an account with no name on it.';
}

/**
 * How many it was addressed to, and how many inboxes were actually written.
 *
 * The two figures are separate columns because they are separate claims, and
 * `delivered` is nullable because `logBroadcast` refuses to round an unknown up
 * to the intended count. This sentence is where that refusal becomes visible to
 * the person who has to answer for the message.
 */
export function deliveredLine(b: Broadcast): string {
  const who = `${b.recipients} ${b.recipients === 1 ? 'person' : 'people'}`;
  if (b.delivered == null) {
    return `Addressed to ${who}. How many inboxes it reached was not recorded. That is unknown, not none.`;
  }
  if (b.delivered === b.recipients) return `Addressed to ${who}, and every inbox was written.`;
  if (b.delivered < b.recipients) {
    const missed = b.recipients - b.delivered;
    return `Addressed to ${who}. ${b.delivered} ${b.delivered === 1 ? 'inbox was' : 'inboxes were'} written, `
      + `so ${missed} ${missed === 1 ? 'person was' : 'people were'} not reached.`;
  }
  return `Addressed to ${who}, and ${b.delivered} inboxes were written, more than were addressed, `
    + 'which this record cannot explain.';
}

/**
 * What the list may say about itself.
 *
 * Never a total over a truncated page. `rows.length` under `truncated` is a
 * count of what came back and not a count of what the gym has sent, and the
 * house rule this codebase keeps rediscovering is that the two must not be
 * printed in the same sentence shape.
 */
export function logCaption(log: BroadcastLog): string {
  const n = log.rows.length;
  if (log.truncated) {
    return `The ${n} most recent. This gym has posted more than that, and the older ones are not on this screen.`;
  }
  return n === 1
    ? 'One notice has been posted to a group from this console.'
    : `${n} notices have been posted to a group from this console.`;
}

/** Who a notice went to, split by what can be said about each id. */
export interface Recipients {
  /** Members whose name came back. */
  named: string[];
  /** Accounts that came back with no name on them. */
  nameless: number;
  /** Ids with no profile behind them any more. Part 691 keeps NO foreign key
   *  here on purpose: the list is a statement about who was addressed at the
   *  time, and it stays true after somebody leaves and their profile goes. */
  gone: number;
}

/**
 * Sort a notice's member ids into the three things that can be true of them.
 *
 * `byId` holds only the profiles that came back, so an id absent from it is an
 * account that no longer exists — which is why this takes the map rather than a
 * list of names: a shorter list of names would make "removed" and "not looked
 * up" the same length of nothing.
 */
export function splitRecipients(ids: readonly string[], byId: Map<string, string>): Recipients {
  const named: string[] = [];
  let nameless = 0;
  let gone = 0;
  for (const id of ids) {
    if (!byId.has(id)) { gone += 1; continue; }
    const name = (byId.get(id) ?? '').trim();
    if (name) named.push(name); else nameless += 1;
  }
  return { named, nameless, gone };
}

/** One sentence naming who a notice went to, or null when there is nobody to
 *  name — which the caller says in its own words, because "nobody" here is a
 *  claim about a recorded list and not about a read. */
export function recipientLine(r: Recipients, show: number = 8): string | null {
  const parts: string[] = [];
  if (r.named.length) {
    const shown = r.named.slice(0, Math.max(1, show));
    const rest = r.named.length - shown.length;
    parts.push(rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', '));
  }
  if (r.nameless) parts.push(`${r.nameless} ${r.nameless === 1 ? 'account' : 'accounts'} with no name`);
  if (r.gone) {
    parts.push(`${r.gone} ${r.gone === 1 ? 'account that has' : 'accounts that have'} since been removed`);
  }
  return parts.length ? `${parts.join('; ')}.` : null;
}
