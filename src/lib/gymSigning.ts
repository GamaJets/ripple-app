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
    'A member of staff recorded this on the member’s behalf. It is a real business record — a staff attestation that the member agreed — but it is not the member’s own act, and it is not what a signature is usually taken to mean.',
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
}

export const GUARDIAN_REFUSAL =
  'This one has to be given by the adult responsible for you, in person at the gym. It cannot be given from this account — an account belonging to the person the consent is ABOUT is the wrong signature, however it is worded.';

/** The one sentence a member reads before they agree to anything here. */
export const SIGNING_RULE =
  'Signing records your name, the moment, and the exact wording above, against your account. It is kept as the gym’s evidence that you agreed and it cannot be edited or taken back afterwards — withdrawing consent later is a new record, not the quiet disappearance of this one.';

/** Why the gym holds this rather than Repple, said once and shown on the screen. */
export const NOT_REPPLE =
  'These are your gym’s own documents. Repple does not write them, check them or advise on them, and the release you agreed to when you joined the app is a different document owned by a different party.';

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
): MemberAgreement[] {
  const mine = new Map(signatures.map((s) => [s.agreementId, s]));
  return agreements
    .filter((a) => a.active)
    .map((a) => {
      const s = mine.get(a.id);
      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        body: a.body,
        version: a.version,
        required: a.required,
        signedAt: s?.signedAt ?? null,
        signedName: s?.signedName ?? null,
        attribution: s?.attribution ?? null,
        refusal: a.kind === 'guardian_consent' ? GUARDIAN_REFUSAL : null,
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
    return 'Type your name. The name on the document is what makes it a signature, and it is kept exactly as you type it — separately from your account name, so it survives you changing that.';
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
