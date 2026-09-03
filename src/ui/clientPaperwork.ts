// The three reads behind "has this person signed it".
//
// The rules are next door in src/lib/clientPaperwork.ts, where they run under
// `npm test`. What is here is the part that cannot be: Supabase, and the
// LoadStatus that says whether the answer is worth anything.
//
// ── Why three reads and not one RPC ────────────────────────────────────────
//
// Because all three tables are already readable by the coach, under policies
// that were written for exactly this and are live today:
//
//   · `coach_documents` — `coach_documents_coach_r`, the coach's own rows.
//   · `coach_document_recipients` — `coach_doc_recipients_coach_r` (part 156),
//     the recipients of the coach's own documents.
//   · `coach_document_acceptances` — `coach_doc_accept_own_r` (part 135),
//     whose comment says it in as many words: "The coach reads acceptances OF
//     THEIR OWN DOCUMENTS … they asked for the signature, so they get to see
//     whether they have it."
//
// So this needs no new SQL and works against the database as it stands. The
// alternative was `coach_document_standing(p_document)` once per document,
// which answers about the whole roster to find out about one person, and would
// have made a screen a coach opens ninety seconds before a session do N round
// trips to say one sentence.
//
// ── Every read is capped ───────────────────────────────────────────────────
//
// `capLimit()` and `capped()` on all three, and 'partial' is carried out of
// here rather than swallowed. This screen's sentence is a legal claim about a
// signed waiver, and src/lib/rowCap.ts's rule — a truncated read is strictly
// worse than a failed one — is at its most literal here: nought outstanding,
// computed from part of a set, reads as "they are covered".
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { reportError } from '../lib/reportError';
import { capLimit, capped } from '../lib/rowCap';
import { worstStatus, type LoadStatus } from './loadStatus';
import {
  paperworkFor,
  type PaperworkAcceptance, type PaperworkDoc, type PaperworkItem, type PaperworkRecipient,
} from '../lib/clientPaperwork';

export interface ClientPaperwork {
  /** What this client owes and what they have signed. Empty under anything but
   *  'ready' means NOTHING IS KNOWN — the sentences in src/lib/clientPaperwork.ts
   *  take the status for that reason. */
  items: PaperworkItem[];
  status: LoadStatus;
  reload: () => void;
}

/**
 * Whether one named client has accepted the coach's required paperwork.
 *
 * `clientId` null — a client the coach added by hand, who has no account —
 * settles at 'ready' with nothing, because there is genuinely no acceptance to
 * read: somebody who has never signed in cannot have accepted anything, and the
 * screen says so in its own words rather than showing a spinner for ever.
 */
export function useClientPaperwork(coachId: string | null, clientId: string | null): ClientPaperwork {
  const [items, setItems] = useState<PaperworkItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!USE_SUPABASE || !coachId || !clientId) { setItems([]); setStatus('ready'); return; }
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        // The documents first, because the other two are filtered by their ids
        // — and because a coach with no required paperwork is the answer on its
        // own, with nothing else worth asking.
        const docsRes = await supabase.from('coach_documents')
          .select('id, title, required, retired_at, created_at')
          .eq('coach_id', coachId)
          .eq('required', true)
          .is('retired_at', null)
          .order('created_at', { ascending: false })
          .limit(capLimit());
        if (cancelled) return;
        if (docsRes.error) { reportError('clientPaperwork.docs', docsRes.error); setStatus('error'); return; }
        const docPage = capped(Array.isArray(docsRes.data) ? docsRes.data : []);
        const docs: PaperworkDoc[] = docPage.rows.map((r: any) => ({
          id: String(r.id),
          title: typeof r.title === 'string' ? r.title.trim() : '',
          required: !!r.required,
          retired: r.retired_at != null,
          createdAt: String(r.created_at),
        }));
        if (!docs.length) {
          // No required paperwork. 'partial' is still carried: a coach whose
          // FIRST page of required documents came back at the cap has more, and
          // "you require none" would be false.
          setItems([]);
          setStatus(docPage.truncated ? 'partial' : 'ready');
          return;
        }
        const ids = docs.map((d) => d.id);

        const [recRes, accRes] = await Promise.all([
          supabase.from('coach_document_recipients')
            .select('document_id, client_id').in('document_id', ids).limit(capLimit()),
          supabase.from('coach_document_acceptances')
            .select('document_id, accepted_at')
            .in('document_id', ids).eq('client_id', clientId).limit(capLimit()),
        ]);
        if (cancelled) return;
        if (recRes.error) { reportError('clientPaperwork.recipients', recRes.error); setStatus('error'); return; }
        if (accRes.error) { reportError('clientPaperwork.acceptances', accRes.error); setStatus('error'); return; }

        const recPage = capped(Array.isArray(recRes.data) ? recRes.data : []);
        const accPage = capped(Array.isArray(accRes.data) ? accRes.data : []);
        const recipients: PaperworkRecipient[] = recPage.rows.map((r: any) => ({
          documentId: String(r.document_id), clientId: String(r.client_id),
        }));
        const acceptances: PaperworkAcceptance[] = accPage.rows
          .filter((r: any) => r.accepted_at)
          .map((r: any) => ({ documentId: String(r.document_id), acceptedAt: String(r.accepted_at) }));

        setItems(paperworkFor({ docs, recipients, acceptances, clientId }));
        // The worst of the three. A truncated RECIPIENTS read is as
        // disqualifying as a truncated document read: the missing rows are
        // exactly the ones that would have told this screen a document is not
        // this client's to sign.
        setStatus(worstStatus(
          docPage.truncated ? 'partial' : 'ready',
          recPage.truncated ? 'partial' : 'ready',
          accPage.truncated ? 'partial' : 'ready',
        ));
      } catch (e) {
        if (cancelled) return;
        reportError('clientPaperwork.load', e);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [coachId, clientId, nonce]);

  return { items, status, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
