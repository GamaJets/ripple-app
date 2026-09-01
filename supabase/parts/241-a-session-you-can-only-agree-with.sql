-- ═════════════════════════════════════════════════════════════════════════
-- A delivered session could only be approved, never disputed.
--
-- ── What was here ────────────────────────────────────────────────────────
--
-- app/(client)/pt-sessions.tsx offers one control: Approve Session. There is no
-- decline, no query, no "this didn't happen". Part 22 built the table with one
-- verb in its name and one timestamp in its shape, and the coach's pay hangs on
-- that timestamp being set.
--
-- The consequence is not that a member cannot complain. It is that SILENCE is
-- the only way they can, and silence is unreadable: a client who was never
-- there and a client who has not opened the app produce byte-identical
-- records. The coach cannot tell a dispute from a forgetful client, and the
-- member cannot say the thing they actually want to say. Both of them then
-- have the argument by text message, where nothing about it is recorded.
--
-- ── The load-bearing decision: A DISPUTE IS NOT A CANCELLATION ───────────
--
-- The obvious implementation is to write `sessions.outcome` — and it is wrong,
-- because that column is what payroll reads. `isPayable` in
-- src/lib/gymSessions.ts pays 'completed' and pays 'no_show' and
-- 'late_cancelled' under the gym's stated policy; a NULL outcome is reported
-- as unmarked and paid for by nothing. So a dispute that wrote an outcome
-- would be one party unilaterally deciding what the other party is paid, from
-- a phone, with no review, and the gym's payroll run would silently come out
-- short with nothing on any screen saying why.
--
-- So the dispute is ITS OWN STATE, on the row that already holds the client's
-- answer, and it touches nothing else:
--
--   IT DOES     record that this member says the session did not happen as
--               claimed, what kind of objection it is, when they said it, and
--               in their own words if they wrote any.
--   IT DOES NOT set or clear `sessions.outcome`. The gym's record of what
--               happened stays the gym's to write.
--   IT DOES NOT change what any payroll run pays. A disputed session that is
--               marked 'completed' is still payable, and stays payable until
--               somebody with the authority to change the outcome changes it.
--   IT DOES NOT refund a pack credit. The credit came off when the session was
--               BOOKED (calendar.tsx and part 126's promotion path), and
--               handing it back on a client's say-so is a refund this product
--               does not have and must not grow sideways out of a complaint.
--   IT DOES NOT cancel anything, and it is not late-cancellation. The session
--               has already happened; part 126 is about ones that have not.
--
-- What it is FOR is the record. Two people disagree about an hour of work, and
-- until now the product had nowhere to put that fact. Now it has one place,
-- both of them can read it, and the money it moves is none.
--
-- ── Why it lives on `session_approvals` ─────────────────────────────────
--
-- One row per session, primary-keyed on the session, holding THE CLIENT'S
-- ANSWER. Approving and disputing are two values of one answer and not two
-- facts that could both be true, so a second table would need a rule about
-- what to do when both existed and would eventually be asked it. The table
-- keeps its name — renaming it would break part 22's policy, both apps and the
-- Studio for a word — and its comment now says what it actually holds.
-- ═════════════════════════════════════════════════════════════════════════


-- ── 1. The answer, and its two values ─────────────────────────────────────
alter table public.session_approvals
  add column if not exists state         text not null default 'approved',
  add column if not exists disputed_at   timestamptz,
  add column if not exists dispute_kind  text;

alter table public.session_approvals drop constraint if exists session_approvals_state_chk;
alter table public.session_approvals add constraint session_approvals_state_chk
  check (state in ('approved', 'disputed'));

-- `approved_at` was `not null default now()`, which is right for the only row
-- shape that existed. It cannot stay that way: a disputed session was not
-- approved at any time, and stamping one anyway would put a confirmation
-- timestamp on the coach's calendar for a session the client says never
-- happened — which is the exact false claim this part exists to make sayable.
alter table public.session_approvals alter column approved_at drop not null;

-- Exactly one timestamp, matching the state. Structural rather than left to
-- the two functions below, because a row that says 'disputed' with an approval
-- time on it is readable by three different apps and each would make its own
-- guess about which half to believe.
alter table public.session_approvals drop constraint if exists session_approvals_approved_at_chk;
alter table public.session_approvals add constraint session_approvals_approved_at_chk
  check ((state = 'approved') = (approved_at is not null));

alter table public.session_approvals drop constraint if exists session_approvals_disputed_at_chk;
alter table public.session_approvals add constraint session_approvals_disputed_at_chk
  check ((state = 'disputed') = (disputed_at is not null));

-- What the objection is. Four values because they are four different
-- conversations for the coach to have, and none of them is a legal
-- characterisation the member is being asked to make.
--
-- Null exactly when the row is an approval.
alter table public.session_approvals drop constraint if exists session_approvals_dispute_kind_chk;
alter table public.session_approvals add constraint session_approvals_dispute_kind_chk
  check (
    (state = 'approved' and dispute_kind is null)
    or (state = 'disputed' and dispute_kind in ('did_not_happen', 'wrong_time', 'wrong_length', 'other'))
  );

comment on table public.session_approvals is
  'THE CLIENT''S ANSWER about one delivered session: approved, or disputed. One '
  'row per session. A dispute records that they object and what to; it does not '
  'touch sessions.outcome and changes nothing about what any payroll run pays. '
  'See supabase/parts/22 and 241.';
comment on column public.session_approvals.state is
  'approved | disputed. The client''s own verdict, and nothing else''s.';
comment on column public.session_approvals.note is
  'What the client wrote — the comment on an approval, or the account behind a dispute.';
comment on column public.session_approvals.dispute_kind is
  'did_not_happen | wrong_time | wrong_length | other. Null exactly when state = approved.';


-- ── 2. Approving, which must now also be able to UNDO a dispute ───────────
--
-- Redefined here rather than edited in part 22, and this is a SUPERSEDE, said
-- out loud because part 83 is the record of what happens when one is not. A
-- function is not a policy: `create or replace` with the same signature leaves
-- exactly one definition standing, so there is no older copy to drop and no
-- second version to be OR'd with this one. Part 22 remains the account of why
-- the table and the RPC exist; this is the newest definition of the function,
-- and the only behaviour that changes is the three columns it now clears.
--
-- Clearing them is the whole reason it had to be touched at all. Without it a
-- member who disputed and then remembered — the session did happen, it was the
-- Tuesday not the Thursday — could approve, and the upsert would leave
-- `state = 'disputed'` standing beside a fresh approval timestamp, which the
-- constraints above would refuse outright. A dispute has to be withdrawable by
-- the person who made it, and approving IS the withdrawal.
create or replace function public.approve_session(p_session uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (
    select 1 from sessions s
     where s.id = p_session
       and s.client_id = auth.uid()
       and s.status = 'booked'
       and s.starts_at <= now()
  ) then
    -- Covers all three refusals: not yours, not booked, or not yet delivered.
    raise exception 'That session cannot be approved.';
  end if;

  insert into session_approvals (session_id, client_id, note, state, approved_at, disputed_at, dispute_kind)
  values (p_session, auth.uid(), v_note, 'approved', now(), null, null)
  on conflict (session_id) do update
     set note         = excluded.note,
         state        = 'approved',
         approved_at  = now(),
         disputed_at  = null,
         dispute_kind = null;
end
$function$;

revoke all on function public.approve_session(uuid, text) from public, anon;
grant execute on function public.approve_session(uuid, text) to authenticated;


-- ── 3. Disputing ─────────────────────────────────────────────────────────
--
-- The same gate as approving, and deliberately the same one: yours, booked,
-- and already started. A member cannot dispute a session that has not happened
-- yet — that is a cancellation, it has a different screen and different money
-- (part 126) — and cannot dispute somebody else's.
--
-- Writes to `session_approvals` and to NOTHING ELSE. There is no update of
-- `sessions` anywhere in this function, and there must never be one: the
-- header says why at length.
create or replace function public.dispute_session(
  p_session uuid,
  p_kind    text,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_kind not in ('did_not_happen', 'wrong_time', 'wrong_length', 'other') then
    raise exception 'Unknown kind of dispute.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from sessions s
     where s.id = p_session
       and s.client_id = auth.uid()
       and s.status = 'booked'
       and s.starts_at <= now()
  ) then
    raise exception 'That session cannot be disputed.' using errcode = '42501';
  end if;

  insert into session_approvals (session_id, client_id, note, state, approved_at, disputed_at, dispute_kind)
  values (p_session, auth.uid(), v_note, 'disputed', null, now(), p_kind)
  on conflict (session_id) do update
     set note         = excluded.note,
         state        = 'disputed',
         approved_at  = null,
         disputed_at  = now(),
         dispute_kind = excluded.dispute_kind;
end
$function$;

revoke all on function public.dispute_session(uuid, text, text) from public, anon;
grant execute on function public.dispute_session(uuid, text, text) to authenticated;

comment on function public.dispute_session(uuid, text, text) is
  'The client says a delivered session did not happen as claimed. Writes only to '
  'session_approvals: it does not touch sessions.outcome and changes nothing '
  'about payroll. Approving the same session withdraws it. See supabase/parts/241.';


-- ── 4. Who reads it ──────────────────────────────────────────────────────
--
-- Nobody new. `session_approvals_read` (part 22) already covers the client who
-- wrote the row and the trainer who delivered the session, which is exactly the
-- pair a dispute is between — and the columns added above ride on that policy
-- rather than needing one of their own. Restated here only so a reader of this
-- part does not have to go and check that a new column did not arrive
-- unprotected.
--
-- There is deliberately no owner or tenant branch. A gym owner who needs to
-- settle a disagreement between their trainer and a member is doing so with
-- both of them, not by reading one side's private note.
