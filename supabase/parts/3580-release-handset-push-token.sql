-- Taking a handset off the notification list after the session has ended.
--
-- push_tokens is keyed on the Expo token and guarded by pt_self
-- (user_id = auth.uid()), so a delete is only possible from inside the session
-- being ended. When the session ends from elsewhere (expired refresh token,
-- revoked on another device, brand mismatch) the sign-out sweep had no way to
-- remove the row, and the phone went on receiving the last member's
-- notifications until somebody signed in on it again (Sentry REPPLE-4).
--
-- This deletes by token only. The token is the handset's own unguessable
-- delivery address; holding it is exactly what receiving its notifications
-- requires, so being able to UNsubscribe it grants nothing. It never reads or
-- returns whose row it was, and it cannot add or move a row.
--
-- Returns how many of the given tokens are still registered afterwards, so the
-- caller can prove the row is gone rather than infer it from silence.
-- Additive only.

create or replace function public.release_handset_push_tokens(p_tokens text[])
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  left_over integer;
begin
  if p_tokens is null or cardinality(p_tokens) = 0 then return 0; end if;
  if cardinality(p_tokens) > 4 then raise exception 'too many tokens' using errcode = '22023'; end if;
  delete from public.push_tokens
   where token = any(p_tokens)
     and (token like 'ExponentPushToken[%' or token like 'ExpoPushToken[%');
  select count(*) into left_over from public.push_tokens where token = any(p_tokens);
  return left_over;
end;
$fn$;

revoke all on function public.release_handset_push_tokens(text[]) from public;
grant execute on function public.release_handset_push_tokens(text[]) to anon, authenticated;

comment on function public.release_handset_push_tokens(text[]) is
  '[anon entry point] Sign-out sweep without a session (part 3580): deletes these Expo push tokens, whoever they belong to, and returns how many are still registered. Up to 4.';
