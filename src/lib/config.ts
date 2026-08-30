// Single source of truth: on-device only vs live Supabase backend.
// Centralised so every screen agrees (avoids per-file env drift).
// LIVE: real Supabase auth is active. Domain data (sessions, workouts, meals,
// roster, etc.) still runs on the in-memory providers until each is migrated
// to the repo layer — see docs/roadmap-next-50.md Phase 1.
export const USE_SUPABASE = true;
