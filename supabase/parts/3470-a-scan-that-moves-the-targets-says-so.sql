-- ── A confirmed InBody scan re-tunes the targets, and says so ───────────────
--
-- The member's phone recomputes calories and macros from the scan
-- (src/lib/scanTargets.ts: scan BMR, else Katch–McArdle from lean mass, × the
-- activity factor, goal-adjusted; protein per kg of lean mass). Two things the
-- phone cannot do on its own:
--
--   · tell the member, somewhere that outlives an Alert, what their targets
--     became; and
--   · when a coach has set the targets by hand (coach_nutrition deltas, a
--     written week, a meal override), hand the coach a proposal instead of
--     overwriting them. Nothing here writes coach_nutrition. The coach decides.

create table if not exists public.scan_target_proposals (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  coach_id    uuid references public.profiles(id) on delete set null,
  scan_id     uuid references public.scans(id) on delete set null,
  kcal        int not null check (kcal between 800 and 8000),
  protein_g   int not null check (protein_g between 0 and 600),
  carbs_g     int not null check (carbs_g between 0 and 1500),
  fat_g       int not null check (fat_g between 0 and 600),
  basis       text check (char_length(basis) <= 300),
  status      text not null default 'open' check (status in ('open','accepted','dismissed')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create index if not exists scan_target_proposals_coach_open_idx
  on public.scan_target_proposals (coach_id, status, created_at desc);

alter table public.scan_target_proposals enable row level security;

drop policy if exists scan_target_proposals_client_r on public.scan_target_proposals;
create policy scan_target_proposals_client_r on public.scan_target_proposals
  for select using (client_id = auth.uid());
drop policy if exists scan_target_proposals_coach_r on public.scan_target_proposals;
create policy scan_target_proposals_coach_r on public.scan_target_proposals
  for select using (coach_id = auth.uid());
-- The coach answers it; nobody inserts directly (the function below does).
drop policy if exists scan_target_proposals_coach_u on public.scan_target_proposals;
create policy scan_target_proposals_coach_u on public.scan_target_proposals
  for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create or replace function public.scan_targets_changed(
  p_scan_id uuid, p_kcal int, p_protein int, p_carbs int, p_fat int,
  p_basis text default null, p_propose boolean default false
) returns text
language plpgsql security definer set search_path = public as $function$
declare
  v_me    uuid := auth.uid();
  v_coach uuid;
  v_name  text;
  v_line  text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- The scan must be the caller's own; a null scan id is allowed (queued scan).
  if p_scan_id is not null and not exists (
    select 1 from public.scans s where s.id = p_scan_id and s.client_id = v_me
  ) then
    raise exception 'not your scan' using errcode = '42501';
  end if;

  v_line := p_kcal || ' kcal · ' || p_protein || 'g protein · ' || p_carbs || 'g carbs · ' || p_fat || 'g fat';

  if p_propose then
    select c.trainer_id into v_coach from public.clients c where c.id = v_me;
  end if;

  if p_propose and v_coach is not null then
    insert into public.scan_target_proposals (client_id, coach_id, scan_id, kcal, protein_g, carbs_g, fat_g, basis)
    values (v_me, v_coach, p_scan_id, p_kcal, p_protein, p_carbs, p_fat, left(p_basis, 300));

    select nullif(btrim(coalesce(p.full_name, '')), '') into v_name from public.profiles p where p.id = v_me;
    insert into public.notifications (user_id, title, body, icon, route)
    values (v_coach, 'New InBody scan: targets to review',
      left(coalesce(v_name, 'A client') || '''s new scan suggests ' || v_line
        || '. You set their targets by hand, so nothing has changed until you decide.', 500),
      'nutrition', '/(trainer)/client-nutrition?clientId=' || v_me);

    insert into public.notifications (user_id, title, body, icon, route)
    values (v_me, 'Your scan went to your coach',
      left('Your new scan suggests ' || v_line || '. Your coach sets your targets, so they have been asked to review it.', 500),
      'nutrition', '/(client)/nutrition');
    return 'proposed';
  end if;

  insert into public.notifications (user_id, title, body, icon, route)
  values (v_me, 'Your daily targets were updated',
    left('From your new InBody scan: ' || v_line || '. Your meal plan has been rebuilt to match.', 500),
    'nutrition', '/(client)/nutrition');
  return 'applied';
end;
$function$;

revoke all on function public.scan_targets_changed(uuid, int, int, int, int, text, boolean) from public;
revoke all on function public.scan_targets_changed(uuid, int, int, int, int, text, boolean) from anon;
grant execute on function public.scan_targets_changed(uuid, int, int, int, int, text, boolean) to authenticated;

-- ── notification_channel learns the two nutrition routes this part writes ──
--
-- Part 3320's body plus the routes CHANNEL_BY_ROUTE (src/lib/notifyDispatch.ts)
-- classifies and this function did not: the two this part's notifications use,
-- and the two part 3460 adds. Without them part 900's dispatcher drops each
-- row's push and the notification reaches only the in-app bell.

-- Revoked first: the function exists already (part 3320), and the case body
-- stays the last thing in this file that names it, which is what
-- scripts/check-notify-routes.mjs reads.
revoke all on function public.notification_channel(text, text) from public;
revoke all on function public.notification_channel(text, text) from anon;
revoke all on function public.notification_channel(text, text) from authenticated;

create or replace function public.notification_channel(p_route text, p_title text)
returns text
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  r text := split_part(btrim(coalesce(p_route, '')), '?', 1);
  t text := btrim(coalesce(p_title, ''));
begin
  if r <> '' then
    return case r
      when '/(client)/messages'         then 'chat'
      when '/(trainer)/chat'            then 'chat'

      when '/(trainer)/calendar'        then 'bookings'
      when '/(client)/calendar'         then 'bookings'
      when '/(client)/bookings'         then 'bookings'
      when '/(client)/pt-sessions'      then 'bookings'
      when '/(client)/classes'          then 'bookings'
      when '/(client)/request-session'  then 'bookings'
      when '/(trainer)/sessions'        then 'bookings'

      when '/(trainer)/payments'        then 'money'
      when '/(client)/packages'         then 'money'
      when '/(client)/explore'          then 'money'
      when '/(client)/offers'           then 'money'

      when '/(trainer)/dashboard'       then 'clients'
      when '/(trainer)/leads'           then 'clients'
      when '/(trainer)/client-goals'    then 'clients'
      when '/(trainer)/client-training' then 'clients'
      when '/(trainer)/client-photos'   then 'clients'
      when '/(client)/my-coach'         then 'clients'
      when '/(client)/trainers'         then 'clients'
      -- Part 3320.
      when '/(client)/assessments'      then 'clients'
      when '/(client)/community'        then 'clients'
      when '/(trainer)/community'       then 'clients'
      when '/(owner)/community'         then 'clients'

      -- Part 3470: carried from part 3460 (and 3350's form-check answer), so whichever of the two lands last keeps both.
      when '/(client)/workouts'      then 'clients'
      -- Part 3470: carried from part 3460 (part 3340's check-in).
      when '/(trainer)/checkins'     then 'clients'
      -- Part 3470: scan_targets_changed tells the member their targets moved, or went to their coach.
      when '/(client)/nutrition'     then 'clients'
      -- Part 3470: scan_targets_changed asks the coach to review targets a new scan suggests.
      when '/(trainer)/client-nutrition' then 'clients'

      when '/(trainer)/documents'       then 'admin'
      when '/(trainer)/client-intake'   then 'admin'
      when '/(trainer)/credentials'     then 'admin'
      when '/(client)/intake'           then 'admin'
      when '/(client)/injuries'         then 'admin'

      when '/(trainer)/invoices'        then 'book'
      when '/(trainer)/nudges'          then 'book'
      when '/(trainer)/builder'         then 'book'

      -- '/(client)/notices' stays deliberately unclassified; see part 1870.
      else null
    end;
  end if;

  return case t
    when 'An invoice from your gym'        then 'money'
    when 'Your coaching has ended'         then 'clients'
    when 'A client has signed the release' then 'admin'
    else null
  end;
end
$function$;


