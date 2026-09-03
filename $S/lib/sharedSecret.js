"use strict";
// The shared secret three edge functions are guarded by, compared one way.
//
// ── why this is a module and not three lines in three files ───────────────
//
// Three functions in supabase/functions/ have no signed-in caller at all. They
// are reached by a scheduler or by a database trigger, so there is no JWT to
// resolve a person from and the only thing standing between them and the open
// internet is a shared secret:
//
//   sweep-stale-visits  — `x-sweep-secret`, and it writes to every tenant's
//                         door log in one statement.
//   instagram-publish   — the same SWEEP_SECRET on its `sweep` action, which
//                         DELETES public storage objects.
//   notify-message      — HOOK_SECRET, carried in the JSON body by the trigger
//                         on `messages`, and it is deployed with verify_jwt
//                         OFF, so this compare is the whole gate.
//
// By 4 Sep the same rule was written three times and two of the three had
// diverged. `sweep-stale-visits` compared with a length check and a loop that
// does not return on the first differing byte, and said in as many words why:
// "a short-circuiting `===` on a secret is the kind of thing that is only ever
// noticed after it matters". `instagram-publish` had been brought into line.
// `notify-message` — the one with no platform gate in front of it — was still
// on a bare `!==`.
//
// That is the argument for a module. Not that any of the three was exploitable
// over the network; it is that "how do we compare a secret" was answered three
// times by three edits, and the copy that drifted was the copy that mattered
// most. Written once, it is one answer with one test.
//
// ── this is a leaf, deliberately ──────────────────────────────────────────
//
// An edge function imports this, so it may have NO relative imports of its own:
// Deno resolves a specifier literally and an extensionless one throws on the
// function's first request. See scripts/check-functions.mjs, which enforces
// that by walking out of the functions into here.
//
// ── what this is not ──────────────────────────────────────────────────────
//
// It is not a MAC and does not pretend to be. It compares two strings the
// caller already holds. The length check in front of the loop leaks the length
// of the secret, which is true of all three call sites today and is left as it
// is: a secret whose length is known is not a secret that is broken, and hiding
// it would mean hashing both sides, which is a different and larger change than
// the one this file exists to make.
Object.defineProperty(exports, "__esModule", { value: true });
exports.secretMatches = exports.secretConfigured = void 0;
/**
 * Is a shared secret configured at all?
 *
 * Kept separate from the compare because the three callers answer an unset
 * secret DIFFERENTLY, on purpose, and collapsing that would change what they
 * say. `sweep-stale-visits` answers 503 "not configured" — an unset secret is a
 * misconfigured deploy and the wrong response to one is to start writing to
 * every gym in the database. `instagram-publish` names the secret so the owner
 * knows which one to set. `notify-message` answers 403 either way, because its
 * caller is a database trigger that reads nothing.
 */
const secretConfigured = (expected) => typeof expected === 'string' && expected.length > 0;
exports.secretConfigured = secretConfigured;
/**
 * Does the offered secret match the configured one?
 *
 * FALSE when nothing is configured, whatever was offered — including when both
 * are empty. That is the fail-closed half and it is the reason this cannot be
 * written as a bare comparison: `'' === ''` is true, and a deploy that lost its
 * secret would otherwise admit a caller who offered nothing.
 *
 * A non-string `offered` — which is what `notify-message` gets when a body
 * arrives with `secret: null`, or with no secret key at all — is false rather
 * than coerced.
 */
const secretMatches = (offered, expected) => {
    if (!(0, exports.secretConfigured)(expected))
        return false;
    if (typeof offered !== 'string')
        return false;
    const want = expected;
    if (offered.length !== want.length)
        return false;
    // No early return. The loop runs the whole length whatever it finds, so the
    // time taken does not describe how much of the secret was right.
    let diff = 0;
    for (let i = 0; i < want.length; i++)
        diff |= offered.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
};
exports.secretMatches = secretMatches;
