-- ═══════════════════════════════════════════════════════════════════════════
-- Seven policies that ask who you are once per row.
--
-- Part 145 did fifteen of these. Seven were added afterwards and were written
-- in the old form.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- `auth.uid()` written bare in a policy is STABLE, not a constant, so the
-- planner re-evaluates it for every row it tests. Written `(select auth.uid())`
-- it becomes an InitPlan: evaluated once, then compared. Supabase's linter
-- names this `auth_rls_initplan`; part 145's header has the full argument and
-- it does not need restating.
--
-- Seven policies still carry the bare call:
--
--     calendar_links.calendar_links_delete_own      user_id = auth.uid()
--     coach_message_templates.cmt_self              coach_id = auth.uid()
--     notify_channel_prefs.ncp_self                 user_id = auth.uid()
--     owner_sites.owner_sites_self                  user_id = auth.uid()
--     platform_admins.pa_self                       user_id = auth.uid()
--     session_requests.session_requests_client_r    client_id = auth.uid()
--     session_requests.session_requests_coach_r     trainer_id = auth.uid()
--                                                     and is_my_client(client_id)
--
-- ── WHAT THIS COSTS ──────────────────────────────────────────────────────
--
-- Nothing that anybody can see today: these tables hold tens of rows. It costs
-- at the size the product is being built for. `session_requests` is the one
-- that will feel it first — a coach's requests screen scans the table and the
-- second policy calls `is_my_client()`, a definer function, per row on top of
-- the per-row `auth.uid()`.
--
-- This is a PERFORMANCE part. It is filed with the data-boundary audit because
-- it came off the same advisor sweep, and because it is the only class on that
-- sweep worth acting on: the other 823 performance advisories are 635
-- `multiple_permissive_policies`, 95 `unindexed_foreign_keys` and 92
-- `unused_index`, and none of those should be actioned here. See the closing
-- section for why, one class at a time.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- Each policy is re-emitted with its name, command, roles and predicate
-- unchanged except that `auth.uid()` becomes `(select auth.uid())`. This is a
-- pure planner change: the two expressions return the same value for the same
-- caller in every case, so no row that was visible becomes invisible and no row
-- that was hidden becomes readable. `is_my_client()` in the last one is left
-- exactly as it is — it is already a definer function and already evaluated the
-- way part 145 wanted.
--
-- Both `cmt_self` and `ncp_self` are FOR ALL with a WITH CHECK, and both halves
-- are re-emitted; a FOR ALL policy re-created with only its USING clause would
-- silently take the USING as its check, which is the same expression here but
-- is not a thing to leave to inference.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · `multiple_permissive_policies` (635, and 24 of them on a single table) is
--     not touched. Those exist because this schema writes one policy per
--     audience — an owner policy, a coach policy, a client policy — which is
--     exactly what makes the boundary readable and reviewable. Collapsing them
--     into one OR'd predicate per command would trade the property this whole
--     audit depends on for a planner saving on tables with tens of rows. The
--     one duplicate that is a genuine duplicate rather than a second audience,
--     `coach_clients_trainer_rw`, is dropped by part 1901 on its own merits.
--
--   · `unindexed_foreign_keys` (95) and `unused_index` (92) are not touched.
--     Both are measured against a database holding 20 profiles and 10 clients:
--     every index here is "unused" because nothing has used anything, and an
--     index chosen against no data is a guess. These want re-running against
--     real traffic, and adding 95 indexes now would make that reading worse,
--     not better.
--
--   · `auth_db_connections_absolute` is not touched because it cannot be: it is
--     a setting on the Auth server, not SQL. It is real and it is named here so
--     that it is not lost — the Auth server is pinned to at most 10 connections
--     and will not benefit from a larger instance until that is changed to a
--     percentage in the project's Auth settings.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists calendar_links_delete_own on public.calendar_links;
create policy calendar_links_delete_own on public.calendar_links
  for delete
  using (user_id = (select auth.uid()));

drop policy if exists cmt_self on public.coach_message_templates;
create policy cmt_self on public.coach_message_templates
  for all
  using (coach_id = (select auth.uid()))
  with check (coach_id = (select auth.uid()));

drop policy if exists ncp_self on public.notify_channel_prefs;
create policy ncp_self on public.notify_channel_prefs
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists owner_sites_self on public.owner_sites;
create policy owner_sites_self on public.owner_sites
  for select
  using (user_id = (select auth.uid()));

drop policy if exists pa_self on public.platform_admins;
create policy pa_self on public.platform_admins
  for select
  using (user_id = (select auth.uid()));

drop policy if exists session_requests_client_r on public.session_requests;
create policy session_requests_client_r on public.session_requests
  for select
  using (client_id = (select auth.uid()));

drop policy if exists session_requests_coach_r on public.session_requests;
create policy session_requests_coach_r on public.session_requests
  for select
  using (trainer_id = (select auth.uid()) and public.is_my_client(client_id));
