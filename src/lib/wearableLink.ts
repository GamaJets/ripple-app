// One answer to "is this device connected?", for every screen that asks.
//
// ── THE BUG THIS EXISTS TO END ──────────────────────────────────────────────
//
// Four TestFlight reports on build 35, all from one tester, all the same
// sentence: "Says connected on this screen. Then the next screen says needs
// reconnected. So which is it?" — and then, after doing what the app asked:
// "Reconnected whoop and it says need to connect whoop."
//
// Both screens were telling the truth. They were answering different questions
// and printing both answers with the same word.
//
//   Watch & devices asked  does this app remember you connecting WHOOP?
//                          — a flag restored from AsyncStorage on launch, with
//                          nothing behind it. It said Connected.
//   Recovery asked         did WHOOP's sleep endpoint just answer?
//                          — it had answered 403, because Repple's WHOOP OAuth
//                          request has never included the `read:sleep` scope
//                          (see wearables/oauthConfig.ts). The edge function
//                          turns 401/403 into `connected: false`, the client
//                          turned that into WearableNotConnectedError, and the
//                          screen turned THAT into "needs reconnecting".
//
// So the account was fine, the token was fine, every other WHOOP figure in the
// app was live — and one missing scope on one endpoint was being reported to
// the client as their whole device being disconnected. Reconnecting could not
// possibly fix it: the re-auth asked for the same scopes and got the same 403.
// The tester was sent round that loop four times.
//
// ── WHAT THIS FILE INSISTS ON ───────────────────────────────────────────────
//
// A stored row, a live token, and a metric this build can read are three
// different facts, and "connected" was being used for all three. They are named
// apart here, once, and both screens read their sentence off the same function:
//
//   'never'          nothing is connected, or it was disconnected.
//   'live'           connected, and the server has proven the token works.
//   'expired'        connected, and the token behind it is known dead. Only a
//                    re-authorisation fixes this.
//   'metric-blocked' connected and working — but this build cannot read the
//                    particular metric being asked about.
//   'connecting'     the OAuth handshake is in flight.
//
// Two rules follow from the reports, and both are load-bearing:
//
//   · A metric gap NEVER demotes the account. `connected` stays true for
//     'metric-blocked', because WHOOP not handing us sleep is not WHOOP being
//     disconnected, and saying so cost this tester four reports.
//   · A remembered row NEVER outranks a dead token. If the server has said the
//     token is gone, no amount of AsyncStorage makes the answer "Connected".
import type { ConnectionState } from './wearables/types';

/** The five answers. Four of them are the ones the tester met wearing one word. */
export type LinkState = 'never' | 'connecting' | 'live' | 'expired' | 'metric-blocked';

/**
 * Why a token stopped working. Each of these arrives as a distinct `reason`
 * from the `wearable-day` edge function, and they are kept apart because they
 * are not equally the person's problem: `revoked` means they (or the vendor)
 * withdrew Repple's access, while `refresh-failed` may well be our end.
 */
export type DeadReason = 'no-token' | 'expired-no-refresh' | 'refresh-failed' | 'revoked';

/**
 * The strongest thing the SERVER has demonstrated about a stored token.
 *
 * `'none'` is not a synonym for disconnected — it means nothing has been proven
 * either way yet, which is the state every provider is in on a cold launch
 * before the first sync returns. A screen must not turn it into a claim.
 */
export type TokenProof =
  | { kind: 'none' }
  | { kind: 'alive'; at: number }
  | { kind: 'dead'; at: number; why: DeadReason };

/**
 * How a single metric went on a token that is otherwise fine.
 *
 * `'refused'` is the WHOOP-sleep case: the endpoint answered 401/403 while the
 * same token was serving every other request. A re-authorisation genuinely does
 * fix it once the scope is asked for, which is why it carries an action.
 * `'absent'` is a fact about Repple, not about the vendor — there is no reader
 * in this build — and no amount of reconnecting changes it.
 */
export type MetricProof =
  | { kind: 'none' }
  | { kind: 'ok'; at: number }
  | { kind: 'refused'; at: number; scope?: string }
  | { kind: 'absent'; why: string };

/** Everything the answer depends on, passed in, so the answer is pure. */
export interface LinkFacts {
  /** The device's display name, as the person connected it ("WHOOP"). */
  providerName: string;
  /** What the app itself remembers. A flag, and nothing more — see the header. */
  remembered: ConnectionState;
  /** What the server has proven. Outranks `remembered` whenever it says dead. */
  token: TokenProof;
  /** The metric this screen is asking about, if it is asking about one. */
  metric?: { name: string; proof: MetricProof };
}

export interface LinkView {
  state: LinkState;
  /**
   * Whether there is an account-level connection at all.
   *
   * True for 'live' AND for 'metric-blocked'. That pairing is the whole fix: a
   * screen that cannot read sleep from a device must still count that device as
   * connected, or it prints the sentence that started this.
   */
  connected: boolean;
  /** The word on the badge or the button. */
  label: string;
  /** The sentence under it. Always says which of the five this is. */
  detail: string;
  /** What the person can actually do, or null when nothing they do helps. */
  action: 'connect' | 'reconnect' | null;
  /** 'warn' only for something wrong; a metric this build lacks is not wrong. */
  tone: 'ok' | 'warn' | 'muted';
}

/** Reasons the edge function sends alongside `connected: false`. */
const DEAD_REASONS: Record<string, DeadReason> = {
  expired_no_refresh_token: 'expired-no-refresh',
  refresh_failed: 'refresh-failed',
};

/** Where a `connected: false` actually lands: on the account, or on one metric. */
export interface Refusal {
  level: 'account' | 'metric';
  why: DeadReason;
}

/**
 * Read the server's refusal for what it is.
 *
 * The edge function collapses two different events into one `connected: false`:
 * a token it cannot use at all, and a vendor endpoint that said 401/403. It has
 * to — from inside a single request it cannot tell them apart either. But WE
 * can, because we know whether the SAME token has just served a different
 * request successfully.
 *
 *   no reason at all            there is no stored row. Never connected.
 *   expired_no_refresh_token    the grant ran out and nothing can renew it.
 *   refresh_failed              renewal was attempted and refused.
 *   <vendor>_unauthorized       ONE endpoint said no. If the account has been
 *                               proven alive since, this is a scope gap on that
 *                               endpoint and the account is untouched. If not,
 *                               we have no evidence the token works for
 *                               anything, and saying "connected" would be a
 *                               guess — so it counts as revoked.
 *
 * That last clause is the one that stops a missing `read:sleep` scope from
 * being reported as a disconnected WHOOP.
 */
export function classifyRefusal(reason: string | null | undefined, accountProvenAlive: boolean): Refusal {
  const r = (reason ?? '').trim();
  if (!r) return { level: 'account', why: 'no-token' };
  const known = DEAD_REASONS[r];
  if (known) return { level: 'account', why: known };
  if (/_unauthorized$/.test(r)) {
    return accountProvenAlive
      ? { level: 'metric', why: 'revoked' }
      : { level: 'account', why: 'revoked' };
  }
  // An unrecognised reason is not evidence of a live connection, and inventing
  // one here is how the next version of this bug gets written. Treated as a
  // dead token, which at worst offers a reconnect that was not needed — the
  // cheap direction of the two.
  return { level: 'account', why: 'revoked' };
}

/** The re-authorisation sentence, which never claims the person is signed out. */
function deadSentence(name: string, why: DeadReason): string {
  switch (why) {
    case 'expired-no-refresh':
      return `${name} is still set up here, but the sign-in expired and ${name} issued nothing to renew it with. Reconnect and it picks up where it left off — nothing you have recorded is lost.`;
    case 'refresh-failed':
      return `${name} is still set up here, but Repple could not renew its sign-in. Reconnect to fix it — nothing you have recorded is lost.`;
    default:
      return `${name} is still set up here, but ${name} is no longer accepting Repple's sign-in. Reconnect to fix it — nothing you have recorded is lost.`;
  }
}

/**
 * The one answer. Both screens call this; neither decides anything itself.
 *
 * The order of the tests below IS the fix, so it is worth reading as an order:
 * a dead token is checked BEFORE the remembered flag, so a row on its own can
 * never produce the word "Connected"; and the metric is checked LAST, after the
 * account has already been found sound, so it can only ever narrow the sentence
 * and never contradict it.
 */
export function describeLink(f: LinkFacts): LinkView {
  const name = f.providerName;

  if (f.remembered === 'connecting') {
    return { state: 'connecting', connected: false, label: 'Connecting…', detail: `Waiting for ${name} to finish signing you in.`, action: null, tone: 'muted' };
  }

  // Before the remembered flag, deliberately. "Never claim connected on the
  // strength of a row existing if the token behind it is known dead."
  if (f.token.kind === 'dead') {
    if (f.token.why === 'no-token') {
      return { state: 'never', connected: false, label: 'Connect', detail: `${name} is not connected. Sign in once and your days sync on their own.`, action: 'connect', tone: 'muted' };
    }
    return { state: 'expired', connected: false, label: 'Reconnect', detail: deadSentence(name, f.token.why), action: 'reconnect', tone: 'warn' };
  }

  if (f.remembered !== 'connected') {
    return { state: 'never', connected: false, label: 'Connect', detail: `${name} is not connected. Sign in once and your days sync on their own.`, action: 'connect', tone: 'muted' };
  }

  // From here the account is sound, and nothing below may take that away.
  const m = f.metric;
  if (m && m.proof.kind === 'refused') {
    return {
      state: 'metric-blocked',
      connected: true,
      label: 'Connected',
      // Says connected first, on purpose. The complaint was a working device
      // being described as a broken one because one endpoint was shut.
      detail: `${name} is connected and working. It will not give Repple your ${m.name} yet — Repple did not ask ${name} for permission to read it when you signed in. Reconnect ${name} to grant it; everything else keeps working either way.`,
      action: 'reconnect',
      tone: 'warn',
    };
  }
  if (m && m.proof.kind === 'absent') {
    return {
      state: 'metric-blocked',
      connected: true,
      label: 'Connected',
      // Muted, and no action: this is a gap in Repple, and offering a reconnect
      // would send somebody round a loop that cannot end — which is precisely
      // what this tester was sent round.
      detail: `${name} is connected and working. ${m.proof.why}`,
      action: null,
      tone: 'muted',
    };
  }

  return { state: 'live', connected: true, label: 'Connected', detail: `${name} is connected and Repple is reading it.`, action: null, tone: 'ok' };
}

/**
 * The account-level answer on its own, for callers that only need the flag.
 *
 * Kept as a call through `describeLink` rather than a second implementation:
 * two functions answering "is it connected" is the shape the bug had.
 */
export function isLinked(f: LinkFacts): boolean {
  return describeLink(f).connected;
}
