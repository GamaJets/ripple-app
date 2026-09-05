-- ── A gym called nothing ───────────────────────────────────────────────────
--
-- 32 of the 54 rows in `tenants` are literally named `'s space` — no name in
-- front of the apostrophe. Verified against the live database. They are all
-- unoccupied today, so nobody is currently looking at one, but the code that
-- makes them is still in the signup path and still runs on every account.
--
-- ── The two coalesces that never fire ──────────────────────────────────────
--
-- The name is built in provision_profile() (part 06, redefined in part 101):
--
--     coalesce(new.full_name, 'My') || '''s space'
--
-- which reads as "My's space when we don't know the name". It never says that,
-- because the row it reads was written moments earlier by handle_new_user()
-- (part 07):
--
--     coalesce(new.raw_user_meta_data->>'full_name', '')
--
-- That coalesce turns "no name given" into an EMPTY STRING, and an empty string
-- is not null, so the second coalesce has nothing to fire on. `'' || '''s
-- space'` is `'s space`. Two defaults, each sensible alone, cancelling each
-- other out: the first one destroys the very signal the second one waits for.
--
-- ── This is a live path, not a hypothetical ────────────────────────────────
--
-- The obvious objection is that the email signup screen requires a name, so
-- full_name is never blank. It is — the PHONE path never had one to require.
-- src/ui/auth.tsx sendPhoneCode() creates the account:
--
--     signInWithOtp({ phone, options: { shouldCreateUser: true,
--                                       data: { brand, role } } })
--
-- `role` and `brand`, no `full_name`, because at that point in the flow nobody
-- has typed one. The account, the profile and the tenant are therefore all
-- created nameless. verifyPhoneCode() does fill `profiles.full_name` in
-- afterwards from the sign-in screen's field — but that is step two, the tenant
-- was named in step one, and nothing goes back to rename it. The gym keeps the
-- placeholder for ever.
--
-- And it cannot be renamed to itself later: parseGymName() in
-- src/lib/gymSettings.ts refuses any name ending in `'s space` as a
-- placeholder. So an owner arriving on one of these sees a gym with no name,
-- and the settings screen tells them the name they were given is not a name.
--
-- ── The fix, in both places ────────────────────────────────────────────────
--
-- Both halves, because either alone leaves a hole:
--
--   • handle_new_user() writing '' is the original loss of information. NULL is
--     the honest value — `full_name` is nullable (checked live), and "we were
--     not told" is exactly what null means. '' is a claim that the name is the
--     empty string.
--   • provision_profile() must still not trust what it reads. It is a trigger
--     on `profiles`, and profiles are written by more than the signup path —
--     the backfill in part 06, an admin insert, anything future. A name of
--     three spaces would sail past a null check and produce `   's space`, so
--     it is trimmed, not merely null-checked.
--
-- Nothing else in either function changes. They provision every account Repple
-- has and a tidy-up here is a production change nobody asked for — the same
-- reasoning part 101 gave for transcribing the rest of provision_profile()
-- unaltered.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    -- NULL, not '', when the signup carried no name. See above: the empty
    -- string is what stops provision_profile()'s coalesce from working.
    nullif(trim(new.raw_user_meta_data->>'full_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.provision_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid; b text;
begin
  tid := new.tenant_id;
  if tid is null then
    select nullif(trim(u.raw_user_meta_data->>'brand'), '') into b
      from auth.users u where u.id = new.id;
    if b is not null and b !~ '^[a-z][a-z0-9_-]{0,31}$' then b := null; end if;
    -- Trimmed and nullif'd rather than coalesce(new.full_name, ...) alone: a
    -- blank or whitespace name must reach the 'My' fallback, whoever wrote the
    -- profile row and whatever they put in it.
    insert into tenants (name, brand)
      values (coalesce(nullif(trim(new.full_name), ''), 'My') || '''s space', b)
      returning id into tid;
    update profiles set tenant_id = tid where id = new.id;
  end if;
  if coalesce(new.role,'client') = 'client' then
    insert into clients (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  elsif new.role = 'trainer' then
    insert into trainers (id, tenant_id) values (new.id, tid) on conflict (id) do nothing;
  end if;
  return new;
end $$;


-- ── No backfill, deliberately ──────────────────────────────────────────────
--
-- An `update tenants set name = 'My''s space' where name = '''s space'` is the
-- obvious next line and it is not here.
--
-- Every one of the 32 rows with that name is UNOCCUPIED — no profile points at
-- any of them, verified live. Renaming them would improve nothing anybody can
-- see, and it would rewrite production rows that are themselves under review
-- for removal, making them harder to identify afterwards by the very name that
-- marks them.
--
-- That the rows are unoccupied is the whole reason the omission is safe, so it
-- is worth writing down rather than leaving a later reader to decide whether it
-- was an oversight. An OCCUPIED tenant with this name has no way out from
-- inside the app: parseGymName() in src/lib/gymSettings.ts refuses any name
-- ending in `'s space` as a placeholder, so the owner cannot even retype what
-- they were given, and there is no other screen that renames a gym. Today
-- nobody is stuck, because nobody is in one. If that ever stops being true the
-- repair is one row, with a human deciding what the gym is actually called —
-- which is the right way round, because `My's space` is a placeholder too,
-- just a grammatical one, and a backfill would only swap one placeholder for
-- another while making the affected rows harder to find.
--
-- This part stops new ones being made. What to do with the existing rows is a
-- data question, not a code one.
