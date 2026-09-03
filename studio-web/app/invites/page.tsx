'use client';

// Invites — the only way a person becomes a member of this gym.
//
// `memberships.member_id` is `uuid not null references profiles(id)`, so a
// membership cannot exist before the person does. An invite is the intermediate
// record 37-member-invites.sql exists to hold: the gym's intention to enrol
// somebody, kept until there is an account to attach it to.
//
// Every write behind this screen has been in src/lib/memberInvites.ts, tested,
// since the invite work landed — and until now `createInvite`, `createInvites`
// and `extendInvite` had not one caller anywhere in the product. /members read
// the list and summarised it; nothing could add to it. An owner with two
// hundred members on a spreadsheet had a console that could count invitations
// and not send one.
//
// The one rule this screen is built around: the three states an invite is IN
// are the three somebody decided — pending, accepted, revoked — and 'expired'
// is not stored anywhere. It is what pending becomes once the clock passes, and
// `inviteState` derives it at read time so this screen, the invitee's app and
// accept_member_invite in SQL cannot disagree about whether a link still works.
//
// ── The word this screen is no longer allowed to use ───────────────────────
//
// It said SENT. A column headed "Sent" over `created_at`, a KPI reading "Sent,
// all time", a button that said "Sending…" while it inserted a row, and a send
// path that was `navigator.clipboard.writeText`. Nothing behind any of that
// leaves the building: there is no transactional sender, so an owner reading
// "Sent 14 Aug" beside an address was reading the day they TYPED IT IN. The
// worst version is an owner deciding somebody ignored them, when what actually
// happened is that the message was copied to a clipboard and never pasted.
//
// So the screen now separates the three facts src/lib/inviteDelivery.ts sets
// out: the invitation was WRITTEN DOWN (the row, and `created_at` is when), it
// was HANDED OFF from this console (this browser opened your mail or filled
// your clipboard — a note kept in this browser and labelled as this browser),
// and it was DELIVERED (nobody knows; that is the edge function this console
// does not have, and the honest rendering of an unasked question is not "yes").
// The reminder is composed here too, because chasing an invitation nobody
// answered is the commonest thing an owner wants and there was no second
// message anywhere in the product.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, loadMe, type Me } from '@/lib/supabase';
import { Shell } from '@/components/Shell';
import { DataTable, type Column } from '@/components/DataTable';
import { fetchPlans, type MembershipPlan } from '@lib/gymRecord';
import {
  fetchInvites, createInvite, createInvites, extendInvite, revokeInvite,
  inviteState, daysUntilExpiry, inviteBlocker, screenInvites, summariseInvites,
  normaliseEmail, DEFAULT_VALID_DAYS,
  inviteMessage, inviteMailto, bulkInviteMailto,
  type MemberInvite, type MemberInviteState, type NewMemberInvite,
} from '@lib/memberInvites';
import {
  readHandoffs, writeHandoffs, noteHandoff, pruneHandoffs, handoffNote,
  remindable, reminderMailto, reminderMessage, REMIND_AFTER_DAYS,
  type HandoffLog, type HandoffChannel,
} from '@lib/inviteDelivery';
import { searchRows, searchNote } from '@lib/consoleSearch';
import { BRAND } from '@lib/brands';
import { Banner } from '@/components/Banner';

/** How each state reads, and in what colour. Nothing here says "failed": an
 *  invitation nobody answered has not failed, it has not been answered. */
const STATE_LABEL: Record<MemberInviteState, string> = {
  pending: 'waiting',
  accepted: 'joined',
  revoked: 'withdrawn',
  expired: 'lapsed',
};

const STATE_COLOUR: Record<MemberInviteState, string> = {
  pending: 'var(--brand)',
  accepted: 'var(--good)',
  revoked: 'var(--ink3)',
  expired: 'var(--crit)',
};

export default function Invites() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [gymName, setGymName] = useState<string | null>(null);
  const [gymNameUnread, setGymNameUnread] = useState(false);

  // Null is "not read yet, or the read failed"; [] is "read, and the gym has
  // none". They are different facts and nothing below renders them the same
  // way — an empty table under a failed query would tell an owner they have
  // never invited anybody, and they would invite two hundred people twice.
  const [invites, setInvites] = useState<MemberInvite[] | null>(null);
  const [invitesErr, setInvitesErr] = useState<string | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [plansErr, setPlansErr] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    // Two reads, deliberately not one Promise.all behind a single catch. A price
    // book that will not load must not empty the invitation list with it.
    const [iRes, pRes] = await Promise.allSettled([
      fetchInvites(supabase, tenantId),
      fetchPlans(supabase, tenantId),
    ]);
    if (iRes.status === 'fulfilled') { setInvites(iRes.value); setInvitesErr(null); }
    else { setInvites(null); setInvitesErr(iRes.reason?.message ?? 'Could not read the invitations.'); }
    if (pRes.status === 'fulfilled') { setPlans(pRes.value); setPlansErr(null); }
    else { setPlans(null); setPlansErr(pRes.reason?.message ?? 'Could not read the price book.'); }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await loadMe();
      if (!live) return;
      setMe(who);
      if (!who?.tenantId) { setInvites([]); setPlans([]); return; }
      // supabase-js resolves with { data, error } on a database error rather
      // than rejecting, so the error is read off the result. Without it a
      // refused read arrives as t === null and the rail says "No gym linked" —
      // a claim about the owner's account, in the branch where the account
      // demonstrably has a tenant.
      const { data: t, error: tErr } = await supabase
        .from('tenants').select('name').eq('id', who.tenantId).single();
      if (live) {
        setGymName(tErr ? null : ((t as any)?.name ?? null));
        setGymNameUnread(!!tErr);
      }
      await load(who.tenantId);
    })();
    return () => { live = false; };
  }, [load]);

  const summary = useMemo(() => (invites ? summariseInvites(invites) : null), [invites]);

  // The addresses this gym already has an open invitation for. Only ever from a
  // list that was actually read: [] on a failed read would tell the form there
  // are no open invitations, and the duplicate would then be refused by the
  // partial unique index instead — after the owner had typed it.
  const openTo = useMemo(
    () => (invites ?? []).filter((i) => inviteState(i) === 'pending').map((i) => i.email),
    [invites],
  );

  if (me === undefined) return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
  if (me === null) return <div style={{ padding: 40 }}><a href="/">Sign in</a></div>;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/invites">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are —
          which is not the same as you not having access. Reload the page; if it
          keeps happening the database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/invites">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
          An invitation puts somebody on this gym&rsquo;s roster, so it is owner-only.
          The database says the same thing independently — <span className="mono">mi_owner</span> is
          scoped to the owner of this particular gym.
        </p>
      </Shell>
    );
  }

  const tenantId = me.tenantId!;
  const refresh = () => load(tenantId);
  const unread = invites === null;

  return (
    <Shell me={me} gymName={gymName} gymNameUnread={gymNameUnread} current="/invites">
      <h1>Invites</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13 }}>
        A membership belongs to a person, not to a row of spreadsheet text. This
        is where the person is asked.
      </p>

      {/* This said "Nothing here sends an email", which was true and was the
          whole gap: an invite is a row addressed to somebody who has not been
          told. The console composes the message and hands it to the owner's own
          mail client now — see `inviteMessage` in src/lib/memberInvites.ts for
          why that, and not a magic link. What it must not then do is call that
          "sent": the sentence below names the sender it does not have, and the
          columns below it are worded the same way. */}
      <Banner>
        An invitation is a record against an address — this gym&rsquo;s intention to enrol
        somebody, held until they have a Repple account for it to attach to. There is no
        transactional sender behind this console, so <strong style={{ color: 'var(--ink)' }}>Send
        opens your own mail</strong> with the message written and the address filled in; what goes
        out is in your sent folder, where you can see it. The one thing the message must carry is
        the exact address to sign up with — an account made with a different one never sees the
        invitation.
      </Banner>
      <Banner>
        <strong style={{ color: 'var(--ink)' }}>Nothing here can tell you a message arrived.</strong>{' '}
        Delivery, a bounce and an unsubscribe all need a sender this console does not have, so no
        column below claims any of them. What the list does record is what{' '}
        <em>this browser</em> did — that you opened your mail on an invitation, or copied it — and
        it says &ldquo;on this browser&rdquo; every time, because your phone and the front desk
        machine keep their own notes and none of them is proof that anybody read it.
      </Banner>

      {invitesErr ? (
        <Banner tone="crit">
          The invitations could not be read: {invitesErr}. Everything below is{' '}
          <strong style={{ color: 'var(--ink)' }}>unknown</strong>, not none — this is not a gym that
          has invited nobody. Reload before sending the list again, or you will send it twice.
        </Banner>
      ) : null}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 1, background: 'var(--ring)', border: '1px solid var(--ring)',
          borderRadius: 0, overflow: 'hidden', margin: '20px 0 26px',
        }}
      >
        {/* "Sent, all time" over a count of ROWS. The figure was right and the
            word was not: this is how many invitations the gym has written down,
            which is the only one of the three facts the database holds. */}
        <Kpi label="Written down, all time" text={summary ? String(summary.total) : null}
             note={unread ? 'the invitations could not be read' : 'recorded here — not a delivery count'} />
        <Kpi label="Waiting" text={summary ? String(summary.pending) : null}
             note={summary ? 'still open, still redeemable' : undefined} />
        <Kpi label="Joined" text={summary ? String(summary.accepted) : null} />
        <Kpi label="Lapsed" text={summary ? String(summary.expired) : null}
             note={summary && summary.expired > 0 ? 'extend one below rather than sending it again' : undefined} />
        <Kpi
          label="Accepted, of settled"
          // Null, never 0%: a gym that sent its first batch this morning has no
          // acceptance rate, and 0% reads as two hundred refusals.
          text={summary?.acceptanceRate == null ? null : `${Math.round(summary.acceptanceRate * 100)}%`}
          note={summary == null ? undefined
            : summary.acceptanceRate == null ? 'nobody has answered yet'
            : 'the waiting ones are not in this figure'}
        />
      </div>

      <InviteOne
        tenantId={tenantId} me={me} plans={plans} plansErr={plansErr}
        openTo={openTo} listRead={!unread} onChange={refresh}
      />
      <InviteMany
        tenantId={tenantId} me={me} plans={plans} plansErr={plansErr}
        openTo={openTo} listRead={!unread} onChange={refresh}
      />
      <TheList
        invites={invites} readErr={invitesErr} gymName={gymName}
        tenantId={tenantId} onChange={refresh}
      />
    </Shell>
  );
}

/* ── one person ────────────────────────────────────────────────────────────── */

function InviteOne({ tenantId, me, plans, plansErr, openTo, listRead, onChange }: {
  tenantId: string; me: Me; plans: MembershipPlan[] | null; plansErr: string | null;
  openTo: string[]; listRead: boolean; onChange: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState(String(DEFAULT_VALID_DAYS));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // Said while they are still typing, not after the round trip. Only checked
  // against the open invitations when the list actually read — otherwise the
  // duplicate rule is left to the database, which enforces it properly.
  const blocker = email.trim() ? inviteBlocker(email, listRead ? openTo : []) : null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const stop = inviteBlocker(email, listRead ? openTo : []);
    if (stop) { setWriteErr(stop); return; }
    const validDays = days.trim() === '' ? null : parseInt(days, 10);
    if (validDays !== null && (!Number.isFinite(validDays) || validDays < 1)) {
      setWriteErr('How many days should it stay open? Leave it blank for the gym’s default.');
      return;
    }
    setBusy(true); setWriteErr(null); setMsg(null);
    try {
      await createInvite(supabase, tenantId, {
        email: email.trim(),
        fullName: name.trim() || null,
        planId: planId || null,
        validDays,
      }, me.id);
      setMsg(`Invitation recorded for ${email.trim()}. It is written down, not sent — Send or Copy it from the list below.`);
      setEmail(''); setName('');
      onChange();
    } catch (x: any) {
      // The address stays in the box on purpose: nothing was written, so there
      // is something to retry.
      setWriteErr(`That invitation was not recorded: ${x?.message ?? 'the write was refused'}. Nothing has been written against that address.`);
    } finally { setBusy(false); }
  };

  return (
    <Section
      title="Invite one member"
      sub="The name is what your gym calls them — it fills in only if they have not set one themselves."
    >
      <form onSubmit={send} style={formRow}>
        <input
          value={email} onChange={(e) => { setEmail(e.target.value); setWriteErr(null); }}
          placeholder="Email address" inputMode="email"
          style={{ ...field, flex: 2, minWidth: 200 }}
        />
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)" style={{ ...field, flex: 2, minWidth: 150 }}
        />
        <PlanPicker plans={plans} plansErr={plansErr} value={planId} onChange={setPlanId} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          open for
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={{ ...field, width: 62 }} />
          days
        </label>
        {/* "Sending…" over an INSERT. What this button does is write the
            invitation down; the sending is the Send beside it in the list, and
            it happens in the owner's own mail client. */}
        <button type="submit" disabled={busy} style={primaryBtn}>{busy ? 'Recording…' : 'Invite'}</button>
      </form>
      {blocker && !writeErr ? (
        <p style={{ margin: '0 14px 12px', fontSize: 12.5, color: '#f0c04e' }}>{blocker}</p>
      ) : null}
      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}
      {msg ? <p style={{ margin: '0 14px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}
    </Section>
  );
}

/* ── a list of people ──────────────────────────────────────────────────────── */

/** One line of the bulk box: an address, and optionally a name after a comma. */
function parseLine(line: string): { email: string; fullName: string | null } | null {
  const raw = line.trim();
  if (!raw) return null;
  // "jane@example.com, Jane Okafor" and "Jane Okafor <jane@example.com>" are
  // both what people actually paste. The address is whichever field looks like
  // one; nothing is guessed beyond that, and a line with no address at all is
  // handed to `inviteBlocker` to be refused with a reason rather than dropped.
  const angle = raw.match(/<([^>]+)>/);
  if (angle) {
    return { email: angle[1].trim(), fullName: raw.slice(0, raw.indexOf('<')).trim().replace(/,$/, '') || null };
  }
  const parts = raw.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return { email: parts[0], fullName: null };
  const emailPart = parts.find((p) => normaliseEmail(p) !== null) ?? parts[0];
  const rest = parts.filter((p) => p !== emailPart).join(' ').trim();
  return { email: emailPart, fullName: rest || null };
}

function InviteMany({ tenantId, me, plans, plansErr, openTo, listRead, onChange }: {
  tenantId: string; me: Me; plans: MembershipPlan[] | null; plansErr: string | null;
  openTo: string[]; listRead: boolean; onChange: () => void;
}) {
  const [text, setText] = useState('');
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState(String(DEFAULT_VALID_DAYS));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { sent: number; rejected: { line: number; email: string; reason: string }[] } | null
  >(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // The dry run. Every line is screened before anything is written — including
  // duplicates WITHIN the box, which would otherwise pass line-by-line and then
  // fail the single insert halfway through.
  const screened = useMemo(() => {
    const rows = text.split('\n').map((l, i) => ({ line: i + 1, parsed: parseLine(l) }))
      .filter((r): r is { line: number; parsed: { email: string; fullName: string | null } } => r.parsed !== null)
      .map((r) => ({ line: r.line, email: r.parsed.email, fullName: r.parsed.fullName }));
    if (!rows.length) return null;
    return screenInvites(rows, listRead ? openTo : []);
  }, [text, openTo, listRead]);

  const send = async () => {
    if (!screened || !screened.send.length) return;
    const validDays = days.trim() === '' ? null : parseInt(days, 10);
    if (validDays !== null && (!Number.isFinite(validDays) || validDays < 1)) {
      setWriteErr('How many days should these stay open? Leave it blank for the gym’s default.');
      return;
    }
    setBusy(true); setWriteErr(null); setResult(null);
    const drafts: NewMemberInvite[] = screened.send.map((r) => ({
      email: r.email, fullName: r.fullName, planId: planId || null, validDays,
    }));
    try {
      const out = await createInvites(supabase, tenantId, drafts, me.id);
      // Both halves of the answer: what the library refused (it screens again,
      // over the same rule) and what this screen had already refused. Reported
      // by the line number in the box, because "row 12" is findable and a
      // position in a filtered array is not.
      const byEmail = new Map(screened.send.map((r) => [normaliseEmail(r.email), r.line]));
      setResult({
        sent: out.sent,
        rejected: [
          ...screened.rejected.map((r) => ({ line: r.row.line, email: r.row.email, reason: r.reason })),
          ...out.rejected.map((r) => ({
            line: byEmail.get(normaliseEmail(r.row.email)) ?? 0,
            email: r.row.email,
            reason: r.reason,
          })),
        ].sort((a, b) => a.line - b.line),
      });
      if (out.sent > 0) { setText(''); onChange(); }
    } catch (x: any) {
      // createInvites inserts the batch in one statement, so a refusal means
      // NOT ONE of them landed. Saying so is what stops the owner pasting the
      // list again minus the rows they think went through.
      setWriteErr(`Not one of these invitations was recorded: ${x?.message ?? 'the write was refused'}. The whole batch is written in one go, so nothing has changed and the list above is still to record.`);
    } finally { setBusy(false); }
  };

  return (
    <Section
      title="Invite a list"
      sub="One address per line. A name may follow after a comma. Nothing is written until you press the button, and you see what will happen first. Writing them down is not sending them — that is Send, one at a time or as one batch mail, below."
    >
      <div style={{ padding: '12px 14px' }}>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); setWriteErr(null); }}
          rows={6}
          placeholder={'jane@example.com, Jane Okafor\nsam@example.com'}
          style={{ ...field, width: '100%', fontFamily: 'var(--mono)', fontSize: 12.5, resize: 'vertical' }}
        />
      </div>
      <div style={{ ...formRow, borderTop: '1px solid var(--ring)' }}>
        <PlanPicker plans={plans} plansErr={plansErr} value={planId} onChange={setPlanId} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)', fontSize: 12.5 }}>
          open for
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={{ ...field, width: 62 }} />
          days
        </label>
        <button
          onClick={send}
          disabled={busy || !screened || screened.send.length === 0}
          style={primaryBtn}
        >
          {busy ? 'Recording…' : screened ? `Invite ${screened.send.length}` : 'Invite'}
        </button>
        {screened ? (
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
            {screened.send.length} to write down
            {screened.rejected.length ? ` · ${screened.rejected.length} cannot be` : ''}
          </span>
        ) : null}
      </div>

      {screened && screened.rejected.length ? (
        <div style={{ padding: '0 14px 14px' }}>
          {screened.rejected.slice(0, 20).map(({ row, reason }) => (
            <div key={row.line} style={{ fontSize: 12.5, color: '#f0c04e' }}>
              line {row.line}: {row.email || '(blank)'} — {reason}
            </div>
          ))}
          {screened.rejected.length > 20 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 4 }}>
              …and {screened.rejected.length - 20} more that cannot be recorded. These are
              skipped; the rest are still written down.
            </div>
          ) : null}
        </div>
      ) : null}

      {writeErr ? <Banner tone="crit">{writeErr}</Banner> : null}

      {result ? (
        <div style={{ padding: '0 14px 14px' }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: result.sent ? 'var(--ink2)' : '#ef8080' }}>
            {result.sent === 0
              ? 'Nothing was recorded.'
              : `${result.sent} invitation${result.sent === 1 ? '' : 's'} recorded.`}
            {result.rejected.length
              ? ` ${result.rejected.length} line${result.rejected.length === 1 ? ' was' : 's were'} skipped — they are listed below and none of them was written.`
              : ''}
          </p>
          {result.rejected.slice(0, 20).map((r) => (
            <div key={`${r.line}:${r.email}`} style={{ fontSize: 12.5, color: '#ef8080' }}>
              line {r.line}: {r.email || '(blank)'} — {r.reason}
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/* ── the list ──────────────────────────────────────────────────────────────── */

function TheList({ invites, readErr, gymName, tenantId, onChange }: {
  invites: MemberInvite[] | null; readErr: string | null;
  gymName: string | null; tenantId: string; onChange: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showing, setShowing] = useState<MemberInvite | null>(null);
  const [reminding, setReminding] = useState<MemberInvite | null>(null);

  /**
   * What THIS BROWSER did with each invitation.
   *
   * Not a delivery record and never described as one — see the header, and
   * src/lib/inviteDelivery.ts for why it is deliberately not a database column.
   * Read in an effect rather than in the render body because `localStorage`
   * does not exist while Next prerenders this page on the server.
   */
  const [handoffs, setHandoffs] = useState<HandoffLog>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const store = window.localStorage;
    const read = readHandoffs(store, tenantId);
    // Pruned against a list that actually READ. `fetchInvites` throws past its
    // row cap rather than truncating, so a fulfilled read is the whole set and
    // an id missing from it is genuinely a row that is gone — but a failed read
    // arrives as null, and pruning against that would wipe every note the
    // owner has.
    if (!invites) { setHandoffs(read); return; }
    const kept = pruneHandoffs(read, invites.map((i) => i.id));
    if (Object.keys(kept).length !== Object.keys(read).length) writeHandoffs(store, tenantId, kept);
    setHandoffs(kept);
  }, [tenantId, invites]);

  /** Frozen for the life of the component, for the same reason the analytics
   *  page freezes its clock: "3 days ago" must not tick over mid-read. */
  const [now] = useState(() => Date.now());

  /** Note what this console just did, and say so on screen. A store that
   *  refuses the write — a private window, a full quota — loses the note and
   *  nothing else; the handoff itself already happened. */
  const mark = (ids: string[], how: HandoffChannel) => {
    const next = noteHandoff(handoffs, ids, how, new Date().toISOString());
    setHandoffs(next);
    if (typeof window !== 'undefined') writeHandoffs(window.localStorage, tenantId, next);
  };

  /**
   * The brand's own site, never a hardcoded repplefitness.com.
   *
   * `src/lib/brands.ts` is the single table both app.config.ts and the app
   * bundle read, and it exists precisely so a chain buying Repple does not hand
   * their own members a link to their supplier. It was imported nowhere in this
   * console.
   */
  const site = BRAND.webOrigin ?? null;
  const opts = { gymName, siteUrl: site };

  /** Put the composed message on the clipboard, for the owner whose mail client
   *  mangles a long `mailto:` — and for WhatsApp, which is how a lot of gyms
   *  actually talk to their members. */
  const copy = async (i: MemberInvite) => {
    setErr(null);
    try {
      await navigator.clipboard.writeText(inviteMessage(i, opts));
      // Marked only on the branch where the clipboard actually took it. A
      // refused clipboard that still logged a handoff would be this screen
      // inventing the one thing it exists to stop inventing.
      mark([i.id], 'clipboard');
      setMsg('The invitation is on your clipboard. Paste it wherever you talk to this member — nothing has gone anywhere until you do.');
    } catch {
      // A refused clipboard is a browser permission, not a failure of the
      // record — and the message is on screen below either way.
      setShowing(i);
      setMsg('Your browser would not let this page use the clipboard, so the message is shown below to copy by hand.');
    }
  };

  const extend = async (i: MemberInvite) => {
    setErr(null); setMsg(null);
    try {
      await extendInvite(supabase, i.id, DEFAULT_VALID_DAYS);
      setMsg(`${i.email} now has another ${DEFAULT_VALID_DAYS} days, counted from today.`);
      onChange();
    } catch (x: any) {
      // extendInvite counts the rows it changed, so this fires for a refusal AND
      // for an invite that is no longer pending — both of which leave the
      // original expiry standing, and neither of which may look like success.
      setErr(`${i.email} was not extended: ${x?.message ?? 'the change was refused'}. Its date is unchanged.`);
    }
  };

  const withdraw = async (i: MemberInvite) => {
    if (!confirm(`Withdraw the invitation to ${i.email}?`)) return;
    setErr(null); setMsg(null);
    try {
      await revokeInvite(supabase, i.id);
      setMsg(`The invitation to ${i.email} has been withdrawn.`);
      onChange();
    } catch (x: any) {
      setErr(`The invitation to ${i.email} was not withdrawn: ${x?.message ?? 'the change was refused'}. It is still open.`);
    }
  };

  const shown = searchRows(invites ?? [], q, (i) => [i.email, i.fullName, i.planName, inviteState(i)]);
  const note = searchNote(q, shown.length, invites?.length ?? 0);
  // Only the ones still open. A batch mail to everybody would include people
  // who joined last month and people the gym withdrew.
  const waiting = (invites ?? []).filter((i) => inviteState(i) === 'pending');
  const waitingLink = waiting.length ? bulkInviteMailto(waiting, opts) : null;
  /** Still waiting, and long enough to be worth a second message. Counted off
   *  the handoff when this browser made one and off the row's own date when it
   *  did not — an invitation written a month ago and never handed off anywhere
   *  is precisely the one to chase, and counting from a handoff that never
   *  happened would hide it forever. */
  const toChase = waiting.filter((i) => remindable(i, handoffs[i.id], now));

  const cols: Column<MemberInvite>[] = [
    // "Sent to". Nothing on this screen sends, so the header named an event
    // that had not happened; the address is who it is FOR.
    { key: 'email', header: 'Address', value: (i) => i.email },
    { key: 'name', header: 'Name', value: (i) => i.fullName,
      // Never the address again in this column: a gym that only had an address
      // has not named them, and showing the address twice hides that.
      render: (i) => i.fullName ?? <span className="dash">no name given</span> },
    { key: 'plan', header: 'Plan', value: (i) => i.planName,
      render: (i) => i.planName ?? <span className="dash">sorted at the desk</span> },
    // Was headed "Sent". `created_at` is when the invitation was WRITTEN
    // DOWN — the only one of the three facts the database holds — and an owner
    // reading "Sent 14 Aug" beside an address believed a message went out that
    // day. What happened that day is that they typed it in.
    { key: 'written', header: 'Written down', value: (i) => i.createdAt,
      render: (i) => new Date(i.createdAt).toLocaleDateString() },
    // The second fact, and the only one this console can observe: what this
    // browser did. Never "not sent" for an absent note — the owner may well
    // have sent it from their phone or read it down the telephone, and a
    // console that did not see that does not get to call it a failure.
    { key: 'handed', header: 'Handed off', value: (i) => handoffs[i.id]?.at ?? '',
      render: (i) => {
        const h = handoffs[i.id];
        const text = handoffNote(h, now);
        return h ? <span style={{ color: 'var(--ink2)' }}>{text}</span> : <span className="dash">{text}</span>;
      } },
    { key: 'left', header: 'Days left', value: (i) => daysUntilExpiry(i), numeric: true,
      render: (i) => {
        if (inviteState(i) !== 'pending') return <span className="dash">—</span>;
        const d = daysUntilExpiry(i);
        // Null is "no expiry was recorded", which is not 0 — and 0 reads as
        // "today", which would have the desk chasing somebody with no deadline.
        if (d == null) return <span className="dash">no expiry recorded</span>;
        return <span style={{ color: d <= 3 ? 'var(--crit)' : 'var(--ink)' }}>{d}</span>;
      } },
    { key: 'state', header: 'State', value: (i) => inviteState(i),
      render: (i) => {
        const s = inviteState(i);
        return <span style={{ color: STATE_COLOUR[s] }}>{STATE_LABEL[s]}</span>;
      } },
    { key: 'act', header: '', value: () => '', align: 'right',
      render: (i) => {
        const s = inviteState(i);
        // Only the two states a decision can still be made about. An accepted
        // invitation is a member now, and a withdrawn one stays withdrawn —
        // reopening either by overwriting the row would rewrite what happened.
        if (s === 'accepted' || s === 'revoked') return <span className="dash">—</span>;
        return (
          <span style={{ display: 'inline-flex', gap: 12 }}>
            {/* An anchor rather than a button: `mailto:` is a navigation, and
                window.location.href on a click is the version that gets blocked
                by a popup rule. */}
            <a
              href={inviteMailto(i, opts)} style={{ color: 'var(--brand)' }}
              // Noted on the click, not on the send: what this records is that
              // your mail client was OPENED on it. Whether you then pressed
              // send in that window is not something this page can see, and the
              // column says "opened in your mail" for exactly that reason.
              onClick={() => mark([i.id], 'mail')}
            >Send</a>
            <button style={linkBtn} onClick={() => copy(i)}>Copy</button>
            <button style={linkBtn} onClick={() => { setReminding(null); setShowing(showing?.id === i.id ? null : i); }}>
              {showing?.id === i.id ? 'Hide' : 'Read'}
            </button>
            {/* The chase, which the product had nowhere at all. Offered only
                where it is worth offering: still waiting, and nothing has been
                heard for a week. A lapsed invitation is deliberately NOT
                chaseable — its link is dead, so the honest action there is
                Reopen, which is the button beside it. */}
            {remindable(i, handoffs[i.id], now) ? (
              <>
                <a
                  href={reminderMailto(i, opts, now)} style={{ color: 'var(--brand)' }}
                  onClick={() => mark([i.id], 'mail')}
                >Remind</a>
                <button style={linkBtn} onClick={() => { setShowing(null); setReminding(reminding?.id === i.id ? null : i); }}>
                  {reminding?.id === i.id ? 'Hide' : 'Read reminder'}
                </button>
              </>
            ) : null}
            <button style={linkBtn} onClick={() => extend(i)}>
              {s === 'expired' ? 'Reopen for 30 days' : 'Extend'}
            </button>
            <button style={{ ...linkBtn, color: 'var(--crit)' }} onClick={() => withdraw(i)}>Withdraw</button>
          </span>
        );
      } },
  ];

  return (
    <Section
      title="Invitations"
      sub="Withdrawn, never deleted: “we never invited them” and “we invited them and changed our mind” are different answers to a member standing at the desk."
    >
      {err ? <Banner tone="crit">{err}</Banner> : null}
      {msg ? <p style={{ margin: '12px 14px', fontSize: 12.5, color: 'var(--ink3)' }}>{msg}</p> : null}

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '12px 14px 0', flexWrap: 'wrap' }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search an address, a name or a plan"
          aria-label="Search the invitations"
          style={{ ...field, flex: 1, minWidth: 220 }}
        />
        {q ? <button onClick={() => setQ('')} style={linkBtn}>clear</button> : null}
        {/* One message to everybody still waiting, over BCC. A gym that has just
            imported two hundred addresses does not send two hundred mailtos by
            hand — and BCC rather than To is the difference between a mail-out
            and disclosing the whole membership list to all of it. */}
        {waitingLink ? (
          <a
            href={waitingLink} style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}
            onClick={() => mark(waiting.map((i) => i.id), 'bulk')}
          >
            Mail all {waiting.length} still waiting
          </a>
        ) : null}
      </div>
      {/* Above the table, because a filtered list that comes back empty reads
          exactly like a gym that has invited nobody — and an owner who believes
          that sends the whole batch again. */}
      {note ? <p style={{ margin: 0, padding: '8px 14px 0', fontSize: 12.5, color: 'var(--ink3)' }}>{note}</p> : null}

      {/* Only under a list that read. Under a failed read `toChase` is 0 over
          an empty array, and "nobody is waiting" is the sentence this whole
          screen is built to refuse. */}
      {invites && toChase.length ? (
        <p style={{ margin: 0, padding: '8px 14px 0', fontSize: 12.5, color: 'var(--ink3)' }}>
          {toChase.length} {toChase.length === 1 ? 'invitation has' : 'invitations have'} been waiting
          more than {REMIND_AFTER_DAYS} days with nothing heard back. Remind is beside each of them —
          it opens a second, shorter message in your own mail.
        </p>
      ) : null}

      {showing ? (
        <div style={{ margin: '12px 14px', border: '1px solid var(--ring)', background: 'var(--surface2)', padding: '11px 13px' }}>
          <div className="micro" style={{ marginBottom: 6 }}>What {showing.email} will read</div>
          <pre style={{
            margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--sans)',
            fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5,
          }}>{inviteMessage(showing, opts)}</pre>
        </div>
      ) : null}

      {reminding ? (
        <div style={{ margin: '12px 14px', border: '1px solid var(--ring)', background: 'var(--surface2)', padding: '11px 13px' }}>
          <div className="micro" style={{ marginBottom: 6 }}>The reminder {reminding.email} will read</div>
          <pre style={{
            margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--sans)',
            fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5,
          }}>{reminderMessage(reminding, opts, now)}</pre>
        </div>
      ) : null}

      {invites === null ? (
        readErr ? (
          <div style={{ padding: '26px 20px', color: 'var(--ink3)', fontSize: 13.5 }}>
            The invitations could not be read, so this is <strong style={{ color: 'var(--ink)' }}>unknown</strong>{' '}
            rather than empty. The banner at the top of the page says why.
          </div>
        ) : <Loading />
      ) : (
        <DataTable
          rows={shown} columns={cols} rowKey={(i) => i.id}
          empty="Nobody has been invited yet. Everyone on the roster arrives through one of these."
        />
      )}
    </Section>
  );
}

/* ── bits ──────────────────────────────────────────────────────────────────── */

/** The plan an invite opens the membership on. No plan is a real answer — gyms
 *  do sort the package out at the desk — so the empty option is not a prompt. */
function PlanPicker({ plans, plansErr, value, onChange }: {
  plans: MembershipPlan[] | null; plansErr: string | null;
  value: string; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...field, flex: 2, minWidth: 170 }}>
      {/* A picker holding nothing but "No plan" looks like a gym that sells
          nothing. Say which it is, so nobody invites two hundred people onto no
          plan believing there was none to choose. */}
      <option value="">
        {plans === null
          ? (plansErr ? 'No plan — the price book could not be read' : 'No plan — still reading the price book')
          : 'No plan — sorted at the desk'}
      </option>
      {(plans ?? []).filter((p) => p.active).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

const field = {
  background: 'var(--surface2)', color: 'var(--ink)', border: '1px solid var(--ring)',
  borderRadius: 0, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--sans)', minWidth: 0,
} as const;

const ghostBtn = {
  ...field, background: 'var(--surface2)', color: 'var(--ink2)',
  cursor: 'pointer', flex: 'none',
} as const;

const primaryBtn = {
  background: 'var(--brand)', color: 'var(--brand-ink)', border: 'none', borderRadius: 0,
  padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
} as const;

const linkBtn = {
  background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer',
  fontSize: 12.5, padding: 0, fontFamily: 'var(--sans)',
} as const;

const formRow = {
  display: 'flex', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--ring)',
  flexWrap: 'wrap' as const, alignItems: 'center',
};

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--ring)', borderRadius: 0, background: 'var(--surface)', marginBottom: 22 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--ring)' }}>
        <h2>{title}</h2>
        {sub ? <p style={{ margin: '4px 0 0', color: 'var(--ink3)', fontSize: 12.5 }}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, text, note }: { label: string; text: string | null; note?: string }) {
  return (
    <div style={{ background: 'var(--surface)', padding: '14px 16px' }}>
      <div className="micro">{label}</div>
      <div className="mono" style={{ fontSize: 21, marginTop: 5, letterSpacing: '-0.02em', color: text == null ? 'var(--ink3)' : 'var(--ink)' }}>
        {text ?? '—'}
      </div>
      {note ? <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 3 }}>{note}</div> : null}
    </div>
  );
}

function Loading() {
  return <div style={{ padding: '26px 20px', color: 'var(--ink3)' }}>Loading…</div>;
}
