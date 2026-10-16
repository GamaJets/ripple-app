// Crash and error monitoring through Sentry — OFF until a DSN is provided.
//
// The DSN is public by design (it only lets an app SEND events), and it comes
// from `EXPO_PUBLIC_SENTRY_DSN`: set it in the build profile's env or as an EAS
// environment variable. With no DSN this module does nothing at all — Sentry is
// never initialised, nothing is captured, nothing leaves the phone — so the
// app behaves exactly as it did before the dependency arrived.
//
// It sits BESIDE `app_errors` (src/lib/reportError.ts), not instead of it: the
// owner reads app_errors in Studio; Sentry is the engineer's view, with native
// crashes, symbolicated stacks and release health that a table cannot give.
//
// Privacy: no default PII (no IP, no cookies, no request bodies), no session
// replay, and a user is identified by their opaque id only, never email/name.
import type React from 'react';
import type * as SentryNS from '@sentry/react-native';
import { VARIANT } from './variant';

/** The DSN, or '' when none is configured. Read once, at bundle time. */
export const SENTRY_DSN: string = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();

let started = false;
// Loaded lazily, and only once a DSN is known: with no DSN the SDK is never
// even required, and the node test runner (which imports reportError, and so
// this file) never touches a react-native module.
let Sentry: typeof SentryNS | null = null;

/** Whether Sentry is live in this build (a DSN was provided and init ran). */
export function sentryEnabled(): boolean {
  return started;
}

function releaseInfo(): { release?: string; dist?: string; environment: string } {
  let version = 'unknown';
  let channel = 'development';
  try {
    const C = require('expo-constants').default;
    version = C?.expoConfig?.version ?? version;
  } catch { /* not available */ }
  try {
    const U = require('expo-updates');
    channel = U?.channel || channel;
  } catch { /* not available */ }
  return { release: `repple-${VARIANT}@${version}`, environment: channel };
}

/** Initialise Sentry if, and only if, a DSN is configured. Safe to call twice. */
export function initSentry(): void {
  if (started || !SENTRY_DSN) return;
  try {
    Sentry = require('@sentry/react-native') as typeof SentryNS;
    const r = releaseInfo();
    Sentry.init({
      dsn: SENTRY_DSN,
      release: r.release,
      environment: r.environment,
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      enableAutoSessionTracking: true,
      attachStacktrace: true,
    });
    Sentry.setTag('app_variant', VARIANT);
    started = true;
  } catch {
    // Monitoring must never be the thing that breaks the app.
    started = false;
    Sentry = null;
  }
}

/** Forward a caught error. A no-op when Sentry is off. Never throws. */
export function captureToSentry(err: unknown, context?: string, extra?: Record<string, unknown>): void {
  const S = Sentry;
  if (!started || !S) return;
  try {
    S.withScope((scope) => {
      if (context) scope.setTag('context', context);
      if (extra) scope.setExtras(extra);
      if (err instanceof Error) S.captureException(err);
      else S.captureMessage(context ? `[${context}] ${String(err)}` : String(err), 'error');
    });
  } catch { /* never throws */ }
}

/** Attach (or clear) the signed-in user's opaque id. A no-op when off. */
export function setSentryUser(id: string | null): void {
  if (!started || !Sentry) return;
  try { Sentry.setUser(id ? { id } : null); } catch { /* never throws */ }
}

/** Wrap the root component when Sentry is on; the component itself when off. */
export function withSentry(C: React.ComponentType<Record<string, unknown>>): React.ComponentType<Record<string, unknown>> {
  return started && Sentry ? Sentry.wrap(C) : C;
}
