-- Repple — coach meal-plan picker: the coach can set specific meals per slot for
-- a client. Needs the client's diet + meals/day (so the coach picks from the right
-- catalog) and a per-meal override map on coach_nutrition. Idempotent.
alter table clients add column if not exists diet text;
alter table clients add column if not exists meals_per_day int;
alter table coach_nutrition add column if not exists meal_override jsonb;
