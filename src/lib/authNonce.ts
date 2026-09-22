// The nonce that stops somebody else's OAuth code being redeemed as yours.
//
// ── What this is for, and why it is not the same as an id ─────────────────
//
// When a coach connects an ad account, the app opens the provider's consent
// page and gets a `code` back through a deep link. `state` carries a nonce the
// app minted a moment earlier, and the app refuses any callback whose nonce is
// not the one it is holding. That check is the whole defence against somebody
// firing a crafted `repplecoach://...?code=...` at the phone and having the app
// exchange an attacker's code onto the coach's account.
//
// So this value is GUESS-RESISTANCE and nothing else. That makes it different
// in kind from the ids minted in src/ui/scanSheets.ts and src/lib/outbox.ts,
// whose notes say plainly that they are "not a secret and nothing is guarded by
// guessing it — which rows a member may read is decided by RLS". Both of those
// are right to fall back to `Math.random`. This one is not: it was
//
//     Math.random().toString(36).slice(2) + Date.now().toString(36)
//
// at src/ui/adSpend.ts and src/ui/instagram.ts, and `Math.random()` in Hermes
// is a fast non-cryptographic generator whose internal state can be recovered
// from a short run of outputs. The `Date.now()` suffix adds no guess-resistance
// at all — it is the one part an attacker already knows.
//
// ── Why not expo-crypto, which is the obvious answer ──────────────────────
//
// Because this repository has already had that argument and settled it, twice,
// and the reasoning holds here: `expo-crypto` calls `requireNativeModule` at
// MODULE SCOPE, so importing it throws while the importing file is still
// loading on any install made before that dependency shipped — taking the whole
// screen down, not the one feature — and no `if` inside a function runs early
// enough to help. scripts/check-native.mjs refuses that pattern on purpose.
//
// So: the platform's `crypto.getRandomValues` where the runtime has one, which
// is the same door src/ui/scanSheets.ts already opens for `crypto.randomUUID`.
//
// ── And when the runtime has none ─────────────────────────────────────────
//
// It falls back, and it TELLS the caller it fell back, which is the part that
// matters. A silent downgrade to `Math.random` is how a security property
// disappears without anybody choosing to give it up. The caller can then decide
// — today both callers proceed, because a weak nonce is still far better than
// no nonce, and refusing to let a coach connect their ad account on an older
// runtime would be a worse trade. But the decision is theirs and it is visible.

/** How many random bytes a nonce carries. 16 bytes is 128 bits: past any
 *  guessing, and short enough to sit in a URL without comment. */
export const NONCE_BYTES = 16;

export interface Nonce {
  /** The value to put in `state`. Lower-case hex, 2 characters per byte. */
  value: string;
  /** True when it came from the platform's CSPRNG. False means the fallback
   *  below was used and the guess-resistance is weaker than intended. */
  strong: boolean;
}

/**
 * A fresh nonce.
 *
 * `fill` is injected so this can be tested without a runtime that has
 * `crypto` — pass nothing in the app and it finds the platform's. It is called
 * with the array to fill and must fill it in place, exactly as
 * `crypto.getRandomValues` does.
 */
export function authNonce(fill?: (a: Uint8Array) => void): Nonce {
  const bytes = new Uint8Array(NONCE_BYTES);

  const platform = fill
    ?? (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } })
      .crypto?.getRandomValues?.bind(
        (globalThis as { crypto?: unknown }).crypto as object,
      );

  if (platform) {
    try {
      platform(bytes);
      // A generator that returned all zeroes did not run. Vanishingly unlikely
      // from a real CSPRNG (2^-128) and entirely likely from a stub that
      // accepted the call and did nothing, which is the case worth catching.
      if (bytes.some((b) => b !== 0)) return { value: hex(bytes), strong: true };
    } catch { /* fall through to the weak path, which says so */ }
  }

  for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  return { value: hex(bytes), strong: false };
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
