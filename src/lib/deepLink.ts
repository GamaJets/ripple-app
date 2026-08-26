// Links back into whichever of the three apps is running.
//
// Repple used to be one app with one URL scheme, so `repple://…` was written
// out by hand wherever something had to come back — a password reset, a Stripe
// return, a checkout result. Since the split there are three schemes — `repple`,
// `repplecoach` and `repplestudio` — and a hand-written `repple://` sends the
// person to the client app, or nowhere at all if that is the one app they do
// not have installed. A trainer resetting a password from Repple Coach is the
// common case, and it fails silently.
//
// `Linking.createURL` reads the scheme the running binary actually registered,
// so it cannot disagree with app.config.ts the way a second copy of the table
// would.
//
// NOT for third-party OAuth redirects. Spotify, WHOOP and Oura match the
// redirect against a value registered in their dashboards, so it has to stay a
// fixed, known string — see `oauthConfig.ts` and `spotify.ts`, which keep
// `repple://` deliberately. Those features are client-app only, so that scheme
// is the correct one for them.
import * as Linking from 'expo-linking';

/** An absolute URL that reopens THIS app at `path`. */
export function appLink(path: string): string {
  return Linking.createURL(path);
}

/** The public site. The reset flow lands here rather than in an app scheme. */
export const WEB_ORIGIN = 'https://repplefitness.com';

/**
 * Where a password-reset email should send somebody.
 *
 * This is deliberately a WEB url and not `appLink('reset-password')`, and the
 * difference is the whole reason a real reset failed on 26 Aug 2026.
 *
 * A `repple://` link only opens if the mail client hands custom URL schemes to
 * the OS. Plenty do not. Outlook — which every Microsoft 365 mailbox uses, and
 * which is what the gym owner who hit this was reading in — opens links in its
 * own in-app browser and silently refuses a non-http scheme. The person taps
 * "Reset password" and NOTHING HAPPENS: no error, no page, no app. There is
 * nothing they can do about it and nothing tells them why.
 *
 * An https link opens in any browser on any device, including one that does
 * not have the app installed at all — a real case, since somebody may reset on
 * a laptop. The web page at /reset-password.html completes the reset against
 * the same Supabase project, so the outcome is identical.
 *
 * The website already did this and said so in a comment; only the app did not.
 * They are now the same call, which is the point: two paths to one outcome
 * that disagreed about how to get there is how one of them stayed broken
 * without anyone noticing.
 *
 * `.html` is included because the site is static files on Cloudflare Pages and
 * the extensionless form is a redirect — one hop that some in-app browsers
 * also handle badly. It is in the Supabase redirect allow-list via
 * `https://repplefitness.com/**`.
 */
export function resetPasswordUrl(): string {
  return `${WEB_ORIGIN}/reset-password.html`;
}
