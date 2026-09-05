-- ═══════════════════════════════════════════════════════════════════════════
-- A profile could be deleted and written again as the owner of any gym
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED. Verified after applying, on the live database: the trigger now fires
-- on INSERT, DELETE and UPDATE (tgtype & 28 = 28); `handle_new_user()` is still
-- SECURITY DEFINER so signup is untouched; and the two refusals were proved as
-- the `authenticated` role inside an aborted transaction —
--
--   DELETE=[An account is not deleted by removing its profile. Use Delete My
--           Account in Settings, ...]
--   INSERT=[A profile cannot file itself under a gym. Joining a gym happens by
--           invitation.]
--
-- The count of anon-executable SECURITY DEFINER functions held at 2.
--
-- ── THE HOLE ──────────────────────────────────────────────────────────────
--
-- `guard_profile_identity()` is the rule that says a profile cannot re-role
-- itself and cannot move itself between gyms. It says so in as many words:
--
--     'A profile cannot change its own role. Ask the gym owner to change it
--      for you.'
--     'A profile cannot move itself between gyms. Joining a gym happens by
--      invitation.'
--
-- It is attached like this, and this is the whole of the defect:
--
--     CREATE TRIGGER guard_profile_identity_t
--       BEFORE UPDATE ON public.profiles   -- ← UPDATE. Only UPDATE.
--
-- `profiles_self` is `for all using (id = auth.uid()) with check (id =
-- auth.uid())`, and `authenticated` holds table-level SELECT, INSERT, UPDATE
-- and DELETE on `profiles` with no column ACL narrowing any of them (checked
-- against pg_class.relacl and pg_attribute.attacl on the live database — there
-- are zero column grants on this table). So the two columns the guard exists to
-- protect are unprotected on the two commands it is not attached to.
--
-- Three statements, from any account that can sign in to any of the three apps:
--
--     delete from profiles where id = auth.uid();
--     insert into profiles (id, role, tenant_id, full_name)
--     values (auth.uid(), 'owner', '<the victim gym>', 'x');
--
-- The DELETE passes `profiles_self`'s USING clause. Every foreign key that
-- references `profiles(id)` is ON DELETE CASCADE, SET NULL or SET DEFAULT —
-- there is not one RESTRICT or NO ACTION among them, so nothing refuses the
-- delete (`confdeltype` sweep over pg_constraint, live). The INSERT passes
-- `profiles_self`'s WITH CHECK, because that clause asks one question — "is
-- this row's id your own id?" — and the answer is yes. `role` and `tenant_id`
-- are not looked at by anything: the guard is not on INSERT, and
-- `provision_profile()` (the AFTER INSERT trigger) reads `new.tenant_id`, finds
-- it already set, and skips making a tenant. It validates nothing.
--
-- `is_owner_of(t)` is then satisfied:
--
--     select exists (select 1 from profiles p
--                     where p.id = auth.uid() and p.role = 'owner'
--                       and p.tenant_id = t)
--
-- ── THE TENANT UUID IS NOT A SECRET ───────────────────────────────────────
--
-- The same argument part 2360 made about coach ids. `trainers_public_directory_r`
-- is `for select to authenticated using (listed = true)`, and `tenant_id` is one
-- of the columns `authenticated` holds a column-level SELECT grant on. So:
--
--     select id, tenant_id from trainers where listed = true;
--
-- hands any signed-in account the tenant id of every listed coach's gym. Two
-- coaches are listed on production today, in two distinct tenants.
--
-- ── WHAT THE CALLER GETS ──────────────────────────────────────────────────
--
-- Owner, not staff. Every one of these is a live policy that becomes satisfiable
-- the instant that row exists:
--
--   · `tenants_owner_rw`      — FOR ALL. Read, rewrite and DELETE the gym row:
--                               name, brand, currency, plan, session fee, pay
--                               policy, tax registration, retention years.
--   · `memberships_owner`     — FOR ALL over every membership in the gym.
--   · `mi_owner`              — FOR ALL over `member_invites`: invite anyone,
--                               onto any plan, in that gym's name.
--   · `profiles_owner_tenant_r` and `profiles_owner_r` — every member's and
--                               every coach's profile row.
--   · `clients_owner_r`, `coach_clients_owner_r`, `sessions_owner_r` — the
--                               whole book.
--   · `billing_owner_*`, `cust_read`, `conn_read`, `purch_read`,
--     `client_sub_pay_read`, `sub_read` — the gym's money, and its Stripe
--                               Connect accounts.
--   · `grant_staff_role()` / `revoke_staff_role()` — hire and fire.
--   · `app_errors_owner`      — `is_owner_of(staff_tenant_of(user_id))`.
--
-- ── THE FIX, AND WHY IT IS SHAPED THIS WAY ────────────────────────────────
--
-- The guard gains the two arms it was missing, in the same file and with the
-- same `current_user in ('authenticated','anon')` idiom it already uses — so
-- `handle_new_user()` and every invite-acceptance definer, which run as the
-- function owner, are waved through exactly as they are today. This is the same
-- shape `guard_client_tenant()` already has for `clients`, which DOES cover
-- INSERT; `profiles` is the table it was never copied onto.
--
-- INSERT is refused only when the row arrives carrying a role or a gym. A
-- self-insert of a plain client profile with no tenant is left alone: it is
-- harmless, and refusing it would be a wider rule than the defect needs.
--
-- DELETE is refused outright from the app roles, because that is the half that
-- makes the re-insert reachable at all — a primary key cannot be written twice.
-- Nothing in this repository deletes a profile row: the three settings screens
-- go through `request_account_deletion()`, and the erasure that follows runs as
-- service_role, which this arm does not touch. Verified by grep across app/,
-- src/, studio-web/ and supabase/functions/ — there is no `.from('profiles')`
-- `.delete()` anywhere.
--
-- Callers were enumerated rather than assumed:
--
--   · App: no `.from('profiles').insert(` and no `.from('profiles').delete(`
--     exists in the repository. Every profile write in the app is an UPDATE,
--     and every one of those already passes today's guard.
--   · SQL: the only INSERT into `public.profiles` in any function on the live
--     database is `handle_new_user()`, which is SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.guard_profile_identity()
returns trigger
 language plpgsql
 set search_path = public, pg_temp
as $fn$
begin
  -- A SECURITY DEFINER function runs as its owner, so provisioning and invite
  -- acceptance (the legitimate ways a role or a gym is set) pass. A direct
  -- write from the app does not.
  if current_user in ('authenticated', 'anon') then

    if tg_op = 'INSERT' then
      -- The row that was never checked. `profiles_self`'s WITH CHECK asks only
      -- whether the id is your own, and a profile arriving with a role and a
      -- gym already on it is how an account made itself the owner of somebody
      -- else's gym. Neither column may be chosen here; both are set by
      -- provisioning or by an invitation, and both run as definers.
      if new.tenant_id is not null then
        raise exception 'A profile cannot file itself under a gym. Joining a gym happens by invitation.'
          using errcode = '42501';
      end if;
      if coalesce(new.role, 'client') <> 'client' then
        raise exception 'A profile cannot choose its own role. A coach or an owner account is made by the app it is created in, or by an invitation.'
          using errcode = '42501';
      end if;
      return new;
    end if;

    if tg_op = 'DELETE' then
      -- Deleting your own profile row and writing a new one is the only way to
      -- get past the INSERT arm above, because the id is a primary key. It is
      -- also not how this product deletes an account: request_account_deletion()
      -- is, and the erasure behind it does not run as these roles.
      raise exception 'An account is not deleted by removing its profile. Use Delete My Account in Settings, which schedules the erasure and keeps the records the gym is required to keep.'
        using errcode = '42501';
    end if;

    -- UPDATE. Unchanged from the live definition, transcribed rather than
    -- retyped so the two new arms are provably the only thing this part adds.
    if new.role is distinct from old.role then
      raise exception 'A profile cannot change its own role. Ask the gym owner to change it for you.'
        using errcode = '42501';
    end if;
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'A profile cannot move itself between gyms. Joining a gym happens by invitation.'
        using errcode = '42501';
    end if;
  end if;

  -- `old` on DELETE, `new` otherwise. A BEFORE DELETE trigger that returns
  -- `new` returns NULL, which silently CANCELS the delete for every role —
  -- including the service_role path that is supposed to be able to make it.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;

-- The trigger has to be recreated: it is BEFORE UPDATE today, and the two new
-- arms are unreachable until it also fires on INSERT and DELETE.
--
-- The name is kept. `guard_profile_identity_t` sorts before `trg_profiles_queue_
-- file_purge`, `trg_profiles_release_coach_documents` and `trg_profiles_retain_
-- financial_record` — the three other BEFORE DELETE triggers on this table —
-- and Postgres fires BEFORE triggers in name order, so the refusal happens
-- before any of them starts moving rows about.
drop trigger if exists guard_profile_identity_t on public.profiles;
create trigger guard_profile_identity_t
  before insert or update or delete on public.profiles
  for each row execute function public.guard_profile_identity();

-- Restated because `create or replace` on a function that did not previously
-- exist leaves EXECUTE with PUBLIC, which in a Supabase project includes anon.
-- A trigger function needs no caller at all.
revoke all on function public.guard_profile_identity() from public, anon, authenticated;

-- ── VERIFY AFTER APPLYING ─────────────────────────────────────────────────
--
-- 1. The trigger covers all three commands:
--      select tgtype::int & 28 from pg_trigger where tgname = 'guard_profile_identity_t';
--      -- 28 = INSERT(4) | DELETE(8) | UPDATE(16)
--
-- 2. As a signed-in NON-owner account, each of these must fail with 42501:
--      delete from profiles where id = auth.uid();
--      insert into profiles (id, role) values (auth.uid(), 'owner');
--      insert into profiles (id, tenant_id) values (auth.uid(), '<any tenant>');
--
-- 3. Signing up still works in all three apps — that is `handle_new_user()`
--    running as a definer, and it must still land a profile row with a role.
--
-- 4. `select public.get_advisors('security')` is clean.
