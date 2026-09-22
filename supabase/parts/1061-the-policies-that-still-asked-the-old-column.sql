-- ═══════════════════════════════════════════════════════════════════════════
-- The policies that still asked the old column.
--
-- The second half of part 1060, and a separate file for part 941's reason: 1060
-- changes three function bodies and adds a helper, this changes eleven row
-- policies. They are applied together and they are read apart.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- Part 1060 has the full argument. In one paragraph: `revoke_staff_role()`
-- clears `profiles.tenant_id` and deliberately keeps the `trainers` row, so
-- `trainers.tenant_id` — which is NOT NULL — goes on naming the gym a coach has
-- left. Part 941 corrected the one function that read it for currency. Every
-- policy below still reads it for ACCESS.
--
-- 1060 fixed `coach_clients_owner_r` and `app_errors_owner` on its own, because
-- both are written in terms of `tenant_of_user()` and that function's coalesce
-- was simply in the wrong order. The eleven here name the column directly and
-- have to be re-emitted one at a time.
--
-- ── WHAT SOMEBODY COULD ACTUALLY DO ──────────────────────────────────────
--
-- Sorted by what leaves the building. Every one of these is reachable by an
-- ordinary gym owner with their own account and no special tooling — they do
-- not have to do anything except keep using the console after a coach leaves.
--
--   · `sessions_owner_r`, `client_purchases`, `client_subscriptions`,
--     `client_subscription_payments`, `billing_customers` — the old gym goes on
--     reading the coach's diary and the money against it, including sessions
--     delivered and packages sold at a DIFFERENT gym, to clients the old gym
--     has no relationship with. This is the cross-tenant read the white-label
--     promise exists to prevent.
--
--   · `connect_accounts` — the coach's Stripe Connect record, still readable by
--     a gym they no longer work for.
--
--   · `exvid_owner_rw` is FOR ALL, not FOR SELECT. The old gym's owner can
--     still UPDATE and DELETE a departed coach's exercise videos, including
--     ones filmed afterwards. This is the only one on the list that is
--     destructive rather than merely disclosing, which is why it is fixed at
--     both `using` and `with check`.
--
--   · `sessions_gym_owner_i` is the write twin: the old gym could still INSERT
--     sessions onto a departed coach's diary.
--
--   · `tenants_trainer_r` and `tenants_client_r` point the other way — the
--     departed coach, and every client of theirs, kept reading the old gym's
--     `tenants` row: brand, currency, settings. `revoke_staff_role()`'s closing
--     comment claims clearing the profile tenant removes the coach's access.
--     For these two policies that claim was false, because they match on the
--     roster column rather than the profile one.
--
--   · `availability_templates_trainer_peer_r` is the mildest: a trainer still
--     at the gym could read the availability template of one who had left.
--
-- ── WHY IT IS SHAPED THIS WAY ────────────────────────────────────────────
--
-- Every policy below keeps its name, its command, its roles and its overall
-- shape. The ONLY thing that changes in each is the sub-expression that asks
-- which gym a coach belongs to: `trainers.tenant_id` becomes
-- `staff_tenant_of(...)` from part 1060. Nothing is widened, no branch is added
-- or removed, and no policy gains or loses a role.
--
-- Where the original joined `trainers` in order to require that the subject or
-- the reader HAS a roster row, that join is preserved even though the tenant no
-- longer comes from it — `tenants_trainer_r`, `tenants_client_r` and
-- `availability_templates_trainer_peer_r` all still require the roster row. It
-- would have been shorter to collapse them to `my_tenant()`, and that would
-- have been a widening: it would newly expose a gym's `tenants` row to its
-- ordinary members, who are not who those policies were written for.
--
-- Two `is not null` guards are added, at the peer-availability policy and the
-- 'gym' visibility branch of `exvid_read`. They are not strictly required —
-- `null = null` is null, which fails closed either way — but the old expression
-- was reading a NOT NULL column and the new one is not, and a comparison whose
-- safety depends on three-valued logic should say so out loud rather than
-- leaving the next reader to work it out.
--
-- ── WHAT THIS CHANGES FOR ANY EXISTING SCREEN ────────────────────────────
--
-- Nothing. Verified against the live catalogue on 3 Sep 2026: 0 of 8 `trainers`
-- rows disagree with the tenant on their profile. For every coach currently on
-- a gym's staff `trainers.tenant_id` and `profiles.tenant_id` are the same
-- value, so every expression below evaluates exactly as it did before. The
-- owner console, the coach app and the member app all see what they saw.
--
-- Idempotent and safe to re-run: every policy is dropped with `if exists` and
-- recreated, so a second run lands on the same eleven definitions.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The money and the record behind it ───────────────────────────────────

drop policy if exists cust_read on public.billing_customers;
create policy cust_read on public.billing_customers
  for select
  using (
    trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

drop policy if exists purch_read on public.client_purchases;
create policy purch_read on public.client_purchases
  for select
  using (
    client_id = (select auth.uid())
    or trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

drop policy if exists client_sub_pay_read on public.client_subscription_payments;
create policy client_sub_pay_read on public.client_subscription_payments
  for select
  using (
    client_id = (select auth.uid())
    or trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

drop policy if exists client_subs_read on public.client_subscriptions;
create policy client_subs_read on public.client_subscriptions
  for select
  using (
    client_id = (select auth.uid())
    or trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

drop policy if exists conn_read on public.connect_accounts;
create policy conn_read on public.connect_accounts
  for select
  using (
    trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

drop policy if exists sub_read on public.subscriptions;
create policy sub_read on public.subscriptions
  for select
  using (
    trainer_id = (select auth.uid())
    or public.is_owner_of(public.staff_tenant_of(trainer_id))
  );

-- ── The diary ────────────────────────────────────────────────────────────

drop policy if exists sessions_owner_r on public.sessions;
create policy sessions_owner_r on public.sessions
  for select
  using (public.is_owner_of(public.staff_tenant_of(trainer_id)));

drop policy if exists sessions_gym_owner_i on public.sessions;
create policy sessions_gym_owner_i on public.sessions
  for insert
  with check (public.is_owner_of(public.staff_tenant_of(trainer_id)));

-- ── The one that could delete ────────────────────────────────────────────
--
-- FOR ALL, so both halves. `with check` matters as much as `using` here: a
-- policy that let the old gym read a video but not write it would still have
-- let them move one into their reach and then act on it.

drop policy if exists exvid_owner_rw on public.exercise_videos;
create policy exvid_owner_rw on public.exercise_videos
  for all
  using (public.is_owner_of(public.staff_tenant_of(trainer_id)))
  with check (public.is_owner_of(public.staff_tenant_of(trainer_id)));

-- Two of this policy's seven branches read the roster column: the 'gym'
-- visibility branch and the owner branch. The other five — own video, unowned
-- catalogue video, 'public', the client branch, and an explicit grant — are
-- reproduced exactly and are not affected by any of this.

drop policy if exists exvid_read on public.exercise_videos;
create policy exvid_read on public.exercise_videos
  for select
  to authenticated
  using (
    trainer_id = (select auth.uid())
    or (trainer_id is null and visibility = any (array['public'::text, 'clients'::text, 'gym'::text]))
    or visibility = 'public'::text
    or (visibility = 'clients'::text and exists (
          select 1 from public.clients c
           where c.id = (select auth.uid()) and c.trainer_id = exercise_videos.trainer_id))
    or (visibility = 'gym'::text
        and public.my_tenant() is not null
        and public.staff_tenant_of(exercise_videos.trainer_id) = public.my_tenant())
    or exists (
          select 1 from public.exercise_video_grants g
           where g.video_id = exercise_videos.id and g.client_id = (select auth.uid()))
    or public.is_owner_of(public.staff_tenant_of(exercise_videos.trainer_id))
  );

-- ── The two that pointed the other way ───────────────────────────────────
--
-- The roster join is KEPT in both. It is no longer where the tenant comes from,
-- but it is still the test for "this person is a coach", and dropping it would
-- hand a gym's `tenants` row to its ordinary members.

drop policy if exists tenants_trainer_r on public.tenants;
create policy tenants_trainer_r on public.tenants
  for select
  using (exists (
    select 1 from public.trainers t
     where t.id = (select auth.uid())
       and public.staff_tenant_of(t.id) = tenants.id
  ));

drop policy if exists tenants_client_r on public.tenants;
create policy tenants_client_r on public.tenants
  for select
  using (exists (
    select 1
      from public.coach_clients cc
      join public.trainers t on t.id = cc.trainer_id
     where cc.id = (select auth.uid())
       and public.staff_tenant_of(t.id) = tenants.id
  ));

-- ── The peer ─────────────────────────────────────────────────────────────

drop policy if exists availability_templates_trainer_peer_r on public.availability_templates;
create policy availability_templates_trainer_peer_r on public.availability_templates
  for select
  using (exists (
    select 1 from public.trainers t1
     where t1.id = (select auth.uid())
       and public.staff_tenant_of(t1.id) is not null
       and public.staff_tenant_of(t1.id)
             = public.staff_tenant_of(availability_templates.trainer_id)
  ));
