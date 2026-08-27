// Normalising a code somebody read out across a gym floor.
//
// Pure, and separate from the RPC that spends it, so the rules below can be
// asserted on without a database. The screen imports both.
//
// The generator's alphabet excludes I, O, 0 and 1 (55-coach-join-code.sql), so
// a code containing one of them is certainly a misreading.
//
// It is tempting to correct it — fold O onto Q, I onto J — and that is wrong.
// L, J and Q are all VALID characters, and there is no principled direction to
// fold in: a typed O could have been Q, D or G. A guess that lands on a real
// six-character code hands the client a DIFFERENT COACH, silently, having been
// asked to confirm nothing. Failing to find a code is recoverable in seconds;
// being connected to a stranger is not obviously wrong to anybody involved.
//
// So nothing is substituted. The excluded characters are named in the failure
// message instead, where they help the reader find the real error themselves.

/** Characters a generated code can contain. Must match the SQL alphabet. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/**
 * What the user typed → what to send.
 *
 * Uppercases and drops separators, because people group codes as "K7M-2QX" and
 * paste them with a trailing space. Nothing is substituted — see the note above
 * on why correcting a misread glyph is worse than failing to find it.
 */
export function normaliseCode(input: string): string {
  return (input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

/**
 * Whether this is worth sending. Deliberately generous — the server is the
 * authority on whether a code exists, and a client-side rule that is stricter
 * than the generator would reject valid codes forever with no way to appeal.
 */
export function isPlausibleCode(input: string): boolean {
  const c = normaliseCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}

/** How far through typing they are, for the progress affordance. */
export function codeProgress(input: string): number {
  return Math.min(CODE_LENGTH, normaliseCode(input).length);
}

/**
 * What to say when the server refuses.
 *
 * The RPCs raise plain messages; these are the three a client can act on. An
 * unrecognised failure keeps the server's own words rather than being flattened
 * into "something went wrong", which tells nobody anything.
 */
export function joinErrorMessage(raw: string | null | undefined): string {
  const m = (raw || '').toLowerCase();
  if (m.includes('no coach uses that code')) {
    return 'No coach is using that code. Check it with them — codes never contain the letter O or the digits 0 and 1.';
  }
  if (m.includes('that is your own code')) {
    return 'That is your own coaching code, so there is nobody to send it to.';
  }
  if (m.includes('not signed in')) {
    return 'Sign in to Repple first, then enter the code.';
  }
  return raw?.trim() ? `${raw.trim()} Nothing was sent.` : 'The code could not be checked, so nothing was sent.';
}
