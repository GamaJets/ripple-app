# Two files that make a coach's link open the app

`repplefitness.com/join?c=CODE` is what a coach puts in an Instagram bio. Without
these files it can only ever open Safari, where somebody has to memorise six
characters, visit the App Store, and type them in — and whoever forgets them
joins attributed to nothing at all.

Both files claim **only `/join`**, and only for the CLIENT app. Password reset
and email confirmation are shared by all three apps; if all three claimed those
paths the OS would hand the link to whichever it liked, and a coach resetting
their password could land in the client app. Joining is something only a client
does, so `/join` has exactly one honest owner.

## Both files currently contain a placeholder and will NOT verify

That is deliberate and it is safe: a file that fails verification means the link
opens the browser, which is exactly what happens today. It does not break
anything. It just does not work yet.

### `apple-app-site-association`

Replace `REPLACE_WITH_APPLE_TEAM_ID` with the Apple Developer **Team ID** —
ten characters, at <https://developer.apple.com/account> under Membership.
The value becomes `TEAMID.com.washateria.repple`.

Notes that bite:
- The file has **no `.json` extension**. Do not add one.
- It must be served as `application/json` — see `web/_headers`.
- It must be reachable at `https://repplefitness.com/.well-known/apple-app-site-association`
  over HTTPS with no redirect. A redirect fails verification.
- iOS caches it. After changing it, delete and reinstall the app to re-check.

### `assetlinks.json`

Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` with the SHA-256 fingerprint of
the certificate the app is **actually signed with**. Under Play App Signing that
is **Google's** signing certificate, not the upload key:

> Play Console → your app → Test and release → **App integrity** → App signing →
> SHA-256 certificate fingerprint

Format is uppercase hex with colons, e.g. `AB:CD:12:…`. Take the app-signing
one; taking the upload key's is the usual mistake and verifies against nothing.

If you also want links to open the app on internal/preview APKs, that build is
signed with a different key — add its fingerprint to the same array.

## Checking it worked

    curl -sI https://repplefitness.com/.well-known/apple-app-site-association | grep -i content-type
    curl -s  https://repplefitness.com/.well-known/assetlinks.json

Android will also tell you directly, on a device with the app installed:

    adb shell pm get-app-links com.washateria.repple
