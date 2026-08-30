-- ─────────────────────────────────────────────────────────────────────────
-- Who may write a training programme, a nutrition plan, or coach feedback.
--
-- Three tables carry content a coach produces FOR one named client:
-- `assigned_programs`, `coach_nutrition` and `coach_feedback`. All three were
-- policed the same way in 02-domain-schema.sql:
--
--     using      (coach_id = auth.uid() or client_id = auth.uid())
--     with check (coach_id = auth.uid())
--
-- ── The hole ───────────────────────────────────────────────────────────────
--
-- The WITH CHECK constrains `coach_id` and says NOTHING about `client_id`. So
-- any signed-in account could insert a row naming ANY client, provided it put
-- its own id in `coach_id`. The receiving client's app reads these by
-- `client_id = auth.uid()` and renders them as their plan — so a stranger could
-- put a training programme in somebody's Train tab, and a `carb_delta` in
-- `coach_nutrition` shifts the calorie and macro targets the client eats to.
-- No coaching link was required at any point.
--
-- Nothing in the app does this: every writer is a coach screen acting on a
-- client from their own roster. The policy simply never required it.
--
-- ── The residue ────────────────────────────────────────────────────────────
--
-- The second problem is at the other end. `end_coaching()` (part 68) clears
-- `clients.trainer_id`, which is what `is_my_client()` reads, and that is how
-- ending a relationship revokes a coach's access to workouts, measurements,
-- check-ins, habit logs, goals and the checklist. These three tables were not
-- gated on it, so a FORMER coach kept read and write and could still assign a
-- programme to somebody who had left them.
--
-- ── The shape now ──────────────────────────────────────────────────────────
--
-- Split in two, because the two parties are not doing the same thing.
--
-- The coach writes, and only their own rows, and only for a client who is
-- theirs RIGHT NOW. `is_my_client()` in the WITH CHECK closes the hole; the
-- same call in the USING clause ends the access when the relationship does,
-- with no extra bookkeeping and nothing for `end_coaching()` to remember.
--
-- The client READS, always, and cannot write. Their access is deliberately NOT
-- conditioned on the relationship: a plan somebody is following does not stop
-- being theirs because they changed coach, and a client who leaves keeps the
-- programme they were given. Dropping the write is a real narrowing — the old
-- policy let a client DELETE feedback written about them, which is a coach's
-- record of the working relationship and not the client's to remove.
--
-- ── What this does NOT do ──────────────────────────────────────────────────
--
-- It does not delete or rewrite a single row. Existing content stays exactly
-- where it is; what changes is who may reach it from here on. A coach who has
-- lost access to rows they wrote has not lost the rows.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['assigned_programs', 'coach_nutrition', 'coach_feedback']
  loop
    -- The single ALL policy these had. Replaced by the pair below; dropped by
    -- name so re-running this file is a no-op rather than a duplicate.
    execute format('drop policy if exists %s on public.%I;',
                   case t when 'assigned_programs' then 'prog_rw'
                          when 'coach_nutrition'   then 'nutri_rw'
                          else 'feedback_rw' end, t);

    execute format($f$
      drop policy if exists %1$s_coach_rw on public.%1$I;
      create policy %1$s_coach_rw on public.%1$I for all
        using      (coach_id = (select auth.uid()) and public.is_my_client(client_id))
        with check (coach_id = (select auth.uid()) and public.is_my_client(client_id));
    $f$, t);

    execute format($f$
      drop policy if exists %1$s_client_read on public.%1$I;
      create policy %1$s_client_read on public.%1$I for select
        using (client_id = (select auth.uid()));
    $f$, t);
  end loop;
end $$;
