-- `clients.injuries` holds Injury OBJECTS — {id, area, severity, status, note,
-- at} (src/lib/injuries.ts) — and the column was text[]. Writing an array of
-- objects into it stored each one as its JSON *string*, and reading them back
-- gave an array of strings. Every consumer then asked for a field on a string:
-- `activeInjuries` filters on `i.status === 'active'`, got undefined, and
-- returned nothing.
--
-- So a client could disclose a knee injury, be told it was saved, and have
-- their own screen say "No injuries disclosed" the next time they opened it.
-- The coach never saw it, the planner never trained around it, and the
-- acknowledgement gate could never close because there was never anything to
-- acknowledge. That is the whole injury feature, silently inert.
--
-- No data was at risk: 10 client rows, not one injury on file anywhere in the
-- database — which is itself the evidence. People have used this app and not a
-- single disclosure survived.
--
-- `avoid` and `focus_areas` are genuinely arrays of strings and stay text[].
alter table public.clients
  alter column injuries type jsonb
  using coalesce(to_jsonb(injuries), '[]'::jsonb);

alter table public.clients
  alter column injuries set default '[]'::jsonb;

-- An object array, not a bag of anything. A write that is not a JSON array is
-- the shape this whole change exists to stop being accepted quietly.
alter table public.clients drop constraint if exists clients_injuries_is_array;
alter table public.clients add constraint clients_injuries_is_array
  check (injuries is null or jsonb_typeof(injuries) = 'array');
