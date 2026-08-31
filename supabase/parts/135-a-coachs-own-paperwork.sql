-- ─────────────────────────────────────────────────────────────────────────
-- The coach's own paperwork — a document they can require a client to accept.
--
-- ── What was here before, and why it is not enough ───────────────────────
--
-- Part 84 gives Repple a liability waiver: one immutable row per person per
-- version of the wording, with no UPDATE and no DELETE policy, and — the part
-- that matters here — NO COACH READ. It is Repple's release, it is the
-- client's legal record, and a coach has no business reading it through the
-- app.
--
-- That is correct and this file does not touch a line of it.
--
-- It also leaves a working trainer with nowhere to put their own paperwork. A
-- real PT has a par-form, a studio waiver, a cancellation agreement, a
-- photography consent, house rules for the unit they rent. Today they email it,
-- or they do not bother, and either way the app that holds the booking and the
-- injuries and the payments holds no record that the client ever agreed to
-- anything the COACH asked them to agree to.
--
-- So: a separate, coach-owned thing, sitting beside part 84 and sharing nothing
-- with it. `liability_waivers` is untouched. Its policies are untouched. If you
-- are here to make a coach able to read a Repple waiver, this is not that file
-- and there is no such file.
--
-- ── The two halves ───────────────────────────────────────────────────────
--
--   coach_documents             the paperwork. Owned by the coach, immutable in
--                               everything a person could have read.
--   coach_document_acceptances  one row per person per document, insert-only,
--                               modelled line for line on part 84.
--
-- ── WHAT IMMUTABLE MEANS HERE ────────────────────────────────────────────
--
-- Part 84's evidence is immutable because re-wording the waiver ADDS a row
-- rather than editing what somebody actually agreed to. The same rule has to
-- hold from the other end here: the acceptance points at a document, so the
-- document's WORDING must be unable to change underneath it. A coach who could
-- edit the title or swap the file behind an accepted document would hold a
-- signed acceptance of something nobody read.
--
-- Three separate things enforce that and each one is load-bearing:
--
--   · no UPDATE or DELETE policy on either table, and no such grant either;
--   · a guard trigger refusing any change to coach_id, title, path, mime or
--     bytes, so the two SECURITY DEFINER functions below — which exist to flip
--     `required` and to retire — cannot be widened by accident later;
--   · a storage DELETE policy that refuses to remove the bytes of a document
--     anybody has accepted.
--
-- Re-issuing amended paperwork is a NEW document plus retiring the old one,
-- which is part 84's "add a row" in the shape this feature needs. Retiring
-- never deletes an acceptance: that a client agreed to the March wording in
-- March stays true after the coach moves everyone to the April one.
--
-- ── OBJECT KEY SHAPE ─────────────────────────────────────────────────────
--
--   coach-docs/<coach_uid>/<millis>-<token>-<slug>.pdf
--
-- One meaningful segment: the owning coach. It is what both storage policies
-- read, and src/lib/coachDocs.ts builds and validates the same shape client
-- side so a mismatch fails with a readable sentence rather than a bare 403.
--
-- The bucket is PRIVATE. A document is read through a short-lived signed URL,
-- never getPublicUrl(), which hands back a working-looking string for a private
-- object that then 400s.
--
-- ── OPERATOR NOTE: THE FILE DOES NOT FOLLOW THE ROW ──────────────────────
--
-- The same gap parts 45, 91 and 124 leave open, for the same reason: bytes only
-- go when something calls the Storage API, and a purge queue over pg_net
-- deserves its own review rather than riding along at the bottom of another
-- part. Until it exists, what is outstanding is visible with:
--
--     select (storage.foldername(name))[1] as coach, name, created_at
--       from storage.objects
--      where bucket_id = 'coach-docs'
--        and (storage.foldername(name))[1]::uuid not in (select id from public.trainers)
--      order by created_at;
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The paperwork
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.coach_documents (
  id         uuid        primary key default gen_random_uuid(),
  coach_id   uuid        not null references public.trainers(id) on delete cascade,
  title      text        not null,
  -- The storage key, and it is UNIQUE: two rows pointing at one file would be
  -- two acceptance records of the same bytes under different titles, and the
  -- storage delete guard below asks "has this PATH been accepted".
  path       text        not null unique,
  mime       text        not null,
  bytes      bigint      not null,
  -- Whether a client must accept it before carrying on, or may simply read it.
  -- FALSE by default: requiring somebody to sign something is a decision a
  -- coach makes, never one this table assumes for them.
  required   boolean     not null default false,
  created_at timestamptz not null default now(),
  -- Withdrawn from circulation. The row and every acceptance of it stay.
  retired_at timestamptz,
  constraint coach_documents_title_chk check (length(btrim(title)) between 1 and 120),
  constraint coach_documents_bytes_chk check (bytes > 0 and bytes <= 10485760),
  constraint coach_documents_mime_chk  check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  -- The key must sit in the owning coach's folder. Structural, so a row can
  -- never name a file the storage policies would not let its own coach read.
  constraint coach_documents_path_chk  check (path like coach_id::text || '/%')
);

create index if not exists coach_documents_coach_idx on public.coach_documents (coach_id, retired_at);

comment on table public.coach_documents is
  'A coach''s own waiver, par-form or terms. Nothing to do with `liability_waivers` (part 84), '
  'which is Repple''s release and is deliberately unreadable to a coach. See supabase/parts/135.';
comment on column public.coach_documents.retired_at is
  'Withdrawn from circulation. Never a delete: acceptances of it remain true and remain readable.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · The acceptance — part 84's shape, for the coach's document
-- ═════════════════════════════════════════════════════════════════════════
--
-- One row per person per document. There is deliberately no UPDATE and no
-- DELETE policy, so nobody — the coach included, the client included — can
-- alter or withdraw the record after the fact. That is the sentence part 84
-- opens with and it is the whole point of the table.
create table if not exists public.coach_document_acceptances (
  document_id uuid        not null references public.coach_documents(id) on delete restrict,
  client_id   uuid        not null references public.clients(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  primary key (document_id, client_id)
);

create index if not exists coach_doc_acceptances_client_idx
  on public.coach_document_acceptances (client_id);

-- `on delete restrict` above, and not cascade, is the second half of "the
-- document cannot be deleted once accepted". Cascade would have made deleting
-- the paperwork a way to erase the evidence that people signed it, which is
-- the one thing an evidence table must not permit.
comment on table public.coach_document_acceptances is
  'Immutable: insert and select only, no UPDATE or DELETE policy anywhere. Modelled on part 84.';


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · Nothing a person could have read may change
-- ═════════════════════════════════════════════════════════════════════════
--
-- The two functions in section 5 flip `required` and set `retired_at`, and
-- those are the only legitimate updates this table has. Stating that as a
-- trigger rather than trusting the functions is the part-127 stance: a
-- restriction that lives only inside the one caller that respects it is a
-- restriction the next caller does not have.
create or replace function public.coach_documents_immutable_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.coach_id is distinct from old.coach_id
     or new.title  is distinct from old.title
     or new.path   is distinct from old.path
     or new.mime   is distinct from old.mime
     or new.bytes  is distinct from old.bytes then
    raise exception 'A document somebody may already have accepted cannot be rewritten. Upload a new one and retire this.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

-- A trigger function is reached by the trigger firing, never by a caller, so
-- nothing needs EXECUTE on it. Stated rather than left to Supabase's stock
-- default privileges, which hand it to both API roles.
revoke all on function public.coach_documents_immutable_guard() from public, anon, authenticated;

drop trigger if exists coach_documents_immutable on public.coach_documents;
create trigger coach_documents_immutable
  before update on public.coach_documents
  for each row execute function public.coach_documents_immutable_guard();


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Who may see what
-- ═════════════════════════════════════════════════════════════════════════
alter table public.coach_documents            enable row level security;
alter table public.coach_document_acceptances enable row level security;

-- The coach owns theirs, at every verb they have. Their current clients read
-- the ones still in circulation — a retired document stays readable to somebody
-- who ACCEPTED it, because they are entitled to see what they agreed to, and
-- disappears for everybody else.
drop policy if exists coach_documents_coach_r on public.coach_documents;
create policy coach_documents_coach_r on public.coach_documents
  for select to authenticated
  using (coach_id = (select auth.uid()));

-- ── The `exists` that must NOT be written inline here ────────────────────
--
-- The acceptance clause reads `coach_document_acceptances`, whose own SELECT
-- policy reads `coach_documents` (a coach sees acceptances of their documents).
-- Written as a plain sub-select, those two policies call each other and every
-- read of either table fails 42P17, infinite recursion — which is exactly the
-- fault part 54 had to undo across the whole video library, where it looked
-- like an empty library rather than like an error. It was reproduced here, on
-- the first insert, before this note existed.
--
-- `has_accepted_coach_doc` is SECURITY DEFINER, so its own read of the
-- acceptances table does not re-enter a policy, and the cycle terminates. Same
-- device, same reason, as `can_use_message_thread` in part 124.
create or replace function public.has_accepted_coach_doc(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select exists (
    select 1 from public.coach_document_acceptances a
     where a.document_id = p_document
       and a.client_id = (select auth.uid()));
$fn$;

revoke all on function public.has_accepted_coach_doc(uuid) from public, anon;
grant execute on function public.has_accepted_coach_doc(uuid) to authenticated;

drop policy if exists coach_documents_client_r on public.coach_documents;
create policy coach_documents_client_r on public.coach_documents
  for select to authenticated
  using (
    exists (select 1 from public.clients c
             where c.id = (select auth.uid()) and c.trainer_id = coach_documents.coach_id)
    and (retired_at is null or public.has_accepted_coach_doc(id))
  );

-- Uploading is a plain insert, checked. Own row, own folder, and the folder
-- check is the same fact the storage policy asserts about the object — two
-- statements of one rule, in the two places a row and a file can disagree.
drop policy if exists coach_documents_coach_i on public.coach_documents;
create policy coach_documents_coach_i on public.coach_documents
  for insert to authenticated
  with check (
    coach_id = (select auth.uid())
    and path like (select auth.uid())::text || '/%'
  );

-- No UPDATE policy and no DELETE policy. Section 5's functions are the only
-- way `required` and `retired_at` move, and there is no way at all to remove a
-- document. Dropped by name as well, so one added live by hand and written
-- down nowhere does not survive a re-run of setup.sql.
drop policy if exists coach_documents_coach_u on public.coach_documents;
drop policy if exists coach_documents_coach_d on public.coach_documents;
drop policy if exists coach_documents_owner_r on public.coach_documents;

-- ── The acceptance ───────────────────────────────────────────────────────
--
-- Read your own. The coach reads acceptances OF THEIR OWN DOCUMENTS, which is
-- the difference from part 84 and is the point of the feature: they asked for
-- the signature, so they get to see whether they have it. What they still
-- cannot see is anything about Repple's waiver, or about another coach's.
drop policy if exists coach_doc_accept_own_r on public.coach_document_acceptances;
create policy coach_doc_accept_own_r on public.coach_document_acceptances
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or exists (select 1 from public.coach_documents d
                where d.id = coach_document_acceptances.document_id
                  and d.coach_id = (select auth.uid()))
  );

-- Accept your own, for yourself, from your own coach, and only a document that
-- is still in circulation. A coach cannot record an acceptance on somebody's
-- behalf — `client_id = auth.uid()` is what makes the row evidence rather than
-- an assertion by the person who benefits from it.
drop policy if exists coach_doc_accept_own_i on public.coach_document_acceptances;
create policy coach_doc_accept_own_i on public.coach_document_acceptances
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and exists (
      select 1 from public.coach_documents d
        join public.clients c on c.id = (select auth.uid())
       where d.id = coach_document_acceptances.document_id
         and d.coach_id = c.trainer_id
         and d.retired_at is null)
  );

-- Deliberately absent, and dropped by name: any UPDATE or DELETE policy.
drop policy if exists coach_doc_accept_own_u on public.coach_document_acceptances;
drop policy if exists coach_doc_accept_own_d on public.coach_document_acceptances;

-- RLS narrows a GRANT; it does not confer access. Supabase's stock default
-- privileges hand `anon` the full DML set on anything created in this schema
-- (parts 119, 120, 134), so both of these arrived reachable by the publishable
-- key. And the missing UPDATE/DELETE policies above only hold while there is no
-- grant behind them to narrow: a policy that does not exist refuses, but a
-- grant that does exist is one `create policy` away from being usable.
revoke all on public.coach_documents            from anon;
revoke all on public.coach_document_acceptances from anon;
revoke update, delete on public.coach_documents            from authenticated;
revoke update, delete on public.coach_document_acceptances from authenticated;
grant select, insert on public.coach_documents            to authenticated;
grant select, insert on public.coach_document_acceptances to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · The two things a coach may change
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.set_coach_document_required(p_document uuid, p_required boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update coach_documents set required = p_required
   where id = p_document and coach_id = v_uid and retired_at is null;
  get diagnostics n = row_count;
  -- Zero rows is a refusal, not a success. PostgREST reports a write that
  -- matched nothing as a 200 and the screen above it says "saved".
  return n > 0;
end $fn$;

revoke all on function public.set_coach_document_required(uuid, boolean) from public, anon;
grant execute on function public.set_coach_document_required(uuid, boolean) to authenticated;

-- Retiring, not deleting. Everything anybody accepted stays accepted and stays
-- readable to the person who accepted it.
create or replace function public.retire_coach_document(p_document uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update coach_documents set retired_at = now(), required = false
   where id = p_document and coach_id = v_uid and retired_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $fn$;

revoke all on function public.retire_coach_document(uuid) from public, anon;
grant execute on function public.retire_coach_document(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · Reading the two lists
-- ═════════════════════════════════════════════════════════════════════════
--
-- The client's side: what their coach asks of them, and what they have already
-- signed. Retired documents appear only when this person accepted them.
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
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select d.id, d.coach_id, d.title, d.path, d.mime, d.bytes, d.required,
         (d.retired_at is not null) as retired,
         d.created_at,
         a.accepted_at
    from coach_documents d
    join clients c on c.id = auth.uid() and c.trainer_id = d.coach_id
    left join coach_document_acceptances a
           on a.document_id = d.id and a.client_id = auth.uid()
   where d.retired_at is null or a.accepted_at is not null
   order by d.required desc, d.created_at desc
   limit 200;
$fn$;

revoke all on function public.my_coach_documents() from public, anon;
grant execute on function public.my_coach_documents() to authenticated;

-- The coach's side: one document, and where every current client stands on it.
-- A name and a timestamp; nothing else about the person, because this screen is
-- about paperwork and not about them.
create or replace function public.coach_document_standing(p_document uuid)
returns table (
  client_id   uuid,
  client_name text,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select c.id,
         p.full_name,
         a.accepted_at
    from coach_documents d
    join clients c on c.trainer_id = d.coach_id
    left join profiles p on p.id = c.id
    left join coach_document_acceptances a
           on a.document_id = d.id and a.client_id = c.id
   where d.id = p_document
     and d.coach_id = auth.uid()
   order by a.accepted_at nulls first, p.full_name
   limit 500;
$fn$;

revoke all on function public.coach_document_standing(uuid) from public, anon;
grant execute on function public.coach_document_standing(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 7 · The bucket
-- ═════════════════════════════════════════════════════════════════════════
--
-- Private, and re-asserted private on every run: `public = false` sits in the
-- DO UPDATE rather than being left to the insert, so a bucket somebody flipped
-- public in the dashboard is flipped back by re-running setup.sql rather than
-- quietly kept that way (parts 49, 91, 124).
--
-- 10 MB, matching `coach_documents_bytes_chk` so the row and the object agree
-- about the limit and the app can say "that file is too large" before it
-- uploads rather than rendering a 413 as a failure with no sentence.
--
-- PDF because that is what a waiver is, JPEG and PNG because a coach with a
-- paper form photographs it. No Word document: a .docx is a file this app can
-- neither render nor sign, and offering it would produce paperwork a client
-- cannot read on the phone they are being asked to accept it on.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-docs', 'coach-docs', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═════════════════════════════════════════════════════════════════════════
-- 8 · One definition of "this coach's paperwork is addressed to you"
-- ═════════════════════════════════════════════════════════════════════════
--
-- Takes the FIRST PATH SEGMENT as text and answers whether the caller is the
-- coach who owns that folder, or one of their current clients. Same three
-- deliberate properties as `can_use_message_thread` in part 124:
--
-- It takes text, not uuid, because that is what `storage.foldername(name)`
-- returns, and casting inside the policy would raise 22P02 on any object whose
-- folder is not a uuid — including one in another bucket, since nothing
-- guarantees Postgres evaluates the `bucket_id` arm of an AND first. The CASE
-- is the guard: CASE does not evaluate the branches it does not take.
--
-- It is SECURITY DEFINER so the storage policy does not depend on the caller's
-- own visibility of `clients`, and so it cannot re-enter a policy and recurse —
-- the 42P17 fault part 54 had to undo across the whole video library.
--
-- ANOTHER COACH IS NOT ON THE LIST. They are not the owner of the folder, and
-- they are not a client of its owner, so both branches are false. There is no
-- tenant branch and no owner branch and there must never be one: a gym owner
-- reading the terms two other people agreed between themselves is the same
-- class of thing part 124 refuses.
create or replace function public.can_read_coach_doc(p_owner text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when p_owner is null then false
    when p_owner !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    when p_owner::uuid = (select auth.uid()) then true
    else exists (
      select 1 from public.clients c
       where c.id = (select auth.uid())
         and c.trainer_id = p_owner::uuid)
  end;
$fn$;

comment on function public.can_read_coach_doc(text) is
  'Is the caller the coach who owns this coach-docs folder, or one of their current clients? '
  'SECURITY DEFINER so the storage policies do not depend on the caller''s own read of clients. See parts 135, 124, 54.';

-- `revoke ... from public` alone leaves BOTH API roles standing — Supabase
-- grants execute to anon and authenticated separately, which is exactly how
-- part 105 shipped an unauthenticated cross-tenant write (part 120). anon has
-- no business asking; a policy is evaluated as the querying role, so
-- authenticated needs it.
revoke all on function public.can_read_coach_doc(text) from public, anon;
grant execute on function public.can_read_coach_doc(text) to authenticated;

-- Whether the bytes at this key may still be removed. False the moment anybody
-- has accepted the document that points at it: an acceptance of a file that no
-- longer exists is a signature on a blank page.
create or replace function public.coach_doc_unaccepted(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select not exists (
    select 1
      from public.coach_documents d
      join public.coach_document_acceptances a on a.document_id = d.id
     where d.path = p_path);
$fn$;

revoke all on function public.coach_doc_unaccepted(text) from public, anon;
grant execute on function public.coach_doc_unaccepted(text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 9 · Storage policies — the coach, their clients, and nobody else
-- ═════════════════════════════════════════════════════════════════════════
--
-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- exactly like a working restriction — the same guard parts 45, 91 and 124
-- open with.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the policies below would be inert.';
  end if;
end $$;

-- Write: your own folder only. A client cannot put a file into their coach's
-- paperwork and then be shown it as something the coach asked them to sign.
drop policy if exists coachdoc_obj_insert on storage.objects;
create policy coachdoc_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'coach-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Read. This is the policy signing a URL is checked against, so it is the whole
-- of who can open the document. The coach, and the people they currently coach.
-- When a client changes coach, `clients.trainer_id` moves and the old coach's
-- paperwork stops being readable to them — which is the same behaviour their
-- message thread and their plan already have.
drop policy if exists coachdoc_obj_read on storage.objects;
create policy coachdoc_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'coach-docs'
    and public.can_read_coach_doc((storage.foldername(name))[1])
  );

-- Delete: the owning coach, and only while nobody has accepted it. Retiring is
-- what a coach does with paperwork that is in circulation; this covers the file
-- uploaded by mistake thirty seconds ago, which nobody has seen.
drop policy if exists coachdoc_obj_delete on storage.objects;
create policy coachdoc_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'coach-docs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.coach_doc_unaccepted(name)
  );

-- No UPDATE policy, on purpose, and for the reason 91 and 124 give: an UPDATE
-- policy allows the bytes behind an already-signed key to be replaced, which is
-- a change nobody could see afterwards. Here it is not a general principle but
-- the literal failure mode — the whole feature is a record of what somebody
-- agreed to. The app uploads with upsert:false and a fresh key every time.

-- ── DELIBERATELY ABSENT ──────────────────────────────────────────────────
-- A tenant or owner read branch, and anything at all touching part 84.
drop policy if exists coachdoc_obj_tenant_read on storage.objects;
drop policy if exists coachdoc_obj_owner_read  on storage.objects;
