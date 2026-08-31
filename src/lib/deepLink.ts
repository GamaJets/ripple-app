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
import { BRAND } from './brands';

/** An absolute URL that reopens THIS app at `path`. */
export function appLink(path: string): string {
  return Linking.createURL(path);
}

/** The public site. The reset flow lands here rather than in an app scheme.
 *
 *  Comes from the brand registry now rather than being a literal. It was
 *  sending every brand's password-reset email to Repple's website — which for
 *  a white-labelled chain means their locked-out member lands on their
 *  supplier's site to get back in. For Repple itself this resolves to exactly
 *  the string it always was. */
export const WEB_ORIGIN = BRAND.webOrigin;

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
 * No `.html`. An earlier version of this comment claimed the extensionless
 * form was the redirect and the `.html` form was direct. That is inverted, and
 * measuring it settles it — Cloudflare Pages answers:
 *
 *     GET /reset-password.html   308 → /reset-password
 *     GET /reset-password        200
 *
 * so `.html` was buying the very hop it was written to avoid. It matters more
 * here than a redirect usually does: Supabase returns the recovery tokens in
 * the URL FRAGMENT, and carrying a fragment across a redirect is a browser
 * convention rather than a rule. The webviews inside mail clients are exactly
 * where conventions are not kept, and a dropped fragment looks to the person
 * like a reset page that opened and did nothing.
 *
 * Both forms are in the Supabase redirect allow-list — probed against
 * /auth/v1/verify, which echoed each back rather than falling through to the
 * site URL — so this is safe to change. The website sends the same string.
 */
export function resetPasswordUrl(): string {
  return `${WEB_ORIGIN}/reset-password`;
}
