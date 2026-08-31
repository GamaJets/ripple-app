-- A signed release, kept as evidence. One immutable row per person per version
-- of the wording: re-wording the waiver later adds a row rather than editing
-- what somebody actually agreed to, and there is deliberately no UPDATE or
-- DELETE policy, so nobody — the client included — can alter or withdraw the
-- record after the fact.
--
-- Gated in the app at src/ui/waiver.tsx, over the whole client portal rather
-- than on the sign-up form: there are three ways into an account (password,
-- texted code, Apple/Google) and a checkbox on one of them is a release two
-- thirds of new clients never see.
create table if not exists public.liability_waivers (
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  released_liability boolean not null,
  physician_ack boolean not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version),
  -- A half-agreed waiver is not a waiver. The row cannot exist unless both
  -- acknowledgements were actually given.
  constraint liability_waivers_both_given check (released_liability and physician_ack)
);

alter table public.liability_waivers enable row level security;

-- Read your own. A coach or owner has no business reading it through the app;
-- it is a legal record, not roster data.
drop policy if exists liability_waivers_own_r on public.liability_waivers;
create policy liability_waivers_own_r on public.liability_waivers
  for select using (user_id = (select auth.uid()));

-- Sign your own, for yourself, and only as fully agreed.
drop policy if exists liability_waivers_own_i on public.liability_waivers;
create policy liability_waivers_own_i on public.liability_waivers
  for insert with check (
    user_id = (select auth.uid()) and released_liability and physician_ack
  );

grant select, insert on public.liability_waivers to authenticated;
