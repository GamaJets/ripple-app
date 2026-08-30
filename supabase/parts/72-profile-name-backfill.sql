-- ─────────────────────────────────────────────────────────────────────────
-- Names that signup captured and the profiles row never received.
--
-- Reported as "doesn't show my name on the home screen after Good Morning".
--
-- The home screen greets people from `profiles.full_name`. handle_new_user()
-- copies `raw_user_meta_data->>'full_name'` into that column — but it ends
-- `on conflict (id) do nothing`, so a profiles row inserted by anything else
-- first keeps a blank name, and accounts created before that trigger existed
-- never got one at all. The reporter's own account is from the day after the
-- project was created: the name "Timothy Rodgers" was sitting in the auth
-- record the whole time, and the app was reading a column nobody had filled.
--
-- ── Only blanks ────────────────────────────────────────────────────────────
--
-- A name somebody has since edited in the app is theirs. Overwriting it with
-- whatever they happened to type at signup would be a worse bug than the one
-- being fixed, and a silent one — nobody checks whether their own name is
-- still what they set it to.
--
-- The app now also falls back to the auth record when this column is blank
-- (src/ui/clientData.tsx), so a future account that slips through the same gap
-- heals itself on first launch rather than waiting for another backfill.
-- ─────────────────────────────────────────────────────────────────────────

update public.profiles p
set full_name = btrim(u.raw_user_meta_data->>'full_name')
from auth.users u
where u.id = p.id
  and (p.full_name is null or btrim(p.full_name) = '')
  and btrim(coalesce(u.raw_user_meta_data->>'full_name', '')) <> '';
