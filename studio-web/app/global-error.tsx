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
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // `error.tsx` has logged the cause since it was written; this file, which
  // catches the STRICTLY WORSE failure, logged nothing at all. The boundary of
  // last resort was the one that swallowed the error — so the whole document
  // failing left no trace anywhere a developer console, a session recording or
  // a log collector could find it, and the only copy of the reason was the
  // sentence below, on a screen somebody was about to close.
  //
  // Same shape and same prefix as `error.tsx` deliberately: one string to
  // search for, whichever of the two boundaries caught it.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[studio] root error', error?.digest ?? '(no digest)', error);
  }, [error]);

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
        {/* Announced, for the same reason `error.tsx` is: this boundary can
            swap in client-side, with no document navigation to move focus, so
            without a live region the screen a person was working on is
            replaced by an error nothing reads out. */}
        <div role="alert" aria-live="assertive" aria-atomic="true" style={{ maxWidth: '62ch' }}>
          <h1 style={{ fontSize: 24, fontWeight: 400, margin: 0 }}>The console did not start</h1>
          {/* ink-hex-ok: same reason as the body above — no custom property resolves on this page. 10.79:1 on the ground the body sets. */}
          <p style={{ color: '#b6c9c4', marginTop: 12 }}>
            This is not one screen failing — the whole application failed to load, which almost
            always means it is configured wrongly rather than that anything is wrong with your gym.
            {/* Scoped to what this boundary can actually see. It said "Nothing
                has been written and no record has been touched" flatly, and
                that is a claim about the database made by a component that has
                only ever been handed an exception. What it does know is that
                the failure is in the shell every screen is drawn inside, so no
                screen got as far as running — it says nothing about a save
                made before this appeared. See the same repair in error.tsx. */}
            {' '}The failure is in the shell every screen is drawn inside, so nothing here got as
            far as asking your gym&rsquo;s records for anything.
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
          {/* `reset` re-renders the same tree. For the cause named in the
              header — a missing environment variable, which throws at module
              IMPORT — it throws again on the spot and the screen does not
              change, which reads as a dead button rather than as an answer.
              Saying so turns a press that appears to do nothing into a fact
              worth passing on. ink-hex-ok: same reason as the paragraphs
              above, and the same measured 6.15:1 pair. */}
          <p style={{ color: '#809996', marginTop: 12, fontSize: 12.5 }}>
            If pressing that changes nothing, the fault is in how this console is deployed rather
            than in your browser, and reloading will not clear it — send whoever deployed it the
            reason above.
          </p>
        </div>
      </body>
    </html>
  );
}
