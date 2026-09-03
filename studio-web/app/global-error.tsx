'use client';

// The boundary of last resort: an error thrown by the ROOT LAYOUT itself.
//
// `error.tsx` sits inside the layout, so it cannot catch a failure of the thing
// that renders it. This one replaces the whole document — which is why it has to
// supply its own `<html>` and `<body>`, and why it cannot use any of the console's
// custom properties: `globals.css` is imported by the layout that just failed,
// so `var(--ink)` here would resolve to nothing and the page would be black text
// on a black ground, or invisible.
//
// So every colour below is literal. This is the one file in the console where
// that is correct rather than lazy.
//
// The most likely cause is `lib/supabase.ts`, which throws at module import when
// NEXT_PUBLIC_SUPABASE_URL or the anon key is missing — a misconfigured deploy
// rather than anything a user did, and previously a completely blank page.
export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, padding: 40, background: '#0c1413',
        // ink-hex-ok: globals.css is imported by the layout that just failed, so
        // var(--ink) resolves to nothing here and the page would be black on
        // black. This element brings its own ground on the line above, and the
        // pair measures 16.35:1. See the header — this is the one file in the
        // console where a literal is correct rather than lazy.
        color: '#e8f2f0',
        fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: 14, lineHeight: 1.5,
      }}>
        <div style={{ maxWidth: '62ch' }}>
          <h1 style={{ fontSize: 24, fontWeight: 400, margin: 0 }}>The console did not start</h1>
          {/* ink-hex-ok: same reason as the body above — no custom property resolves on this page. 10.79:1 on the ground the body sets. */}
          <p style={{ color: '#b6c9c4', marginTop: 12 }}>
            This is not one screen failing — the whole application failed to load, which almost
            always means it is configured wrongly rather than that anything is wrong with your gym.
            Nothing has been written and no record has been touched.
          </p>
          {/* ink-hex-ok: same reason again. 6.15:1 on the body's ground, which is above AA for text at 12.5px. */}
          <p style={{ color: '#809996', marginTop: 12, fontSize: 12.5 }}>
            {error?.message
              ? <>The reason given was: <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{error.message}</span>.</>
              : 'No reason reached the browser.'}
            {error?.digest
              ? <> Reference <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{error.digest}</span>.</>
              : null}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 18, background: '#e0912f',
              // ink-hex-ok: the button brings its own ground on the line above and
              // no custom property resolves on this page. 6.84:1 on that amber.
              color: '#2a1503', border: 'none',
              padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
