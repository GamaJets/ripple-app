// What the Live Today panel is allowed to say, given what is actually connected.
//
// ── The fault this replaces ────────────────────────────────────────────────
//
// `app/(client)/devices.tsx` wrote the empty state of that panel for one
// device and showed it to everybody:
//
//     note={w.today.heartRateAvg == null ? 'Wear your Apple Watch' : …}
//     note={w.today.steps == null ? 'Comes from your iPhone' : …}
//
// and closed with "Steps come from your iPhone; heart rate & calories need an
// Apple Watch (wear it)." The panel is gated only on something being connected,
// and `./registry.ts` lists Google Fit / Health Connect as a connectable
// provider reading steps, heart rate, calories, workouts and sleep. So an
// Android member with Health Connect connected, on the screen whose entire job
// is explaining what their device can do, was told to go and wear an iPhone and
// an Apple Watch they do not own. A WHOOP-only member was told the same, and
// WHOOP does not report steps at all.
//
// ── Why it is here and not in the screen ───────────────────────────────────
//
// Because it is a rule about the catalogue, and the catalogue is here. `metrics`
// on `ProviderMeta` is already the app's statement of what a device reads
// (see ./registry.ts, which is strict about that list being honest), so the
// empty state can be DERIVED from it rather than written once and outliving the
// device it was written for. Pure, so a test can ask what an Android member
// sees without an Android phone.
import type { ProviderMeta } from './types';

/** The rows the Live Today panel draws. */
export type LiveMetric = 'heartRate' | 'steps' | 'energy';

/**
 * The metric labels, lowercased, that count as this metric.
 *
 * Matched as a substring against `meta.metrics` because those are human labels
 * written per device and they differ: Apple says 'Active calories', WHOOP says
 * 'Calories', Apple also says 'Resting HR' where everything else says
 * 'Heart rate'. A registry that starts saying 'Heart Rate' or 'Daily steps'
 * still matches.
 */
const WANTS: Record<LiveMetric, readonly string[]> = {
  heartRate: ['heart rate', 'resting hr'],
  steps: ['steps'],
  energy: ['calories', 'energy'],
};

/** What the metric is called inside a sentence. Lower case: it is prose. */
const NOUN: Record<LiveMetric, string> = {
  heartRate: 'heart rate',
  steps: 'steps',
  energy: 'energy',
};

/** Whether this provider, as the catalogue describes it, reports this metric. */
export function reportsMetric(meta: ProviderMeta, metric: LiveMetric): boolean {
  const want = WANTS[metric];
  return meta.metrics.some((m) => {
    const s = m.trim().toLowerCase();
    return want.some((w) => s.includes(w));
  });
}

/** The connected providers that report this metric, in the order given. */
export function providersFor(connected: readonly ProviderMeta[], metric: LiveMetric): ProviderMeta[] {
  return connected.filter((m) => reportsMetric(m, metric));
}

/**
 * Device names as one phrase.
 *
 * No locale tag and no `Intl.ListFormat`: this is English UI copy sitting
 * inside English UI copy, and a list joined in one language inside a sentence
 * written in another is worse than either.
 */
export function namesOf(list: readonly ProviderMeta[]): string {
  const names = list.map((m) => m.name);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The note under a Live Today row whose figure has not arrived.
 *
 * Three different situations, and the old copy collapsed them into one
 * instruction about a device the member may not own:
 *
 *   · Nothing connected. The panel is gated on something being connected, so
 *     this is only reachable if that gate ever changes, and it says the plain
 *     thing rather than naming a brand.
 *   · Connected, but nothing that reports this. A WHOOP member has no step
 *     count and never will, and telling them to wear it harder is a lie about
 *     their own device. Naming the device and the gap is the answer.
 *   · Connected and it does report this, just not yet today. Then the only
 *     honest thing is that it has not come in yet, named to the device that
 *     owes it.
 */
export function awaitingNote(metric: LiveMetric, connected: readonly ProviderMeta[]): string {
  if (connected.length === 0) return `Nothing is connected yet, so no ${NOUN[metric]} is coming in.`;
  const can = providersFor(connected, metric);
  if (can.length === 0) {
    return `${namesOf(connected)} ${connected.length === 1 ? 'does' : 'do'} not report ${NOUN[metric]}.`;
  }
  return `Nothing from ${namesOf(can)} yet today.`;
}

/**
 * The footnote under the panel.
 *
 * The sentence it replaces named an iPhone and an Apple Watch unconditionally.
 * This one names whatever is actually feeding the panel, and promises only what
 * is true of all of them: it arrives on its own, and a figure appears once the
 * device has reported one.
 */
export function liveFootnote(connected: readonly ProviderMeta[]): string {
  if (connected.length === 0) return 'Nothing is connected yet, so this panel has nothing to show.';
  return `Updates on its own from ${namesOf(connected)}. Each figure appears once a device has reported it today.`;
}

/**
 * Where the member changes what this app is allowed to read.
 *
 * "Apple Health ▸ Sharing" is the right answer on iOS and no answer at all on
 * Android, where the same setting lives in Health Connect. A cloud account is a
 * third place again: nothing on the phone governs what WHOOP hands over, the
 * vendor's own account does.
 *
 * Null when nothing is connected, so a caller can render it unconditionally
 * without drawing an instruction about a permission nobody has granted.
 */
export function permissionsNote(connected: readonly ProviderMeta[], brand: string): string | null {
  if (connected.length === 0) return null;
  if (connected.some((m) => m.kind === 'healthkit')) {
    return `Manage what ${brand} can read in Apple Health ▸ Sharing ▸ ${brand}.`;
  }
  if (connected.some((m) => m.kind === 'health-connect')) {
    return `Manage what ${brand} can read in Health Connect ▸ App permissions ▸ ${brand}.`;
  }
  return `Manage what ${brand} can read in your ${namesOf(connected)} account settings.`;
}
