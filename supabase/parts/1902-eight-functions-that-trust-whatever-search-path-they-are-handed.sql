-- ═══════════════════════════════════════════════════════════════════════════
-- Eight functions that trust whatever search_path they are handed.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────
--
-- All 250 SECURITY DEFINER functions in `public` set `search_path`. That was
-- checked one by one against `pg_proc.proconfig` on 4 Sep 2026 and there are no
-- exceptions, which is the important half of this rule and it holds.
--
-- Eight SECURITY INVOKER functions do not, and Supabase's own linter names them
-- (`function_search_path_mutable`, eight WARNs). Six are triggers, one is a
-- reporting function and one formats money:
--
--     body_scan_sheet_consent_names_a_recipient()   trigger
--     coach_message_templates_touch()               trigger
--     injury_doc_consent_path_is_the_clients()      trigger
--     notify_channel_prefs_touch()                  trigger
--     notify_quiet_hours_check()                    trigger
--     trainer_availability_check()                  trigger
--     coach_exercise_roster(text, timestamptz, timestamptz)
--     money_text(bigint, text)
--
-- A function with no `search_path` of its own resolves unqualified names
-- against whatever the CALLER has set. The caller can set it, because
-- `search_path` is a plain session GUC and PostgREST clients reach it.
--
-- ── WHAT SOMEBODY COULD ACTUALLY DO ──────────────────────────────────────
--
-- Much less than for a definer function, and this part should not be read as
-- claiming otherwise. These eight run as the CALLER, so a hijacked name
-- resolves to a table the caller could already read and the RLS on it still
-- applies. There is no privilege escalation here and no cross-tenant read.
--
-- What there IS, in the two that matter:
--
--   · `injury_doc_consent_path_is_the_clients()` is the trigger that enforces
--     the firmest product rule in this schema — an injury document belongs to
--     the client and the coach never sees the file. A guard that resolves its
--     own table names through a caller-controlled setting is a guard whose
--     answer depends on who is asking. Nothing today makes it answer wrongly;
--     it should not be possible to make it answer wrongly.
--
--   · `trainer_availability_check()` and `notify_quiet_hours_check()` are the
--     same shape for booking and for quiet hours.
--
-- The other five are formatting and `updated_at` stamps and are here only
-- because the rule is worth being able to state without exceptions.
--
-- ── LIVE OR LATENT ───────────────────────────────────────────────────────
--
-- LATENT, and weakly so. This is a hardening change, not a breach. It is worth
-- doing because "every function in this schema pins its search_path" is a
-- sentence a gate can enforce for ever (scripts/check-definer.mjs, added
-- alongside this part), and a rule with eight exceptions is not enforceable.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- `alter function … set search_path` and nothing else. No body is rewritten, no
-- signature changes, no volatility or security setting is touched, and the
-- value is `public, pg_temp` — the same one all 250 definer functions carry.
--
-- `alter function` is idempotent by nature: setting a config that is already
-- set is a no-op, so this part can be applied twice with no effect.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
--
--   · It does not schema-qualify anything inside the bodies. That would be a
--     rewrite of eight functions to fix a setting, and a rewrite is where a
--     mistake gets made.
--
--   · It does not move `pg_net` or `btree_gist` out of `public`, which the same
--     linter also flags. Relocating an extension changes every call site of
--     every function it provides, in a database with 471 functions and no
--     staging copy, to close a lint that is INFO-shaped for a schema where
--     every function now pins its path anyway. It is left, named here, and
--     belongs in a migration of its own with a rollback plan.
-- ═══════════════════════════════════════════════════════════════════════════

alter function public.body_scan_sheet_consent_names_a_recipient()
  set search_path to 'public', 'pg_temp';

alter function public.coach_message_templates_touch()
  set search_path to 'public', 'pg_temp';

alter function public.injury_doc_consent_path_is_the_clients()
  set search_path to 'public', 'pg_temp';

alter function public.notify_channel_prefs_touch()
  set search_path to 'public', 'pg_temp';

alter function public.notify_quiet_hours_check()
  set search_path to 'public', 'pg_temp';

alter function public.trainer_availability_check()
  set search_path to 'public', 'pg_temp';

alter function public.coach_exercise_roster(p_slug text, p_from timestamp with time zone, p_split timestamp with time zone)
  set search_path to 'public', 'pg_temp';

alter function public.money_text(p_amount_cents bigint, p_currency text)
  set search_path to 'public', 'pg_temp';
