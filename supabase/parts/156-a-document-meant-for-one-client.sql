-- ─────────────────────────────────────────────────────────────────────────
-- A document meant for ONE client.
--
-- ── What was actually wrong ──────────────────────────────────────────────
--
-- Part 135 gave a coach their own paperwork and it works, but it has exactly
-- one audience: everybody. `coach_documents_client_r` is
--
--     exists (select 1 from clients c
--              where c.id = auth.uid() and c.trainer_id = coach_documents.coach_id)
--
-- and `my_coach_documents()` joins on the same fact. So the moment a row lands
-- in `coach_documents`, every client that coach currently has can read it, and
-- can be required to accept it. There is no way to put a document in front of
-- one person.
--
-- That is most of what a coach actually sends. A studio waiver genuinely is for
-- everybody; a training agreement for a named client, a rehab protocol written
-- after one consultation, a nutrition brief, a corrected invoice PDF, a plan
-- somebody paid for — none of those are. The product owner's words were "the
-- Coach's Documents has nothing for a coach to send", and this is the half that
-- was missing: not the upload, which part 135 built, but the addressing.
--
-- ── How that was measured, not assumed ───────────────────────────────────
--
-- Read off the schema in this repo rather than from a screen:
--
--   · `coach_documents` (part 135 § 1) has columns id, coach_id, title, path,
--     mime, bytes, required, created_at, retired_at. There is no recipient
--     column and nothing that could stand in for one.
--   · `coach_documents_client_r` and `my_coach_documents()` (part 135 §§ 4, 6)
--     both key on `clients.trainer_id` alone — a whole-roster fact.
--   · `coach_document_standing()` (part 135 § 6) returns EVERY client on the
--     roster for any document, which is the same statement from the coach's
--     side: the audience of a document is the roster, by construction.
--   · The storage read policy `coachdoc_obj_read` is checked against
--     `can_read_coach_doc((storage.foldername(name))[1])`, which knows only the
--     FOLDER — that is, the coach. Two clients of one coach are
--     indistinguishable to it, so even a perfectly addressed row would have
--     handed a signed URL to the wrong client. Narrowing that is § 5 below and
--     is the half that would have been easy to forget: the row is the list, the
--     object is the document, and a feature that addresses one without the
--     other has addressed nothing.
--
-- ── The shape, and why it is a table and not a column ────────────────────
--
-- A column could hold one recipient. Paperwork goes to two people as often as
-- to one — a couple training together, a client and the parent paying — and a
-- column would force the coach to upload the same bytes twice, which part 135
-- forbids outright (`path` is unique) and which would produce two acceptance
-- records of one document. So: a row per recipient.
--
--     no rows for a document   →  everybody this coach currently coaches
--     one or more rows         →  exactly those people
--
-- The empty case is deliberately the OPEN one, because that is what every
-- document already in the table means today. This part must not silently
-- retract paperwork that clients can currently see, and with any other default
-- it would: a `not exists` audience clause over an empty child table hides
-- every existing document from every client the moment it is applied.
--
-- The cost of that choice is that the FIRST send narrows a document, and the
-- coach has to be told so before they tap. src/lib/coachDocAudience.ts holds
-- that sentence and a test asserts it, for the same reason part 135 holds its
-- own wording there: a promise about what the database does belongs next to the
-- code that will be measured against it.
--
-- ── What is deliberately absent ──────────────────────────────────────────
--
-- No UPDATE policy and no DELETE policy on the new table, and no grant behind
-- either. A recipient list is not evidence in the way an acceptance is, but it
-- is the reason a document was shown to somebody, and part 135's whole posture
-- is that the record of what was put in front of a person does not get edited
-- afterwards. Un-sending is retiring the document, which part 135 already
-- provides and which leaves the acceptances standing.
--
-- Nothing here touches `liability_waivers`. Nothing here touches
-- `coach_document_acceptances`. Nothing here lets a coach read a client's
-- injury document — that is part 91 and part 96, this file does not name those
-- tables, and the direction of this whole feature is coach → client.
-- ─────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · Who a document was sent to
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.coach_document_recipients (
  document_id uuid        not null references public.coach_documents(id) on delete restrict,
  client_id   uuid        not null references public.clients(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  primary key (document_id, client_id)
);

create index if not exists coach_doc_recipients_client_idx
  on public.coach_document_recipients (client_id);

-- `on delete restrict` for the document, matching the acceptances table and for
-- a related reason: a document cannot be deleted at all in part 135, and a
-- cascade here would be the first route to removing one.
comment on table public.coach_document_recipients is
  'Who a coach addressed a document to. NO rows means the whole current roster, which is what every '
  'document meant before this table existed. Insert and select only. See supabase/parts/156.';
comment on column public.coach_document_recipients.sent_at is
  'When it was put in front of this client. Never edited: re-sending is a no-op, not a new timestamp.';


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · "Is this one mine?", without recursion
-- ═════════════════════════════════════════════════════════════════════════
--
-- The client read policy on `coach_documents` has to consult this table, and
-- this table's own policies consult `coach_documents` (a coach sees the
-- recipients of their own documents). Written inline, those two policies call
-- each other and every read of either fails 42P17 — the fault part 135 § 4
-- describes hitting on its first insert, and part 54 had to undo across the
-- whole video library, where it presented as an EMPTY LIBRARY rather than as an
-- error.
--
-- SECURITY DEFINER breaks the cycle: this function's own read does not
-- re-enter a policy. Same device, same reason, as `has_accepted_coach_doc`
-- (part 135) and `can_use_message_thread` (part 124).
create or replace function public.coach_doc_addressed_to_me(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select not exists (
           select 1 from public.coach_document_recipients r
            where r.document_id = p_document)
      or exists (
           select 1 from public.coach_document_recipients r
            where r.document_id = p_document
              and r.client_id = (select auth.uid()));
$fn$;

comment on function public.coach_doc_addressed_to_me(uuid) is
  'True when this document names the caller, or names nobody at all. SECURITY DEFINER to break the '
  'policy cycle between coach_documents and coach_document_recipients. See supabase/parts/156, 135, 54.';

revoke all on function public.coach_doc_addressed_to_me(uuid) from public, anon;
grant execute on function public.coach_doc_addressed_to_me(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The policies on the new table
-- ═════════════════════════════════════════════════════════════════════════
alter table public.coach_document_recipients enable row level security;

-- A client sees that a document was sent to THEM. Not who else got it: who else
-- a coach sends paperwork to is not roster data a client is entitled to, and it
-- is the same class of thing part 124 refuses about message threads.
drop policy if exists coach_doc_recipients_client_r on public.coach_document_recipients;
create policy coach_doc_recipients_client_r on public.coach_document_recipients
  for select to authenticated
  using (client_id = (select auth.uid()));

-- The coach sees the list for their own documents.
drop policy if exists coach_doc_recipients_coach_r on public.coach_document_recipients;
create policy coach_doc_recipients_coach_r on public.coach_document_recipients
  for select to authenticated
  using (exists (select 1 from public.coach_documents d
                  where d.id = coach_document_recipients.document_id
                    and d.coach_id = (select auth.uid())));

-- Deliberately absent, and dropped by name so one added live by hand and
-- written down nowhere does not survive a re-run of setup.sql. There is no
-- INSERT policy either: § 4's function is the only way a row is written, so the
-- three facts it checks together — my document, my client, still in circulation
-- — cannot be satisfied one at a time.
drop policy if exists coach_doc_recipients_coach_i on public.coach_document_recipients;
drop policy if exists coach_doc_recipients_coach_u on public.coach_document_recipients;
drop policy if exists coach_doc_recipients_coach_d on public.coach_document_recipients;

-- RLS narrows a GRANT; it does not confer access. Supabase's stock default
-- privileges hand `anon` the full DML set on anything created in this schema
-- (parts 119, 120, 134), so this table arrived reachable by the publishable key.
-- And the missing INSERT/UPDATE/DELETE policies above only hold while there is
-- no grant behind them to narrow.
revoke all on public.coach_document_recipients from anon;
revoke insert, update, delete on public.coach_document_recipients from authenticated;
grant select on public.coach_document_recipients to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · Sending, and reading who it went to
-- ═════════════════════════════════════════════════════════════════════════
--
-- Returns a BOOLEAN rather than relying on the row count, for the reason
-- `set_coach_document_required` gives in part 135: an INSERT that a policy
-- refused and an INSERT that matched nothing both arrive at PostgREST as a
-- success, and a screen that reads 204 as "sent" tells a coach their client has
-- the paperwork when nobody has been shown anything.
--
-- `on conflict do nothing` and still TRUE: sending twice is the coach making
-- sure, and the honest answer to "is this client on the list" is yes. The
-- original `sent_at` stands — a second send is not a new event and must not
-- look like one.
create or replace function public.send_coach_document(p_document uuid, p_client uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_ok boolean;
begin
  select exists (
    select 1
      from public.coach_documents d
      join public.clients c on c.id = p_client
     where d.id = p_document
       and d.coach_id = (select auth.uid())
       and c.trainer_id = (select auth.uid())
       and d.retired_at is null)
    into v_ok;

  -- Not my document, not my client, or withdrawn from circulation. All three
  -- are the same answer to the caller — false — because none of them is a
  -- distinction a screen should draw for somebody probing ids.
  if not v_ok then
    return false;
  end if;

  insert into public.coach_document_recipients (document_id, client_id)
  values (p_document, p_client)
  on conflict (document_id, client_id) do nothing;

  return true;
end;
$fn$;

comment on function public.send_coach_document(uuid, uuid) is
  'Address one of my documents to one of my current clients. False when it is not mine, they are not '
  'mine, or it has been retired. Idempotent. See supabase/parts/156.';

revoke all on function public.send_coach_document(uuid, uuid) from public, anon;
grant execute on function public.send_coach_document(uuid, uuid) to authenticated;

-- The coach's side: one document, every current client, and the two facts about
-- each of them that this screen is for — whether it was addressed to them, and
-- whether they have accepted it.
--
-- This is `coach_document_standing()` plus `sent_at`. That function is LEFT
-- STANDING and untouched: JS bundles already in the field call it by name, this
-- product ships over the air, and a device that has not taken today's update
-- would get PGRST202 on its "who's accepted" panel the moment this file is run.
-- A new name costs one function and breaks nobody.
create or replace function public.coach_document_audience(p_document uuid)
returns table (
  client_id   uuid,
  client_name text,
  sent_at     timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select c.id,
         p.full_name,
         r.sent_at,
         a.accepted_at
    from coach_documents d
    join clients c on c.trainer_id = d.coach_id
    left join profiles p on p.id = c.id
    left join coach_document_recipients r
           on r.document_id = d.id and r.client_id = c.id
    left join coach_document_acceptances a
           on a.document_id = d.id and a.client_id = c.id
   where d.id = p_document
     and d.coach_id = auth.uid()
   order by a.accepted_at nulls first, r.sent_at nulls first, p.full_name
   limit 500;
$fn$;

revoke all on function public.coach_document_audience(uuid) from public, anon;
grant execute on function public.coach_document_audience(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 5 · The row and the object have to agree
-- ═════════════════════════════════════════════════════════════════════════
--
-- `can_read_coach_doc(text)` (part 135 § 8) takes the first path segment, which
-- is the COACH. It cannot tell two clients of one coach apart, so on its own it
-- would sign a URL for a document addressed to somebody else. The row would be
-- invisible and the bytes would not be, which is the worst of the two.
--
-- It is left in place rather than redefined: its signature and its comment are
-- quoted in part 135 and in src/lib/coachDocs.ts, and it is what
-- `coachdoc_obj_delete` reasons about. This adds the path-aware question beside
-- it and moves the READ policy onto it.
--
-- text, not uuid, for the reason part 135 sets out: `storage.foldername(name)`
-- returns text and a cast inside a policy raises 22P02 on any object whose
-- folder is not a uuid — nothing guarantees Postgres evaluates the `bucket_id`
-- arm of an AND first.
--
-- AN OBJECT WITH NO ROW IS READABLE ONLY BY ITS OWNER. That case is real: part
-- 135's upload writes the bytes first and the row second, and removes the bytes
-- if the row is refused. Between those two statements, and after a failed
-- removal, the object exists and no document points at it. The owner branch
-- covers the coach retrying; there is nobody else it should answer yes to.
create or replace function public.can_read_coach_doc_path(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when p_path is null then false
    when (storage.foldername(p_path))[1] is null then false
    when (storage.foldername(p_path))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    when (storage.foldername(p_path))[1]::uuid = (select auth.uid()) then true
    else exists (
      select 1
        from public.coach_documents d
        join public.clients c
          on c.id = (select auth.uid())
         and c.trainer_id = d.coach_id
       where d.path = p_path
         and (not exists (select 1 from public.coach_document_recipients r
                           where r.document_id = d.id)
              or exists (select 1 from public.coach_document_recipients r
                          where r.document_id = d.id
                            and r.client_id = (select auth.uid()))))
  end;
$fn$;

comment on function public.can_read_coach_doc_path(text) is
  'Whether the caller may open THIS coach-docs object: its owner always, and a current client only when '
  'the document is addressed to them or to nobody. The per-document half of can_read_coach_doc. See parts 156, 135.';

revoke all on function public.can_read_coach_doc_path(text) from public, anon;
grant execute on function public.can_read_coach_doc_path(text) to authenticated;

-- Replaces part 135's `coachdoc_obj_read`, same name so re-running setup.sql
-- lands on this one whichever order a reader pastes from.
drop policy if exists coachdoc_obj_read on storage.objects;
create policy coachdoc_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'coach-docs'
    and public.can_read_coach_doc_path(name)
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 6 · The two reads that decide what a client sees
-- ═════════════════════════════════════════════════════════════════════════
--
-- Both gain the same clause and nothing else. Re-stated in full rather than
-- patched, because a policy is replaced wholesale and a half-quoted one is how
-- a condition gets dropped.
drop policy if exists coach_documents_client_r on public.coach_documents;
create policy coach_documents_client_r on public.coach_documents
  for select to authenticated
  using (
    exists (select 1 from public.clients c
             where c.id = (select auth.uid()) and c.trainer_id = coach_documents.coach_id)
    and (retired_at is null or public.has_accepted_coach_doc(id))
    and public.coach_doc_addressed_to_me(id)
  );

-- A document somebody ACCEPTED stays readable to them whatever happens to the
-- recipient list afterwards, exactly as a retired one does. `has_accepted…` is
-- checked before the addressing clause for that reason: evidence outranks
-- circulation, and a person who signed something is entitled to read what they
-- signed.
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

-- Accepting has to agree with reading, or a client is shown a document they
-- cannot record having accepted. Same clause, same reason as § 6's policy.
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
    and public.coach_doc_addressed_to_me(coach_document_acceptances.document_id)
  );
