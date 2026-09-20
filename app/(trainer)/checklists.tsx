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
import { EmptyRoster } from '../../src/ui/EmptyRoster';
import { useTheme } from '../../src/ui/components';
import { Section, SectionHead, Cta, Ghost, Notice, PartialRead, PageHead, Meter, Expandable } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import { useRoster } from '../../src/ui/roster';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';
import { capLimit, capped } from '../../src/lib/rowCap';
import { isWhole, worstStatus, type LoadStatus } from '../../src/ui/loadStatus';
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
import { clientIsQueryable } from '../../src/lib/clientRecord';
import { signedInUid } from '../../src/lib/signedInUid';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { hitSlopFor } from '../../src/lib/a11y';

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
  /**
   * Whether the coach's own id has been established — and it is NOT the same
   * question as `uid === null`.
   *
   * `supabase.auth.getUser()` does not reject on a dropped connection: it
   * RESOLVES with `{ data: { user: null }, error }` (src/lib/authReadFate.ts
   * sets out why, against the installed copy of auth-js). The effect below read
   * only `data`, so a coach on gym wifi that had just dropped and a coach who
   * is genuinely signed out both arrived as `uid === null` — and the effect
   * that starts the reads then fell into its `else`, which set BOTH statuses to
   * 'ready' over null rows. 'ready' with no items is the sentence "you haven't
   * set anything for them", which this screen prints under the client's own
   * name, about a list that may have twelve lines on it.
   *
   * So the three answers are kept apart: 'reading' while nobody has answered
   * yet, 'known' once there is an id, 'unknown' for both fates — because the
   * two sentences this screen can print ("could not be read" and "you have set
   * nothing") differ on exactly one thing, and both fates belong on the same
   * side of it.
   */
  const [whoami, setWhoami] = useState<'reading' | 'known' | 'unknown'>(USE_SUPABASE ? 'reading' : 'known');
  const [draft, setDraft] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);

  /* Ask who is signed in. A callback rather than an inline effect body, because
   * pull-to-refresh below calls it too: with `whoami` at 'unknown' this screen
   * says the list could not be read, and until this could be asked again the
   * only way out of that was to quit the app. This screen is registered
   * `href: null` inside <Tabs>, so it is never unmounted and the effect would
   * never have run a second time. */
  const readWhoami = useCallback(async () => {
    if (!USE_SUPABASE) return;
    // `signedInUid` asks, classifies, and reports the outage while staying
    // silent about a plain sign-out — which is not a fault. It never throws.
    const me = await signedInUid('checklists.whoami');
    setUid(me.uid);
    setWhoami(me.uid !== null ? 'known' : 'unknown');
  }, []);

  useEffect(() => { void readWhoami(); }, [readWhoami]);

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

  const shown = useMemo(() => (items ? [...items].sort((a, b) => a.sort - b.sort) : null), [items]);
  const client = useMemo(() => r.roster.find((c) => c.id === picked) ?? null, [r.roster, picked]);
  const who = client?.name.split(' ')[0] ?? 'They';
  /**
   * Whether there is an account behind this person at all.
   *
   * This screen did not ask, and it is the screen where not asking costs the
   * most. A client the coach typed into their own book has a `coach_clients`
   * row and no `clients` row, and BOTH policies this screen reads through are
   * `is_my_client()` — an EXISTS over `clients` (02-domain-schema.sql). So for
   * a hand-added client:
   *
   *   · `coach_checklist_items` came back with zero rows and no error, and the
   *     screen said "You haven't set anything for them";
   *   · `habit_logs` came back with zero rows and no error, under 'ready', and
   *     `summariseAdherence` was run over an empty numerator and a real
   *     denominator to produce, in a Notice, "Nothing at all was logged on 28
   *     of the last 28 days" — a month of failure attributed to somebody who
   *     has no app to fail in;
   *   · Add to Their List wrote a row `coach_checklist_coach_write` refuses,
   *     and the coach was told to "check your connection and try again" about a
   *     condition no connection will ever fix.
   *
   * Computed at render rather than inside the effect, so a roster that lands
   * AFTER the reads and says this row was typed in by hand re-runs them and
   * withdraws the answer. `handAdded` undefined is "the roster has not said",
   * which goes on asking — only an explicit true withholds.
   */
  const askable = clientIsQueryable(picked, client?.handAdded);

  useEffect(() => {
    // Set before either read starts, so a response from the previous client
    // that is still in flight fails its check on arrival.
    wanted.current = picked ?? null;
    if (picked && !askable) {
      // Nothing is asked, and nothing is left standing that a figure could be
      // computed over. 'error' on both is the backstop — `adhStatus` is their
      // worst, so `summary` is null and no Notice, no per-line rate and no
      // derived list can be drawn. The render has its own branch that says WHY
      // rather than letting those two statuses print as a failed read.
      setItems(null); setTicks(null); setStatus('error'); setTickStatus('error');
      return;
    }
    if (uid && picked) {
      // Cleared as well as re-read. The previous client's items and ticks stay
      // in state until their replacements land, and while they do the header
      // has already changed to the new client — so the screen would show one
      // person's lines under another's name for the length of the round trip.
      setItems(null); setTicks(null);
      void load(uid, picked); void loadTicks(picked);
    }
    else if (picked) {
      /* A client is chosen and there is no coach id to read their list with.
       *
       * This used to fall into the `else` below and be filed as 'ready' — an
       * empty list, stated as a fact about the coach, produced by an auth read
       * that may simply not have landed. The list is keyed on `coach_id`, so
       * without one nothing can be asked; 'loading' while the answer is still
       * out and 'error' once it has come back without an id are both true, and
       * neither of them says the coach has set this person nothing.
       *
       * The ticks go the same way rather than being read on their own. They do
       * not need a coach id, but `summariseAdherence` divides them by the items,
       * and ticks under a list this screen could not read is a numerator with
       * no denominator — `adhStatus` is their worst either way, so the only
       * thing a separate read would buy is a round trip.
       */
      setItems(null); setTicks(null);
      const s: LoadStatus = whoami === 'reading' ? 'loading' : 'error';
      setStatus(s); setTickStatus(s);
    }
    else { setItems(null); setTicks(null); setStatus('ready'); setTickStatus('ready'); }
  }, [uid, whoami, picked, askable, load, loadTicks]);

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
    // Asked again on every pull, not only the one where it failed. It is the
    // read the other two hang off — with no coach id there is no list to ask
    // for — and a coach looking at "your list could not be read" is pulling
    // precisely because they want it tried again. Cheap, and it is the only
    // thing on this screen that could otherwise stay wrong for the life of a
    // mount that is never torn down.
    readWhoami(),
    ...(uid && picked && askable ? [load(uid, picked), loadTicks(picked)] : []),
  ]), [r, uid, picked, askable, load, loadTicks, readWhoami]));

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
    if (!label) { Alert.alert('Nothing to Add', 'Type the line you want on their list.'); return; }
    if (label.length > LABEL_MAX) {
      Alert.alert('Too Long', `That is ${label.length} characters. A checklist line has to fit on one row of a phone — ${LABEL_MAX} at most.`);
      return;
    }
    /* Appending needs the WHOLE list, and until now this took `items ?? []`.
     *
     * Under 'error' that is the empty array, so `nextSort` is 1 and the new
     * line goes to the TOP of a list the coach cannot see — the exact
     * reshuffle the sentence below refuses. Under 'partial' it is worse and
     * quieter: the read is ordered `sort` ASCENDING, so a truncated page is the
     * BOTTOM of the order by sort and the maximum in hand is not the maximum on
     * the server; the new line lands in the middle of the client's morning.
     *
     * There is no honest append over a list this screen has not seen the end
     * of, so it refuses and says which of the two it is. Nothing is lost: the
     * typed line is still in the field. */
    if (!isWhole(status)) {
      Alert.alert(
        'Not Added Yet',
        status === 'error'
          ? `Their list could not be read, so there is no way to tell what a new line should sit after — it would go to the top of ${who}'s morning instead of the end. Pull down to read it again, then add the line.`
          : `Their list came back at the row limit, so this screen has not seen the end of it and a new line would land in the middle rather than at the bottom. Pull down to read it again, then add the line.`,
      );
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
      Alert.alert('Not Saved', 'That line is not on their list. Check your connection and try again.');
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
      Alert.alert('Not Saved', 'Their list is unchanged.');
      return;
    }
    setItems((p) => (p ?? []).map((x) => (x.id === it.id ? { ...x, active } : x)));
  };

  const remove = (it: Item) => {
    Alert.alert(
      'Delete This Line?',
      `"${it.label}" goes for good, and their past ticks for it stop being readable. Turning it off keeps the record.`,
      [
        { text: 'Keep It', style: 'cancel' },
        { text: 'Turn Off', onPress: () => setActive(it, false) },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { data, error } = await supabase
            .from('coach_checklist_items').delete().eq('id', it.id).select('id');
          setBusy(false);
          if (error || !data || !data.length) {
            reportError('coachChecklists.remove', error);
            Alert.alert('Not Removed', 'It is still on their list.');
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
      Alert.alert('Order Not Saved', 'Reloading their list so you can see what actually stored.');
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

  /**
   * Everybody the lines could actually reach.
   *
   * Not themselves: copying somebody's list onto themselves is the one gesture
   * here with no meaning at all.
   *
   * And not a client the coach typed in by hand. `coach_checklist_coach_write`
   * checks `is_my_client()`, an EXISTS over `clients`, so every insert for a
   * `coach_clients` row is refused — and this panel offered those names, let a
   * coach tick them, counted them in "Copy to 6", and then reported each one
   * back as "the server took the request and wrote nothing — they may no longer
   * be your client", which is a sentence about a coaching relationship ending.
   * It never existed as an account; there is no list on a phone they have not
   * got. Offering the tick and explaining the refusal afterwards is worse than
   * not offering it, so the names are withheld and the reason is said once.
   */
  const copyCandidates = useMemo(
    () => r.roster.filter((c) => c.id !== picked && clientIsQueryable(c.id, c.handAdded)),
    [r.roster, picked],
  );
  /** How many were withheld for that reason, so the absence is explained
   *  rather than looking like a roster that came back short. */
  const copyNoAccount = useMemo(
    () => r.roster.filter((c) => c.id !== picked && !clientIsQueryable(c.id, c.handAdded)).length,
    [r.roster, picked],
  );

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
      Alert.alert(copyGuard.label ?? 'Not Copied', copyGuard.reason ?? 'Nothing was copied.');
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
          Alert.alert('Not Copied', 'Nothing was written to anybody\u2019s list. Check your connection and try again.');
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

        <PageHead title="Their Checklists" subtitle="Your book" />
        {/* What this screen does, behind a fold. It was the paragraph every
            visit opened on, above the client picker it explains. */}
        <Expandable title="How Checklists Work" note="You set the lines. They do the ticking">
          <Text style={{ ...ty.label, color: t.ink2 }}>
            Lines you add appear on that client&rsquo;s daily list, marked as set by you, beside the
            ones worked out from their own plan and targets. You can&rsquo;t tick them. That stays
            with them.
          </Text>
        </Expandable>

        {r.status === 'error' ? (
          <Section>
            <Notice tone={t.warn} kicker="Roster" title="Your Clients Could Not Be Read"
              note="This is not an empty book. Nobody is listed below because the list did not come back — pull back and open this again once you are connected." />
          </Section>
        ) : null}

        <Section>
          <SectionHead title="Client" />
          {r.roster.length === 0 && isWhole(r.status) ? (
            <EmptyRoster lacks="there is no list to add to" />
          ) : r.roster.length === 0 && r.status === 'loading' ? (
            /* An empty chip row while the roster lands reads as a coach with
               nobody on their book — the claim `EmptyRoster` above is gated on
               `isWhole` precisely to avoid making. Said in words instead, as
               app/(trainer)/client-week.tsx says it. */
            <Text style={{ ...ty.body, color: t.ink3 }}>Reading your clients…</Text>
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

        {picked && !askable ? (
          /* ── the third answer ──────────────────────────────────────────
             Not "you have set them nothing" and not "the read failed". This
             person is a name in the coach's own book with no account behind
             it: there is no list to set, no tick to count, and nothing was
             refused because nothing was ever entitled to be asked.

             The panels below are withheld rather than disabled. A greyed Add
             field invites a coach to type a line that `coach_checklist_coach_write`
             will refuse whatever they do, and the copy panel would offer to
             give somebody else a list that does not exist. */
          <View>
            <Section>
              <Notice kicker="No Account" title={`${client?.name ?? 'This Client'} Has No Repple Account`}
                note={`You added ${who} to your book by hand. A checklist is a list on somebody's phone and a tick is something they do on it, so there is nothing here to set and nothing to count — and none of that is a read that failed. Invite them from your client list; from the day they accept, this screen works like everybody else's.`} />
            </Section>
          </View>
        ) : picked ? (
          <View>
            <Section>
              {/* `isWhole(status)`, not `shown ?`. The array being non-null
                  says a read RETURNED; it does not say it returned everything,
                  and eleven lines below this header the same screen refuses to
                  compute adherence for exactly that reason. A coach told "8
                  showing" copies those eight onto three more clients through
                  the bulk control, and the four the page cut off are silently
                  not part of anybody's routine. */}
              <SectionHead title={client?.name ?? 'Their List'}
                note={shown && isWhole(status) ? `${shown.filter((i) => i.active).length} showing` : undefined} />

              {/* The caveats come BEFORE the figures they qualify. A coach who
                  reads "3 of 28" first and the reason it might not mean what it
                  looks like second has already formed the thought, and the
                  second sentence is arguing with it. */}
              {tickStatus === 'error' ? (
                <Notice tone={t.warn} kicker="Not Loaded" title="Their Ticks Could Not Be Read"
                  note="Nothing below says how often anything was done, because none of it came back. That is a read that failed, not a record of somebody ticking nothing — and the two are indistinguishable unless somebody says which it was." />
              ) : tickStatus === 'partial' ? (
                <PartialRead what="ticks in the last four weeks" onPress={() => { if (picked) void loadTicks(picked); }} />
              ) : status === 'partial' ? (
                <PartialRead what="lines on their list" onPress={() => { if (uid && picked) void load(uid, picked); }} />
              ) : adhStatus === 'loading' ? (
                <Text style={{ ...ty.body, color: t.ink3 }}>Reading their ticks…</Text>
              ) : summary ? (<>
                {/* The window as a bar: days that carry a tick of anything, of
                    the days in the window. `summary` exists only when the
                    list AND the ticks were read whole, so the bar is never a
                    share of part of a record. It is the picture of the
                    sentence under it and scores nothing per line; the quiet
                    days are SET ASIDE, as the note says, not counted as
                    misses, which is why this is a bar of active days and not
                    of adherence. */}
                <Meter label="Days with a Tick" tone="teal"
                  val={summary.window.days - summary.silentDays} target={summary.window.days}
                  note={`${summary.window.days - summary.silentDays} of ${summary.window.days} days`} />
                <View style={{ height: sp.md }} />
                <Notice
                  kicker={`Last ${summary.window.days} Days, to ${dayLabel(summary.window.end)}`}
                  title={summary.silentDays === 0
                    ? `Something was logged on every one of the last ${summary.window.days} days`
                    : `Nothing at all was logged on ${summary.silentDays} of the last ${summary.window.days} days`}
                  note={`A line counts from the day you added it and stops the day you take it off, so nothing here is measured over days it was not on their list. ${summary.silentDays === 0 ? 'Every day carries a tick of something, so a line left unticked on one of them is a line they saw and left.' : 'On the quiet days a line they skipped and a day they never opened the app look exactly the same, so those days are set aside and never counted as misses.'} Today is in none of it — it is not over.`}
                />
              </>) : null}

              {status === 'error' ? (
                <Notice tone={t.warn} kicker="Not Loaded" title="Their List Could Not Be Read"
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
                    {/* `opacity: 0.3` at the ends of the list is the whole of
                        what says these two are refused, and opacity is exactly
                        what a screen reader does not have. A coach using
                        VoiceOver on the first line heard "Move Water up,
                        button", tapped it, and got nothing — four times, with
                        no sentence anywhere saying it was already at the top.
                        `busy` is on it too: a reorder in flight refuses every
                        one of these and looked identical. */}
                    {/* Four controls in one 30pt row: `ty.micro` is a 14pt
                        line inside 8pt of padding, so every one of them was
                        about 30 x 35 — under the 44 in src/lib/a11y.ts, on the
                        screen a coach uses standing next to a client. Slop and
                        not size, because growing them would push the label off
                        the row; VERTICAL slop only, because they sit 8pt apart
                        and horizontal slop would have them fighting over the
                        gap. Same shape as app/(trainer)/log-session.tsx. */}
                    <Pressable onPress={() => move(it, -1)} disabled={busy || i === 0} accessibilityRole="button" accessibilityLabel={`Move ${it.label} up`}
                      accessibilityState={{ disabled: busy || i === 0, busy }}
                      hitSlop={{ top: hitSlopFor(30), bottom: hitSlopFor(30), left: 0, right: 0 }}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === 0 ? 0.3 : 1 }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>↑</Text>
                    </Pressable>
                    <Pressable onPress={() => move(it, 1)} disabled={busy || i === shown.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${it.label} down`}
                      accessibilityState={{ disabled: busy || i === shown.length - 1, busy }}
                      hitSlop={{ top: hitSlopFor(30), bottom: hitSlopFor(30), left: 0, right: 0 }}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, opacity: i === shown.length - 1 ? 0.3 : 1 }}>
                      <Text style={{ ...ty.micro, color: t.ink3 }}>↓</Text>
                    </Pressable>
                    <Pressable onPress={() => setActive(it, !it.active)} disabled={busy} accessibilityRole="button"
                      accessibilityState={{ disabled: busy, busy }}
                      accessibilityLabel={it.active ? `Take ${it.label} off their list` : `Put ${it.label} back on their list`}
                      hitSlop={{ top: hitSlopFor(30), bottom: hitSlopFor(30), left: 0, right: 0 }}
                      style={{ paddingHorizontal: sp.md, paddingVertical: sp.sm, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
                      <Text style={{ ...ty.micro, color: t.ink2 }}>{it.active ? 'On' : 'Off'}</Text>
                    </Pressable>
                    {/* The label names the line but not what happens to it.
                        `remove` confirms first and the sheet spells out that
                        past ticks stop being readable, so the destruction IS
                        said — but only after the tap. A reader arriving on a
                        bare "✕" deserves it before. */}
                    <Pressable onPress={() => remove(it)} disabled={busy} accessibilityRole="button" accessibilityLabel={`Delete ${it.label} from their list`}
                      accessibilityHint="Asks first. Deleting also stops their past ticks for this line being readable."
                      accessibilityState={{ disabled: busy, busy }}
                      hitSlop={{ top: hitSlopFor(30), bottom: hitSlopFor(30), left: 0, right: 0 }}
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
              <Section>
                <SectionHead title="From Their Own Plan and Targets" />
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
                <Section>
                  <SectionHead title="Give These to Somebody Else"
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
                      {/* Why the list above is shorter than the book. Said
                          rather than left as an absence a coach reads as a
                          roster that came back short. */}
                      {copyNoAccount > 0 ? (
                        <Text style={{ ...ty.caption, color: t.ink3, marginBottom: sp.md }}>
                          {copyNoAccount === 1
                            ? 'One client on your book is not here: you added them by hand, so there is no app for a checklist to appear in.'
                            : `${copyNoAccount} clients on your book are not here: you added them by hand, so there is no app for a checklist to appear in.`}
                        </Text>
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
                        <Notice tone={t.warn} kicker="Held" title={copyGuard.label ?? 'Not Copied'}
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
