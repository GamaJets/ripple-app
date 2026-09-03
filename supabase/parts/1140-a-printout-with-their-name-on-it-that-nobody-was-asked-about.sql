-- ─────────────────────────────────────────────────────────────────────────
-- The answer a member gave before a picture of their body-composition sheet
-- left their account.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- app/(client)/scans.tsx photographed the sheet an InBody prints out and, on
-- every single photograph, posted the WHOLE PAGE to two named companies in
-- parallel:
--
--   analyzeInBody()  →  vision-analyze  →  https://api.anthropic.com/v1/messages
--   ocrInBody()      →  ocr-scan        →  https://api.ocr.space/parse/image
--
-- The only thing in front of that was a camera permission — "add a scan" —
-- which is a question about hardware and not about a destination. Nothing on
-- the screen said either company existed.
--
-- What is on that page is not the three figures the screen keeps. It is the
-- member's NAME, their age or date of birth, their height, an ID number, the
-- gym or clinic's name across the header, the date and time they stood on the
-- machine, and then the whole breakdown: body water, protein, minerals, fat
-- mass, lean mass segment by segment, visceral fat, BMR and a score. A person's
-- body, measured, on somebody's letterhead, with their name on it.
--
-- The application-side fix is src/lib/scanSheetConsent.ts and the required
-- `consent` argument on `readScanSheet` in src/ui/scanSheets.ts. This part is
-- the half that makes the agreement a FACT rather than a claim.
--
-- ── WHY A ROW, AND WHY THIS IS NOT THE MEAL-PHOTO SHAPE ──────────────────
--
-- The same app asks about meal photographs with a remembered answer in
-- AsyncStorage (src/lib/photoAI.ts) and about injury documents with a row
-- written before the send (part 1000). This is the second shape, and the
-- dividing line is argued in full at the top of src/lib/scanSheetConsent.ts:
--
--   A meal photograph is COMPOSED by the member, in the moment, looking at the
--   frame. There is no gap between what they agreed to and what they can see,
--   and the act is frequent enough that a per-item question would be tapped
--   through rather than read.
--
--   A printout is composed by a machine in somebody else's building. The member
--   did not choose what is on it and has not necessarily read it. Each sheet is
--   different — the gym's InBody in January is not the hospital's DEXA report
--   in June — so an answer given about the first cannot know what is on the
--   second. And it is RARE: a handful a year, which is what keeps the question
--   being read rather than dismissed.
--
-- So: one row per reading, written BEFORE either invoke, and if the row does not
-- land nothing is sent. That ordering is the whole point — it makes the record
-- load-bearing rather than decorative, and the app is never in a state where the
-- page has gone and the agreement is not on file. A REFUSAL is recorded too,
-- and if THAT write fails nothing is sent either: the refusal is honoured by
-- not acting, not by the row.
--
-- ── WHY IT IS KEYED ON A READ ID AND NOT ON A SCAN ───────────────────────
--
-- An injury document is stored, so part 1000 can name an object path. A scan
-- sheet is not stored anywhere: the photograph is read from and discarded, and
-- `scans` has never held an image. There is no artefact to name.
--
-- So the key is a uuid minted on the device for that one reading. The row says
-- exactly what it can support: on this date, this member was asked about a body
-- composition sheet, was told these companies, and answered this.
--
-- It is deliberately NOT keyed to the saved scan. That would be null for every
-- reading the member abandoned, and — the reason that decides it — it would tie
-- the consent record to a row the member can delete. Deleting your own weigh-in
-- must not delete the record that a copy of the printout went to two companies,
-- because deleting your copy does not un-send theirs. The row goes when the
-- account goes and only then (`on delete cascade` from profiles, which
-- 41-account-deletion.sql already walks).
--
-- ── WHAT MUST NEVER BE ADDED BELOW ───────────────────────────────────────
--
-- A trainer branch, an owner branch, a tenant branch, or any policy reached
-- through `is_my_client(...)`. Part 91 makes the argument for injury documents
-- and it holds unchanged here: the record of what somebody agreed to about
-- their own body is theirs alone. A gym owner reading which of their members
-- sent a body-composition sheet to an OCR vendor is not a feature this file may
-- grow — and the coach does not see the sheet either, only the figures the
-- member saves.
--
-- ── WHY IT IS IMMUTABLE ──────────────────────────────────────────────────
--
-- No UPDATE policy and no DELETE policy, so neither exists for anyone coming
-- through PostgREST. Same stance as part 1000, part 96 and part 84. A consent
-- record the app can rewrite is one the app can manufacture, and the entire
-- point of this table is that it cannot. Changing your mind is a new reading
-- and a new question, which is a new row; the old one keeps saying what was
-- true on the day.
--
-- ── WHAT THE ABSENCE OF A ROW MEANS, WHICH IS NOTHING ────────────────────
--
-- Every sheet photographed before this part existed was sent to both companies
-- without anybody being asked, and has no row here. "No row" therefore means
-- "no record either way", never "never sent", and src/lib/scanSheetConsent.ts
-- carries that as a fourth state with its own sentence. Backfilling 'granted'
-- rows for those readings would be this table's first lie.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.body_scan_sheet_consents (
  id            uuid        primary key default uuid_generate_v4(),
  -- profiles, not clients. A trainer tracking their own training uses the
  -- client screens and the client hooks, and has a profile but need not have a
  -- clients row; keying on clients would have made the consent write fail —
  -- and therefore, by the ordering above, made the read fail — for exactly the
  -- people who self-track. Same note as part 1000.
  client_id     uuid        not null references public.profiles(id) on delete cascade,
  -- The device-minted id of the ONE reading this decision was about. Not a
  -- scan id and not an object path: see the header for why neither exists.
  read_id       uuid        not null,
  -- 'granted' or 'refused'. Both are recorded: the refusal is what lets the app
  -- say later that nothing from that sheet was ever sent and mean it.
  decision      text        not null check (decision in ('granted', 'refused')),
  -- Who it was agreed to go to, and exactly where. Arrays because ONE answer
  -- was given about a SET of destinations — splitting it into two rows would
  -- imply the member made two decisions, and merging them into one name would
  -- lose the one they might care about most. Written on the row rather than
  -- assumed from today's code, so a row from today still says where the sheet
  -- went if a function is ever re-pointed.
  --
  -- The list is what the build would actually attempt: OCR.space always,
  -- Anthropic only where the vision reader is switched on. Naming a company
  -- that was not going to receive it is as wrong as omitting one that was.
  vendors       text[]      not null,
  endpoints     text[]      not null,
  decided_at    timestamptz not null default now(),
  -- One decision per reading. A second row for the same read id could only be a
  -- double-write, and would make "what did I agree to for that sheet"
  -- ambiguous.
  unique (client_id, read_id),
  -- A decision about nobody is not a decision, and a vendor with no endpoint is
  -- half a record. Checked in the database as well as in the writer, because
  -- the service role and migrations do not go through the writer.
  constraint body_scan_sheet_consents_recipients_present
    check (array_length(vendors, 1) >= 1
           and array_length(vendors, 1) = array_length(endpoints, 1))
);

-- The member's own consents, newest first, read by the screen that shows them
-- what has been sent — the record is something they can SEE rather than
-- something the app merely holds.
create index if not exists body_scan_sheet_consents_client_idx
  on public.body_scan_sheet_consents (client_id, decided_at desc);

alter table public.body_scan_sheet_consents enable row level security;

-- auth.uid(), never current_user: under PostgREST every signed-in request runs
-- as the shared `authenticated` role, so a policy built on current_user grants
-- everything to everyone. Same note as parts 79 and 1000.
drop policy if exists body_scan_sheet_consent_own_read on public.body_scan_sheet_consents;
create policy body_scan_sheet_consent_own_read on public.body_scan_sheet_consents
  for select
  to authenticated
  using (client_id = (select auth.uid()));

-- Only the person the consent is about may record one, and only about
-- themselves. A consent somebody else can write is not a consent.
drop policy if exists body_scan_sheet_consent_own_write on public.body_scan_sheet_consents;
create policy body_scan_sheet_consent_own_write on public.body_scan_sheet_consents
  for insert
  to authenticated
  with check (client_id = (select auth.uid()));

-- No UPDATE policy and no DELETE policy. Deliberate — see the header. A later
-- part adding one is adding the ability to manufacture or erase the record of a
-- consent to send somebody's body composition to a third party, and that is the
-- thing this file exists to make impossible.

-- A blank vendor or endpoint passes the array_length check above and says
-- nothing. RLS stops the WRITER being wrong; this stops the ROW being wrong,
-- including for the service role and for migrations, which RLS does not
-- constrain at all.
create or replace function public.body_scan_sheet_consent_names_a_recipient()
returns trigger
language plpgsql
as $fn$
declare
  v text;
begin
  foreach v in array new.vendors loop
    if coalesce(btrim(v), '') = '' then
      raise exception 'A scan sheet consent must name every company the sheet was to be sent to'
        using errcode = '22023';
    end if;
  end loop;
  foreach v in array new.endpoints loop
    if coalesce(btrim(v), '') = '' then
      raise exception 'A scan sheet consent must record the endpoint for every company named'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end $fn$;

drop trigger if exists body_scan_sheet_consent_recipient_guard on public.body_scan_sheet_consents;
create trigger body_scan_sheet_consent_recipient_guard
  before insert on public.body_scan_sheet_consents
  for each row execute function public.body_scan_sheet_consent_names_a_recipient();
