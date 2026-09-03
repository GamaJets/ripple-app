-- ═══════════════════════════════════════════════════════════════════════════
-- Nine trigger functions `anon` holds EXECUTE on, that no part has ever
-- mentioned.
--
-- ── How they were found ───────────────────────────────────────────────────
--
-- Part 2050 closed seventeen SECURITY DEFINER functions that `anon` could
-- reach, and its closing argument was that a part which adds a function is not
-- finished when the function is correct. `scripts/check-grants.mjs` is that
-- argument made mechanical: it reads every part and fails when a function that
-- is SECURITY DEFINER or returns trigger is created and nothing in the ledger
-- ever says who may execute it.
--
-- Run for the first time it named nine, all trigger functions, all SECURITY
-- INVOKER, all created after part 141 and so missed by that part's sweep.
-- `has_function_privilege('anon', p.oid, 'EXECUTE')` on the live database
-- returned true for all nine on 4 September 2026. They are the whole live
-- divergence: besides `leave_my_details` and `public_coach_page`, which are
-- deliberately public and say so in their own comments, these are the only
-- functions in `public` that `anon` can execute.
--
-- ── Why they are not urgent, and are still worth writing down ─────────────
--
-- None is reachable in practice. Calling a trigger function over RPC raises
--
--     ERROR:  trigger functions can only be called as triggers
--
-- before a line of the body runs, and PostgREST has nothing else to offer. Nor
-- are they SECURITY DEFINER, so even if one were callable it would run as the
-- caller with row level security applying to every table it touches.
--
-- What they are is a grant nobody wrote, held by the role any stranger on the
-- internet gets by asking. Part 51 revoked trigger functions from every role
-- and part 141 §2 did it again — "trigger functions are not callable by
-- anyone" — and both were right for the same cheap reason: EXECUTE is checked
-- when a trigger is CREATED, not each time it fires, so revoking costs a
-- trigger function nothing at all. These nine were created after the last
-- sweep and inherited Supabase's stock ALTER DEFAULT PRIVILEGES instead.
--
-- Part 2050's sentence about the thirteen it swept applies unchanged: a
-- trigger function has no business being in the RPC surface, and a privilege
-- nobody needs and nobody wrote reads as deliberate five years later.
--
-- ── The nine, and where each came from ────────────────────────────────────
--
--   coach_message_templates_touch                part 250
--   notify_channel_prefs_touch                   part 251
--   notify_quiet_hours_check                     part 530
--   trainer_availability_check                   part 650
--   injury_doc_consent_path_is_the_clients       part 1000
--   guard_client_tenant                          part 1062
--   guard_session_tenant                         part 1062
--   body_scan_sheet_consent_names_a_recipient    part 1140
--   guard_trainer_tenant                         part 1905
--
-- All nine take no arguments and return trigger, so the signatures below are
-- complete and unambiguous.
--
-- Idempotent: every statement is a REVOKE, safe to re-run, and nothing here
-- changes a function body, a trigger, a policy or a row. Nothing in this file
-- can widen anything.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.body_scan_sheet_consent_names_a_recipient() from public, anon, authenticated;
revoke all on function public.coach_message_templates_touch() from public, anon, authenticated;
revoke all on function public.guard_client_tenant() from public, anon, authenticated;
revoke all on function public.guard_session_tenant() from public, anon, authenticated;
revoke all on function public.guard_trainer_tenant() from public, anon, authenticated;
revoke all on function public.injury_doc_consent_path_is_the_clients() from public, anon, authenticated;
revoke all on function public.notify_channel_prefs_touch() from public, anon, authenticated;
revoke all on function public.notify_quiet_hours_check() from public, anon, authenticated;
revoke all on function public.trainer_availability_check() from public, anon, authenticated;
