-- ─────────────────────────────────────────────────────────────────────────
-- More than one code, each with a name, so a coach can tell where a client
-- came from.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- 55-coach-join-code.sql gives a coach exactly ONE code, and 56 counts what it
-- brought in. Both are right as far as they go, and together they answer only
-- the crudest version of the question: "is the code working?" — never "which of
-- the things I did worked?".
--
-- A coach running a gym flyer, an Instagram bio link and a referral card is
-- running three campaigns through one string. The counts arrive fused. The only
-- lever on offer is `rotate_join_code`, which DESTROYS the old code for new
-- joins, so a coach who wanted a separate code for the flyer had to break the
-- one already printed on the card to get it. Two campaigns could not be live at
-- once, which is the ordinary case, not an advanced one.
--
-- Worse, `coach_requests.source` was constrained to ('code','directory') and
-- 'directory' was NEVER WRITTEN by anything: app/(client)/trainers.tsx inserted
-- its request with no source at all. So the enum had a dead value, a directory
-- join was indistinguishable from a row predating the column, and "how many
-- people found me by browsing?" had no answer either. That is fixed on the app
-- side alongside this part; nothing here backfills the existing null rows,
-- because a guess about where somebody came from is exactly the fabricated
-- figure this table exists to replace.
--
-- ── The shape ────────────────────────────────────────────────────────────
--
-- A row per code, with the coach's own name for it. Revoking sets a timestamp
-- rather than deleting the row: a revoked code must STOP ACCEPTING new joins
-- while still RESOLVING for attribution, or every client who ever arrived
-- through the flyer would silently fall out of the flyer's count the day the
-- flyer campaign ended. Deleting the row would rewrite history to make a
-- successful campaign look like it never happened.
--
-- `trainers.join_code` is untouched and keeps working. Coaches have that code
-- on printed cards and in bios right now; a migration that retired it would
-- break every one of them. It is treated here as the coach's default code, and
-- this table as additions to it.
--
-- ── Why nobody may INSERT into this table directly ───────────────────────
--
-- A coach reads their own rows through the policy below and writes nothing. All
-- three writes go through SECURITY DEFINER functions, and the insert privilege
-- is revoked outright, because a coach able to write a row of their own choosing
-- could set `code` to a string ANOTHER coach is already handing out. The unique
-- index below cannot stop that on its own — the other coach's code may live in
-- `trainers.join_code`, a different table — and the result would not be an
-- error. It would be a working code that quietly delivers a rival's clients to
-- whoever squatted it, which is the worst possible failure of a mechanism whose
-- entire promise is "this code reaches ME".
--
-- Generation stays server-side for the reason part 55 already gives: only one
-- writer owning the whole read-check-write makes the retry loop correct.
--
-- ── Why resolution is a function and not a policy ────────────────────────
--
-- A client spending a code has to be able to turn six characters into a coach
-- while having NO ability to list codes — a readable table would let any signed
-- in account enumerate every coach's live campaigns and join whichever it liked.
-- So `join_by_code` resolves it, as it already did for the default code, and
-- discloses one coach's name for one exact match and nothing else.
--
-- auth.uid() throughout, never current_user: under PostgREST every signed-in
-- request runs as the shared `authenticated` role, so current_user names the
-- role rather than the person and a check built on it passes for everybody.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_join_codes (
  id          uuid        primary key default gen_random_uuid(),
  trainer_id  uuid        not null references public.trainers(id) on delete cascade,
  code        text        not null,
  -- What the coach calls it: 'Instagram bio', 'Gym flyer', 'Jan referral card'.
  -- Not null and not blank: an unnamed code is a code whose counts nobody can
  -- read, which is the whole failure this part exists to remove.
  label       text        not null,
  created_at  timestamptz not null default now(),
  -- Null means live. Set means it no longer accepts joins, and still resolves
  -- for attribution of the joins it already made.
  revoked_at  timestamptz
);

comment on table public.coach_join_codes is
  'Named join codes a coach can run in parallel, one per campaign or channel. trainers.join_code remains the default code and is unaffected.';
comment on column public.coach_join_codes.label is
  'The coach''s own name for this code. Shown beside its counts; never seen by the client.';
comment on column public.coach_join_codes.revoked_at is
  'When the code stopped accepting new joins. Revoked codes still resolve so past joins keep their attribution.';

-- Case-insensitively unique for the same reason as trainers.join_code: the
-- lookups below fold case, so 'K7M2QX' and 'k7m2qx' held by two coaches would
-- make the resolution ambiguous and hand somebody the wrong roster.
create unique index if not exists coach_join_codes_code_uniq
  on public.coach_join_codes (upper(code));

create index if not exists coach_join_codes_trainer_idx
  on public.coach_join_codes (trainer_id);

-- The per-code counts below scan a coach's requests by the code that was spent.
create index if not exists coach_requests_trainer_via_code_idx
  on public.coach_requests (trainer_id, upper(via_code));

alter table public.coach_join_codes enable row level security;

-- Read your own. There is deliberately no write policy — see the header.
drop policy if exists coach_join_codes_owner_read on public.coach_join_codes;
create policy coach_join_codes_owner_read on public.coach_join_codes
  for select
  to authenticated
  using (trainer_id = (select auth.uid()));

-- Supabase grants the API roles full table privileges by default, and a policy
-- is the only thing standing between that grant and a write. Stating the
-- absence of write access as a privilege rather than as a missing policy means
-- a future part that adds an incautious `for all` policy still cannot let a
-- coach choose their own code string.
grant select on public.coach_join_codes to authenticated;
revoke insert, update, delete on public.coach_join_codes from authenticated;
revoke all on public.coach_join_codes from anon;

/**
 * Allocate a code that collides with nothing, in EITHER table.
 *
 * Replaces the part 55 version, which only ever checked `trainers`. Codes now
 * live in two places and are resolved from both, so a generator blind to this
 * table would eventually mint a named code identical to some coach's default
 * one — and then a client typing it would be delivered to whichever row the
 * lookup happened to reach first. The unique index on this table would not fire
 * on that: the duplicate is in the other table.
 *
 * Same alphabet as part 55, deliberately not a second one. It excludes O, 0, I
 * and 1 because these get read aloud across a gym floor, and src/lib/joinCode.ts
 * tells a client who typed one of them exactly that. Two alphabets would make
 * that message false for half the codes in circulation.
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
    exit when not exists (select 1 from public.trainers t where upper(t.join_code) = candidate)
          -- Revoked codes count as taken. They still resolve for attribution,
          -- so reissuing one would merge a dead campaign's joins into a new
          -- campaign's count and nothing would look wrong.
          and not exists (select 1 from public.coach_join_codes c where upper(c.code) = candidate);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'could not allocate a unique join code';
    end if;
  end loop;
  return candidate;
end; $$;

/**
 * Create a named code for the signed-in coach.
 *
 * The label is the coach's, and is the only thing that makes the counts
 * readable, so it is required and it must be distinct among their LIVE codes.
 * Two live codes both called "Instagram" produce two count lines a coach cannot
 * tell apart, and no way to know which one is in the bio — the report would be
 * worse than the single fused number it replaced. Revoked codes are excluded
 * from that check: reusing a finished campaign's name next January is ordinary.
 *
 * The cap is not an arbitrary limit. Every code a coach holds is a string
 * somebody may still be typing; a coach with hundreds cannot audit them, and
 * the generator's collision loop is the wrong place to discover that.
 *
 * Returns the code itself, as my_join_code() and rotate_join_code() do, rather
 * than the whole row. The caller already has the label — it just sent it — and
 * re-reads the list immediately, so a row here would be a second copy of facts
 * that can only disagree with it. It also keeps the function free of OUT
 * parameters named `id`, `code` and `label`, which shadow the columns of the
 * very table this function writes to.
 */
create or replace function public.create_join_code(p_label text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  clean text := btrim(coalesce(p_label, ''));
  live  int;
  new_code text;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  -- No trainer row means this account is not a coach. Say so, rather than
  -- failing later on the foreign key with a message nobody can act on.
  if not exists (select 1 from public.trainers where id = uid) then
    raise exception 'no trainer profile for this account';
  end if;
  if clean = '' then
    raise exception 'a code needs a name';
  end if;
  if length(clean) > 40 then
    raise exception 'that name is too long';
  end if;
  if exists (
    select 1 from public.coach_join_codes c
    where c.trainer_id = uid and c.revoked_at is null and upper(c.label) = upper(clean)
  ) then
    raise exception 'you already have a live code called that';
  end if;

  select count(*) into live
  from public.coach_join_codes c
  where c.trainer_id = uid and c.revoked_at is null;
  if live >= 20 then
    raise exception 'you already have 20 live codes; turn one off first';
  end if;

  new_code := public.generate_join_code();
  insert into public.coach_join_codes (trainer_id, code, label)
  values (uid, new_code, clean);
  return new_code;
end; $$;

/**
 * Turn a named code off. It stops accepting joins and keeps its history.
 *
 * Scoped by trainer_id = auth.uid() inside the function because it is SECURITY
 * DEFINER and therefore bypasses the read policy above: without that predicate
 * any signed-in account could revoke any coach's live campaign by guessing a
 * uuid, and the coach would find out from the flyer.
 *
 * Revoking something already revoked is not an error worth raising — the coach
 * pressed the button twice, and the outcome they asked for is the outcome. It
 * returns the original timestamp rather than moving it, so the record of when
 * the campaign actually ended survives.
 */
create or replace function public.revoke_join_code(p_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  was  timestamptz;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  select c.revoked_at into was
  from public.coach_join_codes c
  where c.id = p_id and c.trainer_id = uid;
  if not found then
    raise exception 'that code is not one of yours';
  end if;
  if was is not null then
    return was;
  end if;
  update public.coach_join_codes
     set revoked_at = now()
   where id = p_id and trainer_id = uid
   returning revoked_at into was;
  return was;
end; $$;

/**
 * Every code this coach has, with what each one brought in.
 *
 * The successor to `my_join_code_stats()`, which returned two fused numbers.
 * That function is left in place: it is still correct about the total, and
 * removing it would break any build still calling it.
 *
 * The first row is always the default code from `trainers.join_code`, marked
 * `is_default`. Its counts are everything attributed to the code path that no
 * NAMED code claims — which deliberately includes joins made with a default
 * code that has since been rotated away, and the pre-56 rows whose via_code is
 * null. Those clients did arrive by code, and dropping them because the string
 * they typed no longer exists would quietly shrink a coach's history every time
 * they pressed "New Code". The label says so, so the number is not read as
 * belonging to the six characters printed beside it.
 *
 * Consequently the rows sum to exactly the `my_join_code_stats()` totals: every
 * request with source='code' lands in exactly one row and none lands in two.
 *
 * A coach who has never asked for a code has no default row, because there is
 * no code to show and no join that could have been made with one.
 */
create or replace function public.my_join_codes()
returns table (
  id uuid, code text, label text,
  created_at timestamptz, revoked_at timestamptz,
  is_default boolean, joined bigint, pending bigint
)
language sql security definer stable set search_path = public as $$
  with me as (select auth.uid() as uid),
  named as (
    select c.id, upper(c.code) as code, c.label, c.created_at, c.revoked_at
    from public.coach_join_codes c, me
    where c.trainer_id = me.uid
  ),
  reqs as (
    select upper(btrim(q.via_code)) as via, q.status
    from public.coach_requests q, me
    where q.trainer_id = me.uid and q.source = 'code'
  )
  -- Every column reference below is qualified, deliberately. The RETURNS TABLE
  -- columns are OUT parameters and are in scope inside this body, so a bare
  -- `code` or `label` here is ambiguous and the function fails to run at all.
  select * from (
    select n.id, n.code, n.label, n.created_at, n.revoked_at, false as is_default,
           (select count(*) from reqs r where r.via = n.code and r.status = 'accepted') as joined,
           (select count(*) from reqs r where r.via = n.code and r.status = 'pending')  as pending
    from named n
    union all
    select null::uuid, t.join_code, 'Your main code', null::timestamptz, null::timestamptz, true,
           (select count(*) from reqs r
             where r.status = 'accepted'
               and (r.via is null or r.via not in (select n2.code from named n2))),
           (select count(*) from reqs r
             where r.status = 'pending'
               and (r.via is null or r.via not in (select n2.code from named n2)))
    from public.trainers t, me
    where t.id = me.uid and t.join_code is not null
  ) all_codes
  -- Default first, then live before revoked, newest first within each. The app
  -- sorts these again for its own reasons; ordering here means two coaches
  -- reading the same screen are not shown their codes in different orders.
  order by all_codes.is_default desc, (all_codes.revoked_at is not null), all_codes.created_at desc nulls first;
$$;

-- The one-argument version was already dropped in part 56; the two-argument one
-- is replaced in place so no call site changes. Adding a THIRD defaulted
-- parameter would overload rather than replace and make every existing
-- two-argument call ambiguous, which is the failure part 56 documents.
/**
 * Join a coach by code — a named one, or their default.
 *
 * Named codes are checked first. They are unique against `trainers.join_code`
 * by construction (see generate_join_code above), so the order is not what makes
 * this unambiguous; checking them first simply means a revoked named code is
 * recognised AS revoked instead of falling through to "no coach uses that code",
 * which would send a client to argue with a coach about a code the coach knows
 * they issued.
 *
 * `via_code` records the exact string spent. That is what makes the counts in
 * my_join_codes() resolvable back to a label: the code is on the request, not
 * looked up from the coach afterwards, so a code revoked or rotated later does
 * not rewrite where anybody came from.
 */
create or replace function public.join_by_code(p_code text, p_mode text default 'online')
returns table (trainer_id uuid, trainer_name text, already boolean)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t_id uuid;
  t_name text;
  t_code text;
  revoked timestamptz;
  existing boolean;
  wanted text := upper(btrim(coalesce(p_code, '')));
  mode_in text := case when p_mode in ('inperson','hybrid') then p_mode else 'online' end;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  select c.trainer_id, upper(c.code), c.revoked_at
    into t_id, t_code, revoked
  from public.coach_join_codes c
  where upper(c.code) = wanted;

  if t_id is not null and revoked is not null then
    -- Named as its own failure. "No coach uses that code" would be a lie about
    -- a code that a real coach really did hand out, and the client would go
    -- back to them convinced they had mistyped it.
    raise exception 'that code is no longer in use';
  end if;

  if t_id is null then
    select tr.id, upper(tr.join_code) into t_id, t_code
    from public.trainers tr
    where tr.join_code is not null and upper(tr.join_code) = wanted;
  end if;

  if t_id is null then
    raise exception 'no coach uses that code';
  end if;

  -- A coach cannot request themselves; the code can be pasted into their own
  -- client-app account and a self-referential row would put them on their own
  -- roster.
  if t_id = uid then
    raise exception 'that is your own code';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), 'Your coach') into t_name
  from public.profiles p where p.id = t_id;

  -- Already linked, or already asked. Neither is an error and neither may make
  -- a second pending row — the coach would be asked to decide about the same
  -- person twice.
  select exists (
    select 1 from public.coaching_relationships r
    where r.coach_id = t_id and r.client_id = uid
  ) or exists (
    select 1 from public.coach_requests q
    where q.trainer_id = t_id and q.client_id = uid and q.status = 'pending'
  ) into existing;

  if not existing then
    insert into public.coach_requests (client_id, trainer_id, mode, status, source, via_code)
    values (uid, t_id, mode_in, 'pending', 'code', t_code);
  end if;

  return query select t_id, coalesce(t_name, 'Your coach'), existing;
end; $$;

revoke all on function public.generate_join_code() from public, anon, authenticated;
revoke all on function public.create_join_code(text) from public, anon;
revoke all on function public.revoke_join_code(uuid) from public, anon;
revoke all on function public.my_join_codes() from public, anon;
grant execute on function public.create_join_code(text) to authenticated;
grant execute on function public.revoke_join_code(uuid) to authenticated;
grant execute on function public.my_join_codes() to authenticated;
grant execute on function public.join_by_code(text, text) to authenticated;

comment on function public.my_join_codes is
  'Per-code join counts for the signed-in coach: the default code plus every named one, live and revoked. Rows sum to my_join_code_stats().';
