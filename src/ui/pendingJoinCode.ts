// A coach's code, carried from the link somebody tapped to the screen that
// spends it.
//
// Why this exists at all:
//
// A coach posts https://www.repplefitness.com/join?c=K7M2QX in their bio. The
// person taps it, lands on the web page, and is asked to REMEMBER SIX
// CHARACTERS, go to the App Store, install the app, sign up, find "Find a
// trainer", and type them in. Every one of those steps loses people — and the
// ones it does not lose often arrive having forgotten the code, join with no
// code at all, and are attributed to nothing.
//
// That is not a measurement problem to be honest about in a footnote. It is
// most of the reason attribution looks last-touch in the first place: the
// channel did its job and the credit fell on the floor between the browser and
// the app.
//
// So the code travels. `repple://join?c=CODE` opens the app straight onto the
// route that stores it here, and the trainer-search screen picks it up already
// filled in. Nobody types anything.
//
// It is deliberately NOT the authority on anything. It holds a string somebody
// put in a URL until a screen can use it, and that screen still asks the server
// whether the code is real and still sends a request the coach has to accept.
// A wrong code stored here costs one prefilled field, not a wrong coach.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normaliseCode, isPlausibleCode } from '../lib/joinCode';

const KEY = 'repple.pendingJoinCode';

/**
 * Remember a code from a link. Refuses anything that is not shaped like one, so
 * a mangled or truncated URL leaves the field empty rather than prefilling
 * something that cannot work and looks like the app's fault.
 */
export async function rememberJoinCode(raw: string | null | undefined): Promise<boolean> {
  const code = normaliseCode(String(raw ?? ''));
  if (!isPlausibleCode(code)) return false;
  try {
    await AsyncStorage.setItem(KEY, code);
    return true;
  } catch {
    // Losing it costs the prefill, not the join — they can still type it.
    return false;
  }
}

/** Whatever a link left for us, or null. Does not consume it. */
export async function peekJoinCode(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v && isPlausibleCode(v) ? v : null;
  } catch { return null; }
}

/**
 * Forget it. Called once the code has been SENT, not merely shown — somebody
 * who taps a link, gets distracted and comes back tomorrow should still find it
 * waiting, which is the whole point of storing it rather than passing it in a
 * route param.
 */
export async function clearJoinCode(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* it is spent either way */ }
}
