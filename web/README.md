# repplefitness.com

The public site. Seven static pages, one stylesheet, no build step — so it can
be dropped on any static host as-is.

Two of these pages are not optional marketing: `/support` and `/privacy` are the
Support URL and Privacy Policy URL on all three App Store listings, and App
Review checks that both resolve. Until this is live, all three apps are blocked.

## Files

    index.html            home — what the three apps are
    support.html          Support URL for the App Store listings
    privacy.html          Privacy Policy URL for the App Store listings
    terms.html            terms of use
    signup.html           create an account from the web
    forgot-password.html  request a reset link
    reset-password.html   where the reset link lands; sets the new password
    coach.html            one coach's own public page, at /coach?h=<handle>
    styles.css            shared styles, light and dark
    favicon.png

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

## Deploying

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
