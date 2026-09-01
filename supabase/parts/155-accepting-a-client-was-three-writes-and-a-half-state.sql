-- ═══════════════════════════════════════════════════════════════════════════
-- Accepting a coaching request failed, and left the data half-moved.
--
-- Reported from the coach app: tapping Accept on a coaching request showed
--
--     Could not accept
--     new row violates row-level security policy (USING expression)
--     for table "coach_clients"
--
-- ── What was actually happening ────────────────────────────────────────────
--
-- Accepting is THREE writes made from the app, in sequence, with no
-- transaction around them:
--
--   1. rpc link_coaching(...)                      -- definer, succeeded
--   2. upsert coach_clients on conflict (id)       -- REFUSED
--   3. update coach_requests set status='accepted' -- never reached
--
-- `coach_clients` is keyed on the CLIENT's id alone. So when a client who is
-- already on somebody's roster is accepted by a second coach, the upsert finds
-- that existing row and becomes an UPDATE — and an UPDATE is checked against
-- the EXISTING row's USING expression, which is `trainer_id = auth.uid()`. The
-- row belongs to the first coach, so the second coach is refused. Correctly:
-- they were trying to write another coach's roster row.
--
-- The damage is what step 1 had already done. Measured live at the time of the
-- report, for client 759c8d25…:
--
--     clients.trainer_id        1efee95c…   (the new coach — step 1 landed)
--     coach_clients.trainer_id  24d22d9d…   (the old coach — step 2 refused)
--     coaching_relationships    BOTH coaches, both 'active'
--
-- Three tables disagreeing about who coaches one person. The file that makes
-- these calls already carries a comment about exactly this failure mode, in
-- the other direction — "Writing the roster row after this failed is what
-- produced a coach who could see a name and nothing behind it" — and stops if
-- step 1 fails. Nothing stopped step 1 from having happened when step 2 failed.
--
-- And the two active relationships are a defect of their own: `link_coaching`
-- upserts the new one and never ends the old. `clients.trainer_id` holds ONE
-- coach, so the second row was never reachable as a relationship — it was just
-- a row saying somebody coaches you when they do not.
--
-- ── The fix: one definer function does all of it ───────────────────────────
--
-- The roster write moves INSIDE `link_coaching`, where three things become
-- true that could not be true in the app:
--
--   * It is one statement, so it cannot half-happen. A failure rolls the whole
--     thing back and the coach sees an error over unchanged data, rather than
--     an error over data that has already moved.
--   * It runs as the definer, so it can retire the previous coach's roster row
--     — which is the correct outcome and which no coach may do themselves. The
--     app was asking a coach to write a row RLS is right to refuse them.
--   * The previous relationship is ended rather than left active, so
--     `coaching_relationships` agrees with `clients.trainer_id` instead of
--     accumulating a row per coach who ever took somebody on.
--
-- The authorisation is UNCHANGED. Part 147 tightened it — a coach must hold a
-- `coach_requests` row or an existing link — and none of that is relaxed here.
-- This function still refuses a coach who simply names themselves.
--
-- `on conflict (id) do update` inside a definer function is not the same act as
-- the app's upsert: the app was a coach editing a row they do not own, and this
-- is the system moving a roster entry as part of a transition it has already
-- authorised.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.link_coaching(p_coach uuid, p_client uuid, p_mode text default 'online')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  client_tenant uuid;
  client_name   text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select tenant_id into client_tenant from profiles where id = p_client;

  if not (
    auth.uid() = p_client
    or (auth.uid() = p_coach and exists (
          select 1 from coach_requests q
           where q.client_id = p_client and q.trainer_id = p_coach))
    or (auth.uid() = p_coach and exists (
          select 1 from clients c
           where c.id = p_client and c.trainer_id = p_coach))
    or (client_tenant is not null and is_owner_of(client_tenant))
  ) then
    raise exception 'You can only link a coach and a client you are part of.'
      using errcode = '42501';
  end if;

  -- End every OTHER active relationship first. One person has one coach in this
  -- product — `clients.trainer_id` is a single column — so a second active row
  -- is not a second coach, it is a row that disagrees with the column.
  update coaching_relationships
     set status = 'ended'
   where client_id = p_client
     and coach_id <> p_coach
     and status = 'active';

  insert into coaching_relationships (coach_id, client_id, mode, status)
  values (p_coach, p_client, coalesce(p_mode, 'online'), 'active')
  on conflict (coach_id, client_id) do update set mode = excluded.mode, status = 'active';

  update clients set trainer_id = p_coach where id = p_client;

  -- The roster row, written here rather than by the app. `coach_clients.name`
  -- and `.mode` are NOT NULL; the name comes from the profile rather than from
  -- the caller, so a coach cannot file somebody under a name of their choosing.
  -- A profile with no name falls back to the roster's existing name and then to
  -- a plain placeholder — never to an empty string, which would fail the
  -- constraint and take the whole accept down over a missing display name.
  select nullif(btrim(coalesce(full_name, '')), '') into client_name
    from profiles where id = p_client;

  insert into coach_clients (id, trainer_id, name, mode)
  values (
    p_client,
    p_coach,
    coalesce(client_name, (select name from coach_clients where id = p_client), 'Client'),
    coalesce(p_mode, 'online')
  )
  on conflict (id) do update
    set trainer_id = excluded.trainer_id,
        mode       = excluded.mode,
        name       = coalesce(excluded.name, coach_clients.name);
end $function$;

revoke all on function public.link_coaching(uuid, uuid, text) from public, anon;
grant execute on function public.link_coaching(uuid, uuid, text) to authenticated;
