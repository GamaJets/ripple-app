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
