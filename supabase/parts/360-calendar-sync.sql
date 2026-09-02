-- ─────────────────────────────────────────────────────────────────────────
-- Coach ▸ two-way calendar sync (S3). One row per (account, provider).
--
-- ── Why this table looks like wearable_tokens ─────────────────────────────
--
-- Because it holds the same kind of thing and must fail the same way. An OAuth
-- refresh token is a standing credential: anybody holding one can mint access
-- tokens against somebody's Google account until it is revoked. Part 16 settled
-- how this repo stores those — service role writes, no SELECT policy at all,
-- and the owner may delete their own row — and this follows it exactly rather
-- than inventing a second answer.
--
-- The rule that matters is the missing one. There is NO select policy and no
-- grant for `authenticated`, so no screen, no hook and no future join can read
-- a token out of here. Part 77 records what happens when a display bug tempts
-- somebody to add one: the app needed to know whether WHOOP was connected, and
-- the honest fix was a function returning NAMES, not a policy handing every
-- signed-in user their own OAuth tokens in order to answer a question about a
-- label. `my_calendar_links()` below is the same shape for the same reason.
--
-- ── What write_calendar_id is ─────────────────────────────────────────────
--
-- The id of a SECONDARY calendar the edge function creates inside the coach's
-- own Google account. Repple writes there and nowhere else, and the grant it
-- holds (`calendar.app.created`) cannot reach anything else either — so the
-- coach's own entries are out of reach of a bug here, not merely out of scope.
-- Null until the coach turns writing on, which is the only thing that creates
-- the calendar.
--
-- Idempotent; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists calendar_links (
  user_id           uuid not null references profiles(id) on delete cascade,
  provider          text not null,
  access_token      text not null,
  refresh_token     text,
  expires_at        timestamptz,
  -- The calendar Repple made in the coach's account. Everything this product
  -- has ever written to that account lives inside it, so deleting it removes
  -- the lot.
  write_calendar_id text,
  -- Off until the coach says otherwise. Reading somebody's free/busy and
  -- writing into their diary are different decisions and are asked separately.
  write_enabled     boolean not null default false,
  connected_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table calendar_links enable row level security;

-- Delete only, and only your own. The disconnect path in the app goes through
-- the edge function so that Repple's calendar is removed from Google as well;
-- this policy is the backstop that guarantees a coach can always drop the
-- credential itself, even if that function is unreachable.
drop policy if exists calendar_links_delete_own on calendar_links;
create policy calendar_links_delete_own on calendar_links for delete
  using (user_id = auth.uid());

comment on table calendar_links is
  'OAuth credentials for a coach''s external calendar. Written only by the calendar-sync edge function under the service role; no select policy, deliberately.';


-- ─────────────────────────────────────────────────────────────────────────
-- Which calendars THIS ACCOUNT has linked — flags only, never tokens.
--
-- The screen has to answer four questions: is anything connected, will the
-- connection survive the hour (a grant with no refresh token does not), is
-- writing turned on, and has the calendar Repple writes into actually been
-- made. None of those needs token material and all four were unanswerable
-- without a SELECT policy, which is the trade part 77 already refused to make.
--
-- SECURITY DEFINER with auth.uid(), never current_user: under PostgREST every
-- signed-in request runs as the same `authenticated` role, so current_user
-- names the role rather than the person and would hand one coach another
-- coach's connections.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.my_calendar_links()
returns table (
  provider           text,
  expires_at         timestamptz,
  has_refresh        boolean,
  write_enabled      boolean,
  has_write_calendar boolean,
  connected_at       timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select l.provider,
         l.expires_at,
         (l.refresh_token is not null)     as has_refresh,
         l.write_enabled,
         (l.write_calendar_id is not null) as has_write_calendar,
         l.connected_at
  from public.calendar_links l
  where l.user_id = auth.uid();
$$;

revoke all on function public.my_calendar_links() from public, anon;
grant execute on function public.my_calendar_links() to authenticated;

comment on function public.my_calendar_links is
  'Which external calendars the signed-in account has linked. Flags and expiry only — never token material.';


-- ─────────────────────────────────────────────────────────────────────────
