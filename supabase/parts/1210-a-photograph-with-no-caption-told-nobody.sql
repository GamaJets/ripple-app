-- A photograph with no caption told nobody.
--
-- ── The hop that dropped it ────────────────────────────────────────────────
--
-- `notify_on_message` (part 26) posts four fields at the `notify-message` edge
-- function: the secret, the thread key, the sender, and NEW.body. That was the
-- whole of a message when it was written. It is not any more.
--
-- supabase/parts/124 added attachments and said so plainly: "`body` stays NOT
-- NULL and an attachment-only message carries ''". src/ui/messaging.ts writes
-- exactly that row whenever somebody sends a photo or a clip with no words on
-- it — `hasSomethingToSend` lets the send through on the strength of the file
-- alone, which is right.
--
-- The notifier then received `body: ''` and returned `{ skipped: 'missing
-- fields' }`. It wrote no inbox row and sent no push. And that function is the
-- ONLY writer of the inbox row for a chat message: src/lib/notifyInbox.ts
-- refuses to write a second one, on the correct grounds that this trigger
-- writes the first.
--
-- So the two filters in that function — a muted 'chat' channel (part 251) and
-- quiet hours (part 530, and `notify_quiet_hours_rollout.enforced` is TRUE on
-- this server) — had a push to suppress with no record standing behind them. A
-- client photographing the machine they are stuck on at eleven at night, to a
-- coach who has set quiet hours, reached that coach NOWHERE: no banner, no
-- bell, no error anywhere, and the client's own screen said "Sent".
--
-- ── What this part changes, and what it deliberately does not ──────────────
--
-- One field. `attachment_kind` rides along beside `body`, so the notifier can
-- say "Sent you a photo" instead of finding nothing to say and going home. The
-- wording is NOT built here — a notification composed in a trigger is a
-- sentence nobody can find, and src/lib/messagePreview.ts is where it lives,
-- asserted under node in messagePreview.test.ts.
--
-- `attachment_path` is deliberately NOT sent. The notifier has no use for a
-- storage key it cannot read and would only be able to put somewhere it does
-- not belong, and the path carries the sender's uid in it (part 124's layout,
-- <client_id>/<sender_uid>/<file>).
--
-- Everything else about this function is unchanged and is repeated verbatim
-- rather than patched, because `create or replace` takes the whole body: the
-- Vault read, the skip-when-unconfigured, and the EXCEPTION block.
--
-- ── The EXCEPTION block stays, and is now the smaller of two evils ─────────
--
-- `exception when others then return NEW` swallows the notification's failure
-- so a broken notifier cannot stop a message being written. That is the right
-- trade and it is kept: the message is the thing, and a member whose words are
-- refused because a push failed is a worse product than one whose push is
-- missing.
--
-- It is worth being exact about what it can now swallow, though. `net.http_post`
-- only ENQUEUES the request — pg_net delivers it out of band — so a notifier
-- that is down, undeployed, or refusing the secret raises nothing here at all
-- and never has. This block catches the Vault read and the enqueue itself, and
-- both of those failing means no notification for that message and no record
-- of the fact. There is no place in a trigger to report that to a person, and
-- inventing one (a table of failed notifications nobody reads) would be a
-- second silent thing rather than the end of the first. The honest statement is
-- the one in this comment: the delivery of a chat notification is best-effort
-- from the trigger onwards, and the message itself is not.
--
-- UNAPPLIED as written. Requires, in the same sitting:
--   • this part applied, and
--   • supabase/functions/notify-message deployed — it is a WEBHOOK, so:
--       supabase functions deploy notify-message --use-api --no-verify-jwt
-- Deploying the function first is safe and is the recommended order: it reads
-- `attachment_kind` when it is there and falls back to "Sent you a message"
-- when it is not, so it is correct against the old trigger too. Applying this
-- part first is also safe — the extra field is ignored by the old function,
-- which drops caption-less messages either way.
--
-- Idempotent; safe to re-run.

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
begin
  -- Read the shared secret from Vault at call time. It is deliberately NOT a
  -- literal in this body: the original version carried it in plaintext, where
  -- anything able to read pg_proc could read it. Rotating means changing the
  -- Vault secret and HOOK_SECRET, with no change to this function.
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
      'body',      NEW.body,
      -- The new field, and the whole of this part. 'image' | 'video' | null,
      -- checked by messages_attachment_kind_chk (part 124). Null for an
      -- ordinary text message, which is the case the notifier already handled.
      'attachment_kind', NEW.attachment_kind
    )
  );
  return NEW;
-- A failed notification must never block the message itself from being written.
-- See the note above on exactly how much this can hide.
exception when others then
  return NEW;
end;
$function$;

-- Unchanged, and restated so this file stands alone if it is ever read on its
-- own: the trigger is AFTER INSERT, per row, and part 26 created it.
drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute function notify_on_message();

comment on function public.notify_on_message() is
  'AFTER INSERT on messages: posts the thread key, the sender, the body and the attachment kind to the notify-message edge function via pg_net. The attachment kind is carried because an attachment-only message has body '''' (part 124) and the notifier used to read that as "nothing to notify anybody about", writing no inbox row and sending no push. See supabase/parts/1210.';
