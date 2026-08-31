// A coach asking their client to record an injury the coach heard about in
// person.
//
// Why this exists rather than a field the coach types into:
//
// A client's injuries are theirs. A coach cannot add, change or remove one —
// enforced in the database by `clients_injuries_guard`, not merely by the app
// not offering it — because the acknowledgement gate is built on the disclosure
// being the client's own, and a gate the constrained party can edit their way
// out of is not a gate. A coach who could type "knee, mild" could also type it
// away.
//
// But a coach genuinely does learn about injuries out loud, standing next to
// somebody, and had nowhere to put that. So the coach does not record it; they
// ask, and the client records it. The disclosure still comes from the person
// whose knee it is, and the gate still means what it says.
//
// Two writes, reported separately. The message is the durable half — it sits in
// their thread whether or not a notification is delivered — so a failed push is
// worth telling the coach about without calling the whole thing a failure.
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { areaLabel } from '../lib/injuries';
import { sendPushChecked } from './pushNotifications';

export interface AskResult {
  /** The message reached their thread. Nothing else here matters if this is false. */
  sent: boolean;
  /** They were notified. False with `sent` true means it is waiting to be seen. */
  pushed: boolean;
  /** Present only when `sent` is false, and written for the coach to act on. */
  error?: string;
}

/**
 * Compose what the client actually reads.
 *
 * Deliberately says the coach CANNOT do it for them. Without that sentence the
 * request reads as bureaucracy — "why are you asking me, you know already" —
 * and the honest answer, that this has to come from them for their programme to
 * be built around it, is also the reason they should bother.
 */
export function askMessage(areaId: string | null, note: string): string {
  const trimmed = note.trim();
  const what = areaId ? `your ${areaLabel(areaId).toLowerCase()}` : 'something you mentioned';
  const lines = [
    trimmed
      ? `${trimmed}`
      : `Could you add ${what} to your injuries when you get a minute?`,
  ];
  if (trimmed) lines.push(`Could you add ${what} under Injuries & Limitations in your app?`);
  lines.push(
    'I can’t add it for you — it has to come from you — and once it’s there your training works around it automatically.',
  );
  return lines.join('\n\n');
}

/** Ask them to record it. Only `sent` decides whether anything happened. */
export async function askToRecordInjury(
  clientId: string,
  areaId: string | null,
  note: string,
): Promise<AskResult> {
  if (!clientId) return { sent: false, pushed: false, error: 'No client to ask.' };
  const body = askMessage(areaId, note);

  try {
    // `sender: 'coach'` is not decoration: the policy checks it, and a row
    // claiming to be from the other side is refused outright. Rows are counted
    // rather than trusted, because an insert the policy filters out is not an
    // error in PostgREST.
    const { data, error } = await supabase
      .from('messages')
      .insert({ client_id: clientId, sender: 'coach', body })
      .select('id');
    if (error) {
      reportError('injuryAsk.send', error, { clientId });
      return { sent: false, pushed: false, error: error.message };
    }
    if (!data || !data.length) {
      return { sent: false, pushed: false, error: 'The message was not accepted — check they are still on your roster.' };
    }
  } catch (e: any) {
    reportError('injuryAsk.send', e, { clientId });
    return { sent: false, pushed: false, error: e?.message || 'Could not reach the server.' };
  }

  const push = await sendPushChecked(
    [clientId],
    'Your coach asked about an injury',
    areaId
      ? `They’ve asked you to add your ${areaLabel(areaId).toLowerCase()} to your injuries.`
      : 'They’ve asked you to add an injury to your profile.',
    { route: '/(client)/injuries' },
  );
  return { sent: true, pushed: push.ok };
}
