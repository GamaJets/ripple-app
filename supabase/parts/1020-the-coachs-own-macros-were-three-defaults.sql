-- ═══════════════════════════════════════════════════════════════════════════
-- A coach's daily calorie target was built from three answers nobody asked for.
--
-- ── What the screen was doing ─────────────────────────────────────────────
--
-- app/(trainer)/my-nutrition.tsx computes the coach's own target with
--
--     macrosFor({ weightKg, bodyFatPct, activity, goal, diet })
--
-- and the last three come from `useClientData` — a provider that reads
-- `clients`, a table a coach HAS NO ROW IN. `provision_profile()` gives a
-- role='trainer' signup a `trainers` row and nothing else, which
-- app/(trainer)/my-progress.tsx already writes down in as many words: "the
-- goal, diet and height on that provider are constructed defaults for a coach
-- rather than answers a coach gave".
--
-- The defaults are `'muscle'`, `'meat'` and a literal `1.5`. Through
-- src/lib/nutrition.ts that is a +12% surplus, protein at 2.0 g per kg of lean
-- mass and fat at 27% — so a coach who is cutting was handed a bulking target,
-- headed "Calories Remaining", and counted down against it all day.
--
-- Everything else on that screen is scrupulous: it withholds the hero under a
-- truncated log, refuses a target without a measured body, and says so in
-- words. The three inputs that actually decide the number were the three the
-- coach was never asked for and had no control anywhere in the app to set.
--
-- ── Why the answers go here ───────────────────────────────────────────────
--
-- `coach_prefs` (part 129) is already "one row per account: the coach's own
-- settings", self-only on every verb, and it already holds the other two
-- numbers a coach authored rather than the app computing — the class rate and
-- the monthly targets. A coach's own goal and diet are the same kind of fact
-- and belong beside them.
--
-- NOT on `clients`. Giving a coach a `clients` row to hang three columns off
-- would make them their own client: `is_my_client`, the roster reads, the
-- coach's own book and every RLS policy written around that table all key off
-- rows in it, and a self-row would surface the coach on their own roster. The
-- boundary this schema keeps — a coach self-tracks through `profiles`-keyed
-- tables (parts 95 and 1011), never through `clients` — is the reason those
-- screens are safe to read, and this does not cross it.
--
-- NOT on `trainers` either. That table is the coach's PUBLIC face — bio,
-- tagline, session fee, directory listing, public page — readable by clients
-- through `trainers_public_r`. What somebody eats is not part of a public
-- profile and must not be one column away from being read as one.
--
-- ── NULL is the whole point ───────────────────────────────────────────────
--
-- All three are nullable and null means UNASKED. That is what lets the screen
-- withhold the target and ask the question instead of printing a number built
-- from a default — which is the entire defect. There is deliberately no
-- DEFAULT clause on any of them: a default here would recreate the bug in the
-- database, where it would be even harder to see.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.coach_prefs add column if not exists own_goal text;
alter table public.coach_prefs add column if not exists own_diet text;
-- The activity multiplier the coach's target is built from — `tdee = bmr *
-- activity` in src/lib/nutrition.ts. numeric(3,2) because the values are 1.20
-- through 1.90 and the precision that matters is the hundredth; an integer
-- column would have forced the app to store a code and translate it, and a
-- translation table between two files is how the two come to disagree.
alter table public.coach_prefs add column if not exists own_activity numeric(3,2);

-- The two enumerations are checked HERE as well as in the app, because a value
-- outside them does not fail — it falls through `macrosFor`'s switch to
-- whatever its last branch is and produces a plausible number for a diet
-- nobody follows. The lists are src/lib/types.ts's `Goal` and `Diet`, verbatim.
alter table public.coach_prefs drop constraint if exists coach_prefs_own_goal_known;
alter table public.coach_prefs add constraint coach_prefs_own_goal_known
  check (own_goal is null or own_goal in ('fatloss', 'tone', 'muscle'));

alter table public.coach_prefs drop constraint if exists coach_prefs_own_diet_known;
alter table public.coach_prefs add constraint coach_prefs_own_diet_known
  check (own_diet is null or own_diet in ('meat', 'vegetarian', 'vegan', 'paleo', 'keto'));

-- The same bounds src/lib/coachMacros.ts states, so a row this app did not
-- write cannot price a day at ten times maintenance. Sedentary is 1.2 and
-- "athlete" is 1.9 in every published table this multiplier comes from; the
-- constraint is the range and not the exact set, because a coach whose old row
-- carries a value between two levels is not wrong, only unlabelled.
alter table public.coach_prefs drop constraint if exists coach_prefs_own_activity_sane;
alter table public.coach_prefs add constraint coach_prefs_own_activity_sane
  check (own_activity is null or (own_activity >= 1.0 and own_activity <= 2.5));

comment on column public.coach_prefs.own_goal is
  'The coach''s OWN training goal, for their own macro target. NULL = never asked, which is why the app withholds a target rather than assuming ''muscle''. Nothing to do with any client''s goal.';
comment on column public.coach_prefs.own_diet is
  'The coach''s own diet, for their own macro split. NULL = never asked.';
comment on column public.coach_prefs.own_activity is
  'The activity multiplier their own TDEE is built from (bmr * activity). NULL = never asked; the app used a hardcoded 1.5 for every coach.';
