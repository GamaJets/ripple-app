// "Sign in and it will open on the screen you asked for."
//
// ── The sentence, and what it did ─────────────────────────────────────────
//
// That is `ConsoleGate`'s own copy, on the branch where nobody is signed in
// (studio-web/components/Gate.tsx). Under it:
//
//     <p style={{ marginTop: 14 }}><a href="/">Sign in</a></p>
//
// A bare slash, carrying nothing. And the sign-in form on `/` ends with
// `location.reload()`, which reloads `/`. So the screen you asked for was
// discarded on the way in, on all thirty gated routes, under a sentence
// promising it would not be. Found by opening the console in a browser, which
// is a thing nobody had done: a compiler cannot see a promise, and a production
// build is happy to make one.
//
// It matters more than it sounds. Every link INTO this console from outside is
// a deep one — /retention names a drifting member and links to
// `/members?member=<uuid>`, an emailed month close points at /close, a coach
// following a push notification lands on /coach/earnings — and a session that
// has lapsed overnight turns every one of them into the Overview, with no trace
// of where the person was going. They then navigate by hand, from memory,
// which for `?member=<uuid>` means they cannot.
//
// ── Why the destination is validated rather than trusted ──────────────────
//
// Because it arrives in a URL, and a URL is written by whoever sent the link.
// `?next=https://not-repple.example/sign-in` in an email that otherwise looks
// exactly like a Repple link would put a gym owner on somebody else's login
// form, one redirect after typing their password into the real one. That is an
// open redirect, and it is the standard way this feature is got wrong.
//
// So: an absolute path on this origin, and nothing else. Not a URL, not a
// scheme, not a host, not a protocol-relative `//host` — which is the one that
// gets past a naive "must start with a slash" check and is a full cross-origin
// jump. `new URL(raw, origin)` is deliberately NOT used to decide this: it
// resolves `//evil.example` to `https://evil.example` and answers happily,
// which is precisely the parse that makes the check look like it passed.
//
// The rule is stated positively instead — a leading `/`, then only characters a
// console route is made of — so anything unanticipated is refused rather than
// interpreted. A refusal costs one navigation to the Overview, which is exactly
// what this console did before, for everybody.

/**
 * How long a destination may be.
 *
 * Generous against the longest real one — `/members?member=` plus a uuid is
 * 52 — and short enough that nothing enormous is put in an href. A cap exists
 * at all because this string is written into a URL by one screen and read back
 * by another, and neither end has any use for a kilobyte.
 */
export const MAX_NEXT = 512;

/**
 * The characters a console destination is allowed to be made of.
 *
 * Unreserved URL characters, the sub-delimiters a query string actually uses,
 * and `/?=&%:@+`. No whitespace, no control characters, no backslash — a
 * backslash is a path separator to some browsers and `/\evil.example` is the
 * protocol-relative jump wearing a different hat.
 */
const ALLOWED = /^\/[A-Za-z0-9\-._~!$'()*+,;:@%/?=&]*$/;

/**
 * The destination a `?next=` may safely send somebody to, or null.
 *
 * Null for every reason a caller should treat identically — absent, empty, not
 * a path, off-origin, too long, or simply `/`, which is where an unhandled
 * `next` would land anyway. The caller's job is then one line: go to the path
 * if there is one, reload if there is not.
 *
 * `raw` is the DECODED value (what `URLSearchParams.get` returns). Callers that
 * hold a still-encoded string must decode it first; a `%2F%2Fevil.example` that
 * reached here undecoded would pass this and be decoded by the browser
 * afterwards, which is the same open redirect one step later.
 */
export function safeNext(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || v.length > MAX_NEXT) return null;
  // `//host` and `/\host` are cross-origin. They start with a slash, which is
  // the whole reason the naive check is not enough.
  if (v.startsWith('//') || v.startsWith('/\\')) return null;
  if (!ALLOWED.test(v)) return null;
  // `/` is not a destination worth carrying: it is where sign-in lands anyway,
  // and returning it would have the caller navigate to the page it is on.
  if (v === '/') return null;
  return v;
}

/**
 * Where the "Sign in" link on a gated screen should point.
 *
 * `here` is the path the reader is on, with its query — `location.pathname +
 * location.search`. A destination this module will not vouch for is simply
 * dropped and the link is the bare `/` it has always been, so a malformed one
 * degrades to the old behaviour rather than to an error.
 */
export function signInHref(here: string | null | undefined): string {
  const next = safeNext(here);
  return next ? `/?next=${encodeURIComponent(next)}` : '/';
}

/**
 * Where to go after a successful sign-in, given the sign-in page's own query.
 *
 * `search` is `location.search`, leading `?` and all. Null means "nowhere in
 * particular", which the caller renders as the reload it did before.
 */
export function nextFromSearch(search: string | null | undefined): string | null {
  const s = (search ?? '').trim();
  if (!s) return null;
  try {
    // `URLSearchParams` decodes, which is what `safeNext` documents it wants.
    return safeNext(new URLSearchParams(s).get('next'));
  } catch {
    // A query string this build cannot parse is not a destination. Callers get
    // the same null as an absent one and reload.
    return null;
  }
}
