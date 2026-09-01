-- ─────────────────────────────────────────────────────────────────────────
-- 220 · Nothing in the app updated live except one message thread
--
-- `.channel(` appeared exactly once in the whole of src/ui, on the chat thread,
-- and part 10 is where its table was added to the realtime publication. Every
-- other screen in the app was a snapshot from whenever it happened to load: a
-- class filling up while a member looked at it, a PT session the coach had just
-- booked, a notification that had already arrived. None of them appeared until
-- the member left the screen and came back.
--
-- The app half of that is src/ui/realtime.ts. This is the database half, and
-- without it the app half is inert: Supabase Realtime only emits
-- `postgres_changes` for tables that are members of the `supabase_realtime`
-- publication, and a subscription to a table that is not in it succeeds,
-- reports itself subscribed, and silently never fires.
--
-- ── What this does NOT do ────────────────────────────────────────────────
--
-- It does not widen who can see anything. Realtime applies row-level security
-- to every change it forwards, so a member subscribed to `class_bookings`
-- receives exactly the rows their own policies already let them SELECT — which
-- for `class_bookings` is their own seats and nobody else's. That is precisely
-- why src/ui/realtime.ts never reads a payload's contents: the numbers on the
-- class screen come from `class_counts()`, a security-definer aggregate over
-- everybody's bookings, and a change event is treated only as a signal to ask
-- that function again.
--
-- Adding a table to a publication also has no effect on any client that is not
-- subscribed to it. The cost is WAL retention on rows that change, which for
-- these five tables is a handful of rows per member per day.
--
-- ── Re-runnable ──────────────────────────────────────────────────────────
--
-- `alter publication ... add table` errors with `duplicate_object` when the
-- table is already a member, so each is wrapped exactly as part 10 wraps the
-- `messages` one. `when others then null` covers the two other ways this can
-- fail on somebody's project — the publication not existing at all on a very
-- old project, and the role running this not owning it — neither of which is a
-- reason for the rest of the setup bundle to stop.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    -- The timetable itself: a class added, moved or cancelled under somebody
    -- who is looking at it.
    'gym_classes',
    -- How full it is. Not read for its contents; it is what tells the app to
    -- ask class_counts() again.
    'class_bookings',
    -- PT: a booking a coach just made, a slot released, a cancellation.
    'sessions',
    -- A client agreeing a delivered session should take it off the coach's
    -- "awaiting sign-off" list without either of them touching anything.
    'session_approvals',
    -- The in-app inbox and the bell. A push is a banner the OS draws; it does
    -- not exist when notifications are switched off and it never updated this
    -- list.
    'notifications'
  ]
  loop
    begin
      -- to_regclass rather than a catalog join: a project that has not applied
      -- the part which creates one of these tables should skip it quietly, not
      -- fail the bundle.
      if to_regclass('public.' || t) is not null then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    exception
      when duplicate_object then null;
      when others then null;
    end;
  end loop;
end $$;
