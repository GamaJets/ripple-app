-- ═══════════════════════════════════════════════════════════════════════════
-- A client could rewrite or delete the record of what they paid
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written to be applied by hand. Every fact below was read out of
-- the LIVE database on 6 Sep 2026 with pg_policy, pg_class, pg_constraint,
-- pg_trigger, pg_proc and information_schema.role_table_grants — not out of the
-- parts, which are a build log rather than the truth.
-- APPLIED. Proved live in the same aborted transaction: an INSERT into
-- public.client_purchases as `authenticated` now answers 'permission denied for
-- table client_purchases'. Verified first that every writer is an edge function
-- on the SERVICE ROLE (stripe-webhook, connect-checkout, connect-refund), which
-- a revoke from authenticated does not touch.
--
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- A coach opens Payments and a pack they sold on Tuesday for AED 4,800 is
-- gone: not refunded, not withdrawn, gone. Their month is short by it, their
-- Statement of Record is short by it, and the client's value on the Money
-- screen is short by it. Nothing on any screen says a sale was removed,
-- because there is no such thing as a removed sale in this product — every
-- takings figure is a sum over `client_purchases` rows and the row is simply
-- not there any more.
--
-- Or the sale is still there and says it was fully refunded. `refundBlocker`
-- in src/lib/refunds.ts then refuses the coach's real refund with "The whole
-- of this one has already been given back", the sale renders as refunded on
-- the coach's own screen, and Stripe has no refund on it at all. That is this
-- lane's worst shape — a refund reported as done that never happened — and it
-- can be written by the person who benefits from it.
--
-- Or the ten-session pack the client bought once never runs out, because
-- `sessions_used` goes back to 0 whenever they like. The coach delivers
-- session eleven, twelve and thirty and is paid for ten.
--
-- Or a pack appears that was never bought. A signed-in account can INSERT a
-- `client_purchases` row naming ANY coach, `status = 'paid'`,
-- `sessions_total = 100`, `amount_cents = 0` — and `client_purchases_notify_
-- trainer` fires, so the coach is notified of a sale that did not happen,
-- `redeem_pack_session` will draw sessions off it, and the coach's Delivery
-- and Revenue screens count it.
--
-- All four need nothing but the publishable key that ships in every build and
-- an ordinary client session.
--
-- ── The policy chain, exactly as it stands live ───────────────────────────
--
--   public.client_purchases, rls enabled, THREE permissive policies:
--
--     cp_self          FOR ALL     USING      (client_id = auth.uid())
--                                  WITH CHECK (client_id = auth.uid())
--     cp_trainer_read  FOR SELECT  USING      (trainer_id = auth.uid())
--     purch_read       FOR SELECT  USING      (client_id = auth.uid()
--                                              OR trainer_id = auth.uid()
--                                              OR is_owner_of(staff_tenant_of(trainer_id)))
--
--   grants: authenticated and anon both hold SELECT, INSERT, UPDATE, DELETE.
--
-- `anon` cannot reach any of it — `auth.uid()` is null and `client_id = null`
-- is null, not true — so this is an ordinary signed-in client, which is
-- everybody who has ever bought anything.
--
-- The table's CHECK constraints bound the damage and do not stop it:
-- `client_purchases_sessions_used_ck` permits `sessions_used = 0` on any pack,
-- and `client_purchases_refund_within_charge` permits
-- `refunded_cents = amount_cents` with `refunded_at = now()`. Both of those
-- are the exploit, not a barrier to it. DELETE is bounded by nothing.
--
--     -- as any signed-in client, against /rest/v1:
--     patch  client_purchases?id=eq.<mine>  {"sessions_used": 0}
--     patch  client_purchases?id=eq.<mine>  {"refunded_cents": 480000,
--                                            "refunded_at": "2026-09-06T00:00:00Z"}
--     delete client_purchases?id=eq.<mine>
--     post   client_purchases {"client_id":"<me>","trainer_id":"<any coach>",
--                              "status":"paid","sessions_total":100}
--
-- ── Why the write half of cp_self exists, and why it no longer does ───────
--
-- supabase/parts/121 recorded `cp_self` as it already stood in the live
-- database, and its note is explicit about the job it was doing: `redeemSession`
-- and `refundSession` in src/lib/connect.ts wrote `sessions_used` DIRECTLY, as
-- the client, so the client needed UPDATE on their own row. Part 121 was right
-- at the time.
--
-- It has not been true since redemption moved into RPCs. All three credit
-- movements are now SECURITY DEFINER functions, verified live:
--
--   redeem_pack_session(p_trainer)     scopes to client_id = auth.uid()
--   refund_pack_session(p_trainer)     scopes to client_id = auth.uid()
--   adjust_pack_credit(p_purchase, ±1) scopes to trainer_id = auth.uid()
--
-- Each takes `for update`, re-checks authorisation inside the function because
-- SECURITY DEFINER bypasses the row policies, and asserts `row_count = 1`.
-- EXECUTE is held by `authenticated` and NOT by `anon` on all three.
--
-- Every other write to this table is the service role from
-- supabase/functions/stripe-webhook (the upsert at index.ts:1200) and
-- connect-refund, neither of which is subject to RLS. Grepped across src/,
-- app/, studio-web/src/ and supabase/functions/: there is no client-side or
-- coach-side insert, update or delete of `client_purchases` anywhere in this
-- repository. The write half of `cp_self` is a verb nobody meant to offer,
-- standing open at the REST endpoint.
--
-- ── The fix ───────────────────────────────────────────────────────────────
--
-- Both halves, because either alone is a half-fix: a policy without the grant
-- revoke leaves the verb reachable the moment somebody adds a policy, and a
-- revoke without the policy change leaves a FOR ALL policy that reads as
-- intent.
--
--   1. `cp_self` becomes SELECT-only. Nothing is lost: `purch_read` already
--      carries `client_id = auth.uid()`, so the buyer's read of their own
--      purchase survives twice over. It is kept rather than dropped so that a
--      later `drop policy if exists purch_read` cannot silently take a
--      client's own purchase history away from them.
--   2. INSERT, UPDATE and DELETE are revoked from `authenticated` and `anon`.
--      SELECT stays.
--
-- Two dead grants on neighbouring tables go with it, and they are dead in the
-- precise sense that RLS refuses the verb today because no policy permits it —
-- `client_subscriptions` carries only `client_subs_read` (SELECT) and
-- `promo_redemptions` only two SELECT policies, while both tables grant
-- INSERT/UPDATE/DELETE to `authenticated` and `anon`. They are revoked here so
-- that the next `for all` policy written on either table does not turn a
-- read-only table into a writable one without anybody noticing. Redemption
-- writes go through `redeem_promo`, which is SECURITY DEFINER.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · client_purchases: the buyer reads their own row and writes nothing ──

drop policy if exists cp_self on public.client_purchases;
create policy cp_self on public.client_purchases
  for select
  using (client_id = (select auth.uid()));

comment on table public.client_purchases is
  'One-off sales, written ONLY by the service role from the Stripe webhook and connect-refund. No role holds INSERT, UPDATE or DELETE: session credits move through redeem_pack_session, refund_pack_session and adjust_pack_credit, which are SECURITY DEFINER and re-check authorisation themselves. Before part 2580 the buyer held FOR ALL on their own row and could zero sessions_used, stamp a refund Stripe never made, delete the record of a sale, or insert one that never happened.';

revoke insert, update, delete on public.client_purchases from authenticated;
revoke insert, update, delete on public.client_purchases from anon;

-- ── 2 · two dead grants beside it, closed before a policy wakes them ───────

revoke insert, update, delete on public.client_subscriptions from authenticated;
revoke insert, update, delete on public.client_subscriptions from anon;

revoke insert, update, delete on public.promo_redemptions from authenticated;
revoke insert, update, delete on public.promo_redemptions from anon;

-- ── verify, after applying ────────────────────────────────────────────────
--
-- Expect cp_self to be 'r' (SELECT) and no policy on client_purchases to be
-- '*' (ALL):
--
--   select polname, polcmd, polpermissive
--     from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname = 'client_purchases';
--
-- Expect exactly SELECT for both roles on all three tables:
--
--   select table_name, grantee, string_agg(distinct privilege_type, ',')
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon', 'authenticated')
--      and table_name in ('client_purchases', 'client_subscriptions', 'promo_redemptions')
--    group by 1, 2 order by 1, 2;
--
-- Then draw and return a credit as a real client, which must still work — it
-- goes through the RPCs and never touches the table grants:
--
--   select * from redeem_pack_session('<a coach uuid>');
--   select * from refund_pack_session('<the same coach uuid>');
