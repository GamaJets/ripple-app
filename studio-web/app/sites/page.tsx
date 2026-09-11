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
  const [me, setMe] = useState<Me | null>(null);
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

  const one = sites.length === 1;
  const drill = open ? drillInto(sites, open) : null;

  return (
    <Shell me={me} gymName={currentName} gymNameUnread={nameUnread} current="/sites">
      <h1>Sites</h1>
      <p style={{ color: 'var(--ink3)', marginTop: 6, fontSize: 13, maxWidth: '78ch' }}>
        {one
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

      {/* ── the roll-up ────────────────────────────────────────────────────
          Only when there is more than one gym to roll up. A "total" beside a
          single row is the same number printed twice, and the sentences under
          it — which gyms were counted, which were not and why — are answers to
          a question nobody with one gym has asked. */}
      {!one && read.status !== 'error' ? (
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

      {/* ── one line per gym ───────────────────────────────────────────── */}
      <section aria-label="Your gyms">
        {!one ? <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Each gym</h2> : null}
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
