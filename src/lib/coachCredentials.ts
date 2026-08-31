// What a coach says they are qualified to do — and the rules that stop the app
// saying anybody checked it.
//
// A `trainers` row carries a bio, a tagline, specialties and offers. It could
// not say what the coach is certified in or whether they carry insurance, which
// are the first two questions a client asks and the two a gym asks before
// letting somebody on the floor. `supabase/parts/139` adds the rows; this file
// is the part that decides what may be SAID about them.
//
// ── The rule this file exists to hold ──────────────────────────────────────
//
// Repple cannot check a certificate. There is no document store, no reviewer
// and no relationship with any awarding body or insurer, so every row written
// through the app is `verification: 'self_declared'` — enforced in the schema,
// where `authenticated` holds no write grant on the verification columns at
// all. This file is the second lock: `credentialBadge` refuses to produce a
// checked-looking label for a self-declared row, and the test asserts that the
// wording contains no form of "verified", "checked", "confirmed", "approved" or
// "accredited". A badge that implies Repple looked at something is a client
// deciding who to trust with their body on the strength of a lie.
//
// ── Expiry is three answers, not two ──────────────────────────────────────
//
// "No expiry date" and "expired" are opposite facts and were the same falsy
// value. A lifetime qualification genuinely has no end date; a lapsed insurance
// policy has one in the past. Rendering both as a blank tells a client that a
// coach whose public liability ran out in March is fine.
//
// Dates are compared as YYYY-MM-DD strings parsed at UTC midnight, and `today`
// is passed in rather than read. `new Date('2026-03-01')` is UTC by spec while
// `new Date(2026, 2, 1)` is local, and mixing them puts the boundary a day out
// for half the planet — npm test runs under three timezones for exactly this.

export type CredentialKind = 'certification' | 'insurance';
export type Verification = 'self_declared' | 'verified';

export interface Credential {
  id: string;
  kind: CredentialKind;
  title: string;
  issuer: string | null;
  /** Registration or certificate number. Certifications only — see below. */
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verification: Verification;
}

/** A credential being typed, before it has an id or a verification. */
export interface CredentialDraft {
  kind: CredentialKind;
  title: string;
  issuer: string;
  reference: string;
  issuedOn: string;
  expiresOn: string;
}

/** How near an expiry has to be before it is worth flagging. */
export const EXPIRING_SOON_DAYS = 60;

export const MAX_TITLE = 120;
export const MAX_ISSUER = 120;
export const MAX_REFERENCE = 60;

/**
 * A reference number is public on the coach's profile, and for a certification
 * that is the point: "CIMSPA R123456" is a number the READER can check with the
 * issuer, which is a better answer than a badge Repple invented. An insurance
 * policy number is checkable by nobody and identifies a live policy, so it is
 * not collected. This is why, not merely that.
 */
export const referenceAllowed = (kind: CredentialKind): boolean => kind === 'certification';

export type CredentialState = 'current' | 'expiring' | 'expired' | 'no-expiry';

/** UTC midnight for a YYYY-MM-DD string, or null if it is not one. */
function dayMs(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

const DAY = 86_400_000;

/** Whole days from `today` to `expiresOn`; negative once it has passed. */
export function daysUntil(expiresOn: string | null | undefined, today: string): number | null {
  const a = dayMs(expiresOn);
  const b = dayMs(today);
  if (a === null || b === null) return null;
  return Math.round((a - b) / DAY);
}

/**
 * A credential with no expiry is 'no-expiry', never 'current': the coach has
 * told us nothing about when it runs out, and for an insurance policy — which
 * always renews — that absence is itself worth showing.
 */
export function credentialState(c: Pick<Credential, 'expiresOn'>, today: string): CredentialState {
  const d = daysUntil(c.expiresOn, today);
  if (d === null) return 'no-expiry';
  if (d < 0) return 'expired';
  if (d <= EXPIRING_SOON_DAYS) return 'expiring';
  return 'current';
}

/**
 * The words next to a credential, and the flag a screen may use to colour it.
 *
 * `checked` is true ONLY for a row a service-role reviewer marked verified, and
 * no path in any of the three apps can write that. Everything else is the
 * coach's own statement and says so in those words.
 */
export function credentialBadge(c: Pick<Credential, 'verification'>): { label: string; checked: boolean } {
  return c.verification === 'verified'
    ? { label: 'Checked by Repple', checked: true }
    : { label: 'Stated by the coach', checked: false };
}

/** The sentence that goes above a list of claims, once, in the reader's app. */
export const CLAIM_NOTE =
  'These are what the coach has told us about themselves. Repple has not seen the certificates and has not checked them with the awarding bodies — ask to see them, or look the registration number up yourself.';

/** The same fact said to the coach, on the screen where they type it. */
export const CLAIM_NOTE_COACH =
  'What you add here is shown to clients as your own statement, marked as unchecked. Repple does not verify it, and nothing here will ever appear as though we did.';

/** One line of detail under a title: the issuer, then the number. */
export function credentialLine(c: Pick<Credential, 'issuer' | 'reference'>): string {
  const parts: string[] = [];
  const issuer = (c.issuer ?? '').trim();
  const ref = (c.reference ?? '').trim();
  if (issuer) parts.push(issuer);
  if (ref) parts.push(ref);
  return parts.join(' · ');
}

/** "Expired 4 March 2026", "Renews in 12 days", "No expiry given". */
export function expiryLine(c: Pick<Credential, 'expiresOn'>, today: string): string {
  const state = credentialState(c, today);
  if (state === 'no-expiry') return 'No expiry date given';
  const d = daysUntil(c.expiresOn, today) ?? 0;
  if (state === 'expired') {
    const n = Math.abs(d);
    return n === 0 ? 'Expired today' : `Expired ${n} day${n === 1 ? '' : 's'} ago`;
  }
  if (state === 'expiring') return d === 0 ? 'Expires today' : `Expires in ${d} day${d === 1 ? '' : 's'}`;
  return `Valid to ${c.expiresOn}`;
}

/**
 * Expired last, then the soonest to expire, then by title. A lapsed
 * certification is not hidden — a client is entitled to see that a coach has
 * one that ran out — it just stops sitting at the top of the list.
 */
export function sortCredentials<T extends Pick<Credential, 'expiresOn' | 'title'>>(list: T[], today: string): T[] {
  const rank = (c: T) => (credentialState(c, today) === 'expired' ? 1 : 0);
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const ea = dayMs(a.expiresOn);
    const eb = dayMs(b.expiresOn);
    // A lifetime qualification sorts after dated ones rather than before them:
    // null is not "expires at the beginning of time".
    if (ea === null && eb !== null) return 1;
    if (eb === null && ea !== null) return -1;
    if (ea !== null && eb !== null && ea !== eb) return ea - eb;
    return a.title.localeCompare(b.title);
  });
}

export type InsuranceClaim = 'unknown' | 'none-stated' | 'lapsed' | 'stated';

/**
 * The one-line answer to "are they insured?", and the reason it is named
 * `claim`. 'stated' means the coach says so, never that anybody confirmed it.
 *
 * `null` for the list means the read did not complete, and that is 'unknown' —
 * NOT 'none-stated'. Telling a client a coach has declared no insurance when
 * the query merely failed is a statement about somebody's professional standing
 * that we have no basis for.
 */
export function insuranceClaim(list: Credential[] | null, today: string): InsuranceClaim {
  if (list === null) return 'unknown';
  const ins = list.filter((c) => c.kind === 'insurance');
  if (ins.length === 0) return 'none-stated';
  const live = ins.some((c) => credentialState(c, today) !== 'expired');
  return live ? 'stated' : 'lapsed';
}

export function insuranceLine(claim: InsuranceClaim): string {
  switch (claim) {
    case 'unknown':     return 'We could not load this coach’s insurance details.';
    case 'none-stated': return 'No insurance stated.';
    case 'lapsed':      return 'Insurance stated, but the cover they listed has expired.';
    case 'stated':      return 'Insurance stated by the coach — not checked by Repple.';
  }
}

/** Counts for a directory row. `null` in means nothing may be counted. */
export function credentialCounts(list: Credential[] | null, today: string):
  { certifications: number; insurance: number; expired: number } | null {
  if (list === null) return null;
  return {
    certifications: list.filter((c) => c.kind === 'certification').length,
    insurance: list.filter((c) => c.kind === 'insurance').length,
    expired: list.filter((c) => credentialState(c, today) === 'expired').length,
  };
}

/**
 * The short line on a directory row. Deliberately says "stated" every time —
 * there is no count of credentials that would justify a stronger word, and the
 * place a stronger word creeps in is a summary nobody reads closely.
 */
export function credentialsSummaryLine(list: Credential[] | null, today: string): string | null {
  const c = credentialCounts(list, today);
  if (!c) return null;
  const live = c.certifications - list!.filter((x) => x.kind === 'certification' && credentialState(x, today) === 'expired').length;
  if (live === 0 && c.insurance === 0) return null;
  const bits: string[] = [];
  if (live > 0) bits.push(`${live} qualification${live === 1 ? '' : 's'}`);
  if (insuranceClaim(list, today) === 'stated') bits.push('insurance');
  if (bits.length === 0) return null;
  return `${bits.join(' and ')} stated`;
}

export type DraftProblem =
  | 'ok'
  | 'no-title'
  | 'title-too-long'
  | 'issuer-too-long'
  | 'reference-too-long'
  | 'reference-not-allowed'
  | 'bad-issued'
  | 'bad-expires'
  | 'expires-before-issued';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checked here rather than left to the database, because a CHECK constraint
 * violation arrives as a Postgres error string and there is no honest way to
 * turn "coach_credentials_dates_ordered" into a sentence for a coach. Both ends
 * still hold the rule; this end is the one that can explain it.
 */
export function validateDraft(d: CredentialDraft): DraftProblem {
  const title = d.title.trim();
  if (!title) return 'no-title';
  if (title.length > MAX_TITLE) return 'title-too-long';
  if (d.issuer.trim().length > MAX_ISSUER) return 'issuer-too-long';
  const ref = d.reference.trim();
  if (ref && !referenceAllowed(d.kind)) return 'reference-not-allowed';
  if (ref.length > MAX_REFERENCE) return 'reference-too-long';
  const issued = d.issuedOn.trim();
  const expires = d.expiresOn.trim();
  if (issued && !DATE_RE.test(issued)) return 'bad-issued';
  if (expires && !DATE_RE.test(expires)) return 'bad-expires';
  if (issued && expires && expires < issued) return 'expires-before-issued';
  return 'ok';
}

export function draftProblemText(p: DraftProblem): string {
  switch (p) {
    case 'ok':                    return '';
    case 'no-title':              return 'Give the qualification a name — "Level 3 Personal Trainer", "Public liability".';
    case 'title-too-long':        return `Keep the name under ${MAX_TITLE} characters.`;
    case 'issuer-too-long':       return `Keep the awarding body under ${MAX_ISSUER} characters.`;
    case 'reference-too-long':    return `Keep the registration number under ${MAX_REFERENCE} characters.`;
    case 'reference-not-allowed': return 'Policy numbers are not published. Nobody can check one, and it identifies a live policy — leave it out.';
    case 'bad-issued':            return 'Write the issue date as YYYY-MM-DD.';
    case 'bad-expires':           return 'Write the expiry date as YYYY-MM-DD.';
    case 'expires-before-issued': return 'The expiry date is before the issue date.';
  }
}

/** The row shape as it goes to the database, with the reference dropped where
 *  it is not allowed rather than silently kept and then shown. */
export function draftToRow(d: CredentialDraft, coachId: string): {
  coach_id: string; kind: CredentialKind; title: string;
  issuer: string | null; reference: string | null;
  issued_on: string | null; expires_on: string | null;
} {
  const ref = d.reference.trim();
  return {
    coach_id: coachId,
    kind: d.kind,
    title: d.title.trim(),
    issuer: d.issuer.trim() || null,
    reference: referenceAllowed(d.kind) && ref ? ref : null,
    issued_on: d.issuedOn.trim() || null,
    expires_on: d.expiresOn.trim() || null,
  };
}
