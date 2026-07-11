// Single source of truth: rich demo data (mock) vs live Supabase backend.
// Centralised so every screen agrees (avoids per-file env drift).
// TEMP: mock while we build & polish the UI on full demo data.
// Flip to the env line (and seed the database) when wiring live data.
export const USE_SUPABASE = false;
// export const USE_SUPABASE = process.env.EXPO_PUBLIC_USE_SUPABASE === '1';
