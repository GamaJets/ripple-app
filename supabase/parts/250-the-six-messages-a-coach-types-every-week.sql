-- ═════════════════════════════════════════════════════════════════════════
-- The six messages a coach types every week.
--
-- ── What was measured ───────────────────────────────────────────────────
--
-- Welcome, the note before a first session, rescheduling, the note after a
-- block finishes, chasing paperwork, checking in. A coach with thirty clients
-- writes each of them several times a month, from scratch, into a composer
-- with no memory. About an hour a week, reported directly.
--
-- Nothing in this database could hold one. `nudge_drafts` does not exist;
-- src/lib/nudge.ts composes a draft per client at read time and keeps nothing.
-- So the composer forgot every good sentence a coach had ever written in it.
--
-- ── The rule this table does NOT change ─────────────────────────────────
--
-- A TEMPLATE IS NOT A SEND.
--
-- Nothing about this row automates anything. There is no trigger on it, no
-- schedule, no "send to everyone tagged X", and no column that could carry one.
-- A template lands in the coach's composer as editable text and the coach
-- presses send — which is the rule supabase/parts/140 and src/lib/nudge.ts
-- already hold and which was earned: `messages.sender` once came from the
-- caller's own request, so a client could post into their own thread as their
-- coach. A message composed under somebody's name without them reading it is
-- the same defect with better manners.
--
-- That is why this table has no `auto_send_on`, no `trigger_event` and no
-- audience. It is six paragraphs somebody wrote down.
--
-- ── Why the body is bounded and the placeholders are not validated here ──
--
-- 2000 characters, because a message longer than that is a document rather
-- than a message and nobody reads it in a chat bubble — and because an
-- unbounded text column is one paste accident away from a row nothing can
-- render. The CHECK mirrors MAX_TEMPLATE_BODY in src/lib/messageTemplates.ts,
-- so a body this database refuses is one the app refused first.
--
-- The `{name}` / `{coach}` placeholders are deliberately NOT enforced here. A
-- template with no placeholder in it is perfectly good ("Session times move
-- next week"), and a near-miss like `{Name}` is a thing to warn a person about
-- while they are typing rather than to reject at the database, where the only
-- available answer is an error message they will read as a fault.
--
-- Every new table gets RLS and explicit policies. Idempotent; safe to re-run.
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.coach_message_templates (
  id         uuid primary key default gen_random_uuid(),
  -- The coach who wrote it. `profiles` and not `auth.users`, matching every
  -- other coach-owned table here, so a deleted account takes its templates
  -- with it rather than leaving orphan rows nobody can read or remove.
  coach_id   uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text not null,
  -- Ordering in the picker. An integer the app spaces by 100 so a coach can put
  -- one of their own between two others without renumbering the set.
  position   integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coach_message_templates
  drop constraint if exists coach_message_templates_title_chk;
alter table public.coach_message_templates
  add constraint coach_message_templates_title_chk
  check (btrim(title) <> '' and length(title) <= 60);

alter table public.coach_message_templates
  drop constraint if exists coach_message_templates_body_chk;
alter table public.coach_message_templates
  add constraint coach_message_templates_body_chk
  check (btrim(body) <> '' and length(body) <= 2000);

-- Blank-is-null does not apply here: both columns are NOT NULL and the checks
-- above refuse whitespace outright. A template with a blank name is a row the
-- picker draws as an empty tappable line, which is worse than a refused save.

create index if not exists coach_message_templates_by_coach
  on public.coach_message_templates (coach_id, position, title);

alter table public.coach_message_templates enable row level security;

-- One policy, FOR ALL, and no second reader. A template is the coach's own
-- private working note: no client may read one, no gym owner may read one, and
-- there is no screen anywhere that shows another person's. Postgres uses a FOR
-- ALL policy's USING expression as the insert check when no WITH CHECK is
-- given, and the WITH CHECK is written out anyway rather than relied on — a
-- policy whose write rule is implicit is a policy the next person edits in half.
drop policy if exists cmt_self on public.coach_message_templates;
create policy cmt_self on public.coach_message_templates for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- `updated_at` by trigger rather than by the app. The app can forget; a coach
-- reading "edited 3 months ago" against a template they rewrote this morning
-- would have no way to know which of the two was wrong.
create or replace function public.coach_message_templates_touch()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  -- The owner is never taken from the payload on an update. Without this a
  -- coach could move their own template onto another account by passing a
  -- different coach_id — the WITH CHECK above would refuse it, but refusing at
  -- the policy produces an error where pinning it produces the correct row.
  new.coach_id := old.coach_id;
  return new;
end
$function$;

drop trigger if exists coach_message_templates_touch on public.coach_message_templates;
create trigger coach_message_templates_touch
  before update on public.coach_message_templates
  for each row execute function public.coach_message_templates_touch();

comment on table public.coach_message_templates is
  'The messages a coach types every week, saved. Read into their composer and never sent by anything: there is deliberately no trigger, no schedule and no audience column on this table — a message composed under somebody''s name without them reading it is what supabase/parts/140 exists to prevent.';
comment on column public.coach_message_templates.body is
  'The message, with the {name} and {coach} placeholders the app fills in. Bounded at 2000 characters, mirroring MAX_TEMPLATE_BODY in src/lib/messageTemplates.ts. The placeholders are deliberately not validated here — a template with none is perfectly good, and a near-miss is worth a warning while somebody types rather than a database error.';
comment on column public.coach_message_templates.position is
  'Picker order. Spaced by 100 by the app so a new template can go between two existing ones without renumbering.';
