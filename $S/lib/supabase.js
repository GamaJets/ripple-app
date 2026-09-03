"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
exports.signIn = signIn;
exports.signUp = signUp;
exports.signOut = signOut;
exports.sendPasswordReset = sendPasswordReset;
exports.exchangeRecoveryCode = exchangeRecoveryCode;
exports.setSessionFromTokens = setSessionFromTokens;
exports.verifyRecoveryToken = verifyRecoveryToken;
exports.updatePassword = updatePassword;
exports.currentProfile = currentProfile;
exports.onAuthChange = onAuthChange;
// Supabase client. Reads keys from Expo public env at build time.
// Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in a .env file
// (see .env.example) — never commit real keys.
// (url-polyfill not needed on RN 0.81 / SDK 54 — URL is built in)
const async_storage_1 = __importDefault(require("@react-native-async-storage/async-storage"));
const supabase_js_1 = require("@supabase/supabase-js");
const reachability_1 = require("./reachability");
const whoAmI_1 = require("./whoAmI");
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
exports.supabase = (0, supabase_js_1.createClient)(url, anon, {
    // Every HTTP call this client makes, reporting whether it reached us.
    //
    // Here and not in each provider, because "is there a signal" is one fact
    // about the device and it must not be able to be true on the screen that
    // remembered to ask and false on the screen that did not. src/lib/reachability.ts
    // makes the argument for why a request to OUR host is the only instrument
    // that answers the question the callers are actually asking — a captive
    // portal is an association with no server behind it, and NetInfo calls that
    // connected.
    //
    // `observedFetch` returns the response untouched and re-throws errors
    // unchanged; supabase-js cannot tell it is there. Realtime is a WebSocket and
    // does not come through here, which is why the probe in
    // src/ui/reachability.tsx still exists.
    // The inner call is a lambda rather than a reference to `fetch` so the global
    // is resolved per request: a polyfill installed after this module evaluates
    // would otherwise be bypassed for the life of the process.
    global: { fetch: (0, reachability_1.observedFetch)((input, init) => fetch(input, init)) },
    auth: {
        storage: async_storage_1.default,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        // PKCE, not implicit: recovery/magic-link redirects then carry a `code`
        // query param instead of an `#access_token=...` fragment. Fragments get
        // silently dropped when a server-side redirect crosses from https:// to
        // a custom URL scheme (repple://) on both iOS and Android, which broke
        // password reset — the app always saw a token-less deep link. Query
        // params survive that hop intact.
        flowType: 'pkce',
    },
});
// ── One "who is signed in?" per burst ────────────────────────────────────────
//
// `/auth/v1/user` was the busiest path in this project's edge logs by a factor
// of four — 218 requests in three minutes of ordinary navigation, against 52
// for the next one — and zero whenever the app was left alone. Not a poll: one
// round trip per screen mount, per provider, per helper, and
// `supabase.auth.getUser()` is written at 128 call sites.
//
// It is wrapped HERE, on the client, rather than at those 128 sites, and that
// is a deliberate choice rather than a shortcut. `tenant`, `settings`,
// `invites` and `clientData` each handle a missing session differently and
// must go on doing so; every one of them still receives the same response
// object it receives today and branches on it unchanged. There is no new thing
// for a screen to remember to call, and no way to half-adopt it.
//
// Assigning over the method shadows the prototype's on this instance. The rule
// itself, and what it costs, is in src/lib/whoAmI.ts under test — including
// why an explicit `jwt` argument is never shared and why an errored response is
// never held.
const nativeGetUser = exports.supabase.auth.getUser.bind(exports.supabase.auth);
const whoAmI = (0, whoAmI_1.shareGetUser)(nativeGetUser, (r) => r.error != null);
exports.supabase.auth.getUser = whoAmI.getUser;
// Signing in, signing out and a token refresh all drop the held answer at
// once, so the only case the few-second window widens is a session revoked
// server-side with no client event. Registered here rather than in a provider
// because a held identity that outlives a sign-out is the one failure of this
// wrapper that would matter, and it must not depend on a screen being mounted.
exports.supabase.auth.onAuthStateChange(() => { whoAmI.forget(); });
async function signIn(email, password) {
    const { data, error } = await exports.supabase.auth.signInWithPassword({ email, password });
    if (error)
        throw error;
    return data.user;
}
async function signUp(email, password, fullName, role) {
    const { data, error } = await exports.supabase.auth.signUp({
        email, password, options: { data: { full_name: fullName, role } },
    });
    if (error)
        throw error;
    return data.user;
}
async function signOut() {
    const { error } = await exports.supabase.auth.signOut();
    if (error)
        throw error;
}
/** Email a password-reset link. Always resolves without leaking whether the
 * email is registered — Supabase itself stays silent on unknown addresses. */
async function sendPasswordReset(email, redirectTo) {
    const { error } = await exports.supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error)
        throw error;
}
/** Establish a session from the recovery-link's PKCE `code` (the deep link
 * back into the app) — kept as a fallback path; the primary path since this
 * fix is `verifyRecoveryToken` below (see its doc comment for why). */
async function exchangeRecoveryCode(code) {
    const { error } = await exports.supabase.auth.exchangeCodeForSession(code);
    if (error)
        throw error;
}
/** Fallback: establish a session directly from access/refresh tokens, for the
 * rare deep link that still arrives in the older implicit-grant shape. */
async function setSessionFromTokens(accessToken, refreshToken) {
    const { error } = await exports.supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error)
        throw error;
}
/** Establish a session straight from the recovery email's raw token hash —
 * the PRIMARY path as of the 2026-08-10 fix. The email link now deep-links
 * directly into the app (`repple://reset-password?token_hash=...&type=recovery`)
 * instead of routing through Supabase's `/auth/v1/verify` endpoint first. That
 * endpoint auto-redeems the one-time token on a bare GET, which meant an email
 * security scanner prefetching the link (common with Gmail-hosted mail) could
 * silently burn the token before the user ever tapped it. A `repple://` URL
 * can't be opened by an https-only bot, so the token can only be consumed by
 * this call, which only runs when a real device opens the app. */
async function verifyRecoveryToken(tokenHash, email) {
    const { error } = await exports.supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash, email });
    if (error)
        throw error;
}
/** Set a new password for the currently-recovered session. */
async function updatePassword(newPassword) {
    const { error } = await exports.supabase.auth.updateUser({ password: newPassword });
    if (error)
        throw error;
}
/** Current signed-in user's profile row (role, tenant, name), or null. */
async function currentProfile() {
    const { data: auth } = await exports.supabase.auth.getUser();
    if (!auth.user)
        return null;
    const { data, error } = await exports.supabase
        .from('profiles').select('id, role, tenant_id, full_name, avatar').eq('id', auth.user.id).single();
    if (error)
        throw error;
    return data;
}
/** Subscribe to auth state changes (login/logout). Returns an unsubscribe fn. */
function onAuthChange(cb) {
    const { data } = exports.supabase.auth.onAuthStateChange((_e, session) => cb(!!session));
    return () => data.subscription.unsubscribe();
}
