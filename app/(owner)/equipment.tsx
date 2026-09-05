// Owner · Equipment register. What the gym owns, what is down, and what is
// about to need a service.
//
// The rules behind this screen already shipped in src/lib/gymEquipment.ts with
// tests; until now nothing rendered them. Everything here is a view onto that
// library — no maths lives in this file.
//
// Two distinctions the screen is careful to preserve, because collapsing them
// is what makes a maintenance list useless:
//
//  · "unscheduled" and "unrecorded" are different. The first means the gym
//    decided this kit needs no service schedule. The second means it set one
//    and never logged a service — that is the row worth chasing, and merging
//    them into "no service due" would hide it.
//
//  · A register with nothing in it does not mean a gym with no equipment. Any
//    count derived from an empty register renders as a dash and a prompt to
//    add the kit, never as a confident zero.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, ListRow, Cta, Ghost, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { useTenant } from '../../src/ui/tenant';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';
// The gym's own calendar day, and the sentence for a gym that has not said
// which calendar that is. `tenants.timezone` (supabase/parts/710) is where a
// gym answers; src/lib/gymToday.ts is the one place that turns the answer into
// a day and NAMES which clock it used.
import { fetchGymZone } from '../../src/lib/gymZone';
import { gymTodayWindow } from '../../src/lib/gymToday';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { readState, staleNote } from '../../src/lib/staleRead';
import {
  fetchEquipment, addEquipment, setStatus, recordService,
  summariseRegister, needsAttention, serviceState, nextServiceDue,
  type Equipment, type ServiceState,
} from '../../src/lib/gymEquipment';
import { BACK_ICON } from '../../src/ui/direction';

/**
 * Today, on the GYM's calendar — not UTC's, and no longer the reader's either.
 *
 * ── Where this started ────────────────────────────────────────────────────
 *
 * `new Date().toISOString().slice(0, 10)`, the UTC day. A service recorded at
 * 5pm in Los Angeles was dated TOMORROW, and this screen reads that date back
 * into a SAFETY CONFIRMATION — "the treadmill will be recorded as serviced on
 * …" — and forward into `serviceState`, which decides what is overdue. Stating
 * a date to somebody and writing a different one is bad; doing it to a machine's
 * service history is the kind of record an insurer reads afterwards.
 *
 * ── Why `isoDate(new Date())` was only half the fix ───────────────────────
 *
 * It swapped UTC's day for the READER's, and the reader is a phone. The same
 * gym opened at the front desk and by an owner on holiday in Lisbon reports two
 * different Tuesdays out of one database, with nothing on either screen saying
 * which — and this screen WRITES the day it computed. An owner three hours west
 * of their own gym, at nine in the evening, logs a service against yesterday.
 *
 * `tenants.timezone` exists (supabase/parts/710) and `gymTodayWindow` is the one
 * place in TypeScript that turns it into a day. It never guesses: a gym that has
 * not set a zone, a zone read that failed, and a stored zone this runtime cannot
 * resolve all come back as the reader's day with `basis: 'reader'` and
 * `NO_ZONE_NOTE` attached, which this screen prints beside the board rather than
 * quietly substituting a calendar nobody chose.
 */

const STATE_LABEL: Record<ServiceState, string> = {
  overdue: 'Overdue',
  due: 'Due',
  unrecorded: 'Never serviced',
  ok: 'In date',
  unscheduled: 'No schedule',
};

function toneFor(t: Theme, s: ServiceState): string {
  if (s === 'overdue') return t.crit;
  if (s === 'due') return t.s3;
  if (s === 'unrecorded') return t.ink3;
  if (s === 'ok') return t.brand;
  return t.ink3;
}

function Pill({ t, state }: { t: Theme; state: ServiceState }) {
  const c = toneFor(t, state);
  return (
    <View style={{ borderWidth: hairline, borderColor: c, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 }}>
      <Text style={{ ...ty.micro, color: c }}>{STATE_LABEL[state]}</Text>
    </View>
  );
}

export default function OwnerEquipment() {
  const t = useTheme();
  const router = useRouter();
  const { tenant } = useTenant();

  const [items, setItems] = useState<Equipment[] | null>(null);   // null = not loaded yet
  const [failed, setFailed] = useState(false);                    // the register read itself failed
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState('1');
  const [interval, setInterval] = useState('');
  /** When the register last landed. Not moved by a refused read — a service
   *  board an owner walks past is exactly the figure that must say its age. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  /**
   * `tenants.timezone`, and whether it could be read at all.
   *
   * Read beside the register rather than pulled off the tenant context, which
   * does not carry it. Three outcomes and they are kept apart:
   * `{ zone: 'Asia/Dubai' }` is a gym that has said, `{ zone: null, error: null }`
   * is a gym that has not, and `{ error }` is a read that failed — and the third
   * must never be shown as the second, because "this gym has not set a timezone"
   * is an instruction to go and change a setting that may already be right.
   */
  const [zone, setZone] = useState<string | null>(null);
  const [zoneUnread, setZoneUnread] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    // The zone is read first and its failure is separate: a register full of
    // kit is still worth showing to somebody whose timezone read was refused,
    // and `gymTodayWindow` answers a null zone with the reader's day and the
    // note that says so.
    try {
      const z = await fetchGymZone(supabase, tenant.id);
      setZone(z.zone);
      setZoneUnread(!!z.error);
    } catch (e) {
      reportError('equipment.zone', e);
      setZone(null); setZoneUnread(true);
    }
    try {
      setItems(await fetchEquipment(supabase, tenant.id));
      setFailed(false);
      setFetchedAt(Date.now());
    } catch (e) {
      reportError('equipment.fetch', e);
      // NOT `setItems([])`. An empty array here would have made a read that
      // never came back render as the register the header comment promises it
      // will not invent: "Nothing recorded yet", nothing needing attention,
      // and every count sitting at a dash for the wrong reason. An owner
      // checking whether anything is due a service would have been shown a
      // clean board by a query that failed, and walked past a treadmill that
      // was overdue. Null keeps it "not known" and `failed` says which.
      //
      // What it no longer does is throw away a register that HAD come back. The
      // Try Again button, and now the pull, both run this loader, and a refusal
      // on the second read says nothing about the first — the kit on screen is
      // still what the last good read returned and the stamp above still says
      // when. Only a first read that has never landed leaves this null.
      setFailed(true);
    }
  }, [tenant?.id]);

  useEffect(() => { void load(); }, [load]);

  // The register is the only server read on this screen — the summary, the
  // attention queue and the list below are all derived from it.
  const pull = usePullToRefresh(load);

  // Recomputed on every render rather than frozen into a `useState` initialiser.
  // A board left open across midnight — which is what a maintenance screen on a
  // front desk does — would otherwise keep marking things due against
  // yesterday, and would write yesterday's date onto a service logged at ten
  // past twelve.
  const dayWindow = gymTodayWindow(zone);
  const today = dayWindow.day;
  /**
   * The sentence to print beside the board about whose day it is.
   *
   * Two different silences and they get two different sentences. A failed zone
   * read is not a gym that has not set a timezone.
   */
  const clockNote = zoneUnread
    ? 'This gym’s timezone could not be read, so the dates and the “due” column below are your own device’s, '
      + 'not the gym’s. That is a read that did not come back, not a gym with no timezone set — '
      + 'nothing about the schedules has changed.'
    : dayWindow.note;
  // The loader above already keeps a register that HAD come back when a later
  // read is refused. What it did not do is tell the screen apart from a screen
  // that has never read anything — so the hero printed a real count from the
  // earlier read under a note saying "nothing here is known", which is a figure
  // and a disclaimer of that figure side by side. src/lib/staleRead.ts is the
  // four states, and the two of them that were sharing one sentence.
  const readSt = readState(items, failed);
  const loaded = items !== null;
  const list = items ?? [];
  const sum = loaded ? summariseRegister(list, today) : null;
  const queue = loaded ? needsAttention(list, today) : [];

  const commitAdd = async () => {
    const n = name.trim();
    if (!n || !tenant?.id) return;
    const quantity = parseInt(qty, 10);
    const days = parseInt(interval, 10);
    setBusy(true);
    try {
      await addEquipment(supabase, tenant.id, {
        name: n,
        category: category.trim() || null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        // Blank means "this kit needs no schedule" — a decision, not a gap.
        serviceIntervalDays: Number.isFinite(days) && days > 0 ? days : null,
      });
      setAddOpen(false);
      setName(''); setCategory(''); setQty('1'); setInterval('');
      await load();
    } catch (e) {
      reportError('equipment.add', e);
      Alert.alert('Could not add that', 'The item was not saved. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const markServiced = (e: Equipment) => {
    Alert.alert('Serviced today?', `${e.name} will be recorded as serviced on ${today}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Record', onPress: async () => {
        // Said out loud: a service that was not written leaves the machine on
        // the due list, and an owner told nothing reads the reloaded register
        // as the record having been kept.
        // The log entry goes with the date. `recordService` clears the note as
        // it writes, so the description of what was wrong with the machine is
        // about to be deleted — carrying it into the entry's findings is the
        // only thing that keeps it, and before supabase/parts/186 there was
        // nowhere for it to go.
        try {
          await recordService(supabase, e.id, today, tenant?.id ? {
            tenantId: tenant.id,
            equipmentLabel: e.name,
            kind: 'service',
            findings: e.note,
            recordedBy: null,
          } : undefined);
          await load();
        }
        catch (err) {
          reportError('equipment.service', err);
          Alert.alert('Could not record that service',
            (err instanceof Error && err.message) || 'Nothing was written. Check your connection and try again.');
        }
      } },
    ]);
  };

  const toggleStatus = (e: Equipment) => {
    const next = e.status === 'in_service' ? 'out_of_service' : 'in_service';
    const verb = next === 'out_of_service' ? 'Take out of service' : 'Put back in service';

    /**
     * Taking a machine out asks WHY, and putting it back does not.
     *
     * `setStatus` has accepted a reason since it was written and neither
     * surface ever passed one, so every out-of-action machine in the product
     * rendered "no reason recorded" — about a field nothing could fill in. The
     * person tapping this is standing next to the machine and is the only
     * person who knows; asking anywhere else is asking somebody to remember.
     *
     * `Alert.prompt` is iOS-only. On Android it is undefined, so the fallback
     * below records the status change with no reason rather than doing nothing
     * — a machine an owner cannot take out of service because their phone is
     * the wrong shape is a worse failure than a missing sentence.
     */
    const write = async (reason: string | null) => {
      try {
        await setStatus(supabase, e.id, next, undefined, reason);
        await load();
      } catch (err) {
        reportError('equipment.status', err);
        Alert.alert(`Could not ${verb.toLowerCase()}`,
          (err instanceof Error && err.message) || 'The register is unchanged. Check your connection and try again.');
      }
    };

    if (next === 'out_of_service' && typeof Alert.prompt === 'function') {
      Alert.prompt(
        'What is wrong with it?',
        `${e.name}${e.quantity > 1 ? ` (${e.quantity} units)` : ''} — this is what everyone else sees beside it until it is back.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Take out', style: 'destructive', onPress: (v?: string) => { void write((v ?? '').trim() || null); } },
        ],
        'plain-text',
      );
      return;
    }

    Alert.alert(verb + '?', `${e.name}${e.quantity > 1 ? ` (${e.quantity} units)` : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: verb, style: next === 'out_of_service' ? 'destructive' : 'default', onPress: async () => {
        // Said out loud. This is the register's most physical write — a machine
        // marked out of service is one nobody is meant to stand on — and a
        // refusal that only reached the error log left it marked in service
        // under an owner who believed otherwise.
        await write(null);
      } },
    ]);
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 12 } as const;
  const lab = { ...ty.caption, color: t.ink2, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={pull}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={BACK_ICON} size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Equipment</Text>
        </View>

        {/* The pull-to-refresh above already reloads; this says WHEN, which is
            the half a gesture cannot tell you, and whether the phone can even
            reach us — a plant room is a basement with weights in it. */}
        <Fetched at={fetchedAt} onRefresh={() => { void load(); }} style={{ marginTop: 0, marginBottom: sp.md }} />

        <Hero
          label="Needing Attention"
          figure={!loaded ? '—' : String(queue.length)}
          note={readSt === 'failed'
            // Nothing has ever landed, so the figure above is a dash and this
            // is the only thing on the screen worth reading.
            ? 'The register could not be read, so nothing here is known — that is a failed read, not an all-clear.'
            : readSt === 'stale'
            // Something DID land, and the count above is real as of the stamp
            // under the title. The old copy said "nothing here is known" over
            // it, which was the wrong half of the truth.
            ? staleNote('register')
            : !loaded
            ? 'Reading the register…'
            : list.length === 0
              ? 'Nothing on the register yet — add your kit and this becomes the maintenance list.'
              : queue.length === 0
                ? 'Every scheduled item is in date.'
                : `${sum?.overdue ?? 0} overdue · ${sum?.due ?? 0} due · ${sum?.unrecorded ?? 0} never serviced`}
        />

        {/* Whose day the "due" column was cut on. Printed rather than assumed:
            every date this screen shows, and every date it WRITES when a
            service is logged, comes off `today` above, and a board that says
            "Overdue" against a calendar the reader brought with them from
            another timezone is a claim about a machine somebody stands on.
            Nothing appears here when the gym has set a zone and it was read. */}
        {clockNote ? (
          <Flag tone={t.warn} style={{ marginTop: sp.md }}>{clockNote}</Flag>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="The Register" />
          <KpiRow items={[
            { label: 'Items', value: !loaded || list.length === 0 ? '—' : String(sum!.items) },
            { label: 'Usable Units', value: !loaded || list.length === 0 ? '—' : String(sum!.usableUnits) },
            { label: 'Out of Service', value: !loaded || list.length === 0 ? '—' : String(sum!.downUnits) },
          ]} />
          {failed ? (
            // Said "pull the screen again" over a ScrollView with no
            // RefreshControl on it, and there was no retry anywhere else on the
            // screen either — so the only instruction offered to an owner whose
            // maintenance board had failed to load was a gesture that does
            // nothing. The gesture is real now, and the button under "All kit"
            // below runs the same read.
            <Flag tone={t.crit} style={{ marginTop: sp.md }}>
              {loaded
                ? 'The register could not be read again just now. These are from the last read that came back — the stamp at the top says when.'
                : 'These are blank because the read failed, not because the register is empty. Pull down, or read it again from the button below, before assuming nothing is due.'}
            </Flag>
          ) : loaded && list.length === 0 ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              An empty register is not an empty gym. These stay blank until the kit is entered,
              rather than reporting a confident zero.
            </Text>
          ) : null}
        </Section>

        <Rule />

        {/* The catalogue hangs off the register rather than off the dashboard
            because the two answer one question from opposite sides: this screen
            is the kit the gym owns, and the library is what the platform can
            teach on it. An owner standing in front of a rack of kettlebells and
            wondering what their members will actually be shown for it is one
            tap away here, and would be nowhere from a revenue roll-up. */}
        <Section>
          <SectionHead title="What the platform can teach on it" />
          <ListRow icon="dumbbell" title="Exercise Library"
            note="Every movement in the catalogue, filtered by the equipment it needs"
            onPress={() => router.push('/(owner)/library')} />
        </Section>

        <Rule />

        {queue.length > 0 ? (
          <>
            <Section>
              <SectionHead title="Needs Attention" />
              {queue.map(({ item, state }, i) => (
                <View key={item.id}>
                  {i > 0 ? <Rule /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{item.name}</Text>
                      <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                        {item.category || 'Uncategorised'}
                        {item.quantity > 1 ? ` · ${item.quantity} units` : ''}
                        {state === 'unrecorded'
                          ? ' · schedule set, never logged'
                          : nextServiceDue(item) ? ` · due ${nextServiceDue(item)}` : ''}
                      </Text>
                    </View>
                    <Pill t={t} state={state} />
                    <Pressable onPress={() => markServiced(item)} hitSlop={8}
                      accessibilityRole="button" accessibilityLabel={`Record service for ${item.name}`}
                      style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7 }}>
                      <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Serviced</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </Section>
            <Rule />
          </>
        ) : null}

        <Section>
          <SectionHead title={loaded && list.length ? `All kit · ${list.length}` : 'All kit'} />
          {failed ? (
            <View style={{ marginBottom: loaded && list.length ? sp.md : 0 }}>
              <Flag tone={t.crit}>
                {loaded
                  ? 'The register could not be read again just now. The kit below is the last read that came back, not a fresh one.'
                  : 'The register could not be read. This is not a list of your kit — it is nothing at all. Check your connection and read it again.'}
              </Flag>
              {/* The control the two failure messages point at. Without it both
                  of them told an owner to try again and gave them nothing to
                  press — the same shape deletions.tsx already closed. */}
              <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
                <Ghost label="Try Again" onPress={() => { void load(); }} />
              </View>
            </View>
          ) : null}
          {!loaded ? (
            failed ? null : <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : list.length === 0 ? (
            // "Nothing recorded yet" is a claim about a read that succeeded.
            failed ? null : (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing recorded yet. Add a treadmill, a rack, a set of bikes — anything you would
              notice missing.
            </Text>
            )
          ) : list.map((e, i) => {
            const st = serviceState(e, today);
            const retired = e.status === 'retired';
            const down = e.status === 'out_of_service';
            return (
              <View key={e.id}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, opacity: retired ? 0.5 : 1 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>{e.name}</Text>
                      {e.identifier ? <Text style={{ ...ty.micro, ...numeric, color: t.ink3 }}>{e.identifier}</Text> : null}
                    </View>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {e.category || 'Uncategorised'}
                      {e.quantity > 1 ? ` · ${e.quantity} units` : ''}
                      {down ? ' · out of service' : retired ? ' · retired' : ''}
                    </Text>
                    {/* The reason and how long, on the row where somebody is
                        deciding whether to chase it. Both are separate columns
                        from `note` because recordService clears the note — a
                        reason stored there disappeared the first time anybody
                        serviced the machine — and until supabase/parts/186
                        neither surface could write either, so every screen said
                        "no reason recorded" about a field nothing filled in. */}
                    {down ? (
                      // A MARK carries the tone and the words stay in ink.
                      // `t.warn` is tuned to the 3:1 a mark needs, not the 4.5:1
                      // text needs, and it measures 3.87:1 as ink on the three
                      // light palettes — so a reason printed in it is a sentence
                      // somebody on a bright gym floor cannot read.
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn, flexShrink: 0 }} />
                        <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }} numberOfLines={2}>
                          {e.outOfServiceReason ?? 'No reason was recorded'}
                          {e.outOfServiceSince ? ` · since ${e.outOfServiceSince}` : ''}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {!retired ? <Pill t={t} state={st} /> : null}
                  {!retired ? (
                    <Pressable onPress={() => toggleStatus(e)} hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${down ? 'Put back in service' : 'Take out of service'}: ${e.name}`}
                      style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface2, borderRadius: radius.sm }}>
                      <Icon name={down ? 'check' : 'wrench'} size={15} color={down ? t.brand : t.ink2} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Section>

        <View style={{ marginTop: sp.lg }}>
          <Cta label="Add Equipment" wide onPress={() => setAddOpen(true)} />
        </View>
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: t.surface, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, padding: layout.gutter, maxHeight: '90%' }}>
            {/* Four fields, two paragraphs and two buttons with nothing scrolling, so
                with the keyboard up over Name the "Add to the register" button is
                below the window. */}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
              <Text style={{ ...ty.head, color: t.ink }}>Add Equipment</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 3, marginBottom: sp.lg }}>
                One row per kind of kit. Use quantity for identical units.
              </Text>

              <Text style={lab}>Name</Text>
              <TextInput value={name} onChangeText={setName} autoFocus placeholder="e.g. Concept2 rower"
                placeholderTextColor={t.ink3} returnKeyType="next" style={inp} accessibilityLabel="Equipment name" />

              <Text style={{ ...lab, marginTop: sp.md }}>Category</Text>
              <TextInput value={category} onChangeText={setCategory} placeholder="e.g. Cardio — used by the class capacity check"
                placeholderTextColor={t.ink3} style={inp} accessibilityLabel="Category" />

              <View style={{ flexDirection: 'row', gap: sp.md, marginTop: sp.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={lab}>Quantity</Text>
                  <TextInput value={qty} onChangeText={setQty} keyboardType="number-pad" style={inp} accessibilityLabel="Quantity" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={lab}>Service every (days)</Text>
                  <TextInput value={interval} onChangeText={setInterval} keyboardType="number-pad"
                    placeholder="Optional" placeholderTextColor={t.ink3} returnKeyType="done"
                    onSubmitEditing={() => { void commitAdd(); }} style={inp} accessibilityLabel="Service interval in days" />
                </View>
              </View>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm, marginBottom: sp.lg }}>
                Leave the interval blank for kit that needs no schedule. That is recorded as a
                decision, not as a missing service.
              </Text>

              {/* The refusal was drawn and never said. This control's only
                  statement that it will not act is a grey fill, and a grey fill
                  is exactly what a screen reader does not have: VoiceOver read
                  "Add to the register" identically whether the name field was
                  filled in or empty, and a double-tap did nothing with no
                  explanation. `accessibilityState.disabled` is the announcement
                  — src/lib/a11y.ts and the `Cta` in src/ui/kit.tsx, which has
                  carried it since it was written. The hint says WHY, because
                  "dimmed" on its own is a fact about the button rather than
                  about what the person has to do. */}
              <Pressable disabled={!name.trim() || busy} onPress={commitAdd}
                accessibilityRole="button"
                accessibilityLabel="Add this item to the equipment register"
                accessibilityState={{ disabled: !name.trim() || busy, busy }}
                accessibilityHint={!name.trim() ? 'Give the item a name first.' : undefined}
                style={{ backgroundColor: name.trim() && !busy ? t.brand : t.surface2, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginBottom: sp.sm }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: name.trim() && !busy ? t.brandInk : t.ink3 }}>
                  {busy ? 'Adding…' : 'Add to the register'}
                </Text>
              </Pressable>
              <Ghost label="Cancel" onPress={() => setAddOpen(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
