# Launch checklist

Things that are deliberately **wrong right now** because the apps are not out
yet, and must be put back when they are.

This file exists because each item below is a decision that was correct on the
day it was made and becomes a defect the moment the apps go live. None of them
will announce themselves. Nothing breaks, no test fails, no log line appears —
they simply stop being true.

Work top to bottom on the day the last of the three apps is approved and live.

---

## 1. Turn email confirmation back on — SECURITY

**Supabase → Authentication → Sign In / Providers → Supabase Auth → Confirm email**

Turned **off** on 26 Aug 2026. Right now anyone can register an address they do
not own, and the account works immediately.

**Why it was turned off.** Confirmation emails were being delivered by Resend
and then quarantined by the recipient's mail provider — Microsoft 365 in the
case that surfaced it, which accepts at the SMTP edge (so Resend logs
"Delivered") and filters afterwards, into a quarantine the user never sees in
Inbox or Junk. Three of the first twelve signups never completed. The toggle
was the difference between onboarding people and not.

**Why it has to go back.** That trade is defensible while you are hand-onboarding
gyms you have spoken to. It is not defensible when strangers can sign up:
unverified addresses mean password resets can be aimed at accounts somebody
else owns, and it lets one person squat on another's email.

**The link shape is fixed already — 27 Aug 2026.** The Confirm sign up template
must be changed at the same time as the toggle, or this comes straight back:

    <a href="https://repplefitness.com/confirmed?token_hash={{ .TokenHash }}&amp;type=signup">Confirm my email</a>

It must be the ONLY link in that template. `{{ .ConfirmationURL }}` routes
through `/auth/v1/verify`, which spends the token server-side the moment
*anything* fetches the URL — and a scanning mail filter fetches it before the
person reads the message. `web/confirmed.html` now holds a `token_hash` and
spends it when somebody presses the button, which a scanner does not do. Reset
password was moved to this shape on 27 Aug and is the working example.

Note that until that template changes, `web/confirmed.html` is still correct for
the old `#access_token` shape — both are handled. Nothing breaks by waiting; the
scanner problem simply persists.

**Also before flipping it back**, fix the rest of what made it necessary:

- `repplefitness.com` was verified in Resend on 25 Aug 2026 and had no sending
  reputation. That is the single biggest reason corporate filters quarantined
  it. Reputation builds with volume and time; by launch it should be better.
- Send a test to a Microsoft 365 address and to a Google Workspace address
  BEFORE flipping, and confirm both land in the inbox rather than assuming.
- Resend → Emails shows per-message delivery. "Delivered" only means the
  receiving server accepted it — it is not proof anybody saw it. Check the
  actual mailbox.

**Then re-check** that any account created while it was off is one you recognise:

```sql
select email, created_at, email_confirmed_at, last_sign_in_at
from auth.users
where created_at > '2026-08-26'
order by created_at desc;
```

**`email_confirmed_at` does not mean what it looks like here.** With the toggle
off, Supabase stamps it at creation — so every account made during this window
reads as confirmed whether or not anybody proved they own the address. Checked
on 26 Aug 2026: the one account created since the toggle shows
`email_confirmed_at` set, and that fact carries no information.

So the column cannot be used to sort verified from unverified for this window.
The `created_at` range above is the only signal, which is why the instruction is
to recognise the accounts by name rather than to trust a flag. The two genuinely
unconfirmed accounts in section 5 predate the toggle, which is precisely why
they still read as unconfirmed.

---

## 2. Store links currently point at listings that do not exist

`web/download.html`, plus the closing call to action on `client.html`,
`trainer.html` and `studio.html`, link to:

    https://apps.apple.com/app/id6790096518          Repple
    https://apps.apple.com/app/id6804358275          Repple Coach
    https://apps.apple.com/app/id6804417240          Repple Studio
    https://play.google.com/store/apps/details?id=com.washateria.repple[.coach|.studio]

On 26 Aug 2026 all six returned 404, and `itunes.apple.com/lookup` returned
`resultCount 0` across the us, ae, gb and sa storefronts. The owner asked for
them to go up anyway. They are the permanent addresses, so each starts working
by itself the moment that listing publishes — **no edit needed to switch them
on.**

What DOES need an edit when they are live:

- `web/download.html` — delete the "Being released now" callout near the top.
  It tells people a link that does not open means that app has not finished
  going out, which stops being true.

Verify rather than assume:

```bash
for id in 6790096518 6804358275 6804417240; do
  curl -s "https://itunes.apple.com/lookup?id=$id" | head -c 120; echo
done
```

---

## 3. The deletion queue claim on the public page

`web/delete-account.html` says the Repple Studio screen showing an owner their
pending deletion requests "is new and is not in every gym's build yet". True
today. Once the build carrying `app/(owner)/deletions.tsx` is the one on the
stores, that sentence is understating the product — reword it.

The rest of that page is verified against the schema and should not be touched
without re-checking: the cascade counts came from `pg_constraint` on the live
database, not from memory.

**Those counts move whenever a table is added**, and they already have. On
26 Aug they went from 26 direct / 39 transitive to **28 direct (32 columns),
42 transitive, 13 set-null tables (17 columns)** — `gym_shifts` and
`progress_photo_shares` landed that day. `web/delete-account.html` and
`web/security.html` both publish them, so re-run this before launch and fix
both pages if it has moved again:

```sql
with recursive casc as (
  select c.conrelid as rel from pg_constraint c
  where c.contype='f' and c.confdeltype='c' and c.confrelid='public.profiles'::regclass
  union
  select c.conrelid from pg_constraint c join casc on c.confrelid = casc.rel
  where c.contype='f' and c.confdeltype='c')
select
  (select count(distinct conrelid) from pg_constraint
    where contype='f' and confdeltype='c' and confrelid='public.profiles'::regclass) as direct_tables,
  (select count(*) from (select distinct rel from casc) x)                           as transitive_tables,
  (select count(*) from pg_constraint
    where contype='f' and confdeltype='n' and confrelid='public.profiles'::regclass) as setnull_cols;
```

---

## 4. ~~Automatic deploys need a secret~~ — DONE 26 Aug 2026

`CLOUDFLARE_API_TOKEN` is set and `.github/workflows/deploy-web.yml` publishes
`web/` to repplefitness.com on every push to `main` that touches it. Verified by
a real run, not by the secret existing.

Left here rather than deleted, because if deploys ever go quiet the first thing
to check is whether that secret still exists — a rolled or expired token fails
the job loudly, which is the design, but only if somebody reads the red run.

---

## 5. Two accounts are still unconfirmed from before the toggle

`crawlerrobo@gmail.com` (28 Jul) and `okhater01@gmail.com` (26 Jul) have
`email_confirmed_at` null. Turning confirmation off does **not** retroactively
confirm them — their rows already carry the unconfirmed state, so they still
cannot sign in. Either confirm them by hand or leave them; they may simply have
abandoned signup months ago.

---

## 6. Exercise videos need a new binary, and will fail quietly without one

Added 26 Aug 2026, when the exercise video library was made to actually work.

`expo-video` is a **native** dependency. It is declared in `app.json`'s plugins
and installed in `package.json`, which means:

- **Expo Go can no longer run this app at all.** Development needs an EAS dev
  build from here on.
- Any store build produced *before* this change does not contain the video
  player. On such a build the library screens still render, a trainer can still
  record and upload, and the client still sees a clip listed — and nothing
  plays. There is no error to read, because the code that would play it is not
  in the binary.

So the three listings must ship a build made **after** this commit, or the
feature is present in the UI and absent in fact — which is the failure mode this
whole checklist exists to catch.

Verify before submitting, rather than assuming:

```bash
node -e "const p=require('./package.json');console.log('expo-video',p.dependencies['expo-video']||'MISSING')"
grep -q '"expo-video"' app.json && echo "plugin registered" || echo "PLUGIN MISSING"
```

### The storage bucket is private now

`exercise-videos` was created by hand in the dashboard and left **public**, so
any clip was readable by anyone who ever saw its URL, whatever the table's
policies said. `49-exercise-video-library.sql` declares it and flips it private;
playback mints a signed URL per viewer, and the signing call is itself subject
to the read policy.

Nothing was lost in the flip — the bucket held zero files on the day it changed,
because the insert path had never once succeeded. But it means **`getPublicUrl`
no longer returns anything playable for this bucket**. If a future change starts
returning public URLs again, it is not a convenience; it is the permission model
being removed.

---

## 7. Never submit with `--latest` from this repo

Learned the hard way on 27 Aug 2026, submitting the first builds in four days.

`eas submit --platform ios --profile production --latest` reads as "submit the
newest production build". It does not. **`--latest` picks the newest build for
the PLATFORM**; `--profile` only decides which App Store Connect app to aim at.

One repo builds three apps here, so the newest iOS build is very often not the
one the profile means. That morning the newest was Repple Studio, and two
submit commands — one for the client, one for the coach — both picked up the
Studio binary:

    efe04979  Studio build 4  →  aimed at 6790096518 (client)   finished
    c5203b57  Studio build 4  →  aimed at 6804358275 (coach)    finished
    ba3ad9a6  Studio build 4  →  aimed at 6790096518 (client)   errored

What saved it: **Apple routes an upload by the binary's bundle identifier, not
by the ascAppId the submitter passed.** All three went to Repple Studio, where
the bundle id pointed, and the duplicates came back as ITMS-90189 "Redundant
Binary Upload". Nothing wrong reached a tester, and the only real cost was that
the coach's actual build never got submitted while everyone believed it had.

Do not rely on that routing to keep saving you. Submit by explicit build id:

```bash
eas build:list --limit 10          # find the id for the profile you mean
eas submit --platform ios --profile production-coach --id <BUILD_ID>
```

Before it uploads, EAS prints the bundle identifier. Read that line. It must
match the app you meant:

    com.washateria.repple          Repple          6790096518
    com.washateria.repple.coach    Repple Coach    6804358275
    com.washateria.repple.studio   Repple Studio   6804417240

One more thing seen the same morning, which is cosmetic and looks alarming:
`eas submit` prints "Looking up credentials configuration for
com.washateria.repple" even when submitting the coach. It evaluates
`app.config.ts` without the build profile's `EXPO_PUBLIC_APP_VARIANT`, so it
falls back to the default identity in `app.json`. It only affects which
credential record is looked up, and an account-level ASC API key makes it moot.
The binary's own bundle id is fixed at build time.

---

## 8. A production build bundles JavaScript; a development build does not

Also 27 Aug 2026. Every production build of all three apps had failed since the
Apple Health write path landed, and nothing said so for thirty commits.

`lazy()` in `src/lib/wearables/appleHealthWrite.ts` called `require(mod)` on a
variable. Metro resolves requires statically and refuses the file:

    SyntaxError: appleHealthWrite.ts:467: Invalid call at line 467: require(mod)

That is the **Bundle JavaScript** phase, which only production builds run — a
development client loads its JS from the Metro server and never bundles it. So
the apps stayed developable and became unshippable, silently.

The whole class of problem is cheap to catch. This is the same bundle step EAS
runs, and it takes about half a minute:

```bash
npx expo export --platform ios --output-dir /tmp/repple-export
```

Run it before any store build. `tsc` will not catch this — the code typechecks
perfectly; it is the bundler that refuses it.
