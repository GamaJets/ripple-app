-- ── "AN owner" is not "the owner of THIS row" ───────────────────────────────
--
-- `profiles.role = 'owner'` used to mean the PLATFORM owner — one person, who
-- was genuinely allowed to read everything. 27-owner-portal-access.sql redefined
-- it to mean a GYM owner, scoped to their own tenant, and every policy written
-- from that point on asks the scoped question through is_owner_of(tenant_id).
--
-- The policies written BEFORE that redefinition were never revisited. Nine of
-- them still ask the unscoped question, in one of two spellings:
--
--     exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner')
--     my_role() = 'owner'
--
-- Both mean "is this caller an owner of some gym, anywhere on the platform".
-- Neither mentions the row being read. So the owner of gym A could read gym B's
-- Stripe customer ids, subscription status and invoice amounts, gym B's clients'
-- purchase history, gym B's Connect payout accounts, gym B's coach rosters,
-- gym B's crash logs and gym B's members' written feedback. Every gym owner on
-- the platform is a signed-in user, so this is not a theoretical hole: it is
-- readable today from the app's own Supabase client with no special tooling.
-- 35-class-capacity-and-scope.sql fixed the same mistake inside
-- class_attendance_summary; this file finishes the job for the RLS policies.
--
-- WHY THIS IS NOT A ONE-WORD SWAP. The billing tables (billing_customers,
-- subscriptions, invoices, connect_accounts, client_purchases) have no
-- tenant_id column at all — they are keyed on trainer_id, because they were
-- built when billing was platform→trainer and a gym was not part of the model.
-- Their tenant has to be reached by joining trainers, which is exactly the hop
-- 27-owner-portal-access.sql already makes for sessions:
--
--     exists (select 1 from trainers tr
--              where tr.id = <table>.trainer_id and is_owner_of(tr.tenant_id))
--
-- That join is safe to write inline because `trainers` has trainers_owner_r
-- (is_owner_of(tenant_id)), so an owner can read the rows the join needs.
--
-- DUPLICATES. Several of these tables carry TWO stale policies — the original
-- in 20/21, and a rewrite in 28-fix-profiles-recursion.sql that swapped the
-- profiles sub-select for my_role() without noticing it was preserving an
-- unscoped test. Same policy name in both files for most of them, but
-- `subscriptions` has sub_read (20) AND sub_owner (28) under different names.
-- Permissive policies OR together, so dropping one and leaving the other fixes
-- nothing. Every stale name is dropped below.
--
-- SELF-ACCESS IS PRESERVED. A trainer still reads their own billing, Connect
-- and invoice rows; a client still reads their own purchases; a member still
-- reads their own feedback (fb_own, untouched). Only the owner arm narrows.

-- ── a tenant lookup that does not re-enter RLS ──────────────────────────────
-- Two of the nine tables cannot use the inline trainers join.
--
--   * `coach_clients` would deadlock on it. trainers has
--     trainers_assigned_client_r, whose USING clause reads coach_clients — so a
--     coach_clients policy that reads trainers closes a cycle and Postgres
--     raises "infinite recursion detected in policy for relation". That is the
--     precise failure 28-fix-profiles-recursion.sql existed to remove, and the
--     remedy there applies here: ask through SECURITY DEFINER.
--
--   * `app_errors` reaches its tenant only through profiles, and there is no
--     owner-scoped SELECT policy on profiles — an inline sub-select would
--     return no rows for the very caller it is meant to authorise, silently
--     emptying the owner's crash inbox.
--
-- profiles.tenant_id is the spine (37-member-invites.sql rewrites it, and
-- clients.tenant_id, when a member moves gyms), so it is the right source. The
-- trainers row wins when both exist because trainers.tenant_id is NOT NULL and
-- is what the billing joins above key on; this keeps the two paths agreeing.
create or replace function public.tenant_of_user(u uuid)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select t.tenant_id from trainers t where t.id = u),
    (select p.tenant_id from profiles p where p.id = u)
  );
$function$;

revoke all on function public.tenant_of_user(uuid) from public;
grant execute on function public.tenant_of_user(uuid) to authenticated;

-- ── billing: trainer_id → trainers.tenant_id ────────────────────────────────
-- Stripe customer ids and the email they were opened with. Leaked the identity
-- of every other gym's trainers as Stripe billing contacts.
drop policy if exists cust_read on billing_customers;
create policy cust_read on billing_customers for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = billing_customers.trainer_id and is_owner_of(tr.tenant_id)));

-- Both stale policies dropped: sub_read (20-billing.sql) had the self arm,
-- sub_owner (28) was owner-only. They OR'd, so the pair behaved as one policy
-- and is replaced by one — plan, status and renewal date for a competitor's
-- trainers is commercial intelligence, not gym data.
drop policy if exists sub_read on subscriptions;
drop policy if exists sub_owner on subscriptions;
create policy sub_read on subscriptions for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = subscriptions.trainer_id and is_owner_of(tr.tenant_id)));

-- Invoice amounts and the hosted Stripe URL. The URL is the sharper end of it:
-- it renders a payable invoice document, not just a number.
drop policy if exists inv_read on invoices;
create policy inv_read on invoices for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = invoices.trainer_id and is_owner_of(tr.tenant_id)));

-- Connect payout accounts — which of a rival's trainers can actually take money
-- and which are still stuck in onboarding.
drop policy if exists conn_read on connect_accounts;
create policy conn_read on connect_accounts for select using (
  trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = connect_accounts.trainer_id and is_owner_of(tr.tenant_id)));

-- Client purchases: who bought what, for how much, and how much of the pack is
-- used. The client and the selling trainer keep their own rows; the owner arm
-- now only covers trainers who belong to the owner's gym.
drop policy if exists purch_read on client_purchases;
create policy purch_read on client_purchases for select using (
  client_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or exists (select 1 from trainers tr
              where tr.id = client_purchases.trainer_id and is_owner_of(tr.tenant_id)));

-- ── tables that already carry their tenant, or reach it through a person ────
-- feedback.tenant_id was already being checked — and then undone on the very
-- next line. `is_owner_of(tenant_id) or my_role() = 'owner'` is two permissive
-- arms in one policy: the second is strictly wider than the first, so the
-- scoped test never decided anything. Dropping it is the whole fix. Rows with
-- a null tenant_id are now invisible to owners rather than visible to all of
-- them; their author still reads them via fb_own.
drop policy if exists fb_owner on feedback;
create policy fb_owner on feedback for select using (is_owner_of(tenant_id));

-- Crash logs carry a stack trace and whatever the message happened to contain,
-- attributed to a named user. Scoped through the reporting user's tenant.
-- app_errors_insert allows a null user_id (an error caught before sign-in);
-- those rows have no tenant to belong to and are now readable by nobody
-- through RLS, which is the fail-closed side of the choice.
drop policy if exists app_errors_owner on app_errors;
create policy app_errors_owner on app_errors for select using (
  is_owner_of(tenant_of_user(user_id)));

-- Coach rosters — client names and goals, typed in by hand for people who have
-- no account. coach_clients.trainer_id references auth.users directly and the
-- table has no tenant_id, so the coach's own tenant is the row's tenant. Via
-- tenant_of_user rather than a trainers join: see the note on the function.
drop policy if exists coach_clients_owner_r on coach_clients;
create policy coach_clients_owner_r on coach_clients for select using (
  is_owner_of(tenant_of_user(trainer_id)));

-- ── exercise_videos: deliberately NOT touched here ──────────────────────────
-- The ninth stale policy was exvid_read, whose `or my_role() = 'owner'` arm let
-- any owner read any gym's coaching videos. 38-tenant-isolation.sql — which
-- sorts immediately before this file and therefore runs immediately before it —
-- has already replaced that policy, and answered the underlying question
-- differently: it treats exercise demos as content rather than customer data,
-- opens SELECT to every authenticated user, and scopes WRITES to the gym via
-- `exists (select 1 from trainers tr where tr.id = exercise_videos.trainer_id
-- and is_owner_of(tr.tenant_id))`. Either answer closes the owner leak — 38's
-- version has no owner-specific read arm left to escalate through.
--
-- Re-creating exvid_read here would win purely on filename order and revert a
-- deliberate product decision without either author noticing. So it is left
-- alone on purpose. If the demos-are-private reading is the one you want, the
-- change belongs in 38 next to its own reasoning, not silently after it.
