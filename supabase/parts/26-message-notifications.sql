-- Push + in-app notification on a new message.
--
-- An AFTER INSERT trigger on `messages` posts to the `notify-message` edge
-- function via pg_net; that function resolves the recipient, writes the
-- notifications row and sends the Expo push.
--
-- `notify-message` runs with verify_jwt:false, so it is publicly reachable and
-- this shared secret is its ONLY authentication. The secret is read from Vault
-- at call time and is deliberately not a literal here: the original version of
-- this function carried it in plaintext in its body, where anything able to read
-- pg_proc could read it. That value has been rotated.
--
-- Rotating again needs no change to this file — set a new value in BOTH:
--   • Vault secret `hook_secret`  (Dashboard ▸ Project Settings ▸ Vault)
--   • edge function secret `HOOK_SECRET`
-- Between saving the second one and the first, pushes are skipped; messages
-- themselves are unaffected.

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'hook_secret'
   limit 1;

  -- No secret configured: skip rather than post an unauthenticated request.
  if v_secret is null or v_secret = '' then
    return NEW;
  end if;

  perform net.http_post(
    url     := 'https://phgfwzpkkwdysftlgkoq.supabase.co/functions/v1/notify-message',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'secret',    v_secret,
      'client_id', NEW.client_id,
      'sender',    NEW.sender,
      'body',      NEW.body
    )
  );
  return NEW;
-- A failed notification must never block the message itself from being written.
exception when others then
  return NEW;
end;
$function$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function notify_on_message();
