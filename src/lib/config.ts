// Whether the app talks to a live Supabase backend. It always does.
//
// This was a switch once: `EXPO_PUBLIC_USE_SUPABASE` chose between an
// on-device mock repo and the real backend. Both the flag and the repo layer
// are gone — `src/data/repo.ts` and the sample rows it read were deleted when
// every screen went behind a login — so this is a hardcoded `true` that no
// environment variable can change. See the note at the top of `.env.example`.
//
// It stays a named export because ~100 files still branch on it. Those
// `!USE_SUPABASE` arms are unreachable; removing them is a separate change,
// not a header fix.
export const USE_SUPABASE = true;
