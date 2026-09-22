-- A coach's guides are not their paperwork.
--
-- `coach_documents` (part 137) was built for waivers and forms: things a
-- client may be asked to accept. Coaches also hand clients nutrition guides and
-- reading on training, and filed there they sat in a list headed as paperwork,
-- beside the waiver, with no way for the client to find "the meal guide" except
-- by title. The board's Resources page lists them as their own things.
--
-- One column, set once at upload like every other column on this table (it has
-- no UPDATE policy and no UPDATE grant, on purpose; see part 137):
--
--   paperwork   the default, and every row written before this part
--   nutrition   a nutrition guide
--   education   anything else a coach wants a client to read
--
-- Nothing about who may read a document changes. The existing policies decide
-- that, row by row, exactly as before; this only says what kind of thing it is.
-- A guide may still be marked required, but the app offers that only for
-- paperwork.

alter table public.coach_documents
  add column if not exists kind text not null default 'paperwork';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coach_documents'::regclass
       and conname = 'coach_documents_kind_chk'
  ) then
    alter table public.coach_documents add constraint coach_documents_kind_chk
      check (kind in ('paperwork', 'nutrition', 'education'));
  end if;
end $$;

comment on column public.coach_documents.kind is
  'paperwork (waivers, forms), nutrition (a nutrition guide) or education (reading for clients). '
  'Set at upload; the table has no UPDATE path. See part 3290.';

-- The member's read, `my_coach_documents()` (part 156), returns a fixed row, so
-- it has to name the new column for the member's app to group by it. A changed
-- return row cannot be replaced in place: drop and recreate, with part 156's
-- body word for word apart from the one column, and its grants restated.
drop function if exists public.my_coach_documents();

create or replace function public.my_coach_documents()
returns table (
  id          uuid,
  coach_id    uuid,
  title       text,
  path        text,
  mime        text,
  bytes       bigint,
  required    boolean,
  retired     boolean,
  created_at  timestamptz,
  accepted_at timestamptz,
  kind        text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select d.id, d.coach_id, d.title, d.path, d.mime, d.bytes, d.required,
         (d.retired_at is not null) as retired,
         d.created_at,
         a.accepted_at,
         d.kind
    from coach_documents d
    join clients c on c.id = auth.uid() and c.trainer_id = d.coach_id
    left join coach_document_acceptances a
           on a.document_id = d.id and a.client_id = auth.uid()
    left join coach_document_recipients r
           on r.document_id = d.id and r.client_id = auth.uid()
   where (d.retired_at is null or a.accepted_at is not null)
     and (a.accepted_at is not null
          or r.client_id is not null
          or not exists (select 1 from coach_document_recipients r2
                          where r2.document_id = d.id))
   order by d.required desc, d.created_at desc
   limit 200;
$fn$;

revoke all on function public.my_coach_documents() from public, anon;
grant execute on function public.my_coach_documents() to authenticated;
