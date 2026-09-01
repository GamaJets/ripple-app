-- ═══════════════════════════════════════════════════════════════════════════
-- Honouring a deletion request destroys the receivable and keeps the cash.
--
-- ── The conflict, exactly ─────────────────────────────────────────────────
--
-- In supabase/parts/29-gym-operating-record.sql:
--
--   gym_payments.member_id   on delete SET NULL   (line 49)
--   memberships.member_id    on delete CASCADE    (line 29)
--   gym_invoices.member_id   on delete CASCADE    (line 67)
--
-- Three references to the same profile, two of which destroy their row and one
-- of which keeps it. So deleting a member:
--
--   · KEEPS every payment they ever made, anonymised. The cash stays in the
--     books, which is correct — the money moved and no erasure un-moves it.
--   · DESTROYS every invoice raised against them. The other side of that same
--     cash disappears.
--
-- The result is not "some data is gone". It is that `/accounting` and `/close`
-- are permanently and silently wrong from that moment on, in one direction:
-- money in with nothing that explains it. The "Banked, no invoice in front of
-- it" exception list — the one the screen describes as "exactly where unbilled
-- income hides" — fills up with rows that are not unbilled income at all and
-- can never be explained, because the explanation was deleted. Every month-end
-- from then on reconciles worse than the last, and nothing on any screen says
-- why. app/(owner)/deletions.tsx states the behaviour honestly; nothing in the
-- product resolves it.
--
-- And the destruction is the wrong half on its own terms. A gym has a statutory
-- obligation to retain what it invoiced — six years in the UK, five in most of
-- the EU, five in the UAE under the VAT law, seven in several US states — and
-- an invoice is precisely the document those obligations name. Cascading it
-- away is not privacy compliance. It is a records offence performed in the name
-- of one.
--
-- ── The answer, and why it is this one ────────────────────────────────────
--
-- GDPR Article 17(3)(b) is the whole of the resolution: the right to erasure
-- does not apply to processing "necessary for compliance with a legal
-- obligation". Tax and company law impose exactly such an obligation on the
-- financial record, and on nothing else the gym holds about that person. So the
-- two halves separate cleanly, and the schema should say so:
--
--   ERASED   the account, the profile, the health data, the messages, the
--            photos, the injuries, the check-ins, the coaching relationship.
--            Everything the person is. Already handled elsewhere and not
--            touched here.
--
--   RETAINED the financial record: what was invoiced, what was paid, and the
--            membership those two hang off — with the minimum identity the
--            obligation requires and NOTHING else. An invoice with no name on
--            it does not satisfy any of the statutes above; an invoice with a
--            name, an amount and a date satisfies all of them.
--
-- So all three references become `on delete set null`, which stops the erasure
-- destroying anything — and a BEFORE DELETE trigger on `profiles` copies the
-- billed name onto the financial rows first, so what survives is a legible
-- record rather than three anonymous amounts nobody can reconcile.
--
-- ── Why a snapshot rather than keeping the profile row ────────────────────
--
-- The alternative is to refuse the deletion and soft-delete the profile. That
-- is worse and it is worse in a way that is easy to miss: a profile row that
-- survives an erasure request is still the person's account — it carries their
-- name, their email through auth, their role, their tenant, and it is joined to
-- by thirty tables. "We kept your account but stopped showing it" is not
-- erasure and a regulator has said so repeatedly. The snapshot inverts that: the
-- person is gone from every table that is about a person, and four columns of
-- accounting evidence remain in the ledger, which is exactly the scope the
-- exemption covers.
--
-- ── Why the retention period has no default ───────────────────────────────
--
-- `tenants.record_retention_years` is nullable with NO DEFAULT, for the reason
-- part 99 gives about currency and part 150 gives about every money column: a
-- default that renders cleanly looks considered. Repple is white-label. Six is
-- right in London, five in Dubai, seven in parts of the United States, and any
-- number this file picked would be presented on a compliance screen as the
-- gym's own answer to a legal question it had never been asked. NULL means the
-- gym has not stated a retention period, `retain_until` stays NULL, the record
-- is kept indefinitely, and the screen says so — which is the honest state and
-- the safe one, because over-retaining a financial record is a policy failure
-- and under-retaining it is an offence.
--
-- ── What this part does NOT do ────────────────────────────────────────────
--
-- It does not purge anything when `retain_until` passes. There is no scheduled
-- job here and there must not be one added casually: a job that deletes
-- financial records on a date is a job that will one day delete them on the
-- wrong date, and the only safe version of it is a screen that lists what is now
-- purgeable and asks. `retain_until` is a fact recorded so that screen can be
-- built; it is not a timer.
--
-- Idempotent. It changes three foreign keys and adds five columns; it deletes
-- nothing and rewrites no existing value.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the retention period the gym has stated, or has not ──────────────────

alter table public.tenants
  add column if not exists record_retention_years integer;

alter table public.tenants drop constraint if exists tenants_retention_sane;
alter table public.tenants add constraint tenants_retention_sane
  check (record_retention_years is null or (record_retention_years between 1 and 30));

comment on column public.tenants.record_retention_years is
  'How long this gym must keep a financial record after it was raised, per its own jurisdiction. NULL means the gym has not said — records are then kept indefinitely and the compliance screen states that, because no number this product invented would be the law anywhere in particular.';

-- ── 2. the identity the record keeps when the person is erased ──────────────

alter table public.gym_invoices add column if not exists billed_name text;
alter table public.gym_invoices add column if not exists retain_until date;
alter table public.gym_payments add column if not exists payer_name text;
alter table public.gym_payments add column if not exists retain_until date;
alter table public.memberships  add column if not exists member_label text;

comment on column public.gym_invoices.billed_name is
  'Who this invoice was billed to, snapshotted at the moment their account was erased. NULL on every ordinary row — the name is read live from profiles while the member exists, and this column is the ONLY personal data that survives the erasure. Written by trg_profiles_retain_financial_record and by nothing else.';
comment on column public.gym_payments.payer_name is
  'The same, for a payment. gym_payments.member_id was already ON DELETE SET NULL, so before this the surviving row named nobody at all and the cash could never be reconciled to the invoice it settled.';
comment on column public.memberships.member_label is
  'The same, for a membership — which survives an erasure from this part on, because it is the contract the invoices hang off and a gym''s retention obligation covers it.';
comment on column public.gym_invoices.retain_until is
  'The date this record stops being required by law, computed at erasure from tenants.record_retention_years. NULL means the gym has stated no retention period and the record is kept indefinitely. Nothing deletes on this date — see the header.';

-- ── 3. the three foreign keys, made to agree ────────────────────────────────
--
-- The constraint names are Postgres's own defaults from part 29
-- (`<table>_<column>_fkey`), which is what those references were created with.
-- Dropped if present and recreated pointing the same way with a different
-- action; no data moves.

alter table public.memberships alter column member_id drop not null;
alter table public.memberships drop constraint if exists memberships_member_id_fkey;
alter table public.memberships
  add constraint memberships_member_id_fkey
  foreign key (member_id) references public.profiles(id) on delete set null;

alter table public.gym_invoices alter column member_id drop not null;
alter table public.gym_invoices drop constraint if exists gym_invoices_member_id_fkey;
alter table public.gym_invoices
  add constraint gym_invoices_member_id_fkey
  foreign key (member_id) references public.profiles(id) on delete set null;

-- gym_payments.member_id was already SET NULL and is restated so a reader of
-- this file finds all three references in one place rather than believing the
-- odd one out is still a cascade.
alter table public.gym_payments drop constraint if exists gym_payments_member_id_fkey;
alter table public.gym_payments
  add constraint gym_payments_member_id_fkey
  foreign key (member_id) references public.profiles(id) on delete set null;

-- ── 4. the snapshot, taken before the row goes ──────────────────────────────

/**
 * Copy the billed name onto the financial record, then let the erasure proceed.
 *
 * BEFORE DELETE, which is the only moment this can happen: the profile row is
 * still readable, and the foreign keys above have not yet nulled the links that
 * say which rows are this person's. AFTER DELETE would find no rows to update,
 * silently, and the failure would look exactly like a member with no invoices.
 *
 * `coalesce(billed_name, ...)` so a second run — a restored backup, a replayed
 * migration — cannot overwrite a name already retained with a null.
 *
 * `retain_until` is only computed where the gym has stated a period. A gym that
 * has not gets NULL, which the compliance screen reads as "kept indefinitely,
 * because this gym has not said for how long" rather than as "purgeable today".
 *
 * SECURITY DEFINER because the deletion may be performed by the member
 * themselves through the account-deletion flow, and a member has no rights over
 * `gym_invoices`. Without the definer rights the updates would match zero rows,
 * return no error, and the erasure would complete having retained nothing —
 * which is the current behaviour with extra machinery.
 */
create or replace function public.profiles_retain_financial_record()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.memberships m
     set member_label = coalesce(m.member_label, old.full_name)
   where m.member_id = old.id;

  -- The retention years are read per ROW rather than once, through a correlated
  -- subquery on the row's own tenant. A person can hold a membership at two
  -- gyms in two jurisdictions, and a single lookup would apply one gym's law to
  -- the other gym's invoices.
  update public.gym_invoices i
     set billed_name = coalesce(i.billed_name, old.full_name),
         retain_until = coalesce(
           i.retain_until,
           (select (i.issued_on + make_interval(years => t.record_retention_years))::date
              from public.tenants t
             where t.id = i.tenant_id and t.record_retention_years is not null))
   where i.member_id = old.id;

  update public.gym_payments p
     set payer_name = coalesce(p.payer_name, old.full_name),
         retain_until = coalesce(
           p.retain_until,
           (select ((p.taken_at at time zone 'UTC')::date + make_interval(years => t.record_retention_years))::date
              from public.tenants t
             where t.id = p.tenant_id and t.record_retention_years is not null))
   where p.member_id = old.id;

  return old;
end $$;

revoke all on function public.profiles_retain_financial_record() from public, anon, authenticated;

drop trigger if exists trg_profiles_retain_financial_record on public.profiles;
create trigger trg_profiles_retain_financial_record
  before delete on public.profiles
  for each row execute function public.profiles_retain_financial_record();

comment on function public.profiles_retain_financial_record() is
  'Snapshots the billed name onto invoices, payments and memberships immediately before the profile is deleted, so an erasure leaves a legible financial record instead of destroying one side of the books. The only personal data any erasure leaves behind, and it is retained under GDPR Article 17(3)(b) rather than in spite of it.';
