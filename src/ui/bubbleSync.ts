import { deliveryOf, type SendStage } from '../lib/readReceipt';
import type { SyncState } from './kit';

/**
 * Rule 6: the SyncBadge state for one of the reader's own bubbles, or null for
 * a bubble the server has (sent / read) and for the other person's — confirmed
 * rows carry no badge. Decided by `deliveryOf`, the same rule the receipt line
 * uses, so the badge and its words can never disagree. In-flight reads as
 * 'queued' (neutral tone) because the words beside it say "Sending…".
 */
export function bubbleSync(m: { id: string; sending: boolean; createdAt: string }, mine: boolean, stage: SendStage | undefined): SyncState | null {
  const d = deliveryOf({ id: m.id, mine, sending: m.sending, stage, createdAt: m.createdAt, kind: null }, null);
  return d === 'failed' ? 'failed' : d === 'queued' || d === 'sending' ? 'queued' : null;
}
