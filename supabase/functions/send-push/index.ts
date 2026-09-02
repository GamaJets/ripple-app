// Supabase Edge Function: send-push
// Delivers an Expo push notification to one or more users. Reads their tokens
// from push_tokens (service role, bypassing RLS) and posts to Expo's push API.
// Deploy: supabase functions deploy send-push
// Request JSON: { user_ids: string[], title: string, body: string, data?: object, channel?: string }
// Response JSON: { sent: number, muted?: number }
//
// ── `channel`, and why the filter is HERE ─────────────────────────────────
//
// A coach who muted notifications to stop 11pm chat pings also stopped hearing
// that a client's card had been declined, because the only control that existed
// was the master switch — and the master switch works by taking a handset's row
// OUT of push_tokens, which is all-or-nothing by construction.
//
// `notify_channel_prefs` (see the SQL part of the same name) holds a per-channel
// answer, and it is applied at this function rather than at the two dozen
// sendPush() call sites for exactly the reason the master switch is applied at
// the token: a call-site check is a check somebody forgets at the next call
// site, and the next one is always the one that matters.
//
// Three properties of the filter, and all three are deliberate:
//
//   · `channel` is OPTIONAL. A send with no channel is not filtered at all.
//     Every existing caller keeps working unchanged and nothing is silently
//     suppressed by a preference nobody could have been shown a switch for.
//   · ONLY an explicit `enabled = false` row suppresses. No row is not an
//     answer, and the product default is on — the same default the switch on
//     the settings screen shows, because a screen showing a switch on while
//     this function suppressed the push would be the original bug pointing the
//     other way.
//   · A FAILED read of the preferences sends. The alternative is that a
//     transient database error silently swallows a coach's notification that a
//     subscription payment failed, and there would be nothing anywhere to find
//     that out from. Erring towards the notification is the recoverable error.
//
// It suppresses the PUSH and nothing else. The inbox row is written by
// notify_users() before this function is ever called, so a muted channel still
// appears in the notifications list — muting is "do not buzz me about this",
// not "do not tell me".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let user_ids: string[] = [], title = '', body = '', data: Record<string, unknown> = {};
  let channel = '';
  try {
    const b = await req.json();
    user_ids = Array.isArray(b.user_ids) ? b.user_ids : [];
    title = String(b.title || 'Repple');
    body = String(b.body || '');
    data = b.data || {};
    channel = typeof b.channel === 'string' ? b.channel.trim() : '';
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!user_ids.length) return json({ error: 'user_ids required' }, 400);

  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ── the per-channel preference ──────────────────────────────────────
    //
    // Recipients who have explicitly turned this channel off are dropped
    // BEFORE the tokens are read, so a muted coach with three handsets costs
    // one query rather than three rows of work.
    //
    // The read failing is not a mute. `error` here means the preferences could
    // not be read, and suppressing on that would swallow a coach's "a
    // subscription payment failed" notification on the strength of a transient
    // fault, with nothing anywhere to find it out from.
    let recipients = user_ids;
    let muted = 0;
    if (channel) {
      const { data: prefs, error: prefErr } = await supa
        .from('notify_channel_prefs')
        .select('user_id')
        .in('user_id', user_ids)
        .eq('channel', channel)
        .eq('enabled', false);
      if (!prefErr && prefs) {
        const off = new Set((prefs as { user_id: string }[]).map((r) => r.user_id));
        if (off.size) {
          recipients = user_ids.filter((id) => !off.has(id));
          muted = user_ids.length - recipients.length;
        }
      }
    }

    // ── Quiet hours (part 530) ────────────────────────────────────────────
    //
    // Composed AFTER the channel filter and against `recipients`, not
    // `user_ids`, so the two compose rather than the second undoing the first.
    //
    // The hour arithmetic is the view's, not this function's, and deliberately:
    // `new Date().getHours()` here is the hour in whatever zone the edge
    // runtime happens to be in, which is the one hour certain to be wrong for
    // every recipient. `notify_quiet_now` resolves each person's window in
    // their OWN stored zone, so a coach in Dubai and a coach in Los Angeles are
    // both quiet at eleven at night rather than both quiet at eleven UTC.
    //
    // Unlike the channel filter this needs no `channel` guard: quiet hours are
    // a statement about the hour, not about the kind of message.
    //
    // `!quietErr` is part 251's rule and it is not an oversight: a failed read
    // of this table SENDS. A database fault must not be able to swallow the
    // notification that somebody's payment failed, because there would be
    // nothing anywhere to discover that from afterwards.
    if (recipients.length) {
      const { data: quiet, error: quietErr } = await supa
        .from('notify_quiet_now').select('user_id').in('user_id', recipients);
      if (!quietErr && quiet) {
        const asleep = new Set((quiet as { user_id: string }[]).map((r) => r.user_id));
        if (asleep.size) {
          const before = recipients.length;
          recipients = recipients.filter((id) => !asleep.has(id));
          muted += before - recipients.length;
        }
      }
    }

    if (!recipients.length) return json({ sent: 0, muted });

    const { data: rows } = await supa.from('push_tokens').select('token').in('user_id', recipients);
    const tokens: string[] = (rows ?? []).map((r: any) => r.token).filter(Boolean);
    if (!tokens.length) return json({ sent: 0, muted });
    const messages = tokens.map((to) => ({ to, title, body, sound: 'default', data }));
    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    }
    return json({ sent: tokens.length, muted });
  } catch (e) {
    return json({ error: 'send failed', detail: String(e) }, 500);
  }
});
