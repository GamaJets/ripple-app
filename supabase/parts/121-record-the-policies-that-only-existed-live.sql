-- ── Two policies that existed in the database and in no file ───────────────
--
-- An adversarial review read `supabase/setup.sql`, found that
-- `client_purchases` carried exactly one policy — `purch_read`, SELECT only —
-- and reported a critical money bug: `redeemSession` and `refundSession` in
-- src/lib/connect.ts would match zero rows, return `error: null`, and report
-- success, so a client could book against a ten-session pack forever while the
-- app told them their credits were going down.
--
-- A different agent, the same night, had tested redemption against the LIVE
-- database and watched a pack go 3 → 4 → 3 symmetrically.
--
-- Both were right. `cp_self` (FOR ALL, `client_id = auth.uid()`, with a
-- matching WITH CHECK) and `cp_trainer_read` (SELECT, `trainer_id =
-- auth.uid()`) exist in the live database and appear in NO part file. So the
-- running system is correct and the source of truth for rebuilding it is not:
-- a fresh deploy from these files produces a project where session packs
-- silently never decrement, which is precisely the bug that was reported.
--
-- That is worse than a missing policy, because everything looks healthy. The
-- app works, the tests pass, `check:schema` passes — it compares COLUMNS, not
-- policies, so drift of exactly this shape is invisible to the one guard that
-- exists.
--
-- Recorded here so the file and the database agree. Written as
-- drop-and-create so this is idempotent against the live project, where these
-- already exist.
drop policy if exists cp_self on public.client_purchases;
create policy cp_self on public.client_purchases
  for all
  using (client_id = (select auth.uid()))
  with check (client_id = (select auth.uid()));

drop policy if exists cp_trainer_read on public.client_purchases;
create policy cp_trainer_read on public.client_purchases
  for select using (trainer_id = (select auth.uid()));

-- A coach must never be able to spend or refund a client's credits by writing
-- the row directly: `cp_trainer_read` is SELECT deliberately, and there is no
-- coach-side write policy. Redemption is the client's own action, and a refund
-- follows their cancellation.
