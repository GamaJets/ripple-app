// Single source of truth: on-device only vs live Supabase backend.
// Centralised so every screen agrees (avoids per-file env drift).
// LIVE: real Supabase auth is active. Domain data (sessions, workouts, meals,
// roster, etc.) still runs on the in-memory providers until each is migrated
// to the repo layer — see docs/roadmap-next-50.md Phase 1.
export const USE_SUPABASE = true;

/**
 * Whether to offer signing in with a phone number.
 *
 * ── why this is off ───────────────────────────────────────────────────────
 *
 * There is no SMS provider on the Supabase project, and there never has been:
 * `auth.users` holds 31 accounts and not one of them has ever had a phone.
 * With none configured, `signInWithOtp({ phone })` comes back with
 * "Unsupported phone provider" for every country equally.
 *
 * On 14 Oct 2026 somebody trying to sign up as a coach read that sentence
 * under their UAE mobile — a correctly formed one this app had already
 * accepted — and took it to mean their country was not supported. The door
 * was the FIRST thing on the sign-up screen, above email and password, so it
 * was the one they took.
 *
 * src/lib/phone.ts now turns that provider error into a sentence that points
 * at email, which is the right thing to say if somebody gets there. This stops
 * them getting there at all, because a door that cannot open should not be the
 * first thing offered.
 *
 * ── switching it back on ──────────────────────────────────────────────────
 *
 * Set `EXPO_PUBLIC_PHONE_SIGNIN=1` and publish. Do that only once the project
 * actually has a provider — Authentication → Providers → Phone, with Twilio
 * Verify and its Service SID — and, for the UAE specifically, once Twilio's
 * geo permissions include it and a transactional sender ID is registered.
 * Until then this flag being off is the honest state of the feature.
 *
 * app/phone-signin.tsx is NOT deleted and stays routable. Nothing about the
 * screen is wrong; it is waiting on an account that does not exist yet.
 */
export const PHONE_SIGNIN_ENABLED = process.env.EXPO_PUBLIC_PHONE_SIGNIN === '1';
