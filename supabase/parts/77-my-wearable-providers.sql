-- ─────────────────────────────────────────────────────────────────────────
-- Which devices THIS ACCOUNT has connected — names only, never tokens.
--
-- ── The bug ───────────────────────────────────────────────────────────────
--
-- A wearable connection is a row in wearable_tokens keyed by user_id: it
-- belongs to the ACCOUNT. The app remembered it in AsyncStorage, which belongs
-- to the HANDSET. So a client who connected WHOOP on their phone and then
-- reinstalled, changed device or took a new build opened Recovery to "No
-- device connected" while the server held a live, unexpired token — and every
-- sleep read was skipped, because the reader deliberately never asks a
-- provider it believes is disconnected.
--
-- Reported twice as WHOOP sleep not appearing, and chased twice into the wrong
-- layer: first the missing read:sleep scope, then readiness reading only typed
-- sleep. Both were real and neither was this. The token was working the whole
-- time and the app had forgotten it was there.
--
-- ── Why a function rather than a SELECT policy ────────────────────────────
--
-- wearable_tokens has a DELETE policy and deliberately no SELECT policy: it
-- holds access and refresh tokens and the client has no business reading them.
-- Adding a SELECT policy to fix a display bug would hand every signed-in client
-- its own OAuth tokens in order to answer a question about NAMES.
--
-- So this returns the provider, when it expires, and whether a refresh token
-- exists — enough to say "WHOOP is connected" or "WHOOP needs reconnecting",
-- and nothing that could be replayed against a vendor.
--
-- SECURITY DEFINER with auth.uid(), never current_user: under PostgREST every
-- signed-in request runs as the same `authenticated` role, so current_user
-- names the role rather than the person and would hand one client another
-- client's connections.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.my_wearable_providers()
returns table (provider text, expires_at timestamptz, has_refresh boolean)
language sql
security definer
set search_path = public
stable
as $$
  select t.provider,
         t.expires_at,
         (t.refresh_token is not null) as has_refresh
  from public.wearable_tokens t
  where t.user_id = auth.uid();
$$;

revoke all on function public.my_wearable_providers() from public, anon;
grant execute on function public.my_wearable_providers() to authenticated;

comment on function public.my_wearable_providers is
  'Which wearables the signed-in account has connected. Names and expiry only — never token material. Exists because a connection belongs to the account while the app used to remember it per handset.';
