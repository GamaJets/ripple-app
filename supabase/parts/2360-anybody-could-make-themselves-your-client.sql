-- ═══════════════════════════════════════════════════════════════════════════
-- Anybody signed in could make themselves any coach's client
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED. Verified after applying: the client arm is conditional rather than
-- bare, it requires a coach_invites row, anon cannot execute the function and
-- authenticated can, and the count of anon-executable SECURITY DEFINER
-- functions held at 2 — the two deliberate entry points.
--
-- `link_coaching` is SECURITY DEFINER, `authenticated` may EXECUTE it, and the
-- first arm of its guard was:
--
--     auth.uid() = p_client
--
-- That is not evidence of anything. It says "I am the client I claim to be",
-- which every caller can say about themselves. So one statement, from any
-- signed-in account:
--
--     select link_coaching('<any coach uuid>', auth.uid(), 'online');
--
-- ends whatever coaching relationship that account had, writes an ACTIVE
-- `coaching_relationships` row against a coach who never agreed, sets
-- `clients.trainer_id`, and puts the caller on that coach's roster.
--
-- The coach's id is not a secret and is not meant to be: `trainers_public_
-- directory_r` is `using (listed = true)` to authenticated, and
-- `public_coach_page()` is a deliberate anon entry point. Two coaches are
-- listed on production today.
--
-- ── why this is a hole in a rule rather than a missing rule ────────────────
--
-- The schema states the opposite in as many words, in `guard_client_trainer_
-- link` on `clients`:
--
--     'A client cannot set their own coach. Coaching starts with a code, an
--      invitation or a directory request, and ends with end_coaching().'
--
-- That trigger refuses the change when `current_user` is `authenticated` or
-- `anon`. `link_coaching` is a definer, so it runs as `postgres` and the
-- trigger waves it through. The trigger is the rule; this function was the way
-- around it. Part 1062 makes the same argument about identity columns and
-- BEFORE triggers, and this is the case it did not cover.
--
-- ── what the caller got ───────────────────────────────────────────────────
--
-- Every one of these is a live policy or function that becomes satisfiable the
-- instant `clients.trainer_id` and the active relationship row exist:
--
--   · `pkg_read` — the coach's live price list. This is precisely the leak
--     part 147 §1 was written to close, reopened from the other end.
--   · `tenants_client_r` — the gym row: currency, plan, session fee, pay
--     policy, tax registration, retention years.
--   · `coach_credentials_client_r` — certificates, issuers, referees, expiry.
--   · `availability_templates_client_r` and `sessions_client_read` — the
--     coach's whole template and every open slot.
--   · `can_review_coach()` → `write_coach_review()` — a PUBLIC STAR RATING.
--     `can_review_coach` is exactly `exists (coaching_relationships … status
--     in ('active','ended'))`, which this call creates. `coach_reviews` is
--     `using false` and reached only through its functions, so those functions
--     ARE the authorisation, and `public_coach_page()` then serves the rating
--     to anon.
--   · `notify_users()` — a push notification to that coach, with a
--     caller-chosen deep link.
--
-- ── the fix, and why it is shaped this way ────────────────────────────────
--
-- The client arm is not removed, because one legitimate path needs it. It is
-- given the evidence requirement the coach arm has had since part 147.
--
-- Callers were enumerated rather than assumed, from both ends:
--
--   · SQL: `pg_get_functiondef` across every function in `public` mentions
--     `link_coaching` in exactly two, and only ONE calls it — `accept_invite`.
--     (`coach_roster_row_is_earned` names it in a comment.)
--   · App: the only `rpc('link_coaching')` call sites are
--     src/ui/CoachRequests.tsx and studio-web/app/coach/page.tsx, and BOTH are
--     the coach accepting a request — the `auth.uid() = p_coach` arm. No app
--     path links a client to themselves.
--
-- So the client arm exists solely to serve `accept_invite`, which has already
-- proved the invite is addressed to the caller's own email address and is
-- pending. Requiring that same invite here costs that path nothing and closes
-- the door to everyone else.
--
-- The invite status is matched as `pending` OR `accepted`, and the order is
-- the reason: `accept_invite` calls this BEFORE it marks the invite accepted,
-- so at this moment the row is still pending — while a retry after a partial
-- failure will find it accepted. Filtering to `pending` alone would break the
-- retry; filtering to neither would accept a withdrawn invite, which
-- `accept_invite` explicitly refuses.
--
-- The third branch — already linked — keeps a mode change or a repeat call
-- working. It grants nothing: the relationship it requires is the one being
-- written.
--
-- The second branch is `coach_requests … status = 'accepted'`, which is the
-- coach having already said yes to a directory request. It is strictly
-- evidence about the COACH's intent, which is the thing the bare arm lacked.
--
-- A path nobody found fails loudly, with a sentence, which is how part 147
-- says you find out.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.link_coaching(
  p_coach uuid, p_client uuid, p_mode text default 'online'
) returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare
  client_tenant uuid;
  client_name   text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select tenant_id into client_tenant from profiles where id = p_client;

  if not (
    -- I am the client, AND something says this coach agreed to me. The bare
    -- identity test that used to stand here is what this part exists to end.
    (auth.uid() = p_client and (
        -- accept_invite()'s path: an invitation from this coach to this
        -- account's own email. 'accepted' is included because accept_invite
        -- calls this BEFORE it stamps the row, so a retry finds it stamped.
        exists (select 1 from public.coach_invites i
                 where i.coach_id = p_coach
                   and lower(i.email) = lower(coalesce(
                         (select u.email from auth.users u where u.id = auth.uid()), ''))
                   and i.status in ('pending', 'accepted'))
        -- the coach has already accepted the directory request join_by_code()
        -- wrote. Evidence about the COACH, which is the point.
        or exists (select 1 from public.coach_requests q
                    where q.client_id = p_client and q.trainer_id = p_coach
                      and q.status = 'accepted')
        -- already linked: a mode change or a repeat grants nothing new.
        or exists (select 1 from public.clients c
                    where c.id = p_client and c.trainer_id = p_coach)
     ))
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

  -- Body below is unchanged from the live definition, transcribed rather than
  -- retyped so the guard is provably the only thing this part alters.
  update coaching_relationships
     set status = 'ended'
   where client_id = p_client
     and coach_id <> p_coach
     and status = 'active';

  insert into coaching_relationships (coach_id, client_id, mode, status)
  values (p_coach, p_client, coalesce(p_mode, 'online'), 'active')
  on conflict (coach_id, client_id) do update set mode = excluded.mode, status = 'active';

  update clients set trainer_id = p_coach where id = p_client;

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
end $fn$;

-- Restated because `create or replace` on a function that did not previously
-- exist leaves EXECUTE with PUBLIC, which in a Supabase project includes anon.
-- Part 1901 shipped exactly that.
revoke all on function public.link_coaching(uuid, uuid, text) from public, anon;
grant execute on function public.link_coaching(uuid, uuid, text) to authenticated;
