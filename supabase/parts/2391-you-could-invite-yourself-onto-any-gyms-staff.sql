-- ═══════════════════════════════════════════════════════════════════════════
-- You could invite yourself onto any gym's staff
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED. Verified after applying: `ti_owner`'s WITH CHECK now reads
-- ((owner_id = auth.uid()) AND ((tenant_id IS NULL) OR is_owner_of(tenant_id))),
-- both not-blank constraints exist, anon cannot execute the function and
-- authenticated can, and the count of anon-executable SECURITY DEFINER
-- functions held at 2.
--
-- Read the note on the single live `trainer_invites` row at the foot: this part
-- refuses it, and refusing it is the point.
--
-- ── THE HOLE ──────────────────────────────────────────────────────────────
--
-- `trainer_invites` is the owner→coach invitation. Its write policy, unchanged
-- since part 12, is:
--
--     create policy ti_owner on trainer_invites for all
--       using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
-- `owner_id = auth.uid()` is not evidence of anything. It is the same sentence
-- part 2360 took apart in `link_coaching`: it says "I am the person I say I
-- am", which every caller can say about themselves. The column that decides
-- WHICH GYM the invitation staffs — `tenant_id` — is not mentioned by that
-- policy, is not mentioned by any constraint, and there is no trigger on this
-- table at all (checked against pg_trigger on the live database).
--
-- `authenticated` holds table-level INSERT on `trainer_invites` with no column
-- ACL narrowing it. So, from any account that can sign in to any of the three
-- apps:
--
--     insert into trainer_invites (owner_id, tenant_id, email, status)
--     values (auth.uid(), '<the victim gym>', '<my own email address>', 'pending')
--     returning id;
--
--     select accept_trainer_invite('<that id>');
--
-- `accept_trainer_invite` then checks the two things it checks — that the
-- invite's email matches the caller's address on `auth.users`, and that the
-- status is `pending` (part 1080 added the second) — and both are satisfied,
-- because the caller wrote both values a moment ago. It never asks the one
-- question that matters: whether the person who sent the invitation had any
-- standing in the gym it names.
--
--     ten := coalesce(inv.tenant_id, (select tenant_id from profiles where id = inv.owner_id));
--     update profiles set role = 'trainer', tenant_id = coalesce(ten, tenant_id) where id = auth.uid();
--     insert into trainers (id, tenant_id) values (auth.uid(), ten) on conflict ...
--     insert into trainer_billing (trainer_id, tenant_id, plan, mrr, status)
--       values (auth.uid(), ten, 'Pro', 0, 'trial') on conflict do nothing;
--
-- It is SECURITY DEFINER, so `guard_profile_identity` and `guard_trainer_tenant`
-- — the two triggers whose entire job is to stop an account moving itself
-- between gyms — both wave it through. They are the rule; this function is the
-- way around it, exactly as part 2360 described for `link_coaching`.
--
-- ── THE TENANT UUID IS NOT A SECRET ───────────────────────────────────────
--
-- `trainers_public_directory_r` is `for select to authenticated using (listed =
-- true)`, and `tenant_id` is one of the columns `authenticated` holds a
-- column-level SELECT grant on. `select id, tenant_id from trainers where
-- listed = true` hands any signed-in account the gym id of every listed coach.
-- Two coaches are listed on production today.
--
-- ── WHAT THE CALLER GETS ──────────────────────────────────────────────────
--
-- `my_tenant()` becomes the victim's gym and `my_role()` becomes 'trainer'.
-- Every staff policy in this schema is written on those two facts. Live, today:
--
--   · `gym_member_records` / `gym_member_notes` — the gym's own record of every
--     member, and the staff notes written about them.
--   · `gym_visits` — SELECT, INSERT and UPDATE. Attendance, rewritten.
--   · `gym_passes`, `gym_pass_types`, and `gym_pass_redemptions` on INSERT —
--     a stranger can spend a member's pass.
--   · `class_bookings_staff_r` / `_staff_u` — read and alter other people's
--     class bookings.
--   · `gym_shifts` (the rota), `gym_equipment` + its log (read and write),
--     `member_interventions` (read and write), `gym_documents` on INSERT.
--   · `tenants_trainer_r` — the gym row: currency, plan, session fee, pay
--     policy, tax registration, retention years.
--   · `profiles_trainer_r_peers` and `trainers_peer_r` — every coach in the gym.
--   · `availability_templates_trainer_peer_r` — every peer coach's whole
--     template.
--   · `membership_plans_tenant_r`, `gym_agreements_tenant_r`, `announcements`,
--     `challenges`.
--
-- And two things the owner sees rather than merely loses: a `trainer_billing`
-- row on the 'Pro' plan in trial, against their tenant, which the owner's
-- billing screen reads under `billing_read` — a coach on the books that nobody
-- hired; and `gym_event_trainer_joined` writing "<name> joined as a coach" into
-- the gym's event feed.
--
-- ── WHY `member_invites` IS NOT AFFECTED, AND WHAT THAT PROVES ────────────
--
-- The sibling table has the check this one is missing:
--
--     create policy mi_owner on member_invites for all
--       using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));
--
-- Same product, same screen family, same shape of row — and it asks about the
-- TENANT rather than about the caller's own id. This part gives
-- `trainer_invites` the same requirement. `coach_invites` needs nothing: its
-- `coach_id` is the caller's own id and the only thing it can name is the
-- caller, so `ci_coach` says all there is to say.
--
-- ── THE FIX, AND WHY IT IS IN TWO PLACES ──────────────────────────────────
--
-- The policy stops the row being written. The function stops a row already
-- written from being spent — including the one already on the live database
-- (see below), and including the case where the sender was a legitimate owner
-- when they sent it and has since been removed by `revoke_staff_role()`. Part
-- 1080 made the same argument about the status column: the invitation is a
-- claim, and it has to be re-checked at the moment it is redeemed, not only at
-- the moment it is made.
--
-- Callers were enumerated rather than assumed, from both ends:
--
--   · App: the only insert into `trainer_invites` is `sendTrainerInvite` in
--     src/ui/trainerInvites.tsx, reached from exactly one screen —
--     app/(owner)/trainers.tsx. It sends `tenant_id` read from the signed-in
--     owner's own `profiles` row, so `is_owner_of(tenant_id)` is true for it by
--     construction. `revokeTrainerInvite` is an UPDATE that does not touch
--     `tenant_id`, so the tightened WITH CHECK passes for it too.
--   · SQL: `pg_get_functiondef` across every function in `public` names
--     `trainer_invites` in one function only — `accept_trainer_invite`.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists ti_owner on public.trainer_invites;
create policy ti_owner on public.trainer_invites for all
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    -- The column the old policy never looked at. `is_owner_of` is the same
    -- function `mi_owner` uses on the sibling table, and it asks the question
    -- that matters: is this caller the OWNER of the gym this invitation staffs?
    and (tenant_id is null or public.is_owner_of(tenant_id))
  );

create or replace function public.accept_trainer_invite(p_invite uuid)
returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare inv trainer_invites; my_email text; ten uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into my_email from auth.users where id = auth.uid();
  select * into inv from trainer_invites where id = p_invite;
  if inv.id is null then raise exception 'invite not found'; end if;
  if lower(inv.email) <> lower(coalesce(my_email, '')) then
    raise exception 'invite not addressed to you';
  end if;

  -- Part 1080's arms, unchanged.
  if inv.status = 'accepted' then
    return;
  elsif inv.status <> 'pending' then
    raise exception 'invite was withdrawn';
  end if;

  ten := coalesce(inv.tenant_id, (select tenant_id from profiles where id = inv.owner_id));

  -- ── The question this function never asked ─────────────────────────────
  --
  -- Re-checked here and not only in the policy, because a row can outlive the
  -- standing of the person who wrote it: `revoke_staff_role()` clears an
  -- owner's tenant, and every invitation they had sent would otherwise still
  -- be a live key to the gym. Asked of the INVITER, not of the caller — the
  -- caller is the invitee and is not supposed to have any standing yet, which
  -- is the whole point of being invited.
  if ten is not null and not exists (
    select 1 from public.profiles p
     where p.id = inv.owner_id
       and p.role = 'owner'
       and p.tenant_id = ten
  ) then
    raise exception 'that invitation does not come from the gym it names'
      using errcode = '42501',
            hint = 'ask the gym owner to send it again from their own account';
  end if;

  update profiles set role = 'trainer', tenant_id = coalesce(ten, tenant_id) where id = auth.uid();
  if ten is not null then
    insert into trainers (id, tenant_id) values (auth.uid(), ten)
      on conflict (id) do update set tenant_id = excluded.tenant_id;
    insert into trainer_billing (trainer_id, tenant_id, plan, mrr, status)
      values (auth.uid(), ten, 'Pro', 0, 'trial')
      on conflict (trainer_id) do nothing;
  end if;
  update trainer_invites
     set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
   where id = p_invite;
end $fn$;

-- Restated because `create or replace` on a function that did not previously
-- exist leaves EXECUTE with PUBLIC, which in a Supabase project includes anon.
revoke all on function public.accept_trainer_invite(uuid) from public, anon;
grant execute on function public.accept_trainer_invite(uuid) to authenticated;

-- ── AND WHILE WE ARE HERE: THE BLANK ADDRESS ──────────────────────────────
--
-- The same asymmetry, one column along. `member_invites` carries
--
--     CHECK (btrim(email) <> '')          -- member_invites_email_not_blank
--
-- and reads itself with `lower(NULLIF(auth.jwt() ->> 'email', ''))`. Its two
-- siblings carry neither: no not-blank constraint, and `lower(COALESCE(auth.jwt()
-- ->> 'email', ''))` in `ci_invitee_read` and `ti_invitee_read`.
--
-- COALESCE-to-empty is the difference. A phone signup has no email address —
-- `auth.users.email` is null and the claim is absent from the JWT — so for
-- every phone-created account both of those policies evaluate to
-- `lower(email) = ''`, and an invitation whose `email` column is the empty
-- string is addressed to ALL OF THEM. The accept functions agree with the
-- policy: `lower(inv.email) <> lower(coalesce(my_email, ''))` is `'' <> ''`,
-- which is false, so the guard does not fire and the invitation is taken.
--
-- Nothing in the app writes a blank address (`sendTrainerInvite` returns early
-- on an empty string, and the coach sheet screens the same way), and there are
-- no blank rows on production today — zero of one on `trainer_invites`, zero of
-- zero on `coach_invites`. But `authenticated` can INSERT into both tables
-- directly, and the column that decides who an invitation is FOR should not
-- depend on the client having been polite about it. The constraint is what
-- makes it not depend on that, and it is the one the sibling table has had all
-- along.
alter table public.coach_invites
  drop constraint if exists coach_invites_email_not_blank;
alter table public.coach_invites
  add constraint coach_invites_email_not_blank check (btrim(email) <> '');

alter table public.trainer_invites
  drop constraint if exists trainer_invites_email_not_blank;
alter table public.trainer_invites
  add constraint trainer_invites_email_not_blank check (btrim(email) <> '');

-- ── THE ONE LIVE ROW, AND WHAT THIS PART DOES TO IT ───────────────────────
--
-- `trainer_invites` holds exactly one row on production and it is pending:
--
--   id        70850639-4f67-4a85-84db-7c1f876eb664
--   owner_id  759c8d25-4d50-4a5c-bdb5-806bcad18ac1  — whose profile role is
--                                                     'client', not 'owner'
--   tenant_id 4a718f6f-2265-47f1-81aa-865904bf0167  — that client account's own
--                                                     one-person tenant
--
-- After this part it can no longer be accepted, and it should not be: a client
-- account sent an invitation that would attach a coach to a personal tenant.
-- Whether it is a leftover test or not, it is the defect with a row attached.
-- Delete it, or have the real gym owner send the invitation from their own
-- account.
--
-- ── VERIFY AFTER APPLYING ─────────────────────────────────────────────────
--
-- 1. As a signed-in non-owner, this must be refused by RLS:
--      insert into trainer_invites (owner_id, tenant_id, email)
--      values (auth.uid(), '<a gym you do not own>', '<your address>');
--
-- 2. As a gym owner, sending a coach invitation from app/(owner)/trainers.tsx
--    still works, and revoking one still works.
--
-- 3. `select accept_trainer_invite('70850639-4f67-4a85-84db-7c1f876eb664')`
--    raises 42501 rather than attaching anybody.
--
-- 4. The count of anon-executable SECURITY DEFINER functions still holds at 2
--    — `leave_my_details` and `public_coach_page`, the two deliberate entry
--    points — and `select public.get_advisors('security')` is clean.
