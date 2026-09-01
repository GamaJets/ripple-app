-- ═══════════════════════════════════════════════════════════════════════════
-- A gym signs people up on paper and this product had nowhere to put any of it.
--
-- Grepping app/(owner) for waiver, contract, consent, signature or PAR-Q
-- returns nothing at all. What exists is not the gym's:
--
--   src/lib/waiver.ts    the REPPLE platform release, gated in
--                        app/(client)/_layout.tsx. It is the client agreeing
--                        with Repple, not with the gym they train at.
--   src/lib/coachDocs.ts coach-issued and client-scoped, under the `coach-docs`
--                        bucket, and deliberately private to one coach and one
--                        client (see supabase/parts/156).
--
-- So an owner cannot see who has signed what, and there is no health
-- questionnaire, guardian consent, photo consent or terms version anywhere in
-- the record. Two consequences, and the second is the expensive one:
--
--   · An injury claim arrives and the gym cannot produce the signed waiver, the
--     PAR-Q that would have flagged the condition, or the version of the terms
--     that was in force on the day.
--   · A sixteen-year-old is signed up and nothing records that a guardian ever
--     agreed. That is not a records gap, it is the gym operating without
--     consent it is legally required to hold.
--
-- And the six storage buckets in this project are `photos`, `exercise-videos`,
-- `exercise-demos`, `message-media`, `coach-docs` and `injury-docs`. Not one of
-- them is the gym's, so a signed contract, an insurance certificate, a service
-- report or a photograph of a broken machine has no home in this product at
-- all.
--
-- ── Why a version and not just a document ─────────────────────────────────
--
-- The question a gym is asked in a dispute is never "do you have terms". It is
-- "what did this person agree to, on this date". A single mutable `terms` field
-- answers the first and actively destroys the answer to the second — an owner
-- editing the waiver in 2027 would silently rewrite what everybody signed in
-- 2025.
--
-- So `gym_agreements` is versioned and its body is IMMUTABLE once anybody has
-- signed it. Editing produces a NEW version; the old one stays, still pointed
-- at by every signature it collected. The trigger below is what enforces that,
-- because a rule this important cannot live in a screen.
--
-- ── Why the signature is typed rather than drawn ──────────────────────────
--
-- `signed_name` is what the person typed, plus the time and the agreement
-- version. That is a simple electronic signature and it is what eIDAS Article
-- 25 and the UK Electronic Communications Act make admissible; a drawn squiggle
-- on a phone is not more binding and is considerably more storage. A gym that
-- needs a qualified signature needs a signing provider, and that is an XL item
-- with a contract behind it, not a canvas element.
--
-- Additive and idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. what the gym asks people to agree to ─────────────────────────────────

create table if not exists public.gym_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- Six kinds, and they are separate because they are separately required. A
  -- gym may lawfully train somebody who refused photo consent; it may not train
  -- somebody who refused the waiver, and it may not train a minor at all
  -- without the guardian one. A single 'terms' bucket would flatten that.
  kind text not null check (kind in (
    'waiver',            -- liability release
    'terms',             -- membership terms and conditions
    'par_q',             -- the pre-exercise health questionnaire
    'photo_consent',     -- may we photograph you in the building
    'guardian_consent',  -- an adult agreeing on behalf of a minor
    'contract'           -- a signed membership agreement
  )),

  title text not null check (btrim(title) <> ''),
  -- The words themselves, as they stood. Immutable once signed — see the
  -- trigger at the foot of this section.
  body text not null check (btrim(body) <> ''),
  version integer not null check (version >= 1),

  -- Whether this is the version being handed out now. At most one live version
  -- per kind per gym, which the partial index below guarantees; retiring one
  -- without publishing a replacement is allowed, and means the gym has stopped
  -- asking for that agreement.
  active boolean not null default true,
  -- Required of a NEW member, as opposed to offered. Photo consent is the one
  -- that is usually not; the waiver always is. Nullable would make "we have not
  -- decided whether this is required" a state, and it is not one — an agreement
  -- either gates joining or it does not.
  required boolean not null default true,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists gym_agreements_version_uq
  on public.gym_agreements (tenant_id, kind, version);

create unique index if not exists gym_agreements_one_live
  on public.gym_agreements (tenant_id, kind)
  where active;

create index if not exists idx_gym_agreements_tenant
  on public.gym_agreements (tenant_id, kind, version desc);

comment on table public.gym_agreements is
  'One version of one thing this gym asks people to agree to. The body is immutable once anybody has signed it — editing publishes a new version and the old one stays, still pointed at by the signatures it collected, because the question in a dispute is what THIS person agreed to on THAT date.';

-- ── 2. who signed which version, and when ───────────────────────────────────

create table if not exists public.gym_agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- No cascade to the agreement, and no cascade from the member either. This is
  -- evidence: a signature that vanishes when somebody tidies up the agreement
  -- list, or when a member is erased, is evidence the gym is required to hold
  -- and has destroyed. `restrict` on the agreement means the version cannot be
  -- deleted while a signature points at it — retire it instead.
  agreement_id uuid not null references public.gym_agreements(id) on delete restrict,
  member_id uuid references public.profiles(id) on delete set null,

  -- What they typed, kept independently of `profiles.full_name` because that is
  -- the point: a signature is what the person wrote at the time, and it must
  -- survive them changing their display name or their account being erased.
  -- The name on a waiver IS the waiver.
  signed_name text not null check (btrim(signed_name) <> ''),
  signed_at timestamptz not null default now(),

  -- The version as it stood, denormalised on purpose. Reading it through the
  -- join would give the same answer today and a different one if anybody ever
  -- renumbers; a signature has to be legible from its own row.
  version_signed integer not null check (version_signed >= 1),

  -- Who countersigned at the desk, where somebody did. NULL for a signature
  -- taken in the app by the member themselves.
  witnessed_by uuid references public.profiles(id) on delete set null,
  note text,

  -- For a guardian consent: who the adult was. NULL on every other kind.
  guardian_name text,
  guardian_relationship text
);

-- One live signature per person per agreement version. Signing again after a
-- new version is published is a NEW row against the NEW version, which is
-- exactly what a re-consent is.
create unique index if not exists gym_agreement_signatures_uq
  on public.gym_agreement_signatures (agreement_id, member_id)
  where member_id is not null;

create index if not exists idx_gym_agreement_sig_member
  on public.gym_agreement_signatures (tenant_id, member_id, signed_at desc);

comment on table public.gym_agreement_signatures is
  'Evidence that one person agreed to one version of one document at one moment. Nothing cascades into this table: a signature must survive the agreement being retired and the member being erased, because it is precisely what a gym is required to be able to produce afterwards.';

-- ── 3. the immutability rule ────────────────────────────────────────────────

/**
 * Refuse to change the words of an agreement anybody has signed.
 *
 * The whole value of a versioned agreement is that a signature from March
 * points at what the document said in March. One UPDATE undoes that for every
 * signature at once, silently, and nothing on any screen would show it — the
 * signature row still says version 2, and version 2 now says something else.
 *
 * `title` and `body` are frozen; `active` and `required` are not, because
 * retiring a version and changing whether it gates joining are decisions about
 * the FUTURE and do not touch what anybody agreed to.
 */
create or replace function public.gym_agreements_freeze_signed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.body is distinct from old.body or new.title is distinct from old.title)
     and exists (select 1 from public.gym_agreement_signatures s where s.agreement_id = old.id)
  then
    raise exception
      'This version has already been signed, so its wording cannot be changed. Publish a new version instead — the signatures on this one point at what it said when they were given.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke all on function public.gym_agreements_freeze_signed() from public, anon, authenticated;

drop trigger if exists trg_gym_agreements_freeze on public.gym_agreements;
create trigger trg_gym_agreements_freeze
  before update on public.gym_agreements
  for each row execute function public.gym_agreements_freeze_signed();

-- ── 4. access ───────────────────────────────────────────────────────────────

alter table public.gym_agreements enable row level security;
alter table public.gym_agreement_signatures enable row level security;

drop policy if exists gym_agreements_owner on public.gym_agreements;
create policy gym_agreements_owner on public.gym_agreements
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Anybody in the gym may READ what they are being asked to agree to. A document
-- somebody has to sign and cannot read before signing is not consent.
drop policy if exists gym_agreements_tenant_r on public.gym_agreements;
create policy gym_agreements_tenant_r on public.gym_agreements
  for select using (tenant_id = my_tenant());

drop policy if exists gym_agreement_sig_owner on public.gym_agreement_signatures;
create policy gym_agreement_sig_owner on public.gym_agreement_signatures
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- The member reads their own signatures and may add one. They may NOT change or
-- withdraw one: there is no update and no delete policy for them, so RLS denies
-- both. Withdrawing consent is a real right and it is a NEW record of the
-- withdrawal, not the quiet disappearance of the record that consent was ever
-- given — which would leave the gym unable to show what it was operating on
-- last week.
drop policy if exists gym_agreement_sig_own_r on public.gym_agreement_signatures;
create policy gym_agreement_sig_own_r on public.gym_agreement_signatures
  for select using (member_id = (select auth.uid()));

drop policy if exists gym_agreement_sig_own_i on public.gym_agreement_signatures;
create policy gym_agreement_sig_own_i on public.gym_agreement_signatures
  for insert with check (
    member_id = (select auth.uid())
    and tenant_id = my_tenant()
    and exists (select 1 from public.gym_agreements a
                 where a.id = agreement_id and a.tenant_id = gym_agreement_signatures.tenant_id));

revoke all on public.gym_agreements from anon, authenticated, public;
grant select, insert, update, delete on public.gym_agreements to authenticated;
grant all on public.gym_agreements to service_role;

revoke all on public.gym_agreement_signatures from anon, authenticated, public;
grant select, insert, update, delete on public.gym_agreement_signatures to authenticated;
grant all on public.gym_agreement_signatures to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · Somewhere to put a document
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The bucket is PRIVATE and re-asserted private on every run, the same way part
-- 91 does it: `public = false` sits in the DO UPDATE rather than only in the
-- insert, so a bucket somebody flipped public in the dashboard is flipped back
-- by re-running setup.sql instead of quietly staying that way.
--
-- The first path segment is the TENANT id, not a user id — which is the whole
-- difference between this bucket and the other five. `injury-docs` and
-- `coach-docs` are scoped to a person; a gym's insurance certificate belongs to
-- the building and has to outlive whichever member of staff uploaded it.
--
-- 25 MB, and PDFs allowed, because the things that go in here are scans: a
-- signed contract, an engineer's service report, an insurance schedule. Images
-- are allowed for the photograph of the broken machine, which is the other half
-- of the equipment record.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-docs', 'gym-docs', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS on storage.objects is enabled by Supabase itself. Asserted rather than
-- assumed, because a policy on a table with RLS off is inert and would look
-- exactly like a working restriction.
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have RLS enabled — the policies below would be inert.';
  end if;
end $$;

-- Owner writes, staff read. A trainer photographing a broken rower needs to
-- upload it, so INSERT is staff-wide; deleting a gym's insurance certificate is
-- not, so DELETE is the owner's alone.
drop policy if exists gymdoc_obj_insert on storage.objects;
create policy gymdoc_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'gym-docs'
    and (storage.foldername(name))[1] = my_tenant()::text
    and my_role() in ('trainer', 'owner')
  );

drop policy if exists gymdoc_obj_read on storage.objects;
create policy gymdoc_obj_read on storage.objects for select to authenticated
  using (
    bucket_id = 'gym-docs'
    and (storage.foldername(name))[1] = my_tenant()::text
    and my_role() in ('trainer', 'owner')
  );

drop policy if exists gymdoc_obj_delete on storage.objects;
create policy gymdoc_obj_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'gym-docs'
    and is_owner_of((storage.foldername(name))[1]::uuid)
  );

-- ── 6. the index of what is in that bucket ──────────────────────────────────
--
-- A bucket with no table in front of it is a folder: it cannot be searched, it
-- cannot say what a file IS, and it cannot say which machine or which member it
-- belongs to. The rows are what make it a record.

create table if not exists public.gym_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- What it is about, where it is about something. Both nullable and both
  -- allowed at once is deliberate — an incident report can name the member and
  -- the machine.
  member_id uuid references public.profiles(id) on delete set null,
  equipment_id uuid references public.gym_equipment(id) on delete set null,

  kind text not null check (kind in (
    'contract', 'insurance', 'service_report', 'certificate',
    'incident', 'photo', 'other'
  )),
  title text not null check (btrim(title) <> ''),

  -- The object key inside the `gym-docs` bucket, tenant-prefixed. Unique, so
  -- two rows cannot claim one file and a delete cannot orphan the other.
  storage_path text not null,
  mime text,
  size_bytes integer check (size_bytes is null or size_bytes >= 0),

  -- When the thing the document is EVIDENCE of expires — an insurance schedule,
  -- a first-aid certificate, a gas safety check. NULL means it does not expire
  -- or nobody has said, and the screen distinguishes those by asking; it does
  -- not invent a date.
  expires_on date,
  note text,

  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create unique index if not exists gym_documents_path_uq
  on public.gym_documents (storage_path);
create index if not exists idx_gym_documents_tenant
  on public.gym_documents (tenant_id, uploaded_at desc);
create index if not exists idx_gym_documents_expiry
  on public.gym_documents (tenant_id, expires_on)
  where expires_on is not null;

comment on table public.gym_documents is
  'The index in front of the gym-docs bucket: what each file is, what it is about, and when the thing it evidences expires. Without it the bucket is a folder — unsearchable, and unable to say which machine a service report belongs to.';

alter table public.gym_documents enable row level security;

drop policy if exists gym_documents_owner on public.gym_documents;
create policy gym_documents_owner on public.gym_documents
  for all using (is_owner_of(tenant_id)) with check (is_owner_of(tenant_id));

-- Staff read the index and may add to it, matching the storage policies above
-- so that a trainer who can upload the file can also record what it is. A row
-- with no file, or a file with no row, is the failure of letting those two
-- rights disagree.
drop policy if exists gym_documents_staff_r on public.gym_documents;
create policy gym_documents_staff_r on public.gym_documents
  for select using (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

drop policy if exists gym_documents_staff_i on public.gym_documents;
create policy gym_documents_staff_i on public.gym_documents
  for insert with check (tenant_id = my_tenant() and my_role() in ('trainer', 'owner'));

revoke all on public.gym_documents from anon, authenticated, public;
grant select, insert, update, delete on public.gym_documents to authenticated;
grant all on public.gym_documents to service_role;
