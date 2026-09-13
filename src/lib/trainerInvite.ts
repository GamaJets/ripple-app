// Inviting a coach, from the console.
//
// ── the dead end this closes ──────────────────────────────────────────────
//
// Three console screens told an owner to go and use a different product:
//
//   app/page.tsx           "No trainers in this gym yet. Invite one from the
//                           Repple Studio app."
//   app/staff/page.tsx     "No trainer is attached to this gym yet. Invite one
//                           from the Repple Studio app and this page fills in."
//   app/timetable/page.tsx "No trainers on your roster yet — invite one first
//                           and they will appear here."
//
// and a fourth, the rota, simply could not be used: "Nobody on the roster to
// put on a shift yet." A gym owner running the console on the desk tablet —
// which is the use the shell's own header describes — had no way to add their
// first coach at all. It is the single most likely first-day dead end in the
// console, because a new gym has zero trainers by construction.
//
// Nothing in the schema was missing. `trainer_invites` has existed since part
// 12 and its RLS policy is `owner_id = auth.uid()` FOR ALL, so the owner has
// always been able to write one; the console simply never offered the form.
//
// ── what belongs here rather than in the page ─────────────────────────────
//
// The two refusals and the two sentences. A form that validates inline is a
// form whose rules cannot be asserted without a browser, and these rules are
// about somebody's livelihood: an invite sent to a typo'd address is a coach
// who never arrives and an owner who thinks they did.

/** A trimmed, lower-cased address, or null when it is not one. */
export function readEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  // Deliberately not an RFC-complete pattern. This refuses the mistakes a
  // person makes at a desk — a missing @, a trailing comma, a pasted name —
  // and leaves the rest to Apple, Google and the mail server, which are the
  // only things that actually know whether an address exists.
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s)) return null;
  return s;
}

/**
 * Why this invite will not be sent, or null when it will.
 *
 * `existing` is every invite this owner already has on file, so the duplicate
 * is caught before the unique index does — `(owner_id, email)` is unique, and
 * a 23505 surfaced raw reads as a system failure rather than as "you already
 * invited them".
 */
export function inviteBlocker(
  raw: string,
  existing: ReadonlyArray<{ email: string; status: string }> | null,
): string | null {
  const email = readEmail(raw);
  if (!email) return 'That is not an email address this can send to. Check it and try again.';
  // Null is a read that did not land. Sending anyway risks the duplicate, and
  // BLOCKING is the safer of the two: an owner who cannot see the existing
  // invites cannot be told which one they are about to trample.
  if (existing == null) {
    return 'The invites already on file could not be read, so this cannot tell whether you have invited them before. Nothing has been sent.';
  }
  const prior = existing.find((i) => i.email.trim().toLowerCase() === email);
  if (prior && prior.status === 'pending') {
    return 'They already have an invite waiting. Nothing has been sent — ask them to check the address they were invited on.';
  }
  if (prior && prior.status === 'accepted') {
    return 'They have already accepted an invite and are on this gym. Nothing has been sent.';
  }
  return null;
}

/**
 * What to say after it is written.
 *
 * The second sentence is the one that matters and it is easy to leave out: an
 * invite is a row, not an email. Nothing in this product sends one — the coach
 * has to be told by a person, and an owner who believes the app has mailed
 * them will wait for somebody who was never contacted.
 */
export function invitedLine(email: string): string {
  return `${email} is invited. Repple does not email them — tell them yourself, and ask them to sign in with that exact address.`;
}

/** How an invite already on file reads on the list. */
export function inviteStatusLine(status: string): string {
  switch (status) {
    case 'pending': return 'Waiting for them to sign in';
    case 'accepted': return 'Accepted';
    case 'revoked': return 'Withdrawn';
    // A status this build does not know is not "fine". Named, so a value added
    // by a later part shows as unknown rather than as accepted.
    default: return 'Status not recognised by this version';
  }
}
