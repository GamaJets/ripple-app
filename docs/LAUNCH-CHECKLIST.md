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
