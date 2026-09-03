// Supabase Edge Function: send-push
// Delivers an Expo push notification to one or more users. Reads their tokens
// from push_tokens (service role, bypassing RLS) and posts to Expo's push API.
// Deploy: supabase functions deploy send-push
// Request JSON: { user_ids: string[], title: string, body: string, data?: object, channel?: string }
// Response JSON: { sent: number, muted?: number, partial?: true }
//   `partial` is present only when a database read failed partway through the
//   recipient list, so `sent` is a floor rather than the total. Absent means
//   the whole list was read.
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
//
// ── WHO MAY MAKE SOMEBODY ELSE'S PHONE BUZZ ───────────────────────────────
//
// A signed-in person. This function checked NOTHING, and it is the widest of
// the three that did: it runs as the SERVICE ROLE, which RLS does not apply
// to, and every interesting value arrives in the body — `user_ids`, `title`,
// `body` and a `data` payload the app uses to decide which screen a tap opens.
//
// `verify_jwt` at the platform gate is not the check it is mistaken for. It
// verifies the bearer token was signed by this project, and the project's ANON
// KEY is such a token: public by design, inlined into the app bundle. The
// argument is set out in full in supabase/functions/wearable-oauth, where the
// same misreading let anybody overwrite anybody's WHOOP credential.
//
// So, before this, a stranger holding a string out of the app bundle could
// send any Repple user a notification saying anything, carrying any route:
// "Your payment failed — tap to fix it", opening whichever screen they chose.
// A push notification is trusted precisely because it comes from the app.
//
// ── AND WHAT THIS CHECK DELIBERATELY DOES NOT DO ──────────────────────────
//
// It does not decide WHO MAY PUSH WHOM, and that is a limit rather than an
// oversight. The legitimate senders in this repo do not share one relationship:
// a coach pushes their clients, a client pushes their coach, an owner pushes
// every member of their gym, a trainer pushes a class's attendees — and
// app/(client)/trainers.tsx and app/(client)/request-session.tsx push a coach
// the sender is NOT yet a client of, which is the whole point of those screens.
// A relationship test drawn tight enough to be worth having would silently stop
// one of those, and a notification that silently does not arrive is the exact
// failure part 251 and part 530 were both written about.
//
// What is left, therefore: a signed-in Repple user can still address a push to
// another user's id. That is worth naming rather than implying it is closed —
// and the sender is now logged with it, which is the difference between an
// abuse that can be traced and one that cannot.
//
// The rule itself is mirrored, and under test, in src/lib/pushSender.ts. It is
// stated there rather than only here because the way to get it wrong is
// invisible from inside this file: refusing the project's own service role
// silences all twenty-six server-written notification kinds and reports
// nothing, because the dispatcher that calls this is fire-and-forget and
// swallows its own errors on purpose.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── A recipient list longer than one PostgREST page ────────────────────────
//
// Every read below was `.in('user_id', user_ids)` with no bound on it, and two
// separate ceilings sat on that:
//
//   THE ROW CAP. PostgREST truncates every response at the project's "Max rows"
//   setting, which Supabase ships at 1000, and it does it silently — no error,
//   no flag. `push_tokens` holds a row per HANDSET, so a gym of four hundred
//   members with a phone and a tablet each is already past it. The function
//   then pushed to the first thousand tokens, returned `sent: 1000`, and the
//   announcement screen said it had gone out. Half the gym never heard about
//   the class that moved. It gets worse as the gym grows and it never announces
//   itself, which is the same defect owner-metrics' `pageAll` was written for.
//
//   THE URL LENGTH. A few thousand uuids in a query string is a request
//   PostgREST rejects outright, which on the preference reads would have been
//   read as "nobody has muted this" and on the token read as "nobody to send
//   to" — a silent total failure rather than a silent partial one.
//
// So the ids are chunked and each chunk is paged. CHUNK is small enough that
// the URL is never in question; PAGE is PostgREST's own page size, and a short
// page means the last one.
const CHUNK = 200;
const PAGE = 1000;

/**
 * Every row matching `build` for every id, chunked and paged.
 *
 * An error is reported rather than thrown because both filter callers below
 * treat a failed read as "send anyway" (part 251) — a database fault must not
 * be able to swallow the notification that somebody's payment failed.
 * `partial` says a chunk failed or ran off the page ceiling, so a caller that
 * is COUNTING rather than filtering can tell a complete answer from an
 * incomplete one instead of publishing a floor as a total.
 */
async function readAllFor<T>(
  ids: string[],
  build: (batch: string[], from: number, to: number) => any,
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  let partial = false;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    // Twenty pages is a stop, not a limit anybody should reach: CHUNK is 200
    // ids and a person does not own five thousand handsets. It is here because
    // a loop with no ceiling inside an edge function is one strange response
    // away from running until the runtime kills it. Reaching it sets `partial`
    // rather than returning quietly, so the ceiling can never masquerade as a
    // complete read — which is the whole defect this helper exists to fix.
    let reached = false;
    for (let page = 0; page < 20; page++) {
      const from = page * PAGE;
      const { data, error } = await build(batch, from, from + PAGE - 1);
      if (error) { partial = true; reached = true; break; }
      const got = (data ?? []) as T[];
      rows.push(...got);
      if (got.length < PAGE) { reached = true; break; }
    }
    if (!reached) partial = true;
  }
  return { rows, partial };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // ── who is asking ───────────────────────────────────────────────────────
  //
  // From the JWT alone, and checked BEFORE the body is read, so an
  // unauthenticated caller cannot even get this function to look at a
  // recipient list. `getUser` RESOLVES with a null user for a token it cannot
  // turn into a person rather than throwing — which is what the anon key does
  // — so the answer is checked, not the call merely wrapped.
  //
  // ── AND THE SERVER IS NOT A PERSON ──────────────────────────────────────
  //
  // The check above, written on its own, would have switched off every
  // server-side notification in this product the moment it was deployed.
  //
  // `notifications_dispatch_push` (supabase/parts/900) is what turns a written
  // notification into a push, and it posts here with
  // `Authorization: Bearer ' || v_key` where `v_key` is the Vault secret
  // `storage_service_key`. That secret is the project's SERVICE ROLE key: its
  // claims are `{"role":"service_role"}` and it carries no `sub`, because it
  // names a role rather than a person. `auth.getUser()` on it therefore
  // resolves with no user — exactly as it does for the anon key, which is the
  // case the check was written for — and this function would answer 401.
  //
  // Nothing would have reported that. `net.http_post` is fire-and-forget, the
  // dispatcher is `exception when others then return null` on purpose, and no
  // screen reads either. All twenty-eight server-written kinds — a subscription
  // payment failing, a chargeback and its deadline, an intake coming back, an
  // insurance certificate lapsing, an invoice ageing, a client gone quiet —
  // would simply have stopped arriving, silently, and the inbox rows would have
  // gone on being written so nothing would look broken.
  //
  // So the service role is recognised as a caller in its own right. It is not
  // a hole in the check: `verify_jwt` is true on this function, so the platform
  // has already established the bearer was signed by this project, and this
  // compares the token to the service key THIS FUNCTION holds in its own
  // environment. Nothing a client can obtain matches it — the anon key is
  // public and is not this value — and a bearer that is neither a person nor
  // the server is still refused.
  //
  // `senderId` becomes 'server' rather than a uuid, which is what the fan-out
  // log below should say: a broadcast attributable to the dispatcher is
  // attributable to whatever wrote the row, and the row is the record.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  let senderId = '';
  if (serviceKey && bearer === serviceKey) {
    senderId = 'server';
  } else {
    try {
      const { data: who } = await supa.auth.getUser(bearer);
      senderId = who?.user?.id || '';
    } catch { /* stays empty, and the refusal below is the answer */ }
  }
  if (!senderId) return json({ error: 'Sign in to Repple to send a notification.' }, 401);

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

  // A fan-out worth a line in the log, with the person who asked for it. The
  // legitimate ones are real — a gym announcement reaches every member — so
  // this is a record and not a limit. It is the only place a broadcast is
  // attributable to anybody: the recipients are named in the body and the
  // sender is named nowhere else. The recipients are NOT logged; a log is not
  // a place to write down who was told what.
  if (user_ids.length > 50) {
    console.log('send-push: ' + senderId + ' is pushing ' + user_ids.length + ' recipients' + (channel ? ' on channel ' + channel : ''));
  }

  try {
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
      const { rows: prefs } = await readAllFor<{ user_id: string }>(user_ids, (batch, from, to) => supa
        .from('notify_channel_prefs')
        .select('user_id')
        .in('user_id', batch)
        .eq('channel', channel)
        .eq('enabled', false)
        .range(from, to));
      const off = new Set(prefs.map((r) => r.user_id));
      if (off.size) {
        recipients = user_ids.filter((id) => !off.has(id));
        muted = user_ids.length - recipients.length;
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
      const { rows: quiet } = await readAllFor<{ user_id: string }>(recipients, (batch, from, to) => supa
        .from('notify_quiet_now').select('user_id').in('user_id', batch).range(from, to));
      const asleep = new Set(quiet.map((r) => r.user_id));
      if (asleep.size) {
        const before = recipients.length;
        recipients = recipients.filter((id) => !asleep.has(id));
        muted += before - recipients.length;
      }
    }

    if (!recipients.length) return json({ sent: 0, muted });

    // Every handset, not the first page of them. `partial` is reported rather
    // than swallowed: a caller about to tell somebody "your announcement has
    // gone out" needs to know when it only partly did, and `sent` alone cannot
    // say so — a short list and a truncated one are the same number.
    const { rows: tokenRows, partial } = await readAllFor<{ token: string }>(recipients, (batch, from, to) =>
      supa.from('push_tokens').select('token').in('user_id', batch).range(from, to));
    const tokens: string[] = tokenRows.map((r) => r.token).filter(Boolean);
    if (!tokens.length) return json({ sent: 0, muted, ...(partial ? { partial: true } : {}) });
    const messages = tokens.map((to) => ({ to, title, body, sound: 'default', data }));
    // Expo accepts up to 100 messages per request.
    //
    // ── the answer, which was thrown away ─────────────────────────────────
    //
    // `await fetch(...)` with nothing read off it. Expo's refusal of a whole
    // batch — a malformed body, a rate limit, an outage — arrives as a non-2xx
    // and went nowhere, so `sent` below counted handsets this function had
    // ATTEMPTED rather than ones Expo accepted, and a total delivery failure
    // was indistinguishable from a working night.
    //
    // `sent` is NOT changed to count acceptances, deliberately. Expo's own
    // contract is that a 200 means the tickets were accepted, not that the
    // notifications arrived — the receipt is a separate fetch, minutes later,
    // and nothing here polls for it. Recomputing `sent` from tickets would
    // trade one number that overstates delivery for another that also does,
    // while changing what every caller's `ok` has meant. src/ui/
    // pushNotifications.ts says the same thing about `ok` in its own header.
    //
    // So what is added is the log line, which is the thing that was missing:
    // an outage is now findable instead of silent.
    for (let i = 0; i < messages.length; i += 100) {
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages.slice(i, i + 100)),
        });
        if (!res.ok) {
          console.error('send-push: Expo refused a batch of ' + Math.min(100, messages.length - i)
            + ' from ' + senderId + ' with HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
        }
      } catch (e) {
        // One unreachable batch is not a reason to abandon the rest of a gym.
        console.error('send-push: could not reach Expo for a batch from ' + senderId + ':', (e as Error).message);
      }
    }
    return json({ sent: tokens.length, muted, ...(partial ? { partial: true } : {}) });
  } catch (e) {
    return json({ error: 'send failed', detail: String(e) }, 500);
  }
});
