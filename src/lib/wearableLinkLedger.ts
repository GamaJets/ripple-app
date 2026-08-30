// What the SERVER has actually proven about each device, in one place.
//
// `src/lib/wearableLink.ts` decides what a connection state means. This holds
// the evidence that decision is made from, and it lives outside React state on
// purpose, for two reasons the reports demanded:
//
//   1. THE TWO SCREENS MUST NOT HOLD SEPARATE OPINIONS. Watch & devices and
//      Recovery each ran their own read and each kept its own conclusion in
//      component state, so one could be showing a verdict the other had already
//      superseded. The evidence is written here, by the layer that talks to the
//      server (`wearables/oauth.ts`), and both screens derive from the same copy.
//
//   2. RECONNECTING HAD TO VISIBLY RESOLVE. It did not. Recovery re-read sleep
//      in an effect keyed on WHICH providers were connected — and reconnecting
//      an already-connected WHOOP does not change that key, so the stale
//      "needs reconnecting" sentence survived the very act that fixed it, until
//      the app was relaunched. That is the third of the four reports:
//      "Reconnected whoop and it says need to connect whoop." `noteReauthorised`
//      bumps a revision that both screens subscribe to, so the re-auth clears
//      the verdict AND makes every screen ask again.
//
// Deliberately not persisted. Every verdict here is a claim about a token as of
// a moment, and a claim from a previous launch is not evidence about this one —
// restoring "dead" from disk is how the app would tell somebody to reconnect a
// device that has been working since. Absent is the honest starting position:
// `{ kind: 'none' }` means nothing has been proven either way, which is exactly
// true on a cold launch.
import { useSyncExternalStore } from 'react';
import { describeLink, type DeadReason, type LinkView, type MetricProof, type TokenProof } from './wearableLink';
import type { ConnectionState, ProviderId } from './wearables/types';

interface Entry {
  token: TokenProof;
  /** Keyed by metric name ('sleep'), because a device can be fine for one and not another. */
  metrics: Record<string, MetricProof>;
}

const UNPROVEN: Entry = { token: { kind: 'none' }, metrics: {} };

const ledger = new Map<string, Entry>();
const listeners = new Set<() => void>();
let revision = 0;

function entry(id: string): Entry {
  return ledger.get(id) ?? UNPROVEN;
}

function commit(id: string, next: Entry): void {
  ledger.set(id, next);
  revision += 1;
  // A listener that throws must not stop the others hearing about a re-auth —
  // a half-notified app is how the two screens diverge again.
  for (const fn of [...listeners]) { try { fn(); } catch { /* a screen's own problem */ } }
}

/** The server used this token successfully. The strongest evidence there is. */
export function noteTokenAlive(id: ProviderId, at: number = Date.now()): void {
  const e = entry(id);
  if (e.token.kind === 'alive') return; // nothing changed; do not wake every screen
  commit(id, { token: { kind: 'alive', at }, metrics: e.metrics });
}

/** The server could not use this token at all. */
export function noteTokenDead(id: ProviderId, why: DeadReason, at: number = Date.now()): void {
  const e = entry(id);
  if (e.token.kind === 'dead' && e.token.why === why) return;
  commit(id, { token: { kind: 'dead', at, why }, metrics: e.metrics });
}

/**
 * How one metric went, on a token that is not itself in doubt.
 *
 * Recording a metric NEVER touches the token verdict. That separation is the
 * fix: it is the one place where a sleep endpoint saying no could otherwise
 * leak upwards into "your WHOOP is disconnected".
 */
export function noteMetric(id: ProviderId, metric: string, proof: MetricProof): void {
  const e = entry(id);
  const was = e.metrics[metric];
  if (was && was.kind === proof.kind) return;
  commit(id, { token: e.token, metrics: { ...e.metrics, [metric]: proof } });
}

/**
 * A re-authorisation just succeeded. Forget everything we thought we knew.
 *
 * Every verdict in here was about the token that has just been replaced, so
 * keeping any of it would let a dead-token or refused-scope sentence outlive
 * the thing it described — which is the "reconnected and it still says
 * reconnect" report, exactly. Cleared to 'none' rather than set to 'alive':
 * the handshake proves the vendor signed the person in, not that our server can
 * read them, and the next sync is what proves that.
 */
export function noteReauthorised(id: ProviderId): void {
  commit(id, { token: { kind: 'none' }, metrics: {} });
}

/** Forget a device entirely, on an explicit disconnect. */
export function forgetLink(id: ProviderId): void {
  commit(id, { token: { kind: 'none' }, metrics: {} });
}

/** What the server has proven about this device's token. Never null. */
export function tokenProof(id: ProviderId): TokenProof {
  return entry(id).token;
}

/** Whether a non-metric request has succeeded on this token — the evidence
 *  `classifyRefusal` needs to tell a scope gap from a dead account apart. */
export function accountProvenAlive(id: ProviderId): boolean {
  return entry(id).token.kind === 'alive';
}

/** How this device's `metric` last went. `{ kind: 'none' }` when nobody has asked. */
export function metricProof(id: ProviderId, metric: string): MetricProof {
  return entry(id).metrics[metric] ?? { kind: 'none' };
}

/**
 * The connection answer for one device, evidence and all. THE call site.
 *
 * Every screen, and the sleep reader itself, goes through this — which is the
 * point of the whole exercise. Two screens asking two different questions and
 * printing both answers as "connected" is what generated four TestFlight
 * reports; there is now one question, asked in one place, and the only thing a
 * caller varies is whether it is also asking about a metric.
 *
 * `remembered` still comes from the wearables context, because that is where
 * the app's own memory of the connection lives. It is an input to the answer,
 * not the answer.
 */
export function linkFor(
  id: ProviderId,
  providerName: string,
  remembered: ConnectionState,
  metric?: string,
): LinkView {
  return describeLink({
    providerName,
    remembered,
    token: tokenProof(id),
    metric: metric ? { name: metric, proof: metricProof(id, metric) } : undefined,
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const snapshot = () => revision;

/**
 * Re-render, and re-read, whenever any verdict changes.
 *
 * Screens use the returned number as an effect dependency as well as a render
 * trigger — that is what makes a reconnect on Watch & devices re-run Recovery's
 * sleep read, rather than leaving it pinned to a key that a re-auth cannot move.
 */
export function useLinkRevision(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
