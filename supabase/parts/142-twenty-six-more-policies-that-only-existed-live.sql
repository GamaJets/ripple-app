-- ─────────────────────────────────────────────────────────────────────────
-- Twenty-six policies the database has and no file did, and nine this repo
-- creates that the database threw away.
--
-- 121-record-the-policies-that-only-existed-live.sql found two of these and
-- said the important part out loud: `check:schema` compares COLUMNS, not
-- policies, so drift of exactly this shape is invisible to the one guard that
-- exists. It found two because two were what that night's argument was about.
-- Tonight the whole catalogue was enumerated instead — every policy live, every
-- policy the bundle creates, matched by name and by table.
--
-- ── Live, in no file (26) ─────────────────────────────────────────────────
--
-- Three tables are the serious ones, because they carry ALL of their access
-- rules here and NONE in the repo:
--
--   programs        programs_client_r, programs_trainer_rw
--   workout_logs    workout_logs_client_rw, workout_logs_trainer_r
--   charges         charges_client_r, charges_owner_r, charges_trainer_rw
--
-- The bundle creates those three tables, enables RLS on them, and stops. A
-- database built from this repo — a new white-label tenant, a staging copy, a
-- local stack — gets three tables with row level security on and not one
-- policy, which denies everybody everything. Not a subtle failure: no client
-- can read a programme, no coach can write one, and nobody can see a charge.
-- Production is fine only because production was never built from these files.
--
-- The remaining twenty are on tables that do have declared policies. Seven of
-- them are strictly redundant with a declared one and are recorded, not
-- endorsed — bc_self ⊂ cust_read, ca_self ⊂ conn_read, sub_self ⊂ sub_read,
-- tp_manage = pkg_write, tp_read_active ⊂ pkg_read, exvid_write =
-- exvid_trainer_rw, profiles_self_rw ≈ profiles_self. They are the reason the
-- performance advisor reports 570 multiple-permissive-policy findings, and
-- dropping them is a separate change with its own evidence to gather. What
-- matters here is that the file stops lying about what is running.
--
-- Six are load-bearing and would be missed at once: clients_owner_r and
-- clients_trainer_update (a coach editing a client's row; an owner reading
-- their gym's clients), tenants_client_r and tenants_trainer_r, and the two
-- profiles reads the trainer directory and the coach-request screen depend on.
--
-- ── In the repo, not in the database (9) ──────────────────────────────────
--
-- The other direction, and it is not harmless either. Each of these was
-- replaced live and the replacement was written down while the drop was not,
-- so the bundle still creates the superseded one alongside its replacement.
-- RLS policies are PERMISSIVE and OR together, so a stale one that nobody
-- removed is not dead weight — it is a second, wider door.
--
--   19-trainer-read-access.sql
--     workouts_trainer_read, meas_trainer_read, checkins_trainer_read,
--     habits_trainer_read   — superseded by the *_coach_read pair that
--     02-domain-schema.sql's loop builds. The difference is the whole point:
--     the new ones say is_my_client(user_id), these say
--     clients.trainer_id = auth.uid() directly, which keeps reading a client's
--     weight, check-ins and habits after the coaching relationship has ended.
--
--   38-tenant-isolation.sql
--     tenants_read      — superseded by tenants_client_r + tenants_trainer_r.
--     avail_self, avail_owner_r
--                       — superseded by availability_templates_trainer_rw,
--                         _client_r and _trainer_peer_r.
--     waitlist_self, waitlist_gym_r
--                       — superseded by session_waitlist_client_r, _client_d,
--                         _trainer_r and _service_rw.
--
--     waitlist_self is the one worth naming. It is FOR ALL on client_id =
--     auth.uid(), so on a fresh deploy a client could INSERT their own waitlist
--     row directly — straight past join_session_waitlist(), which is the
--     SECURITY DEFINER function that decides whether a slot is waitlistable at
--     all and in what position. The live database has no client INSERT policy
--     on session_waitlist, deliberately.
--
-- ── Two live decisions this records without endorsing ─────────────────────
--
-- avail_owner_r let a gym's OWNER read a trainer's working pattern; the live
-- replacements cover the trainer and their same-tenant peers, and an owner who
-- holds no `trainers` row is covered by neither. waitlist_gym_r had an
-- is_owner_of(s.tenant_id) arm that session_waitlist_trainer_r does not. Both
-- are what the live database does today. Recording is not agreeing — if either
-- narrowing was accidental it is now visible enough to argue about.
--
-- ── What this file is ─────────────────────────────────────────────────────
--
-- Every CREATE below was generated from pg_policies on the live project, so
-- the text is the database's own rendering of what it is running, not a
-- reconstruction. Written drop-and-create, so it is a no-op against the live
-- project where all twenty-six already exist, and the nine DROPs are no-ops
-- there too — they are for the next database built from this repo.
-- ─────────────────────────────────────────────────────────────────────────

-- ═══ 1 · the nine the database dropped and the repo kept ═══════════════════

drop policy if exists workouts_trainer_read on public.workouts;
drop policy if exists meas_trainer_read on public.measurements;
drop policy if exists checkins_trainer_read on public.check_ins;
drop policy if exists habits_trainer_read on public.habit_logs;

drop policy if exists tenants_read on public.tenants;
drop policy if exists avail_self on public.availability_templates;
drop policy if exists avail_owner_r on public.availability_templates;
drop policy if exists waitlist_self on public.session_waitlist;
drop policy if exists waitlist_gym_r on public.session_waitlist;

-- ═══ 2 · the twenty-six the database has and no file did ═══════════════════

-- ── availability_templates ────────────────────────────────────────────────
drop policy if exists availability_templates_client_r on public.availability_templates;
create policy availability_templates_client_r on public.availability_templates
  for select
  using ((EXISTS ( SELECT 1
   FROM coach_clients
  WHERE ((coach_clients.trainer_id = availability_templates.trainer_id) AND (coach_clients.id = ( SELECT auth.uid() AS uid))))));

drop policy if exists availability_templates_trainer_peer_r on public.availability_templates;
create policy availability_templates_trainer_peer_r on public.availability_templates
  for select
  using ((EXISTS ( SELECT 1
   FROM trainers t1
  WHERE ((t1.id = ( SELECT auth.uid() AS uid)) AND (t1.tenant_id = ( SELECT trainers.tenant_id
           FROM trainers
          WHERE (trainers.id = availability_templates.trainer_id)))))));

drop policy if exists availability_templates_trainer_rw on public.availability_templates;
create policy availability_templates_trainer_rw on public.availability_templates
  for all
  using ((( SELECT auth.uid() AS uid) = trainer_id));

-- ── billing_customers ─────────────────────────────────────────────────────
drop policy if exists bc_self on public.billing_customers;
create policy bc_self on public.billing_customers
  for select
  using ((trainer_id = ( SELECT auth.uid() AS uid)));

-- ── charges ───────────────────────────────────────────────────────────────
drop policy if exists charges_client_r on public.charges;
create policy charges_client_r on public.charges
  for select
  using ((client_id = ( SELECT auth.uid() AS uid)));

drop policy if exists charges_owner_r on public.charges;
create policy charges_owner_r on public.charges
  for select
  using ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = charges.client_id) AND is_owner_of(c.tenant_id)))));

drop policy if exists charges_trainer_rw on public.charges;
create policy charges_trainer_rw on public.charges
  for all
  using ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = charges.client_id) AND (c.trainer_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = charges.client_id) AND (c.trainer_id = ( SELECT auth.uid() AS uid))))));

-- ── clients ───────────────────────────────────────────────────────────────
drop policy if exists clients_owner_r on public.clients;
create policy clients_owner_r on public.clients
  for select
  using (is_owner_of(tenant_id));

drop policy if exists clients_trainer_update on public.clients;
create policy clients_trainer_update on public.clients
  for update
  using ((trainer_id = ( SELECT auth.uid() AS uid)))
  with check ((trainer_id = ( SELECT auth.uid() AS uid)));

-- ── connect_accounts ──────────────────────────────────────────────────────
drop policy if exists ca_self on public.connect_accounts;
create policy ca_self on public.connect_accounts
  for select
  using ((trainer_id = ( SELECT auth.uid() AS uid)));

-- ── exercise_videos ───────────────────────────────────────────────────────
drop policy if exists exvid_write on public.exercise_videos;
create policy exvid_write on public.exercise_videos
  for all
  using ((trainer_id = ( SELECT auth.uid() AS uid)))
  with check ((trainer_id = ( SELECT auth.uid() AS uid)));

-- ── profiles ──────────────────────────────────────────────────────────────
drop policy if exists profiles_owner_tenant_r on public.profiles;
create policy profiles_owner_tenant_r on public.profiles
  for select
  using (((tenant_id IS NOT NULL) AND is_owner_of(tenant_id)));

drop policy if exists profiles_public_directory_r on public.profiles;
create policy profiles_public_directory_r on public.profiles
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM trainers t
  WHERE ((t.id = profiles.id) AND (t.listed = true)))));

drop policy if exists profiles_requesting_client_r on public.profiles;
create policy profiles_requesting_client_r on public.profiles
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.client_id = profiles.id) AND (cr.trainer_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'pending'::text)))));

drop policy if exists profiles_self_rw on public.profiles;
create policy profiles_self_rw on public.profiles
  for all
  using ((( SELECT auth.uid() AS uid) = id));

-- ── programs ──────────────────────────────────────────────────────────────
drop policy if exists programs_client_r on public.programs;
create policy programs_client_r on public.programs
  for select
  using ((client_id = ( SELECT auth.uid() AS uid)));

drop policy if exists programs_trainer_rw on public.programs;
create policy programs_trainer_rw on public.programs
  for all
  using ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = programs.client_id) AND (c.trainer_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = programs.client_id) AND (c.trainer_id = ( SELECT auth.uid() AS uid))))));

-- ── session_waitlist ──────────────────────────────────────────────────────
drop policy if exists session_waitlist_service_rw on public.session_waitlist;
create policy session_waitlist_service_rw on public.session_waitlist
  for all
  using ((auth.role() = 'service_role'::text));

drop policy if exists session_waitlist_trainer_r on public.session_waitlist;
create policy session_waitlist_trainer_r on public.session_waitlist
  for select
  using ((EXISTS ( SELECT 1
   FROM sessions s
  WHERE ((s.id = session_waitlist.session_id) AND (s.trainer_id = ( SELECT auth.uid() AS uid))))));

-- ── subscriptions ─────────────────────────────────────────────────────────
drop policy if exists sub_self on public.subscriptions;
create policy sub_self on public.subscriptions
  for select
  using ((trainer_id = ( SELECT auth.uid() AS uid)));

-- ── tenants ───────────────────────────────────────────────────────────────
drop policy if exists tenants_client_r on public.tenants;
create policy tenants_client_r on public.tenants
  for select
  using ((EXISTS ( SELECT 1
   FROM (coach_clients cc
     JOIN trainers t ON ((t.id = cc.trainer_id)))
  WHERE ((t.tenant_id = tenants.id) AND (cc.id = ( SELECT auth.uid() AS uid))))));

drop policy if exists tenants_trainer_r on public.tenants;
create policy tenants_trainer_r on public.tenants
  for select
  using ((EXISTS ( SELECT 1
   FROM trainers
  WHERE ((trainers.tenant_id = tenants.id) AND (trainers.id = ( SELECT auth.uid() AS uid))))));

-- ── trainer_packages ──────────────────────────────────────────────────────
drop policy if exists tp_manage on public.trainer_packages;
create policy tp_manage on public.trainer_packages
  for all
  using ((trainer_id = ( SELECT auth.uid() AS uid)))
  with check ((trainer_id = ( SELECT auth.uid() AS uid)));

drop policy if exists tp_read_active on public.trainer_packages;
create policy tp_read_active on public.trainer_packages
  for select
  using ((active = true));

-- ── workout_logs ──────────────────────────────────────────────────────────
drop policy if exists workout_logs_client_rw on public.workout_logs;
create policy workout_logs_client_rw on public.workout_logs
  for all
  using ((client_id = ( SELECT auth.uid() AS uid)))
  with check ((client_id = ( SELECT auth.uid() AS uid)));

drop policy if exists workout_logs_trainer_r on public.workout_logs;
create policy workout_logs_trainer_r on public.workout_logs
  for select
  using ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = workout_logs.client_id) AND (c.trainer_id = ( SELECT auth.uid() AS uid))))));
