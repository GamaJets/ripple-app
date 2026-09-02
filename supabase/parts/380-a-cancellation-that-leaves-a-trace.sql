-- ── A booking somebody cancelled stopped being theirs ───────────────────────
--
-- `cancel_my_session` (part 126, line 317) frees a slot the only way a slot can
-- be freed: `set client_id = null, status = 'available', released = true`. The
-- row is then handed to the waitlist or offered to somebody else.
--
-- Which means a member who books a session and cancels it has, afterwards, no
-- record that either thing happened. The row is not deleted — it is RECYCLED,
-- and the next person to take that hour owns it. Ask the app "what did I book
-- in March" and the answer is a shorter list than the truth, with nothing
-- saying so.
--
-- That is supabase/parts/195's argument one table down. 195 refused to let a
-- cancelled CLASS be deleted, because the bookings against it are the evidence
-- the slot was wanted and destroying them quietly improves the month's fill
-- rate. A cancelled SESSION does the same thing to one person's own history,
-- and additionally to the coach's: a client who books and cancels four times a
-- month is a conversation, and today it leaves no trace to have it about.
--
-- ── Why a trigger and not a change to cancel_my_session ────────────────────
--
-- `cancel_my_session` is a ninety-line SECURITY DEFINER function that also
-- prices a late fee, locks the row and promotes a waitlist. It is not the only
-- writer either: a coach releasing a slot from `app/(trainer)/calendar.tsx`
-- reaches the same state by a direct UPDATE, and so does the reschedule in part
-- 370. Recording the fact in each of them is three places to keep in step, and
-- the third one will be written next year by somebody who has not read this.
--
-- A trigger on the transition catches every writer, present and future,
-- including the SQL editor. It writes a row and changes nothing else: no
-- behaviour of any existing function moves, and a failure to record cannot
-- refuse a cancellation somebody is entitled to make.
--
-- ── What it does NOT record ────────────────────────────────────────────────
--
-- Not a reason. Nothing in the product collects one at cancellation, and a
-- column that is always null reads as a question nobody answered rather than
-- one nobody asked. `coaching_relationships.end_reason` (part 200) is the
-- shape to copy if a reason is ever wanted here.
--
-- Not whether a fee was charged. `charges` already records that, with its own
-- coach_id snapshot (part 189), and a second copy would be a second answer.

create table if not exists public.session_cancellations (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        references public.sessions(id) on delete set null,
  client_id    uuid        not null references public.profiles(id) on delete cascade,
  trainer_id   uuid        references public.profiles(id) on delete set null,
  tenant_id    uuid        references public.tenants(id) on delete set null,
  starts_at    timestamptz not null,
  duration_min integer,
  cancelled_at timestamptz not null default now(),
  cancelled_by uuid        references public.profiles(id) on delete set null,
  was_series   boolean     not null default false
);

comment on table public.session_cancellations is
  'One row per booked session that stopped being somebody''s. The slot itself is recycled — client_id goes null and the hour is offered to the next person — so this table is the ONLY record that the booking existed. Written by a trigger on the transition, never by a screen. It records the fact and not a reason: nothing in the product asks for one, and a column that is always null reads as a question nobody answered. See supabase/parts/380.';

comment on column public.session_cancellations.session_id is
  'The slot, while it still exists. ON DELETE SET NULL rather than CASCADE: the point of this row is to outlive the recycling of that slot, and a cancellation that disappears when the hour is deleted is the defect this table was written to fix.';
comment on column public.session_cancellations.starts_at is
  'The hour that was booked, copied here because the session row is about to belong to somebody else and its starts_at may be all that still matches.';
comment on column public.session_cancellations.cancelled_by is
  'Who performed it — the member for their own cancellation, the coach for a release. NULL when neither was signed in, which is a job or the service role and is a more useful answer than naming one of them by default.';

create index if not exists session_cancellations_client_idx
  on public.session_cancellations (client_id, cancelled_at desc);
create index if not exists session_cancellations_trainer_idx
  on public.session_cancellations (trainer_id, cancelled_at desc)
  where trainer_id is not null;

alter table public.session_cancellations enable row level security;

drop policy if exists session_cancellations_own_r on public.session_cancellations;
create policy session_cancellations_own_r on public.session_cancellations
  for select to authenticated
  using (client_id = (select auth.uid()));

drop policy if exists session_cancellations_coach_r on public.session_cancellations;
create policy session_cancellations_coach_r on public.session_cancellations
  for select to authenticated
  using (trainer_id = (select auth.uid()));

-- SELECT only, for everybody. The trigger is SECURITY DEFINER and is the sole
-- writer; a client who could insert here could invent a cancellation, and one
-- who could delete could erase the four this month that the conversation is
-- about.
revoke all on public.session_cancellations from anon, authenticated;
grant select on public.session_cancellations to authenticated;

create or replace function public.sessions_record_cancellation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  -- The transition, and only it: a row that WAS somebody's booking and is not
  -- any more. An outcome being recorded does not qualify — that session was
  -- delivered or missed and stays theirs. A slot that was never booked has
  -- nobody to record it for.
  if old.client_id is null
     or new.client_id is not distinct from old.client_id
     or old.status is distinct from 'booked'
     or old.outcome is not null then
    return null;
  end if;

  insert into public.session_cancellations
    (session_id, client_id, trainer_id, tenant_id, starts_at, duration_min, cancelled_by, was_series)
  values
    (old.id, old.client_id, old.trainer_id, old.tenant_id, old.starts_at, old.duration_min,
     (select auth.uid()), old.series_id is not null);

  return null;
exception when others then
  -- A cancellation somebody is entitled to make must not be refused because
  -- the record of it could not be written. The row is lost and the slot is
  -- freed, which is the right way round: the alternative is a member who
  -- cannot cancel.
  return null;
end $fn$;

revoke all on function public.sessions_record_cancellation() from public, anon, authenticated;

drop trigger if exists sessions_record_cancellation_trg on public.sessions;
create trigger sessions_record_cancellation_trg
  after update of client_id on public.sessions
  for each row execute function public.sessions_record_cancellation();
