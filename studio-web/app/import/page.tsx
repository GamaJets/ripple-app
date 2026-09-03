'use client';

// Import — read a spreadsheet from whatever the gym used before Repple.
//
// The parser and the previewers have been in src/lib with tests since the CSV
// work landed; nothing has ever reached them. This is that surface.
//
// Everything is a dry run until the gym presses the button. previewMembers,
// previewPayments and previewPlans write nothing — they read the file, report
// what they found and what they could not make sense of, and hand back rows. An
// import that half-succeeded and left no record of which half is the worst
// outcome available, so the confirm step is deliberate, the preview is
// complete, and a run that only partly landed says so in those words.
//
// THREE KINDS, and they do not have the same powers. Each says which on screen
// rather than letting it be discovered at the end:
//
//  · Plans import. membership_plans holds nothing but the tenant and the plan
//    itself — no foreign key to a person — so a price book is a plain insert
//    and the whole file can land.
//
//  · Payments import. gym_payments.member_id is nullable, so a payment whose
//    member cannot be matched is still recorded — unattributed, which is true,
//    rather than dropped, which loses money the gym actually took.
//
//  · Members are INVITED, not inserted. memberships.member_id is `not null
//    references profiles(id)`, so a membership needs a real account behind it
//    and no amount of spreadsheet makes one. What the file can do is issue the
//    invitations — one per row that carries an address — which is the actual
//    path from "person the gym knows about" to "member", and until /invites
//    existed there was no way to walk it two hundred times.
//
//    A row with no email address cannot be invited at all and is counted out
//    loud rather than dropped: an invitation is addressed to an address, and
//    a name is not one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, writeFailedText, loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { Kpi } from '@/components/Kpi';
import { Shell } from '@/components/Shell';
import { Banner as SharedBanner, Announce } from '@/components/Banner';
import {
  previewMembers, previewPayments, previewPlans, describePreview,
  type ImportPreview, type MemberRow, type PaymentRow, type PlanRow,
  type RowResult, type DateOrder,
} from '@lib/csvImport';
import {
  fetchMemberships, fetchPlans, money,
  type Membership, type MembershipPlan,
} from '@lib/gymRecord';
import { NO_CURRENCY_NOTE, type TenantCurrency } from '@/lib/currency';
import { gymDateText, gymDateTimeText } from '@lib/gymWhen';
import { parseGymZone } from '@lib/gymZone';
import {
  keyPaymentRows, startImportRun, finishImportRun, importPayments,
  fetchImportRuns, undoImportRun, importedRowCount,
  type ImportRun,
} from '@lib/gymImports';
import {
  fetchInvites, createInvites, screenInvites, inviteState, planIdFor, normaliseEmail,
  DEFAULT_VALID_DAYS, type MemberInvite,
} from '@lib/memberInvites';

type Kind = 'payments' | 'members' | 'plans';

/** How a finished run went. Drives the wording and the colour of the result. */
type Outcome = 'all' | 'partial' | 'none';

export default function ImportPage() {
  // Three states, like every other screen in the console: undefined is "we have
  // not asked yet", null is "nobody is signed in". Collapsing them into one null
  // meant a visitor who was still loading and a visitor with no account were
  // shown the same blank page, and neither was ever told to sign in.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  /** The auth call did not come back. `me` stays undefined, which is honest —
   *  nobody said who this is — and this is what stops that reading as a
   *  spinner that never resolves. */
  const [authUnread, setAuthUnread] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  // `tenants.currency`, and the reason this read exists at all.
  //
  // A payments CSV has no currency column — `PaymentRow` in src/lib/csvImport.ts
  // carries an amount, a date and a method and nothing else — so every imported
  // payment inherits the gym's. The write behind this used to stamp 'AED' over
  // whatever it was not told, which meant a whole historical ledger imported
  // from a GBP gym's old system landed as dirhams in one press, silently, and
  // was thereafter indistinguishable from a figure somebody had checked.
  // Null here means the gym has not set one, and the import is refused rather
  // than guessed.
  const [ccy, setCcy] = useState<TenantCurrency>(null);
  /** `tenants.timezone`, or null when the gym has not set one. The import log
   *  below stamps a time on every run, and which day a run landed on is a fact
   *  about the gym's day rather than about the desk this is read from. */
  const [zone, setZone] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>('payments');
  const [text, setText] = useState('');
  const [order, setOrder] = useState<DateOrder | ''>('');

  // Both of these stay null until the read actually returns. Null means "not
  // read yet or the read failed", [] means "read, and the gym has none" — they
  // are different facts and the screen never renders them the same way. The
  // error strings are what makes the failure case distinguishable from the
  // not-yet case.
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [priceBook, setPriceBook] = useState<MembershipPlan[] | null>(null);
  const [priceBookError, setPriceBookError] = useState<string | null>(null);
  // The invitations this gym already has open. Null on a failed read, and that
  // matters more here than anywhere else on the page: [] would tell the screen
  // there are no open invitations, and a second run over the same sheet would
  // then be refused row by row by the partial unique index — after the owner
  // had been told two hundred were about to go out.
  const [invites, setInvites] = useState<MemberInvite[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  /** ms of the last invitations read that came back, or null if none has. See
   *  where it is stamped in `loadGym`, and where it is spent in `inviteDrafts`. */
  const [invitesAt, setInvitesAt] = useState<number | null>(null);
  /** The instant an invitation's expiry is judged against: the read that
   *  produced the list. `?? Date.now()` covers the render before the first read
   *  has landed, where `invites` is null and the panel draws nothing anyway. */
  const nowMs = invitesAt ?? Date.now();

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; outcome: Outcome } | null>(null);
  const [failed, setFailed] = useState<{ line: number; why: string }[]>([]);

  /**
   * What this gym has already imported.
   *
   * Null until the read returns, and null on a failure — never [], which would
   * tell an owner they have never run an import and is the sentence that makes
   * somebody paste the file "again, to be safe".
   */
  const [runs, setRuns] = useState<ImportRun[] | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);

  /**
   * Read the two things an import is checked against: who the gym already has,
   * and what it already sells.
   *
   * Deliberately two separate try blocks. One read failing must never be
   * reported as the other coming back empty, and neither may be reported as
   * "none" when what actually happened is that the query errored.
   */
  const loadGym = useCallback(async (tenant: string) => {
    try {
      setMembers(await fetchMemberships(supabase, tenant));
      setRosterError(null);
    } catch (e: any) {
      setMembers(null);
      setRosterError(e?.message ?? 'Could not read the member list.');
    }
    try {
      setPriceBook(await fetchPlans(supabase, tenant));
      setPriceBookError(null);
    } catch (e: any) {
      setPriceBook(null);
      setPriceBookError(e?.message ?? 'Could not read the price book.');
    }
    try {
      setInvites(await fetchInvites(supabase, tenant));
      setInvitesError(null);
      // When these invitations were read. The duplicate screen below asks
      // whether each one is still open, which is a question about a clock: an
      // invitation expires with nobody touching it. This page has no `useFetched`
      // and no poll, so without a stamp that moves with the read the screen was
      // judging expiry against the moment the tab was opened — and this console
      // has no router, so an import tab left open on a desk is one document that
      // lives for days. Stamped only on a read that came back: a failed read
      // leaves the previous stamp where it is, because the rows on screen are
      // still the ones it produced.
      setInvitesAt(Date.now());
    } catch (e: any) {
      setInvites(null);
      setInvitesError(e?.message ?? 'Could not read the invitations already sent.');
    }
    // The runs already made. Its own try for the same reason as the other
    // three: an unreadable history must not empty the receipt below into "this
    // gym has never imported anything".
    try {
      setRuns(await fetchImportRuns(supabase, tenant));
      setRunsErr(null);
    } catch (e: any) {
      setRuns(null);
      setRunsErr(e?.message ?? 'Could not read what has already been imported.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const who = await loadMe();
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
      if (!who) return;
      setTenantId(who.tenantId);
      if (who.tenantId) {
        // supabase-js resolves on a database error rather than rejecting, so
        // the error has to be read off the result, not caught.
        const { data, error } = await supabase
          .from('tenants').select('name, currency, timezone').eq('id', who.tenantId).single();
        setGymName(error ? null : ((data as any)?.name ?? null));
        setCcy(error ? null : ((((data as any)?.currency ?? '') as string).trim().toUpperCase() || null));
        const z = error ? { kind: 'clear' as const } : parseGymZone((data as any)?.timezone);
        setZone(z.kind === 'zone' ? z.zone : null);
        await loadGym(who.tenantId);
      }
    })();
  }, [loadGym]);

  // Widened to the union element rather than left as a union OF previews: the
  // shape is identical either way and only the row type differs, so this reads
  // the common fields without a cast at every use.
  const preview = useMemo<ImportPreview<MemberRow | PaymentRow | PlanRow> | null>(() => {
    if (!text.trim()) return null;
    const o = order || undefined;
    // Plans carry no dates, so previewPlans takes no order to apply. The gym's
    // currency is the fallback for any row whose sheet does not state one.
    if (kind === 'plans') return previewPlans(text, ccy);
    return kind === 'payments' ? previewPayments(text, o, ccy) : previewMembers(text, o);
  }, [text, kind, order, ccy]);

  /**
   * The plan rows that will be written, each still carrying its line number.
   *
   * `preview.ready` is a bare array of values, so a failure part-way through a
   * run could only be reported by position — which is off by however many rows
   * above it were rejected. Walking `preview.rows` instead keeps the line
   * number the gym can actually find in its spreadsheet. The predicate is the
   * one previewPlans itself uses to build `ready`, so the two cannot drift.
   */
  const planRows = useMemo<{ line: number; plan: PlanRow }[]>(() => {
    if (!preview || kind !== 'plans' || preview.missingRequired.length) return [];
    return (preview.rows as RowResult<PlanRow>[])
      .filter((r) => r.value !== undefined)
      .map((r) => ({ line: r.line, plan: r.value as PlanRow }));
  }, [preview, kind]);

  /**
   * The payment rows that will be written, each still carrying its line number.
   *
   * The same problem planRows solves, and it bites harder here. `preview.ready`
   * has the rejected rows taken out of it, so a position in that array is not a
   * line in the spreadsheet: it is short by however many rows above were
   * refused. Every failure reported from a run over `ready` therefore named a
   * line several rows too early — and the wording under a partial run tells the
   * gym to fix those lines and paste only those back in. Following that
   * instruction with the wrong numbers re-imports payments that already landed,
   * duplicating money the gym took, while the rows that actually failed stay
   * missing. Walking `preview.rows` keeps `r.line`, which is the number printed
   * down the side of their sheet.
   *
   * The predicate is previewPayments' own — a row with no errors — and not the
   * `value !== undefined` that previewPlans uses. Payments fill `value` in even
   * for a refused row (an unreadable amount becomes 0, an unreadable date an
   * empty string), so testing for its presence here would import exactly the
   * rows the preview has just told the gym it is skipping.
   */
  const paymentRows = useMemo<{ line: number; payment: PaymentRow }[]>(() => {
    if (!preview || kind !== 'payments' || preview.missingRequired.length) return [];
    return (preview.rows as RowResult<PaymentRow>[])
      .filter((r) => r.errors.length === 0)
      .map((r) => ({ line: r.line, payment: r.value as PaymentRow }));
  }, [preview, kind]);

  /**
   * The invitations this member file would issue, each still carrying its line
   * number, and everything it CANNOT issue, said separately.
   *
   * Three different reasons a row does not become an invitation, and none of
   * them may be folded into the others:
   *
   *  · it has no email address. An invitation is addressed to an address; a
   *    name is not one, and there is nothing to send to.
   *  · this gym already has an invitation open for that address. The partial
   *    unique index in 37-member-invites.sql enforces it, and `screenInvites`
   *    is the readable half of the same rule — checked here so the second run
   *    over the same sheet reports it rather than failing the whole batch.
   *  · the same address appears twice in this file. Row-by-row validation would
   *    pass both and the single insert would then fail halfway.
   *
   * The rows the preview already rejected — bad dates, unreadable statuses —
   * are not here at all: they are listed in "rows need attention" above, and
   * inviting somebody off a row this screen has just called broken would be the
   * opposite of a dry run.
   */
  const inviteDrafts = useMemo(() => {
    if (!preview || kind !== 'members' || preview.missingRequired.length) return null;
    // The duplicate screen could not be run, so there is no screened list.
    //
    // This was `const openTo = invites === null ? [] : …` directly under a
    // comment forbidding exactly that: "Passing [] from a failed read would say
    // 'none of these is a duplicate', which is a claim, not a silence." The
    // line did what the comment forbade, and the consequences were not a
    // silence either — `screenInvites` returned every row as sendable, the tile
    // printed the count, the "cannot be invited" panel listed nothing, and the
    // confirmation read "200 invitations will be recorded", which is the
    // sentence somebody acts on. The warning banner above was true and it was
    // beside a set of numbers that contradicted it.
    //
    // Null here withholds the whole panel: no count, no list, no button. The
    // banner says why, and the errand is "reload", which is a thing that works.
    if (invites === null) return null;
    const rows = (preview.rows as RowResult<MemberRow>[]).filter((r) => r.errors.length === 0);
    const noAddress = rows.filter((r) => !r.value?.email);
    const drafts = rows
      .filter((r) => r.value?.email)
      .map((r) => ({
        line: r.line,
        email: r.value!.email as string,
        fullName: r.value!.name || null,
        // Matched by name against the price book, and null when the sheet named
        // no plan, named one this gym does not sell, or named one it sells
        // twice. The invite then carries no plan — which the schema allows on
        // purpose — rather than a price nobody agreed to.
        planId: planIdFor(r.value!.plan, priceBook ?? []),
        planName: r.value!.plan,
        validDays: DEFAULT_VALID_DAYS as number | null,
      }));
    // Screened against the open invitations, which by here have been read —
    // the guard at the top of this memo is what makes that true.
    // Judged at the instant the invitations were READ, not at whatever moment
    // this memo first happened to run. `inviteState` defaults its second
    // argument to the clock, and nothing in this dependency list moves when time
    // does — so an invitation that expired while the file sat on screen still
    // counted as open, and the row it belongs to was rejected as a duplicate of
    // an invitation that no longer exists. That is the silent direction: the
    // person is simply left out of the batch.
    const openTo = invites.filter((i) => inviteState(i, nowMs) === 'pending').map((i) => i.email);
    const { send, rejected } = screenInvites(drafts, openTo);
    return {
      send,
      rejected,
      noAddress,
      // How many rows named a plan that this gym could actually match. Null
      // while the price book is unread — 0 would read as "none of these plans
      // exists here", which is a different and much more alarming answer.
      planned: priceBook === null ? null : send.filter((d) => d.planId !== null).length,
      named: send.filter((d) => (d.planName ?? '').trim() !== '').length,
    };
  }, [preview, kind, invites, priceBook, nowMs]);

  /**
   * Plan names in the file that the gym already sells.
   *
   * previewPlans de-duplicates within the file; it cannot know what is already
   * in the database. Importing anyway is allowed — the gym may be re-pricing —
   * but it is said out loud first, because two rows called "Monthly" leave the
   * price book selling at whichever one a list happens to put first.
   *
   * Null when the price book has not been read, which is not the same as no
   * collisions and is never rendered as a count.
   */
  const collisions = useMemo<{ names: string[]; bookSize: number } | null>(() => {
    if (kind !== 'plans' || priceBook === null) return null;
    const have = new Set(priceBook.map((p) => p.name.trim().toLowerCase()));
    return {
      names: planRows.map((r) => r.plan.name).filter((n) => have.has(n.trim().toLowerCase())),
      bookSize: priceBook.length,
    };
  }, [kind, priceBook, planRows]);

  /**
   * Match an imported payment to a member by name.
   *
   * Name only: Membership carries no email, so the email column the importer
   * parses cannot be used for matching without another read. Name matching is
   * exact after trimming and lower-casing — deliberately not fuzzy, because
   * attaching a payment to the wrong member is worse than leaving it
   * unattributed, and the screen says how many will be unattributed before
   * anything is written.
   */
  const matchMember = useCallback((row: PaymentRow): string | null => {
    const list = members ?? [];
    const name = (row.memberName ?? '').trim().toLowerCase();
    if (!name) return null;
    const hit = list.find((m) => (m.memberName ?? '').trim().toLowerCase() === name);
    return hit?.memberId ?? null;
  }, [members]);

  /**
   * Write the payments.
   *
   * This was a `for` loop of one-payment-at-a-time inserts with nothing to say
   * which run wrote what, no way to recognise a line already imported, no
   * receipt and no undo — on the one screen in this console that writes the
   * money ledger irreversibly and in bulk. Its own failure message told the
   * operator to fix the failed lines and paste back "only those, or the rest
   * will be imported twice", which made correctness a transcription exercise
   * performed once, by hand, under pressure.
   *
   * Now every line carries a key derived from its own content plus its
   * occurrence in the file (`keyPaymentRows`), `(tenant_id, import_key)` is
   * unique, and the write is an upsert that ignores duplicates. So re-running
   * the whole file is the safe move rather than the dangerous one: the lines
   * that landed are recognised and skipped BY THE DATABASE — not by anything
   * this page remembers, which a reload would have thrown away.
   *
   * The run is opened before the first write and closed after the last, so an
   * import interrupted halfway leaves a row with no finish time and rows
   * attached to it. That is the only trace a closed browser would otherwise
   * leave of two hundred half-written payments.
   */
  const runImport = async () => {
    if (!preview || !tenantId || kind !== 'payments' || !paymentRows.length) return;
    // Belt as well as the disabled button: this writes money, permanently, in
    // bulk, and a currency nobody chose is not a detail that can be corrected
    // afterwards from the rows themselves.
    if (!ccy) return;
    setBusy(true); setDone(null); setFailed([]); setUndoMsg(null);
    const keyed = keyPaymentRows(paymentRows);
    let runId: string | null = null;
    try {
      runId = await startImportRun(supabase, tenantId, 'payments', keyed.length, me?.id ?? null);
    } catch (e: any) {
      setBusy(false);
      setDone({
        text: writeFailedText(e, {
          what: 'Opening that import',
          unchanged: 'no payment was recorded and the file is still to run',
          howToCheck: 'Reload this page and look for a run of this file in the receipts below before running it again — an import run twice files every payment twice.',
        }),
        outcome: 'none',
      });
      return;
    }

    const out = await importPayments(supabase, tenantId, runId, keyed, {
      currency: ccy,
      memberIdFor: matchMember,
      recordedBy: me?.id ?? null,
    });

    // Closing the receipt is its own write and can be refused on its own. If it
    // is, the payments are still written and the run row still names them —
    // said out loud rather than swallowed, because a receipt with no counts is
    // the one row somebody will later try to reconcile against.
    let receiptErr: string | null = null;
    try {
      await finishImportRun(supabase, runId, {
        written: out.written, skipped: out.skipped, failed: out.failed.length,
      });
    } catch (e: any) {
      receiptErr = e?.message ?? 'the receipt could not be closed';
    }

    setBusy(false);
    setFailed(out.failed);
    setDone(paymentReport(out, receiptErr));
    await loadGym(tenantId);
  };

  /**
   * Take back everything one run wrote.
   *
   * Confirmed rather than immediate, and the confirmation says the number,
   * because "undo" on a money ledger is itself a destructive act. The count is
   * read first so a run whose rows are already gone says so instead of
   * offering a button that removes nothing and reports success.
   */
  const undoRun = async (run: ImportRun) => {
    if (!tenantId) return;
    setUndoMsg(null); setUndoing(run.id);
    try {
      const held = await importedRowCount(supabase, tenantId, run.id);
      if (held === 0) {
        setUndoMsg('That run has no payments left in the ledger — nothing to remove.');
        return;
      }
      if (!confirm(
        `Remove ${held} payment${held === 1 ? '' : 's'} written by this import?\n\n`
        + 'They are deleted, not hidden, so every total goes back to what it was before the run. '
        + 'The receipt stays.',
      )) return;
      const removed = await undoImportRun(supabase, tenantId, run.id);
      setUndoMsg(`${removed} payment${removed === 1 ? '' : 's'} removed. Every total is back to what it was before that import.`);
      await loadGym(tenantId);
    } catch (e: any) {
      setUndoMsg(writeFailedText(e, {
        what: 'That undo',
        unchanged: 'nothing was removed and the ledger is unchanged',
        howToCheck: 'Reload this page and read the run’s state below — the payments it wrote are either gone or they are not.',
      }));
    } finally {
      setUndoing(null);
    }
  };

  /**
   * Write the ready plan rows into the gym's price book.
   *
   * Row by row rather than one array insert, so that a single row the database
   * refuses does not take the other forty with it and so the failure can be
   * reported against the line the gym has to go and fix.
   *
   * Not gymRecord.createPlan: that helper has no `active` parameter, and a plan
   * the sheet marks archived would go back on sale as a side effect of being
   * imported. previewPlans goes to some trouble to read that column honestly,
   * so it is written honestly. Everything else follows the house pattern —
   * supabase-js resolves on a database error, so `error` is read off the result
   * and thrown; a try/catch on its own would see only the network dying.
   */
  const runPlanImport = async () => {
    if (!preview || !tenantId || kind !== 'plans' || !planRows.length) return;
    // A row's own currency wins; a row without one inherits the gym's; a gym
    // without one cannot import a price book at all. Nothing here picks a
    // currency, and the button is disabled for the third case so this is a
    // belt rather than the explanation.
    if (!ccy && planRows.some(({ plan }) => !plan.currency)) return;
    setBusy(true); setDone(null); setFailed([]);
    let ok = 0; const bad: { line: number; why: string }[] = [];
    for (const { line, plan } of planRows) {
      try {
        const { error } = await supabase.from('membership_plans').insert({
          tenant_id: tenantId,
          name: plan.name,
          price_cents: plan.priceCents,
          // The sheet's currency where it states one, the gym's where it does
          // not. `plan.currency` used to arrive as a hardcoded 'AED' from the
          // parser for every sheet without a currency column.
          currency: plan.currency ?? ccy,
          interval: plan.interval,
          active: plan.active,
        });
        if (error) throw error;
        ok++;
      } catch (e: any) {
        bad.push({ line, why: e?.message ?? 'write failed' });
      }
    }
    setBusy(false);
    setFailed(bad);
    setDone(report(ok, bad.length, 'plan', 'added to your price book'));
    // Re-read whatever landed, so the collision count on screen describes the
    // price book as it is now rather than as it was before the run.
    if (ok > 0) await loadGym(tenantId);
  };

  /**
   * Issue the invitations. The only write the members tab makes, and it makes
   * no membership at all — that row appears when the person accepts, through
   * accept_member_invite, with their own account behind it.
   *
   * One statement for the whole batch, unlike the payment and plan imports.
   * That is `createInvites`' shape and it is the right one here: an invitation
   * list is not money, a partial batch has no rows the gym has to reconcile,
   * and all-or-nothing means the obvious retry — run the file again — is safe.
   * The failure message says exactly that, because "some may have gone out"
   * would stop an owner retrying at all.
   */
  const runInviteImport = async () => {
    if (!tenantId || !inviteDrafts || !inviteDrafts.send.length) return;
    setBusy(true); setDone(null); setFailed([]);
    try {
      const out = await createInvites(
        supabase,
        tenantId,
        inviteDrafts.send.map(({ email, fullName, planId, validDays }) => ({
          email, fullName, planId, validDays,
        })),
        me?.id ?? null,
      );
      // Reported by the line in the spreadsheet, never by position in a
      // filtered array — the rejects come back as rows, so they are matched
      // back to their line by address.
      const byEmail = new Map(inviteDrafts.send.map((d) => [normaliseEmail(d.email), d.line]));
      const bad = out.rejected.map((r) => ({
        line: byEmail.get(normaliseEmail(r.row.email)) ?? 0,
        why: r.reason,
      }));
      setFailed(bad);
      setDone(report(out.sent, bad.length, 'invitation', 'recorded'));
      if (out.sent > 0) await loadGym(tenantId);
    } catch (e: any) {
      setFailed([]);
      setDone({
        // The one-statement argument survives a refusal and does not survive a
        // silence: a statement nobody answered about may have committed whole.
        text: writeFailedText(e, {
          what: 'That list of invitations',
          unchanged: 'the whole list is written in one statement, so not one invitation went out and the file is still to run',
          howToCheck: 'Reload this page and read the invitation list before running the file again.',
        }),
        outcome: 'none',
      });
    } finally { setBusy(false); }
  };

  // Null, not 0, when the member list has not been read: "none of these match a
  // member" and "we could not check" are different answers and only one of them
  // is safe to act on.
  const matched = kind === 'payments' && preview && members !== null
    ? (preview.ready as PaymentRow[]).filter((r) => matchMember(r) !== null).length
    : null;

  // Four states, not two: still reading, nobody signed in, a question this
  // console could not ask, and a person. See components/Gate.tsx — this
  // was a bare `Loading…` div and a Sign in link, with no third sentence
  // and nothing announced to a screen reader.
  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} current="/import">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  // The database refuses these writes to anybody else anyway, but a screen that
  // offers a button and lets the row bounce is a worse answer than a sentence:
  // this one prices the gym's plans and records money it has taken, and half a
  // refused run still leaves the half that landed. Said here, before the form.
  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} current="/import">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          Importing writes the gym&rsquo;s price book and its payment record, so it
          is owner-only.
        </p>
      </Shell>
    );
  }

  return (
    <Shell me={me} gymName={gymName} current="/import">
      <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>Import</h1>
      <p style={{ margin: '0 0 20px', color: 'var(--ink3)', fontSize: 13, maxWidth: '78ch' }}>
        Paste a spreadsheet exported from whatever you used before. Nothing is written until you
        say so, and you see exactly what will happen first. A payments file can be run again
        safely — every line is recognised by its own content, so the ones already in the ledger are
        skipped rather than recorded twice, and any run can be taken back below.
      </p>

      <Runs runs={runs} error={runsErr} zone={zone} onUndo={undoRun} undoing={undoing} message={undoMsg} />

      <Section title="The file" sub="Copy the whole sheet, header row included, and paste it here.">
        <div style={{ ...formRow, borderBottom: 'none' }}>
          {(['payments', 'members', 'plans'] as Kind[]).map((k) => (
            /* `aria-pressed` — which of the three kinds the pasted sheet will
               be read as was a button style and nothing announced. */
            <button key={k} type="button" aria-pressed={k === kind}
              onClick={() => { setKind(k); setDone(null); setFailed([]); }}
              style={k === kind
                ? { ...primaryBtn, textTransform: 'capitalize' }
                : { ...field, cursor: 'pointer', textTransform: 'capitalize' }}>
              {k}
            </button>
          ))}
          {/* A price book has no dates in it, so there is no convention to pick. */}
          {kind === 'plans' ? null : (
            <select
              value={order} onChange={(e) => setOrder(e.target.value as DateOrder | '')}
              // Its only hint of purpose was the text of the default option,
              // which a screen reader reads as the VALUE rather than as the
              // label — so the control that decides whether 03/04 is March or
              // April announced nothing about what it is for.
              aria-label="How dates in the pasted text are ordered"
              style={field}
            >
              <option value="">Work out the date order</option>
              <option value="dmy">Dates are day/month/year</option>
              <option value="mdy">Dates are month/day/year</option>
              <option value="ymd">Dates are year-month-day</option>
            </select>
          )}
        </div>
        <div style={{ padding: '0 14px 14px' }}>
          {/* A real <label>, associated by id. The box a gym pastes its entire
              roster into carried a placeholder and nothing else — and a
              placeholder is not a label: it is announced as a value, and it
              disappears the moment anybody types. This is the control that
              decides how a whole gym's roster is parsed, on the screen where
              getting it wrong writes rows. */}
          <label htmlFor="paste" className="micro" style={{ display: 'block', marginBottom: 5 }}>
            Paste {kind === 'plans' ? 'the price book' : kind === 'members' ? 'the roster' : `the ${kind}`}, one per line
          </label>
          <textarea
            id="paste"
            value={text}
            onChange={(e) => { setText(e.target.value); setDone(null); setFailed([]); }}
            placeholder={PLACEHOLDERS[kind]}
            rows={8}
            style={{ ...field, width: '100%', fontFamily: 'var(--mono)', fontSize: 12.5, resize: 'vertical' }}
          />
        </div>
      </Section>

      {kind === 'members' ? (
        <Note tone="info">
          <strong style={{ color: 'var(--ink)' }}>Members are invited, not imported.</strong>{' '}
          A membership must point at a real Repple account, and no spreadsheet makes one — so a
          checked file issues an <a href="/invites" style={{ color: 'var(--brand)' }}>invitation</a>{' '}
          per row instead, and the membership opens when the person accepts it. Nothing on this
          page writes a membership. Rows with no email address cannot be invited at all and are
          counted below rather than dropped.
        </Note>
      ) : null}

      {kind === 'plans' ? (
        <Note tone="info">
          <strong style={{ color: 'var(--ink)' }}>Plans import in full.</strong>{' '}
          A plan is billed monthly, yearly or as a one-off, because those are the only three
          things the price book can hold. A row that says quarterly, weekly or six-monthly is
          refused with a reason rather than rounded into one of them — calling a quarterly plan
          monthly would divide the gym&rsquo;s recurring revenue by three.
        </Note>
      ) : null}

      {kind === 'payments' && rosterError ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>The member list could not be read</strong>, so no
          payment can be matched to anybody: {rosterError}. Importing now would record every
          payment unattributed. Reload the page first.
        </Note>
      ) : null}

      {kind === 'members' && invitesError ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>The invitations already sent could not be read</strong>,
          so this cannot say which of these people you have already invited: {invitesError}. The
          count and the send list below are withheld rather than computed over a check that did not
          run &mdash; &ldquo;200 invitations will be recorded&rdquo; over an unrun duplicate check is
          a claim, not a silence. Reload the page and the panel comes back.
        </Note>
      ) : null}

      {kind === 'plans' && priceBookError ? (
        <Note tone="warn">
          <strong style={{ color: 'var(--ink)' }}>The price book could not be read</strong>, so this
          cannot say which of these plans the gym already sells: {priceBookError}. The import itself
          still works; it just cannot warn you about duplicates.
        </Note>
      ) : null}

      {preview ? (
        <>
          <Section title="What the file says" sub={describePreview(preview)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: 'var(--ring)' }}>
              <Kpi label="Rows read" text={String(preview.rows.length)} />
              <Kpi label="Ready" text={String(preview.ready.length)} />
              <Kpi label="Need attention" text={String(preview.rejected.length)} />
              {kind === 'payments' ? (
                <Kpi
                  label="Matched to a member"
                  text={matched === null ? null : String(matched)}
                  note={matched === null
                    ? (rosterError ? 'member list could not be read' : 'member list not read yet')
                    : (preview.ready.length ? `${preview.ready.length - matched} will be unattributed` : undefined)}
                />
              ) : null}
              {kind === 'members' ? (
                <Kpi
                  label="Can be invited"
                  text={inviteDrafts ? String(inviteDrafts.send.length) : null}
                  note={inviteDrafts && inviteDrafts.noAddress.length
                    ? `${inviteDrafts.noAddress.length} row${inviteDrafts.noAddress.length === 1 ? ' has' : 's have'} no email address`
                    : undefined}
                />
              ) : null}
              {kind === 'members' ? (
                <Kpi
                  label="Plan matched"
                  // Null while the price book is unread. A 0 here reads as "this
                  // gym sells none of these plans", which is a finding rather
                  // than a missing query.
                  text={inviteDrafts?.planned == null ? null : String(inviteDrafts.planned)}
                  note={inviteDrafts?.planned == null
                    ? (priceBookError ? 'price book could not be read' : 'price book not read yet')
                    : inviteDrafts.named === 0
                      ? 'this file names no plans'
                      : `of ${inviteDrafts.named} row${inviteDrafts.named === 1 ? '' : 's'} naming one — the rest join with no plan`}
                />
              ) : null}
              {kind === 'plans' ? (
                <Kpi
                  label="Already in your price book"
                  text={collisions === null ? null : String(collisions.names.length)}
                  note={collisions === null
                    ? (priceBookError ? 'price book could not be read' : 'price book not read yet')
                    : collisions.bookSize === 0
                      ? 'your price book is empty'
                      : `out of ${collisions.bookSize} plan${collisions.bookSize === 1 ? '' : 's'} already recorded`}
                />
              ) : null}
            </div>

            {collisions && collisions.names.length ? (
              <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--warn)' }}>
                {collisions.names.length === 1 ? 'One plan' : `${collisions.names.length} plans`} in this file
                already {collisions.names.length === 1 ? 'exists' : 'exist'} in your price book:{' '}
                <span style={{ fontFamily: 'var(--mono)' }}>{collisions.names.join(', ')}</span>. Importing
                creates a second copy rather than changing the price of the first. Nothing is removed
                from this import — decide before you confirm.
              </p>
            ) : null}

            {preview.missingRequired.length ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--crit)' }}>
                No {preview.missingRequired.join(' or ')} column found, so nothing can be read from this file.
              </p>
            ) : null}

            {preview.dateOrder === 'ambiguous' ? (
              <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--warn)' }}>
                Every date in this file works read either way round — 03/04 could be 3 April or
                4 March. Say which above; guessing would silently move somebody&rsquo;s renewal by
                nine months.
              </p>
            ) : null}

            {preview.unmatchedColumns.length ? (
              <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                Ignoring {preview.unmatchedColumns.length} column{preview.unmatchedColumns.length === 1 ? '' : 's'} nothing recognised:{' '}
                <span style={{ fontFamily: 'var(--mono)' }}>{preview.unmatchedColumns.join(', ')}</span>. They are
                reported rather than dropped quietly, in case one of them mattered.
              </p>
            ) : null}
          </Section>

          {preview.rejected.length ? (
            <Section title={`${preview.rejected.length} rows need attention`}
                     sub="These are skipped. Fix them in the sheet and paste again — nothing here is imported.">
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {preview.rejected.slice(0, 60).map((r) => (
                  <div key={r.line} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {r.line}</span>
                    <span style={{ color: 'var(--ink2)' }}>{r.errors.join(' · ')}</span>
                  </div>
                ))}
                {preview.rejected.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {preview.rejected.length - 60} more. Showing the first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
            </Section>
          ) : null}

          {kind === 'payments' && paymentRows.length > 0 ? (
            <Section
              title="Import"
              sub={`${paymentRows.length} payments will be offered. This writes to your gym — and any line already recorded from an earlier run is recognised and skipped, so running the same file twice does not double a month's takings.`}
            >
              <div style={{ ...formRow, borderBottom: 'none' }}>
                <button onClick={runImport} disabled={busy || !tenantId || !ccy} style={primaryBtn}>
                  {busy ? 'Importing…' : ccy ? `Record ${paymentRows.length} payments in ${ccy}` : `Record ${paymentRows.length} payments`}
                </button>
                {!tenantId ? <span style={{ fontSize: 13, color: 'var(--crit)' }}>{NO_TENANT}</span> : null}
                {tenantId && !ccy ? (
                  <span style={{ fontSize: 13, color: 'var(--crit)' }}>
                    These payments cannot be recorded: {NO_CURRENCY_NOTE}, and this file does not
                    carry one. Every row would be stored in a currency nobody chose, permanently.
                    An owner sets it on the gym settings screen.
                  </span>
                ) : null}
                <Result done={done} />
              </div>
              <Failures failed={failed} />
            </Section>
          ) : null}

          {/*
            The confirm step for members, and it is a different verb from the
            two below it: nothing here writes a membership. It records an
            invitation per row, which the person accepts with their own account,
            at which point accept_member_invite opens the membership on the plan
            named here.

            The list is shown by name, address and plan before the button, so
            pressing it is a decision about known content rather than a count.
          */}
          {kind === 'members' && inviteDrafts && inviteDrafts.send.length > 0 ? (
            <Section
              title="Invite"
              sub={`${inviteDrafts.send.length} invitation${inviteDrafts.send.length === 1 ? '' : 's'} will be recorded. This writes to your gym; it does not create anybody an account.`}
            >
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {inviteDrafts.send.slice(0, 60).map((d) => (
                  <div key={d.line} style={{
                    display: 'flex', gap: 12, padding: '8px 14px',
                    borderTop: '1px solid var(--ring)', fontSize: 12.5, alignItems: 'baseline',
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {d.line}</span>
                    <span style={{ color: 'var(--ink)', flex: 1 }}>{d.fullName ?? <span className="dash">no name in the file</span>}</span>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink2)', flex: 1 }}>{d.email}</span>
                    <span style={{ color: 'var(--ink3)', minWidth: 130 }}>
                      {/* What this row WILL carry, not what the sheet said: a
                          plan name the gym does not sell becomes no plan, and
                          the invitation says so here rather than at the desk. */}
                      {d.planId
                        ? d.planName
                        : (d.planName ?? '').trim()
                          ? <span className="dash">“{d.planName}” — not a plan you sell</span>
                          : <span className="dash">no plan</span>}
                    </span>
                    <span style={{ color: 'var(--ink3)', minWidth: 74 }}>{DEFAULT_VALID_DAYS} days</span>
                  </div>
                ))}
                {inviteDrafts.send.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {inviteDrafts.send.length - 60} more, all of which will be invited. Showing
                    the first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
              <div style={{ ...formRow, borderBottom: 'none', borderTop: '1px solid var(--ring)' }}>
                <button onClick={runInviteImport} disabled={busy || !tenantId} style={primaryBtn}>
                  {busy ? 'Inviting…' : `Invite ${inviteDrafts.send.length} ${inviteDrafts.send.length === 1 ? 'person' : 'people'}`}
                </button>
                {!tenantId ? <span style={{ fontSize: 13, color: 'var(--crit)' }}>{NO_TENANT}</span> : null}
                <Result done={done} />
              </div>
              <Failures failed={failed} />
            </Section>
          ) : null}

          {/* What this file cannot invite, and why — one line per row, by the
              line number down the side of their spreadsheet. Skipped rows are
              never silently dropped: a gym that pastes two hundred members and
              is told about a hundred and ninety would go looking for the ten. */}
          {kind === 'members' && inviteDrafts
            && (inviteDrafts.noAddress.length > 0 || inviteDrafts.rejected.length > 0) ? (
            <Section
              title={`${inviteDrafts.noAddress.length + inviteDrafts.rejected.length} cannot be invited`}
              sub="These rows are fine as spreadsheet — they simply cannot become an invitation. Nothing here is written."
            >
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {inviteDrafts.noAddress.slice(0, 40).map((r) => (
                  <div key={`n${r.line}`} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {r.line}</span>
                    <span style={{ color: 'var(--ink2)' }}>
                      {r.value?.name ? `${r.value.name} — ` : ''}no email address in this row, and an
                      invitation is addressed to one. Add the address to your sheet, or invite them
                      by hand once you have it.
                    </span>
                  </div>
                ))}
                {inviteDrafts.rejected.slice(0, 40).map(({ row, reason }) => (
                  <div key={`r${row.line}`} style={{ display: 'flex', gap: 12, padding: '8px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5 }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {row.line}</span>
                    <span style={{ color: 'var(--ink2)' }}>{row.email} — {reason}</span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {/*
            The confirm step for plans. Everything above this is a dry run; this
            is the only place a plan reaches the database, and it lists the rows
            by name and price first so that pressing the button is a decision
            about known content rather than a number.
          */}
          {kind === 'plans' && planRows.length > 0 ? (
            <Section
              title="Import"
              sub={`${planRows.length} plan${planRows.length === 1 ? '' : 's'} will be added to your price book. This writes to your gym.`}
            >
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {planRows.slice(0, 60).map(({ line, plan }) => (
                  <div key={line} style={{
                    display: 'flex', gap: 12, padding: '8px 14px',
                    borderTop: '1px solid var(--ring)', fontSize: 12.5, alignItems: 'baseline',
                  }}>
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 44 }}>line {line}</span>
                    <span style={{ color: 'var(--ink)', flex: 1 }}>{plan.name}</span>
                    {/* The preview shows the price in the currency it WILL BE
                        WRITTEN in — the sheet's where the sheet says, the gym's
                        where it does not — so that pressing the button is a
                        decision about the row that actually lands. A preview
                        that showed one currency and wrote another is the exact
                        shape of the payment-form bug this change exists to
                        close. */}
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink2)' }}>
                      {money(plan.priceCents, plan.currency ?? ccy) ?? '—'}
                    </span>
                    <span style={{ color: 'var(--ink3)', minWidth: 68 }}>
                      {plan.interval === 'once' ? 'one-off' : `per ${plan.interval}`}
                    </span>
                    <span style={{ color: 'var(--ink3)', minWidth: 54 }}>
                      {plan.active ? 'on sale' : 'retired'}
                    </span>
                  </div>
                ))}
                {planRows.length > 60 ? (
                  <p style={{ margin: '10px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>
                    …and {planRows.length - 60} more, all of which will be imported. Showing the
                    first 60 so the page stays readable.
                  </p>
                ) : null}
              </div>
              <div style={{ ...formRow, borderBottom: 'none', borderTop: '1px solid var(--ring)' }}>
                <button onClick={runPlanImport} disabled={busy || !tenantId || (!ccy && planRows.some(({ plan }) => !plan.currency))} style={primaryBtn}>
                  {busy
                    ? 'Importing…'
                    : `Add ${planRows.length} plan${planRows.length === 1 ? '' : 's'}`}
                </button>
                {!tenantId ? <span style={{ fontSize: 13, color: 'var(--crit)' }}>{NO_TENANT}</span> : null}
                {tenantId && !ccy && planRows.some(({ plan }) => !plan.currency) ? (
                  <span style={{ fontSize: 13, color: 'var(--crit)' }}>
                    Some of these rows have no currency of their own and {NO_CURRENCY_NOTE}, so there
                    is nothing to price them in. Add a `currency` column to the sheet, or set the
                    gym's currency on the settings screen.
                  </span>
                ) : null}
                <Result done={done} />
              </div>
              <Failures failed={failed} />
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}

/* ── local presentation ────────────────────────────────────────────────────── */

/**
 * Say what a finished run actually did.
 *
 * The one sentence this must never produce is "12 plans imported" when five
 * landed. A run that only partly succeeded is named as such and gives both
 * numbers, and it says what to do next, because the obvious instinct — paste
 * the file again — would import everything that did land a second time.
 */
function report(ok: number, bad: number, noun: string, verb: string): { text: string; outcome: Outcome } {
  const s = (n: number) => (n === 1 ? '' : 's');
  if (ok === 0 && bad === 0) return { text: 'Nothing was written.', outcome: 'none' };
  if (bad === 0) return { text: `All ${ok} ${noun}${s(ok)} ${verb}.`, outcome: 'all' };
  if (ok === 0) {
    return {
      text: `Nothing was written. All ${bad} ${noun}${s(bad)} were refused — the reasons are below.`,
      outcome: 'none',
    };
  }
  return {
    text: `Partly imported: ${ok} of ${ok + bad} ${noun}${s(ok + bad)} ${verb}, and ${bad} could not `
      + `be written. The ${ok} that landed are saved — fix the lines below and paste only those, `
      + `or the rest will be imported twice.`,
    outcome: 'partial',
  };
}

/**
 * Every import this gym has run, and the way back from one.
 *
 * The receipt exists because the question an owner actually asks is "did last
 * Tuesday's import work?", and until now there was nowhere to look — least of
 * all when the true answer was "partly". A run with rows written and no finish
 * time is the shape of a browser closed halfway through, and it is the row that
 * most needs to be visible.
 */
function Runs({ runs, error, zone, onUndo, undoing, message }: {
  runs: ImportRun[] | null;
  error: string | null;
  /** `tenants.timezone`, or null when the gym has not set one. */
  zone: string | null;
  onUndo: (r: ImportRun) => void;
  undoing: string | null;
  message: string | null;
}) {
  // Nothing at all before the first read returns: an empty receipt flashing up
  // and then filling in reads as "you have never imported anything", which is
  // the sentence that makes somebody paste the file again to be safe.
  if (runs === null && !error) return null;
  if (runs !== null && runs.length === 0 && !message) return null;

  return (
    <Section
      title="Imports you have run"
      sub="What each run offered, wrote and skipped. A payments run can be taken back — the payments are deleted, so every total returns to what it was, and the receipt stays."
    >
      {error ? (
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--crit)' }}>
          {error}. This is not a gym that has never imported anything — it is a read that failed,
          and running a file now cannot be checked against what you have already run. The line-level
          dedupe still holds either way: the database recognises a line it already has.
        </p>
      ) : null}
      {message ? (
        <p style={{ margin: '12px 14px', fontSize: 13, color: 'var(--ink2)' }}>{message}</p>
      ) : null}
      {(runs ?? []).map((r) => (
        <div key={r.id} style={{
          display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap',
          padding: '10px 14px', borderTop: '1px solid var(--ring)', fontSize: 12.5,
        }}>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink3)', minWidth: 150 }}>
            {gymDateTimeText(r.startedAt, zone) ?? 'a time that could not be read'}
          </span>
          <span style={{ color: 'var(--ink2)', minWidth: 70 }}>{r.kind}</span>
          <span style={{ color: 'var(--ink2)', flex: 1, minWidth: 260 }}>
            {r.finishedAt === null ? (
              // The one line on this screen worth reading twice.
              <span style={{ color: 'var(--warn)' }}>
                Never finished — {r.rowsOffered} line{r.rowsOffered === 1 ? '' : 's'} were offered and
                this run never reported back. Some may have been written. Run the same file again:
                anything already recorded is recognised and skipped.
              </span>
            ) : (
              <>
                {r.rowsWritten} written
                {r.rowsSkipped > 0 ? ` · ${r.rowsSkipped} already there` : ''}
                {r.rowsFailed > 0 ? ` · ${r.rowsFailed} refused` : ''}
                {' '}of {r.rowsOffered} offered
              </>
            )}
          </span>
          {r.undoneAt ? (
            <span style={{ color: 'var(--ink3)' }}>taken back {gymDateText(r.undoneAt, zone) ?? 'on a date that could not be read'}</span>
          ) : r.kind === 'payments' ? (
            <button
              onClick={() => onUndo(r)}
              disabled={undoing === r.id}
              style={{ ...linkBtn, color: 'var(--crit)' }}
            >
              {undoing === r.id ? 'Removing…' : 'Take it back'}
            </button>
          ) : (
            // Plans and invitations are not undone from here, and saying so is
            // better than a greyed-out button nobody can explain: an invitation
            // already sent cannot be unsent, and a plan somebody is already on
            // must not vanish from underneath their membership.
            <span style={{ color: 'var(--ink3)' }}>no undo</span>
          )}
        </div>
      ))}
    </Section>
  );
}

/**
 * Say what a payments run did, including the case the old wording had no words
 * for: lines the database recognised as already imported.
 *
 * That case is now the COMMON one — re-running a whole file after fixing a few
 * lines is the safe move, and it produces a run that is almost entirely skips.
 * `report()` would have called that "nothing was written", which reads as a
 * failure and is the opposite of what happened.
 */
function paymentReport(
  out: { written: number; skipped: number; failed: { line: number }[] },
  receiptErr: string | null,
): { text: string; outcome: Outcome } {
  const s = (n: number) => (n === 1 ? '' : 's');
  const bad = out.failed.length;
  const already = out.skipped > 0
    ? ` ${out.skipped} line${s(out.skipped)} ${out.skipped === 1 ? 'was' : 'were'} already in the ledger and ${out.skipped === 1 ? 'was' : 'were'} skipped, not written twice.`
    : '';
  const receipt = receiptErr
    ? ` The payments are recorded, but this import's receipt could not be closed (${receiptErr}), so its counts below may be blank.`
    : '';

  if (bad === 0 && out.written === 0 && out.skipped > 0) {
    return {
      text: `Nothing new to write — every one of the ${out.skipped} line${s(out.skipped)} in this file is already recorded. Running it again changed nothing.${receipt}`,
      outcome: 'all',
    };
  }
  if (bad === 0 && out.written === 0) return { text: `Nothing was written.${receipt}`, outcome: 'none' };
  if (bad === 0) {
    return { text: `${out.written} payment${s(out.written)} recorded.${already}${receipt}`, outcome: 'all' };
  }
  if (out.written === 0 && out.skipped === 0) {
    return {
      text: `Nothing was written. All ${bad} payment${s(bad)} were refused — the reasons are below.${receipt}`,
      outcome: 'none',
    };
  }
  return {
    text: `Partly imported: ${out.written} payment${s(out.written)} recorded and ${bad} refused.${already}`
      + ' Fix the lines below and run the whole file again — the ones that landed are recognised and'
      + ` will not be written twice.${receipt}`,
    outcome: 'partial',
  };
}

const OUTCOME_COLOUR: Record<Outcome, string> = {
  all: 'var(--ink2)',
  partial: 'var(--warn)',
  none: 'var(--crit)',
};

/**
 * The ONLY confirmation after a bulk money write, and it was silent.
 *
 * This renders sentences like "Partly imported: 12 payment(s) recorded and 8
 * refused" into a bare `<span>`, so a member of staff pressed Import, heard
 * nothing, and read a partial failure as success — on a forty-payment write
 * into the gym's ledger.
 *
 * `<Announce>` rather than a role on the span, because the span is not there
 * until there is something to say, and a node inserted at the same instant as
 * its text is not reliably announced. The region is mounted whether or not
 * `done` is set; only the text changes. See studio-web/components/Banner.tsx.
 */
function Result({ done }: { done: { text: string; outcome: Outcome } | null }) {
  return (
    <>
      <Announce say={done?.text ?? null} tone={done && done.outcome !== 'all' ? 'crit' : undefined} />
      {done ? (
        <span style={{ fontSize: 13, color: OUTCOME_COLOUR[done.outcome], flex: 1, minWidth: 220 }}>
          {done.text}
        </span>
      ) : null}
    </>
  );
}

function Failures({ failed }: { failed: { line: number; why: string }[] }) {
  if (!failed.length) return null;
  return (
    <div style={{ padding: '0 14px 14px' }}>
      {failed.slice(0, 20).map((f) => (
        <div key={f.line} style={{ fontSize: 12.5, color: 'var(--crit)' }}>line {f.line}: {f.why}</div>
      ))}
      {failed.length > 20 ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 4 }}>
          …and {failed.length - 20} more that could not be written.
        </div>
      ) : null}
    </div>
  );
}

// Named `Note`, so the sweep that moved six console pages onto the shared
// banner — which greps for `function Banner` — never listed it either. This is
// the screen where a bulk money write reports what it did.
function Note({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <SharedBanner
      tone={tone === 'warn' ? 'warn' : undefined}
      live={false}
      style={{ margin: '0 0 22px', lineHeight: 1.55 }}
    >
      {children}
    </SharedBanner>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One example header row per kind, using the aliases the importer recognises. */
const PLACEHOLDERS: Record<Kind, string> = {
  payments: 'member,amount,date,method\nJane Okafor,250.00,04/03/2026,card',
  members: 'name,email,plan,started,status\nJane Okafor,jane@example.com,Monthly,04/03/2025,active',
  plans: 'name,price,interval,currency,active\nMonthly,250.00,month,AED,yes\nDay pass,40.00,once,AED,yes',
};

const NO_TENANT =
  'Your account is not attached to a gym yet, so there is nowhere to write this.';

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--brand)', fontSize: 12.5, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};
