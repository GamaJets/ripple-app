'use client';

// Sites — an owner with more than one gym, counting them side by side.
//
// ROADMAP #4. Two thirds of it were already built and neither third could
// reach the other:
//
//   · `src/lib/siteRollUp.ts` is 629 tested lines about how a figure over
//     several gyms lies — currencies that cannot be added, zones whose "this
//     month" are different months, and the four distinct reasons a gym
//     contributed nothing. Its only importer was its own test.
//   · `supabase/parts/290` recorded WHO OWNS WHAT and granted nothing else, so
//     there were no numbers to hand it.
//
// `supabase/parts/2614` supplies the numbers — aggregates only, one row per
// owned gym — and this screen is where the two meet.
//
// ── The rule this screen exists to obey ───────────────────────────────────
//
// A total across gyms is only a figure when the gyms agree what it is made of.
// Nothing here adds two currencies, nothing presents two time zones as one
// period, and every gym that contributed nothing says which of the four
// reasons it was. The module decides all of that; this file renders what it
// decided and never second-guesses it — which is why there is no arithmetic
// below, only `rollCount`, `rollMoney` and the notes they produce.
//
// ── What a single-site owner sees ─────────────────────────────────────────
//
// One row, no totals, and no mention that any of this exists. `owner_sites`
// ships empty and `my_sites()` returns the profile's own tenant either way, so
// the ordinary owner gets a one-element list and every cross-site sentence
// below resolves to null. That is asserted in `ownedSites.test.ts` for the
// copy and holds here for the same reason: the roll-up of one gym is that gym.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadMe, ME_UNREADABLE, type Me } from '@/lib/supabase';
import { ConsoleGate } from '@/components/Gate';
import { Shell } from '@/components/Shell';
import { Fetched, useFetched } from '@/components/Fetched';
import { fetchSiteFigures, type SiteFiguresRead } from '@/lib/siteFigures';
import { money } from '@lib/gymRecord';
import {
  orderSites, rollCount, rollMoney, siteMoney, drillInto,
  zoneSpan, periodNote, gapsNote, floorNote, moneyNote,
  type SiteFigures,
} from '@lib/siteRollUp';

/** The window every figure on this screen is for.
 *
 *  Null both ends: everything the gyms have ever recorded. A month would need
 *  a zone to cut it in, and `zoneSpan` below is what decides whether these gyms
 *  even share one — so the period that needs no zone is the one to open on.
 *  `periodNote` still speaks, because "all time" across two zones is a shorter
 *  sentence than "September" but not a zone-free one. */
const SINCE: string | null = null;
const UNTIL: string | null = null;

export default function SitesPage() {
  /**
   * Undefined until the auth call answers, and the other twenty-nine console
   * routes all start here for a reason this one screen did not.
   *
   * It was `useState<Me | null>(null)`, and `ConsoleGate` reads those two
   * values as two different SENTENCES: undefined is "Reading your account…",
   * null is "You are not signed in" with a Sign in link under it. So a signed-in
   * owner opening /sites was told, on first paint and before `loadMe()` had
   * come back, that they were signed out — and the ME_UNREADABLE branch below
   * is worse, because it sets `authUnread` and then leaves `me` at null for
   * good: the gate tests `me === null` BEFORE `failed`, so an auth call that
   * did not come back rendered the signed-out page permanently. That is the
   * exact substitution ME_UNREADABLE exists to prevent — a question this
   * console could not ask, reported as an answer about the reader — on the one
   * route whose whole subject is which gyms the reader owns.
   */
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [authUnread, setAuthUnread] = useState(false);
  const [read, setRead] = useState<SiteFiguresRead>({ status: 'loading', sites: [] });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const who = await loadMe();
      // Not `null`. Signed out and unreachable are different facts and they
      // send a person to two different places — see ME_UNREADABLE.
      if (who === ME_UNREADABLE) { setAuthUnread(true); return; }
      setAuthUnread(false);
      setMe(who);
    })();
  }, []);

  const load = useCallback(async () => {
    const r = await fetchSiteFigures(SINCE, UNTIL);
    setRead(r);
    // The stamp counts what the SERVER confirmed. An 'error' read is not a
    // fetch that happened — see the note at the top of components/Fetched.tsx.
    return r.status === 'ready';
  }, []);

  const { at: readAt, busy, refresh } = useFetched(load, { enabled: me?.role === 'owner' });

  // The first read. `useFetched` deliberately does not fire one on mount — it
  // reads on `refresh()`, on coming back to the tab, and on a poll — so every
  // other screen in this console starts its own, keyed on the thing that had to
  // arrive first. This one did not, and the effect is total: the page mounted
  // with `read` at its initial `{ status: 'loading', sites: [] }` and stayed
  // there. An owner opening /sites saw "Every gym's figures has not been read
  // yet" over an empty list, with nothing in flight and nothing on its way —
  // a screen about how many gyms you own, permanently claiming none of them,
  // until somebody happened to press Read again or alt-tab away and back.
  //
  // Keyed on the role rather than on `me` itself: `enabled` closes over it, so
  // `refresh` is a no-op until the profile says owner, and this is the render
  // after that flips. Same shape as /money and /members, whose note about the
  // reader being held in a ref assigned during RENDER is the reason it is a
  // separate effect rather than a call inside the one above.
  useEffect(() => {
    if (me?.role === 'owner') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  const sites = useMemo(() => orderSites(read.sites), [read.sites]);
  // The gym the rail names is the one this session reads, and this page has
  // already read its name — so it is taken from here rather than fetched a
  // second time and risked disagreeing with the row below it.
  const currentName = useMemo(() => sites.find((s) => s.current)?.name ?? null, [sites]);
  const nameUnread = read.status === 'error';
  const members = useMemo(() => rollCount(sites, (s: SiteFigures) => s.activeMembers), [sites]);
  const coaches = useMemo(() => rollCount(sites, (s: SiteFigures) => s.trainers), [sites]);
  const taken = useMemo(() => rollMoney(sites, (s: SiteFigures) => s.taken), [sites]);
  const span = useMemo(() => zoneSpan(members, sites), [members, sites]);

  if (!me) return <ConsoleGate me={me} failed={authUnread} />;

  if (me.roleUnknown) {
    return (
      <Shell me={me} gymName={currentName} gymNameUnread={nameUnread} current="/sites">
        <h1>We could not read your account</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 8, maxWidth: '62ch' }}>
          Your profile did not load, so this console does not know what you are — which is
          not the same as you not having access. Reload the page; if it keeps happening the
          database refused the read rather than you.
        </p>
      </Shell>
    );
  }

  if (me.role !== 'owner') {
    return (
      <Shell me={me} gymName={currentName} gymNameUnread={nameUnread} current="/sites">
        <h1>Not your console</h1>
        <p style={{ color: 'var(--ink2)', marginTop: 10, maxWidth: '62ch' }}>
          Which gyms a person owns is the owner&rsquo;s own record. The database refuses this
          read independently, so this is not the only thing standing between you and it.
        </p>
      </Shell>
    );
  }

  /**
   * The roster came back. Not `sites.length`, and not `status !== 'error'`.
   *
   * `read` starts at `{ status: 'loading', sites: [] }`, so every count, every
   * heading and every sentence below that was phrased off the LENGTH spoke
   * about a gym list nobody had read yet — and the sentence an empty list
   * produced was the multi-gym one, "every gym you are recorded as owning",
   * printed above nothing at all. A person who owns one gym opened this screen
   * and read a plural claim over a blank space.
   */
  const listed = read.status === 'ready';
  // Only ever asked of a list that read. `sites.length === 1` over the initial
  // empty array is not "you own more than one gym", it is not an answer.
  const one = listed && sites.length === 1;
  const drill = open ? drillInto(sites, open) : null;

  return (
    <Shell me={me} gymName={currentName} gymNameUnread={nameUnread} current="/sites">
      <h1>Sites</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '78ch' }}>
        {!listed
          ? 'Which gyms you are recorded as owning, and what is on each of their records.'
          : one
            ? 'Your gym, and what is on its record.'
            : 'Every gym you are recorded as owning, counted side by side. Figures only — the members, payments and timetables of a gym you are not signed in to are not on this sign-in.'}
      </p>

      <Fetched at={readAt} busy={busy} onRefresh={refresh}
               what={one ? 'your gym’s figures' : 'every gym’s figures'} style={{ margin: '2px 0 14px' }} />

      {read.status === 'error' ? (
        <p style={{ color: 'var(--ink2)', maxWidth: '72ch' }}>
          Your gyms could not be read. That is a read that failed rather than an answer about
          your business &mdash; nothing here says you own none.
        </p>
      ) : null}

      {/* Still reading. Said out loud rather than left as an empty grid under a
          heading, which is the shape a gym list with nothing in it takes and
          reads as an answer. */}
      {read.status === 'loading' ? (
        <div role="status" aria-live="polite" aria-atomic="true"
             style={{ padding: '22px 2px', color: 'var(--ink3)' }}>Reading your gyms…</div>
      ) : null}

      {/* ── the roll-up ────────────────────────────────────────────────────
          Only when there is more than one gym to roll up. A "total" beside a
          single row is the same number printed twice, and the sentences under
          it — which gyms were counted, which were not and why — are answers to
          a question nobody with one gym has asked. */}
      {listed && !one ? (
        <section aria-label="Across your gyms" style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Across your gyms</h2>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Figure label="Active members" value={members.total == null ? null : String(members.total)} />
            <Figure label="Coaches" value={coaches.total == null ? null : String(coaches.total)} />
            <Figure label="Taken" value={moneyLine(taken)} />
          </div>
          {/* Every sentence below is the module's, not this file's. A screen
              that writes its own caveat is a screen that can disagree with the
              arithmetic it is captioning. */}
          <Notes lines={[
            periodNote(span, 'these figures'),
            gapsNote(members),
            floorNote(members),
            moneyNote(taken),
          ]} />
        </section>
      ) : null}

      {/* ── one line per gym ─────────────────────────────────────────────
          Only under a roster that read. An empty grid under "Each gym" is the
          same pixels as a person who owns nothing, and on the one screen whose
          subject is how many gyms you have that is the answer it must never
          give by accident. */}
      {listed ? (
      <section aria-label="Your gyms">
        {!one ? <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Each gym</h2> : null}
        {/* `my_sites()` returns the profile's own tenant either way, so this is
            not an ordinary state — but it is a reachable one for an account
            carrying no tenant at all, and a blank page is not an answer. */}
        {sites.length === 0 ? (
          <p style={{ color: 'var(--ink2)', maxWidth: '72ch' }}>
            Your gyms read fine and the list came back empty, so this account is not recorded
            against a gym. That is a record to fix rather than a figure to read &mdash; whoever
            set the gym up needs to add you to it.
          </p>
        ) : null}
        <div style={{ display: 'grid', gap: 8 }}>
          {sites.map((s) => (
            <div key={s.siteId}
                 style={{ border: '1px solid var(--ring)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>
                  {/* A gym with no name is a real state, not a failed read —
                      see OwnedSite.name. It says so rather than showing a gap. */}
                  {s.name ?? <span className="dash">this gym has never been named</span>}
                </strong>
                {s.current ? (
                  <span style={{ fontSize: 11, color: 'var(--ink3)' }}>the gym you are signed in to</span>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
                <Figure small label="Active members" value={s.activeMembers == null ? null : String(s.activeMembers)} />
                <Figure small label="Coaches" value={s.trainers == null ? null : String(s.trainers)} />
                <Figure small label="Taken" value={moneyLine(siteMoney(s.taken))} />
              </div>
              <button type="button" onClick={() => setOpen(open === s.siteId ? null : s.siteId)}
                      style={{ appearance: 'none', background: 'none', border: 0, padding: '8px 0 0',
                               color: 'var(--brand)', cursor: 'pointer', fontSize: 12.5 }}>
                {open === s.siteId ? 'Close' : 'What can I see of this gym?'}
              </button>
              {drill && open === s.siteId ? (
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--ink2)', maxWidth: '72ch' }}>
                  {drill.blocked ?? drill.depthNote ??
                    'This is the gym this console is showing. Every other screen here is already scoped to it.'}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      ) : null}
    </Shell>
  );
}

/** A figure, or a dash with the reason it is a dash carried elsewhere.
 *  Null is never rendered as 0 — that distinction is the whole module. */
function Figure({ label, value, small }: { label: string; value: string | null; small?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{label}</div>
      <div style={{ fontSize: small ? 15 : 22, fontWeight: 600, marginTop: 2 }}>
        {value ?? <span className="dash">&mdash;</span>}
      </div>
    </div>
  );
}

/** The module's sentences, in order, with the nulls dropped. */
function Notes({ lines }: { lines: Array<string | null> }) {
  const live = lines.filter((l): l is string => Boolean(l));
  if (!live.length) return null;
  return (
    <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--ink3)', fontSize: 12.5, maxWidth: '78ch' }}>
      {live.map((l) => <li key={l} style={{ marginTop: 4 }}>{l}</li>)}
    </ul>
  );
}

/** Money, in whatever it was actually counted in.
 *
 *  `Denomination` carries either one pot or several, and several is not a
 *  failure — it is two gyms on two currencies, which have no combined total.
 *  Printed as separate amounts rather than added, because adding them is the
 *  one thing this screen must never do. */
function moneyLine(d: { cents: number | null; currency: string | null; currencies: string[]; mixedCurrency: boolean }): string | null {
  if (d.cents == null) return null;
  if (d.mixedCurrency) return null;      // no single figure exists; moneyNote says why
  // `money()` and never a division here. There are no fils in a yen, so a
  // minor-unit amount in JPY, KRW or VND IS the whole amount, and dividing by a
  // hundred would print a gym's takings at a hundredth of themselves in the
  // currencies nobody reviewing this file was likely to check. It also refuses
  // a missing currency, which is the right answer rather than a bare number.
  return money(d.cents, d.currency);
}
