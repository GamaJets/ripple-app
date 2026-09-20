-- A COACH CAN TAKE BACK A SET THEY LOGGED, AND ONLY ONE THEY LOGGED
--
-- A coach logging a client's session on the gym floor taps a tick per set. The
-- tester's words: "Can't untick a log if accidentally press". Before the
-- session is saved that is local state, and the screen already lets them tap
-- again. After it is saved there was nothing: `workouts` carried
-- `workouts_coach_insert` and no UPDATE or DELETE for a coach at all, so a
-- mistyped 80 kg stood in the member's record for good and the only way back
-- was to ask the member to query it.
--
-- Two policies, both narrowed the same way:
--
--   `logged_by = auth.uid()`  — the coach may amend the row THEY wrote and
--   nothing else. A row the member logged themselves is theirs; a coach
--   quietly rewriting it is the one thing this table must never allow, and
--   `workouts_own` already gives the member full control of their own rows.
--
--   `is_my_client(user_id)`  — and only while the coaching relationship
--   stands. When it ends the coach loses the row, as they lose the rest.
--
-- USING and WITH CHECK are the same expression on the update, so a coach
-- cannot move a row onto another member or re-attribute it to somebody else on
-- the way past: the row must satisfy the test before the write and after it.
--
-- What this does NOT do is hide the change. `amended_at` is the member's
-- record that a figure moved after it was filed; `entryEdit.ts` stamps it and
-- src/lib/coachLogReview.ts draws it, so the member still sees that the
-- session was touched and can still query it. A delete is for the row that
-- should never have existed — the exercise nobody did — and the member's
-- feed says a coach-logged session changed.
drop policy if exists workouts_coach_amend on public.workouts;
create policy workouts_coach_amend on public.workouts
  for update
  to authenticated
  using      (logged_by = (select auth.uid()) and is_my_client(user_id))
  with check (logged_by = (select auth.uid()) and is_my_client(user_id));

drop policy if exists workouts_coach_withdraw on public.workouts;
create policy workouts_coach_withdraw on public.workouts
  for delete
  to authenticated
  using (logged_by = (select auth.uid()) and is_my_client(user_id));
