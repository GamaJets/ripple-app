-- ═══════════════════════════════════════════════════════════════════════════
-- The row only its subject could destroy, and the catalogue nobody could correct
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two tables where the WRITE rules were written as if `for all` meant "for all
-- the commands I was thinking about". Both verified against the LIVE database
-- with pg_policies and pg_get_functiondef before this file was written.
--
-- Neither has done damage yet, and that is the argument for closing them now:
-- `trainer_billing` holds 0 rows and `exercises` holds 4 coach-written ones out
-- of 608. Both counts are live at the time of writing.
--
-- ── 1 · a `for all` policy whose USING is looser than its WITH CHECK ───────
--
-- Live, from pg_policies:
--
--     billing_owner  ALL  to public
--       USING       is_owner_of(tenant_id) or trainer_id = (select auth.uid())
--       WITH CHECK  is_owner_of(tenant_id)
--
-- That reads like "the coach may see their own billing row; only the gym owner
-- may change it", and for INSERT and UPDATE it is exactly that — WITH CHECK
-- governs the new row and refuses the coach.
--
-- DELETE has no new row. Postgres gates it on USING ALONE. So the second arm of
-- the USING clause, written to grant a READ, silently granted a DELETE: a coach
-- can erase the gym's record of what that coach costs it.
--
-- The sharpest case is the one the schema allows on purpose. `tenant_id` is
-- NULLABLE (information_schema, checked), and `is_owner_of` is
--
--     p.id = auth.uid() and p.role = 'owner' and p.tenant_id = t
--
-- so `is_owner_of(null)` is `null = null` → false, for every owner alive. A
-- billing row with no tenant is therefore a row NO OWNER can read, update or
-- delete — and that its own trainer can delete, because the trainer arm does
-- not consult the tenant at all. The one account with a reason to want it gone
-- is the only account able to remove it.
--
-- Also tightened in passing: the policy applied `to public`, which in a
-- Supabase project includes anon. No leak followed — anon's `auth.uid()` is
-- null, so the trainer arm is null and the owner arm is false — but a table
-- holding what a gym pays should not be evaluating its predicate for the
-- signed-out role at all. The other policies on this table's neighbours are
-- `to authenticated`; this one was the odd one out.
--
-- ── what is NOT changed here, and why ─────────────────────────────────────
--
-- `mrr` is a bare `numeric` on a table with no currency column, which the
-- currency doctrine would ordinarily refuse. It is left alone: the table has no
-- reader in any of the three apps, in studio-web, or in any edge function
-- (grepped, not assumed), so there is nothing to display it wrongly yet. A
-- currency column belongs in the part that gives this table its first reader,
-- where the right answer is visible. Naming it here rather than fixing it is
-- the honest option — this part is about who may delete, not about money.
--
-- ── 2 · a catalogue that could be added to and never corrected ─────────────
--
-- `exercises` is the shared movement catalogue. Live policies, complete:
--
--     exercises_read    SELECT  to authenticated  using (true)
--     exercises_staff_w INSERT  to authenticated  with check (my_role() in ('trainer','owner'))
--
-- There is no UPDATE policy and no DELETE policy, and RLS is enabled, so those
-- commands are refused for everybody. Part 49's own header says so plainly —
-- "Nothing here can be deleted through the API" — and treats it as the safe
-- choice. It is safe against a malicious delete and unsafe against an honest
-- mistake, because of what else is true about this table:
--
--   · The id is `exerciseSlug(name)` (src/ui/customExercise.ts:50), so the row
--     is keyed on the coach's typing. A typo, a plural, a vendor's spelling —
--     each becomes a permanent, globally-readable id.
--   · Every gym reads all of it: `using (true)` to authenticated.
--   · Any trainer or owner in ANY tenant writes it: `my_role()` has no tenant
--     test, by design, because a catalogue is only useful if everyone resolves
--     the same slug to the same movement.
--
-- So one coach's typo is every gym's catalogue, forever, and the only remedy
-- available today is a hand-written statement run against production by
-- somebody with the service key.
--
-- The fix is the smallest one that restores recoverability without touching who
-- may add: UPDATE and DELETE for platform admins only. `is_platform_admin()`
-- already exists (part 252) and is already the gate on Repple's own numbers and
-- crash reports (parts 1904, 252), so this introduces no new notion of
-- privilege — it hands the existing one the ability to fix a row.
--
-- ── the product question this deliberately does not answer ─────────────────
--
-- Whether a coach's custom movement should be in this shared table at all, or
-- in the tenant-scoped `coach_exercises` (5 rows live, policy
-- `coach_exercises_self`), is a product decision and not a defect. It stays
-- open. What this part settles is the part that is a defect either way: if a
-- wrong row can be created, somebody has to be able to correct it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · trainer_billing: one policy per command, so DELETE has its own rule ─
drop policy if exists billing_owner on public.trainer_billing;

-- The coach may READ what the gym records about them. This arm is the whole
-- reason the old USING was written the way it was; it keeps it, and now it
-- cannot reach a command it was never meant to reach.
drop policy if exists billing_read on public.trainer_billing;
create policy billing_read on public.trainer_billing for select
  to authenticated
  using (is_owner_of(tenant_id) or trainer_id = (select auth.uid()));

drop policy if exists billing_owner_ins on public.trainer_billing;
create policy billing_owner_ins on public.trainer_billing for insert
  to authenticated
  with check (is_owner_of(tenant_id));

-- USING is narrowed to the owner as well as WITH CHECK. The old pair already
-- refused a coach's UPDATE at the WITH CHECK; this only moves the refusal one
-- step earlier, so no caller loses anything it could previously do.
drop policy if exists billing_owner_upd on public.trainer_billing;
create policy billing_owner_upd on public.trainer_billing for update
  to authenticated
  using (is_owner_of(tenant_id))
  with check (is_owner_of(tenant_id));

-- The one this part exists for.
drop policy if exists billing_owner_del on public.trainer_billing;
create policy billing_owner_del on public.trainer_billing for delete
  to authenticated
  using (is_owner_of(tenant_id));

-- ── 2 · exercises: a wrong row can now be corrected ────────────────────────
-- INSERT is untouched: any trainer or owner still adds to the catalogue, which
-- is what makes it a catalogue. Only the correcting hand is new.
drop policy if exists exercises_admin_u on public.exercises;
create policy exercises_admin_u on public.exercises for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists exercises_admin_d on public.exercises;
create policy exercises_admin_d on public.exercises for delete
  to authenticated
  using (public.is_platform_admin());
