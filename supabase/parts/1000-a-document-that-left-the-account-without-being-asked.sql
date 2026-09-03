-- ─────────────────────────────────────────────────────────────────────────
-- The answer a member gave before their medical document left their account.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- Part 91 built the injury-documents bucket private, own-folder at every verb,
-- with no trainer branch, and app/(client)/injury-doc.tsx told the member so:
-- "The document stays in your account and only you can open it."
--
-- The database kept that promise. The application did not. src/ui/injuryDocs.ts
-- uploaded the file and then handed the same bytes to the `ocr-scan` edge
-- function, which POSTs them to https://api.ocr.space/parse/image — a named
-- company on the public internet — with no consent question anywhere on the
-- path. A physiotherapy report carries a diagnosis, a clinician, a hospital
-- number and a date of birth. All of it went, every time, unasked, under a
-- sentence saying it did not.
--
-- The application-side fix is src/lib/injuryDocConsent.ts and the required
-- `consent` argument on `readInjuryDocument`. This part is the half that makes
-- the agreement a FACT rather than a claim.
--
-- ── WHY A ROW AND NOT A FLAG ─────────────────────────────────────────────
--
-- Because a consent nobody can produce afterwards is indistinguishable from no
-- consent at all, and this codebase has refused that shape everywhere it has
-- come up. Part 79 stores WHICH disclosures a coach acknowledged rather than a
-- bare timestamp, because a timestamp is satisfied forever by one tap. Part 96
-- makes the programme acknowledgement immutable, so neither party can revise
-- what they knew on the day. Part 84's waiver is a record of a signature, not a
-- boolean on a profile.
--
-- One row per document, therefore. Not a column on `clients`, which could only
-- say "this person agreed to something once"; not a settings key, which is
-- answered months before the document that matters exists and cannot know what
-- is in it.
--
-- ── WHY IT NAMES THE DOCUMENT, AND PART 91 SAID NOT TO ───────────────────
--
-- Part 91 argued, deliberately, that an injury document has NO database row:
-- "a table holding document paths is one join away from being read by something
-- that should not read it." That argument was about the FILE — a row that
-- exists so that something can find, list or reach the bytes. It is a good
-- argument and it still stands: there is still no row describing a document,
-- and nothing joins from here to storage.
--
-- This row describes a DECISION, and a decision has to say what it was about.
-- A consent record that cannot answer "which of my documents did you send?" is
-- not a record, it is a counter. The object path is the only identifier that
-- exists — there is nothing else to name — and it is not new information: it is
-- the same string `storage.objects` already holds for the same member under the
-- same own-folder rule this file copies.
--
-- What must NEVER be added below, for the reasons part 91 gives at length: a
-- trainer branch, an owner branch, a tenant branch, or any policy reached
-- through `is_my_client(...)`. Access to a medical document is something a
-- person does, once, per document — and access to the record of what they
-- agreed to is theirs alone. A gym owner reading which of their members sent an
-- oncology letter to an OCR vendor is not a feature this file may grow.
--
-- The row OUTLIVES the file, and that is deliberate. Deleting your copy does
-- not un-send the vendor's, so the record of the send must not vanish with it.
-- It goes when the account goes, and only then (`on delete cascade` from
-- profiles, which is what 41-account-deletion.sql already walks).
--
-- ── WHY IT IS IMMUTABLE ──────────────────────────────────────────────────
--
-- There is no UPDATE policy and no DELETE policy, so neither exists for anyone
-- coming through PostgREST. Same stance as `program_injury_acknowledgements` in
-- part 96 and the waiver in part 84. A consent record that the app can rewrite
-- is a consent record the app can manufacture, and the entire point of this
-- table is that it cannot.
--
-- A member changing their mind does not edit the row. They upload the document
-- again — every path carries its own millisecond and token, so it is a new
-- document and a new question — or they delete the file. The old row keeps
-- saying what was true on the day, which is the only thing a record is for.
--
-- ── WHAT THE ABSENCE OF A ROW MEANS, WHICH IS NOTHING ────────────────────
--
-- Every document uploaded before this part existed was sent to OCR.space
-- without being asked, and has no row here. So "no row" means "no record either
-- way", never "never sent", and src/lib/injuryDocConsent.ts carries that
-- distinction as a fourth state with its own sentence. Backfilling a 'granted'
-- row for those documents would be this table's first lie and would be worse
-- than the defect it was written for.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.injury_doc_ocr_consents (
  id            uuid        primary key default uuid_generate_v4(),
  -- profiles, not clients. A trainer tracking their own training uses the
  -- client screens and the client hooks, and has a profile but need not have a
  -- clients row; keying on clients would have made the consent write fail —
  -- and therefore, by the ordering in injuryDocs.ts, made the read fail — for
  -- exactly the people who self-track.
  client_id     uuid        not null references public.profiles(id) on delete cascade,
  -- The storage key in `injury-docs` this decision was about, as
  -- `<uid>/<millis>-<token>-<slug>.<ext>`.
  object_path   text        not null,
  -- 'granted' or 'refused'. Both are recorded: the refusal is what lets the
  -- app say later that nothing from that document was ever sent and mean it.
  decision      text        not null check (decision in ('granted', 'refused')),
  -- Who it was agreed to go to, and exactly where. Written on the row rather
  -- than assumed from today's code, so a row from today still says where the
  -- document went if the vendor or the endpoint ever changes.
  vendor        text        not null,
  endpoint      text        not null,
  decided_at    timestamptz not null default now(),
  -- One decision per document. The path already carries a millisecond and a
  -- random token, so two rows for one path could only be a double-write, and a
  -- second row would make "what did I agree to for this document" ambiguous.
  unique (client_id, object_path)
);

-- The member's own consents, read by the screen that lists their documents so
-- the record is something they can SEE rather than something the app merely
-- holds. Ordered reads land on (client_id, decided_at).
create index if not exists injury_doc_ocr_consents_client_idx
  on public.injury_doc_ocr_consents (client_id, decided_at desc);

alter table public.injury_doc_ocr_consents enable row level security;

-- auth.uid(), never current_user: under PostgREST every signed-in request runs
-- as the shared `authenticated` role, so a policy built on current_user grants
-- everything to everyone. Same note as part 79.
drop policy if exists injury_doc_ocr_consent_own_read on public.injury_doc_ocr_consents;
create policy injury_doc_ocr_consent_own_read on public.injury_doc_ocr_consents
  for select
  to authenticated
  using (client_id = (select auth.uid()));

-- Only the person the consent is about may record one, and only about
-- themselves. A consent somebody else can write is not a consent.
drop policy if exists injury_doc_ocr_consent_own_write on public.injury_doc_ocr_consents;
create policy injury_doc_ocr_consent_own_write on public.injury_doc_ocr_consents
  for insert
  to authenticated
  with check (client_id = (select auth.uid()));

-- No UPDATE policy and no DELETE policy. Deliberate — see the header. If a
-- later part adds one, it is adding the ability to manufacture or erase a
-- record of consent to send a medical document to a third party, and that is
-- the thing this file exists to make impossible.

-- A path that does not belong to the member it is filed under is a row that
-- claims a decision about somebody else's document. The RLS above stops the
-- WRITER being wrong; this stops the ROW being wrong, including for the service
-- role and for migrations, which RLS does not constrain at all.
create or replace function public.injury_doc_consent_path_is_the_clients()
returns trigger
language plpgsql
as $fn$
begin
  if split_part(new.object_path, '/', 1) <> new.client_id::text then
    raise exception 'An injury document consent must name a document in that member''s own folder'
      using errcode = '22023';
  end if;
  return new;
end $fn$;

drop trigger if exists injury_doc_consent_path_guard on public.injury_doc_ocr_consents;
create trigger injury_doc_consent_path_guard
  before insert on public.injury_doc_ocr_consents
  for each row execute function public.injury_doc_consent_path_is_the_clients();
