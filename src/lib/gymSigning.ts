// The half of the gym's paperwork that was never built: the member's own end.
//
// `src/lib/gymDocs.ts` and studio-web/app/compliance/page.tsx are the desk's
// end, and they work. What they produce, in every case, is a member of staff
// choosing a name from the roster and typing it into a box — because there was
// no member-side path anywhere in this repository. Nothing a member opened,
// nothing a member tapped, and not one row written by a member's own session.
//
// So the document a gym would produce after an injury said the member signed,
// and what happened was that somebody at reception typed eleven characters.
//
// ── What this module is, and what it is not ───────────────────────────────
//
// It is the member reading the wording the gym is actually asking for, agreeing
// to it from their own authenticated session, and that agreement being
// attributed to them by the database rather than by the app. Nothing here can
// write a signature for anybody else: `signAsMember` sends no member id at all
// — the row is stamped with auth.uid() by the trigger in supabase/parts/520,
// and the RLS policy there refuses any insert where the two disagree.
//
// It is not a drawn signature, and that is a decision rather than a shortcut.
// An authenticated, timestamped agreement against a version whose wording is
// frozen at the database is stronger evidence than a bitmap of a fingertip
// scrawl: the bitmap proves that a finger moved on a screen, and the account
// proves who was holding it. supabase/parts/185 makes the same argument at
// greater length, and eIDAS Article 25 and the UK Electronic Communications Act
// are what make the typed form admissible.
//
// ── Why the guardian consent is refused here ──────────────────────────────
//
// A guardian consent is an ADULT agreeing on behalf of a minor, and the minor is
// the one with the account. A member-side signing path would therefore let a
// fifteen-year-old give their own guardian consent, which is not a weaker
// signature — it is the wrong person's, and worth less than nothing because it
// looks like the right one. It is refused below and the screen says to take it
// at the desk. Doing it properly means a way for somebody with no account to be
// sent a document and identified, and that is a separate piece of work.
//
// Framework-agnostic like the rest of src/lib: the client arrives as an
// argument, so the console and the phone can both use this.
import { assertWhole, capLimit } from './rowCap';
// The paragraph below names the responsible party, so it names the brand this
// bundle actually is.
import { BRAND } from './brands';
// A date in a sentence is formatted, never assembled, and never in a locale
// this bundle picked for somebody — see scripts/check-hand-dates.mjs.
import { appLocale } from './locale';
import type { Agreement, AgreementKind } from './gymDocs';

type Queryable = { from: (table: string) => any };

/* ── who a signature came from ─────────────────────────────────────────────── */

/**
 * Which of the two things a signature row actually is.
 *
 * Derived in the database from auth.uid() — see supabase/parts/520 — and never
 * sent by a caller, because the entire defect this exists to close was an app
 * asserting who had signed.
 *
 *   'member'  the member's own session wrote it.
 *   'staff'   somebody at the desk recorded it on their behalf.
 *   'unknown' written before this was recorded. Not a synonym for 'staff': no
 *             row is relabelled by guesswork, and the honest answer to "who
 *             typed this" for those rows is that nothing knows.
 */
export type SignatureAttribution = 'member' | 'staff' | 'unknown';

const ATTRIBUTIONS: readonly string[] = ['member', 'staff', 'unknown'];

/**
 * The column, narrowed.
 *
 * Anything unrecognised — a NULL from a database this part has not been applied
 * to, a value added later — becomes 'unknown' rather than throwing or
 * defaulting to 'staff'. An unreadable answer to "who signed this" is exactly
 * what 'unknown' means, so the degraded case lands in the state that already
 * describes it.
 */
export function attributionOf(raw: unknown): SignatureAttribution {
  const s = typeof raw === 'string' ? raw : '';
  return (ATTRIBUTIONS.includes(s) ? s : 'unknown') as SignatureAttribution;
}

/** What each is, in the words a screen shows. Short: these sit in a table cell. */
export const ATTRIBUTION_LABEL: Record<SignatureAttribution, string> = {
  member: 'The member',
  staff: 'Staff, for them',
  unknown: 'Not recorded',
};

/** And what each is worth, in the words an owner needs before a dispute. */
export const ATTRIBUTION_NOTE: Record<SignatureAttribution, string> = {
  member:
    'Given by the member from their own signed-in account, against this version of the wording. This is the strong form.',
  staff:
    'A member of staff recorded this on the member’s behalf. It is a real business record (a staff attestation that the member agreed), but it is not the member’s own act, and it is not what a signature is usually taken to mean.',
  unknown:
    'Written before this product recorded who typed a signature. It is not known whether the member gave it or a member of staff entered it for them, and nothing here will guess.',
};

/**
 * How many signatures of each kind this gym holds.
 *
 * Returned as counts rather than a headline percentage on purpose: "62% member
 * signed" invites an owner to read the remainder as a rounding error, and the
 * remainder is the part of the filing cabinet that would not survive being
 * asked about.
 */
export interface AttributionTally { member: number; staff: number; unknown: number; total: number }

export function tallyAttribution(
  rows: ReadonlyArray<{ attribution: SignatureAttribution }>,
): AttributionTally {
  const t: AttributionTally = { member: 0, staff: 0, unknown: 0, total: rows.length };
  for (const r of rows) t[r.attribution] += 1;
  return t;
}

/* ── the member's own end ──────────────────────────────────────────────────── */

/**
 * One thing the gym is asking this member to agree to, with their answer.
 *
 * The BODY travels with it. A signing screen that shows a title and a Sign
 * button records agreement to a document nobody put in front of anybody, which
 * is a worse record than the one this whole item exists to replace — it would
 * at least be honest about being a desk entry.
 */
export interface MemberAgreement {
  id: string;
  kind: AgreementKind;
  title: string;
  body: string;
  version: number;
  required: boolean;
  /** When they signed THIS version, or null when they have not. */
  signedAt: string | null;
  /** The name they signed it with. Null when unsigned. */
  signedName: string | null;
  /** Who gave it, for a version they have already signed. */
  attribution: SignatureAttribution | null;
  /**
   * Why this one cannot be signed here, or null when it can. A guardian consent
   * is the only case today; see the header.
   */
  refusal: string | null;
  /**
   * Whether this KIND of consent can be withdrawn at all — see
   * `REVOCABLE_KINDS`. A property of the kind and not of this member's answer,
   * so it is true on a photo consent nobody has signed yet.
   */
  revocable: boolean;
  /**
   * When this consent was withdrawn, or null when it stands.
   *
   * Null carries three different situations and the screen must not read it as
   * one: this kind cannot be withdrawn, or it can and has not been, or the
   * revocations could not be read at all. The third is why `forMember` takes a
   * `RevocationRead` and not an array — see `fetchMyRevocations`.
   */
  revokedAt: string | null;
}

export const GUARDIAN_REFUSAL =
  'This one has to be given by the adult responsible for you, in person at the gym. It cannot be given from this account. An account belonging to the person the consent is ABOUT is the wrong signature, however it is worded.';

/** The one sentence a member reads before they agree to anything here. */
export const SIGNING_RULE =
  'Signing records your name, the moment, and the exact wording above, against your account. It is kept as the gym’s evidence that you agreed and it cannot be edited or taken back afterwards. Withdrawing consent later is a new record, not the quiet disappearance of this one.';

/**
 * Why the gym holds this rather than the app's publisher, said once and shown
 * on the screen.
 *
 * Reads the brand. The heading above it on `app/(client)/agreements.tsx` always
 * did — `Your gym’s, not ${BRAND.label}’s` — so on a white-label build the
 * title named the member's own app and the sentence under it named a supplier
 * they have never heard of. The entire purpose of this paragraph is to tell a
 * member who to take a dispute to, and it was naming two different parties in
 * consecutive lines.
 */
export const NOT_REPPLE =
  `These are your gym’s own documents. ${BRAND.label} does not write them, check them or advise on them, `
  + 'and the release you agreed to when you joined the app is a different document owned by a different party.';

/* ── withdrawing a consent ─────────────────────────────────────────────────── */
//
// `SIGNING_RULE` above has always ended "withdrawing consent later is a new
// record, not the quiet disappearance of this one", and part 185 says the same
// thing in the comment above the two policies it withholds from the member.
// Both sentences were true about the half they defended — the signature is
// immutable and stays immutable — and both described a new record that did not
// exist anywhere in this product. supabase/parts/3030 is that record; this
// section is the half that reads it.
//
// Nothing here writes to `gym_agreement_signatures`, touches a bucket, or
// deletes anything. A withdrawal is a second dated fact laid beside the first,
// and both are true: they agreed then, and they withdrew later.

/**
 * The kinds of consent that can be withdrawn at all.
 *
 * The reasoning is set out at length in supabase/parts/3030 and is enforced
 * there by a CHECK constraint; this list is the same list and exists so a
 * screen can decide whether to draw a control. The four kinds NOT here are
 * absent for four different reasons:
 *
 *   waiver             a condition of entry, not a preference. Withdrawing it
 *                      while the membership runs means somebody training in a
 *                      building with no current waiver.
 *   terms, contract    withdrawing agreement to the terms of a live membership
 *                      is ENDING the membership — notice period, final invoice,
 *                      standing order — and a button here that looked like it
 *                      did that and did not would be the worst control in the
 *                      product.
 *   par_q              a declaration of fact at a moment, not a standing
 *                      permission. It is superseded by a newer questionnaire,
 *                      never un-given; there is nothing to withdraw.
 *
 * A kind added here and not to the CHECK gets a control that 23514s under the
 * member's thumb. Added to the CHECK and not here, nobody is ever offered it.
 */
export const REVOCABLE_KINDS: readonly AgreementKind[] = ['photo_consent', 'guardian_consent'];

/**
 * And the kinds a member may withdraw FROM THEIR OWN ACCOUNT, which is a
 * shorter list.
 *
 * `guardian_consent` is revocable and is not on it. The adult who gave it may
 * take it back; the minor it is ABOUT may not, for exactly the reason
 * `GUARDIAN_REFUSAL` refuses the signing from that account — a decision that
 * was never the account-holder's to make does not become theirs on the way out.
 * The insert policy in part 3030 refuses it too, so a screen that ignored this
 * list would produce a tap that silently wrote nothing.
 */
export const MEMBER_REVOCABLE_KINDS: readonly AgreementKind[] = ['photo_consent'];

export function isRevocable(kind: AgreementKind): boolean {
  return REVOCABLE_KINDS.includes(kind);
}

export function memberMayRevoke(kind: AgreementKind): boolean {
  return MEMBER_REVOCABLE_KINDS.includes(kind);
}

/** One withdrawal, as the member's own screen reads it back. */
export interface ConsentRevocation {
  kind: AgreementKind;
  /** When it was recorded, and therefore when it took effect. */
  revokedAt: string;
  /** Their words, where they gave any. Null is the ordinary case. */
  reason: string | null;
}

/**
 * What a read of the revocations produced — and NOT an array, deliberately.
 *
 * Three outcomes, and collapsing any two of them is a defect:
 *
 *   'read'    the table answered. `rows` is what this member has withdrawn,
 *             and an empty `rows` under this status genuinely means nothing has
 *             been withdrawn.
 *   'absent'  supabase/parts/3030 has not been applied to THIS database (it is
 *             applied to this project's own; other deployments are the case).
 *             No consent CAN have been withdrawn there, so treating every
 *             consent as standing is the true answer rather than optimistic —
 *             it is a different fact from the one above, and the screen says so
 *             rather than offering a control that would 42P01 under the thumb.
 *
 * Every other failure THROWS, and this is the important half. A read that timed
 * out is not a member who has withdrawn nothing: the house rule is that a
 * failed read is not an empty list, and the consequence of breaking it here is
 * that a gym is told it holds a live consent on the strength of a request that
 * never arrived.
 */
export type RevocationRead =
  | { status: 'read'; rows: ConsentRevocation[] }
  | { status: 'absent' };

/**
 * The default for `forMember`, and the state of every database this part has
 * not reached. Named rather than inlined so the call sites read as the claim
 * they are making.
 */
export const NO_REVOCATION_TABLE: RevocationRead = { status: 'absent' };

/* ── what "this database has no such table" actually looks like ────────────
 *
 * Two codes, and the one this file was written around is the one that does not
 * arrive. A request for a table PostgREST does not hold in its schema cache is
 * refused BY PostgREST and never reaches Postgres at all, so the Postgres code
 * for an undefined relation is not produced. Probed against this project's own
 * API, with the anon key, on 13 Sep 2026:
 *
 *   GET /rest/v1/lane52_no_such_table_probe → PGRST205
 *       "Could not find the table 'public.lane52_no_such_table_probe' in the
 *        schema cache"
 *   GET /rest/v1/gym_agreements?select=no_such_column → 42703
 *
 * So the tolerance below accepted a code the deployment never sends, and every
 * member of every gym without part 3030 would have had the screen that tells
 * them what they must sign go down on the read that was written to survive.
 *
 * 42P01 is kept because it is genuinely reachable: a warm cache over a table
 * dropped underneath it, which is the window during a rollback.
 *
 * And ONLY those two. 42501 (refused), PGRST301 (a dead session), a timeout or
 * a dropped connection are not a database without the feature, and reading any
 * of them as one is how a gym is told it holds a live consent on the strength
 * of a request that never arrived.
 *
 * ── the same two codes are written down twice ─────────────────────────────
 *
 * `isMissingCueTable` in src/lib/coachCues.ts is this function under another
 * name, and its own header names this file as the one that had it wrong. Two
 * copies of a rule about error codes drift exactly the way two copies of a
 * list of kinds drift, and the failure is silent in both directions. They
 * should be one helper in one place; that is a module neither lane owns
 * tonight, so this copy carries the pointer instead of the merge.
 */

/** Postgres, on a relation that does not exist. Reachable only over a warm
 *  cache — see above. */
const UNDEFINED_TABLE = '42P01';
/** PostgREST, on a table absent from its schema cache. What a deployment
 *  without the part actually answers. */
const UNKNOWN_TABLE = 'PGRST205';

/**
 * Narrow an error to "this database has no such table".
 *
 * Exported because it is the load-bearing half of the tolerance and the test
 * asserts it directly rather than only through a fake client: a 403 read as a
 * missing table is a member told their gym has not switched withdrawal on when
 * what actually happened is that the read was refused.
 */
export function isMissingRevocationTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === UNDEFINED_TABLE || code === UNKNOWN_TABLE;
}

/**
 * An ISO instant as a number, or null when it is not one.
 *
 * A bare `YYYY-MM-DD` is explicitly refused rather than parsed. `Date.parse`
 * reads one as midnight UTC, which silently invents a time of day and would
 * order a withdrawal against a signature by a fiction; both columns this
 * compares are `timestamptz` and carry an offset, so anything date-shaped
 * arriving here means something upstream is wrong and the honest answer is
 * "cannot be placed in time".
 */
function instant(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const s = iso.trim();
  if (s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * When this kind of consent was withdrawn, counting only a withdrawal that
 * lands AFTER the signature it would undo.
 *
 * The ordering is the whole of it. A member may withdraw photo consent, change
 * their mind in June and sign again: the June signature is in force because it
 * is later, and the earlier revocation stays on the record as the reason there
 * is a gap. A function that answered "has this kind ever been revoked" would
 * leave that member unable to consent to anything again.
 *
 * Two degraded cases, and both resolve TOWARDS the withdrawal:
 *
 *   · a `revokedAt` that will not parse counts as revoking. It is a withdrawal
 *     nobody can place in time, and the two mistakes are not symmetrical — a
 *     consent wrongly shown as withdrawn costs a photograph that is not taken,
 *     and a withdrawal wrongly ignored costs a photograph of somebody who asked
 *     for it to stop.
 *   · an unparseable `signedAt` beside any revocation of that kind does the
 *     same, because the two cannot be ordered and the safe reading of "I cannot
 *     tell whether this was withdrawn" is not "it was not".
 */
export function revokedAtFor(
  kind: AgreementKind, signedAt: string | null, read: RevocationRead,
): string | null {
  if (read.status !== 'read') return null;
  const mine = read.rows.filter((r) => r.kind === kind);
  if (mine.length === 0) return null;
  const signed = instant(signedAt);
  // Newest first, so the first one that counts is the one that governs.
  const ordered = [...mine].sort((a, b) => (instant(b.revokedAt) ?? Infinity) - (instant(a.revokedAt) ?? Infinity));
  for (const r of ordered) {
    const at = instant(r.revokedAt);
    if (at === null) return r.revokedAt;
    if (signedAt === null) return r.revokedAt;
    if (signed === null) return r.revokedAt;
    if (at >= signed) return r.revokedAt;
  }
  return null;
}

/**
 * Whether this consent is CURRENTLY in force: signed, and not withdrawn since.
 *
 * The question a gym has to answer before it publishes a photograph, and the
 * one `signedAt !== null` used to be asked to answer on its own.
 */
export function inForce(a: MemberAgreement): boolean {
  return a.signedAt !== null && a.revokedAt === null;
}

/**
 * Whether to draw a Withdraw control beside this row.
 *
 * Defined AS "nothing blocks it" rather than as its own list of conditions, and
 * that is the point: two functions answering the same question separately drift,
 * and the way they drift here is a live-looking button whose tap produces the
 * refusal the screen should never have offered.
 *
 * The condition it is easy to leave out of a hand-written list is the READ, and
 * it is the one that matters today: under a database supabase/parts/3030 has not
 * reached, every consent correctly reads as standing — so a check that looked
 * only at the row would draw a button on every photo consent in the product and
 * 42P01 under the member's thumb.
 */
export function mayWithdraw(a: MemberAgreement, read: RevocationRead): boolean {
  return withdrawBlocker(a, read) === null;
}

/** The heading on the confirmation, naming the thing rather than "this". */
export function withdrawTitle(title: string): string {
  return `Withdraw your consent for “${title}”?`;
}

/**
 * What the member reads before they tap, and it has to contain both halves.
 *
 * A control that implied a deletion it cannot perform would be worse than no
 * control: somebody would tap it, believe the photographs were gone, and find
 * out otherwise from a shop window. So the sentence says what changes, says
 * plainly what does not, and names the thing they should do instead if what
 * they actually want is the pictures taken down.
 */
export const WITHDRAW_WHAT_IT_DOES =
  'From now on your gym does not have your consent for this. It is recorded against your account with today’s date, '
  + 'your gym can see it, and it is what they have to go on when they decide whether to photograph or film you.';

export const WITHDRAW_WHAT_IT_DOES_NOT =
  'It does not delete anything. Photographs and video already taken still exist, and anything already printed, posted or '
  + 'shared is out in the world and no app can call it back. The record that you agreed on the original date also stays. '
  + 'Withdrawing is a second entry beside it, not an erasure of it, so both remain true. If you want particular pictures '
  + 'taken down or deleted, ask your gym directly: that is a separate request and this button does not make it.';

// The second sentence names WHERE, and that is not decoration. `gym_agreement_
// signatures_uq` in part 185 is unique on (agreement, member), so a member who
// withdraws and changes their mind cannot sign the same version a second time —
// the screen shows them a document they have already agreed to and no form. The
// sentence promised something true of the product and not reachable from the
// button that says it, which is the smaller cousin of the defect the paragraph
// above it exists to prevent.
export const WITHDRAW_CANNOT_BE_UNDONE =
  'This entry is permanent, the same way your signature is. Neither you nor your gym can delete it. If you change your '
  + 'mind you can give consent again: tell your gym, or sign the next version of this document when they publish one. '
  + 'That later signature is the one that counts.';

export const WITHDRAW_LABEL = 'Withdraw Consent';
export const WITHDRAW_A11Y_HINT = 'Records that you no longer consent. Does not delete anything already taken.';

/**
 * What the screen says under a consent that has been withdrawn.
 *
 * ── whose day this date is, and why it is not UTC's ───────────────────────
 *
 * `revoked_at` is a `timestamptz`. It is an INSTANT and it has no calendar of
 * its own, so turning it into a date is a choice of WHOSE calendar, and there
 * are only three candidates:
 *
 *   UTC's      what this line used to print, via
 *              `toISOString().slice(0, 10)`. Nobody's. A member in Auckland who
 *              withdraws their consent at nine on a Monday evening reads that
 *              they withdrew it on Tuesday; one in Honolulu reads Sunday. The
 *              sentence beside it says "your signature from before that date",
 *              so the wrong day here is not a cosmetic label — it puts a
 *              signature on the wrong side of the withdrawal for the reader.
 *   the GYM's  `gymDay(at, zone)` from src/lib/gymZone.ts, and the right answer
 *              for anything the gym reconciles: takings, a door log, a rota.
 *              This is not that. It is also unavailable here on its own terms —
 *              this module is the MEMBER's end and holds no tenant zone, and
 *              `gymDay` returns null without one, which a screen would then
 *              have to explain with `NO_ZONE_NOTE`. Explaining the gym's
 *              timezone to somebody reading back their own act would be an
 *              answer to a question they did not ask.
 *   the READER's  which is what this is. The member is the reader, the act was
 *              theirs, and the only calendar the date has to agree with is the
 *              one on the phone they tapped it on.
 *
 * So: the local getters, through `toLocaleDateString` with no literal locale,
 * which is the same formatter and the same three options the signature date on
 * app/(client)/agreements.tsx is already drawn with. Two dates on one card, one
 * kind of date.
 */
export function withdrawnLine(revokedAt: string): string {
  const at = instant(revokedAt);
  const day = at === null ? null
    : new Date(at).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  return day === null
    ? 'Withdrawn. Your gym does not have your consent for this, and the date it was recorded could not be read.'
    : `Withdrawn on ${day}. Your signature from before that date is still on the record, and so is this.`;
}

/**
 * And the sentence for a database part 3030 has not reached.
 *
 * Said out loud rather than rendered as a disabled button with no explanation,
 * and never said as "you have not withdrawn anything" — which would be a claim
 * about this member made from the absence of a table.
 */
export const WITHDRAW_UNAVAILABLE_NOTE =
  'Withdrawing consent from the app is not switched on for your gym yet. Ask them directly and they can record it for you. '
  + 'This is not a record that you have never asked.';

/**
 * Why this cannot be withdrawn here, or null when it can.
 *
 * Mirrors `signingBlocker`: the screen asks before it writes, and the answer is
 * the sentence the member reads rather than a boolean the screen has to find
 * words for.
 */
export function withdrawBlocker(a: MemberAgreement, read: RevocationRead): string | null {
  if (read.status !== 'read') return WITHDRAW_UNAVAILABLE_NOTE;
  if (!isRevocable(a.kind)) {
    return 'This one is part of how your gym is allowed to train you, so it is not something to switch off here. '
      + 'If you no longer want to agree to it, that is a conversation about your membership. Speak to your gym.';
  }
  if (!memberMayRevoke(a.kind)) return GUARDIAN_REFUSAL;
  if (a.signedAt === null) return 'You have not given this consent, so there is nothing to withdraw.';
  if (a.revokedAt !== null) return 'You have already withdrawn this.';
  return null;
}

/**
 * What this member has withdrawn.
 *
 * No member id is sent, for the same reason `fetchMySignatures` sends none: the
 * RLS policy is `member_id = auth.uid()`, so the session decides whose these
 * are and no argument exists through which one member could ask for another's.
 *
 * A missing table is caught and NOTHING ELSE is — see `isMissingRevocationTable`
 * for the two codes and for the probe that showed the original single code was
 * the wrong one. Part 3030 is applied to this project's database now, so the
 * absent path is no longer what a member here takes; it is still what every
 * deployment without the part takes, and a read that assumed the table existed
 * would take the paperwork screen down for all of them — a screen whose whole
 * job is to show somebody what they have not yet signed. Any other error
 * throws, because a read that failed on the wire is not a member who has
 * withdrawn nothing, and the difference is whether a gym goes on publishing
 * photographs of somebody who asked it to stop.
 */
export async function fetchMyRevocations(sb: Queryable): Promise<RevocationRead> {
  const { data, error } = await sb
    .from('gym_agreement_revocations')
    .select('kind, revoked_at, reason')
    .order('revoked_at', { ascending: false })
    .limit(capLimit());
  if (error) {
    if (isMissingRevocationTable(error)) return NO_REVOCATION_TABLE;
    throw error;
  }
  return {
    status: 'read',
    rows: assertWhole(data, 'what you have withdrawn').map((r: any) => ({
      kind: r.kind as AgreementKind,
      revokedAt: r.revoked_at,
      reason: typeof r.reason === 'string' && r.reason.trim() !== '' ? r.reason : null,
    })),
  };
}

/**
 * Withdraw it, as yourself.
 *
 * Same three-column discipline as `signAsMember`, and the same reason each is
 * absent:
 *
 *   revoked_at    NOT sent. It defaults to now() in the database, so nothing
 *                 can backdate a withdrawal to before a signature — which would
 *                 make a live consent read as withdrawn — or postdate one that
 *                 has not happened.
 *   member_id     read from the SESSION here, never from an argument. The
 *                 insert policy is `member_id = auth.uid()`, so a caller
 *                 passing somebody else's id writes nothing at all.
 *   agreement_id  there is no such column. The withdrawal is scoped to the
 *                 KIND, so that publishing a new version of the gym's photo
 *                 policy cannot silently clear it — see part 3030.
 *
 * `kind` is checked against `MEMBER_REVOCABLE_KINDS` before the write rather
 * than left to the policy. The policy WOULD refuse it, silently, by narrowing
 * the insert to zero rows — and a member tapping Withdraw on a guardian consent
 * would be told nothing had gone wrong.
 */
export async function withdrawConsent(
  sb: Queryable & { auth: { getUser: () => Promise<any> } },
  tenantId: string,
  w: { kind: AgreementKind; reason?: string | null },
): Promise<void> {
  if (!memberMayRevoke(w.kind)) {
    throw new Error(
      isRevocable(w.kind) ? GUARDIAN_REFUSAL
        : 'That one is not something you can withdraw here. Speak to your gym. It is part of how they are allowed to train you.',
    );
  }
  const { data: auth, error: authErr } = await sb.auth.getUser();
  const uid = auth?.user?.id ?? null;
  if (authErr || !uid) {
    throw new Error('You are not signed in, so there is no account this could be recorded against. Sign in and try again.');
  }
  const reason = typeof w.reason === 'string' && w.reason.trim() !== '' ? w.reason.trim() : null;
  const { data, error } = await sb.from('gym_agreement_revocations')
    .insert({ tenant_id: tenantId, member_id: uid, kind: w.kind, reason })
    .select('id');
  if (error) throw error;
  // Counted, not merely error-checked. An INSERT that RLS narrows to zero rows
  // succeeds having stored nothing, which here would be a member told their
  // consent was withdrawn while their gym goes on holding a live one.
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('That was not recorded, so as far as your gym can see your consent still stands. Try again.');
  }
}

/**
 * Everything this gym is currently asking for, joined to what this person has
 * already given.
 *
 * Only ACTIVE versions, because those are the only ones the database will now
 * accept a signature against (supabase/parts/520 narrowed the member insert
 * policy to them) and the only ones the compliance screen counts. A member
 * cannot usefully sign a retired version and should not be shown one.
 *
 * Matching is on the AGREEMENT ROW, never on the kind. Signing version 1 does
 * not cover version 2 — that is the entire reason versions exist, and matching
 * on kind here would silently tell somebody they had signed wording they had
 * never seen.
 */
export function forMember(
  agreements: ReadonlyArray<Agreement>,
  signatures: ReadonlyArray<{
    agreementId: string; signedAt: string; signedName: string; attribution: SignatureAttribution;
  }>,
  revocations: RevocationRead = NO_REVOCATION_TABLE,
): MemberAgreement[] {
  const mine = new Map(signatures.map((s) => [s.agreementId, s]));
  return agreements
    .filter((a) => a.active)
    .map((a) => {
      const s = mine.get(a.id);
      const signedAt = s?.signedAt ?? null;
      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        body: a.body,
        version: a.version,
        required: a.required,
        signedAt,
        signedName: s?.signedName ?? null,
        attribution: s?.attribution ?? null,
        refusal: a.kind === 'guardian_consent' ? GUARDIAN_REFUSAL : null,
        revocable: isRevocable(a.kind),
        revokedAt: revokedAtFor(a.kind, signedAt, revocations),
      };
    })
    .sort((x, y) => {
      // Unsigned first, required before optional, then by title. What is waiting
      // on the reader is what the screen is for.
      const wx = waitingOn(x) ? 0 : 1;
      const wy = waitingOn(y) ? 0 : 1;
      return wx - wy || Number(y.required) - Number(x.required) || x.title.localeCompare(y.title);
    });
}

/** Whether this one is still waiting on the member. A refused one is not: there
 *  is nothing they can do about it here, and counting it would send somebody
 *  looking for a button that is deliberately absent. */
export function waitingOn(a: MemberAgreement): boolean {
  return a.signedAt === null && a.refusal === null;
}

export function waitingCount(rows: ReadonlyArray<MemberAgreement>): number {
  return rows.filter(waitingOn).length;
}

/**
 * Unsigned, whoever is supposed to do something about it.
 *
 * `waitingOn` answers "may this member act on this row", which is the right
 * question for a button and for the ordering. It is the WRONG question for the
 * line at the top of the screen, and one function was answering both.
 *
 * A guardian consent carries `GUARDIAN_REFUSAL` — correct, because a minor may
 * not give consent about themselves however it is worded — and that took the
 * row out of the count as a side effect. So a sixteen-year-old whose guardian
 * consent is unsigned opened the gym paperwork screen and read "Nothing is
 * waiting on you", and supabase/parts/185 is explicit that the gym may not
 * train them at all without it. They turn up and are either turned away at the
 * desk or, worse, trained without it.
 */
export function outstanding(a: MemberAgreement): boolean {
  return a.signedAt === null;
}

/** Unsigned AND not this member's to sign. Someone else has to act, and the
 *  member still needs to know it has not happened. */
export function blockedOn(a: MemberAgreement): boolean {
  return a.signedAt === null && a.refusal !== null;
}

export interface AgreementStanding {
  /** Unsigned and this member may sign it here. */
  waiting: number;
  /** Unsigned and somebody else has to give it. */
  blocked: number;
  /** Both together — what the gym is still missing. */
  outstanding: number;
}

export function agreementStanding(rows: ReadonlyArray<MemberAgreement>): AgreementStanding {
  const waiting = rows.filter(waitingOn).length;
  const blocked = rows.filter(blockedOn).length;
  return { waiting, blocked, outstanding: waiting + blocked };
}

/**
 * The line at the top of the member's paperwork screen.
 *
 * Never says "nothing is waiting on you" while anything is unsigned. A document
 * the member cannot sign is still a document the gym is missing, and the
 * sentence names who has to give it rather than leaving a minor to discover it
 * at the desk.
 *
 * Only called once the read has landed and there is something to report on —
 * loading, failed and "your gym publishes nothing" are three other sentences
 * that belong to the screen.
 */
export function agreementSummary(rows: ReadonlyArray<MemberAgreement>): string {
  const { waiting, blocked } = agreementStanding(rows);
  const docs = (n: number) => `${n} document${n === 1 ? '' : 's'}`;
  const guardian = (n: number) =>
    `${n === 1 ? 'it' : 'they'} can only be given by the adult responsible for you, in person at the gym`;
  if (waiting === 0 && blocked === 0) return 'Nothing is waiting on you.';
  if (waiting === 0) {
    return `Nothing here is for you to sign, but ${docs(blocked)} your gym asks for `
      + `${blocked === 1 ? 'is' : 'are'} still unsigned: ${guardian(blocked)}. `
      + 'Your gym may not be able to train you until that is done.';
  }
  if (blocked === 0) return `${docs(waiting)} waiting on you.`;
  return `${docs(waiting)} waiting on you, and ${blocked} more still unsigned: `
    + `${guardian(blocked)}. Your gym may not be able to train you until that is done.`;
}

/**
 * Why this cannot be signed yet, or null when it can.
 *
 * `readIt` is whether the reader has actually opened the wording on this screen.
 * The database cannot check that — nothing about scrolling is visible to it — so
 * the app is the only place it can be true, and a Sign button that works on
 * text nobody expanded records something that did not happen. The same argument
 * and the same gate are in app/(client)/coach-documents.tsx.
 */
export function signingBlocker(
  a: MemberAgreement, typedName: string, agreed: boolean, readIt: boolean,
): string | null {
  if (a.refusal) return a.refusal;
  if (a.signedAt) return 'You have already signed this version.';
  if (!readIt) return 'Open the wording and read it first. Agreeing to a document you have not seen is not agreeing to anything.';
  if (!agreed) return 'Tick the box to say you agree to it.';
  if (!typedName.trim()) {
    return 'Type your name. The name on the document is what makes it a signature, and it is kept exactly as you type it, separately from your account name, so it survives you changing that.';
  }
  if (typedName.trim().length < 2) return 'That is too short to be a name.';
  return null;
}

/**
 * Everything the gym asks this tenant's members to agree to.
 *
 * Read through the ordinary agreements policy, which part 185 opened to the
 * whole tenant with the right reason on it: a document somebody has to sign and
 * cannot read before signing is not consent.
 */
export async function fetchGymAgreements(sb: Queryable, tenantId: string): Promise<Agreement[]> {
  const { data, error } = await sb
    .from('gym_agreements')
    .select('id, kind, title, body, version, active, required, created_at')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('kind', { ascending: true })
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data, 'what your gym asks you to sign').map((r: any) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    version: Number(r.version) || 1,
    active: r.active !== false,
    required: r.required !== false,
    createdAt: r.created_at,
  }));
}

/**
 * What this person has already signed.
 *
 * No member id is sent. `gym_agreement_sig_own_r` is `member_id = auth.uid()`,
 * so the session decides whose signatures these are and a caller cannot ask for
 * somebody else's by passing a different id.
 */
export async function fetchMySignatures(sb: Queryable): Promise<Array<{
  agreementId: string; signedAt: string; signedName: string; attribution: SignatureAttribution;
}>> {
  const { data, error } = await sb
    .from('gym_agreement_signatures')
    .select('agreement_id, signed_at, signed_name, attribution')
    .order('signed_at', { ascending: false })
    .limit(capLimit());
  if (error) throw error;
  return assertWhole(data, 'what you have signed').map((r: any) => ({
    agreementId: r.agreement_id,
    signedAt: r.signed_at,
    signedName: r.signed_name,
    attribution: attributionOf(r.attribution),
  }));
}

/**
 * Sign it, as yourself.
 *
 * Three columns are deliberately NOT sent, and each of them is the point:
 *
 *   member_id     omitted, so it defaults to nothing a caller chose. The insert
 *                 policy is `member_id = auth.uid()`, so it has to be supplied —
 *                 and it is supplied from the session below, read fresh rather
 *                 than passed in, so there is no argument a caller could put
 *                 somebody else's id into.
 *   attribution   derived by the database. An app that could set it would be
 *                 the same defect one level up.
 *   witnessed_by  there is no witness. The person signing is the person here.
 *
 * `version` is sent and validated against the agreement row rather than trusted:
 * a mismatch means this screen is showing wording the gym has since replaced,
 * and the write is refused so the reader is asked again against the new one.
 */
export async function signAsMember(
  sb: Queryable & { auth: { getUser: () => Promise<any> } },
  tenantId: string,
  s: { agreementId: string; version: number; signedName: string },
): Promise<void> {
  const { data: auth, error: authErr } = await sb.auth.getUser();
  const uid = auth?.user?.id ?? null;
  if (authErr || !uid) {
    throw new Error('You are not signed in, so there is no account this could be attributed to. Sign in and try again.');
  }
  const { error } = await sb.from('gym_agreement_signatures').insert({
    tenant_id: tenantId,
    agreement_id: s.agreementId,
    member_id: uid,
    signed_name: s.signedName.trim(),
    version_signed: s.version,
  });
  if (error) throw error;
}
