// A body-composition printout — the "read my InBody sheet" half of
// app/(client)/scans.tsx, and the one door through which the page may leave.
//
// ── THE PAGE LEAVES THE ACCOUNT, AND THAT IS ASKED ABOUT ──────────────────
//
// Reading a sheet means SENDING it, twice, in parallel:
//
//   analyzeInBody()  →  vision-analyze  →  https://api.anthropic.com/v1/messages
//   ocrInBody()      →  ocr-scan        →  https://api.ocr.space/parse/image
//
// For the whole of this feature's life that happened unconditionally, behind
// `ensureMediaPermission('camera', 'add a scan')` — a question about hardware —
// with nothing anywhere naming either company. An InBody sheet carries the
// member's name, their age, the clinic's letterhead and their whole body
// composition. The argument, the wording and the four states a reading may be
// described in are in src/lib/scanSheetConsent.ts.
//
// ── THE SHAPE OF THE FIX HERE IS THE REQUIRED PARAMETER ───────────────────
//
// `readScanSheet` takes a `ScanSheetAnswer` with no default, and
// `ScanSheetAnswer` has no 'unasked' member, so a call site that has not asked
// does not compile. Everything else about a consent — a flag, a setting, a
// comment — can be forgotten by the next person; a required argument of a
// two-member union cannot. Same enforcement as `readInjuryDocument` in
// src/ui/injuryDocs.ts, and for the same reason.
//
// This module exists so that enforcement has somewhere to live. The two invokes
// used to sit inline in a 2,000-line screen, in a `Promise.all` in the middle
// of a picker callback, which is a place a consent argument cannot be made
// unavoidable.
//
// ── THE ORDER: RECORD, THEN READ ──────────────────────────────────────────
//
// The consent row is written BEFORE either invoke, and the send waits for it.
// If the row does not land, nothing is posted — the member is told exactly
// that, and the manual route (three numbers off the page in their hand) is
// offered. The alternative is a state where the page has gone and the agreement
// is not on file, which is the app being able to say somebody consented while
// unable to show it. See supabase/parts/1140-*.sql.
//
// A refusal is written too, and if THAT write fails nothing is sent either —
// the refusal is honoured by not acting, not by the row. The reading then
// carries no record, which reads as "no record either way" and not as "never
// sent", because those are different facts and one of them is a claim.
//
// ── supabase-js RESOLVES ON AN ERROR ──────────────────────────────────────
// `await supabase.from(...)` / `.functions.invoke(...)` give back
// { data, error } instead of throwing, so a try/catch alone only catches the
// network dying. Every call below reads `.error`.
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/reportError';
import { analyzeInBody, visionAvailable, type InBodyVision } from '../lib/vision';
import { parseInBodySheet, type SheetRead } from '../lib/inbodySheet';
import {
  maySendScanSheet, scanSheetRecipients, SCAN_RECORD_FAILED_NOTE,
  type ScanSheetAnswer,
} from '../lib/scanSheetConsent';

/** The table in supabase/parts/1140-*.sql. Insert-and-select only, own rows
 *  only, no update or delete policy anywhere. */
export const SCAN_SHEET_CONSENT_TABLE = 'body_scan_sheet_consents';

/**
 * The id one reading is filed under, minted here on the device.
 *
 * ── Why not expo-crypto ──────────────────────────────────────────────────
 *
 * The same reason app/(client)/scans.tsx gives for its own scan ids, in the
 * note above `newScanId`: `expo-crypto` calls `requireNativeModule` at module
 * scope, so importing it throws while this file is LOADING on any install made
 * before that dependency landed — the whole Progress screen, not the one
 * feature — and no `if` inside a function runs early enough to help. That is
 * what scripts/check-native.mjs refuses, and it is right to.
 *
 * So: the platform's `crypto.randomUUID` where the runtime has one, and
 * otherwise a v4 built from `Math.random`. This is not a secret and nothing is
 * guarded by guessing it — which rows a member may read is decided by RLS. What
 * it has to be is unique, and 122 random bits is unique enough.
 */
export function newSheetReadId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') {
    try {
      const id = c.randomUUID();
      if (typeof id === 'string' && id) return id;
    } catch { /* no usable platform uuid; the shape below is built by hand */ }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function requireUid(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) { reportError('scanSheets.uid', error); return null; }
  return data?.user?.id ?? null;
}

/**
 * Write down what the member answered about ONE reading.
 *
 * Returns whether the row actually landed, and the caller acts on that rather
 * than on the absence of an error: PostgREST does not error when a policy
 * filters a row out of the returned set, so a write that inserted nothing comes
 * back looking exactly like a write that inserted something. Same trap, same
 * `.select()` count, as `recordInjuryDocConsent`.
 *
 * A duplicate is a success. The unique key is (client_id, read_id) and a read
 * id is minted per reading, so the only way to hit it is a retry — and the row
 * already there says what this one would have said.
 */
async function recordScanSheetConsent(
  uid: string, readId: string, answer: ScanSheetAnswer,
  vendors: string[], endpoints: string[],
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(SCAN_SHEET_CONSENT_TABLE)
      .insert({
        client_id: uid,
        read_id: readId,
        decision: answer,
        vendors,
        endpoints,
        decided_at: new Date().toISOString(),
      })
      .select('id');
    if (error) {
      // 23505 is the unique key: the decision is already on file, which is what
      // this call was for. Anything else is a consent we cannot show.
      if ((error as { code?: string }).code === '23505') return true;
      reportError('scanSheets.consent.write', error, { readId });
      return false;
    }
    if (!data || !data.length) {
      reportError('scanSheets.consent.write', new Error('consent insert returned no row'), { readId });
      return false;
    }
    return true;
  } catch (e) {
    reportError('scanSheets.consent.write', e, { readId });
    return false;
  }
}

/**
 * The OCR half. Its own function because it is called on its own when the
 * vision reader is off, and because its failure is a sentence rather than a
 * throw.
 */
async function ocrSheet(b64: string): Promise<SheetRead & { error?: string }> {
  const nothing: SheetRead = { weight: null, bodyFatPct: null, muscle: null, unit: null, ok: false };
  try {
    const { data, error } = await supabase.functions.invoke('ocr-scan', { body: { imageBase64: b64 } });
    if (error) { reportError('scanSheets.ocr', error); return { ...nothing, error: 'Could not reach the scanning service.' }; }
    if (!data?.ok) return { ...nothing, error: typeof data?.error === 'string' ? data.error : undefined };
    return parseInBodySheet(String(data.text || ''));
  } catch (e) {
    reportError('scanSheets.ocr', e);
    return { ...nothing, error: 'Could not reach the scanning service.' };
  }
}

export interface ScanSheetRead {
  /** The id this reading's consent row is filed under. Returned whatever
   *  happens, so the screen can name the reading it is telling the member
   *  about. */
  readId: string;
  /** What the member answered. Echoed back so a caller cannot report a send it
   *  did not ask for. */
  consent: ScanSheetAnswer;
  /** Whether the agreement is on file. False on a refusal whose row failed too
   *  — and in that case nothing was sent either. */
  recorded: boolean;
  /**
   * Whether the page left this device.
   *
   * True from the moment the first invoke is made, on every branch including
   * the failures: the request went and the bytes left, and whether a vendor
   * could read them is a different question from whether they had them. The
   * member is entitled to the first answer.
   */
  sent: boolean;
  /** The vision reader's result, or null — including when it was never called
   *  because the reader is off or the member said no. */
  vision: InBodyVision | null;
  /** The text reader's result. `ok: false` when it was never called. */
  sheet: SheetRead & { error?: string };
  /** One sentence for the member, or null when there is nothing to say beyond
   *  what the figures already say. Never carries a refusal — a refusal is not
   *  an error and the screen words it from SCAN_REFUSED_NOTE. */
  error: string | null;
}

/**
 * Read a body-composition sheet, if and only if the member said so.
 *
 * `consent` is required and has no default. It is the member's answer to the
 * question in src/lib/scanSheetConsent.ts, asked against THIS sheet, before
 * this call. 'refused' posts nothing anywhere and is not an error: the member
 * types the three numbers off the page, which is what this screen did before
 * any reader existed and what it still does perfectly well.
 *
 * Both readers run against the same image in parallel, which costs no more wall
 * time than the vision call alone — and the text read is what carries the WORD
 * the sheet printed next to the figure. Without it a US-configured printout's
 * "180.4 lb" was filed as 180 kg; see src/lib/inbodySheet.ts, which exists
 * because of exactly that.
 */
export async function readScanSheet(
  b64: string | null | undefined,
  consent: ScanSheetAnswer,
): Promise<ScanSheetRead> {
  const readId = newSheetReadId();
  const nothing: SheetRead = { weight: null, bodyFatPct: null, muscle: null, unit: null, ok: false };
  const out = (over: Partial<ScanSheetRead>): ScanSheetRead => ({
    readId, consent, recorded: false, sent: false, vision: null,
    sheet: nothing, error: null, ...over,
  });

  const uid = await requireUid();
  if (!uid) return out({ error: 'Sign in to have a sheet read. You can still type the numbers in.' });

  // The vendors named in the question are the vendors that will actually be
  // called, and they are what goes on the row. See scanSheetRecipients.
  const visionOn = visionAvailable();
  const recipients = scanSheetRecipients(visionOn);
  const recorded = await recordScanSheetConsent(
    uid, readId, consent,
    recipients.map((r) => r.vendor),
    recipients.map((r) => r.endpoint),
  );

  // The member said no. Nothing is posted, and this is not a failure — `error`
  // stays null deliberately, because a sentence in the error slot is how a
  // decision ends up drawn as a fault. The screen words this outcome from
  // SCAN_REFUSED_TITLE / SCAN_REFUSED_NOTE.
  if (!maySendScanSheet(consent)) return out({ recorded });

  // They said yes and we could not write it down. Nothing is sent — the
  // ordering in the header is the whole point and this is the branch it exists
  // for. An agreement the app cannot produce afterwards is not one it may act
  // on.
  if (!recorded) return out({ recorded: false, error: SCAN_RECORD_FAILED_NOTE });

  if (!b64) return out({ recorded, error: 'There was no image to read. Type the numbers in from your sheet.' });

  const [vision, sheet] = await Promise.all([
    visionOn ? analyzeInBody(b64, 'image/jpeg') : Promise.resolve(null),
    ocrSheet(b64),
  ]);

  // `sent: true` from here regardless of what came back. The requests were made
  // and the page left this device; over-reporting a send is the safe direction
  // when the alternative is telling somebody their printout never left.
  return out({ recorded, sent: true, vision, sheet });
}

/* ── the record, read back ──────────────────────────────────────────────── */

export interface SheetConsentRow {
  readId: string;
  decision: ScanSheetAnswer;
  vendors: string[];
  decidedAt: string;
}

/**
 * The member's own record of what has been sent, newest first.
 *
 * The point of writing the answer down is that they can go and LOOK at it: a
 * consent somebody has to take the app's word for is one they cannot check, and
 * this app's word on this exact subject was nothing at all until today.
 *
 * `status` is separate from the rows, and 'error' is not an empty list. A read
 * that failed knows nothing about how many decisions exist, and drawing zero
 * would tell a member they had never been asked — which for anybody who has
 * been asked is a new false statement about the same subject.
 */
export async function listScanSheetConsents(
  limit = 20,
): Promise<{ status: 'ready' | 'error'; rows: SheetConsentRow[] }> {
  try {
    const uid = await requireUid();
    if (!uid) return { status: 'error', rows: [] };
    const { data, error } = await supabase
      .from(SCAN_SHEET_CONSENT_TABLE)
      .select('read_id, decision, vendors, decided_at')
      .eq('client_id', uid)
      .order('decided_at', { ascending: false })
      .limit(limit);
    if (error) { reportError('scanSheets.consent.read', error); return { status: 'error', rows: [] }; }
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      readId: String(r.read_id ?? ''),
      decision: (r.decision === 'granted' ? 'granted' : 'refused') as ScanSheetAnswer,
      vendors: Array.isArray(r.vendors) ? r.vendors.map(String) : [],
      decidedAt: String(r.decided_at ?? ''),
    }));
    return { status: 'ready', rows };
  } catch (e) {
    reportError('scanSheets.consent.read', e);
    return { status: 'error', rows: [] };
  }
}
