-- ═════════════════════════════════════════════════════════════════════════
-- A conversation that carries photographs and video, with no way to stop it
-- and nobody to tell.
--
-- ── What was here ────────────────────────────────────────────────────────
--
-- Since part 124 the coach↔client thread accepts one photo or one 30-second
-- video in either direction. A repo-wide grep for `blockUser`, `report_user`
-- or "report abuse" returns nothing, and there is no table here that could
-- hold either. So the member's entire moderation path was: read it, or stop
-- opening the app.
--
-- That is user-generated content from a named adult to a named adult, one of
-- whom is paying the other, inside a private thread nobody else can see. It is
-- also, separately, an App Review refusal — 1.2 requires a way to report
-- objectionable content and a way to block the person sending it.
--
-- ── The two things this part must get right ──────────────────────────────
--
-- A BLOCK MUST STOP DELIVERY, NOT HIDE IT. A block implemented as a client-side
-- filter is worse than none: the sender keeps sending, the server keeps
-- accepting, the files keep landing in the bucket, and the only person who has
-- been protected from the messages is the one who does not read them. So the
-- block is a row the database checks in the WITH CHECK of both message
-- policies and in the storage INSERT policy — the message is REFUSED, and the
-- file has nowhere to go.
--
-- A REPORT MUST SURVIVE THE PERSON IT IS ABOUT. `msg_coach` is `for all using
-- (is_my_client(client_id))`, which means a coach can DELETE any message in
-- their client's thread, and `msgmedia_obj_delete` lets the uploader remove
-- their own object. Both are pre-existing and neither is changed here. The
-- consequence for a report is decisive: a report that merely POINTS at a
-- message id is a report the reported person can empty. So `report_abuse`
-- COPIES the message — sender, body, attachment key, kind and time — into the
-- report row at the moment it is made. Deleting the message afterwards leaves
-- the evidence standing.
--
-- ── What a block deliberately does NOT do ────────────────────────────────
--
-- It does not delete anything. The thread stays readable to both of them, and
-- it must: the report is made out of what was said, and a block that erased
-- the history would destroy the evidence in the act of asking for help.
--
-- It does not end the coaching relationship, cancel a session, refund anything
-- or touch money. Those are separate decisions with separate consequences, and
-- a member who blocks somebody at eleven at night has not thereby cancelled
-- Tuesday. `end_coaching` (part 68) is still how the relationship ends.
--
-- It is not secret, and this file will not pretend otherwise. A thread has
-- exactly two people on it, so "a block exists and it is not mine" identifies
-- the blocker with certainty; a SELECT policy that hid the row would buy no
-- secrecy and would cost the blocked party any honest account of why their
-- message did not send. This codebase's oldest rule is that a message the
-- server refused must never look delivered (the header of src/ui/messaging.ts
-- is the long version), and that rule wins here. The blocked party is told the
-- conversation is closed. They are not told who to be angry with, because
-- there is only one other person and they already know.
--
-- ── Reporting does not depend on the other party ─────────────────────────
--
-- No approval, no acknowledgement, no notification to the reported person, and
-- no state on the reported person's side at all. `report_abuse` is SECURITY
-- DEFINER and writes one row; a member can block and report the same person in
-- either order, or do one without the other. Nothing about either path can be
-- interfered with by the person being reported.
-- ═════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════
-- 1 · The block
-- ═════════════════════════════════════════════════════════════════════════
--
-- Keyed by (thread, blocker) so both directions are expressible and each side
-- can lift only its own. `thread_id` is `messages.client_id` — the client's id
-- — exactly as every other object in this feature keys itself.
create table if not exists public.thread_blocks (
  thread_id  uuid        not null references public.clients(id) on delete cascade,
  blocker_id uuid        not null references auth.users(id)     on delete cascade,
  created_at timestamptz not null default now(),
  -- Optional and free text. A block needs no justification and this is never
  -- shown to the other party; it is here so the blocker's own screen can
  -- remind them later why they did it.
  reason     text,
  primary key (thread_id, blocker_id)
);

alter table public.thread_blocks enable row level security;

comment on table public.thread_blocks is
  'One row = this person has blocked the other on this message thread. Checked '
  'by the WITH CHECK of msg_client/msg_coach and by msgmedia_obj_insert, so a '
  'block refuses the write rather than hiding it. See supabase/parts/240.';

-- Both participants may read it, for the reason in the header: there is no
-- secrecy to buy in a two-party thread, and the blocked side needs a truthful
-- sentence for a composer that will not send.
drop policy if exists thread_blocks_participant_r on public.thread_blocks;
create policy thread_blocks_participant_r on public.thread_blocks
  for select to authenticated
  using (public.can_use_message_thread(thread_id::text));

-- Block somebody you are actually in a conversation with, as yourself.
-- `can_use_message_thread` is part 124's function and is the union of
-- msg_client and msg_coach — so the set of threads you may block is exactly
-- the set you may write to, asked in one place.
drop policy if exists thread_blocks_own_i on public.thread_blocks;
create policy thread_blocks_own_i on public.thread_blocks
  for insert to authenticated
  with check (
    blocker_id = (select auth.uid())
    and public.can_use_message_thread(thread_id::text)
  );

-- Lift your own block and nobody else's. Deliberately not conditioned on still
-- being on the thread: a client whose coach changed must still be able to undo
-- a block they made, and a row nobody can delete is a permanent one.
drop policy if exists thread_blocks_own_d on public.thread_blocks;
create policy thread_blocks_own_d on public.thread_blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- No UPDATE policy. A block has nothing to amend: lift it and make it again.

grant select, insert, delete on public.thread_blocks to authenticated;

create index if not exists thread_blocks_thread_idx on public.thread_blocks (thread_id);


-- ═════════════════════════════════════════════════════════════════════════
-- 2 · One definition of "this conversation is closed"
-- ═════════════════════════════════════════════════════════════════════════
--
-- Takes TEXT and guards with a CASE, for exactly the reasons part 124 gives
-- for `can_use_message_thread`: the storage policy hands it
-- `storage.foldername(name)[1]`, which is text and may not be a uuid at all,
-- and casting inside a policy would raise 22P02 on an object in another bucket
-- because nothing guarantees the planner evaluates the `bucket_id` arm first.
-- CASE does not evaluate the branch it does not take.
--
-- SECURITY DEFINER so the answer does not depend on the caller's own SELECT on
-- `thread_blocks`, and so a policy calling it cannot re-enter a policy and
-- recurse — the 42P17 fault part 54 had to undo across the whole video library.
--
-- EITHER side's block closes the thread. That is the deliberate shape: a
-- one-directional block would leave the blocker able to keep writing to
-- somebody who cannot answer, which is not protection, it is the last word.
create or replace function public.message_thread_blocked(p_thread text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when p_thread is null then false
    when p_thread !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else exists (select 1 from public.thread_blocks b where b.thread_id = p_thread::uuid)
  end;
$function$;

comment on function public.message_thread_blocked(text) is
  'Has either party blocked this message thread? Takes the thread key as text '
  'so the storage policies can pass a path segment. SECURITY DEFINER so it does '
  'not depend on the caller''s own read of thread_blocks. See supabase/parts/240.';

-- `revoke ... from public` alone leaves BOTH API roles standing — Supabase
-- grants execute to anon and authenticated separately, which is how part 105
-- shipped an unauthenticated cross-tenant write (part 120). anon has no
-- business asking; a policy is evaluated as the querying role, so
-- authenticated needs it.
revoke all on function public.message_thread_blocked(text) from public, anon;
grant execute on function public.message_thread_blocked(text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════
-- 3 · The refusal, in the three places a message can get through
-- ═════════════════════════════════════════════════════════════════════════
--
-- The USING clauses are UNCHANGED and stay wide. Reading the thread is not
-- what a block stops — see the header: the report is made out of the history,
-- and a block that hid it would destroy the evidence.
--
-- Only WITH CHECK changes, so the cost is one function call per INSERTed row
-- and nothing per row read (the concern part 145 exists for).
--
-- Both policies are recreated in full rather than patched, because a policy
-- cannot be altered in place and because part 83 is the record of what happens
-- when a part supersedes another without saying so: only the names you write
-- survive. These two names are msg_client and msg_coach, defined in part 10,
-- and this file is the newest definition of both.
drop policy if exists msg_client on public.messages;
create policy msg_client on public.messages for all
  using (client_id = (select auth.uid()))
  with check (
    client_id = (select auth.uid())
    and sender = 'client'
    and not public.message_thread_blocked(client_id::text)
  );

drop policy if exists msg_coach on public.messages;
create policy msg_coach on public.messages for all
  using (public.is_my_client(client_id))
  with check (
    public.is_my_client(client_id)
    and sender = 'coach'
    and not public.message_thread_blocked(client_id::text)
  );

-- And the file, which is uploaded BEFORE the row exists (the order is the
-- feature — src/ui/messaging.ts). Without this, a blocked sender's photograph
-- would still land in the bucket and only the message would be refused: bytes
-- from a blocked person, in storage, that nothing points at and no purge
-- exists for. The read and delete policies from part 124 are untouched —
-- blocking does not take away a photograph somebody was already sent.
drop policy if exists msgmedia_obj_insert on storage.objects;
create policy msgmedia_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-media'
    and public.can_use_message_thread((storage.foldername(name))[1])
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and not public.message_thread_blocked((storage.foldername(name))[1])
  );


-- ═════════════════════════════════════════════════════════════════════════
-- 4 · The report
-- ═════════════════════════════════════════════════════════════════════════
--
-- ── Why the message is COPIED and not merely referenced ──────────────────
--
-- Explained at length in the header. `msg_coach` permits DELETE on any row in
-- the thread and `msgmedia_obj_delete` permits an uploader to remove their own
-- object, so a report holding only `message_id` is a report the reported
-- person can empty. Every column prefixed `reported_` below is a snapshot
-- taken inside `report_abuse` at the moment the report is made.
--
-- The attachment is snapshotted as its KEY, not its bytes. The object may
-- since have been deleted and the key may resolve to nothing — which is itself
-- a fact worth having, and is why `reported_attachment_path` is stored even
-- though it may not be signable later.
--
-- ── Why the references are `set null` and not `cascade` ──────────────────
--
-- Part 184 settled the shape of this argument for the financial record under
-- GDPR Article 17(3)(b), and the same reasoning reaches a safety record by a
-- different limb: a report is evidence of what one person did to another, and
-- the person it is ABOUT must not be able to erase it by deleting their
-- account. So no reference here cascades. What survives an erasure is the
-- snapshot and the fact that a report was made; the names go with the rows
-- they belonged to.
--
-- This is a retention, so it is stated rather than assumed: the reporter's own
-- identity is dropped to NULL when their account goes, and nothing else about
-- them is held here.
create table if not exists public.abuse_reports (
  id            uuid        primary key default gen_random_uuid(),
  -- Who reported. NULL once that account is erased.
  reporter_id   uuid        references auth.users(id) on delete set null,
  -- Which side of the thread they were on. Kept as its own column because
  -- reporter_id may be gone and "the client reported the coach" is the first
  -- thing anybody reviewing this needs to know.
  reporter_role text        not null,
  -- Who was reported. NULL once that account is erased.
  reported_id   uuid        references auth.users(id) on delete set null,
  thread_id     uuid        references public.clients(id) on delete set null,
  message_id    uuid        references public.messages(id) on delete set null,
  category      text        not null,
  -- What the reporter typed. Optional: a report with no words is still a
  -- report, and requiring an explanation is a barrier in front of the person
  -- least able to write one at that moment.
  note          text,
  -- ── the snapshot ──
  reported_sender          text,
  reported_body            text,
  reported_attachment_path text,
  reported_attachment_kind text,
  reported_sent_at         timestamptz,
  created_at    timestamptz not null default now(),
  -- Set by an operator working with the service key. There is no policy below
  -- that lets anybody in any app write it, and that is deliberate: "reviewed"
  -- is a claim about somebody having actually looked.
  reviewed_at   timestamptz,
  constraint abuse_reports_role_chk check (reporter_role in ('client', 'coach')),
  constraint abuse_reports_category_chk
    check (category in ('harassment', 'sexual', 'threat', 'spam', 'other'))
);

alter table public.abuse_reports enable row level security;

create index if not exists abuse_reports_reported_idx on public.abuse_reports (reported_id, created_at desc);
create index if not exists abuse_reports_reporter_idx on public.abuse_reports (reporter_id, created_at desc);

comment on table public.abuse_reports is
  'One row = somebody reported a message or a conversation. Written only by '
  'report_abuse(); the message is COPIED in so the reported person cannot empty '
  'the report by deleting the message. See supabase/parts/240.';

-- The reporter reads their own reports, so their screen can say "you reported
-- this on the 4th" rather than offering to report it again as though nothing
-- had happened. Nobody else reads anything: not the reported person, not their
-- gym owner, not another trainer at the same tenant. Part 120's lesson stands
-- — `role = 'owner'` is never an authorisation — and a gym owner reading the
-- reports its members make about its trainers is the single worst outcome this
-- table can have.
drop policy if exists abuse_reports_own_r on public.abuse_reports;
create policy abuse_reports_own_r on public.abuse_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

-- No INSERT, UPDATE or DELETE policy anywhere. Every write goes through
-- `report_abuse` below — the same shape part 22 uses for `session_approvals`
-- — so a reporter cannot choose who they are reporting, cannot write the
-- snapshot themselves, and cannot withdraw a report by deleting the row.
grant select on public.abuse_reports to authenticated;

drop policy if exists abuse_reports_owner_r on public.abuse_reports;
drop policy if exists abuse_reports_tenant_r on public.abuse_reports;


-- One report. Either a specific message, or the conversation as a whole when
-- there is no one message to point at — the abuse was the sum of it, or the
-- message has already been deleted.
--
-- Returns the report id, so the caller can say the row exists rather than that
-- the request did not raise. Every refusal below raises rather than returning
-- null, because "we could not record your report" and "your report is filed"
-- must never be the same answer to the person making it.
create or replace function public.report_abuse(
  p_thread   uuid,
  p_category text,
  p_note     text default null,
  p_message  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_role     text;
  v_reported uuid;
  v_id       uuid;
  -- Scalars, not a `record`. An unassigned record raises the moment a field of
  -- it is read, so a conversation-level report — the whole point of p_message
  -- being optional — would have failed at the INSERT rather than filing.
  v_sender   text;
  v_body     text;
  v_att_path text;
  v_att_kind text;
  v_sent_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Who is asking, and therefore who is being reported. Taken from the
  -- database, never from the request: a reporter does not get to name their
  -- subject. The two arms are the two halves of can_use_message_thread, spelled
  -- out because this needs the OTHER party's id and not merely a yes.
  if p_thread = v_uid then
    v_role := 'client';
    select c.trainer_id into v_reported from public.clients c where c.id = p_thread;
  elsif exists (select 1 from public.clients c where c.id = p_thread and c.trainer_id = v_uid) then
    v_role := 'coach';
    v_reported := p_thread;
  else
    raise exception 'That is not your conversation.' using errcode = '42501';
  end if;

  if p_category not in ('harassment', 'sexual', 'threat', 'spam', 'other') then
    raise exception 'Unknown report category.' using errcode = '22023';
  end if;

  -- A message, if one was named, and it must be ON this thread. Without the
  -- second condition a participant could file a report quoting a message id
  -- from a conversation they are not on, and the snapshot would copy its
  -- contents out of that thread and into a row they can then read back.
  if p_message is not null then
    select m.sender, m.body, m.attachment_path, m.attachment_kind, m.created_at
      into v_sender, v_body, v_att_path, v_att_kind, v_sent_at
      from public.messages m
     where m.id = p_message and m.client_id = p_thread;
    if not found then
      raise exception 'That message is not in this conversation.' using errcode = '22023';
    end if;
  end if;

  insert into public.abuse_reports (
    reporter_id, reporter_role, reported_id, thread_id, message_id, category, note,
    reported_sender, reported_body, reported_attachment_path, reported_attachment_kind, reported_sent_at
  ) values (
    v_uid, v_role, v_reported, p_thread, p_message, p_category,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_sender, v_body, v_att_path, v_att_kind, v_sent_at
  )
  returning id into v_id;

  return v_id;
end
$fn$;

revoke all on function public.report_abuse(uuid, text, text, uuid) from public, anon;
grant execute on function public.report_abuse(uuid, text, text, uuid) to authenticated;

comment on function public.report_abuse(uuid, text, text, uuid) is
  'File one abuse report against the other party on a message thread. Snapshots '
  'the reported message so deleting it cannot empty the report. Needs nothing '
  'from the reported person. See supabase/parts/240.';
