-- Units belong to the PERSON, not to their role.
--
-- weight_unit and length_unit have lived on `clients` since TF-37, which is
-- correct for a client and leaves everybody else with nowhere to put the
-- answer. A coach has no `clients` row, so their choice fell back to this
-- handset's AsyncStorage: it survived a relaunch and not a reinstall, and did
-- not follow them to a second device. In practice every coach was pinned to
-- kilograms, and the trainer portal offered no control to change it at all —
-- while `log-session.tsx` wrote whatever they typed into a CLIENT's history
-- with a hardcoded "kg" label.
--
-- `profiles` is the one table every account has whatever its role, which is
-- why the columns go here rather than on `trainers`: an owner has the same
-- problem and would otherwise need a third home for the same preference.
--
-- Nullable, and deliberately so. NULL means "never chosen" and must not
-- overwrite what a device already had — see the note in src/ui/settings.tsx.
-- The CHECK is the same one `clients` carries, so a row cannot hold a unit the
-- app has no code path for.
--
-- No new policy: profiles_self is already `for all` on `id = auth.uid()`, so
-- an account can read and write its own units and nobody else's.
alter table public.profiles
  add column if not exists weight_unit text check (weight_unit in ('kg', 'lb')),
  add column if not exists length_unit text check (length_unit in ('cm', 'in'));

comment on column public.profiles.weight_unit is
  'kg or lb, the unit this ACCOUNT reads weights in, whatever its role. Null means never chosen. Clients also have clients.weight_unit, which stays authoritative for them.';
