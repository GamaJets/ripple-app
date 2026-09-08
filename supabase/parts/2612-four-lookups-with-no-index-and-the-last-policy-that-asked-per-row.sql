-- ═══════════════════════════════════════════════════════════════════════════
-- Four lookups with no index, and the last policy that asked per row
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLIED to the live project on 8 Sep 2026, and the advisors were re-run.
-- The prediction below held exactly: auth_rls_initplan 1 -> 0 (the lint is gone
-- from the report entirely), unindexed_foreign_keys 96 -> 92,
-- multiple_permissive_policies unchanged at 578, and unused_index 73 -> 77,
-- which is the four indexes created here and not a regression — on a database
-- with no real traffic that lint means untested, not unused. The security
-- advisors are unchanged too (7 / 2 / 2 / 152) and name trainer_invites
-- nowhere, which is the check that mattered, because this part rewrites a
-- policy. ti_owner now reads `owner_id = ( SELECT auth.uid() AS uid)` in both
-- clauses, with part 2391's deliberate USING/WITH-CHECK asymmetry reproduced
-- rather than tidied away.
--
-- The original note, kept because it is what was predicted before it was run:
-- After applying it,
-- `get_advisors` with type 'performance' MUST be re-run: the expected change
-- is `auth_rls_initplan` going from 1 to 0 and `unindexed_foreign_keys` going
-- from 96 to 92, with `multiple_permissive_policies` and `unused_index`
-- unchanged. If `unused_index` rises by four, that is not a regression — see
-- the note on that lint below; a new index has never been scanned by
-- definition, and this database has no traffic to scan it with.
--
-- `npm run db:check` reports supabase/setup.sql stale from the moment this
-- file lands and will keep doing so until `node scripts/build-supabase-setup
-- .mjs` is run. That is the ordinary consequence of a 318th part existing,
-- not a fault in this one; it was verified that the tree was clean on that
-- check with this file removed and stale only with it present.
--
-- Every fact below was read out of the LIVE database on 8 Sep 2026 with
-- pg_policies, pg_class, pg_index, pg_indexes, pg_constraint, pg_attribute,
-- pg_proc, pg_stat_user_tables, pg_stat_user_indexes and
-- information_schema.role_table_grants, and out of the working tree at
-- `overnight-wave`. Nothing was written; the audit was read-only.
--
--
-- ── WHY THIS PART IS FOUR INDEXES AND NOT NINETY-SIX ──────────────────────
--
-- The performance advisor reports 96 unindexed foreign keys. Ninety-two of
-- them are left alone deliberately. An index is not free — it is paid for on
-- every insert and every update of the column, forever — and a foreign key
-- that nothing ever filters on is a column nothing will ever look up. The
-- ninety-six were narrowed by asking, of each one, a question the advisor
-- cannot ask: is there a caller?
--
-- Three kinds of caller were looked for.
--
--   1. An RLS policy on the table whose USING clause is an equality on that
--      column. This is the worst kind of miss, because the qual runs on every
--      row of every read of that table by that role, and nothing in the
--      application can route around it.
--
--   2. A `security definer` function whose body filters on it. RLS is off
--      inside a definer, so the function's own WHERE is the whole qual and
--      an index on it is used or not used on its own merits.
--
--   3. An explicit `.eq('<column>', …)` in `src/`, `app/` or `studio-web/`.
--      This one is AND-ed on top of whatever the policies say, so it is
--      indexable even where the policies are not.
--
-- Most of the ninety-six failed all three. Of those that passed one, most
-- turned out to be already covered by a composite index whose LEADING column
-- the same query also constrains, which the advisor does not check:
--
--   · `gym_member_notes.member_id` — src/lib/memberNotes.ts:177 filters it,
--     and `idx_gym_member_notes_member (tenant_id, member_id, written_at)`
--     already serves that read.
--   · `client_nudges.client_id` — src/ui/nudges.ts:429 filters it, but in the
--     same statement as `coach_id`, which leads `client_nudges_coach_at`.
--   · `thread_blocks.blocker_id` — src/ui/messaging.ts:1481 filters it beside
--     `thread_id`, and the primary key is exactly (thread_id, blocker_id).
--   · `client_subscriptions.package_id` — src/lib/connect.ts:378 filters it
--     beside `trainer_id`, which leads `idx_client_subs_trainer`.
--   · `memberships.plan_id` — `membership_plans_mine_r` filters `m.plan_id`
--     and `m.member_id` together, and `idx_memberships_member_plan` is
--     (member_id, plan_id).
--   · `gym_passes.pass_type_id` — `gym_pass_types_held_r` filters it beside
--     `holder_id`, which `idx_gym_passes_holder` covers.
--   · `coach_ad_code_spend.trainer_id` and `coach_ad_unmatched.trainer_id` —
--     the RLS quals ARE bare equalities on these, but src/ui/adSpend.ts:399
--     and :417 read both tables through `.in('run_id', …)`, and both tables
--     have a `run_id` index. The policy is a recheck on an already-narrowed
--     set, not a scan.
--   · `program_injury_acknowledgements.trainer_id` — a bare-equality policy
--     again, but the only reads (src/ui/injuryAcks.tsx:251) filter
--     `client_id`, which `program_inj_ack_client_idx` leads. A coach inserts
--     into this table (app/(trainer)/group.tsx:221, builder.tsx:1668) and
--     never lists it.
--
-- What is left is four columns with a caller and no index that serves it.
--
--
-- ── DEFECT ONE · a payroll reversal reads every session ever recorded ─────
--
-- `reverseSettlement` in src/lib/gymPay.ts is the "take that payroll run
-- back" button. It unstamps three tables in a fixed order, and each of the
-- three statements filters on `settlement_id` and on nothing else:
--
--     sessions            .update({settlement_id: null}).eq('settlement_id', id)   :1007
--     gym_class_pay       .update({settlement_id: null}).eq('settlement_id', id)   :1023
--     payroll_adjustments .update({settlement_id: null}).eq('settlement_id', id)   :1029
--
-- `refuseIfStillStamped` (:1122) then reads each of them back with
-- `.select('id').eq('settlement_id', id).limit(1)`, and
-- studio-web/app/payroll/page.tsx:1983 counts `sessions` the same way when a
-- reversal has failed and the screen has to say what it left behind.
--
-- None of the three columns is indexed. What makes this worse than an
-- ordinary missing index is the shape of the indexes that DO exist:
--
--     idx_sessions_unsettled             (tenant_id, trainer_id) WHERE settlement_id IS NULL
--     idx_gym_class_pay_unsettled        (tenant_id, trainer_id) WHERE settlement_id IS NULL
--     idx_payroll_adjustments_unsettled  (tenant_id, trainer_id) WHERE settlement_id IS NULL
--
-- Each of them indexes the exact complement of the rows these statements
-- want. They serve the STAMPING side — find this trainer's unpaid work — and
-- they can serve the unstamping side under no circumstances at all, because
-- every row `settlement_id = X` matches is a row the partial predicate
-- excludes. So the reversal path is a sequential scan of `sessions`, which is
-- the table with one row per training session ever delivered by anybody at
-- any gym on the platform, and it holds the row locks it takes while it does
-- it.
--
-- This is not a hot path. A payroll reversal is a rare, deliberate act by a
-- gym owner. It is here because its cost is UNBOUNDED — it grows with the
-- whole history of the platform rather than with the run being reversed —
-- and because the fix costs almost nothing, which the next paragraph is
-- about.
--
-- The three indexes below are partial, `WHERE settlement_id IS NOT NULL`.
-- That is the mirror of the three that exist and it is chosen for the write
-- cost. A session is created with a null `settlement_id` and stays that way
-- until payroll runs, so under a partial index the busy path — inserting and
-- updating sessions all day — never touches this index at all. It is only
-- written when a row is stamped, which happens once per row, at payroll. An
-- unconditional index on the column would be paid for on every session
-- insert in the system to serve a button pressed a handful of times a year.
--
-- Naming follows the three that are already there: `_unsettled` has a
-- `_settled`.
--
--
-- ── DEFECT TWO · a member's offers screen reads every redemption ──────────
--
-- `my_promo_redemptions()` is `security definer` and `stable`, and its body
-- is:
--
--     select p.code, p.discount, r.redeemed_at
--       from public.promo_redemptions r
--       join public.promos p on p.id = r.promo_id
--      where r.member_id = auth.uid()
--      order by r.redeemed_at desc
--      limit 200;
--
-- It is called from app/(client)/offers.tsx:88 — a member-facing screen, one
-- call per open. Because it is a definer, RLS is off inside it and
-- `r.member_id = auth.uid()` is the entire qual.
--
-- `promo_redemptions` carries three indexes and not one of them leads on
-- `member_id`: the primary key is (id), `promo_redemptions_promo_idx` is
-- (promo_id, redeemed_at desc), and `promo_redeemed_once` is unique on
-- (promo_id, member_id) — member_id second, which is a full index scan for
-- this qual rather than a lookup. So the query is a scan of every promo
-- redemption made by every member of every gym on the platform, to return at
-- most two hundred rows belonging to one of them.
--
-- The index below is (member_id, redeemed_at desc), mirroring the existing
-- `promo_redemptions_promo_idx` on the other column. The second column is not
-- decoration: the function ends `order by r.redeemed_at desc limit 200`, so
-- the index answers the ordering as well as the filter and the limit stops
-- reading once it has two hundred.
--
--
-- ── DEFECT THREE · the last policy in the schema that asks per row ────────
--
-- The advisor's one `auth_rls_initplan` finding is `trainer_invites.ti_owner`.
-- Its USING clause is `(owner_id = auth.uid())` — bare, so `auth.uid()` is
-- re-evaluated for every row the policy is checked against, instead of once
-- per statement as an InitPlan.
--
-- Counted on the live database, per CALL rather than per policy — comparing
-- how many times each policy body says `auth.uid()` against how many of those
-- are wrapped — exactly one policy in `public` has any unwrapped call left,
-- and it is this one, with both of its two calls unwrapped. The other 193
-- wrapped calls are spread across the rest of the schema. This is the last
-- survivor of the pass part 145 made — "an index twice
-- and fifteen policies that asked per row" — and the reason it survived is
-- visible in the parts. Part 145 rewrote `ti_invitee_read` on this table and
-- did not touch `ti_owner`, which had stood unchanged since part 12. Part
-- 2391 then re-created `ti_owner` to close a real security hole (the WITH
-- CHECK never looked at `tenant_id`, so anybody could invite themselves onto
-- any gym's staff) and carried part 12's bare `auth.uid()` across verbatim
-- while doing it.
--
-- The rewrite is semantically identical and that is the whole claim being
-- made for it. `auth.uid()` is STABLE, so within one statement every
-- evaluation returns the same value; `(select auth.uid())` computes that
-- value once and substitutes it. The NULL case is unchanged too: an
-- unauthenticated caller gets NULL either way, `owner_id = NULL` is NULL,
-- NULL is not true, and the row is refused exactly as before. Nothing about
-- WHO can read or write a `trainer_invites` row changes.
--
-- Two things this deliberately does NOT do.
--
--   · It does not touch the ASYMMETRY between USING and WITH CHECK. On a
--     `for all` policy the USING clause governs what can be seen, updated
--     from, and deleted, and the WITH CHECK governs what can be written. Part
--     2391 made the WITH CHECK strictly tighter than the USING on purpose:
--     the owner reads and revokes their own invitations, and the extra
--     `is_owner_of(tenant_id)` constrains only which gym an invitation may be
--     pointed at. Both clauses are reproduced below with that difference
--     intact. A "tidy-up" that made them match would undo part 2391.
--
--   · It uses ALTER POLICY rather than DROP and CREATE. A drop/create leaves
--     a window, however short, in which `trainer_invites` has one fewer
--     policy than it should, and there is no reason to open one to change an
--     expression.
--
--
-- ── WHAT THIS PART DOES NOT TOUCH, AND WHY ───────────────────────────────
--
-- `unused_index` (73, INFO). Not one index is dropped here and none should
-- be. On this database that lint means UNTESTED, not unused. Read out of
-- pg_stat_user_tables and pg_stat_user_indexes on 8 Sep 2026, with statistics
-- reset on 30 Jun 2026: 159 tables in `public` holding 4,079 live rows
-- between them, of which 114 tables hold zero. 437 indexes exist and 190 have
-- never been scanned. No real gym has ever used this system. An index counter
-- at zero on a table with no rows is a statement about the absence of
-- traffic, and dropping on it would remove precisely the indexes the first
-- real gym needs, discovered one slow screen at a time. What would make this
-- lint actionable is real traffic from real gyms over a real period —
-- weeks, spanning a month-end close and a payroll run, so the monthly paths
-- have had a chance to run at all — read after a `pg_stat_reset()` at a known
-- moment so the window is known.
--
-- `multiple_permissive_policies` (578, WARN). Nothing here merges a policy.
-- The 578 is smaller than it reads: decomposed, it is 108 distinct (table,
-- action) pairs across 79 tables, each counted once for each of six roles —
-- authenticated, anon, authenticator, cli_login_postgres, dashboard_user and
-- supabase_privileged_role. Only the `authenticated` 108 describe application
-- traffic. And they are structural on purpose: this schema layers a member
-- policy, a staff policy and an owner policy on one table, and merging them
-- into one expression changes who can read what. That is a SECURITY change
-- wearing a performance costume, and it would have to clear the security bar
-- — this codebase has already shipped a table readable across gyms, and a
-- `for all` policy whose USING was looser than its WITH CHECK, which is the
-- very policy this part edits.
--
-- One consequence of that layering IS worth writing down, because it is why
-- several tempting-looking indexes are absent from this part. Permissive
-- policies are OR-ed. Where one arm is an equality on a column and another is
-- a function call — `is_owner_of(tenant_id)` — the function arm cannot be
-- answered from any index, so the planner scans the table and applies both
-- arms as filters, and an index on the equality column is never reached. That
-- is the situation on `feedback` (fb_own OR fb_owner), `staff_grants`,
-- `gym_class_pay`, `gym_trainer_pay`, `payroll_adjustments` and
-- `gym_agreement_signatures` for their self-read arms. Indexing
-- `feedback.user_id` or `staff_grants.subject_id` today would buy nothing,
-- because no plan would use it. The same reasoning rules out
-- `session_approvals.client_id`, whose single policy is itself an OR against
-- an EXISTS over `sessions`, and whose two real read sites
-- (src/ui/sessions.tsx:383 and studio-web/app/coach/page.tsx:248) both go
-- through `.in('session_id', …)` on the primary key anyway.
--
-- `auth_db_connections_absolute` (1, INFO). Out of scope for a SQL part: the
-- Auth server's 10-connection cap is project configuration, not schema.
--
-- This part creates no function, so it has no `revoke ... from public, anon`
-- to make. It creates four indexes and edits one policy expression.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Defect three ──────────────────────────────────────────────────────────
-- Both clauses restated in full. ALTER POLICY replaces whichever clauses it
-- is given, so the WITH CHECK is repeated verbatim from part 2391 to make
-- sure the tenant test is carried forward rather than silently dropped.
alter policy ti_owner on public.trainer_invites
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (tenant_id is null or public.is_owner_of(tenant_id))
  );


-- ── Defect one ────────────────────────────────────────────────────────────
-- Partial on IS NOT NULL: the complement of the three `_unsettled` indexes
-- that already exist, so an unstamped row — which is every row on the busy
-- path — never enters these at all.
create index if not exists idx_sessions_settled
  on public.sessions (settlement_id)
  where settlement_id is not null;

create index if not exists idx_gym_class_pay_settled
  on public.gym_class_pay (settlement_id)
  where settlement_id is not null;

create index if not exists idx_payroll_adjustments_settled
  on public.payroll_adjustments (settlement_id)
  where settlement_id is not null;

-- Written without CONCURRENTLY on purpose. Read from pg_stat_user_tables on
-- 8 Sep 2026, these three tables hold 288, 0 and 0 live rows, so the build is
-- instantaneous and the lock window is not a real one. If this part is ever
-- replayed onto a database with a real gym's history in it, these three want
-- CONCURRENTLY and their own transaction.


-- ── Defect two ────────────────────────────────────────────────────────────
-- (member_id, redeemed_at desc) mirrors promo_redemptions_promo_idx on the
-- other column, and the second column answers the `order by redeemed_at desc
-- limit 200` that my_promo_redemptions() ends with.
create index if not exists promo_redemptions_member_idx
  on public.promo_redemptions (member_id, redeemed_at desc);


-- ── Verify ────────────────────────────────────────────────────────────────
--
-- What this block can and cannot establish is worth being exact about. It
-- proves the STRUCTURE: that the policy no longer asks per row, that it kept
-- its tenant test, and that each of the four indexes exists in a shape the
-- planner can match to the qual it was written for — the last of these with
-- enable_seqscan off, which forces the planner to say whether the index is
-- USABLE for that predicate. It does not and cannot prove the planner will
-- CHOOSE these indexes under real conditions, because on tables holding 288,
-- 0, 0 and 0 rows a sequential scan is genuinely the cheaper plan and the
-- planner is right to pick it. That is a claim only real data can settle.
do $$
declare
  v_qual  text;
  v_chk   text;
  v_bare  int;
  v_miss  text;
  v_query text;
  v_index text;
  v_table text;
begin
  -- 1. No policy in `public` re-evaluates auth.uid() per row any more.
  --    Counted per CALL, not per policy. A policy that wraps one auth.uid()
  --    and leaves a second one bare still asks per row, and a test that only
  --    asked "does this policy contain the wrapped form anywhere" would pass
  --    it. ti_owner itself has two calls, which is why this is worth the
  --    extra clause.
  select count(*) into v_bare
    from (
      select coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
        from pg_policies where schemaname = 'public'
    ) p
   where regexp_count(body, 'auth\.uid\(\)')
       > regexp_count(body, '\(\s*SELECT auth\.uid\(\) AS uid\)');
  if v_bare <> 0 then
    raise exception 'part 2612: % policies still call auth.uid() per row; expected 0 (it was 1 before this part, ti_owner, with 2 bare calls)', v_bare;
  end if;

  -- 2. ti_owner kept both clauses, and the WITH CHECK kept part 2391's
  --    tenant test. A rewrite that lost it would pass check 1 and reopen a
  --    security hole, so it is asserted separately.
  select qual, with_check into v_qual, v_chk
    from pg_policies
   where schemaname = 'public' and tablename = 'trainer_invites' and policyname = 'ti_owner';
  if v_qual is null or v_qual !~ 'owner_id = \(\s*SELECT auth\.uid' then
    raise exception 'part 2612: ti_owner USING is now %, which is not the expected owner_id = (select auth.uid())', coalesce(v_qual, '<null>');
  end if;
  if v_chk is null
     or v_chk !~ 'owner_id = \(\s*SELECT auth\.uid'
     or v_chk !~ 'tenant_id IS NULL'
     or v_chk !~ 'is_owner_of' then
    raise exception 'part 2612: ti_owner WITH CHECK is now %, which has lost part 2391''s tenant test', coalesce(v_chk, '<null>');
  end if;

  -- 3. All four indexes exist, partial where they were meant to be partial.
  select string_agg(want, ', ') into v_miss from (
    select 'idx_sessions_settled' as want, 'sessions' as t, 'settlement_id IS NOT NULL' as pred
    union all select 'idx_gym_class_pay_settled', 'gym_class_pay', 'settlement_id IS NOT NULL'
    union all select 'idx_payroll_adjustments_settled', 'payroll_adjustments', 'settlement_id IS NOT NULL'
    union all select 'promo_redemptions_member_idx', 'promo_redemptions', ''
  ) w
  where not exists (
    select 1 from pg_indexes i
     where i.schemaname = 'public' and i.tablename = w.t and i.indexname = w.want
       and (w.pred = '' or i.indexdef like '%' || w.pred || '%')
  );
  if v_miss is not null then
    raise exception 'part 2612: missing or wrong-shaped index(es): %', v_miss;
  end if;

  -- 4. Each index is USABLE for the predicate it was written for. Not "will
  --    be used" — see the note above this block. enable_seqscan is turned off
  --    for the duration so the planner has to reach for the index or admit it
  --    cannot, and a literal uuid is used rather than a parameter so the
  --    planner can prove the partial predicate is satisfied.
  set local enable_seqscan = off;
  for v_query, v_index, v_table in
    select * from (values
      ('select 1 from public.sessions where settlement_id = ''00000000-0000-0000-0000-000000000001''::uuid',
       'idx_sessions_settled', 'sessions'),
      ('select 1 from public.gym_class_pay where settlement_id = ''00000000-0000-0000-0000-000000000001''::uuid',
       'idx_gym_class_pay_settled', 'gym_class_pay'),
      ('select 1 from public.payroll_adjustments where settlement_id = ''00000000-0000-0000-0000-000000000001''::uuid',
       'idx_payroll_adjustments_settled', 'payroll_adjustments'),
      ('select 1 from public.promo_redemptions where member_id = ''00000000-0000-0000-0000-000000000001''::uuid order by redeemed_at desc limit 200',
       'promo_redemptions_member_idx', 'promo_redemptions')
    ) as p(q, idx, tbl)
  loop
    declare
      v_text text := '';
      v_row  text;
    begin
      for v_row in execute 'explain (costs off) ' || v_query loop
        v_text := v_text || v_row || E'\n';
      end loop;
      if position(v_index in v_text) = 0 then
        raise exception 'part 2612: with seqscan off, the plan for % does not reach %. Plan was: %',
          v_table, v_index, v_text;
      end if;
    end;
  end loop;
  reset enable_seqscan;

  raise notice 'part 2612 verified: 0 per-row auth.uid() policies, ti_owner intact, 4 indexes present and reachable.';
end $$;
