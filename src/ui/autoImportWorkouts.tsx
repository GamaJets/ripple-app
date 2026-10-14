// Workouts arrive on their own, the way sleep already does.
//
// ── what this closes ──────────────────────────────────────────────────────
//
// Reported on 14 Oct 2026, by the owner, about his own handset: "I shouldn't
// have to open Apple Health in order for the information to be pushed to the
// app." He was right, and the state of things was worse than the sentence
// suggests.
//
// Repple pulled SLEEP and RECOVERY on its own, through the tokens in
// `wearable_tokens` — 27 nights in 90 days on that account. It pulled no
// workouts from anything, ever. `src/ui/watchImport.ts` is a pull the member
// has to trigger: open the Train tab or Watch & Devices, look at a list, press
// a button. So a fortnight of Orange Theory sessions sat in Apple Health,
// `workout_logs` held nothing at all, and the app went on believing he had not
// trained since the 15th of September.
//
// That belief had teeth. src/lib/motivationNudge.ts reads the same log, so at
// 19:00 the phone said "It has been a week — Nothing logged for 17 days" to
// somebody who had cycled that morning and been to a class the week before.
// The training log is also what the coach's roster, the streak, the weekly
// report and plan-versus-actual all count, so a log nobody remembered to fill
// made the app wrong about him in six places at once.
//
// ── what it does, and what it refuses to do ───────────────────────────────
//
// On launch, and on every return to the foreground, it asks the providers the
// member has actually connected for their recent workouts and writes the ones
// that are not already in the log. Nothing else: no UI, no banner, no prompt.
//
// Every rule it applies is `watchImport.ts`'s, imported rather than restated,
// because the Train tab offers the same import and two copies of "what counts
// as already logged" is how the two come apart:
//
//   · `importSources` decides who may be asked — a provider the member
//     connected, that this build can read, whose token the server has not
//     proven dead.
//   · `isLogged` decides what is new — a remembered sample id, or an entry
//     already sitting at the same instant under the same name.
//   · `withHr` attaches the heart-rate summary, which is the whole reason the
//     owner wears a strap at Orange Theory.
//
// ── the two things it is deliberately conservative about ──────────────────
//
// MARKING. A sample id is remembered only once `logWorkouts` says 'stored'.
// The mark is permanent and it is the only record that a session was ever
// brought across, so marking against a write that has not landed would strike
// it off for good if the queue never drained. An unsent write stays unmarked
// and is offered again next time; `isLogged` already matches the queued entry
// in the log, so nothing is imported twice while it waits. This is the same
// reasoning app/(client)/workouts.tsx states at its own `markImported` call,
// and it is why that call is not simply moved here.
//
// SILENCE. A failed read says nothing to the member. This runs unprompted and
// in the background, so a banner about a device that did not answer would
// arrive with no context and nothing to do about it; the Train tab already
// prints that sentence, with the device named, on a screen the member opened
// on purpose. Failures are reported to `reportError` and left there.
//
// ── what it is NOT ────────────────────────────────────────────────────────
//
// Not a background fetch. It runs when the app is open or returning, so a
// phone left in a pocket all week still imports nothing until it is next
// unlocked. That is a smaller gap than the one it closes — the member opens
// Repple far more often than they press Import — but it is a gap, and the
// honest end of it is the same server-side pass that
// src/lib/motivationNudge.ts's header asks for.
import { useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useWearables } from './wearables';
import { useWorkoutLog } from './workoutLog';
import { useClientData } from './clientData';
import { importSources, readRecent, withHr, useImportedIds } from './watchImport';
import { autoImportPlan, mayMarkImported } from '../lib/autoImportPlan';
import { ageFromDob } from '../lib/age';
import { isWhole } from './loadStatus';
import { reportError } from '../lib/reportError';

/**
 * How far back to look.
 *
 * Fourteen days, which is the window the Train tab offers and the window the
 * owner described ("the last 2 weeks"). Longer would drag a new member's whole
 * history in on first launch without them asking for it; shorter would miss a
 * holiday.
 */
export const AUTO_IMPORT_DAYS = 14;

export function AutoImportWorkoutsProvider({ children }: { children: ReactNode }) {
  const w = useWearables();
  const { log, status, logWorkouts } = useWorkoutLog();
  const cd = useClientData();
  const { ids: importedIds, mark: markImported } = useImportedIds();

  /** One run at a time. A foreground event arriving mid-import must not start
   *  a second read of the same fortnight and race the first to the log. */
  const running = useRef(false);
  /** The log shape the last run finished against, so a re-render does not
   *  re-ask the devices for a fortnight that has not changed. */
  const lastRunFor = useRef<string | null>(null);

  const sources = importSources(w.states);
  const canImport = sources.length > 0;
  // The log's own shape, not its identity: `log` is a new array on every
  // refresh and keying on it would ask the devices again every few seconds.
  const signature = `${log.length}:${log.reduce((a, e) => Math.max(a, Date.parse(e.t) || 0), 0)}`;
  const key = `${sources.map((s) => s.meta.id).sort().join(",")}|${signature}`;

  useEffect(() => {
    if (!canImport) return;
    // The whole-read guard lives in `autoImportPlan` with a test on it, and is
    // repeated here only to avoid asking the devices for a fortnight this pass
    // is not allowed to write anyway.
    if (!isWhole(status)) return;

    let live = true;

    const run = async () => {
      if (running.current || !live) return;
      if (lastRunFor.current === key) return;
      running.current = true;
      try {
        const r = await readRecent(w.states, AUTO_IMPORT_DAYS);
        if (!live) return;
        const fresh = autoImportPlan(r.samples, status, importedIds, log);
        // Recorded even when nothing was new, so a log that has not moved does
        // not send this back to the devices on the next render.
        lastRunFor.current = key;
        if (!fresh.length) return;
        const entries = await Promise.all(fresh.map((sm) => withHr(sm, ageFromDob(cd.dob))));
        if (!live) return;
        const out = await logWorkouts(entries);
        // 'unsent' is a real outcome and deliberately not marked — see the
        // header. The rows are on the phone and go up on their own; they are
        // offered again, and `isLogged` stops them landing twice meanwhile.
        if (mayMarkImported(out)) markImported(fresh.map((sm) => sm.id));
      } catch (e) {
        // `readRecent` resolves for every provider outcome, so reaching here
        // means the read itself broke rather than a device refusing. Either
        // way the member is told nothing: this was not their gesture.
        reportError('autoImportWorkouts.run', e);
        // Deliberately NOT recorded against `key`. A run that broke has
        // established nothing, and the next foreground should try again.
      } finally {
        running.current = false;
      }
    };

    void run();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void run(); });
    return () => { live = false; sub.remove(); };
    // `importedIds` is deliberately absent: marking ids at the end of a run
    // would otherwise re-enter this effect and ask the devices again for a
    // fortnight it has just finished importing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, status, key]);

  return <>{children}</>;
}
