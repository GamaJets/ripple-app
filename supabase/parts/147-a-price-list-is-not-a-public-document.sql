-- ═══════════════════════════════════════════════════════════════════════════
-- A price list is not a public document, and link_coaching lost its guard.
--
-- Three things, found by walking the security advisor rather than dismissing
-- it. One was a hole anybody on the internet could reach, one was a hole any
-- coach in any gym could reach, and one was only ever documentation. They are
-- in one file because they were proved in one sitting, against production.
--
-- Everything below was proved by DOING it — `set local role` plus
-- `request.jwt.claims` for a real user id, the exact row set recorded either
-- side of the change — inside a transaction that was rolled back. Table counts
-- were re-measured afterwards against their pre-run values: trainer_packages
-- 0 → 0, client_purchases 0 → 0, client_subscriptions 0 → 0, and the live
-- pkg_read/pkg_write definitions and anon's grants were confirmed byte-identical
-- to their pre-run text before anything was applied for real.
--
--
-- ── 1 · pkg_read handed every active package to the anon key ───────────────
--
--     create policy pkg_read on trainer_packages
--       for select using (active or trainer_id = auth.uid());
--
-- granted to {public}, which is anon and authenticated and everything else, on
-- a table where `anon` also held a stock table-level SELECT that nobody in this
-- repository wrote (the grant class 119-revoke-truncate.sql found on 80 of 89
-- tables and deliberately left standing: "revoking those wholesale is a
-- separate, tested change". This is that change, for this table).
--
-- The anon key is compiled into the shipped app. So the exploit is: hold the
-- publishable key, sign in as nobody, select the table. Proved with three
-- fixture packages belonging to two coaches in two different tenants:
--
--   anon, signed out          AUDIT-A-onsale @9900gbp + AUDIT-B-onsale @12900aed
--   signed-in stranger        AUDIT-A-onsale @9900gbp + AUDIT-B-onsale @12900aed
--   gym owner, other tenant   AUDIT-A-onsale @9900gbp + AUDIT-B-onsale @12900aed
--
-- Name, price, currency, session count, billing interval, and the coach's id,
-- for every coach in the product, with no tenant scoping of any kind. The table
-- holds 0 rows today, which is the only reason this is a finding and not an
-- incident, and exactly why it is worth doing before a coach types a price into
-- it.
--
-- ── Deciding the rule, on what the screens actually ask for ───────────────
--
-- Four candidate rules were considered. The evidence is every live reader of
-- this table that goes through RLS — there are four, and the edge function
-- `connect-checkout` is not one of them because it reads with the service role:
--
--   src/lib/connect.ts  fetchMyPackages()        trainer_id = me
--   src/lib/connect.ts  fetchTrainerPackages(t)  called from ONE place,
--                       app/(client)/packages.tsx line 65, and always with
--                       `c.coachId` from myCoachId() — which is
--                       `clients.trainer_id` for the signed-in client. Never
--                       with anybody else's id.
--   src/lib/connect.ts  packageLabels(ids)       ids come only from the
--                       signed-in client's own client_purchases and
--                       client_subscriptions rows.
--   src/ui/coachInvoices.ts fetchInvoiceCurrency() trainer_id = me
--
-- So: NOBODY browses packages. There is no directory of prices. The client app
-- shows the prices of exactly one coach — the buyer's own — and the labels of
-- the things the buyer has already paid for. `app/(client)/trainers.tsx` and
-- `src/ui/coachProfile.tsx` do list coaches, but they read `session_fee` off
-- `trainers`; neither touches this table.
--
--   REJECTED · "tenant-wide". Nothing reads a sibling coach's prices, and a
--   gym's coaches compete with each other. Wider than any screen asks for.
--
--   REJECTED · "listed/directory coaches, like `trainers`". This is the shape
--   131-a-join-code-is-not-directory-information.sql uses, and it was the
--   tempting answer because it is the established pattern. It is wrong here:
--   131 exposes `trainers` that way because there IS a directory screen reading
--   it. There is no screen that shows a non-client the price list of a coach
--   they have not joined. Copying the pattern would have re-opened most of the
--   hole to satisfy a symmetry rather than a reader.
--
--   REJECTED · `anon` keeps something. No unauthenticated path reads this
--   table. Checkout is an edge function on the service role. `anon` gets
--   nothing, as 131 gave it nothing.
--
--   CHOSEN · the buyer's own coach, plus what the buyer has bought.
--
-- The second half of that is not decoration, and it is the reason the narrowing
-- is not a regression. connect.ts already documents the bug the old policy
-- caused:
--
--   "an inactive package is invisible to the client who bought it under the
--    pkg_read policy … an unlabelled amount renders as a dash rather than as a
--    number in a currency we picked"
--
-- A client whose coach withdraws a pack loses the name and the CURRENCY of
-- their own purchase — and this product is white-labelled, so a purchase with
-- no currency cannot be printed at all. Worse, narrowing to "my current coach"
-- alone would ALSO break a client who has since changed coach: their old
-- purchase is from somebody who is no longer `clients.trainer_id`. So the
-- purchase and subscription arms are load-bearing, and the new rule is strictly
-- better than the old one for the person it is meant to serve:
--
--   client OF coach A, BEFORE   A-onsale, B-onsale        (a stranger's prices;
--                                                          NOT the withdrawn
--                                                          pack they paid for)
--   client OF coach A, AFTER    A-onsale, A-withdrawn     (their coach, and
--                                                          their own purchase)
--
-- ── Rows, not columns ─────────────────────────────────────────────────────
--
-- 131 had to revoke the table and grant single columns because `trainers`
-- carries `join_code`, and RLS SELECTS ROWS, NEVER COLUMNS. That is not needed
-- here and it would be cargo cult if it were done anyway: every column on
-- trainer_packages — id, trainer_id, name, price_cents, currency, sessions,
-- active, created_at, billing_interval — is something a buyer is entitled to
-- see about a package they may buy. There is no join_code equivalent on this
-- table. Nothing is carved.
--
-- ── Proof ─────────────────────────────────────────────────────────────────
--
--                                    BEFORE                     AFTER
--   anon, signed out                 A-onsale + B-onsale        REFUSED 42501
--   signed-in stranger, no coach     A-onsale + B-onsale        (nothing)
--   gym owner, other tenant          A-onsale + B-onsale        (nothing)
--   trainer A                        A-onsale + A-withdrawn     A-onsale +
--                                      + B-onsale                 A-withdrawn
--   trainer B                        A-onsale + B-onsale        B-onsale
--   client of coach A                A-onsale + B-onsale        A-onsale +
--                                                                 A-withdrawn
--   client, ex-coach B, subscribed   A-onsale + B-onsale        B-onsale
--
-- and every real query the app makes still answers, run verbatim:
--
--   fetchTrainerPackages(myCoach)  as the client        → AUDIT-A-onsale
--   packageLabels(withdrawn pack they bought)           → AUDIT-A-withdrawn/gbp
--   packageLabels(the pack they subscribe to)           → AUDIT-B-onsale/aed
--   fetchInvoiceCurrency()         as trainer A         → gbp
--   createPackage + deactivatePackage as trainer A      → OK, 1 row deactivated
--   anon INSERT a package for coach A                   → REFUSED 42501
--   stranger UPDATE the price of coach A's packs        → 0 rows (and note:
--     a PostgREST UPDATE matching zero rows is NOT an error — it was 0 rows
--     before the change too, which is why the read was the whole finding)
--
-- Both policies also move from {public} to `to authenticated`. That is not
-- cosmetic: it is what stops the next stock `anon` grant from reaching them.

revoke select, insert, update, delete on public.trainer_packages from anon;

drop policy if exists pkg_read on public.trainer_packages;
create policy pkg_read on public.trainer_packages
  for select
  to authenticated
  using (
    -- my own price list, on sale or withdrawn
    trainer_id = (select auth.uid())
    -- what my coach currently sells
    or (active and public.is_my_coach(trainer_id))
    -- and whatever I have actually paid for, from whoever, forever: this is
    -- the only place the NAME and the CURRENCY of a past purchase is written
    -- down. client_purchases has no currency column at all.
    or exists (select 1 from public.client_purchases cp
                where cp.package_id = trainer_packages.id
                  and cp.client_id = (select auth.uid()))
    or exists (select 1 from public.client_subscriptions cs
                where cs.package_id = trainer_packages.id
                  and cs.client_id = (select auth.uid()))
  );

drop policy if exists pkg_write on public.trainer_packages;
create policy pkg_write on public.trainer_packages
  for all
  to authenticated
  using (trainer_id = (select auth.uid()))
  with check (trainer_id = (select auth.uid()));


-- ── 2 · link_coaching() lost the guard part 38 gave it ────────────────────
--
-- 38-tenant-isolation.sql section 2 is titled "link_coaching() had no
-- authorization at all", explains that the function "re-points any client at
-- any trainer", and replaces it with a guarded version. The repository has been
-- correct ever since.
--
-- PRODUCTION WAS RUNNING THE UNGUARDED BODY. The live definition tonight was
-- 06-account-provisioning.sql's — three statements, no auth.uid() anywhere.
-- Part 06 creates it and part 38 replaces it, so a database built from this
-- repo is fine; the live one had drifted back, and nobody would have noticed,
-- because the file that describes the fix is still in the tree describing it.
--
-- The advisor called this
-- `authenticated_security_definer_function_executable` and it is one of 95 such
-- findings, which is precisely why "95 findings, all noise" is not an audit.
-- The other 94 were read. They are noise. This one was not.
--
-- ── Exploited, on production rows ─────────────────────────────────────────
--
-- A pure client account cannot run the attack: `clients.trainer_id` has a
-- foreign key to `trainers`, so the seizure fails 23503. Any account holding a
-- `trainers` row can, and signing up as a coach is self-service. Signed in as
-- trainer B, in a different tenant, with no request and no relationship of any
-- kind to the victim:
--
--   BEFORE  link_coaching(me, a stranger's client)  ACCEPTED
--           select from clients where trainer_id = me   → 1 client
--
-- That one column is the hinge. 19-trainer-read-access.sql gates a coach's
-- read of workouts, measurements, check_ins, habit_logs, scans, food logs and
-- the private coach conversation on `clients.trainer_id = auth.uid()`. Setting
-- it is a complete read of a stranger's health history, and part 38 says so.
--
--   AFTER   the same call                            REFUSED 42501
--
-- ── The rule is tighter than part 38's, and why ───────────────────────────
--
-- Part 38's guard is `auth.uid() = p_coach or auth.uid() = p_client or
-- is_owner_of(client_tenant)`. Restoring it verbatim would have closed the hole
-- against strangers and left it open to the attack part 38 itself describes:
-- `auth.uid() = p_coach` is satisfied by the attacker naming THEMSELVES as the
-- coach, which is exactly the "point a stranger's client record at yourself"
-- move. The guard as written does not stop the attack in its own comment.
--
-- So the coach arm now requires evidence that the client asked. Every caller
-- was enumerated first — there are three, and no more:
--
--   src/ui/CoachRequests.tsx  and  studio-web/app/coach/page.tsx
--       the coach accepting a coach_requests row. The row exists, and it is
--       still 'pending' at the moment of the call — both files call
--       link_coaching FIRST and update the request afterwards, deliberately.
--       Status is therefore NOT filtered on.
--   accept_invite(p_invite)  (SECURITY DEFINER, part 11)
--       calls link_coaching(inv.coach_id, auth.uid()) — the client arm.
--
-- `join_by_code()` does not call this function; it writes a coach_requests row,
-- which is the evidence the new arm looks for. An `is_owner_of` arm is kept.
-- An "already linked" arm is kept too, so a re-run — a mode change, a retry
-- after a failed roster write — cannot lock a working pair out; it can grant
-- nothing, because the link it asserts already exists.
--
-- Proved, all four legitimate paths, on live rows:
--
--   client links their own coach (accept_invite path)      OK
--   coach accepts, request row present (CoachRequests)     OK, trainer_id set
--   gym owner links a member of their own gym              OK
--   coach re-runs for a client already theirs (mode)       OK, mode=inperson
--   trainer B seizes a stranger's client, no request       REFUSED 42501
--
-- If a future flow needs a coach to link a client who never asked, it fails
-- loudly with a sentence, which is the right way to find out.

create or replace function public.link_coaching(
  p_coach uuid, p_client uuid, p_mode text default 'online'
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare client_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select tenant_id into client_tenant from profiles where id = p_client;

  if not (
    -- I am the client. This is accept_invite() and every self-serve path.
    auth.uid() = p_client
    -- I am the coach AND they asked for me. join_by_code() writes that row.
    or (auth.uid() = p_coach and exists (
          select 1 from coach_requests q
           where q.client_id = p_client and q.trainer_id = p_coach))
    -- I am the coach and they are ALREADY mine: a re-run cannot grant anything.
    or (auth.uid() = p_coach and exists (
          select 1 from clients c
           where c.id = p_client and c.trainer_id = p_coach))
    -- I own the gym they belong to.
    or (client_tenant is not null and is_owner_of(client_tenant))
  ) then
    raise exception 'You can only link a coach and a client you are part of.'
      using errcode = '42501';
  end if;

  insert into coaching_relationships (coach_id, client_id, mode, status)
  values (p_coach, p_client, coalesce(p_mode, 'online'), 'active')
  on conflict (coach_id, client_id) do update set mode = excluded.mode, status = 'active';

  update clients set trainer_id = p_coach where id = p_client;
end $fn$;

revoke execute on function public.link_coaching(uuid, uuid, text) from public, anon;
grant  execute on function public.link_coaching(uuid, uuid, text) to authenticated;


-- ── 3 · the photo purge job was a signed-in stranger's to run ─────────────
--
-- 51-advisor-tidy.sql declares `photo_purge` "nobody's to read" and gives it an
-- explicit deny. The three functions that WORK that queue were left executable
-- by `authenticated`, which is the same table reached through a different door:
--
--   confirm_photo_purges()          ACCEPTED for a signed-in stranger, returned 0
--   purge_progress_photo_files()    ACCEPTED for a signed-in stranger, 0/0
--
-- They are the cron entry points (part 48). They take no argument and scope on
-- nothing; a stranger can advance another member's photo-deletion state machine
-- and read back how much work it did. `purge_photo_file(p_path)` is revoked
-- with them: it fires a real, NON-TRANSACTIONAL storage DELETE via net, so
-- unlike everything else in this file it was NOT proved by invocation — proving
-- it would have deleted a member's photograph. It is revoked on the same
-- argument as its two siblings.
--
-- Nothing legitimate loses a door. pg_cron runs as postgres. The internal
-- callers — purge_progress_photo_files, on_progress_photo_deleted, and
-- queue_photo_file_purge — are all SECURITY DEFINER and owned by postgres, so
-- their calls are checked against the owner, not the caller. And
-- queue_photo_file_purge is the one of the four that IS properly guarded
-- ("that is not your file", on a path prefix match against auth.uid()), so it
-- keeps its grant. Proved after the revokes:
--
--   client queues their OWN path      OK, queued 1
--   stranger queues someone else's    REFUSED 42501
--   stranger calls confirm_photo_purges()        REFUSED 42501
--   stranger calls purge_progress_photo_files()  REFUSED 42501

revoke execute on function public.confirm_photo_purges()       from public, anon, authenticated;
revoke execute on function public.purge_photo_file(text)       from public, anon, authenticated;
revoke execute on function public.purge_progress_photo_files() from public, anon, authenticated;


-- ── 4 · the four rls_enabled_no_policy tables say so out loud now ─────────
--
-- coach_ad_accounts, coach_reviews, referral_codes and stripe_webhook_events
-- have RLS on and no policy. That already denies everyone but service_role and
-- the definer functions, and it is what all four want. 51-advisor-tidy.sql made
-- exactly this shape explicit for photo_purge and gave the reason: "an implicit
-- denial reads like an unfinished table — one `create policy` away from
-- somebody 'completing' it." The same reason applies four more times.
--
-- Verified first that no reader loses anything. Every path to these tables is
-- either the service role in an edge function (ads-sync, ads-oauth,
-- stripe-webhook) or a SECURITY DEFINER RPC, and both bypass RLS. src/ui/
-- reviews.ts already says it in the file: "A direct .from('coach_reviews')
-- anywhere in this repo returns 42501".
--
-- Measured before and after, as anon and as a signed-in stranger. Three of the
-- four were unchanged at REFUSED 42501 both times, and the definer RPCs over
-- them still answer afterwards — my_ad_account() returns without error,
-- coach_reviews_for(my coach) returns 0 rows without error, my_referral_code()
-- returns the caller's real code.
--
-- stripe_webhook_events was the odd one and is why measuring beat assuming: it
-- answered `0 rows` rather than 42501, to anon AND to authenticated, because
-- unlike its three neighbours it still carried the stock SELECT/INSERT/UPDATE/
-- DELETE grants that 119-revoke-truncate.sql found across this schema. RLS was
-- doing all the work and the table was one dropped policy away from being
-- readable. The grants are removed, so a stranger now gets the honest answer
-- instead of a silent empty set. The webhook itself is unaffected: it reads and
-- upserts with the service role.

revoke select, insert, update, delete on public.stripe_webhook_events from anon, authenticated;

drop policy if exists "coach_ad_accounts belongs to the ad sync job" on public.coach_ad_accounts;
create policy "coach_ad_accounts belongs to the ad sync job"
  on public.coach_ad_accounts
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "coach_reviews is reached only through its functions" on public.coach_reviews;
create policy "coach_reviews is reached only through its functions"
  on public.coach_reviews
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "referral_codes is reached only through its functions" on public.referral_codes;
create policy "referral_codes is reached only through its functions"
  on public.referral_codes
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "stripe_webhook_events belongs to the webhook" on public.stripe_webhook_events;
create policy "stripe_webhook_events belongs to the webhook"
  on public.stripe_webhook_events
  for all to anon, authenticated
  using (false) with check (false);


-- ── What was looked at and deliberately NOT changed ───────────────────────
--
-- All 95 `authenticated_security_definer_function_executable` findings were
-- read, not sampled. 27 take no argument and resolve entirely against
-- auth.uid(). 59 take arguments and gate them — the argument is checked against
-- the caller, or the caller against the argument's owner, before anything is
-- read or written. The nine that never mention auth.uid() at all were the
-- interesting set, and six of them are fine:
--
--   all_member_ids()      scoped by is_owner_of(c.tenant_id)
--   class_counts()        scoped by my_tenant()
--   progress_photo_object_shared_with_viewer(p_name)
--                         delegates to progress_photo_shared_with_viewer,
--                         which is scoped on auth.uid()
--
-- and three are genuinely unscoped but must KEEP their grant, because an RLS
-- policy expression is evaluated as the querying role and therefore needs
-- EXECUTE. Revoking would refuse the very people the policy admits:
--
--   coach_doc_unaccepted(p_path)   used by storage.objects.coachdoc_obj_delete
--   tenant_of_user(u)              used by public.app_errors.app_errors_owner
--                                  and public.coach_clients.coach_clients_owner_r
--
-- Both are real oracles and both are recorded here rather than fixed. Any
-- signed-in account can ask `tenant_of_user(<uuid>)` which gym a given user id
-- belongs to, and can ask `coach_doc_unaccepted(<path>)` whether a coach
-- document exists at a storage path and whether anyone has signed it. Neither
-- returns a name, an amount or a document. Closing them means moving the
-- predicate inside the policy or wrapping it in a caller-scoped function, which
-- rewrites three live policies over app_errors, coach_clients and
-- storage.objects — and a mistake there locks an owner out of their own gym's
-- error log. That is a change with its own evidence to gather, and this file
-- does not pretend to have gathered it.
--
-- Also left alone: the two `extension_in_public` findings (pg_net, btree_gist).
-- Moving an extension schema is not a permission change and pg_net is what
-- purge_photo_file calls by name.
--
-- Idempotent. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
