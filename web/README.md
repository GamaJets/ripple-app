# repplefitness.com

The public site. Twenty-one static pages, one stylesheet, no build step — so it
can be dropped on any static host as-is.

Two of these pages are not optional marketing: `/support` and `/privacy` are the
Support URL and Privacy Policy URL on all three App Store listings, and App
Review checks that both resolve. Until this is live, all three apps are blocked.
`/delete-account` is the third of that kind: Google Play requires a publicly
reachable account-deletion URL, and this is it.

## Files

The four that a stranger decides on:

    index.html            home — what the three apps are, and why they share one record
    client.html           /client  — the member app
    trainer.html          /trainer — the coach app
    studio.html           /studio  — the gym console

The rest of the marketing site:

    how-it-works.html     the first week of a gym's setup, in order
    pricing.html          what can honestly be said about money today
    download.html         which app you want, and where to get it
    support.html          Support URL for the App Store listings
    security.html         RLS, what a coach cannot see, what deletion reaches
    privacy.html          Privacy Policy URL for the App Store listings
    terms.html            terms of use
    delete-account.html   Google Play's account-deletion URL
    404.html              served by Cloudflare Pages for any unmatched path

Account and hand-off pages, all `noindex`:

    signup.html           create an account from the web
    forgot-password.html  request a reset link
    reset-password.html   where the reset link lands; sets the new password
    confirmed.html        where the confirmation link lands
    join.html             /join — a client accepting a coach's invitation
    connect-return.html   where Stripe Connect onboarding returns to
    connect-refresh.html  where Stripe sends a coach whose onboarding link expired
    coach.html            one coach's own public page, at /coach?h=<handle>

Everything that is not a page:

    styles.css            shared styles, dark-first with a light palette at the foot
    favicon.png           196×196
    apple-touch-icon.png  180×180 — the home-screen icon
    og/*.jpg              1200×630 social cards; og.jpg is the site-wide one and
                          /client, /trainer and /studio each carry their own
    badges/               App Store and Google Play badges
    play/                 Play Store listing assets, not used by any page
    sitemap.xml, robots.txt, _headers, .well-known/

`coach.html` is the only page here that has no content of its own. It reads
`?h=` and asks the database for that coach through `public_coach_page`, which is
one of the two things the publishable key may execute. It is static-and-fetching
rather than server-rendered because this directory has no build step and the
host serves no worker; the file's own header carries the whole argument,
including the price — with scripting off there is no page at all.

Every sentence on it is held against `src/lib/publicProfile.ts` by
`src/lib/publicProfile.test.ts`, which also reads
`supabase/parts/340-a-page-a-coach-can-put-in-their-bio.sql` and fails if a
reviewer's name, a review body or an expired credential could reach it.

Links between pages are written without the `.html` — `href="/support"`, not
`href="support.html"`. Cloudflare Pages serves the extensionless form and
308-redirects the other, so writing the clean form avoids a redirect on every
navigation, including the reset link.

## The parts every page carries

Twenty-one pages with no build step means twenty-one copies of the same head and
the same chrome, and the way that goes wrong is one page quietly missing a piece.
What every page has, and why:

- **A skip link** as the first focusable element in the body, pointing at
  `id="main"` on the page's own `<main>`. The sticky header has six links and a
  menu button in front of the content; without it that is seven tab stops on
  every page before a word of what you came for.
- **`aria-current="page"`** on the nav link for the page you are on. The rule
  that styles it (`nav.site a[aria-current="page"]`) was written long before any
  page set the attribute.
- **A social card** — `og:image` at 1200×630, `og:image:alt`, and
  `twitter:card=summary_large_image`. Regenerating them is in `og/` below.
- **`theme-color`, twice**, once per colour scheme, so a phone's address bar is
  not white above a near-black page. The values are `--bg` from each palette; if
  either changes in `styles.css`, change it in twenty-one heads too.
- **Two `preconnect`s** to `fonts.googleapis.com` and `fonts.gstatic.com`.
  `styles.css` reaches the three families through an `@import`, which the browser
  cannot even begin until the stylesheet has downloaded and parsed. The
  `@import` is kept because it is the single place the font URL is written; the
  preconnects take DNS, TCP and TLS off the critical path without copying it.
- **`<link rel="apple-touch-icon">`**, or "Add to Home Screen" gets a screenshot.

`404.html` needs no configuration: Cloudflare Pages serves it for any path that
does not resolve. Before it existed, every mistyped link and stale bookmark
landed on Cloudflare's own notice, which carries no Repple header, no navigation
and no way back into the site.

### Regenerating the social cards

`og/*.jpg` were rendered from SVG with `qlmanage` and `sips`, both of which ship
with macOS — there is no dependency to install and nothing in `package.json`
does it. The source SVGs are not kept: they are four near-identical files whose
only content is the wordmark, one line of copy taken from that page's
`og:description`, and the app's own gradient. If a card needs to change, write
the SVG at 1200×1200 with the design in the middle band, then:

    qlmanage -t -s 1200 -o . card.svg      # renders card.svg.png at 1200×1200
    sips -c 630 1200 card.svg.png --out card.png
    sips -s format jpeg -s formatOptions 88 card.png --out og/card.jpg

The square canvas and the centre crop are because `qlmanage` pads a non-square
SVG onto a square thumbnail. JPEG rather than PNG because the gradient costs
470 KB as a PNG and 90 KB as a JPEG, and no unfurler cares.

## Deploying

**Run `node scripts/stamp-css.mjs` first, every time `styles.css` changes.** It
rewrites the `?v=` on the stylesheet link in every page to a hash of the CSS
bytes. Cloudflare serves `styles.css` with `max-age=14400` and the HTML with
`max-age=0`, so without the stamp a visitor gets new markup against a stylesheet
up to four hours old — which on 26 Aug 2026 rendered every chart on the site
solid black. It is idempotent and a no-op when the CSS has not moved.

It is **not** wired into `check:all`, `preflight` or `scripts/publish.sh`, and it
has no entry in `package.json`. Nothing catches a forgotten stamp, so it is a
line in this file and a habit, which is the weakest kind of gate this repo has.

Any static host works. Point it at this folder; there is nothing to compile.

Cloudflare Pages, from the repo root:

    npx wrangler pages deploy web --project-name repple

Netlify:

    npx netlify deploy --dir=web --prod

Currently deployed to Cloudflare Pages at `repple.pages.dev`. The custom domain
still has to be attached in the Pages project and pointed from GoDaddy DNS.

## Two things that must line up elsewhere

The reset flow spans three systems, and it only works if all three agree:

1. **Supabase → Authentication → URL Configuration.** The redirect allow-list
   must contain `https://www.repplefitness.com/**`. A `redirectTo` that is not
   on the list is *silently ignored* and falls back to the Site URL — the link
   still arrives, it just goes somewhere useless.
2. **The email template** must build its link from the redirect, not a
   hardcoded `repple://`, or Coach and Studio resets land in the client app.
3. **Resend** must have `repplefitness.com` verified before the sender is moved
   to `noreply@repplefitness.com`. Until then the sender stays on Resend's
   shared test address, which only delivers to the account owner.

## Before it goes live

- `support@repplefitness.com` has to receive mail. Every page points there, and a
  reviewer may well test it.
- The operating entity is written as Washateria LLC, taken from the Apple
  Developer team name. Correct it in `privacy.html` and `terms.html` if the
  contracting entity is different.
- Both documents are drafts written from what the apps actually do. They are
  accurate to the code, not reviewed by a lawyer. The privacy policy must also
  match the App Privacy answers already filed in App Store Connect.

## The gate on these pages

`npm run check:site-claims` (in `check:all`) compares specific sentences here
against the code that makes them true. It exists because this site was audited
once and corrected twice in a day, and both times it was found stating things
the code had stopped doing months earlier: a password minimum of six when the
rule is eight, a pricing page saying nothing is charged while a 10% platform fee
is applied to every Connect charge, a privacy policy that named neither of the
two live processors of health data, and a device list offering Fitbit and Garmin
as connectable when neither can be.

It checks six things, and each parses its answer out of the code rather than
holding a copy of it — `PASSWORD_MIN`, `DEFAULT_FEE_PCT`, `TRIAL_DAYS`, the
hosts contacted from `supabase/functions/**`, the wearable vendors that have a
client id, and the internal consistency of the deletion chart on `security.html`.
The header of `scripts/check-site-claims.mjs` says what each one does, what it
deliberately does not check, and why.

Two things to know when editing these pages:

- **`<!-- site-claim: wearables-connect -->`** sits directly above the sentence
  in `client.html` listing the devices a client can connect. The block after it
  must name exactly the connectable vendors. If that sentence moves, move the
  marker with it — the gate refuses to pass when it cannot find one.
- **`site-claim-ok: <reason>`** in the comment run directly above a line excuses
  that one line, and needs a written reason. Use it when the gate is wrong. Do
  not use it, and do not soften a sentence, to make a disclosure pass: if a page
  understates what leaves the product, the page is the thing to change.
