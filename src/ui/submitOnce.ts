// The React half of src/lib/submitOnce.ts, which holds every opinion and has a
// test. What is here is the two things that cannot be tested under node: the
// ref that survives a re-render, and the state that redraws the button.
//
// Read src/lib/submitOnce.ts first. In short: a `<Cta onPress={submit} />` over
// an async submit looks identical before and during the write, so a member who
// thinks the tap did not register taps again — and the second tap files a
// second check-in, or a second set of measurement rows that nobody can then see
// or delete.
//
// ── Why the gate is built in a ref and not rebuilt per render ─────────────
//
// Because a gate that is recreated on every render is not a gate. `running`
// lives inside the closure `makeSubmitGate` returns, so a fresh one on each
// render starts open — and a re-render is exactly what `setBusy(true)` causes.
// One instance, made once, held across every render of the screen.
import { useRef, useState } from 'react';
import { makeSubmitGate, type SubmitGate } from '../lib/submitOnce';
import { reportError } from '../lib/reportError';

export interface Submitter {
  /** Hand this to the button's `onPress`. */
  run: (job: () => void | Promise<unknown>) => void;
  /** True while the write is in flight. Drives `disabled` and the label. */
  busy: boolean;
}

/**
 * A submit that cannot be entered twice.
 *
 *   const send = useSubmitOnce('checkin.submit');
 *   …
 *   <Cta label={send.busy ? 'Sending…' : 'Send Check-in'}
 *        disabled={send.busy} onPress={() => send.run(submit)} wide />
 *
 * The label matters as much as the guard. A button that is merely disabled
 * reads as broken; one that says what it is doing is the reason the member does
 * not reach for it a second time.
 *
 * @param where a tag for `reportError`, so an unexpected throw out of a submit
 *              is attributed to the screen it came from.
 */
export function useSubmitOnce(where: string): Submitter {
  const [busy, setBusy] = useState(false);
  const gate = useRef<SubmitGate | null>(null);
  if (!gate.current) {
    gate.current = makeSubmitGate({
      setBusy,
      // Swallowed at the gate and reported here. A throw out of a gesture
      // handler takes the screen down over a failure the screen is written to
      // survive, and every write in this app reports its own outcome rather
      // than throwing it — so anything arriving here is a bug, not a sentence.
      onError: (e) => reportError(where, e),
    });
  }
  return { run: (job) => { void gate.current!.run(job); }, busy };
}
