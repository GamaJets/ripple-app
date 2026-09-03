-- A member of a white-label gym reads the supplier's name on the card they hold
-- up at the door.
--
-- ── What is on that card ──────────────────────────────────────────────────
--
-- `app/(client)/access.tsx` prints "{appName} ID {memberNo}" full-screen, and
-- `app/(client)/membership.tsx` prints the same pair. `appName` comes from
-- `useBrand()`, which seeds from the BUILD — `VARIANT_LABEL[VARIANT]` — and is
-- only ever replaced by `adoptGymName`, whose only callers are on an owner
-- screen no member opens. The member number is derived from the same string:
-- `memberPrefix` in src/lib/membership.ts takes its first three letters.
--
-- So a chain that paid for a white-label app hands its members a card reading
-- "Repple ID REP-4417", and the two screens a member actually shows to staff
-- are the two that announce a company the member has never heard of.
--
-- ── Why a definer function ────────────────────────────────────────────────
--
-- The gym's name is `tenants.name`, and a member cannot read it.
-- `tenants_client_r` (part 142) scopes tenant rows through `coach_clients` —
-- so a gym member with no personal coach has no read at all — and widening that
-- policy would hand over the whole tenant row: settings, currency, retention,
-- brand. RLS selects rows, not columns. Part 242 makes this exact argument
-- about this exact table and answers it the same way: one function, one column.
--
-- ── The trap this function exists to avoid ────────────────────────────────
--
-- `provision_profile` gives every new account its OWN tenant, named
-- "<their name>'s space". If this returned that, the app would rename itself
-- after the member — every screen, the sign-in page, and the three-letter
-- prefix on their member number. That is worse than the defect.
--
-- So the name is returned only when the caller's tenant is somebody's GYM:
-- there is a profile in it with role 'owner' that is not the caller. A personal
-- workspace has one occupant and no owner and gets null, which the app reads as
-- "keep the build's own name". A coach's own solo tenant likewise.
--
-- ── What it discloses ─────────────────────────────────────────────────────
--
-- To a signed-in caller: the name of the gym they are already a member of, and
-- nothing else. No id, no settings, no brand, no other tenant.

create or replace function public.my_gym_name()
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select t.name
    from public.profiles me
    join public.tenants t on t.id = me.tenant_id
   where me.id = auth.uid()
     and exists (
       select 1 from public.profiles o
        where o.tenant_id = me.tenant_id
          and o.role = 'owner'
          and o.id <> me.id
     );
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and that is the
-- grant `anon` resolves through — revoking from anon alone accomplishes
-- nothing. Same convention as parts 38, 101 and 37.
revoke execute on function public.my_gym_name() from public, anon;
grant  execute on function public.my_gym_name() to authenticated;
