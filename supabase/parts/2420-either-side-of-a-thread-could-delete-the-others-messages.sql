-- ═══════════════════════════════════════════════════════════════════════════
-- Either side of a thread could delete the other's messages
-- ═══════════════════════════════════════════════════════════════════════════
-- APPLIED. Verified after: `anon` holds nothing on either table; `authenticated`
-- holds SELECT and INSERT on messages and SELECT alone on message_reads; the two
-- `for all` policies are replaced by four explicit SELECT/INSERT ones; and
-- mark_thread_read, mark_thread_read_at and thread_read_receipt are all SECURITY
-- DEFINER owned by postgres, so the read-receipt path is untouched.
--
--
-- NOT APPLIED. Written to be applied by hand. Every fact below was read out of
-- the live database on 5 Sep 2026 with pg_policies, pg_trigger, pg_constraint,
-- information_schema.role_table_grants and pg_proc — not out of the parts.
--
-- ── What a person suffers ─────────────────────────────────────────────────
--
-- A coach opens the client's thread and the four messages the client sent on
-- Tuesday are not there. Nothing on the screen says a message was removed,
-- because there is no such thing as a removed message in this product: the
-- thread is drawn from `messages` and the row is simply gone. The client's own
-- copy is gone too, on their phone, in the conversation they had.
--
-- It runs in both directions and with nothing more than the publishable key
-- and a session — the same key that ships in every build:
--
--     delete from messages where client_id = '<my own id>';        -- as a client
--     delete from messages where client_id = '<one of my clients>'; -- as a coach
--
-- The first wipes the coach's side of the conversation. The second wipes the
-- client's. Neither is reachable from any screen this app draws — there is no
-- delete control anywhere in src/ui/messaging.ts, app/(client)/messages.tsx or
-- app/(trainer)/chat.tsx — so this is not a feature with a missing confirm. It
-- is a verb nobody meant to offer, standing open at the REST endpoint.
--
-- ── The policy chain, exactly as it stands live ───────────────────────────
--
--   public.messages, rls enabled, two PERMISSIVE policies, both `for all`:
--
--     msg_client  USING       (client_id = auth.uid())
--                 WITH CHECK  (client_id = auth.uid()
--                              and sender = 'client'
--                              and not message_thread_blocked(client_id::text))
--
--     msg_coach   USING       (is_my_client(client_id))
--                 WITH CHECK  (is_my_client(client_id)
--                              and sender = 'coach'
--                              and not message_thread_blocked(client_id::text))
--
--   grants: anon and authenticated both hold SELECT, INSERT, UPDATE, DELETE.
--
-- A DELETE consults USING and nothing else — WITH CHECK describes a row being
-- written and a deleted row is not written. So the whole of the protection on
-- a delete is "is this thread mine", which is true of both people on it. The
-- `sender` clause that makes it impossible to POST a message as the other
-- person does not appear on the path that REMOVES one.
--
-- UPDATE is the same shape with a smaller blast radius and a nastier edge: it
-- checks USING to find the row and WITH CHECK on the result, so neither party
-- can leave a row attributed to the other — but a client CAN take the coach's
-- message, rewrite the body, and have it come out as their own (`sender` must
-- become 'client' to pass the check), and a coach can do the mirror image. A
-- conversation in which either person can put words in the other's mouth is
-- not evidence of anything, which matters because this is the surface
-- supabase/parts/240 built a reporting flow on top of.
--
-- ── This was known, in writing, and mitigated rather than closed ──────────
--
-- src/ui/messaging.ts, in the header over `useThreadSafety`:
--
--     "a report COPIES the message into `abuse_reports`. `msg_coach` is
--      `for all using (is_my_client(client_id))`, so the reported person can
--      delete the message; a report that only pointed at an id would be one
--      they could empty."
--
-- and src/lib/threadSafety.ts's REPORT_EXPLAINER, which a member reads at the
-- worst moment they will have with this app: "it stays on record even if it is
-- deleted afterwards".
--
-- Both are true and both are right — `report_abuse` snapshots the sender, the
-- body, the attachment and the time into `abuse_reports`, and the FK is
-- `on delete set null`, so a report survives the message. What neither of them
-- does is give the deletion a reason to exist. The snapshot protects the ONE
-- message somebody thought to report. It does nothing for the other side of
-- the thread, which is where the deletion is worth something to the person
-- doing it: an accusation is deleted before it is reported, not after.
--
-- ── Why closing it costs nothing ──────────────────────────────────────────
--
-- Nothing in this repository updates or deletes a `messages` row. Grepped
-- across src/, app/, studio-web/, supabase/functions/ and supabase/parts/:
-- there are five inserts (src/ui/messaging.ts ×3, src/ui/injuryAsk.ts,
-- src/ui/intake.ts, app/(trainer)/dashboard.tsx) and two selects, and no
-- writer of any other verb anywhere. `prosrc` over every function in the public
-- schema finds four that touch the table and all four only read it
-- (coach_threads, coach_unread_counts, client_unread_count, report_abuse).
--
-- Erasure is unaffected, and this is the clause to check before applying:
-- `messages_client_id_fkey` is `references clients(id) on delete cascade`, so a
-- client's thread goes when their `clients` row goes. A cascade is executed by
-- the database as part of the parent delete and consults neither the grant nor
-- the policy, so revoking DELETE from `authenticated` does not leave a deleted
-- account's messages behind. Part 1120's object purge is likewise unaffected —
-- it works on storage keys, not on rows.
--
-- ── The shape of the fix ──────────────────────────────────────────────────
--
-- `for all` is replaced by the two verbs this table actually supports, so that
-- the absence of UPDATE and DELETE is a thing somebody can SEE in pg_policies
-- rather than a thing they have to notice is missing. The grants go too, and
-- both halves are deliberate: a policy alone would refuse the delete, and a
-- revoke alone would too, and neither on its own says why. Together they say
-- the same thing twice, which is the correct amount for a verb that must not
-- come back by accident when somebody writes `for all` again.
--
-- `message_reads` gets the same treatment for a related reason stated
-- separately at §2.
--
-- Nothing here changes who can READ a thread or who can WRITE into one. The
-- SELECT and INSERT halves are copied across unchanged, character for
-- character, including the block check that supabase/parts/240 added.

begin;

-- ── §1 · messages ────────────────────────────────────────────────────────

drop policy if exists msg_client on public.messages;
drop policy if exists msg_coach  on public.messages;

-- Read: the thread is mine. Same predicate the `for all` policy used, and it
-- is what both people on a thread need — a report is made out of what was
-- said, and neither side may lose sight of it.
create policy msg_client_r on public.messages
  for select to authenticated
  using (client_id = (select auth.uid()));

create policy msg_coach_r on public.messages
  for select to authenticated
  using (is_my_client(client_id));

-- Write: unchanged. `sender` is decided by the policy rather than trusted from
-- the request, and `message_thread_blocked` is part 240's refusal.
create policy msg_client_i on public.messages
  for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and sender = 'client'
    and not message_thread_blocked((client_id)::text));

create policy msg_coach_i on public.messages
  for insert to authenticated
  with check (
    is_my_client(client_id)
    and sender = 'coach'
    and not message_thread_blocked((client_id)::text));

-- The verbs themselves. `anon` loses everything: it holds full DML on this
-- table today and every policy above turns on `auth.uid()`, so the grant has
-- never bought it a single row — but a grant that is only inert because a
-- predicate happens to be strict is one line away from not being inert.
revoke update, delete on public.messages from authenticated;
revoke all             on public.messages from anon;

-- ── §2 · message_reads, and the watermark that could be moved by hand ────
--
-- Same `for all` shape, and the same USING as its WITH CHECK, so a DELETE is
-- allowed — which on its own is only self-harm: dropping your own row resets
-- your own unread badge to everything.
--
-- The UPDATE is the one that reaches another person. `mark_thread_read_at`
-- exists to clamp the watermark — `v_at := least(p_at, now())` — because since
-- supabase/parts/950 the OTHER side of the thread is shown the word "Read". A
-- direct `update message_reads set last_read_at = '2099-01-01'` walks past that
-- clamp and tells the coach their client has read every message they will ever
-- send, for ever. src/ui/readReceipts.ts polls `thread_read_receipt` and moves
-- forward only, so it will never come back down.
--
-- Nothing writes this table from a client. Both writers are SECURITY DEFINER
-- functions owned by `postgres` (which holds BYPASSRLS), so revoking the DML
-- from `authenticated` does not touch them: `mark_thread_read`,
-- `mark_thread_read_at` and `thread_read_receipt` go on working exactly as they
-- do now, and they are the only things that ever should.

drop policy if exists message_reads_client on public.message_reads;
drop policy if exists message_reads_coach  on public.message_reads;

create policy message_reads_client_r on public.message_reads
  for select to authenticated
  using (reader = 'client' and client_id = (select auth.uid()));

create policy message_reads_coach_r on public.message_reads
  for select to authenticated
  using (reader = 'coach' and is_my_client(client_id));

revoke insert, update, delete on public.message_reads from authenticated;
revoke all                    on public.message_reads from anon;

commit;

-- ── After applying ────────────────────────────────────────────────────────
--
--   · re-read pg_policies for both tables and confirm four policies on
--     `messages` (two SELECT, two INSERT) and two on `message_reads`, with no
--     row whose cmd is ALL.
--   · re-read role_table_grants and confirm `authenticated` holds SELECT and
--     INSERT on `messages`, SELECT alone on `message_reads`, and that `anon`
--     holds nothing on either.
--   · run get_advisors(security). This part grants nothing and creates no
--     function, so it cannot add a PUBLIC-executable definer — but the rule in
--     this repository is that applying SQL is not finished until the advisors
--     are clean, and a REVOKE is exactly the kind of change that turns an
--     existing warning into an error somewhere else.
--   · smoke: send a message in both directions from the app. The insert path is
--     unchanged, so a refusal here means one of the two WITH CHECKs was
--     transcribed wrong.
--
-- No app-side change ships with this. There is no screen to update, which is
-- the whole point: the app never offered either verb.
