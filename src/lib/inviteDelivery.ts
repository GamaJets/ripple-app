// What the console actually knows about an invitation reaching somebody.
//
// ── The claim that was being made ──────────────────────────────────────────
//
// /invites headed a column "Sent" over `memberInvites.createdAt`, counted a KPI
// called "Sent, all time", and its send path was
// `navigator.clipboard.writeText(...)`. So the word on screen was "sent" and the
// event behind it was a row being INSERTED — and, if the owner then pressed the
// button, a string arriving on their pasteboard. Nothing in that chain leaves
// the building. An owner reading "Sent 14 Aug" against an address believes a
// message went to it on the 14th; what happened on the 14th is that they typed
// it in.
//
// ── What a console with no sender may honestly say ─────────────────────────
//
// Three different facts, and the whole point of this module is that they are
// three:
//
//   1. the invitation was WRITTEN DOWN — a row exists, `created_at` is when.
//      That is the gym's intention to enrol somebody, and it is what the
//      database holds;
//   2. the owner HANDED IT OFF from this console — they opened their mail
//      client on it, or put it on their clipboard for WhatsApp. That is an act
//      of this browser and nothing else knows it happened, so it is recorded
//      here, in this browser, and every sentence built from it says so;
//   3. it was DELIVERED, and READ, and did not bounce. Nobody knows this. There
//      is no transactional sender behind the console — that needs an edge
//      function with a provider key, a bounce webhook and an unsubscribe
//      register — and until there is, the honest rendering of "delivered" is
//      that the question is not asked rather than that the answer is yes.
//
// The handoff log is therefore deliberately NOT written to the database. A row
// in `member_invites` is a fact about the gym; "Tim's laptop opened Mail on
// this one" is a fact about Tim's laptop, and storing the second beside the
// first would let the owner's second device read it back as the first. Kept in
// the browser, labelled as this browser, and lost when the browser is cleared —
// which is the correct behaviour for a note that was only ever local.
//
// ── The reminder ───────────────────────────────────────────────────────────
//
// An invitation nobody has answered after a week is the single most common
// thing an owner wants to act on, and there was no second message anywhere in
// the product. `reminderMessage` composes one, over the same rules
// `inviteMessage` is built on — the exact address, because signing up with a
// different one is this mechanism's only failure mode, and the expiry, because
// "it says it has lapsed" is the support call the line prevents. It is handed
// to the owner's own mail client exactly as the first message is. A reminder
// that sends itself is the edge function this module does not have.
import { daysUntilExpiry, inviteState, type MemberInvite } from './memberInvites';

/* ── the handoff log ───────────────────────────────────────────────────────── */

/** How the message left this console. Never "how it was delivered". */
export type HandoffChannel = 'mail' | 'clipboard' | 'bulk';

export interface Handoff {
  how: HandoffChannel;
  /** ISO instant, from this device's clock. */
  at: string;
}

/** By invite id. One entry per invitation — the latest handoff replaces the
 *  earlier one, because "when did I last send this" is the question, and a
 *  growing history of an owner pressing Copy four times is not. */
export type HandoffLog = Record<string, Handoff>;

/** How long an invitation waits before this console offers to chase it. Seven
 *  days: long enough that a person on holiday has not been nagged, short enough
 *  to land inside the default 30-day window with time to answer. */
export const REMIND_AFTER_DAYS = 7;

const KEY_PREFIX = 'repple.invites.handoff.';

/** Per gym, because a chain owner with two gyms open in two tabs must not read
 *  one gym's notes against the other's invitations. */
export function handoffKey(tenantId: string): string {
  return `${KEY_PREFIX}${tenantId}`;
}

/** The one method of `window.localStorage` this module uses, as an interface,
 *  so the rules above are testable without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isChannel = (v: unknown): v is HandoffChannel =>
  v === 'mail' || v === 'clipboard' || v === 'bulk';

/**
 * Read the log back, and treat anything unexpected as no log at all.
 *
 * Every failure here is the same failure: the note is missing. A browser in
 * private mode throws on `getItem`, a half-written value does not parse, and a
 * value written by an older shape of this module parses into something that is
 * not a log. None of those is worth an error on screen — the column says "not
 * from this browser", which is true in all three — and none of them may throw
 * out of a render.
 */
export function readHandoffs(store: KeyValueStore | null | undefined, tenantId: string): HandoffLog {
  if (!store || !tenantId) return {};
  let raw: string | null = null;
  try { raw = store.getItem(handoffKey(tenantId)); } catch { return {}; }
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: HandoffLog = {};
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const how = (v as any).how;
    const at = (v as any).at;
    if (!isChannel(how) || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
    out[id] = { how, at };
  }
  return out;
}

/** Writes, and says whether it managed to. False is not an error worth showing:
 *  the handoff still happened, only the note about it did not survive. */
export function writeHandoffs(
  store: KeyValueStore | null | undefined, tenantId: string, log: HandoffLog,
): boolean {
  if (!store || !tenantId) return false;
  try { store.setItem(handoffKey(tenantId), JSON.stringify(log)); return true; } catch { return false; }
}

/** A new log with these invitations marked as handed off. Pure — the caller
 *  decides what to do with it, which is what makes the rule testable. */
export function noteHandoff(
  log: HandoffLog, inviteIds: string[], how: HandoffChannel, atIso: string,
): HandoffLog {
  const out: HandoffLog = { ...log };
  for (const id of inviteIds) {
    if (!id) continue;
    out[id] = { how, at: atIso };
  }
  return out;
}

/** Drop notes about invitations that are no longer in the list, so a log kept
 *  in a browser for two years does not outgrow the gym. */
export function pruneHandoffs(log: HandoffLog, liveIds: string[]): HandoffLog {
  const live = new Set(liveIds);
  const out: HandoffLog = {};
  for (const [id, h] of Object.entries(log)) if (live.has(id)) out[id] = h;
  return out;
}

/** Whole days between an instant and now, or null when the instant is unusable.
 *  Never negative: a clock that moved backwards gives 0, not "in −2 days". */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * What the handoff column says, in words that cannot be read as delivery.
 *
 * "Not from this browser" and not "not sent". The owner may well have sent it
 * from their phone, from the front desk machine, or by reading it down the
 * telephone; this console did not see that and does not get to call it a
 * failure. Every string here is about what this browser did.
 */
export function handoffNote(h: Handoff | null | undefined, now: number): string {
  if (!h) return 'not from this browser';
  const d = daysSince(h.at, now);
  const when = d == null ? 'at some point' : d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  const what = h.how === 'mail' ? 'opened in your mail'
    : h.how === 'clipboard' ? 'copied'
    : 'in a batch mail';
  return `${what} ${when}, on this browser`;
}

/**
 * Whether this console would offer to chase this invitation.
 *
 * Pending only — an accepted one is a member and a withdrawn one was a
 * decision — and only once the wait has passed. The wait is counted from the
 * handoff when there is one and from the row's own date when there is not,
 * because an invitation written a month ago and never handed off anywhere is
 * exactly the one worth chasing, and counting from a handoff that never
 * happened would hide it forever.
 */
export function remindable(
  invite: Pick<MemberInvite, 'status' | 'expiresAt' | 'createdAt'>,
  handoff: Handoff | null | undefined,
  now: number,
  afterDays: number = REMIND_AFTER_DAYS,
): boolean {
  if (inviteState(invite, now) !== 'pending') return false;
  const d = daysSince(handoff?.at ?? invite.createdAt, now);
  return d != null && d >= afterDays;
}

/* ── the second message ────────────────────────────────────────────────────── */

/** The subject of a chase. Named after the gym for the same reason the first
 *  one is: "Repple" means nothing to somebody who has not joined yet. */
export function reminderSubject(gymName: string | null | undefined): string {
  const gym = (gymName ?? '').trim();
  return gym ? `Your invitation to ${gym} is still open` : 'Your gym invitation is still open';
}

/**
 * A shorter second message, and every line of it is load-bearing for the same
 * reasons `inviteMessage` gives:
 *
 *  · the ADDRESS is repeated, because an account made with a different one
 *    never sees the invitation and that is this mechanism's only failure mode;
 *  · the EXPIRY is stated when there is one, and a lapsed invitation says so
 *    rather than pretending — an owner chasing somebody with a dead link should
 *    be reopening it, and the message tells the member to ask;
 *  · it does not assume the first message arrived. "We sent you an invitation
 *    and you ignored it" is the one tone this cannot take, because the console
 *    does not know that it arrived — see the header.
 */
export function reminderMessage(
  invite: Pick<MemberInvite, 'email' | 'fullName' | 'planName' | 'expiresAt'>,
  opts: { gymName?: string | null; siteUrl?: string | null } = {},
  now: number = Date.now(),
): string {
  const gym = (opts.gymName ?? '').trim() || 'your gym';
  const who = (invite.fullName ?? '').trim();
  const lines: string[] = [];

  lines.push(who ? `Hi ${who},` : 'Hi,');
  lines.push('');
  lines.push(`Just in case it did not reach you: ${gym} has an invitation open for you on Repple.`);
  lines.push('');
  lines.push(`Download the Repple app and sign up with this exact address: ${invite.email}`);
  lines.push('That is how the invitation finds you — an account made with a different address will not see it.');

  const days = daysUntilExpiry(invite, now);
  if (days != null) {
    lines.push('');
    lines.push(
      days <= 0
        ? 'The invitation has lapsed — reply and we will reopen it.'
        : `It is open for another ${days} day${days === 1 ? '' : 's'}.`,
    );
  }

  const site = (opts.siteUrl ?? '').trim();
  if (site) { lines.push(''); lines.push(site); }

  lines.push('');
  lines.push(`Thanks,\n${gym}`);
  return lines.join('\n');
}

/** The chase, as a `mailto:` for the owner's own mail client — the same door
 *  the first message goes out of, for the same reason. */
export function reminderMailto(
  invite: Pick<MemberInvite, 'email' | 'fullName' | 'planName' | 'expiresAt'>,
  opts: { gymName?: string | null; siteUrl?: string | null } = {},
  now: number = Date.now(),
): string {
  const subject = encodeURIComponent(reminderSubject(opts.gymName));
  const body = encodeURIComponent(reminderMessage(invite, opts, now));
  return `mailto:${encodeURIComponent(invite.email)}?subject=${subject}&body=${body}`;
}
