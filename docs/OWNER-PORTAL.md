# Owner portal — what it is, and what it has to be built on

## The problem

Eleven of the twelve owner screens touch Supabase zero times. `usePlatformTrainers`
seeds from a constant, computes MRR into React state, and forgets everything when
the app closes. Add a trainer, change their plan, suspend them — relaunch and it
is gone. The portal looks like a working dashboard and is a calculator with
amnesia.

The fabricated trainer list was already emptied, so today it honestly shows zero.
That is the only reason it is not actively lying.

## The split

The portal is currently two products in one set of screens:

- **Repple as SaaS.** Trainers and gyms subscribe on Starter / Pro / Studio
  ($49 / $99 / $249). MRR here is what they pay *you*. Audience: you.
- **A gym's own business.** A gym owner using Repple wants their membership and
  PT revenue, their trainers' payroll, their class fill rates. Audience: your
  customer.

`trainers.tsx` and `revenue.tsx` are the first. `class-analytics.tsx`,
`financials.tsx` and `ops.tsx` are the second. They should not share a hero
figure called "Platform MRR", because it means opposite things to the two
audiences.

## The data already exists

Nothing here needs a new billing integration. The tables are in place and empty:

**SaaS side — Stripe-backed, per trainer**

| table | what it holds |
|---|---|
| `subscriptions` | `trainer_id`, `plan`, `status`, `current_period_end`, `cancel_at_period_end` |
| `invoices` | `trainer_id`, `amount_due`, `currency`, `status`, `attempt_count`, `hosted_invoice_url` |
| `billing_customers` | `trainer_id` → `stripe_customer_id` |

Platform MRR is a query, not a running total:

```sql
select sum(case plan when 'Starter' then 49 when 'Pro' then 99 when 'Studio' then 249 end)
from subscriptions
where status in ('active', 'trialing');
```

Churn, net adds and the monthly snapshot all derive from `status` transitions and
`current_period_end`. No AsyncStorage, no in-memory roster, no back-filled trend —
the history is in the rows.

**Gym side — per tenant**

| table | what it holds |
|---|---|
| `client_purchases` | `client_id`, `trainer_id`, `amount_cents`, `sessions_total`, `sessions_used`, `status` |
| `trainer_packages` | the products those purchases refer to |
| `tenants` | `plan`, `session_fee`, branding |
| `class_bookings` + `gym_classes` | attendance, already feeding `class-analytics` |

Gym revenue for a period is `sum(amount_cents) where status='paid'`, scoped to the
tenant's trainers. Trainer payroll stays what it is now — real check-in counts
times a rate the owner enters — but the rate belongs on `tenants.session_fee`, not
in a `useState` that resets.

## What to build, in order

1. **Decide who the owner role means.** `profiles.role` needs to distinguish a
   platform admin from a gym owner. Today `(owner)` is one route group serving
   both. Until this is settled, everything below is guesswork.

2. **Replace `usePlatformTrainers` with a query.** Drop the in-memory provider.
   Read `subscriptions` joined to `profiles` for names. Add / suspend / re-plan
   become writes, not `setState`. This alone makes `trainers.tsx` and the
   Overview real.

3. **Split the routes.** `(owner)` for the gym owner, `(admin)` for you. Move
   `trainers.tsx`, `revenue.tsx` and the MRR trend to `(admin)`. Leave
   `class-analytics`, `financials`, `ops`, `promotions`, `brand` in `(owner)` and
   scope every query by `tenant_id`.

4. **Persist the monthly snapshot server-side.** `useMrrHistory` writes to
   AsyncStorage on one device. A `platform_metrics` table with one row per month
   makes the trend survive a reinstall and match across devices. (The back-fill
   is already fixed — months with no snapshot render blank rather than repeating
   today's figure.)

5. **`financials.tsx` needs a real source.** It currently takes typed inputs and
   grades them. That is defensible as a calculator, but it is titled "AI financial
   review" and carries a `sparkle` icon while being an if/else chain over four
   thresholds. Either connect accounting (the screen already says "connect
   accounting") or rename it to what it is. The always-grade-A bug in it is fixed;
   the framing is not.

## Two things not to repeat

- `owner-metrics` is deployed as an edge function and called by nothing. If the
  aggregate queries belong server-side, use it; if not, delete it. A deployed
  function nobody calls is a trap for the next person reading the code.
- Every number on these screens should be traceable to a row. The pattern that
  produced the bugs cleared out in `6b1cbdf`, `bcdfddb` and `98252ff` was always
  the same: a plausible constant standing in for a measurement, then arithmetic on
  top of it, then a confident label. Prefer "—" and a prompt.
