# repplefitness.com

The public site. Four static pages, one stylesheet, no build step — so it can be
dropped on any static host as-is.

Two of these pages are not optional marketing: `/support` and `/privacy` are the
Support URL and Privacy Policy URL on all three App Store listings, and App
Review checks that both resolve. Until this is live, all three apps are blocked.

## Files

    index.html     home — what the three apps are
    support.html   Support URL for the App Store listings
    privacy.html   Privacy Policy URL for the App Store listings
    terms.html     terms of use
    styles.css     shared styles, light and dark
    favicon.png

## Deploying

Any static host works. Point it at this folder; there is nothing to compile.

Cloudflare Pages, from the repo root:

    npx wrangler pages deploy web --project-name repple

Netlify:

    npx netlify deploy --dir=web --prod

Then point the apex domain and `www` at the host, and confirm in a browser that
`https://www.repplefitness.com/support` and `https://www.repplefitness.com/privacy` both load
over HTTPS — those are the exact URLs on the App Store listings.

## Before it goes live

- `support@repplefitness.com` has to receive mail. Every page points there, and a
  reviewer may well test it.
- The operating entity is written as Washateria LLC, taken from the Apple
  Developer team name. Correct it in `privacy.html` and `terms.html` if the
  contracting entity is different.
- Both documents are drafts written from what the apps actually do. They are
  accurate to the code, not reviewed by a lawyer. The privacy policy must also
  match the App Privacy answers already filed in App Store Connect.
