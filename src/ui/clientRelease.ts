// The one read behind "has this person signed the release".
//
// The rules are next door in src/lib/clientRelease.ts, where they run under
// `npm test`. What is here is the part that cannot be: Supabase, and the
// LoadStatus that says whether the answer is worth anything.
//
// ── What it reads, and what it deliberately cannot ─────────────────────────
//
// `public.liability_waiver_status` (supabase/parts/2671) — a two-column,
// column-limited mirror of part 84's `liability_waivers`, carrying the person
// and the version and nothing else. Its `liability_waiver_status_coach_r`
// policy is the whole of what a coach may see, and it resolves through
// `is_my_client()`, so a coach who has ended the coaching gets zero rows.
//
// `liability_waivers` itself is NOT read here and must not be. It stays
// readable by its own subject alone, which is what part 84 decided and what
// part 2671 left standing: the coach is told whether and which version, never
// what the person agreed to, never when. There is no column on the surface
// this file reads that could answer either.
//
// ── Why zero rows is the dangerous answer ──────────────────────────────────
//
// Because it is what a refusal looks like. A coach whose relationship to this
// client has ended, a policy that changed, an expired session, a dropped
// connection — every one of them is an empty array, and the sentence an empty
// array is allowed to produce is "they have NOT signed the liability release",
// which a coach acts on by refusing to train somebody. So the status is carried
// out of here intact and every one of those cases is a different sentence in
// src/lib/clientRelease.ts.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import type { LoadStatus } from './loadStatus';
import type { ReleaseSignature } from '../lib/clientRelease';

export interface ClientRelease {
  /** The versions this person has agreed to. Empty under anything but 'ready'
   *  means NOTHING IS KNOWN — every sentence in src/lib/clientRelease.ts takes
   *  the status for that reason. */
  signatures: ReleaseSignature[];
  status: LoadStatus;
  reload: () => void;
}

/**
 * Whether one named client has signed the platform liability release.
 *
 * `clientId` null — a client the coach added by hand, who has no account — is
 * still reported as 'error' rather than as an empty 'ready'. Somebody with no
 * account cannot have signed, so "they have not signed" is arguably true, but
 * it is a sentence about a PERSON and the screen has a better one about the
 * record (see app/(trainer)/client.tsx, which does not render this at all for
 * a hand-added client). Nothing here should be capable of producing the
 * accusation from an absence of an id.
 *
 * A build with no backend is the same call. There is no local store of
 * releases to fall back to — unlike the providers src/ui/loadStatus.ts
 * describes, where the device IS the source of truth when the server is off —
 * so the honest answer is that this build cannot tell you, never that they
 * have not signed.
 */
export function useClientRelease(clientId: string | null): ClientRelease {
  const [signatures, setSignatures] = useState<ReleaseSignature[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!USE_SUPABASE || !clientId) { setSignatures([]); setStatus('error'); return; }
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        // Capped like every other read on this screen. A person with more
        // versions than the cap is not a case anybody expects — re-wording the
        // release is a rare event — but 'partial' costs nothing to carry and
        // src/lib/rowCap.ts's rule is at its most literal here: a prefix of
        // somebody's signing history, reported as the whole of it, is how the
        // current version goes missing from a record that contains it.
        const res = await supabase.from('liability_waiver_status')
          .select('version')
          .eq('user_id', clientId)
          .limit(capLimit());
        if (cancelled) return;
        if (res.error) { reportError('clientRelease.read', res.error); setStatus('error'); return; }
        const page = capped(Array.isArray(res.data) ? res.data : []);
        setSignatures(page.rows
          .filter((r: any) => typeof r?.version === 'string' && r.version.trim() !== '')
          .map((r: any) => ({ version: String(r.version) })));
        setStatus(page.truncated ? 'partial' : 'ready');
      } catch (e) {
        if (cancelled) return;
        reportError('clientRelease.load', e);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, nonce]);

  return { signatures, status, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
