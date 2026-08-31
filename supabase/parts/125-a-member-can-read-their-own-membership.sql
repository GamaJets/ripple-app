-- ── The plan a member is still paying for, which they could not read ────────
--
-- The client app had nowhere to show a member their plan, whether it is
-- current, or when it runs out — app/(client)/membership.tsx had a fabricated
-- "Plan · Member" and "Valid until <today + 1 year>" removed and replaced with
-- nothing. Wiring the real record up meant checking first whether a member can
-- read it at all, because RLS narrows a GRANT and the GRANT on all four tables
-- in part 29 is the blanket `authenticated` one every table in this project has.
--
-- ── What the audit found (run against the live project, not read off) ───────
--
-- Part 29 already carries the three self-scoped SELECT policies, and they are
-- live and they work. Proved with two real client profiles in two different
-- tenants, each holding a scratch membership and a scratch payment, queried
-- under `set local role authenticated` with the other member's uid in
-- request.jwt.claims:
--
--   member A: own membership 1, own payment 1, other member's 0 and 0.
--   member B: A's membership row by primary key 0. A's payment by primary key
--             0. A's payments by member_id 0. A's gym's memberships 0. A's
--             gym's plans [].
--   anon:     cannot read any of it — the read does not even reach a policy,
--             it dies at `permission denied for function is_owner_of` /
--             `my_tenant`, which are the SECURITY DEFINER helpers anon has no
--             EXECUTE on. It fails closed.
--
-- So the suspicion that a member cannot see their own membership row was
-- wrong, and nothing here re-grants what already works.
--
-- ── What it could not read, and this is the whole point of this part ────────
--
-- The membership row names a plan_id and nothing else. Every human-readable
-- fact about the plan — its NAME, its PRICE and, in a white-label product, THE
-- CURRENCY THAT PRICE IS IN — lives in `membership_plans`, and the only
-- member-facing policy on that table is
--
--     membership_plans_tenant_r  for select using (tenant_id = my_tenant() and active)
--
-- `and active`. That is right for a price book — nobody should be sold a
-- retired plan — and it is wrong for the plan somebody is still on. Part 29
-- says so itself, four lines above the column:
--
--     -- A plan may be retired while a membership sold on it is still running,
--     -- so this goes null rather than taking the membership with it.
--
-- The membership survives the retirement; the member's ability to read what
-- they are paying for does not. Proved live: member A holds a membership on a
-- plan with active = false, and
--
--     select ... from memberships m left join membership_plans p on p.id = m.plan_id
--
-- returned their membership with plan, price and currency all NULL.
--
-- That is not a blank field, it is a wrong answer. Over PostgREST the embedded
-- row comes back as `membership_plans: null`, which is byte-identical to a
-- membership that genuinely has no plan attached (plan_id is nullable — part 29
-- sets it null when a plan is deleted). A screen cannot tell "your gym has not
-- recorded a plan for you" from "your plan is one we won't let you see", and
-- the first sentence is a lie told to somebody being charged every month. The
-- app distinguishes them by reading plan_id itself; this policy removes the
-- need to.
--
-- ── The policy ─────────────────────────────────────────────────────────────
--
-- Narrow on both axes at once, and additive: it grants SELECT on a plan row
-- only where a membership held BY THE CALLER, IN THAT PLAN'S OWN TENANT,
-- points at it. Not "plans in my gym" — that is the existing policy and it
-- already covers the active ones. Not "plans I could ask about". The exact set
-- of rows is: the plans this person is on, or has been on. Retiring a plan no
-- longer hides it from the people still on it, and nothing else moves.
--
-- The tenant equality is belt-and-braces rather than decoration: nothing in the
-- schema forces memberships.tenant_id to equal membership_plans.tenant_id
-- (they are two independent FKs to `tenants`), so an owner-side mistake that
-- attached a membership to another gym's plan would otherwise become a
-- cross-tenant read of that gym's price list. With this clause it reads as
-- nothing at all.
--
-- No recursion. The subquery is subject to RLS on `memberships`, whose policies
-- are `member_id = auth.uid()` and `is_owner_of(tenant_id)` — neither of which
-- mentions `membership_plans`, so this does not re-enter the table it is
-- protecting. (28-fix-profiles-recursion.sql is the incident that rule comes
-- from.) The `m.member_id = auth.uid()` predicate is written out anyway rather
-- than left to the memberships policy to supply, so the row set this policy
-- admits does not silently widen if a future part adds a broader read policy
-- to `memberships`.
--
-- `(select auth.uid())` and not bare `auth.uid()`: the scalar subquery is
-- evaluated once per statement instead of once per row, the form part 29 and
-- part 121 already use.
drop policy if exists membership_plans_mine_r on public.membership_plans;
create policy membership_plans_mine_r on public.membership_plans
  for select using (
    exists (
      select 1
        from public.memberships m
       where m.plan_id   = membership_plans.id
         and m.tenant_id = membership_plans.tenant_id
         and m.member_id = (select auth.uid())
    )
  );

-- The lookup this policy performs on every candidate plan row. idx_memberships_member
-- (part 29) is on member_id alone; this pairs it with plan_id so the EXISTS is
-- an index probe rather than a scan of the member's whole membership history.
create index if not exists idx_memberships_member_plan
  on public.memberships (member_id, plan_id);

-- ── Two things deliberately NOT done here ──────────────────────────────────
--
-- 1. `memberships_own_r` and `gym_payments_own_r` are NOT tenant-scoped, and
--    are left that way on purpose. Adding `and tenant_id = my_tenant()` would
--    narrow nothing that matters — `member_id = auth.uid()` is already the
--    tightest predicate available, and no row it admits belongs to anyone else
--    — while breaking the one case where the difference shows: a member who
--    moves gyms. profiles.tenant_id follows them, so my_tenant() becomes the
--    NEW gym, and the added clause would hide the membership they used to hold
--    and every payment they ever made to the old one. That is their own money
--    disappearing out of their own receipts. Which gym a membership belongs to
--    is a question for the SCREEN, which reads tenant_id off the row and says
--    so; it is not a reason to refuse them the row.
--
-- 2. `memberships.note` and `gym_payments.note` stay readable by the member,
--    because they already are and this part does not widen or narrow that.
--    Worth writing down: those are free-text columns the OWNER console writes,
--    and an owner who types a private remark about a member into one is typing
--    it somewhere that member can read. Column-level revokes cannot fix it —
--    owners authenticate as `authenticated` too, so revoking the column takes
--    it from the console as well. The client app therefore does not select
--    either column, and anything genuinely private needs a column the member
--    has no policy on rather than an assumption about this one.

comment on policy membership_plans_mine_r on public.membership_plans is
  'A member may read a plan their own membership points at, in that plan''s own tenant, whether or not it is still on sale. membership_plans_tenant_r covers the live price book and excludes retired plans, which hid the plan name, price and currency from the people still paying for it.';
