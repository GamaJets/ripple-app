-- Repple is to be white-labelled, so a gym in London and a gym in Dubai will
-- run on the same code and must charge in their own money. `tenants` records a
-- name, a logo, a brand colour, a plan and a session_fee — and no currency at
-- all. `session_fee` defaults to 75: seventy-five of something.
--
-- Every money column in the gym operating record defaults to 'AED' and
-- `money()` defaults its argument to 'AED', which was defensible while every
-- customer was in the UAE and becomes a wrong number in front of a paying
-- customer the moment one is not. That is the worst kind of wrong: a default
-- that silently applies LOOKS right. "AED 600" on a London gym's screen reads
-- as a considered figure, not as a missing setting.
--
-- So this is deliberately NULLABLE, and null means "this gym has not told us"
-- rather than a guess. The app renders a dash and asks the owner to set it,
-- exactly as it does for every other figure it has not established. A NOT NULL
-- default would simply move the invention into the schema.
--
-- Existing rows are backfilled to AED because that is what they actually are —
-- the whole operating record around them is denominated in it — not because it
-- is a sensible fallback for the next tenant.
alter table public.tenants
  add column if not exists currency text;

alter table public.tenants drop constraint if exists tenants_currency_is_iso;
alter table public.tenants add constraint tenants_currency_is_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');

update public.tenants set currency = 'AED' where currency is null;

comment on column public.tenants.currency is
  'ISO 4217, uppercase. NULL means the gym has not set one — render a dash and ask, never assume.';
