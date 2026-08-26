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

**Before flipping it back**, fix the thing that made it necessary:

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
without re-checking: the cascade counts (26 tables directly, 39 transitively,
17 set-null columns) came from `pg_constraint` on the live database, not from
memory.

---

## 4. Automatic deploys still need one secret

`.github/workflows/deploy-web.yml` publishes `web/` to Cloudflare Pages on every
push to `main`. It fails until **CLOUDFLARE_API_TOKEN** exists as a repository
secret. That failure is deliberate — a deploy that silently skips itself is the
fault the workflow was written to end — but it means every push shows a red run
until the secret is added.

Until then, deploys are manual:

```bash
npx wrangler pages deploy web --project-name=repple --branch=main
```

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
