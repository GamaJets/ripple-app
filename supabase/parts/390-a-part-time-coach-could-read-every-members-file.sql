-- ═══════════════════════════════════════════════════════════════════════════
-- Every trainer in the gym could open every member's contract, incident report
-- and medical paperwork, and nothing recorded that they had.
--
-- supabase/parts/185 built the gym's filing cabinet and gated it like this:
--
--     create policy gymdoc_obj_read on storage.objects for select to authenticated
--       using (bucket_id = 'gym-docs'
--          and (storage.foldername(name))[1] = my_tenant()::text
--          and my_role() in ('trainer', 'owner'));
--
-- and `gym_documents_staff_r` on the index in front of it says the same thing.
-- Tenant-wide, plus any trainer. A part-time coach hired last week can mint a
-- signed URL for a member's signed contract, their PAR-Q scan, the accident
-- report from the day they were hurt, and the photograph on their file.
--
-- ── What part 185 argued, and why the argument does not survive ───────────
--
-- 185 says it, in one sentence, at the storage policies:
--
--     "Owner writes, staff read. A trainer photographing a broken rower needs
--      to upload it, so INSERT is staff-wide; deleting a gym's insurance
--      certificate is not, so DELETE is the owner's alone."
--
-- That reasoning is correct and it is about ONE of the seven kinds. A trainer
-- photographing a broken rower is the `photo` and `service_report` case, and
-- for those the argument holds completely: a machine's paperwork belongs to the
-- floor and the people standing on it. The mistake was carrying the conclusion
-- across the whole bucket, so the rule written for a rowing machine ended up
-- governing a member's medical history.
--
-- 185 knew the two were different — it built `member_id` and `equipment_id` as
-- separate columns and its own comment says "an incident report can name the
-- member and the machine". It then wrote one policy that reads neither.
--
-- And the same file argues the opposite position elsewhere, about the very
-- documents this bucket now holds: `coach-docs` is "deliberately private to one
-- coach and one client (see supabase/parts/156)", and part 91 keeps an injury
-- document private to the client who uploaded it — the coach sees the extracted
-- injury, never the file. A gym-issued PAR-Q is the same document as the
-- injury-doc, filed by the other party. It should not be broadly readable for
-- having come in through the front desk instead of the app.
--
-- ── Who can read what now ─────────────────────────────────────────────────
--
-- One rule, and it is decided kind by kind rather than by role alone:
--
--   ABOUT A PERSON   any document attached to a member — whatever its kind —
--                    is readable by the gym's OWNER and by nobody else. No
--                    trainer, related to that member or not.
--
--   ABOUT THE GYM    a document attached to no member is readable by staff
--                    (trainer or owner in this tenant) when its kind is one
--                    the floor needs:
--
--                        service_report   the engineer's report on a machine
--                        photo            the photograph of the broken machine
--                        certificate      first aid, gas safety, fire
--                        insurance        the public-liability schedule
--
--                    and by the owner alone when it is not:
--
--                        contract         a lease, a supplier agreement, or a
--                                         membership agreement filed loose
--                        incident         an account of somebody being hurt
--                        other            the unclassified kind, which is where
--                                         a GP letter or a physio report lands
--                                         when nobody picked a kind
--
-- `other` failing closed is the load-bearing half of that list. It is the
-- default in the picker and it is where anything the seven names do not cover
-- ends up, so it is the one kind whose contents cannot be reasoned about. A
-- rule that guesses generously about the unknown kind is the rule that leaks.
--
-- ── Why not the assigned coach ────────────────────────────────────────────
--
-- `is_my_client()` and `coaching_link_active()` exist and this file uses
-- neither, deliberately. They would answer the narrower question correctly — a
-- coach with no relationship to the member would be refused — but they answer
-- the wrong question. The thing a coach needs from a member's paperwork is
-- WHAT IT SAYS, and this product already has surfaces for that: the injury
-- extract (part 91), the intake answers (part 127), the client record. What is
-- in the bucket is the SCAN: a signed contract with a home address on it, an
-- accident report, a health questionnaire in the member's handwriting. Part 91
-- decided that a coach does not get the file, and there is no reason a gym's
-- copy of the same paperwork should be less protected than the client's own.
--
-- If the assigned coach ever does need one of these, the way to give it to them
-- is a per-document grant that the member or the owner makes — the shape part
-- 47 already uses for progress photos — and not a standing right derived from
-- a roster row.
--
-- ── The erasure hole this closes on the way past ──────────────────────────
--
-- `gym_documents.member_id` is `on delete set null`, so erasing a member turns
-- their contract into a document attached to nobody. A rule that read
-- `member_id is not null` would therefore WIDEN on erasure: the moment the
-- person is gone, their incident report becomes gym-wide paperwork. So the fact
-- that a document is about a person is recorded separately, in
-- `member_attached`, which the trigger below can set and can never clear.
-- It holds no personal data — it is one boolean saying "this was somebody's" —
-- and it survives the erasure that removes the link.
--
-- ── Existing rows ─────────────────────────────────────────────────────────
--
-- Nothing is stranded and nothing is deleted. Every row already uploaded stays
-- exactly where it is and the owner can still read all of it; the backfill sets
-- `member_attached` from `member_id` so a document filed against a member last
-- month is protected on the same rule as one filed today. What changes for a
-- trainer is that four kinds of gym paperwork remain visible and everything
-- else stops being. Nothing gains a reader anywhere in this file.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the fact that a document is about a person ───────────────────────────

alter table public.gym_documents
  add column if not exists member_attached boolean not null default false;

comment on column public.gym_documents.member_attached is
  'This document is about a person. Set from member_id when the row is written and never cleared, because member_id is `on delete set null` — without this, erasing a member would turn their incident report into gym-wide paperwork and hand it to every trainer in the building.';

/**
 * Latch it on, never off.
 *
 * A one-way flag rather than a generated column, and the direction is the whole
 * point. Attaching a member sets it; detaching one — including the SET NULL
 * that an erasure performs — leaves it set. The alternative is a rule that
 * silently widens at the exact moment somebody exercises a right to be
 * forgotten.
 */
create or replace function public.gym_documents_latch_member()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  new.member_attached := new.member_id is not null;
  -- Nested rather than `tg_op = 'UPDATE' and old.member_attached`: OLD is
  -- unassigned in an INSERT trigger and plpgsql evaluates the whole condition
  -- as one expression, so the AND form raises rather than short-circuiting.
  if tg_op = 'UPDATE' then
    if old.member_attached then new.member_attached := true; end if;
  end if;
  return new;
end $fn$;

revoke all on function public.gym_documents_latch_member() from public, anon, authenticated;

drop trigger if exists trg_gym_documents_latch_member on public.gym_documents;
create trigger trg_gym_documents_latch_member
  before insert or update on public.gym_documents
  for each row execute function public.gym_documents_latch_member();

-- Rows filed before this part existed. `member_id is not null` is the only
-- evidence left for them, and it is still true for every row that has not been
-- through an erasure yet.
update public.gym_documents
   set member_attached = true
 where member_id is not null and not member_attached;

-- ── 2. one predicate, read by the table and by the bucket ───────────────────
--
-- Written once and called from both policies, for the reason part 124 gives
-- about `can_use_message_thread`: the storage rule and the table rule must not
-- be able to answer differently about the same document. Two copies of this
-- list would be two copies until somebody edited one.

create or replace function public.gym_doc_readable(
  p_tenant uuid, p_member_attached boolean, p_kind text
) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case
    when p_tenant is null then false
    -- The gym's owner reads the gym's record. `gym_documents_owner` grants this
    -- independently; it is repeated here so the STORAGE policy, which has no
    -- such companion, gets the same answer.
    when public.is_owner_of(p_tenant) then true
    -- About a person: nobody else, whatever their role and whatever the kind.
    when coalesce(p_member_attached, true) then false
    when public.my_tenant() is distinct from p_tenant then false
    when public.my_role() is distinct from 'trainer' then false
    -- The building's paperwork, and only the four kinds the floor needs.
    -- 'contract', 'incident' and 'other' are absent on purpose — see the header.
    else p_kind in ('service_report', 'photo', 'certificate', 'insurance')
  end;
$fn$;

comment on function public.gym_doc_readable(uuid, boolean, text) is
  'May the caller read this gym document? The owner reads everything; a document about a person is the owner''s alone; a trainer reads the building''s service reports, photographs, certificates and insurance and nothing else. Called from BOTH the gym_documents policy and the gym-docs storage policy so the two cannot disagree.';

revoke all on function public.gym_doc_readable(uuid, boolean, text) from public, anon;
grant execute on function public.gym_doc_readable(uuid, boolean, text) to authenticated;

/**
 * The same question, asked about an object key.
 *
 * Takes the object name as text and finds its row by `storage_path`, which
 * `gym_documents_path_uq` makes unique. SECURITY DEFINER so the storage policy
 * does not depend on the caller's own read of `gym_documents` — that would make
 * the bucket exactly as wide as the table and re-enter a policy while doing it.
 *
 * An object with NO row is the owner's alone: it is either an upload whose row
 * has not landed, or an orphan from before Remove deleted both halves, and
 * nothing says what it is. The uuid guard around the cast is part 124's: CASE
 * does not evaluate the branch it does not take, so an object whose first
 * folder is not a uuid returns false instead of raising 22P02 and failing the
 * whole statement — including for objects in other buckets, since nothing
 * guarantees the `bucket_id` arm of an AND is evaluated first.
 */
create or replace function public.gym_doc_object_readable(p_name text)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select case
    when p_name is null then false
    else coalesce(
      (select public.gym_doc_readable(d.tenant_id, d.member_attached, d.kind)
         from public.gym_documents d
        where d.storage_path = p_name),
      case
        when coalesce((storage.foldername(p_name))[1], '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.is_owner_of(((storage.foldername(p_name))[1])::uuid)
        else false
      end)
  end;
$fn$;

comment on function public.gym_doc_object_readable(text) is
  'May the caller read this gym-docs object? Resolves the object key to its gym_documents row and defers to gym_doc_readable. An object with no row is readable by the tenant''s owner alone — it is an unfiled upload or an orphan, and nothing says what is in it.';

revoke all on function public.gym_doc_object_readable(text) from public, anon;
grant execute on function public.gym_doc_object_readable(text) to authenticated;

-- ── 3. the two policies, narrowed ───────────────────────────────────────────

-- Dropped by NAME as well as replaced, because a policy that stays behind is
-- OR'd with the new one and the old width simply survives. `gym_documents_staff_r`
-- IS the tenant-wide read this part exists to remove.
drop policy if exists gym_documents_staff_r on public.gym_documents;
drop policy if exists gym_documents_read on public.gym_documents;
create policy gym_documents_read on public.gym_documents
  for select using (public.gym_doc_readable(tenant_id, member_attached, kind));

drop policy if exists gymdoc_obj_read on storage.objects;
create policy gymdoc_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'gym-docs' and public.gym_doc_object_readable(name));

-- INSERT and DELETE are untouched. A trainer may still upload — photographing a
-- broken rower is the case 185 was right about, and a trainer who can file an
-- incident report but not read one back is the correct asymmetry, not a bug.
-- DELETE stays the owner's alone.

-- ── 4. that somebody opened it ──────────────────────────────────────────────
--
-- The bucket is private, so a document is read by minting a signed URL — and
-- that happens in the CLIENT. No trigger can see it: no row is written, no
-- column changes, and by the time the object is fetched the request is a plain
-- GET against a token that Postgres never hears about. Part 187 hit exactly
-- this with `/export` and answered it the same way:
--
--     "This is the one place the client states what it did rather than being
--      observed doing it, and that is unavoidable: nothing else can see a
--      download. The row is deliberately narrow — what was exported, how many
--      rows, and who — so there is nothing in it worth forging."
--
-- So this is `gym_export_runs` for the filing cabinet, and the trigger below
-- takes it into `gym_events` through `log_gym_event`, which stays the one
-- writer. No second audit trail.
--
-- ── Why the log is a GATE and not a receipt ───────────────────────────────
--
-- The console writes this row BEFORE it asks for the signed URL, and abandons
-- the open if the row will not write. That ordering is the opposite of the
-- upload's — which files the object first and the row second — and it is the
-- opposite on purpose, because the two are protecting different things.
--
-- An upload that logs first can claim a document the gym does not hold. A read
-- that logs second can happen without being recorded at all: the URL is minted,
-- the tab opens, the insert 500s, and nothing anywhere says a member's medical
-- paperwork was opened. Of the two ways to be wrong about a read, an entry for
-- a link that was issued and then failed to open is a statement about an
-- ATTEMPT that was authorised and made — which is true, and is the more
-- conservative half. An unlogged read is a hole in the only record there is.
--
-- The column is `link_issued_at` rather than `opened_at` for that reason: this
-- table records that a key was cut, which is what the console can honestly
-- observe. It cannot see the door being walked through.
--
-- ── Only the member-attached ones ─────────────────────────────────────────
--
-- A trainer opening the fire certificate forty times in a week is not an event.
-- Logging it would bury the one line that matters under the ones that do not,
-- and the RLS check below enforces the scope rather than trusting the console
-- to: a row whose document is not `member_attached` is refused.

create table if not exists public.gym_document_reads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- `set null` and not cascade. The document being removed later is precisely
  -- when this row is worth having — part 185 makes the same argument about a
  -- signature, and it is the same argument.
  document_id uuid references public.gym_documents(id) on delete set null,

  -- Denormalised so the row is legible from itself once the document is gone.
  -- Part 185: "a signature has to be legible from its own row."
  storage_path text not null,
  doc_kind text not null,
  doc_title text not null,

  read_by uuid references public.profiles(id) on delete set null,
  link_issued_at timestamptz not null default now()
);

-- No member name and no member id on this row. The document's own title and
-- the event summary carry what the owner needs to recognise it, and an access
-- log that accumulates its own copy of who somebody was outlives the erasure
-- that was supposed to remove them.

create index if not exists idx_gym_document_reads_tenant
  on public.gym_document_reads (tenant_id, link_issued_at desc);
create index if not exists idx_gym_document_reads_doc
  on public.gym_document_reads (document_id, link_issued_at desc)
  where document_id is not null;

comment on table public.gym_document_reads is
  'One row per signed link cut for a member-attached gym document: which document, and who asked. Written by the console before the link is minted, because nothing in the database can observe a signed URL being used — and written first, so a read that cannot be recorded does not happen.';

alter table public.gym_document_reads enable row level security;

drop policy if exists gym_document_reads_owner_r on public.gym_document_reads;
create policy gym_document_reads_owner_r on public.gym_document_reads
  for select using (public.is_owner_of(tenant_id));

/**
 * May this read be logged as stated?
 *
 * Every field is checked against the document it names, so the row cannot say
 * a different document was opened from the one that was. And `gym_doc_readable`
 * is re-asked here: a log entry can only be written by somebody who could have
 * performed the read, so the table cannot be used to write fiction about
 * documents the writer cannot open.
 */
create or replace function public.gym_doc_read_loggable(
  p_id uuid, p_tenant uuid, p_path text, p_kind text
) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $fn$
  select exists (
    select 1 from public.gym_documents d
     where d.id = p_id
       and d.tenant_id = p_tenant
       and d.storage_path = p_path
       and d.kind = p_kind
       and d.member_attached
       and public.gym_doc_readable(d.tenant_id, d.member_attached, d.kind));
$fn$;

revoke all on function public.gym_doc_read_loggable(uuid, uuid, text, text) from public, anon;
grant execute on function public.gym_doc_read_loggable(uuid, uuid, text, text) to authenticated;

drop policy if exists gym_document_reads_insert on public.gym_document_reads;
create policy gym_document_reads_insert on public.gym_document_reads
  for insert with check (
    read_by = (select auth.uid())
    and public.gym_doc_read_loggable(document_id, tenant_id, storage_path, doc_kind));

revoke all on public.gym_document_reads from anon, authenticated, public;
grant select, insert on public.gym_document_reads to authenticated;
grant all on public.gym_document_reads to service_role;

-- No UPDATE and no DELETE for anybody, for part 187's reason about
-- `gym_export_runs`: a record of an access that the accessor can then remove is
-- worth less than no record at all, because its absence reads as "nobody
-- looked".

-- ── 5. and into the log everything else is in ───────────────────────────────

-- The closed set from part 187, widened by one. Re-declared whole because a
-- CHECK constraint is replaced rather than added to, and dropping the old one
-- without restating every kind would silently make nineteen of them illegal.
alter table public.gym_events drop constraint if exists gym_events_kind_check;
alter table public.gym_events add constraint gym_events_kind_check
  check (kind in (
    -- the five from part 105
    'member-joined', 'trainer-joined', 'session-delivered',
    'session-missed', 'promo-redeemed',
    -- money
    'payment-recorded', 'payment-corrected', 'invoice-raised',
    'price-changed', 'plan-retired',
    -- the membership itself
    'membership-cancelled', 'membership-frozen',
    -- pay
    'payroll-settled', 'payroll-reversed',
    -- the building
    'equipment-retired', 'equipment-out-of-service',
    -- the record
    'month-closed', 'month-reopened', 'record-exported',
    -- somebody's file was opened
    'document-opened'
  ));

create or replace function public.gym_event_document_read()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare v_member uuid;
begin
  select d.member_id into v_member
    from public.gym_documents d where d.id = new.document_id;
  perform public.log_gym_event(
    new.tenant_id, 'document-opened', v_member,
    case when v_member is null
      -- The member has been erased since the document was filed. Naming the
      -- document is all that is left, and it is the honest sentence.
      then format('A link was issued to a member document — %s (%s)',
                  new.doc_title, replace(new.doc_kind, '_', ' '))
      else format('A link was issued to %s''s %s — %s',
                  public.gym_event_name_of(v_member),
                  replace(new.doc_kind, '_', ' '), new.doc_title) end);
  return new;
end $fn$;

revoke all on function public.gym_event_document_read() from public, anon, authenticated;

drop trigger if exists trg_gym_event_document_read on public.gym_document_reads;
create trigger trg_gym_event_document_read
  after insert on public.gym_document_reads
  for each row execute function public.gym_event_document_read();

-- `log_gym_event` swallows its own failures by design — part 187: "a log that
-- can fail a payment is worse than a gap in the log". That is right for a
-- payment and it means `gym_events` is best-effort here too. The authoritative
-- record of an access is `gym_document_reads`, which does NOT swallow: its
-- insert is the gate, and the console does not mint a link when it is refused.

-- ═══════════════════════════════════════════════════════════════════════════
-- OPERATOR NOTE: WHAT IS SWEPT, AND WHAT IS STILL DONE BY HAND
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Removing a document from the compliance screen now deletes the OBJECT and
-- then the row, and refuses to report success unless the object actually went
-- (src/lib/gymDocs.ts). Before this, Remove deleted the row alone: the file
-- stayed in the bucket for ever, still readable by anybody the policy admitted,
-- and with no index row left to find it by — so it was invisible to the very
-- screen that would have removed it.
--
-- What this file does NOT add is a sweeper for erased accounts. Deleting a
-- member sets `gym_documents.member_id` to null; the row and the object both
-- remain, and part 184's argument is why that is correct for some of them — a
-- signed contract is retained under the same legal obligation as an invoice.
-- It is not obviously correct for the rest, and deciding which of a gym's
-- documents outlive the person they are about is a retention question with a
-- statutory answer per country, not something to settle at the bottom of a
-- policy file. `tenants.record_retention_years` is where that decision belongs
-- and it is deliberately NULL by default.
--
-- So the by-hand statement in `DELETION_FILES_NOTE` (src/lib/dataExport.ts)
-- remains true and is unchanged: progress photographs go through the scheduled
-- purge that part 48 runs, and message attachments and injury documents are
-- cleared on request. Gym documents join that second list.
--
-- Until a sweeper exists, what is outstanding is visible with:
--
--     select d.id, d.kind, d.title, d.storage_path, d.uploaded_at
--       from public.gym_documents d
--      where d.member_attached and d.member_id is null
--      order by d.uploaded_at;
--
-- Those are documents about somebody who no longer has an account.
--
-- And the objects that no row points at — an upload whose row never landed, or
-- an orphan left by the old Remove — are visible with:
--
--     select o.name, o.created_at
--       from storage.objects o
--      where o.bucket_id = 'gym-docs'
--        and not exists (select 1 from public.gym_documents d
--                         where d.storage_path = o.name)
--      order by o.created_at;
--
-- Those are readable by the tenant's owner and by nobody else, which is what
-- makes them safe to leave until somebody clears them.
-- ═══════════════════════════════════════════════════════════════════════════
