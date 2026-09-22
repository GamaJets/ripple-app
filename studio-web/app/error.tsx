'use client';

// What a screen does when it throws.
//
// ── Why this file has to exist ─────────────────────────────────────────────
//
// There was no `error.tsx`, `loading.tsx` or `not-found.tsx` anywhere under
// `studio-web/app`, so an exception in any of the twenty-two routes fell
// through to Next's own default: a blank page in production, with no message,
// no way back and nothing to tell the owner whether the gym's data is gone or
// the browser tripped over a null.
//
// That matters more here than in most apps because of what this console is
// built to avoid. Every screen in it distinguishes "we could not read" from
// "there is none", at length, in the copy — and then a single unhandled throw
// replaced all of that with white. The distinction has to survive the failure,
// not only the successes.
//
// `lib/supabase.ts` throws at module import when the environment variables are
// missing, which is the most likely thing to land here on a fresh deploy.
import { useEffect } from 'react';

export default function ConsoleError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The console is the only place the detail survives. Next strips the message
  // from a production error before it reaches the browser and leaves a
  // `digest`, which is the string a server log can be searched for — so both
  // are printed rather than one.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[studio] route error', error?.digest ?? '(no digest)', error);
  }, [error]);

  return (
    /* A live region, because this swaps in CLIENT-SIDE. There is no
       document navigation, so focus does not move and nothing is read: the
       page a person was working on is replaced by an error they are never
       told about. components/Gate.tsx does the same for its unreachable
       state and is the pattern this was missing. */
    <div role="alert" aria-live="assertive" aria-atomic="true" style={{ padding: 40, maxWidth: '62ch' }}>
      <h1>This screen stopped</h1>
      {/* ── what this boundary is entitled to say ────────────────────────
          This paragraph read "Nothing has been written and nothing has been
          lost", in bold, as the one confident sentence on the page. Neither
          half of it was established by anything.

          A React error boundary catches a throw during RENDER. It is told
          nothing about what the screen was doing beforehand, so a page that
          wrote a row, called setState and then threw on the next render
          arrives here indistinguishable from one that touched nothing — and
          this sentence then tells an owner their save did not happen. The
          console's own rule is that a correction is a second recorded fact:
          an owner who believes nothing was written saves again, and the
          second fact is a duplicate row.

          "Nothing has been lost" is false in the ordinary case rather than
          the rare one. Everything typed into the screen and not yet saved
          goes with it, every time.

          What the boundary DOES know is the half that is worth saying: it
          stands in front of the screen and not in front of the database, so
          nothing already recorded is touched by a failure to draw. */}
      <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
        Something on this page threw an error, so it is showing nothing rather than showing you
        half of it. This is a failure to draw the screen, not a failure of the record:{' '}
        <strong style={{ color: 'var(--ink)' }}>anything already saved is still saved</strong>.
        What this cannot tell you is whether something you saved a moment ago landed — it knows
        nothing about what the page was doing when it stopped — so open the screen again and look
        before you save it a second time. Anything typed in and not yet saved has gone with the page.
      </p>
      <p style={{ color: 'var(--ink3)', marginTop: 10, fontSize: 12.5 }}>
        {/* Named where it can be: `digest` is what a server log can be searched
            for, and an owner reporting a fault with it attached saves an hour. */}
        {error?.message
          ? <>The reason given was: <span className="mono">{error.message}</span>.</>
          : 'No reason was given, which usually means the error happened on the server and was stripped before it reached this browser.'}
        {error?.digest ? <> Reference <span className="mono">{error.digest}</span>.</> : null}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button
          onClick={reset}
          style={{
            background: 'var(--brand)', color: 'var(--brand-ink)', border: '1px solid transparent',
            borderRadius: 0, padding: '9px 14px', fontSize: 13.5, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--sans)',
          }}
        >
          Try this screen again
        </button>
        <a
          href="/"
          style={{
            background: 'var(--surface2)', color: 'var(--ink2)', border: '1px solid var(--ring)',
            borderRadius: 0, padding: '9px 14px', fontSize: 13.5, textDecoration: 'none',
          }}
        >
          Back to the Overview
        </a>
      </div>
    </div>
  );
}
