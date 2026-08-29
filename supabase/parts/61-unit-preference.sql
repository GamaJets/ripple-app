-- ─────────────────────────────────────────────────────────────────────────
-- Which units a client reads their own body in.
--
-- TF-37 asked for a default plus real conversion. The conversion is
-- src/lib/units.ts. This is the half that decides whether the client has to
-- answer the question again on their next phone.
--
-- ── Why it cannot stay on the device ───────────────────────────────────────
--
-- The preference lived in AsyncStorage under 'repple.settings', alongside the
-- two notification toggles, and was written nowhere else. That is the same
-- shape as the goal target before part 59 and the step goal before part 60, and
-- it fails the same three ways:
--
--   · a reinstall, or a new phone, silently resets it — and unlike a lost
--     notification toggle, this one changes what every number on screen SAYS.
--     A client who reads in pounds opens the app on a new handset and their
--     weight has apparently changed by a factor of 2.2;
--   · a client with a phone and a tablet gets a different answer on each;
--   · the coach's console and any coach-facing figure have nothing to read, so
--     a coach cannot see a client's numbers the way the client sees them.
--
-- ── Two columns, not one ───────────────────────────────────────────────────
--
-- A single 'metric' / 'imperial' switch is tidier and wrong for the population
-- this product actually has. A great many people — most of the UK, and a good
-- share of the UAE's expat residents — think about body weight in one system
-- and height in the other. Forcing them to pick a side means one of the two
-- numbers on their profile is always in a unit they have to convert in their
-- head, which is the thing this ticket is about.
--
-- length_unit covers height AND tape measurements together, because those are
-- the same instrument to the person holding it. Height in 'in' is rendered as
-- feet and inches; a waist in 'in' is rendered as plain inches. Same stored
-- centimetres, same column, different presentation — see src/lib/units.ts.
--
-- ── Both nullable, with no default ─────────────────────────────────────────
--
-- NULL means the client has never touched the setting. It does NOT mean 'kg'.
-- The app's default is the app's to choose (it chooses metric, in
-- src/ui/settings.tsx, because this is a UAE-based product and the UAE is
-- metric), and keeping NULL distinct from a real choice is what lets that
-- default improve later — a locale-aware first guess, say — without silently
-- overwriting the answer of every client who deliberately chose kilograms.
-- Writing 'kg' as a column default would make those two states identical and
-- that door closes for good.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists weight_unit text;

alter table public.clients
  add column if not exists length_unit text;

-- The check allows NULL explicitly rather than relying on the fact that NULL
-- passes an IN test by evaluating to unknown. Stating it is the difference
-- between "we thought about the unset case" and "we got away with it".
alter table public.clients drop constraint if exists clients_weight_unit_check;
alter table public.clients add constraint clients_weight_unit_check
  check (weight_unit is null or weight_unit in ('kg', 'lb'));

alter table public.clients drop constraint if exists clients_length_unit_check;
alter table public.clients add constraint clients_length_unit_check
  check (length_unit is null or length_unit in ('cm', 'in'));

comment on column public.clients.weight_unit is
  'How this client reads body weight: kg or lb. NULL means they have not chosen — the app applies its own default and does not write one here. Storage is always kilograms; this only changes presentation and entry (src/lib/units.ts).';
comment on column public.clients.length_unit is
  'How this client reads height and tape measurements: cm or in. NULL means they have not chosen. Storage is always centimetres.';

-- No policy changes. `clients` already carries the client-owns-their-row and
-- coach-can-read policies from 08-roster-access.sql / 38-tenant-isolation.sql,
-- and a unit preference is exactly as sensitive as `diet` sitting beside it.
--
-- Trigger functions in this schema are not callable; see 51-advisor-tidy.sql.
-- Nothing here adds one. `npm run db:build` must be re-run so this part reaches
-- supabase/setup.sql before the migration is applied.
