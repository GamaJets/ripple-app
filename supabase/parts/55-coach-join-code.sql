-- ─────────────────────────────────────────────────────────────────────────
-- A code a coach can say out loud, so joining does not depend on spelling.
--
-- ── The failure this removes ─────────────────────────────────────────────
--
-- Coach → client invitations are matched on the email address the coach typed:
--
--     select * from coach_invites where email ilike <the client's email>
--
-- Case-insensitive, and otherwise exact. A coach who types gloria@gmail.com
-- for gloria.smith@gmail.com creates an invitation that NEITHER PARTY CAN EVER
-- SEE. The coach's screen shows it pending, so it looks sent. The client's
-- screen shows nothing, because nothing addressed to them exists. There is no
-- error, nobody is told, and no amount of retrying from either side fixes it —
-- the two are looking at different strings.
--
-- It also cannot work before the client has an account, which is the ordinary
-- case: the coach signs somebody up in the gym, on the spot.
--
-- ── Why a code ───────────────────────────────────────────────────────────
--
-- The David Lloyd app asks a joining member for a membership number and says
-- where to find it, with "I don't have a membership number" underneath leading
-- to a real free tier. The shape is what matters: a short token the club issues
-- and the member types, so identity is established by something the member
-- HOLDS rather than by two people independently spelling the same address.
--
-- The client already has the browse-and-request path (the trainer directory),
-- which is the "I don't have one" branch. What was missing is the direct one,
-- for the far commoner case where the two people are standing next to each
-- other and already know it.
--
-- The alphabet excludes O, 0, I and 1. Codes get read aloud across a gym floor.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.trainers
  add column if not exists join_code text;

comment on column public.trainers.join_code is
  'Short code a coach shares so a client can join without either side typing an email address.';

-- Case-insensitively unique: the lookup below folds case, so two coaches
-- holding "K7M2QX" and "k7m2qx" would make it ambiguous.
create unique index if not exists trainers_join_code_uniq
  on public.trainers (upper(join_code)) where join_code is not null;

/**
 * Six characters from a 30-letter alphabet — about 730 million codes.
 *
 * Generated server-side, never by the app: a client that picks its own would
 * race another client picking the same one, and the retry loop below is only
 * correct when one writer owns the whole read-check-write.
 */
create or replace function public.generate_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  tries int := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    -- Collision is vanishingly unlikely and still has to be handled: a
    -- duplicate would raise on the unique index and lose the caller's code.
    exit when not exists (select 1 from public.trainers t where upper(t.join_code) = candidate);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'could not allocate a unique join code';
    end if;
  end loop;
  return candidate;
end; $$;

/** The signed-in coach's code, allocated on first ask and stable thereafter. */
create or replace function public.my_join_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  code text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select join_code into code from public.trainers where id = uid;
  if code is not null then
    return code;
  end if;
  -- No row at all means this account is not a trainer. Say so rather than
  -- silently handing back null, which the app would render as a blank code
  -- for somebody to read out.
  if not found then
    raise exception 'no trainer profile for this account';
  end if;
  code := public.generate_join_code();
  update public.trainers set join_code = code where id = uid;
  return code;
end; $$;

/**
 * Join a coach by their code.
 *
 * Returns the coach's name so the client sees WHO they just asked for — a
 * mistyped code that happens to hit a real coach must be visible immediately,
 * not discovered when a stranger accepts.
 *
 * SECURITY DEFINER because the client cannot read `trainers` rows for coaches
 * they have no relationship with, which is the whole point of the code. It
 * discloses one name for one exact six-character match and nothing else; a
 * wrong code is indistinguishable from an unused one.
 */
create or replace function public.join_by_code(p_code text)
returns table (trainer_id uuid, trainer_name text, already boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t_id uuid;
  t_name text;
  existing boolean;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select tr.id into t_id
  from public.trainers tr
  where tr.join_code is not null
    and upper(tr.join_code) = upper(btrim(coalesce(p_code, '')));

  if t_id is null then
    raise exception 'no coach uses that code';
  end if;

  -- A coach cannot request themselves. Nothing stops the code being pasted
  -- into the coach's own client-app account, and a self-referential row would
  -- put them on their own roster.
  if t_id = uid then
    raise exception 'that is your own code';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your coach') into t_name
  from public.profiles p where p.id = t_id;

  -- Already linked, or already asked. Either way this is not an error and must
  -- not create a second pending row — the coach would see the same person
  -- twice and have to decide about them twice.
  select exists (
    select 1 from public.coaching_relationships r
    where r.coach_id = t_id and r.client_id = uid
  ) or exists (
    select 1 from public.coach_requests q
    where q.trainer_id = t_id and q.client_id = uid and q.status = 'pending'
  ) into existing;

  if not existing then
    insert into public.coach_requests (client_id, trainer_id, mode, status)
    values (uid, t_id, 'inperson', 'pending');
  end if;

  return query select t_id, coalesce(t_name, 'Your coach'), existing;
end; $$;

revoke all on function public.generate_join_code() from public, anon, authenticated;
grant execute on function public.my_join_code() to authenticated;
grant execute on function public.join_by_code(text) to authenticated;
