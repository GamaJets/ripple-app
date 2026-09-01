// Who has already tried this person — on the coach's screen, at last.
//
// ── What was already built, and who could not see it ───────────────────────
//
// src/lib/interventions.ts is a finished module: `Contact`, `contactsFor`,
// `lastContactFor`, `triedLine`, `paceFor`, `assessFollowUp`, the lot, with a
// long header about the four things it must not do. `member_interventions`
// exists (setup.sql), is indexed both ways, and carries policies that name the
// coach explicitly:
//
//   member_interventions_staff_r   select using (tenant_id = my_tenant()
//                                                and my_role() in ('trainer','owner'))
//   member_interventions_staff_w   insert with check (tenant_id = my_tenant()
//                                                and my_role() in ('trainer','owner')
//                                                and by_id = auth.uid())
//
// The read policy's own comment says why it exists: "a trainer about to ring a
// client has to be able to see that the desk rang them on Tuesday."
//
// And the only thing in the product that reads or writes that table is
// studio-web/app/retention/page.tsx — the gym OWNER's console, on a laptop. The
// trainer app, which is what the person about to make the call is holding, had
// zero importers of interventions.ts anywhere under app/(trainer)/. The table
// was built for the coach and shown to everybody except the coach.
//
// ── The gate this file exists for, and why guessing it is not acceptable ───
//
// Both policies are scoped `tenant_id = my_tenant()`, and part 153 measured the
// thing that makes that matter: a coached client does NOT share their coach's
// tenant. Checked live — coach tenant c382286c…, client tenant 4a718f6f… — and
// a client is provisioned into a personal tenant of their own, only ever
// leaving it by redeeming a GYM's member invite.
//
// So this log is a GYM's record of contacting its MEMBERS. It works exactly
// when the client on screen is a member of the coach's own gym, and for an
// independent coach's clients it does not apply at all — the read returns zero
// rows and the insert is refused by the policy.
//
// Zero rows is the dangerous half. "Nobody has contacted this client" and "this
// client is not in your gym, so this log is not about them" arrive as the same
// empty array with no error, and the first sentence is the one the whole table
// exists to make trustworthy: a coach told nobody has tried rings somebody who
// was rung on Tuesday, which is the precise duplicate `member_interventions`
// was built to prevent. `contactScope` is that distinction, decided from facts
// the app can actually establish, BEFORE the read rather than from its shape.
//
// Everything here is pure. The reads and the one write stay in the screen, for
// the reason interventions.ts gives about itself: the reads are where the
// failure modes live and each screen has to render its own.
import type { LoadStatus } from '../ui/loadStatus';
import { CHANNEL_LABEL, OUTCOME_LABEL, type Channel, type ContactOutcome } from './interventions';

/** The select list, as the Studio console already writes it. Declared in each
 *  screen that reads it — scripts/check-schema.mjs follows a named list only
 *  inside the file that names it — and repeated here only in this comment:
 *
 *      id, member_id, at, channel, by_id, by_name, outcome, note
 */

/**
 * Whether this client is one the shared contact log can be about.
 *
 * 'ok'          they are a member of the coach's own gym. Read and write both
 *               apply.
 * 'reading'     the coach's gym or the client's is still being established.
 *               Nothing may be said and nothing may be offered.
 * 'unknown'     one of the two could not be read. NOT "they are not a member" —
 *               this is the branch that stops a failed read becoming the
 *               sentence "nobody has contacted them".
 * 'no-account'  a hand-added client with no profile row.
 *               `member_interventions.member_id references profiles(id)`, so
 *               there is nothing for a row to point at.
 * 'no-gym'      the coach is attached to no gym, so `my_tenant()` is null and
 *               neither policy can be satisfied by anybody.
 * 'other-gym'   the client is in a different tenant. This is the ordinary case
 *               for an independent coach and it is not a fault: the log is a
 *               gym's record of its members and this person is not one.
 */
export type ContactScope = 'ok' | 'reading' | 'unknown' | 'no-account' | 'no-gym' | 'other-gym';

export interface ContactScopeInput {
  /** The signed-in coach's tenant, or null when they have none. */
  coachTenantId: string | null;
  /** Whether the coach's own tenant read has finished and succeeded. */
  coachTenantStatus: LoadStatus;
  /** The client's tenant, or null when the read said they have none. */
  clientTenantId: string | null;
  /** Whether the client's profile read has finished and succeeded. */
  clientTenantStatus: LoadStatus;
  /** False for a hand-added client with no account — `clientIsQueryable`. */
  clientHasAccount: boolean;
}

/**
 * The scope, from what has actually been established.
 *
 * Order matters and each step is a fact that makes the ones below it
 * unanswerable rather than false. A client with no account cannot be in any
 * tenant; a coach with no gym cannot satisfy `my_tenant()` whatever the client
 * is; and a read still in flight has established nothing at all.
 */
export function contactScope(i: ContactScopeInput): ContactScope {
  if (!i.clientHasAccount) return 'no-account';
  if (i.coachTenantStatus === 'loading' || i.clientTenantStatus === 'loading') return 'reading';
  // 'partial' counts as unknown here on purpose. A tenant id is one value: a
  // read that came back cut off has not established it, and the alternative to
  // saying so is deciding somebody is not a member of a gym off a truncated
  // answer.
  if (i.coachTenantStatus !== 'ready' || i.clientTenantStatus !== 'ready') return 'unknown';
  if (!i.coachTenantId) return 'no-gym';
  if (!i.clientTenantId) return 'other-gym';
  return i.coachTenantId === i.clientTenantId ? 'ok' : 'other-gym';
}

/** Whether a coach may log a contact at all. Exactly the scope in which the
 *  insert policy can be satisfied — offered only when it can succeed, because
 *  a control that is always refused is worse than no control. */
export const canLogContact = (s: ContactScope): boolean => s === 'ok';

/**
 * Why this log has nothing to say, in the coach's words — or null when it does
 * apply and did come back, which is the caller's cue to render the rows.
 *
 * `who` is a first name the caller has already established.
 */
export function contactScopeLine(s: ContactScope, who: string): string | null {
  switch (s) {
    case 'ok': return null;
    case 'reading': return 'Checking whether this client is one of your gym’s members…';
    case 'unknown':
      return `Whether ${who} is one of your gym’s members could not be established, so this log is not being shown rather than being shown empty. An empty contact log is the one thing here that must never be guessed at.`;
    case 'no-account':
      return `${who} has no account, so there is nothing for a contact to be recorded against. This log records contacts with your gym’s members.`;
    case 'no-gym':
      return 'This log is a gym’s shared record of who has already contacted a member, and this account is not attached to a gym. Your own notes on this client are on their timeline.';
    case 'other-gym':
      return `This log is a gym’s shared record of who has already contacted a member, and ${who} is not a member of your gym. Your own notes on them are on their timeline.`;
  }
}

/**
 * Why there are no contacts to show, given the read — or null when there are
 * some, or when the scope has already answered.
 *
 * Only 'ready' may say nobody has tried. That sentence is the entire value of
 * this table and it is also the one that gets somebody rung twice if it is
 * produced by a failed read: a coach told nobody has called rings the member
 * who was called on Tuesday, which is the duplicate effort the table exists to
 * prevent. studio-web's own read refuses a TRUNCATED page for the same reason,
 * and 'partial' is treated the same way here.
 */
export function contactGapLine(status: LoadStatus, count: number, who: string): string | null {
  if (count > 0) return null;
  switch (status) {
    case 'loading': return 'Reading who has already tried…';
    case 'error':
      return `Who has already contacted ${who} could not be read, so this is not a statement that nobody has. Check before you call — a second call from your gym in one week is what this record exists to prevent.`;
    case 'partial':
      return `Only part of the contact history came back, so whether anybody has already contacted ${who} is not established. Check before you call.`;
    case 'ready':
      return `Nobody at your gym has recorded contacting ${who}. Log yours here afterwards so the next person to look does not call them again.`;
  }
}

/**
 * The form's own validity, before anything is sent.
 *
 * A note is optional — plenty of contacts are "rang, no answer" — but the
 * channel and the outcome are not, and `outcome` defaults to 'unknown' in the
 * column precisely so a half-filled row cannot assert that somebody was spoken
 * to. This refuses to send a row whose outcome is still 'unknown' by DEFAULT
 * while allowing a coach to choose it deliberately, because those are different
 * events: the first is a form nobody finished and the second is a person saying
 * they genuinely do not know what came of it.
 */
export interface ContactDraft {
  channel: Channel | null;
  outcome: ContactOutcome | null;
  note: string;
}

/** What is still missing from the draft, or null when it can be sent. */
export function draftBlocker(d: ContactDraft): string | null {
  if (!d.channel) return 'Choose how you contacted them.';
  if (!d.outcome) return 'Choose what came of it.';
  return null;
}

/** The row to insert, with the note trimmed to null. Takes the ids and the name
 *  rather than reading them, so a test can hold both ends. `by_id` is the
 *  caller's own because the insert policy requires it: a coach must not be able
 *  to file a call under a colleague's name, since "who has already tried" is
 *  the one thing that stops the second call. */
export function contactInsert(
  d: ContactDraft,
  ctx: { tenantId: string; memberId: string; byId: string; byName: string | null; at: string },
): Record<string, unknown> | null {
  if (draftBlocker(d)) return null;
  const note = d.note.trim();
  return {
    tenant_id: ctx.tenantId,
    member_id: ctx.memberId,
    at: ctx.at,
    channel: d.channel,
    by_id: ctx.byId,
    // A blank name is not a name. `by_name` is denormalised so the answer
    // survives the coach leaving the gym, and an empty string stored there
    // would render as a contact made by nobody.
    by_name: ctx.byName && ctx.byName.trim() ? ctx.byName.trim() : null,
    outcome: d.outcome,
    note: note ? note : null,
  };
}

/** The channel picker's options, as label and value. Here so the screen does
 *  not re-derive an order: `CHANNELS` in interventions.ts is the order the
 *  Studio console shows and a coach who uses both should see one list. */
export const channelOptions = (list: readonly Channel[]): { value: Channel; label: string }[] =>
  list.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));

/** The same for outcomes. */
export const outcomeOptions = (list: readonly ContactOutcome[]): { value: ContactOutcome; label: string }[] =>
  list.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }));
