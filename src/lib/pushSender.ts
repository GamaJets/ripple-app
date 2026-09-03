// Who may make somebody else's phone buzz.
//
// ── Why this rule is written down away from the function that applies it ──
//
// supabase/functions/send-push runs as the service role, RLS does not apply to
// it, and every interesting value arrives in the body — `user_ids`, `title`,
// `body`, and a `data.route` the app uses to decide which screen a tap opens.
// It checked nothing at all until recently, and `verify_jwt` at the platform
// gate is not the check it is mistaken for: it establishes that the bearer was
// signed by this project, and the project's ANON KEY is such a token, public by
// design and inlined into the app bundle.
//
// The check that closed that has two callers and they are not alike, which is
// the whole reason this is a module:
//
//   A PERSON. A signed-in Repple user, whose id `auth.getUser()` resolves from
//   the bearer. This is every handset send — a coach booking a session, a
//   client messaging their coach, an owner announcing a closure.
//
//   THE SERVER. `notifications_dispatch_push` in supabase/parts/900, which
//   posts here with the Vault secret `storage_service_key` in the Authorization
//   header. That secret is the project's SERVICE ROLE key: its claims are
//   `{"role":"service_role"}` and it carries NO `sub`, because it names a role
//   rather than a person.
//
// ── The landmine this exists to keep defused ──────────────────────────────
//
// `auth.getUser()` on a service role key resolves with no user — the same
// answer it gives for the anon key, which is the case the check was written
// for. So a sender check that only asks "is this a person" answers 401 to the
// dispatcher, and answering 401 to the dispatcher switches off EVERY
// server-side notification in the product: all twenty-eight kinds catalogued in
// `SERVER_WRITTEN` — a subscription payment failing, a chargeback and its
// deadline, an intake coming back, an insurance certificate lapsing, an invoice
// ageing, a client gone quiet.
//
// And nothing would say so. `net.http_post` is fire-and-forget, the dispatcher
// is `exception when others then return null` deliberately, and no screen reads
// either. The inbox rows would go on being written, so the app would look
// entirely healthy while it stopped reaching anybody who was not looking at it.
//
// That is the failure mode this whole surface is most vulnerable to and least
// able to notice, so the rule is stated here, under test, rather than living
// only in a Deno file nothing can run.
//
// ── What this deliberately does NOT decide ────────────────────────────────
//
// WHO MAY PUSH WHOM. The legitimate senders do not share one relationship: a
// coach pushes their clients, a client pushes their coach, an owner pushes
// every member of their gym, and app/(client)/trainers.tsx pushes a coach the
// sender is not yet a client of, which is the point of that screen. A
// relationship test drawn tight enough to be worth having would silently stop
// one of those. A signed-in Repple user can still address a push to another
// user's id; what this settles is that a bearer which is neither a person nor
// this project's own server is refused, and that the sender is named in the
// log either way.
//
// Pure. The mirror is the `who is asking` block at the top of
// supabase/functions/send-push/index.ts.

/** Who a bearer turns out to be. */
export interface PushSender {
  /**
   * The sender, or '' for nobody.
   *
   * A uuid for a person, and the literal 'server' for this project's own
   * dispatcher. Not a uuid in the second case and deliberately so: the
   * dispatcher acts for whatever trigger or nightly pass wrote the row, and
   * inventing a uuid for it would put a person's id on a send no person made.
   */
  senderId: string;
  /** Whether the send may proceed at all. */
  allowed: boolean;
  /** Which of the two it was, for the log and for the test. */
  kind: 'person' | 'server' | 'nobody';
}

/**
 * The rule.
 *
 * `bearer` is the Authorization header with 'Bearer ' already taken off.
 * `serviceKey` is this function's OWN `SUPABASE_SERVICE_ROLE_KEY`, from its
 * environment — not a value from the request, and not a claim decoded out of
 * the token, because an unverified payload is the caller's assertion about
 * itself. `userId` is what `auth.getUser(bearer)` resolved, or null.
 *
 * The service check comes FIRST and short-circuits, so a service-role bearer
 * never reaches `getUser` — one fewer round trip on the path every nightly
 * pass takes, and it removes any question of what `getUser` might one day
 * decide to return for a subject-less token.
 *
 * An empty `serviceKey` never matches. A missing environment variable must not
 * turn an empty Authorization header into the server.
 */
export function pushSender(
  bearer: string | null | undefined,
  serviceKey: string | null | undefined,
  userId: string | null | undefined,
): PushSender {
  const b = (bearer ?? '').trim();
  const k = (serviceKey ?? '').trim();
  if (k && b && b === k) return { senderId: 'server', allowed: true, kind: 'server' };
  const u = (userId ?? '').trim();
  if (u) return { senderId: u, allowed: true, kind: 'person' };
  return { senderId: '', allowed: false, kind: 'nobody' };
}

/** What a refused caller is told. Says what to do rather than what happened:
 *  the only person who ever sees it is somebody whose session has expired. */
export const PUSH_SENDER_REFUSED = 'Sign in to Repple to send a notification.';

/**
 * How many recipients make a send worth a line in the log.
 *
 * A fan-out is a real thing this product does — a gym announcement reaches
 * every member — so this is a record and not a limit. It is the only place a
 * broadcast is attributable to anybody: the recipients are named in the body of
 * the request and the sender is named nowhere else.
 *
 * The RECIPIENTS are never logged. A log is not a place to write down who was
 * told what.
 */
export const PUSH_FANOUT_LOG_AT = 50;

/** Whether this send is one. */
export function logFanout(recipients: number): boolean {
  return Number.isFinite(recipients) && recipients > PUSH_FANOUT_LOG_AT;
}
