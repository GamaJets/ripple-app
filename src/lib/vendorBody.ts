// The pure half of reading a body measurement from a device.
//
// Split out from src/lib/wearables/body.ts for the same reason vendorSleep.ts is
// split from wearables/sleep.ts: the reader imports the provider registry, the
// Supabase client and Expo modules, none of which load under plain node — so
// anything that lives beside it cannot be tested. These two guards are exactly
// the part worth testing, so they live where a test can reach them.
import type { ProviderId } from './wearables/types';

/**
 * A figure the vendor actually holds, or null.
 *
 * Zero is not a small measurement, it is an absent one. WHOOP returns
 * weight_kilogram as null when the client has never entered it, and a zero-kilo
 * body offered as "your WHOOP weight" is worse than offering nothing, because
 * the client can act on it — the scan form would take the 0 and build a day of
 * food around it.
 */
export function bodyFigure(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One provider's answer, including the providers that could not answer.
 *
 * `status` carries the same three meanings it does for sleep, and for the same
 * reason — a screen that only receives the successes cannot tell the client
 * what it does not know:
 *
 *   ready       — we asked and got an answer (which may be all nulls: a real
 *                 answer meaning the client never told the vendor)
 *   unsupported — there was nothing to ask; this is a gap in Repple
 *   error       — we asked and did not get an answer, so it is unknown
 */
export interface BodyRead {
  provider: ProviderId;
  providerName: string;
  status: 'ready' | 'unsupported' | 'error';
  weightKg: number | null;
  heightM: number | null;
  maxHeartRate: number | null;
  reason?: string;
}

/**
 * True when this read carries a figure worth offering to anybody.
 *
 * Status alone is not enough. A 'ready' read holding three nulls is a real
 * answer — the client never told the vendor — and offering it would put a
 * prompt with no number in it in front of them. Both halves are required.
 */
export const hasBodyFigure = (r: BodyRead): boolean =>
  r.status === 'ready' && (r.weightKg != null || r.heightM != null || r.maxHeartRate != null);
