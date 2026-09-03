// Coach · Their checklists. The daily lines this coach puts on one client's list.
//
// ── Why this screen exists ──────────────────────────────────────────────────
//
// TF-31 asked what generates the client's daily checklist. The honest answer
// was "a five-element array literal compiled into the app" — the same
// "10,000 steps" and "Sleep 7h+" for every account on the platform, which no
// coach and no client could change. The client's list is derived from their own
// plan and targets now, and the answer to the feedback included "as well as the
// ones set by the coach".
//
// `coach_checklist_items` (supabase/parts/58) is where those live and the
// client's app already reads them. The console has the same editor at
// /coach/checklists; this is it on the phone, which is where coaches actually
// are between sessions.
//
// ── Every write is believed only when the server confirms it ───────────────
//
// Each mutation selects the rows it touched and counts them. A PostgREST update
// or delete matching NOTHING succeeds having changed zero rows, so an item RLS
// refused to touch would otherwise disappear from this screen, look saved, and
// come back at the next launch. That is the single most-reported shape of bug
// in this product and it is not repeated here.
//
// ── One client at a time was the whole product ─────────────────────────────
//
// This screen set a client's lines and had no other path: a chip picker, an add
// box, and nothing that reached a second person. `BulkKind` in
// src/lib/bulkActions.ts had four members and checklists were not one of them.
// But the five habits a coach gives one client are usually the five they give
// everybody, and typing them out again for the twelfth person is how a coach
// stops setting them at all.
//
// So the list on screen can be copied onto other clients, and the interesting
// part is what the copy refuses to do. Adding a line somebody already has gives
// them that line TWICE, every morning, for ever — the client cannot remove a
// coach-set line and the coach cannot see the duplicate without selecting that
// client, and deleting it takes their ticks for it with it. Knowing what each
// target already has is therefore load-bearing, an empty list of it under a
// failed read is indistinguishable from a client who has none, and
// `guardChecklistCopy` refuses the whole action rather than writing over the
// difference. src/lib/checklistCopy.ts carries the argument.
//
// ── What this screen deliberately cannot do ────────────────────────────────
//
// Tick anything. There is no `done` column on the table and there must not be
// one: the tick belongs to the client, in `habit_logs`, under their own policy.
// A coach marking their client's habit complete would be a second answer to a
// question only one person can answer.
//
// ── Reading back what came of it ───────────────────────────────────────────
//
// A coach could set a line here and never learn whether any of it was done.
// `habit_logs_coach_read` (02-domain-schema.sql) has always allowed the read —
// `for select using (is_my_client(user_id))` — and until now nothing in the
// product used it, so an item went onto a client's list and vanished into
// silence.
//
// It is read here, and the arithmetic that turns those rows into something a
// coach can honestly be told is in src/lib/adherence.ts, along with the
// reasoning for the four-week window and for the things this screen refuses to
// state. The short version, because it decides what is on this page: an
// unticked box is not a failure. It can be a miss, a day the client never
// opened the app, or a day the line was not on their list at all. The first is
// worth a conversation, the second and third are not the client's to answer
// for, and a single percentage rolls all three into a number that reads like a
// verdict on the person. So the figures here are fractions with their
// denominator visible, the days nobody can account for are counted out loud,
// and there is no score anywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Cta, Ghost, Notice, PartialRead } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
import {
  recentWindow, summariseAdherence, setItemLine, dayLabel,
  type DayWindow, type TickRow, type AdherenceSummary,
} from '../../src/lib/adherence';
import {
  planChecklistCopy, guardChecklistCopy, copyBrief, copyPreview,
  type CopyTarget, type CopyLine,
} from '../../src/lib/checklistCopy';
import { bulkReport, selectAllOffer, type WriteOutcome } from '../../src/lib/bulkActions';
import { subjectOf, subjectChange, type RouteParam } from '../../src/lib/routeSubject';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

interface Item {
  id: string; label: string; icon: string; active: boolean; sort: number;
  // Read because the adherence figures cannot be honest without them: an item's
  // created_at is how far back it could possibly have been ticked, and `active`
  // says when the days stop being the client's to answer for.
  created_at: string; updated_at: string;
}

/** The bound the column carries (part 58: `length(label) <= 80`). Checked here
 *  so a coach is told before the write rather than by a refused one. */
const LABEL_MAX = 80;

const COLS = 'id, label, icon, active, sort, created_at, updated_at';

export default function CoachChecklists() {
  const t = useTheme();
  const router = useRouter();
  const r = useRoster();

  // Arrives from the client screen, so a coach already looking at somebody
  // lands on that person rather than on a picker they have to search. This
  // screen ignored the param until now, which made the route work and the
  // journey through it not — the sort of gap that reads as the app forgetting
  // who you were looking at.
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  // Seeded once, and this screen never unmounts — it is registered `href: null`
  // inside <Tabs> (app/(trainer)/_layout.tsx), so a `useState` initialiser runs
  // for the FIRST client a coach opens it for and for nobody after. Opening it
  // for Ben used to draw Amy. `subjectChange` is the rule, with the reasoning
  // and the string[] hazard in src/lib/routeSubject.ts; it is applied during
  // render rather than in an effect so the wrong person is never painted, not
  // even for one frame.
  const [picked, setPicked] = useState<string | null>(subjectOf(clientId));
  const [seenParam, setSeenParam] = useState<RouteParam>(clientId);
  const moved = subjectChange(seenParam, clientId);
  if (moved) { setSeenParam(clientId); setPicked(moved.subject); }
  const [items, setItems] = useState<Item[] | null>(null);
  const [status, setStatus] = useState<LoadStatus>('ready');
  // The window and the rows it was read over travel together. Held as one value
  // because a summary built from this load's rows and the previous load's dates
  // would be arithmetic over two different fortnights and look perfectly fine.
  const [ticks, setTicks] = useState<{ window: DayWindow; rows: TickRow[] } | null>(null);
  const [tickStatus, setTickStatus] = useState<LoadStatus>('ready');
  const [uid, setUid] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setUid(data?.user?.id ?? null);
      } catch { if (!cancelled) setUid(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* The client whose answers are allowed to land, in both reads.
   *
   * A coach tapping down the chip row starts a pair of reads per tap and they
   * do not come back in the order they went out. Without this guard, tapping A
   * and then B a second later and having A's response resolve second left the
   * header on B, the lines from A, and — much worse — `summariseAdherence`
   * running A's items as the denominators against B's ticks as the numerators,
   * under `adhStatus === 'ready'`, so "3 of 21 days" was drawn at full
   * confidence about a fortnight that never happened to either of them. The
   * same guard builder.tsx, client-training.tsx and client-body.tsx carry. */
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (coachId: string, clientId: string) => {
    setStatus('loading');
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .select(COLS)
      .eq('coach_id', coachId)
      .eq('client_id', clientId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true })
      // Capped now that this list is a set of denominators and not just rows on
      // a page: a truncated list of items would produce a page of figures for
      // some of a coach's lines while silently omitting the rest.
      .limit(capLimit());
    // The coach has moved on to somebody else. Dropping the response is the
    // whole of it: whichever read is for the client now selected will set the
    // state, and a stale one must not touch it on the way past.
    if (wanted.current !== clientId) return;
    if (error) {
      // Null, not []. An empty list under a failed read tells the coach they
      // have set nothing for this person, which is a claim about them.
      reportError('coachChecklists.load', error);
      setItems(null); setStatus('error'); return;
    }
    const page = capped(data);
    setItems(page.rows as unknown as Item[]);
    setStatus(page.truncated ? 'partial' : 'ready');
  }, []);

  /**
   * The client's own ticks for the window, every habit, not only this coach's.
   *
   * All of them, because the ticks against a client's OWN targets are the only
   * evidence this screen has that they opened the app on a given day — which is
   * what separates a line they saw and skipped from a line nobody was ever
   * shown. See src/lib/adherence.ts.
   */
  const loadTicks = useCallback(async (clientId: string) => {
    setTickStatus('loading');
    const w = recentWindow();
    const { data, error } = await supabase
      .from('habit_logs')
      .select('habit, done_on')
      .eq('user_id', clientId)
      .gte('done_on', w.start)
      .lte('done_on', w.end)
      .order('done_on', { ascending: false })
      // One row per tick per day: four weeks of a long list is in the hundreds,
      // which is under PostgREST's ceiling and is not a promise. A read that
      // came back at the limit is a prefix, and a fraction of a fraction is not
      // a figure — so it produces no figures at all rather than smaller ones.
      .limit(capLimit());
    // As above: somebody else's ticks are not this client's, and pairing them
    // with this client's items is the arithmetic this guard exists to stop.
    if (wanted.current !== clientId) return;
    if (error) {
      // A failed read is not a record of somebody ticking nothing, and this is
      // the exact shape of read that has been turned into "they did nothing"
      // nine times in this codebase. Null and 'error'.
      reportError('coachChecklists.ticks', error);
      setTicks(null); setTickStatus('error'); return;
    }
    const page = capped(data);
    setTicks({ window: w, rows: page.rows as unknown as TickRow[] });
    setTickStatus(page.truncated ? 'partial' : 'ready');
  }, []);

  useEffect(() => {
    // Set before either read starts, so a response from the previous client
    // that is still in flight fails its check on arrival.
    wanted.current = picked ?? null;
    if (uid && picked) {
      // Cleared as well as re-read. The previous client's items and ticks stay
      // in state until their replacements land, and while they do the header
      // has already changed to the new client — so the screen would show one
      // person's lines under another's name for the length of the round trip.
      setItems(null); setTicks(null);
      void load(uid, picked); void loadTicks(picked);
    }
    else { setItems(null); setTicks(null); setStatus('ready'); setTickStatus('ready'); }
  }, [uid, picked, load, loadTicks]);

  const shown = useMemo(() => (items ? [...items].sort((a, b) => a.sort - b.sort) : null), [items]);
  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);

  /* ── pull to refresh ─────────────────────────────────────────────────────
   *
   * The ticks are written by the CLIENT, on the client's phone, and this screen
   * is where a coach finds out whether the fortnight happened. Nothing here
   * moves on its own, so a coach who opened this at breakfast is looking at
   * breakfast for as long as the screen stays up.
   *
   * Both reads together, never one. The summary below divides ticks by items
   * over one window, and a refresh that moved the ticks and left the items
   * would produce a percentage whose numerator and denominator came from
   * different reads — a plausible number rather than a visible gap. The roster
   * goes with them because the picker and the header name come off it.
   *
   * With no client picked there is nothing client-shaped to re-read, so this is
   * the roster alone — which is exactly what the picker in front of the coach
   * at that moment is made of. */
  const pull = usePullToRefresh(useCallback(() => Promise.all([
    r.refresh(),
    ...(uid && picked ? [load(uid, picked), loadTicks(picked)] : []),
  ]), [r, uid, picked, load, loadTicks]));

  // Both reads have to be whole before a single figure is drawn. A truncated or
  // failed list of items means unknown denominators; a truncated or failed read
  // of ticks means an unknown numerator. Either way what is on screen would be
  // a fraction of a fraction, presented as a proportion of somebody's month.
  const adhStatus = worstStatus(status, tickStatus);
  const summary: AdherenceSummary | null = useMemo(
    () => (adhStatus === 'ready' && items && ticks
      ? summariseAdherence({ window: ticks.window, ticks: ticks.rows, items })
      : null),
    [adhStatus, items, ticks],
  );
  const byItem = useMemo(
    () => new Map((summary?.set ?? []).map((a) => [a.id, a])),
    [summary],
  );

  const add = async () => {
    if (!uid || !picked || busy) return;
    const label = draft.trim();
    if (!label) { Alert.alert('Nothing to add', 'Type the line you want on their list.'); return; }
    if (label.length > LABEL_MAX) {
      Alert.alert('Too long', `That is ${label.length} characters. A checklist line has to fit on one row of a phone — ${LABEL_MAX} at most.`);
      return;
    }
    setBusy(true);
    // Appended rather than inserted first: the order is the coach's, and a new
    // item silently taking the top would reshuffle a list the client has been
    // reading in the same shape every morning.
    const nextSort = (items ?? []).reduce((m, i) => Math.max(m, i.sort), 0) + 1;
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .insert({ coach_id: uid, client_id: picked, label, icon: icon.trim(), sort: nextSort })
      .select(COLS).single();
    setBusy(false);
    if (error || !data) {
      reportError('coachChecklists.add', error);
      Alert.alert('Not saved', 'That line is not on their list. Check your connection and try again.');
      return;
    }
    setItems((p) => [...(p ?? []), data as unknown as Item]);
    setDraft(''); setIcon('');
  };

  const setActive = async (it: Item, active: boolean) => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase
      .from('coach_checklist_items').update({ active }).eq('id', it.id).select(COLS);
    setBusy(false);
    // Counting rows is the point: an update that matched nothing is not an
    // error, it is a success that changed nothing.
    if (error || !data || !data.length) {
      reportError('coachChecklists.setActive', error);
      Alert.alert('Not saved', 'Their list is unchanged.');
      return;
    }
    setItems((p) => (p ?? []).map((x) => (x.id === it.id ? { ...x, active } : x)));
  };

  const remove = (it: Item) => {
    Alert.alert(
      'Delete this line?',
      `"${it.label}" goes for good, and their past ticks for it stop being readable. Turning it off keeps the record.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Turn off', onPress: () => setActive(it, false) },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { data, error } = await supabase
            .from('coach_checklist_items').delete().eq('id', it.id).select('id');
          setBusy(false);
          if (error || !data || !data.length) {
            reportError('coachChecklists.remove', error);
            Alert.alert('Not removed', 'It is still on their list.');
            return;
          }
          setItems((p) => (p ?? []).filter((x) => x.id !== it.id));
        } },
      ],
    );
  };

  const move = async (it: Item, dir: -1 | 1) => {
    if (busy || !shown) return;
    const i = shown.findIndex((x) => x.id === it.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const other = shown[j];
    setBusy(true);
    const [a, b] = await Promise.all([
      supabase.from('coach_checklist_items').update({ sort: other.sort }).eq('id', it.id).select('id'),
      supabase.from('coach_checklist_items').update({ sort: it.sort }).eq('id', other.id).select('id'),
    ]);
    setBusy(false);
    if (a.error || b.error || !a.data?.length || !b.data?.length) {
      // One half may have landed. Re-reading is the only way to show what the
      // server holds rather than what this phone hoped it would.
      reportError('coachChecklists.move', a.error ?? b.error);
      Alert.alert('Order not saved', 'Reloading their list so you can see what actually stored.');
      if (uid && picked) void load(uid, picked);
      return;
    }
    setItems((p) => (p ?? []).map((x) =>
      x.id === it.id ? { ...x, sort: other.sort } : x.id === other.id ? { ...x, sort: it.sort } : x));
  };

  /* ── copying this list onto other clients ────────────────────────────────
   *
   * One read, not one per tick. `existing` holds every line this coach has set
   * for anybody on their book, read once when the panel opens, so ticking a
   * twelfth name costs nothing and the duplicate check is over the same set for
   * everybody. It is capped and the truncation is carried, because a page of a
   * coach's lines is not their lines and the one that did not come back is
   * exactly the one about to be added a second time.
   *
   * Null under 'loading' and 'error' for the usual reason: an empty map would
   * say every client has nothing, which is the sentence that produces the
   * duplicates.
   */
  const [copyOpen, setCopyOpen] = useState(false);
  const [existing, setExisting] = useState<Map<string, { labels: string[]; maxSort: number }> | null>(null);
  const [existingStatus, setExistingStatus] = useState<LoadStatus>('loading');
  const [ticked, setTicked] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);

  const loadExisting = useCallback(async (coachId: string) => {
    setExistingStatus('loading');
    const { data, error } = await supabase
      .from('coach_checklist_items')
      .select('client_id, label, sort')
      .eq('coach_id', coachId)
      .limit(capLimit());
    if (error) {
      reportError('coachChecklists.existing', error);
      setExisting(null); setExistingStatus('error'); return;
    }
    const page = capped(data);
    const map = new Map<string, { labels: string[]; maxSort: number }>();
    for (const row of page.rows as unknown as { client_id: string; label: string; sort: number }[]) {
      const cur = map.get(row.client_id) ?? { labels: [], maxSort: 0 };
      cur.labels.push(row.label);
      if (Number.isFinite(row.sort)) cur.maxSort = Math.max(cur.maxSort, row.sort);
      map.set(row.client_id, cur);
    }
    setExisting(map);
    // Truncated is 'partial' and 'partial' refuses. Not a warning: the rows the
    // cap cut off are lines somebody already has, and they are the ones that
    // would be written a second time.
    setExistingStatus(page.truncated ? 'partial' : 'ready');
  }, []);

  const openCopy = () => {
    setCopyOpen(true);
    setTicked([]);
    if (uid) void loadExisting(uid);
  };

  /** The lines that would travel. Active ones only — a line the coach has
   *  turned off is not on this client's list, and copying it would put
   *  something on eleven other people that is on nobody's list today. */
  const sourceLines: CopyLine[] = useMemo(
    () => (shown ?? []).filter((i) => i.active).map((i) => ({ label: i.label, icon: i.icon || '' })),
    [shown],
  );

  /** Everybody except the person whose list this is. Copying somebody's list
   *  onto themselves is the one gesture here with no meaning at all. */
  const copyCandidates = useMemo(
    () => r.roster.filter((c) => c.id !== picked), [r.roster, picked]);

  const copyTargets: CopyTarget[] = useMemo(() => ticked.map((id) => {
    const found = existing?.get(id);
    return {
      clientId: id,
      name: copyCandidates.find((c) => c.id === id)?.name ?? 'Client',
      existing: found?.labels ?? [],
      maxSort: found?.maxSort ?? 0,
    };
  }), [ticked, existing, copyCandidates]);

  const plan = useMemo(
    () => planChecklistCopy(sourceLines, copyTargets), [sourceLines, copyTargets]);
  const copyGuard = guardChecklistCopy(r.status, existingStatus);
  const selectAll = selectAllOffer(r.status, copyCandidates.length);

  const runCopy = async () => {
    if (!uid || copying) return;
    if (!copyGuard.allowed) {
      Alert.alert(copyGuard.label ?? 'Not copied', copyGuard.reason ?? 'Nothing was copied.');
      return;
    }
    const brief = copyBrief(plan, client?.name ?? 'this client');
    if (!brief.actionable) { Alert.alert(brief.title, brief.body); return; }
    Alert.alert(brief.title, brief.body, [
      { text: 'Cancel', style: 'cancel' },
      { text: brief.confirmLabel, onPress: async () => {
        setCopying(true);
        const outcomes: WriteOutcome[] = [];
        try {
          for (const tp of plan.changed) {
            const rows = tp.add.map((l) => ({
              coach_id: uid, client_id: tp.clientId, label: l.label, icon: l.icon, sort: l.sort,
            }));
            const { data, error } = await supabase
              .from('coach_checklist_items').insert(rows).select('id');
            // Counted, not merely un-errored. An insert RLS refuses comes back
            // without an error on some paths and with no rows on all of them,
            // and "copied" over nothing written is the failure this whole
            // screen is careful about one client at a time.
            const wrote = data?.length ?? 0;
            if (error || wrote === 0) {
              reportError('coachChecklists.copy', error);
              outcomes.push({ clientId: tp.clientId, name: tp.name, ok: false,
                why: error?.message
                  ? String(error.message)
                  : 'the server took the request and wrote nothing — they may no longer be your client.' });
            } else if (wrote < rows.length) {
              outcomes.push({ clientId: tp.clientId, name: tp.name, ok: false,
                why: `only ${wrote} of ${rows.length} lines were written, so their list is part of what you sent.` });
            } else {
              outcomes.push({ clientId: tp.clientId, name: tp.name, ok: true, why: null });
            }
          }
          const report = bulkReport('checklist', outcomes);
          // Left ticked, so trying again is the same gesture over the set that
          // still needs it — and re-read, so a retry plans against what is now
          // on their lists rather than against what was there before the half
          // that landed.
          setTicked(report.retry);
          await loadExisting(uid);
          Alert.alert(report.title, report.body);
        } catch (e) {
          reportError('coachChecklists.copy', e);
          Alert.alert('Not copied', 'Nothing was written to anybody\u2019s list. Check your connection and try again.');
        } finally { setCopying(false); }
      } },
    ]);
  };

  const chip = (on: boolean) => ({
    paddingHorizontal: sp.lg, paddingVertical: sp.sm, borderRadius: radius.pill,
    backgroundColor: on ? t.brand : t.surface2,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Your book</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Their Checklists</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
          Lines you add appear on that client&rsquo;s daily list, marked as set by you, beside the
          ones worked out from their own plan and targets. You can&rsquo;t tick them — that stays
          with them.
        </Text>

        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your clients could not be read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Client" />
          {r.roster.length === 0 && r.status !== 'error' ? (
            <Text style={{ ...ty.body, color: t.ink3 }}>
              Nobody is on your book yet, so there is no list to add to.
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {r.roster.map((c) => (
                <Pressable key={c.id} onPress={() => setPicked(c.id === picked ? null : c.id)}
                  accessibilityRole="button" accessibilityState={{ selected: picked === c.id }}
                  accessibilityLabel={c.name} style={chip(picked === c.id)}>
                  <Text style={{ ...ty.micro, color: picked === c.id ? t.brandInk : t.ink2 }}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Section>

        {picked ? (
          <View>
            <Rule />
            <Section>
              <SectionHead title={client?.name ?? 'Their List'} note={shown ? `${shown.filter((i) => i.active).length} showing` : undefined} />

              {/* The caveats come BEFORE the figures they qualify. A coach who
                  reads "3 of 28" first and the reason it might not mean what it
                  looks like second has already formed the thought, and the
                  second sentence is arguing with it. */}
              {tickStatus === 'error' ? (
                <Notice tone={t.warn} kicker="Not loaded" title="Their ticks could not be read"
                  note="Nothing below says how often anything was done, because none of it came back. That is a read that failed, not a record of somebody ticking nothing — and the two are indistinguishable unless somebody says which it was." />
              ) : tickStatus === 'partial' ? (
                <PartialRead what="ticks in the last four weeks" onPress={() => { if (picked) void loadTicks(picked); }} />
              ) : status === 'partial' ? (
                <PartialRead what="lines on their list" onPress={() => { if (uid && picked) void load(uid, picked); }} />
              ) : adhStatus === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading their ticks…</Text>
              ) : summary ? (
                <Notice
                  kicker={`Last ${summary.window.days} days, to ${dayLabel(summary.window.end)}`}
                  title={summary.silentDays === 0
                    ? `Something was logged on every one of the last ${summary.window.days} days`
                    : `Nothing at all was logged on ${summary.silentDays} of the last ${summary.window.days} days`}
                  note={`A line counts from the day you added it and stops the day you take it off, so nothing here is measured over days it was not on their list. ${summary.silentDays === 0 ? 'Every day carries a tick of something, so a line left unticked on one of them is a line they saw and left.' : 'On the quiet days a line they skipped and a day they never opened the app look exactly the same, so those days are set aside and never counted as misses.'} Today is in none of it — it is not over.`}
                />
              ) : null}

              {status === 'error' ? (
                <Notice tone={t.warn} kicker="Not loaded" title="Their list could not be read"
                  note="Nothing is shown below because nothing came back — it does not mean you have set nothing for them." />
              ) : status === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading their list…</Text>
              ) : shown && shown.length === 0 ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>
                  You haven&rsquo;t set anything for them. Their list still shows the lines worked
                  out from their own plan and targets.
                </Text>
              ) : shown ? shown.map((it, i) => (
                <View key={it.id} style={{ paddingVertical: sp.md, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring, opacity: it.active ? 1 : 0.5 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                    <Text style={{ ...ty.body }}>{it.icon || '•'}</Text>
                    <Text style={{ flex: 1, ...ty.body, color: t.ink2 }}>{it.label}</Text>
                    <Pressable onPress={() => move(it, -1)} disabled={busy || i === 0} accessibilityRole="button" accessibilityLabel={`Move ${it.label} up`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === 0 ? 0.3 : 1 }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>↑</Text>
                    </Pressable>
                    <Pressable onPress={() => move(it, 1)} disabled={busy || i === shown.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${it.label} down`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === shown.length - 1 ? 0.3 : 1 }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>↓</Text>
                    </Pressable>
                    <Pressable onPress={() => setActive(it, !it.active)} disabled={busy} accessibilityRole="button"
                      accessibilityLabel={it.active ? `Take ${it.label} off their list` : `Put ${it.label} back on their list`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                      <Text style={{ ...ty.micro, color: t.ink2 }}>{it.active ? 'On' : 'Off'}</Text>
                    </Pressable>
                    <Pressable onPress={() => remove(it)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove ${it.label}`}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>✕</Text>
                    </Pressable>
                  </View>
                  {/* Under the line rather than beside it: this is a note about
                      the line, and putting a figure in the same row as the
                      controls turns a page of notes into a scoreboard. Absent
                      entirely — not a dash, not a zero — while the reads are
                      still landing or have failed, because the banner above has
                      already said why and repeating "—" on every row would read
                      as a measurement rather than as its absence. */}
                  {byItem.get(it.id) ? (
                    <Text style={{ ...ty.micro, color: t.ink3, marginTop: 4 }}>
                      {setItemLine(byItem.get(it.id)!)}
                    </Text>
                  ) : null}
                </View>
              )) : null}
            </Section>

            {/* ── The other half of their list, which this coach did not set ──
                Drawn only when both reads came back whole; there is no version
                of this block that renders a hole, because a heading with
                nothing under it is read as "they ticked none of it". */}
            {summary ? (
            <View>
              <Rule />
              <Section>
                <SectionHead title="From their own plan and targets" />
                <View>
                  {summary.deletedLineTicks > 0 ? (
                    <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                      {summary.deletedLineTicks} {summary.deletedLineTicks === 1 ? 'tick belongs' : 'ticks belong'} to
                      {' '}{summary.deletedLineTicks === 1 ? 'a line' : 'lines'} that {summary.deletedLineTicks === 1 ? 'was' : 'were'} deleted rather than
                      turned off. Their record survives; what they were asked to do does not, so those ticks cannot be named.
                    </Text>
                  ) : null}

                  {/* ── Their own lines, which this coach did not set ──────
                      Counts, never fractions. The client's app rebuilds this
                      half of the list every morning out of targets, goals and
                      whichever day their plan schedules — 'train' is only on
                      the list on training days, 'steps' did not exist before
                      they set a step goal — and none of that is written down
                      per day. There is no denominator anywhere in the record,
                      so there is none here. Discovered from the ticks
                      themselves, which is also why a target they have never
                      once ticked cannot appear: this screen has no sight of
                      their list, only of what they marked off it. */}
                  {summary.derived.length === 0 ? (
                    <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>
                      Nothing off their own plan and targets was ticked in the window.
                    </Text>
                  ) : (
                    <View style={{ marginTop: sp.sm }}>
                      {summary.derived.map((d, i) => (
                        <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, paddingVertical: sp.sm, borderTopWidth: i ? hairline : 0, borderTopColor: t.ring }}>
                          <Text style={{ flex: 1, ...ty.label, color: t.ink2 }}>{d.label}</Text>
                          <Text style={{ ...ty.micro, color: t.ink3 }}>
                            ticked on {d.ticked} {d.ticked === 1 ? 'day' : 'days'}
                          </Text>
                        </View>
                      ))}
                      <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.sm }}>
                        You did not set these, and nothing records which days they were on their list — a training
                        line is only there on training days. So these are counts of ticks and not a share of
                        anything, and one they have never ticked does not appear here at all.
                      </Text>
                    </View>
                  )}
                </View>
              </Section>
            </View>
            ) : null}

            <Rule />

            <Section>
              <SectionHead title="Add a Line" note={`${draft.length}/${LABEL_MAX}`} />
              <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center' }}>
                <TextInput value={icon} onChangeText={setIcon} placeholder="🥗" placeholderTextColor={t.ink3}
                  accessibilityLabel="Icon, optional" maxLength={8}
                  style={{ width: 56, textAlign: 'center', ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingVertical: sp.md }} />
                <TextInput value={draft} onChangeText={setDraft} placeholder="e.g. Ten minutes of hip mobility before bed"
                  placeholderTextColor={t.ink3} accessibilityLabel="What to add to their list" maxLength={LABEL_MAX}
                  style={{ flex: 1, ...ty.body, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md }} />
              </View>
              <View style={{ marginTop: sp.md }}>
                <Cta label={busy ? 'Saving…' : 'Add to Their List'} wide disabled={busy} onPress={add} />
              </View>
            </Section>

            {/* ── the same five lines, for everybody else ──────────────────
                The gap this closes is not a missing button, it is that there
                was no path off this client at all: no bulk, no template, no
                copy-to, and `BulkKind` had no member for checklists.

                Offered only over a list that came back WHOLE. Under 'partial'
                or 'error' the lines on screen are some of this client's lines,
                and copying "their list" would copy the part that loaded onto
                eleven other people — who would then have a list nobody chose.
                The panel does not appear rather than appearing disabled: there
                is nothing here for a coach to act on until the read lands. */}
            {status === 'ready' && sourceLines.length > 0 ? (
              <View>
                <Rule />
                <Section>
                  <SectionHead title="Give These To Somebody Else"
                    note={sourceLines.length === 1 ? '1 line' : `${sourceLines.length} lines`} />

                  {!copyOpen ? (<>
                    <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.md }}>
                      Put the {sourceLines.length === 1 ? 'line' : `${sourceLines.length} lines`} showing on
                      {' '}{client?.name ?? 'this client'}&rsquo;s list onto other clients as well. Lines you have
                      turned off do not travel, and anything somebody already has is left alone rather than added twice.
                    </Text>
                    <View style={{ alignItems: 'flex-start' }}>
                      <Ghost label="Choose Who" a11yLabel="Choose which clients get these lines" onPress={openCopy} />
                    </View>
                  </>) : (<>
                    {/* Who can be ticked, and whether ticking them all is a
                        true gesture. `selectAllOffer` renames itself under a
                        truncated roster rather than claiming "All" over people
                        this screen has never seen. */}
                    {copyCandidates.length === 0 ? (
                      <Text style={{ ...ty.body, color: t.ink3 }}>
                        {r.status === 'error'
                          ? 'Your client list could not be read, so there is nobody here to choose. That is a read that failed, not an empty book.'
                          : 'There is nobody else on your book to give these to.'}
                      </Text>
                    ) : (<>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.md }}>
                        {copyCandidates.map((c) => {
                          const on = ticked.includes(c.id);
                          return (
                            <Pressable key={c.id} onPress={() => setTicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                              accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                              accessibilityLabel={c.name} style={chip(on)}>
                              <Text style={{ ...ty.micro, color: on ? t.brandInk : t.ink2 }}>{c.name}</Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <View style={{ flexDirection: 'row', gap: sp.sm, alignItems: 'center', marginBottom: sp.md }}>
                        <Ghost label={selectAll.label}
                          a11yLabel={selectAll.allowed ? selectAll.label : `${selectAll.label} — not available`}
                          onPress={() => { if (selectAll.allowed) setTicked(copyCandidates.map((c) => c.id)); }} />
                        {ticked.length ? (
                          <Ghost label="Untick All" onPress={() => setTicked([])} />
                        ) : null}
                      </View>
                      {selectAll.note ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>{selectAll.note}</Text>
                      ) : null}

                      {/* What would actually be written, before it is. Both
                          numbers, because a coach who ticks twelve and reads
                          "12" cannot tell whether it counts people or lines —
                          and the people who get nothing are the half they most
                          need told about. */}
                      {copyPreview(plan) ? (
                        <Text style={{ ...ty.label, color: t.ink2, marginBottom: sp.md }}>{copyPreview(plan)}</Text>
                      ) : null}

                      {/* Withheld and said, not warned about and allowed. The
                          duplicate this stops has no undo the client can reach
                          and no undo the coach can reach without deleting the
                          line, which deletes their ticks for it. */}
                      {!copyGuard.allowed ? (
                        <Notice tone={t.warn} kicker="Held" title={copyGuard.label ?? 'Not copied'}
                          note={copyGuard.reason ?? ''} />
                      ) : null}

                      <View style={{ opacity: copyGuard.allowed ? 1 : 0.4 }} pointerEvents={copyGuard.allowed ? 'auto' : 'none'}>
                        <Cta wide
                          label={copying ? 'Copying…' : copyGuard.allowed ? `Copy to ${plan.changed.length}` : (copyGuard.label ?? 'Held')}
                          disabled={copying || !copyGuard.allowed || plan.writes === 0}
                          onPress={() => { void runCopy(); }} />
                      </View>
                      <View style={{ alignItems: 'flex-start', marginTop: sp.md }}>
                        <Ghost label="Done" a11yLabel="Close the copy panel" onPress={() => setCopyOpen(false)} />
                      </View>
                    </>)}
                  </>)}
                </Section>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
