-- A gym can have a mark of its own.
--
-- `tenants.logo` has been in the schema since part 01 and nothing has ever
-- written it: app/(owner)/brand.tsx says so, and the owner's share cards
-- (src/ui/owner/GymPosts.tsx) went out with the gym's name and colour but no
-- logo. This is part 330 again, for a gym instead of a coach.
--
-- The column keeps its old name and now holds a storage KEY, never a URL:
-- always <tenant uuid>/<file> in the private gym-logos bucket, enforced by the
-- constraint below. No gym had one set when this was written (checked against
-- the live project, 22 Sep 2026), so the constraint validates cleanly.
--
-- Who may do what with the file:
--   · write and delete: the gym's owner, in their own gym's folder only;
--   · read: the owner, and anyone whose own tenant is this gym. A logo is the
--     gym's public face, and the members' apps may draw it. Nobody else.
-- The tenants row itself was already covered: tenants_owner_rw lets an owner
-- update their own gym and tenants_read lets its people read it (part 38).

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenants'::regclass
       and conname = 'tenants_logo_own_folder'
  ) then
    alter table public.tenants add constraint tenants_logo_own_folder
      check (logo is null or (logo like id::text || '/%' and length(logo) <= 200));
  end if;
end $$;

comment on column public.tenants.logo is
  'Key of this gym''s logo in the private gym-logos bucket, or null when it has none. '
  'Always <tenant uuid>/<file>, enforced by tenants_logo_own_folder. See part 3270.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-logos', 'gym-logos', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the gym-logos policies would be inert.';
  end if;
end $$;

-- The folder is compared as TEXT against a real tenant id, never cast to a
-- uuid: a garbage folder name then simply matches nothing instead of raising.
drop policy if exists gymlogo_obj_insert on storage.objects;
create policy gymlogo_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gym-logos'
    and exists (select 1 from public.tenants t
                 where t.id::text = (storage.foldername(name))[1] and public.is_owner_of(t.id))
  );

drop policy if exists gymlogo_obj_delete on storage.objects;
create policy gymlogo_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'gym-logos'
    and exists (select 1 from public.tenants t
                 where t.id::text = (storage.foldername(name))[1] and public.is_owner_of(t.id))
  );

drop policy if exists gymlogo_obj_read on storage.objects;
create policy gymlogo_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'gym-logos'
    and (
      (storage.foldername(name))[1] = (select public.my_tenant())::text
      or exists (select 1 from public.tenants t
                  where t.id::text = (storage.foldername(name))[1] and public.is_owner_of(t.id))
    )
  );
