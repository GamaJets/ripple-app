// Supabase Edge Function: notify-message
// Fired by a database trigger (pg_net) whenever a row is inserted into `messages`.
// Resolves the recipient (a coach message → the client; a client message → their
// trainer), writes an in-app notification, and sends an Expo push. Runs with the
// service role internally; the DB trigger authenticates with a shared HOOK_SECRET.
// Deploy:  supabase functions deploy notify-message --use-api --no-verify-jwt
// Secret:  supabase secrets set HOOK_SECRET=<same value you put in the SQL trigger>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const HOOK = Deno.env.get('HOOK_SECRET') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!HOOK || String(b.secret || '') !== HOOK) return json({ error: 'forbidden' }, 403);

  const clientId = b.client_id as string | undefined;
  const sender = String(b.sender || '');

  // ── AN EMPTY BODY IS NOT AN EMPTY MESSAGE ────────────────────────────────
  //
  // This used to be `if (!clientId || !text) return { skipped: 'missing
  // fields' }`, and the second half of that test threw away a whole class of
  // message. `messages.body` is NOT NULL and an attachment-only message carries
  // '' — supabase/parts/124 says so in as many words, and src/ui/messaging.ts
  // writes exactly that shape whenever somebody sends a photo with no caption.
  //
  // What that cost: this function is the ONLY writer of the inbox row for a
  // chat message. src/lib/notifyInbox.ts refuses to write a second one, on the
  // correct grounds that the trigger writes the first. So a caption-less
  // photograph produced no inbox row at all — and the two filters below then
  // had a push to suppress with no record standing behind it. A client
  // photographing the machine they are stuck on at eleven at night, to a coach
  // with quiet hours set, reached that coach NOWHERE: no banner, no bell, no
  // error, and their own screen said "Sent".
  //
  // The trigger fires AFTER INSERT. A call reaching this line is a message that
  // exists, and the only thing that can make it unaddressable is having nobody
  // to address it to. The words are src/lib/messagePreview.ts's — repeated here
  // rather than imported because this runs under Deno, the same duplication
  // `SendStage` in src/lib/readReceipt.ts carries, and messagePreview.test.ts
  // asserts both strings so a reword there is a reword somebody notices.
  const kind = String(b.attachment_kind || '');
  const body = String(b.body || '').trim();
  const text = (body
    || (kind === 'image' ? 'Sent you a photo' : kind === 'video' ? 'Sent you a video' : 'Sent you a message')
  ).slice(0, 180);
  if (!clientId) return json({ ok: true, skipped: 'no thread key' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let recipient: string | null = null;
  let title = 'New message';
  let route = '/(client)/messages';

  try {
    if (sender === 'coach') {
      // Coach → client: notify the client; title = the coach's name.
      recipient = clientId;
      route = '/(client)/messages';
      const { data: c } = await admin.from('clients').select('trainer_id').eq('id', clientId).maybeSingle();
      if (c?.trainer_id) {
        const { data: p } = await admin.from('profiles').select('full_name').eq('id', c.trainer_id).maybeSingle();
        title = p?.full_name || 'Your coach';
      } else { title = 'Your coach'; }
    } else {
      // Client → coach: notify the client's trainer; title = the client's name.
      //
      // '/(trainer)/messages' is not a route in this app — the coach's thread
      // is app/(trainer)/chat.tsx, and it needs the clientId to know WHOSE
      // thread to open. A coach tapping this notification went nowhere. It was
      // masked because src/ui/messaging.ts fires a second, correctly-routed
      // push for the same message; anybody removing that duplicate would have
      // been left with only this one.
      route = `/(trainer)/chat?clientId=${encodeURIComponent(clientId)}`;
      const { data: c } = await admin.from('clients').select('trainer_id').eq('id', clientId).maybeSingle();
      recipient = c?.trainer_id ?? null;
      const { data: p } = await admin.from('profiles').select('full_name').eq('id', clientId).maybeSingle();
      title = p?.full_name || 'Your client';
    }
  } catch { /* fall through */ }

  if (!recipient) return json({ ok: true, skipped: 'no recipient' });

  // In-app notification (backs the bell) — best-effort.
  //
  // `title` and `route` are written now, and they are the same two values the
  // push below already carries. This row predates both columns (part 122 added
  // them), so every message notification ever written here has been a body with
  // no heading and nowhere to go: in the coach's inbox it renders under the
  // screen's own name and says "Nothing to open", because '/(trainer)/chat'
  // needs a clientId to know whose thread to open and the row did not carry
  // one — while this function computed exactly that string, twelve lines up,
  // for the push. The client's side was masked: src/ui/notifications.tsx
  // recognises a routeless 'message' row and sends it to '/(client)/messages',
  // which is right for a client because there is only one thread. There is no
  // such fallback for a coach, and there cannot be.
  //
  // Rows written before this change keep that fallback and stay inert for
  // coaches; nothing here rewrites them.
  //
  // The failure is LOGGED rather than ignored, and the reason is the two
  // filters immediately below. Muting a channel and quiet hours both suppress
  // the banner on the strength of this row existing — "muting is 'do not buzz
  // me about this', not 'do not tell me'". If this insert fails and one of them
  // then fires, the message reaches the recipient NOWHERE: no banner, no inbox
  // row, and no error anywhere, because supabase-js resolves with `{ error }`
  // rather than throwing and this `catch` never saw it. This function is called
  // by a database trigger and answers nothing a person reads, so the log is the
  // only place such a loss could ever be found.
  // The `try` stays: a throw here must not take the PUSH below down with it,
  // which is the one thing that still reaches the recipient when the row fails.
  //
  // ── AND THE LOG IS NOT THE FIX ───────────────────────────────────────────
  //
  // Logging it made the loss FINDABLE. It did not make it not happen, and
  // nobody reads a function log at eleven at night. `recorded` below is the
  // fix: the two filters are allowed to suppress the banner only when the row
  // they are suppressing it in favour of actually landed. If it did not, the
  // push is the last thing standing between this message and nobody, and a
  // preference about how loudly to be told is not a preference to be told
  // nothing at all.
  //
  // The direction is the same one part 251 chose for a failed preference read:
  // err towards the notification. The cost of getting it wrong this way is one
  // banner somebody had asked not to have; the cost the other way is the
  // message.
  let recorded = false;
  try {
    const { error: noteErr } = await admin.from('notifications')
      .insert({ user_id: recipient, icon: 'message', title, body: text, route });
    if (noteErr) console.error('notify-message: could not write the inbox row for ' + recipient + ', so the mute and quiet-hours filters are being skipped and this message is pushed regardless:', noteErr.message);
    else recorded = true;
  } catch (e) {
    console.error('notify-message: the inbox row for ' + recipient + ' threw, so the mute and quiet-hours filters are being skipped and this message is pushed regardless:', (e as Error).message);
  }

  // Expo push to the recipient's devices — best-effort.
  //
  // ── the 'chat' channel ──────────────────────────────────────────────────
  //
  // This function does not go through supabase/functions/send-push, so the
  // per-channel filter added there does not reach it — and chat is the one
  // channel a coach most wants to mute, because it is the one that arrives at
  // 11pm. The same check is therefore made here, in the same shape and with the
  // same three rules: only an explicit `enabled = false` suppresses, a failed
  // read sends, and the notifications ROW above is written either way.
  //
  // The row above is the reason muting is safe to offer at all. A muted coach
  // still finds the message in their notifications list and in the thread; what
  // stops is the banner.
  //
  // `recorded &&` is the whole of it, and it is the same sentence as the
  // paragraph above read backwards: muting is safe to offer BECAUSE the row
  // exists. With no row there is nothing for the coach to find in the morning,
  // and suppressing here would be reading "do not buzz me about this" as "do
  // not tell me this happened".
  try {
    const { data: off, error: prefErr } = await admin
      .from('notify_channel_prefs')
      .select('user_id')
      .eq('user_id', recipient)
      .eq('channel', 'chat')
      .eq('enabled', false)
      .maybeSingle();
    if (recorded && !prefErr && off) return json({ ok: true, muted: true });
  } catch { /* a preference we cannot read is not a mute — fall through and send */ }

  // ── Quiet hours (part 530) ──────────────────────────────────────────────
  //
  // Chat does not go through send-push, and chat at eleven at night is the
  // notification the whole complaint was about — so the same check is made
  // here, in the same single-recipient shape as the channel filter above and
  // under the same three rules.
  //
  // The hour arithmetic belongs to `notify_quiet_now`, not to this function.
  // `new Date().getHours()` here is the hour in whatever zone the edge runtime
  // is in, which is the one hour certain to be wrong for the person receiving
  // it; the view resolves the window in the recipient's OWN stored zone.
  //
  // As above: the notifications ROW is already written by this point and is
  // written either way. Quiet hours stop the banner, never the record — a
  // coach who was quiet still finds the message in their list and in the
  // thread, which is what makes suppressing it safe to offer at all.
  //
  // A failed read SENDS, per part 251. A database fault must not be able to
  // swallow somebody's message with nothing anywhere to find it out from.
  try {
    const { data: quiet, error: quietErr } = await admin
      .from('notify_quiet_now')
      .select('user_id')
      .eq('user_id', recipient)
      .maybeSingle();
    // `recorded &&`, for the reason given at the inbox row above: a quiet hour
    // holds back a banner in favour of a record. With no record it would be
    // holding back the only thing there is.
    if (recorded && !quietErr && quiet) return json({ ok: true, muted: true });
  } catch { /* an hour we cannot read is not a quiet hour — fall through and send */ }
  try {
    const { data: toks } = await admin.from('push_tokens').select('token').eq('user_id', recipient);
    const tokens: string[] = (toks ?? []).map((r: any) => r.token).filter(Boolean);
    if (tokens.length) {
      const msgs = tokens.map((to) => ({ to, title, body: text, sound: 'default', data: { route } }));
      for (let i = 0; i < msgs.length; i += 100) {
        // Expo's answer, read rather than discarded. This function is called by
        // a database trigger and returns to nobody who reads it, so a refused
        // batch — a rate limit, an outage, a malformed body — used to be
        // completely invisible: the inbox row is written, the two filters above
        // report `muted: false`, and the banner simply never happens. The log
        // is the only place such a loss can be found, which is the same
        // argument the inbox-row failure above is written up under.
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(msgs.slice(i, i + 100)),
        });
        if (!res.ok) {
          console.error('notify-message: Expo refused the push to ' + recipient + ' with HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
        }
      }
    }
  } catch { /* ignore */ }

  return json({ ok: true });
});
