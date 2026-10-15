-- ═══════════════════════════════════════════════════════════════════════════
-- THE TWO ROUTES PART 3470 WRITES, TAUGHT TO notification_channel
--
-- Part 3470's notifications use '/(client)/nutrition' and
-- '/(trainer)/client-nutrition'. notification_channel did not classify
-- either, so part 900's dispatcher dropped the push and the row reached only
-- the bell. This is part 3450's definition, unchanged, plus those two routes
-- ('clients', the member's coaching relationship — the same switch as a
-- check-in). Applied to production 2026-10-15 as migration
-- p3470b_notification_channel_nutrition_routes.
--
-- Revoked first: the function exists already, and the case body stays the
-- last thing in this file that names it (scripts/check-notify-routes.mjs).
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.notification_channel(text, text) from public;
revoke all on function public.notification_channel(text, text) from anon;
revoke all on function public.notification_channel(text, text) from authenticated;

CREATE OR REPLACE FUNCTION public.notification_channel(p_route text, p_title text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r text := split_part(btrim(coalesce(p_route, '')), '?', 1);
  t text := btrim(coalesce(p_title, ''));
begin
  if r <> '' then
    return case r
      when '/(client)/messages'         then 'chat'
      when '/(trainer)/chat'            then 'chat'

      when '/(trainer)/calendar'        then 'bookings'
      when '/(client)/calendar'         then 'bookings'
      when '/(client)/bookings'         then 'bookings'
      when '/(client)/pt-sessions'      then 'bookings'
      when '/(client)/classes'          then 'bookings'
      when '/(client)/request-session'  then 'bookings'
      when '/(trainer)/sessions'        then 'bookings'

      when '/(trainer)/payments'        then 'money'
      when '/(client)/packages'         then 'money'
      when '/(client)/explore'          then 'money'
      when '/(client)/offers'           then 'money'

      when '/(trainer)/dashboard'       then 'clients'
      when '/(trainer)/leads'           then 'clients'
      when '/(trainer)/client-goals'    then 'clients'
      when '/(trainer)/client-training' then 'clients'
      when '/(trainer)/client-photos'   then 'clients'
      when '/(client)/my-coach'         then 'clients'
      when '/(client)/trainers'         then 'clients'
      when '/(client)/assessments'      then 'clients'
      when '/(client)/community'        then 'clients'
      when '/(trainer)/community'       then 'clients'
      when '/(owner)/community'         then 'clients'
      when '/(trainer)/checkins'        then 'clients'
      when '/(client)/workouts'         then 'clients'

      -- Part 3470: a scan moved the member's targets / asks the coach to review them.
      when '/(client)/nutrition'        then 'clients'
      when '/(trainer)/client-nutrition' then 'clients'

      when '/(trainer)/documents'       then 'admin'
      when '/(trainer)/client-intake'   then 'admin'
      when '/(trainer)/credentials'     then 'admin'
      when '/(client)/intake'           then 'admin'
      when '/(client)/injuries'         then 'admin'

      when '/(client)/consistency'      then 'training'

      when '/(trainer)/invoices'        then 'book'
      when '/(trainer)/nudges'          then 'book'
      when '/(trainer)/builder'         then 'book'

      else null
    end;
  end if;

  return case t
    when 'An invoice from your gym'        then 'money'
    when 'Your coaching has ended'         then 'clients'
    when 'A client has signed the release' then 'admin'
    else null
  end;
end
$function$;
