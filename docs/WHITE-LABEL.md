# Shipping a brand

Repple is white-labelled by **shipping each brand its own apps** — separate store
listings, separate bundle ids, separate icons, separate domain. A gym chain gets
*their* app under *their* name. It is not a theme toggle inside one binary, and
the difference matters: a member searching the App Store for their gym has to
find their gym.

There are two axes and an app is a point on both.

| | |
| --- | --- |
| **VARIANT** — `EXPO_PUBLIC_APP_VARIANT` | `client` \| `trainer` \| `owner`. Which of the three products this binary is. Predates brands; see `src/lib/variant.ts`. |
| **BRAND** — `EXPO_PUBLIC_BRAND` | Whose name is on it. Unset means `repple`. |

Brand × variant = one app = one store listing. **A brand is therefore three
apps, not one.** Every count below multiplies by three.

## The one rule that cannot be broken

**Repple is a brand — the default one — and its resolved identity must never
change.** `com.washateria.repple`, `com.washateria.repple.coach` and
`com.washateria.repple.studio` are live in two stores. A bundle id is permanent:
change one and you have not updated an app, you have orphaned it and published a
new one with no users, no reviews and no history.

So Repple's values are written out longhand in `src/lib/brands.ts:160-178`,
transcribed from `app.config.ts` as it stood before the brand axis, and derived
from nothing. Do not tidy them, do not template them, do not "simplify" the
`repple` entry into a base the other brands extend. None of the existing
profiles in `eas.json` sets `EXPO_PUBLIC_BRAND`; do not add it to them.

Proof that the axis was additive, at the time it was added: `app.config.ts` was
evaluated for all nine existing build profiles plus a bare `expo start`, before
and after, and every resolved `name`, `scheme`, `icon`, `bundleIdentifier`,
`package`, `adaptiveIcon`, `associatedDomains`, `intentFilters` and
`googleServicesFile` compared byte-identical. That comparison is worth repeating
before any change to `brands.ts` or `app.config.ts` lands.

---

# What shipping a new brand actually requires

## 1. The registry entry — `src/lib/brands.ts`

One key in `BRANDS`. `example` at `src/lib/brands.ts:192-205` is a worked
example built entirely from IANA's reserved `example.com` and `com.example`, so
nothing in it can collide with a real registered identifier. It deliberately
does **not** build — the icon paths point at `assets/brands/example/`, which
does not exist.

Per brand you must decide:

- **`apps[variant].bundle`** — permanent, once. The chain may want it in their
  own reverse-DNS namespace (`com.theirgym.app`), which also determines who owns
  the Apple/Google records. Decide this before the first submission, never after.
- **`apps[variant].scheme`** — must be globally unique-ish on a device. Two
  installed apps claiming one scheme is undefined behaviour, and the loser is
  whichever the OS feels like. Prefix with the brand.
- **`apps[variant].name`** — App Store display names are max 30 characters and
  must be unique across the whole store.
- **`apps[variant].tile`** — the plate behind the icon; the only difference
  visible between three apps at 60 points.
- **`joinOrigin`** and **`linkHosts`** — the brand's own domain (§4).
- **`supportEmail`** — added 1 Sep 2026. The address a member is told to write
  to when their own data export came back short, when a send failed, when the
  deletion did not happen. Stated rather than derived from `webOrigin`, because
  `support@` on the marketing domain is a mailbox somebody has to actually
  create and a derived address that bounces is worse than the wrong brand on a
  working one. Read by `src/lib/gdpr.ts` and by `web/join.html` (§4).
- **`androidGoogleServices`** — the brand's own Firebase file (§5).

`brands.ts` is loaded by **both** `app.config.ts` (in Node, at build time) and
the app bundle (via `joinCode.ts`). That is deliberate — one table, no drift —
but it constrains the file: it must stay inside what Node's type stripping can
erase. **No `enum`, no namespaces, no parameter properties**, and type-only
imports written `import type`. The import in `app.config.ts:39` carries an
explicit `.ts` extension for the same reason. Breaking either breaks
`eas build`, not `tsc`, so a green typecheck proves nothing here — resolve the
config for real.

## 2. The icons

Three PNGs per brand plus an adaptive-icon foreground, under
`assets/brands/<brand>/`. There is **no default and there must not be one**:
a build that silently fell back to Repple's ripple would reach the store looking
finished. Repple's own sources are `assets/repple-icon-*.svg`.

Not covered by the registry and still per-brand:

- `app.json:20-24` — the iOS permission strings say "Repple" by name
  (`NSHealthShareUsageDescription`, `NSCameraUsageDescription`,
  `NSPhotoLibraryUsageDescription`, `NSHealthUpdateUsageDescription`), as do
  `app.json:52-53` (react-native-health) and `app.json:65` (Face ID). Apple
  shows these verbatim in the permission dialog, so a member of another chain is
  told an app they have never heard of wants their heart rate.
- `app.json:59` — the `expo-notifications` plugin `"color": "#16b8a6"`, the
  Repple client teal, applied to every variant of every brand.
- `app.json:9-13` — the splash image and its `#0f172a` ground.

These are plugin arguments and static `infoPlist` values, not fields
`app.config.ts` layers, so making them per-brand means restructuring how they
are supplied. Left alone deliberately; flagged here because a brand shipped
without addressing them is wearing Repple's words in Apple's own dialogs.

## 3. The EAS profiles — `eas.json`

Three per brand, one per variant, named `<stage>-<brand>[-<variant>]`, each
setting **both** `EXPO_PUBLIC_APP_VARIANT` and `EXPO_PUBLIC_BRAND`. See
`production-example`, `production-example-coach`, `production-example-owner`.
`EXPO_PUBLIC_BRAND` must carry the `EXPO_PUBLIC_` prefix: `joinCode.ts` reads it
at runtime, and Metro only inlines variables with that prefix.

**eas.json does not scale on this axis and you should expect to feel it.** Each
profile repeats the same seven env vars; nine profiles became twelve with one
example brand, and every real brand adds three more. The Supabase URL, anon key
and the Spotify/Oura/WHOOP client ids are copy-pasted into every one of them, so
a rotated key is a twelve-line edit today and a thirty-line edit at brand five.
JSON has no comments and eas-cli validates every profile against a schema, so
there is nowhere in the file to say any of this — which is why it is said here.

`submit` needs a block per brand per variant with that listing's own `ascAppId`
(compare `eas.json:212`, `:220`, `:228`). Getting this wrong is not theoretical:
`docs/LAUNCH-CHECKLIST.md:253` records three builds all landing on Repple Studio
because the submitter's `ascAppId` decided the destination, not the binary.

Also hardcoded to Repple's three apps and needing a brand axis before they can
be used for anything else:

- `scripts/submit.mjs:36-38` — a literal map of profile → bundle id → name.
- `scripts/release-notes.mjs:19` — `{ client: 'Repple', trainer: 'Repple Coach', owner: 'Repple Studio' }`.

## 4. The domain and the association files

Each brand needs **its own domain**, and everything in `docs/UNIVERSAL-LINKS.md`
applies once per brand.

- **AASA** — `web/.well-known/apple-app-site-association:5` names exactly one
  appID, `GR7PT3S232.com.washateria.repple`. A second brand does not add a
  second entry to this file; it needs its **own file on its own domain**,
  because the file must be served from the host the link is on. If the brand
  uses their own Apple Developer account the Team ID prefix differs too.
- **assetlinks** — `web/.well-known/assetlinks.json:6` names exactly one
  package, `com.washateria.repple`, with Repple's own Play App Signing
  fingerprint at `:7`. Same story: one file per domain, and the fingerprint must
  be **Google's** Play App Signing certificate for that brand's listing, not the
  upload key — see `docs/UNIVERSAL-LINKS.md:35-45`. Every brand's signing
  certificate is different, so there is nothing here a brand can inherit.
- **Content type** — `web/_headers` forces `application/json` on the
  extensionless AASA. A brand hosting elsewhere must reproduce that; Apple
  refuses the file otherwise.
- **`app.config.ts:86` and `:109`** now derive `associatedDomains` and the
  Android `intentFilters` from `brand.linkHosts`, apex and www in that order, so
  the app side is done once the files exist.

Failure here is soft and that is the point: an unverified association file means
the link opens the browser, which is what happens today.

### `web/` is one site for one brand, with one page that is now an exception

`web/` is Repple's marketing site, hardcoded end to end. This is still the
largest un-generalised thing in the repo. One page has been taken out of it,
because that page is the top of a coach's funnel and being wrong there is
worse than being wrong anywhere else on the site.

- `.github/workflows/deploy-web.yml:91` — `pages deploy web --project-name=repple`,
  one Cloudflare Pages project. `:45` names the job `web → repplefitness.com`.
  Note **one PROJECT, not necessarily one domain**: Cloudflare Pages will serve
  as many custom domains from one project as you point at it, which is what the
  join page below now relies on.
- **`web/join.html` — brand-aware since 1 Sep 2026.** The page a coach's link
  actually lands on used to carry Repple's App Store id, Repple's Play package,
  `repple://join`, Repple's support address and Repple's name in nine places,
  so a second brand's coach sending a link to their own domain landed members
  on a page offering the wrong app. It now resolves a brand and rewrites itself
  from a JSON table embedded in the page.

  **Host first, `?b=<id>` as an override, default brand as the fallback.** The
  host is the honest signal: the link was composed from that brand's own
  `joinOrigin`, so the domain the reader arrived on IS the brand. `?b=` exists
  so a brand's page can be opened before its DNS is pointed anywhere, and it
  selects between table entries and nothing else.

  **There is deliberately no build step.** Nothing transforms `web/` on its way
  to Pages, and a generator that only one file used would be a step nobody
  runs. The cost is a duplicated table, which is exactly what `brands.ts` warns
  against — so `src/lib/joinPage.test.ts` parses the block out of the HTML and
  fails if any field disagrees with `BRANDS`, and also holds the page's own
  no-JS markup to the default brand's row.

  **Two honest gaps.** With scripting off, a second brand's host renders
  Repple's words; that is the price of no build step. And `appleAppId` has
  nowhere to live in the registry — Apple mints it when the listing is created
  — so it is stated per brand on the page and nothing can check it. A brand
  with no listing sets it null and the App Store badge is removed rather than
  pointing at somebody else's app.

- `web/connect-return.html` and `web/connect-refresh.html` — added 1 Sep 2026
  because Stripe refuses a non-HTTPS `return_url` in live mode (§7). The app
  builds both from `BRAND.webOrigin`, so the ADDRESS is per brand, but the two
  pages themselves still say "Repple Coach" and link `repplecoach://`. Same
  fix as the join page and not yet applied to them.
- Every other `<title>`, store badge and `support@repplefitness.com` in
  `web/*.html` is still Repple's.
- `web/robots.txt:14` and every `<loc>` in `web/sitemap.xml` are absolute
  `https://www.repplefitness.com/…`.
- `web/styles.css:39-47` — `--brand`, `--client`, `--coach`, `--studio`.

**The deployment decision is still open and is the owner's.** Adding a brand's
domain to the existing `repple` Pages project is a dashboard action and makes
the join page work as built. A second Pages project per brand is the other
answer and needs the parameterised copy this repo does not have. Nothing in
the code chooses between them; the join page works either way, and the rest of
`web/` works under neither.

## 5. Push notifications

- **Android will fail the build, not degrade.** `app.json:38` points at a single
  `./google-services.json` whose package list is exactly Repple's three. The
  Google Services Gradle plugin errors when the package being built is absent
  from the file. So a brand needs its own Firebase project and its own file —
  `Brand.androidGoogleServices` supplies it and `app.config.ts:118-120` layers it;
  Repple leaves it `null` so `app.json` is untouched.
- **iOS/Expo push is tied to one account.** There is no
  `GoogleService-Info.plist`; push goes through Expo's service, keyed to the
  Expo owner `repple` (`app.json:83`) and project
  `7d4ca6bf-2f1c-4b87-94f4-9b6bdd008aad` (`app.json:75`, and the updates URL at
  `:88`). `src/ui/pushNotifications.ts:60` calls `getExpoPushTokenAsync()` with
  no `projectId`, so it resolves that one. A brand wanting its own Apple team
  and its own APNs key needs its own EAS project, which means its own `slug`,
  `owner`, `projectId` and `updates.url` — **none of which the registry models
  today.** Decide this before the first brand, because EAS credentials are keyed
  per project.
- `supabase/functions/send-push/index.ts:24` — `title = String(b.title || 'Repple')`.
  A brand's members get a push notification titled "Repple" whenever a caller
  omits a title, from a server the client cannot see.
- `push_tokens` (`supabase/parts/15-push-tokens.sql`) has no brand or tenant
  column, so nothing server-side can tell which brand's app a token belongs to.

## 6. Deep link schemes still written by hand

`src/lib/deepLink.ts` solved this for the variant axis — `appLink()` uses
`Linking.createURL`, which reads the scheme the running binary registered and
therefore cannot disagree with `app.config.ts`. Four categories escaped it, and
all four send a non-Repple brand's users into **Repple's client app, or
nowhere**:

- `src/lib/spotify.ts` — `SPOTIFY_REDIRECT` — **done.**
- `src/lib/wearables/oauthConfig.ts` — `OAUTH_REDIRECT` — **done.**

  Both were the literal `repple://…`. Both now compose the scheme from
  `BRAND.apps.client.scheme`, which resolves to `repple` whenever
  `EXPO_PUBLIC_BRAND` is unset, so both strings are byte-identical for every
  build that exists today and no registered redirect URI moves. They stay
  build-time constants rather than `appLink()` calls, which is correct *for the
  variant axis* (`deepLink.ts` explains: the vendor matches the redirect against
  a dashboard value, so it must be knowable before the app runs) — they are
  client-app features, so the client variant's scheme is named explicitly.

  **The app half only.** A new brand still means **registering new redirect URIs
  in the Spotify, Oura and WHOOP dashboards per brand**, and possibly separate
  developer apps and client ids — see checklist step 10. `eas.json` supplies the
  client ids per profile already. What changed is that the app now asks for the
  right address; only the vendor can agree to it.

- **Stripe Connect onboarding — done, 1 Sep 2026.** `src/lib/connect.ts:92`
  now sends `${WEB_ORIGIN}/connect-refresh` and `${WEB_ORIGIN}/connect-return`
  with every `connect-onboard` call, so a chain's coach setting up payouts is
  returned to their own domain. This was forced rather than chosen: Stripe
  allows only HTTPS return URLs in live mode and the app had been sending
  `repplecoach://connect/return`, which would have failed on the first real
  coach. The literals left in `connect-onboard/index.ts:148-149` are now
  brand-less https fallbacks for a caller that sends neither, not the path any
  app takes.

- Stripe returns that are still `repple://`, all defaults inside edge functions
  the app can override only by passing an explicit URL:
  `supabase/functions/stripe-portal/index.ts:43` `repple://billing`;
  `supabase/functions/stripe-checkout/index.ts:21-22`;
  `supabase/functions/connect-checkout/index.ts:205`, `:274-275`.
  A brand's member returning from Checkout is sent to an app they do not have
  installed. Same shape as the onboarding fix and not yet done.

- `src/lib/deepLink.ts:43` — **done.** `WEB_ORIGIN` is now `BRAND.webOrigin`,
  so `resetPasswordUrl()` at `:87` sends a brand's users to their own site.
  Repple's `webOrigin` is the apex with no `www`, transcribed character for
  character from the literal this line used to hold, so no reset URL moved.
  The `www` asymmetry with `joinCode.ts` is preserved on purpose and is stated
  in `brands.ts`.

- `src/lib/ics.ts` — **done.** Calendar UIDs were minted at `@repple.app`, a
  domain that appears nowhere else in this repo and that nothing here owns; the
  `PRODID` and the default `calName` were the literal `Repple`. All three now
  come from the brand — the UID host from `BRAND.webOrigin`, the other two from
  `BRAND.label`. Not cosmetic: an .ics file outlives the app on the phone and
  gets forwarded, and RFC 5545 asks for a UID domain the generator actually
  holds. Note this changes Repple's own UIDs from `@repple.app` to
  `@repplefitness.com`, so a session exported before and after imports twice.

  Two callers still pass a literal: `app/(trainer)/calendar.tsx` passes
  `'Repple — Coaching schedule'` and `app/(client)/bookings.tsx` passes the
  device-local app name. Those are §11 strings, not this file's.

## 7. Stripe

Better than expected: **no publishable key, price id or account id is hardcoded
anywhere.** `src/lib/billing.ts:14-18` reads price ids from env; every edge
function reads `STRIPE_SECRET_KEY` from `Deno.env`. What does not generalise is
structural:

- One Supabase project means **one `STRIPE_SECRET_KEY`, i.e. one Stripe platform
  account, for all brands.** The *platform* is single, and a chain that wants to
  be the platform needs its own Supabase project, which is a fork of the
  deployment and not a config flag.

  **What changed on 1 Sep 2026 is who the merchant is.** New coaches are
  onboarded onto Stripe **Standard** accounts taking **direct charges**, so the
  charge is created on the coach's own account: they are the merchant of
  record, the sale appears on the member's statement under the COACH's name,
  and the dispute, the refund and the negative balance are theirs. That is a
  materially better white-label story than the one this section used to
  describe, and it arrived for a liability reason rather than a branding one —
  Stripe's account-type table puts losses on the platform for Express under
  every charge type. Existing Express coaches are unchanged and cannot be
  converted, so both models are live at once; `src/lib/directCharges.ts` is
  where that is decided and `docs/LAUNCH-CHECKLIST.md` §11 is the story.

  Subscriptions to Repple's own plans are a different flow and still settle to
  the platform, so a chain's OWNER still pays Washateria LLC and sees it.
- The plan names `Starter` / `Pro` / `Studio` (`billing.ts:15-17`) mirror the
  `tenants.plan` CHECK constraint at `supabase/parts/01-schema.sql:16` and are
  Repple's commercial packaging, presented to every brand's owners.
- `app/(trainer)/billing.tsx:143` and `app/(client)/packages.tsx:295` both tell
  the user "Repple never sees or stores your card details."

## 8. The `tenants` table — how does a brand map to a tenant?

**It does not, and this is the deepest structural gap.** The schema comment at
`supabase/parts/01-schema.sql:10` already says "one row per trainer's
white-label brand", which is a different and much smaller idea of white-label
than shipping apps.

```sql
-- supabase/parts/01-schema.sql:11-19
create table if not exists tenants (
  id uuid primary key …, name text not null, logo text,
  brand_color text default '#2dd4bf',   -- Repple teal, as every tenant's default
  plan text …, session_fee numeric …, created_at timestamptz …
);
```

- **There is no brand column and no parent-brand FK.** Nothing in the database
  records which brand's app a row belongs to.
- **Every signup silently creates its own tenant.**
  `supabase/parts/06-account-provisioning.sql:33` (and the backfill at `:15`)
  fires on new profile and inserts `<Full Name>'s space`. The trigger cannot
  know which app the user came from — the client never tells it. So `tenants`
  conflates "a gym" with "one person's private workspace", and a member who
  installs Brand A's app is provisioned into a tenant with no relationship to
  Brand A at all.
- **Nothing stops cross-brand sign-in.** `src/ui/tenant.tsx:137` resolves the
  tenant purely from the signed-in user's `profiles.tenant_id`. A Brand A
  account signing into Brand B's app gets Brand A's tenant, with no check that
  the tenant matches the build. Today this is invisible because there is one
  brand.
- **`tenants.logo` (`01-schema.sql:14`) is dead.** Nothing in `src/`, `app/` or
  `studio-web/` reads or writes it. There is no logo pipeline; the icon is a
  build-time PNG path.
- **`tenants.brand_color` is read but overridden.** `src/ui/tenant.tsx:143` maps
  it to `Tenant.brandColor` and `:161` can write it, but the accent the UI
  actually renders comes from `repple.accent.v2` in AsyncStorage
  (`src/ui/components.tsx:28`), a per-device value. A gym owner's chosen colour
  is not what their members see.
- **`src/ui/brand.tsx:17,21`** persists the app name to the AsyncStorage key
  `repple.appName`, defaulting to `VARIANT_LABEL[VARIANT]`. It is device-local:
  it does not come from `tenants.name`, does not survive a reinstall and does
  not reach a second device. `app/(owner)/brand.tsx:86` resets it to `'Repple'`.

The honest summary: **the build-time brand axis this document describes and the
runtime tenant model do not meet anywhere.** Which brand's binary you are
holding is a compile-time constant; which gym you belong to is a database row;
nothing joins them. Deciding whether a brand *is* a tenant, *owns* tenants, or
is orthogonal to them is the next real design question, and it is a schema
change plus a signup change, not a config change.

## 9. Store accounts and store review

`docs/LAUNCH-CHECKLIST.md:379-444` is the current review-account section, and
its central point extends to brands with force. Today:

| App | Account | Role |
| --- | --- | --- |
| Repple (`com.washateria.repple`) | `flyguy2006@gmail.com` | client |
| Repple Coach (`com.washateria.repple.coach`) | `washareria.stl@gmail.com` | trainer |
| Repple Studio (`com.washateria.repple.studio`) | `timothy@passionjet.com` | owner |

Three accounts, "**NOT interchangeable**", because the apps route by build but
the data is gated by role — a reviewer handed the wrong one sees an app that
looks broken and reports it as broken.

**With brands this becomes 3 × N accounts and gains a second way to be wrong.**
A Brand A client account signed into Brand B's client app authenticates fine
(one Supabase project, one auth table) and resolves to Brand A's tenant, because
nothing checks the tenant against the build (§8). The reviewer sees another
gym's data or an empty shell. Each brand needs three real accounts, seeded with
that brand's own data, and `email_confirmed_at` already set.

Also per brand:

- **Apple Developer account / Team ID.** If the chain enrols their own — which
  is usually what they want, since they own the listing and the payouts — the
  AASA appID prefix changes, App Store Connect users change, and EAS needs
  credentials for that team. `docs/UNIVERSAL-LINKS.md:22` records Repple's as
  `GR7PT3S232` (Washateria LLC).
- **Google Play developer account**, its own Play App Signing certificate, and
  therefore its own SHA-256 for assetlinks.
- **Store listings**: screenshots, descriptions, privacy nutrition labels, data
  safety form, support URL and privacy URL — all per listing, all naming the
  brand, all pointing at the brand's domain.
- **Legal entity.** `web/privacy.html:106` and `web/terms.html:97` say "operated
  by Washateria LLC"; `web/delete-account.html:72` names all three apps. Whose
  privacy policy governs a chain's members is a contract question that reaches
  the store listing.

## 10. Email

- `docs/LAUNCH-CHECKLIST.md:37` — the Supabase confirmation template links to
  `https://repplefitness.com/confirmed?token_hash=…`. It lives in the Supabase
  dashboard, so it is **one template for all brands**: a Brand A member
  confirming their email is sent to Repple's site.
- `src/lib/deepLink.ts:71-73` — password reset, same problem (§6).
- Supabase's redirect allow-list is dashboard-only (there is no
  `supabase/config.toml`); every brand's domains must be added to the one list.
- Resend has `repplefitness.com` verified (`docs/LAUNCH-CHECKLIST.md:52`); each
  brand needs its own verified sending domain, or its members get mail from
  their supplier.
- `support@repplefitness.com` — **`Brand.supportEmail` exists as of 1 Sep 2026**
  (§1) and `src/lib/gdpr.ts` reads it, so the address printed into a member's
  own data export is now the brand's. It is still a literal on six settings
  screens: `app/(client)/settings.tsx:188,204,218`,
  `app/(trainer)/settings.tsx:126,155` and `app/(owner)/settings.tsx:176,280`.
  Those are one-line substitutions now that the field is there.

## 11. In-app copy

`VARIANT_LABEL` (`src/lib/variant.ts:87-89`) is `Repple` / `Repple Coach` /
`Repple Studio`, and roughly 120 user-facing strings across `src/` and `app/`
say "Repple" literally — "Unlock Repple", "Coaches on Repple", "Repple ID", the
liability waiver at `src/lib/waiver.ts:24,28,30`, the Apple Health instructions
at `src/lib/wearables/appleHealthWrite.ts:633` ("Health ▸ Sharing ▸ Apps ▸
Repple ▸ Workouts"), and the exercise attribution at
`src/ui/Attribution.tsx:60`. `BRAND.label` now exists to fix these; none were
changed here, because the file boundary for this work was the join origin only.

Two worth calling out because they are the brand speaking about itself in the
first person, to a member who has never heard of Repple:

- `src/lib/joinCode.ts:68` — `Join me on Repple — get the app here: …`. The
  origin in that message is now the brand's; the word "Repple" in it is not.
- `src/ui/FeedbackScreen.tsx:49` — "Your feedback went to the Repple team."

Also brand-namespaced and unlikely ever to be worth changing: ~40 AsyncStorage
keys prefixed `repple.` (`repple.settings`, `repple.accent.v2`,
`repple.pendingJoinCode`, …). They are private to an app's own sandbox, so two
brands on one device do not collide. Leave them; renaming them is a data
migration for zero user-visible benefit.

## 12. Also single-brand, for completeness

- **One Supabase project** (`phgfwzpkkwdysftlgkoq`), hardcoded in every
  `eas.json` profile. All brands share one database, one auth table, one storage
  bucket and one set of edge functions. Row-level security
  (`supabase/parts/38-tenant-isolation.sql`) isolates tenants, not brands.
- `studio-web/` — the Next.js owner console. `app/layout.tsx:28`
  `title: 'Repple Studio'`; `components/Shell.tsx:170` the `REPPLE/STUDIO`
  wordmark in JSX; `app/page.tsx:354` and `:401` link to
  `www.repplefitness.com`. One deployment, one brand.
- `src/theme/tokens.ts:19` — the default theme's `brand: '#16b8a6'` is the
  Repple client teal, and none of the ten palettes is sourced from
  `tenants.brand_color`.
- `ios/ReppleCoach/` — the checked-in native project directory carries the brand
  in its name, as does `ReppleCoach.xcodeproj`. Prebuild regenerates it, but it
  is committed.
- `supabase/parts/01-schema.sql:3` read `-- FitForge — Postgres schema` until
  1 Sep 2026 — a previous rename that leaked and was never finished, and the
  cheapest available evidence for how thoroughly a brand name spreads and how
  little of that spread anything in this repo can see. It is fixed, and the
  point it was making survives it: it took a person reading line 3 of a file
  nobody opens. `setup.sql` is generated from the parts, so `npm run db:build`
  had to be re-run and `db:check` re-passed for a one-line comment.

---

## Checklist for brand N

1. Registry entry in `src/lib/brands.ts` — bundles, schemes, names, tiles,
   `joinOrigin`, `linkHosts`, `androidGoogleServices`.
2. Icons under `assets/brands/<brand>/` (3 + adaptive foreground).
3. Firebase project → `google-services.<brand>.json`.
4. Three `eas.json` build profiles + three `submit` blocks with real `ascAppId`s.
5. Apple Developer + Google Play accounts; Team ID and Play App Signing SHA-256.
6. Domain; `/.well-known/apple-app-site-association` (as `application/json`,
   no extension, no redirect) and `/.well-known/assetlinks.json` on it.
7. A `/join` page and a `/reset-password` page on that domain. `/join` is
   solved if the brand's domain is added to the existing Cloudflare Pages
   project and the brand has a row in the `site-brands` table in
   `web/join.html` — see §4. `/reset-password` is not.
8. Supabase dashboard: redirect allow-list entries; the confirmation email
   template (currently shared, currently Repple's).
9. Resend: verified sending domain.
10. Spotify / Oura / WHOOP dashboards: new redirect URIs for the new schemes.
    `SPOTIFY_REDIRECT` and `OAUTH_REDIRECT` are brand-aware now, so the app
    sends the right address; registering it is still manual, per vendor, per
    brand, and possibly needs that brand's own developer app and client id.
11. Three store review accounts with that brand's data, emails confirmed.
12. Store listings: screenshots, copy, privacy and data-safety, support URL.
13. Re-run the before/after config comparison and confirm Repple's nine profiles
    are still byte-identical.

Steps 1–4 are this mechanism. Steps 5–13 are the actual cost, and 8, 10 and the
whole of §8 are unsolved.
