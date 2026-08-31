// Owner · Deletion requests. The queue of people who asked to be erased, and
// the 30-day clock the store listing promises them.
//
// 41-account-deletion.sql shipped the whole mechanism — the `pending_deletions`
// view, `action_account_deletion()`, the `deletion_log` audit trail — and
// nothing in any app read or called a line of it. So a member tapped "delete my
// account", `request_account_deletion()` set a timestamp, and the request
// reached nobody. This screen is the operator surface that turns that promise
// into something a gym can actually keep.
//
// Three things this screen is careful about:
//
//  · The delete is IRREVERSIBLE and cascades across 39 tables. It gets two
//    confirmations naming the person, not one tap, and the wording says
//    plainly what survives (payments, door-log visits, guest passes — kept
//    but detached) and what does not. Invoices and memberships are in the
//    second group: they CASCADE. Worth stating because it is the opposite of
//    what you would assume of a financial record, and an earlier draft of
//    41-account-deletion.sql asserted the reverse.
//
//  · The clock is the point. `days_remaining` counts down from 30; a row at
//    zero is a broken promise already, so it reads as critical rather than as
//    one more grey row in a list.
//
//  · An empty queue is the GOOD state, not a blank screen. It says so, because
//    "nothing here" and "nothing loaded yet" look identical otherwise and only
//    one of them means the gym is in the clear.
//
// No filtering by tenant happens in this file on purpose: `pending_deletions`
// is security_invoker and `deletion_log` carries an owner policy, so the
// database scopes both to the caller's own gym. Re-filtering here would add a
// second source of truth and a way for a not-yet-loaded tenant to render an
// empty queue that looks like the good state.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { Rule, Section, SectionHead, Hero, KpiRow, fig, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty } from '../../src/theme/scale';
import type { Theme } from '../../src/theme/tokens';
import { supabase } from '../../src/lib/supabase';
import { reportError } from '../../src/lib/reportError';

/** A row of `pending_deletions`. Nulls are kept as nulls — see `fig`. */
interface Pending {
  subjectId: string;
  name: string | null;
  role: string | null;
  requestedAt: string | null;
  /** Counts down from 30. Null only if the view ever returns a non-number. */
  daysRemaining: number | null;
}

/** A row of `deletion_log` — the record that outlives the profile. */
interface Actioned {
  id: string;
  label: string | null;
  requestedAt: string | null;
  actionedAt: string | null;
  note: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', trainer: 'Trainer', client: 'Member',
};

/** A timestamp as the day it happened, or a dash. Never the string "null". */
function day(iso: string | null): string {
  if (!iso) return '—';
  const d = String(iso).slice(0, 10);
  return d.length === 10 ? d : '—';
}

/**
 * How urgent a row is. Zero days left means the 30 days the store listing
 * promises are already spent, which is a different kind of problem from "due
 * soon" and must not read the same.
 */
function toneFor(t: Theme, days: number | null): string {
  if (days == null) return t.ink3;
  if (days <= 0) return t.crit;
  if (days <= 7) return t.s3;
  return t.ink3;
}

function clockLabel(days: number | null): string {
  if (days == null) return 'Unknown';
  if (days <= 0) return 'Overdue';
  return `${days}d left`;
}

export default function OwnerDeletions() {
  const t = useTheme();
  const router = useRouter();

  const [pending, setPending] = useState<Pending[] | null>(null);   // null = not loaded yet
  const [log, setLog] = useState<Actioned[] | null>(null);          // null = not loaded yet
  const [failed, setFailed] = useState(false);                      // the queue read itself failed
  const [busy, setBusy] = useState<string | null>(null);            // subject id being actioned

  const load = useCallback(async () => {
    // The two reads fail INDEPENDENTLY and are handled separately on purpose.
    // A gym that cannot read its own history still has to see who is waiting,
    // so a broken audit trail must not blank the queue next to it.
    const [q, l] = await Promise.allSettled([
      supabase
        .from('pending_deletions')
        .select('subject_id, full_name, role, deletion_requested_at, days_remaining')
        .order('deletion_requested_at', { ascending: true }),
      supabase
        .from('deletion_log')
        .select('id, subject_label, requested_at, actioned_at, note')
        .order('actioned_at', { ascending: false })
        .limit(50),
    ]);

    // supabase-js RESOLVES on a database error rather than rejecting, so the
    // `.error` check below is doing the real work — a rejected promise only
    // covers the network dying. Without it an RLS denial or a 500 arrives as
    // `data: null`, falls through `?? []`, and renders as "nobody is waiting":
    // a gym told it has no obligations because the read failed. That false
    // all-clear is the single worst thing this screen could do, so the failure
    // is kept visible rather than smoothed into an empty list.
    if (q.status === 'fulfilled' && !q.value.error) {
      setPending((q.value.data ?? []).map((r: any) => ({
        subjectId: String(r.subject_id),
        name: r.full_name ?? null,
        role: r.role ?? null,
        requestedAt: r.deletion_requested_at ?? null,
        daysRemaining: typeof r.days_remaining === 'number' ? r.days_remaining : null,
      })));
      setFailed(false);
    } else {
      reportError('deletions.fetch', q.status === 'rejected' ? q.reason : q.value.error);
      setPending(null);
      setFailed(true);
    }

    if (l.status === 'fulfilled' && !l.value.error) {
      setLog((l.value.data ?? []).map((r: any) => ({
        id: String(r.id),
        label: r.subject_label ?? null,
        requestedAt: r.requested_at ?? null,
        actionedAt: r.actioned_at ?? null,
        note: r.note ?? null,
      })));
    } else {
      reportError('deletions.log', l.status === 'rejected' ? l.reason : l.value.error);
      setLog(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loaded = pending !== null;
  const queue = pending ?? [];
  const overdue = queue.filter((p) => p.daysRemaining != null && p.daysRemaining <= 0).length;
  const clocks = queue.map((p) => p.daysRemaining).filter((d): d is number => d != null);
  const soonest = clocks.length ? Math.min(...clocks) : null;

  const run = async (p: Pending) => {
    setBusy(p.subjectId);
    try {
      const { error } = await supabase.rpc('action_account_deletion', { p_subject: p.subjectId });
      if (error) throw error;
      await load();
    } catch (e) {
      reportError('deletions.action', e);
      // The database's own refusals are written for a person to read ("That
      // member has not asked to be deleted."), so show them rather than a
      // generic failure that hides which of the two guards fired.
      const msg = e instanceof Error ? e.message : 'Nothing was deleted. Check your connection and try again.';
      Alert.alert('Not deleted', msg);
    } finally { setBusy(null); }
  };

  /**
   * Two confirmations, both naming the person. The first explains the blast
   * radius; the second exists so the destructive tap is never the one already
   * under your thumb from opening the first.
   */
  const confirm = (p: Pending) => {
    const who = p.name ?? 'This account';
    Alert.alert(
      `Delete ${who}?`,
      `This permanently erases ${who} and everything of theirs — their profile, workouts, logs, scans, messages and bookings, across 39 tables.\n\n` +
      `Their invoices and memberships go too. Payments, door-log visits and guest passes stay, with the person detached from them.\n\n` +
      `Requested ${day(p.requestedAt)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => {
          Alert.alert(
            'This cannot be undone',
            `${who} will be deleted now. There is no undo, no recovery and no backup you can restore them from.`,
            [
              { text: 'Keep the account', style: 'cancel' },
              { text: 'Delete permanently', style: 'destructive', onPress: () => { void run(p); } },
            ],
          );
        } },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.lg, marginBottom: sp.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron" size={20} color={t.ink3} />
          </Pressable>
          <Text style={{ ...ty.title, color: t.ink, flex: 1 }}>Deletion Requests</Text>
        </View>

        <Hero
          label="Waiting on You"
          figure={fig(loaded ? queue.length : null)}
          tone={failed || overdue ? t.crit : undefined}
          note={failed
            ? 'The queue could not be read. This is NOT an all-clear — pull to retry.'
            : !loaded
            ? 'Reading the queue…'
            : queue.length === 0
              ? 'Nobody is waiting to be erased. This is the good state.'
              : overdue
                ? `${overdue} past the 30 days we promise — action ${overdue === 1 ? 'it' : 'them'} today.`
                // `soonest` is null only if every row came back without a clock. Interpolating
                // it anyway is how "null days" reaches a reader; say what is known instead.
                : soonest == null
                  ? `${queue.length} waiting, with no clock recorded against ${queue.length === 1 ? 'it' : 'them'}.`
                  : `Soonest runs out in ${soonest} ${soonest === 1 ? 'day' : 'days'}.`}
        />

        <Rule />

        <Section>
          <SectionHead title="The 30-day Promise" />
          <KpiRow items={[
            { label: 'Waiting', value: fig(loaded ? queue.length : null) },
            { label: 'Overdue', value: fig(loaded ? overdue : null) },
            { label: 'Soonest', value: fig(soonest), unit: soonest == null ? undefined : 'd' },
          ]} />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
            The store listing tells members their account is deleted within 30 days of asking.
            The clock starts the moment they tap it in the app, not when you open this screen.
          </Text>
        </Section>

        <Rule />

        <Section>
          <SectionHead title={loaded && queue.length ? `The queue · ${queue.length}` : 'The queue'} />
          {failed ? (
            <View>
              <Flag tone={t.crit}>
                Could not read the queue. Nobody has been cleared — this screen simply does not
                know who is waiting, which is not the same as nobody waiting.
              </Flag>
              <Pressable
                onPress={() => { void load(); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Try reading the queue again"
                style={{ alignSelf: 'flex-start', marginTop: sp.md, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: 7 }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.ink2 }}>Try Again</Text>
              </Pressable>
            </View>
          ) : !loaded ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Loading…</Text>
          ) : queue.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing to action. Nobody at this gym has asked to be deleted, so no clock is
              running — an empty queue here is the outcome you want, not a screen that failed
              to load.
            </Text>
          ) : queue.map((p, i) => {
            const tone = toneFor(t, p.daysRemaining);
            const working = busy === p.subjectId;
            return (
              <View key={p.subjectId}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }} numberOfLines={1}>
                      {fig(p.name)}
                    </Text>
                    <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                      {p.role ? ROLE_LABEL[p.role] ?? p.role : 'Unknown role'} · asked {day(p.requestedAt)}
                    </Text>
                  </View>
                  <View style={{ borderWidth: hairline, borderColor: tone, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 2 }}>
                    <Text style={{ ...ty.micro, color: tone }}>{clockLabel(p.daysRemaining)}</Text>
                  </View>
                  <Pressable
                    onPress={() => confirm(p)}
                    disabled={working}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Permanently delete the account of ${p.name ?? 'this member'}`}
                    style={{ backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 7, borderWidth: hairline, borderColor: working ? t.ring : t.crit }}>
                    {/* The border is the mark now. crit as label text measures
                        3.03–4.05:1 on every palette, and this is the control
                        that erases a member permanently — the word "Delete"
                        and the accessibility label carry it without colour. */}
                    <Text style={{ ...ty.label, fontWeight: '600', color: working ? t.ink3 : t.ink }}>
                      {working ? 'Deleting…' : 'Delete'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Already Actioned" note={log?.length ? `${log.length} recorded` : undefined} />
          {log === null ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              The record could not be read just now. Deletions you have already carried out are
              still logged — this is a display problem, not a missing history.
            </Text>
          ) : log.length === 0 ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>
              Nothing actioned yet. Every deletion you carry out is recorded here — the person is
              gone, the record that they asked and when you did it is not.
            </Text>
          ) : log.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Rule /> : null}
              <View style={{ paddingVertical: sp.md }}>
                <Text style={{ ...ty.body, color: t.ink2 }} numberOfLines={1}>{fig(r.label)}</Text>
                <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                  Asked {day(r.requestedAt)} · deleted {day(r.actionedAt)}
                </Text>
                {r.note ? <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{r.note}</Text> : null}
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
