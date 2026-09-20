-- A COACH CAN PUT A REAL RECIPE IN A CLIENT'S PLAN
--
-- `coach_nutrition.plan` holds the week the coach writes, and every meal in it
-- is an INDEX into the generated catalogue — `idx` plus the diet, exclusions
-- and meals-a-day that define what that index means (src/lib/mealPlan.ts). A
-- Spoonacular recipe has no index: it is somebody else's dish, fetched by id.
-- The member's own app already plans one for today and keeps it in
-- `src/lib/recipePlan.ts` on the handset; the coach had nowhere to put one at
-- all, which is why "Use This Meal" is a member-only action today.
--
-- `recipe_refs` is that place. Shape, and the reason it is this shape:
--
--   { "<day>": { "<pos>": { "source", "sourceId", "title", "image" } } }
--
-- day is the index into `plan.days`, pos the slot within the day — the same
-- two numbers `plan` is already keyed by, so a ref lines up with the meal it
-- replaces and a plan read back without the refs is still a whole plan.
--
-- FOUR KEYS AND NO MORE, and the CHECK holds it to them. Spoonacular's terms
-- let a product keep the id, the title and the image address and nothing else:
-- not the ingredients, not the method, not the macros, which are re-fetched
-- each time through the `recipes` function (docs/RECIPES-SPOONACULAR.md). A
-- column that accepted the whole payload would be a cache nobody agreed to,
-- and web/privacy.html already promises the member these four and no more.
--
-- No policy work: `coach_nutrition_coach_rw` and `coach_nutrition_client_read`
-- cover the row, so the coach writes the refs and the member reads them under
-- the rules that already govern the plan they belong to.
alter table public.coach_nutrition
  add column if not exists recipe_refs jsonb not null default '{}'::jsonb;

comment on column public.coach_nutrition.recipe_refs is
  'Recipes the coach has pinned into the written plan, keyed day → position. Each value holds source, sourceId, title and image and nothing else: the licence lets us keep the reference, never the recipe, so ingredients, method and macros are fetched again each time. A position with no entry is the generated meal in `plan`.';

-- The shape test lives in a function because Postgres will not take a subquery
-- in a CHECK, and walking a two-level object needs one. IMMUTABLE and reading
-- nothing but its argument, which is what a CHECK is allowed to call.
create or replace function public.coach_recipe_refs_ok(refs jsonb)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $fn$
  select jsonb_typeof(refs) = 'object'
     and not exists (
       select 1
       from jsonb_each(refs) as day(dk, dv)
       where jsonb_typeof(dv) <> 'object'
          or exists (
            select 1
            from jsonb_each(dv) as slot(sk, sv)
            where jsonb_typeof(sv) <> 'object'
               or exists (select 1 from jsonb_object_keys(sv) k
                          where k not in ('source', 'sourceId', 'title', 'image'))
               or sv->>'source' is null
               or sv->>'sourceId' is null
          )
     );
$fn$;

alter table public.coach_nutrition drop constraint if exists coach_nutrition_recipe_refs_shape_ck;
alter table public.coach_nutrition add constraint coach_nutrition_recipe_refs_shape_ck
  check (public.coach_recipe_refs_ok(recipe_refs));
