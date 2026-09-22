-- A member's diet is theirs. A coach cannot change it.
--
-- `clients_trainer_update` lets a coach update every column of their client's
-- row. Part 3240 locked `avoid`, the allergen list, to the member after finding
-- a coach could erase a declared allergy. It noted that `diet` was open the same
-- way: a coach could switch a vegan member to a meat diet, and every generated
-- meal, recipe search and plan after that would follow the coach's word rather
-- than the member's.
--
-- The owner's decision, 21 Sep 2026: "a coach cant overwrite a clients diet."
-- Diet is often not a preference a coach may tune but a conviction: vegan,
-- vegetarian, halal, a medical restriction. It is the member's to state.
--
-- Mirrors clients_avoid_is_the_clients and clients_injuries_are_the_clients:
-- SECURITY DEFINER, and a null auth.uid() (the server, a backfill) is let
-- through as those allow. The only code in the app that writes `diet` is the
-- member's own profile save (src/ui/clientData.tsx), which this permits.
-- A coach who thinks a different diet would serve the client says so to them;
-- the change is the client's to make.

create or replace function public.clients_diet_is_the_clients()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  if new.diet is distinct from old.diet
     and auth.uid() is not null
     and auth.uid() <> old.id then
    raise exception 'Only the client may change their own diet.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists clients_diet_guard on public.clients;
create trigger clients_diet_guard
  before update on public.clients
  for each row execute function public.clients_diet_is_the_clients();

revoke execute on function public.clients_diet_is_the_clients() from public, anon, authenticated;
