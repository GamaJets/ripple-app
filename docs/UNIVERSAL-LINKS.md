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

## assetlinks.json still contains a placeholder and will NOT verify

That is deliberate and it is safe: a file that fails verification means the link
opens the browser, which is exactly what happens today. It does not break
anything. It just does not work yet.

### `apple-app-site-association`

**Done.** The Team ID is `GR7PT3S232` (Washateria LLC, enrolled as an
Organization), so the appID reads `GR7PT3S232.com.washateria.repple`.

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

> Play Console → your app → Test and release → **Protected with Play** →
> app signing → SHA-256 certificate fingerprint

(Google moved this: the old **App integrity** page now just redirects here.)

Play Console can also hand you this whole file already filled in — look for the
Digital Asset Links / deep-links section, which generates the JSON for the app's
signing key. If you use that, keep the `paths`/relation shape below rather than
pasting theirs wholesale, so it stays scoped to what we intend.

Format is uppercase hex with colons, e.g. `AB:CD:12:…`. Take the app-signing
one; taking the upload key's is the usual mistake and verifies against nothing.

If you also want links to open the app on internal/preview APKs, that build is
signed with a different key — add its fingerprint to the same array.

## Checking it worked

    curl -sI https://repplefitness.com/.well-known/apple-app-site-association | grep -i content-type
    curl -s  https://repplefitness.com/.well-known/assetlinks.json

Android will also tell you directly, on a device with the app installed:

    adb shell pm get-app-links com.washateria.repple

## Fingerprints on record

Three Play listings, three signing certificates. Only the CLIENT app's belongs
in `assetlinks.json` today, because `/join` is scoped to the client app.

| App | Package | SHA-256 (Play app signing) |
| --- | --- | --- |
| Repple (client) | `com.washateria.repple` | **still needed** — this is the one `/join` requires |
| Repple Coach | `com.washateria.repple.coach` | `E6:A1:5C:00:C9:36:7A:99:B2:DD:15:25:72:1F:38:5E:B0:E1:AC:C9:8C:89:B5:31:F8:BB:6C:09:93:CD:8C:DE` |
| Repple Studio | `com.washateria.repple.studio` | `96:90:E2:2D:D3:B1:25:88:6C:C4:BE:CE:F8:EB:2C:B6:D8:4F:C7:EA:38:4E:AD:2C:D9:CE:33:CD:2A:9D:DF:2F` |

The coach one is kept for later, not used now. It becomes relevant only if the
coach app is ever given app links of its own — password reset being the obvious
candidate, which today all three apps share and none of them claims, precisely
so the OS never has to guess between them.

