-- ═══════════════════════════════════════════════════════════════════════════
-- The guard that only watched updates
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Written to be applied by hand. Every fact below was read out of
-- the LIVE database on 6 Sep 2026 with pg_policies, pg_trigger, pg_proc,
-- pg_get_functiondef and has_table_privilege — not out of the parts.
-- APPLIED. Proved live as the `authenticated` role inside a transaction
-- aborted on purpose: an INSERT into public.clients naming a listed coach is
-- refused with the guard's own sentence — 'A client cannot set their own coach.'
--
--
-- ── What this is ─────────────────────────────────────────────────────────
--
-- supabase/parts/2400 (commit dfc2744, "Anybody signed in could make
-- themselves any coach's client") closed `link_coaching`. Its argument for why
-- that function was the defect rather than the rule is quoted from its own
-- commit message:
--
--     "It is a hole in a rule rather than a missing rule.
--      guard_client_trainer_link on `clients` says outright: 'A client cannot
--      set their own coach.' ... That trigger IS the rule; this function was
--      the way around it."
--
-- The trigger is not the rule it is described as. Live:
--
--     CREATE TRIGGER guard_client_trainer_link_t
--       BEFORE UPDATE ON public.clients
--       FOR EACH ROW EXECUTE FUNCTION guard_client_trainer_link()
--
-- BEFORE UPDATE, and the function body is `new.trainer_id is distinct from
-- old.trainer_id`, which has no meaning on an INSERT and could not run on one.
-- So the sentence "a client cannot set their own coach" is enforced against
-- changing the column and not against writing it the first time.
--
-- ── The second way in, exactly as it stands live ─────────────────────────
--
--   public.clients, rls enabled. ONE policy admits a write:
--
--     client_self  FOR ALL  USING (id = auth.uid())   -- WITH CHECK is NULL
--
--   A FOR ALL policy with no WITH CHECK uses its USING expression as the
--   WITH CHECK for INSERT. So the whole of the test applied to an inserted row
--   is `id = auth.uid()`. `trainer_id` is not mentioned anywhere.
--
--   grants: `authenticated` and `anon` both hold INSERT (has_table_privilege).
--
--   the other BEFORE INSERT trigger, guard_client_tenant_t, fires on
--   INSERT OR UPDATE and guards `tenant_id` ALONE — it is the shape this part
--   copies, and it is the proof the INSERT case was thought about for one
--   column and not for the other.
--
-- One statement from any signed-in account with no `clients` row of its own:
--
--     insert into clients (id, trainer_id) values (auth.uid(), '<any coach>');
--
-- The coach's id is not a secret — `trainers_public_directory_r` is
-- `using (listed = true)` to authenticated, and two coaches are listed on
-- production. 10 of the 20 accounts on production have no `clients` row today
-- and so are not stopped by the primary key.
--
-- ── What it is worth, stated narrowly ────────────────────────────────────
--
-- LESS than `link_coaching` gave, and the difference is worth writing down so
-- nobody reads this as the same finding twice. `link_coaching` also wrote
-- `coaching_relationships`; this does not. So the star rating via
-- `can_review_coach`, and everything else keyed on that table, is NOT reachable
-- this way. Neither are `availability_templates_client_r`,
-- `trainers_assigned_client_r` or `tenants_client_r` — all three key on
-- `coach_clients`, which is a TABLE (relkind 'r'), not a view over `clients`.
--
-- What IS reachable, every one a live policy satisfied the moment the row
-- exists, read out of pg_policies:
--
--   · the caller appears on that coach's roster — `clients_trainer_read` is
--     `trainer_id = auth.uid()`, and the coach has no way to tell this row from
--     one they agreed to.
--   · a MESSAGE THREAD with a coach who never agreed. `is_my_client(c)` is
--     `exists (select 1 from clients where id = c and trainer_id = auth.uid())`
--     — it reads `clients.trainer_id` and nothing else — and 20 policies across
--     18 tables turn on it, `msg_coach_r` and `msg_coach_i` among them. The
--     caller's own `msg_client_i` then lets them post into it, and the AFTER
--     INSERT trigger on `messages` pushes it to the coach's phone.
--   · `coach_documents_client_r` — the coach's documents.
--   · `sessions_client_read` — every slot that coach has open.
--   · `exvid_read` at `visibility = 'clients'` — the coach's exercise videos.
--
-- ── Why closing it costs nothing ─────────────────────────────────────────
--
-- NOTHING in this repository inserts a `clients` row from a handset or a
-- browser. Grepped across src/, app/, studio-web/ and supabase/functions/:
-- every `from('clients')` is a `.select()` or an `.update()`; there is no
-- `.insert()` and no `.upsert()` on the table anywhere.
--
-- `prosrc ~* 'insert into (public.)?clients'` over every function in the public
-- schema returns exactly two — `accept_member_invite` and `provision_profile`
-- — and both are SECURITY DEFINER owned by `postgres`. `current_user` inside
-- them is therefore `postgres`, which the guard below does not test, so both
-- are untouched. That is the same exemption `guard_client_tenant` already
-- relies on and the same one part 2400 relied on for `accept_invite`.
--
-- ── The shape of the fix ─────────────────────────────────────────────────
--
-- The trigger is widened to INSERT and the function grows the arm it never
-- had, in the shape `guard_client_tenant` already uses for `tenant_id`: a
-- client may create their own row, and may not name a coach on it. Coaching
-- still starts where the sentence has always said it does — a code, an
-- invitation, or a directory request — and each of those runs as `postgres`.
--
-- The WITH CHECK on `client_self` is deliberately NOT touched. Two mechanisms
-- for one rule is how part 2400's hole came to exist; the trigger is where the
-- sentence is already written, and this puts it where it can be read.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.guard_client_trainer_link()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      -- The arm that did not exist. `old` is null here, so the comparison
      -- below cannot be reused: on an INSERT the question is not "did this
      -- change" but "was it named at all".
      if new.trainer_id is not null then
        raise exception 'A client cannot set their own coach. Coaching starts with a code, an invitation or a directory request, and ends with end_coaching().'
          using errcode = '42501';
      end if;
    elsif new.trainer_id is distinct from old.trainer_id then
      raise exception 'A client cannot set their own coach. Coaching starts with a code, an invitation or a directory request, and ends with end_coaching().'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;

drop trigger if exists guard_client_trainer_link_t on public.clients;
create trigger guard_client_trainer_link_t
  before insert or update on public.clients
  for each row execute function public.guard_client_trainer_link();

-- ── after applying ───────────────────────────────────────────────────────
--
--   · re-read pg_get_triggerdef and confirm it says BEFORE INSERT OR UPDATE.
--   · confirm the two definer writers still work: accept_member_invite and
--     provision_profile both run as `postgres` and must be unaffected.
--   · run get_advisors(security). This part creates no new function grant —
--     `create or replace` keeps the existing proacl — but the rule is that a
--     part is not finished until the advisors are read.
