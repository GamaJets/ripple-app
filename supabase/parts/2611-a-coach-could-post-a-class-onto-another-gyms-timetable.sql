-- ═══════════════════════════════════════════════════════════════════════════
-- A coach could post a class onto another gym's timetable
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written to be applied by hand, and the advisors must be re-run
-- afterwards — applying SQL is not finished until get_advisors is clean.
--
-- Every fact below was read out of the LIVE database on 8 Sep 2026 with
-- pg_policies, pg_class, pg_attribute, pg_constraint, pg_trigger, pg_proc,
-- has_table_privilege, has_column_privilege and information_schema.column_
-- privileges — not out of the parts, which are a build log rather than the
-- truth. Nothing here was written; the whole audit was read-only.
--
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- A gym owner opens the timetable and there is a 06:00 class on it that
-- nobody at the gym put there. It has a title, a room, a capacity and a
-- start time, all typed by somebody who does not work at that gym. Members
-- see it — `gym_classes_read` is `tenant_id = my_tenant()`, so every member
-- and every member of staff at that gym reads it — and they can book it.
-- The owner cannot take it down from the coach app either, because
-- `gym_classes_write` is scoped to `trainer_id`, not to the gym: the class
-- belongs, as far as the row policies are concerned, to the person who
-- injected it. `gym_classes_owner_rw` does let the owner delete it, so the
-- damage is repairable — but it is repairable one row at a time, by hand,
-- after somebody has already turned up at 06:00.
--
-- The same hole in the other direction is quieter and worse. A trainer who
-- really does work at the gym can take one of their own classes OFF the
-- board by pointing its `tenant_id` at some other tenant. The class stops
-- being visible to the gym, its bookings stop being visible to the gym
-- (`class_bookings_staff_r` and `class_bookings_owner_r` both join through
-- `gym_classes.tenant_id`), and the gym's own attendance and class-pay
-- reads stop counting it. That is the shape part 30's `tenant_id` was added
-- to prevent, arriving through the write side instead of the read side.
--
-- ── The chain, exactly as it stands live ──────────────────────────────────
--
-- `public.gym_classes` carries four permissive policies. Two are the gym's:
--
--     gym_classes_owner_rw   FOR ALL     USING/CHECK is_owner_of(tenant_id)
--     gym_classes_read       FOR SELECT  USING      (tenant_id = my_tenant())
--     gym_classes_mine_r     FOR SELECT  USING      (id IN (my_class_history()))
--
-- and one is the coach's, and it is the one that does not mention the gym:
--
--     gym_classes_write      FOR ALL     USING      (trainer_id = auth.uid())
--                                        WITH CHECK (trainer_id = auth.uid())
--
-- `authenticated` holds column-level INSERT and UPDATE on `gym_classes`, and
-- `tenant_id` is one of the granted columns — verified, not assumed:
--
--   select has_column_privilege('authenticated','public.gym_classes','tenant_id','INSERT'),
--          has_column_privilege('authenticated','public.gym_classes','tenant_id','UPDATE');
--   -- t, t
--
-- So `tenant_id` is a caller-supplied field on a row whose only check is
-- "the trainer is me". Nothing in the WITH CHECK, and nothing in the CHECK
-- constraints (`gym_classes_status_check` is the only one, and it is about
-- `status`), asks whether the caller has anything to do with that gym. The
-- foreign key `gym_classes_tenant_id_fkey` asks only that the tenant exist.
--
-- ── Why the trigger does not save it ──────────────────────────────────────
--
-- There IS a BEFORE INSERT OR UPDATE trigger on the table, and it is the
-- reason this reads as safe at a glance. It is not a guard. Read live:
--
--   CREATE FUNCTION public.gym_classes_fill_tenant() ... SECURITY DEFINER AS $$
--   begin
--     if new.tenant_id is null and new.trainer_id is not null then
--       select p.tenant_id into new.tenant_id from public.profiles p
--        where p.id = new.trainer_id;
--     end if;
--     return new;
--   end $$;
--
-- `if new.tenant_id is null` — it FILLS a blank, it does not OVERRIDE a
-- value. A caller who sends a tenant_id keeps the tenant_id they sent.
--
-- Every sibling table in this schema got the other kind of trigger, and the
-- contrast is the whole finding. All four were read live:
--
--   guard_session_tenant()  on sessions  — INSERT: `new.tenant_id :=
--       staff_tenant_of(new.trainer_id)`, unconditionally, for authenticated
--       and anon. UPDATE: raises 42501 on any change to tenant_id.
--   guard_trainer_tenant()  on trainers  — INSERT: raises unless
--       new.tenant_id = my_tenant(). UPDATE: raises on any change.
--   guard_client_tenant()   on clients   — INSERT: raises unless null.
--       UPDATE: raises on any change.
--   guard_profile_identity() on profiles — INSERT: raises unless null, and
--       raises on any self-chosen role. UPDATE: raises on role or tenant.
--
-- Four hard guards and one fill. `gym_classes` is the one that was missed.
--
-- ── How far the reach goes ────────────────────────────────────────────────
--
-- `gym_classes.trainer_id` is a foreign key to `trainers(id)`, so a caller
-- needs a `trainers` row before they can use `gym_classes_write` at all.
-- That is a smaller obstacle than it sounds, and section 2 below is about
-- why: `trainers_self_rw` is FOR ALL on `(select auth.uid()) = id` with no
-- WITH CHECK of its own, `authenticated` holds column-level INSERT on
-- `trainers` including `id`, `tenant_id` and `listed`, and no code in this
-- repository ever inserts into `trainers` from a client session. So any
-- signed-in account can make itself one and then write classes.
--
-- Reachability, stated plainly rather than blurred together:
--
--   Exploitable today, by a real gym trainer: yes. Insert with any
--     `tenant_id`, or PATCH `tenant_id` on a class they already own.
--   Exploitable today, by an ordinary member: yes, in two calls — POST
--     /rest/v1/trainers {"id":"<me>","tenant_id":"<my own gym>"} passes
--     `guard_trainer_tenant`, then POST /rest/v1/gym_classes with
--     `trainer_id = me` and any `tenant_id` they like.
--   Exploitable by `anon`: no. `auth.uid()` is null, `trainer_id = null` is
--     null rather than true, and every helper this table's policies call is
--     SECURITY DEFINER with EXECUTE revoked from anon.
--
--   `public.gym_classes` holds 0 rows and `public.class_bookings` holds 0
--   rows on the day this was written. That changes the urgency and not the
--   correctness: the timetable ships, `src/ui/classes.tsx` and
--   `src/lib/gymSchedule.ts` both write to it, and 22 tenants exist.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- 1 · A guard trigger beside the fill trigger, exactly as `sessions` has one
--     beside `sessions_fill_tenant`. Not a replacement for
--     `gym_classes_fill_tenant`: that function is SECURITY DEFINER and fills
--     blanks for the service role too, and it stays as it is. BEFORE row
--     triggers fire in name order, so `guard_gym_class_tenant_t` runs first
--     and the fill then finds nothing left to do — the same ordering
--     `guard_session_tenant_t` and `trg_sessions_fill_tenant` already have.
--
--     The guard has to know about the owner, because the owner is the one
--     legitimate caller who names a tenant explicitly:
--     `createClass`/`createSeries` in src/lib/gymSchedule.ts send
--     `row(tenantId, c)` from the studio. So: if the caller owns the tenant
--     they sent, it stands; otherwise it is replaced by the gym the trainer
--     actually works at. The coach app's own insert
--     (src/ui/classes.tsx:447) sends no tenant_id at all and is unaffected.
--
--     `updateClass`/`patchRow` in src/lib/gymSchedule.ts never send
--     tenant_id, so refusing to move a class between gyms breaks no caller.
--
-- 2 · The write grants on `public.trainers` that nobody uses.
--
--     `trainers` rows are created in exactly three places, all of them
--     SECURITY DEFINER functions owned by `postgres`, which table grants do
--     not touch: `provision_profile()` (on profile insert, when role =
--     'trainer'), `accept_trainer_invite()` and `grant_staff_role()`.
--     Grepped across src/, app/, studio-web/src/ and supabase/functions/:
--     there is no insert into `trainers` and no delete from `trainers`
--     anywhere in this repository, and no SQL function contains `delete from
--     trainers` either. The verbs are open at the REST endpoint and nobody
--     asked for them.
--
--     What they buy an attacker: the `trainers` row that `gym_classes`'
--     foreign key wants (section 1), and a listing in the in-app coach
--     directory — `trainers_public_directory_r` is `USING (listed = true)`,
--     `listed` is in the authenticated INSERT column grant, and
--     app/(client)/trainers.tsx reads the directory as
--     `.from('trainers').select(...).eq('listed', true)` without ever asking
--     what `profiles.role` says. The public web page is out of reach —
--     `public_handle` and `public_page` are not in any grant the app role
--     holds, and `public_page_follows_listing()` forces `public_page` false
--     without a handle — so this stops at the in-app directory.
--
--     UPDATE stays: it is column-granted and it is how a coach edits their
--     own bio, brand, fee and logo (src/ui/coachProfile.tsx, coachBrand.ts,
--     coachLogo.ts, coachDelivery.ts, sessions.tsx). INSERT and DELETE go.
--
--     `anon` additionally holds TABLE-level INSERT, UPDATE and DELETE on
--     `trainers` — table-level, not the column-level grants `authenticated`
--     has, which is the fingerprint of a revoke that took SELECT away and
--     left the write verbs behind. It is not exploitable today, because
--     `trainers_self_rw` is `(select auth.uid()) = id` and that is null for
--     anon. It is revoked here so it cannot become exploitable the day
--     somebody writes a policy that does not think about anon.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · a class's gym follows the coach, or the owner who put it up ────────

create or replace function public.guard_gym_class_tenant()
returns trigger
language plpgsql
-- Fixed search_path, not the default: this function's whole job is to be the
-- thing that says no, and one that resolves `public.is_owner_of` through a
-- mutable path can be pointed at a shadowing object by whoever controls the
-- caller's search_path. get_advisors raises `function_search_path_mutable`
-- on the alternative.
set search_path = public, pg_temp
as $$
begin
  -- SECURITY DEFINER callers run as `postgres`, so provisioning, imports and
  -- every service-role write pass untouched. A direct write from the app does
  -- not. The same test `guard_session_tenant`, `guard_trainer_tenant`,
  -- `guard_client_tenant` and `guard_profile_identity` already use.
  if current_user in ('authenticated', 'anon') then

    if tg_op = 'INSERT' then
      -- The owner is the one caller who names a gym on purpose: the studio's
      -- createClass/createSeries send row(tenantId, c). If the tenant they
      -- sent is theirs, it stands. Everybody else gets the gym their staff
      -- record says they work at, whatever they sent — which for the coach
      -- app, sending no tenant_id at all, is the same answer it gets today.
      if not public.is_owner_of(new.tenant_id) then
        new.tenant_id := public.staff_tenant_of(new.trainer_id);
      end if;

    elsif new.tenant_id is distinct from old.tenant_id then
      raise exception
        'A class''s gym is set when the class is created and does not move afterwards.'
        using errcode = '42501';
    end if;

  end if;
  return new;
end;
$$;

-- SECURITY INVOKER (the default), like the four guards it copies: it needs no
-- privilege of its own, and the two helpers it calls are already SECURITY
-- DEFINER with EXECUTE held by `authenticated` and revoked from `anon`.
revoke all on function public.guard_gym_class_tenant() from public, anon;

comment on function public.guard_gym_class_tenant() is
  'A class belongs to the gym its coach works at, or to the gym of the owner who put it on the board. Before part 2611 gym_classes.tenant_id was a caller-supplied column checked by nothing: gym_classes_write asks only that trainer_id = auth.uid(), and gym_classes_fill_tenant fills a blank rather than overriding a value, so any account with a trainers row could post a class onto any gym''s timetable, or move one of its own off its gym''s board.';

drop trigger if exists guard_gym_class_tenant_t on public.gym_classes;
-- Named to sort before trg_gym_classes_fill_tenant: BEFORE row triggers fire
-- in name order, the guard settles the tenant, and the fill then finds it set.
create trigger guard_gym_class_tenant_t
  before insert or update on public.gym_classes
  for each row execute function public.guard_gym_class_tenant();

-- ── 2 · the write verbs on `trainers` that no caller asked for ────────────

revoke insert, delete on public.trainers from authenticated;
revoke insert, update, delete on public.trainers from anon;

comment on table public.trainers is
  'A coach''s own record. Rows are created ONLY by provision_profile(), accept_trainer_invite() and grant_staff_role(), all SECURITY DEFINER and owned by postgres, so table grants do not reach them. No app role holds INSERT or DELETE. Before part 2611 `authenticated` held both, and trainers_self_rw is FOR ALL on auth.uid() = id, so any signed-in member could file themselves as a coach — which put them in the in-app directory (trainers_public_directory_r is USING (listed = true), and listed is grantable) and satisfied the foreign key gym_classes.trainer_id needs. `anon` additionally held table-level INSERT, UPDATE and DELETE left behind by the revoke that column-granted SELECT.';

-- ── verify, after applying ────────────────────────────────────────────────
--
-- The advisors first, because this part creates a function and applying SQL
-- is not finished until they are clean:
--
--   get_advisors(type: 'security')   -- expect no new finding, and in
--   get_advisors(type: 'performance')-- particular no anon_security_definer_
--                                    -- function_executable and no
--                                    -- function_search_path_mutable
--
-- Expect two BEFORE row triggers on gym_classes, the guard sorting first:
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.gym_classes'::regclass
--      and not tgisinternal and (tgtype & 2) > 0
--    order by tgname;
--   -- guard_gym_class_tenant_t, trg_gym_classes_fill_tenant
--
-- Expect SELECT and UPDATE for authenticated on trainers and nothing at all
-- for anon:
--
--   select grantee, string_agg(distinct privilege_type, ',' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'trainers'
--      and grantee in ('anon', 'authenticated')
--    group by grantee;
--   -- authenticated | SELECT,UPDATE      (both column-level)
--   -- anon          | (no row)
--
-- Then prove the guard fires rather than assume it. As a real gym trainer,
-- against /rest/v1, with <other> any tenant that is not theirs:
--
--   post  gym_classes {"trainer_id":"<me>","title":"probe",
--                      "starts_at":"2026-12-01T06:00:00Z",
--                      "tenant_id":"<other>"}
--   -- expect the row to come back with tenant_id = the trainer's OWN gym,
--   -- not <other>. It is not refused, it is corrected: an insert whose only
--   -- fault is a field the caller should never have been sending is better
--   -- corrected than bounced, and the studio's own inserts rely on it.
--
--   patch gym_classes?id=eq.<a class of mine> {"tenant_id":"<other>"}
--   -- expect 42501: A class's gym is set when the class is created and does
--   -- not move afterwards.
--
-- And prove the two paths that must still work still do:
--
--   -- coach app, src/ui/classes.tsx:447 — no tenant_id sent
--   post  gym_classes {"trainer_id":"<me>","title":"t",
--                      "starts_at":"2026-12-01T07:00:00Z"}
--   -- expect tenant_id filled with the trainer's gym, as before.
--
--   -- studio, src/lib/gymSchedule.ts createClass — owner names their own gym
--   post  gym_classes {"tenant_id":"<my gym>","title":"t",
--                      "starts_at":"2026-12-01T08:00:00Z","trainer_id":null}
--   -- expect tenant_id = <my gym>, kept rather than blanked. This is the one
--   -- the guard would break if is_owner_of were left out of it, because
--   -- staff_tenant_of(null) is null and the class would fall off the board.
--
-- Finally, that a member can no longer make themselves a coach:
--
--   post  trainers {"id":"<me>","tenant_id":"<my gym>"}
--   -- expect 42501 permission denied for table trainers.
