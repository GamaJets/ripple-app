-- ── An event log a gym owner can actually read ─────────────────────────────
--
-- The Ops screen's Activity tab has said this, in the app, for months:
--
--   "Nothing records platform activity yet. This is not a quiet stretch at
--    your gym — no event log is being written at all, so this tab will stay
--    empty until one is."
--
-- That was the honest thing to say and it was better than the copy it replaced,
-- which described "trials, plan changes and suspensions" landing in a feed that
-- had no writer anywhere in the codebase. This is the log.
--
-- ── Why triggers, and not app code ─────────────────────────────────────────
--
-- The obvious build is an `insert into gym_events` next to each place the app
-- does something. It is also the build that rots: every new code path is a new
-- chance to forget one, the log then has holes nobody can see, and an owner
-- reading a gap cannot tell a quiet Tuesday from a missing writer. It is the
-- same failure the Activity tab already had, arriving more slowly.
--
-- Worse, an app-written log is forgeable. Any insert grant wide enough for a
-- client to log "joined" is wide enough for them to log anything they like
-- about anybody in the gym.
--
-- So events are derived from the rows that already record the facts, by
-- triggers, and NOTHING has insert rights. The log cannot drift from the data
-- because it is written by the data. It also starts working for code paths
-- written after today without those paths knowing this file exists.
create table if not exists public.gym_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- What happened. Deliberately a small closed set: an owner scanning a feed
  -- needs to recognise the shapes, and an open string becomes forty spellings
  -- of the same thing.
  kind text not null check (kind in (
    'member-joined', 'trainer-joined', 'session-delivered',
    'session-missed', 'promo-redeemed'
  )),
  -- Who it is about, where that is a person. Null where it is not.
  subject_id uuid references public.profiles(id) on delete set null,
  -- The sentence the feed shows. Composed at write time, on purpose: a name
  -- rendered at read time changes when somebody is renamed or deleted, and a
  -- log whose past changes is not a log.
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists gym_events_feed_idx
  on public.gym_events (tenant_id, created_at desc);

alter table public.gym_events enable row level security;

-- The owner of the gym reads their own gym's feed. Nobody else reads it at all:
-- it names members and what they did, which is the owner's operating record and
-- not something a trainer or another member is entitled to browse.
drop policy if exists gym_events_owner_read on public.gym_events;
create policy gym_events_owner_read on public.gym_events
  for select using (public.is_owner_of(tenant_id));

-- SELECT only, and that is the point. No role can insert, update or delete —
-- the triggers below are SECURITY DEFINER and write as the definer, so the log
-- is append-only from the outside and unforgeable from the app.
grant select on public.gym_events to authenticated;


-- One writer, so every event is shaped the same way and a new trigger cannot
-- invent a sixth column.
create or replace function public.log_gym_event(
  p_tenant uuid, p_kind text, p_subject uuid, p_summary text
) returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  -- A tenant we cannot place is not an event. Dropping it is right: the
  -- alternative is a row visible to nobody (no policy matches a null tenant)
  -- that still counts toward every figure computed over the table.
  if p_tenant is null then return; end if;
  insert into public.gym_events (tenant_id, kind, subject_id, summary)
  values (p_tenant, p_kind, p_subject, p_summary);
exception when others then
  -- A log that can fail a booking is worse than a gap in the log. Every caller
  -- below is a trigger on a table whose write matters more than this one.
  return;
end $fn$;

revoke all on function public.log_gym_event(uuid, text, uuid, text) from public;


-- ── Somebody joined the gym ────────────────────────────────────────────────
create or replace function public.gym_event_member_joined()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text;
begin
  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_name
    from public.profiles where id = new.id;
  perform public.log_gym_event(new.tenant_id, 'member-joined', new.id, v_name || ' joined the gym');
  return new;
end $fn$;

drop trigger if exists gym_events_member_joined on public.clients;
create trigger gym_events_member_joined
  after insert on public.clients
  for each row execute function public.gym_event_member_joined();


-- ── A coach joined ─────────────────────────────────────────────────────────
create or replace function public.gym_event_trainer_joined()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text;
begin
  select coalesce(nullif(btrim(full_name), ''), 'A coach') into v_name
    from public.profiles where id = new.id;
  perform public.log_gym_event(new.tenant_id, 'trainer-joined', new.id, v_name || ' joined as a coach');
  return new;
end $fn$;

drop trigger if exists gym_events_trainer_joined on public.trainers;
create trigger gym_events_trainer_joined
  after insert on public.trainers
  for each row execute function public.gym_event_trainer_joined();


-- ── A session got an outcome ───────────────────────────────────────────────
--
-- On the OUTCOME, not on the booking. A booking is an intention and gyms are
-- full of them; what an owner is reading this feed for is what actually
-- happened. Fires only on the transition, so re-marking a session — which the
-- Mark Sessions queue allows — does not log it twice.
create or replace function public.gym_event_session_outcome()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_client text; v_trainer text;
begin
  if new.outcome is not distinct from old.outcome or new.outcome is null then
    return new;
  end if;
  if new.outcome not in ('completed', 'no_show') then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_client
    from public.profiles where id = new.client_id;
  select coalesce(nullif(btrim(full_name), ''), 'a coach') into v_trainer
    from public.profiles where id = new.trainer_id;
  perform public.log_gym_event(
    new.tenant_id,
    case when new.outcome = 'completed' then 'session-delivered' else 'session-missed' end,
    new.client_id,
    case when new.outcome = 'completed'
      then coalesce(v_client, 'A member') || ' trained with ' || coalesce(v_trainer, 'a coach')
      else coalesce(v_client, 'A member') || ' missed a session with ' || coalesce(v_trainer, 'a coach')
    end
  );
  return new;
end $fn$;

drop trigger if exists gym_events_session_outcome on public.sessions;
create trigger gym_events_session_outcome
  after update on public.sessions
  for each row execute function public.gym_event_session_outcome();


-- ── A promo code was used ──────────────────────────────────────────────────
--
-- The other half of part 104. An owner running a code sees the redemptions in
-- the feed as they happen, not only as a number on the Growth screen.
create or replace function public.gym_event_promo_redeemed()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_name text; v_code text; v_tenant uuid;
begin
  select p.code, p.tenant_id into v_code, v_tenant from public.promos p where p.id = new.promo_id;
  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_name
    from public.profiles where id = new.member_id;
  perform public.log_gym_event(v_tenant, 'promo-redeemed', new.member_id,
                               v_name || ' used code ' || coalesce(v_code, '—'));
  return new;
end $fn$;

drop trigger if exists gym_events_promo_redeemed on public.promo_redemptions;
create trigger gym_events_promo_redeemed
  after insert on public.promo_redemptions
  for each row execute function public.gym_event_promo_redeemed();
