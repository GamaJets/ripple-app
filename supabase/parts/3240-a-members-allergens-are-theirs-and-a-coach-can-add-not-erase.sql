-- A member's allergens are theirs. A coach can add one; a coach cannot erase one.
--
-- ── The hole ──────────────────────────────────────────────────────────────
--
-- `clients_trainer_update` lets a coach update their client's row, every
-- column of it. This table already refuses that for the columns that are the
-- member's own account of themselves: injuries (clients_injuries_are_the_clients),
-- intake, and the wellness and glucose consents each have a trigger that raises
-- when anyone but the member changes them.
--
-- `avoid` had no such guard. It is the member's allergen list, and it is what
-- keeps a nut allergy out of every generated meal, every recipe search and
-- every coach-written plan (poolFilter in src/lib/meals.ts; guardPlan in
-- src/lib/mealPlan.ts). A coach could set it to '{}' and the next week of meals
-- would be drawn from the whole catalogue. No screen does that today. The
-- database allowed it, which is the thing that matters, because a screen is
-- one bug away from doing it and the database is the last line.
--
-- ── And the feature it was blocking ───────────────────────────────────────
--
-- A meal-plan audit found a coach cannot record an allergy a client mentions
-- in person, only read the member's own list. The obvious fix, letting the
-- coach write `avoid`, is the hole above. So the coach gets a column of their
-- own: `coach_avoid`, what the coach was told. Every consumer excludes the
-- UNION of the two. A coach can therefore add a restriction and can never
-- remove one the member declared. Correcting their own note is theirs; the
-- member's list is only ever the member's.
--
-- ── Dislikes ──────────────────────────────────────────────────────────────
--
-- The same audit found no concept of a dislike anywhere: a member who hates
-- mushrooms met them in seven of fourteen mains. `dislikes` is free text,
-- ingredient words, filtered the way `avoid` is. It is a preference, not a
-- safety fact, so the member and their coach may both write it and neither is
-- guarded against the other.

alter table public.clients
  add column if not exists coach_avoid text[],
  add column if not exists dislikes    text[];

comment on column public.clients.coach_avoid is
  'Allergens the client told their coach, recorded by the coach. Excluded IN ADDITION to avoid, never instead of it. The member''s own list (avoid) is member-only; see clients_avoid_is_the_clients.';
comment on column public.clients.dislikes is
  'Ingredients the member does not want to eat, as words. A preference, not a safety fact: filtered like avoid, writable by the member and their coach.';

-- Mirrors clients_injuries_are_the_clients exactly: SECURITY DEFINER, and a
-- null auth.uid() (the server, a backfill) is allowed through, as it is there.
create or replace function public.clients_avoid_is_the_clients()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.avoid is distinct from old.avoid
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the client may add, change or remove their own allergens. Record what they told you as a coach note instead.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists clients_avoid_guard on public.clients;
create trigger clients_avoid_guard
  before update on public.clients
  for each row execute function public.clients_avoid_is_the_clients();

revoke execute on function public.clients_avoid_is_the_clients() from public, anon, authenticated;
