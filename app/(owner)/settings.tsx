// Owner · Settings. Who is signed in, sign out, export my data, delete my
// account.
//
// WHY THIS FILE EXISTS. Repple Studio had no settings screen at all, which
// means it offered account creation and no in-app way to ask for the account
// back. Google Play requires the second wherever you do the first. The client
// app has carried `app/(client)/settings.tsx` for months; this is the same four
// capabilities, on the same `gdpr.ts` functions, for the gym owner.
//
// WHY THE OWNER'S DELETE IS NOT THE MEMBER'S DELETE. Two facts from
// 41-account-deletion.sql make this materially different:
//
//   · `action_account_deletion()` guards on `is_owner_of(subj_tenant)`. Only an
//     owner of a gym can action a deletion request at that gym. So the queue on
//     `/(owner)/deletions` — every member and coach waiting to be erased — is
//     actionable by this person and by any co-owner, and by nobody else. An
//     owner who deletes themselves while they are the last owner leaves those
//     requests with no one who can carry them out. The 30-day clock keeps
//     running; there is simply nobody left to stop it.
//
//   · The gym is not the account. `tenants` and everything hanging off it —
//     members, trainers, classes, equipment, the deletion log — survive the
//     owner's profile. Deleting the owner does not close the gym; it leaves the
//     gym without an owner. That is the opposite of what "delete my account"
//     sounds like it does, so the confirmation says it in those words.
//
// Both facts are stated from REAL numbers, read here and error-checked: how
// many people are actually waiting, and how many other owners actually remain.
// When either read fails the confirmation says it could not check, rather than
// implying a clear path. supabase-js resolves on a database error, so `.error`
// is checked on every query — a swallowed RLS denial would otherwise arrive as
// `data: null`, count as zero, and tell an owner "nobody is waiting on you"
// because the read broke.
import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import type { Theme } from '../../src/theme/tokens';
import { Rule, Section, SectionHead, ListRow, Ghost, fig } from '../../src/ui/kit';
import { sp, layout, hairline, type as ty } from '../../src/theme/scale';
import { BuildInfo } from '../../src/ui/BuildInfo';
import { useAuth } from '../../src/ui/auth';
import { useTenant } from '../../src/ui/tenant';
import { exportMyDataDetailed, requestAccountDeletion, withdrawAccountDeletion } from '../../src/lib/gdpr';
import { shareTextFile } from '../../src/lib/exportShare';
import { supabase } from '../../src/lib/supabase';
import { USE_SUPABASE } from '../../src/lib/config';
import { reportError } from '../../src/lib/reportError';

/** A label and its value. `value` is already a string — see `fig`. */
function Line({ t, label, value, first }: { t: Theme; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp.md, paddingVertical: sp.md, borderTopWidth: first ? 0 : hairline, borderTopColor: t.ring }}>
      <Text style={{ ...ty.label, color: t.ink3 }}>{label}</Text>
      <Text style={{ ...ty.body, color: t.ink, flex: 1, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Gym owner', trainer: 'Trainer', client: 'Member' };

/** A timestamp as the day it happened, or a dash. Never the string "null". */
function day(iso: string | null): string {
  if (!iso) return '—';
  const d = String(iso).slice(0, 10);
  return d.length === 10 ? d : '—';
}

/** Everything the owner's confirmation needs, or nulls where a read failed. */
interface OwnerFacts {
  /** People other than this owner waiting to be erased at this gym. */
  waiting: number | null;
  /** Owners of this gym other than this one. */
  coOwners: number | null;
  /** When this owner asked to be deleted, if they already have. */
  requestedAt: string | null;
  /** True once the profile read itself succeeded. */
  selfRead: boolean;
}

export default function OwnerSettings() {
  const t = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();

  // null = nothing read yet. A loaded object may still carry nulls, one per
  // read that failed — "not known" survives all the way into the dialog copy.
  const [facts, setFacts] = useState<OwnerFacts | null>(null);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setFacts({ waiting: null, coOwners: null, requestedAt: null, selfRead: false }); return; }
    let uid: string | null = null;
    try {
      const { data: a } = await supabase.auth.getUser();
      uid = a?.user?.id ?? null;
    } catch (e) { reportError('ownerSettings.auth', e); }
    if (!uid) { setFacts({ waiting: null, coOwners: null, requestedAt: null, selfRead: false }); return; }
    const me = uid;

    // The three reads fail independently. A gym that cannot read its own
    // owner roster still has to be told how many people are waiting on it.
    const [q, o, p] = await Promise.allSettled([
      // `pending_deletions` is security_invoker and scoped to the caller's own
      // gym by RLS — no tenant filter here, on purpose. See deletions.tsx.
      supabase.from('pending_deletions').select('subject_id'),
      // `profiles_owner_r` scopes this to the caller's tenant.
      supabase.from('profiles').select('id').eq('role', 'owner'),
      supabase.from('profiles').select('deletion_requested_at').eq('id', me).maybeSingle(),
    ]);

    let waiting: number | null = null;
    if (q.status === 'fulfilled' && !q.value.error) {
      waiting = (q.value.data ?? []).filter((r: any) => String(r.subject_id) !== me).length;
    } else {
      reportError('ownerSettings.queue', q.status === 'rejected' ? q.reason : q.value.error);
    }

    let coOwners: number | null = null;
    if (o.status === 'fulfilled' && !o.value.error) {
      coOwners = (o.value.data ?? []).filter((r: any) => String(r.id) !== me).length;
    } else {
      reportError('ownerSettings.owners', o.status === 'rejected' ? o.reason : o.value.error);
    }

    let requestedAt: string | null = null;
    let selfRead = false;
    if (p.status === 'fulfilled' && !p.value.error) {
      requestedAt = p.value.data?.deletion_requested_at ?? null;
      selfRead = true;
    } else {
      reportError('ownerSettings.self', p.status === 'rejected' ? p.reason : p.value.error);
    }

    setFacts({ waiting, coOwners, requestedAt, selfRead });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportMyDataDetailed();
      const json = res.json;
      await shareTextFile(json, 'repple-studio-my-data.json', 'application/json', 'Export my data');
      if (!res.complete) {
        // A partial export handed over silently is the same failure one level
        // up: somebody deletes their account believing they have a copy.
        Alert.alert(
          'That copy is incomplete',
          `${res.failed.length} part${res.failed.length === 1 ? '' : 's'} of your record could not be read `
          + `(${res.failed.map((f) => f.table).join(', ')}). The file has been saved and says so inside, `
          + 'but do not treat it as a full copy, and do not delete your account on the strength of it. '
          + 'Try again in a moment, or email support@repplefitness.com.',
        );
      }
    } catch (e) {
      reportError('ownerSettings.export', e);
      Alert.alert('Export failed', 'Nothing was exported. Check your connection and try again.');
    } finally { setExporting(false); }
  };

  const signOut = () => {
    Alert.alert('Sign out?', 'You will need your email and password to sign back in. Nothing is deleted.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('ownerSettings.signOut', e); } } },
    ]);
  };

  const gym = tenant?.name ?? null;

  /** What the queue actually says, or that it could not be read. */
  const queueLine = (): string => {
    if (!facts) return 'Your gym\'s deletion queue has not been read yet, so this cannot tell you who is waiting on you.';
    if (facts.waiting == null) return 'Your gym\'s deletion queue could not be read, so this cannot tell you who is waiting on you. That is a read failure, not an all-clear.';
    if (facts.waiting === 0) return 'Nobody else at your gym is waiting to be erased right now.';
    return `${facts.waiting} ${facts.waiting === 1 ? 'person is' : 'people are'} waiting to be erased at your gym, and only a gym owner can action those requests.`;
  };

  /** Whether anyone would be left to action them. */
  const ownersLine = (): string => {
    if (!facts || facts.coOwners == null) return 'Whether another owner would remain to action them could not be checked.';
    if (facts.coOwners === 0) return 'You are the only owner. Once your account is gone, nobody can action them and the 30-day clock keeps running.';
    return `${facts.coOwners} other ${facts.coOwners === 1 ? 'owner' : 'owners'} would remain and could action them.`;
  };

  const run = async () => {
    setDeleting(true);
    try {
      const ok = await requestAccountDeletion();
      if (!ok) {
        // `requestAccountDeletion` returns false only when the write was
        // refused. Saying "noted" here would be inventing a promise.
        Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again.');
        return;
      }
      await load();
      Alert.alert(
        'Deletion requested',
        'Your request is recorded and now appears in Deletion requests alongside everyone else waiting. Only a gym owner can action it — which, while you are still signed in, means you.\n\nStaying signed in lets you carry it out yourself. Signing out leaves it for another owner.',
        [
          { text: 'Stay signed in', style: 'cancel' },
          { text: 'Open Deletion requests', onPress: () => router.push('/(owner)/deletions') },
          { text: 'Sign out', style: 'destructive', onPress: () => { try { auth.signOut(); router.replace('/welcome'); } catch (e) { reportError('ownerSettings.signOut', e); } } },
        ],
      );
    } catch (e) {
      reportError('ownerSettings.delete', e);
      Alert.alert('Not requested', 'Your deletion request was not recorded — nothing has changed. Check your connection and try again.');
    } finally { setDeleting(false); }
  };

  /**
   * Two confirmations. The first carries the consequences that are specific to
   * being an owner — the queue only an owner can clear, and whether anyone is
   * left to clear it. The second exists because "delete my account" and "close
   * my gym" sound like the same sentence and are not, and because the
   * destructive tap should never be the one already under your thumb.
   */
  const deleteAccount = () => {
    Alert.alert(
      'Delete your owner account?',
      'This asks for your own account and everything of yours to be permanently erased.\n\n' +
      `It does not close ${gym ?? 'your gym'}. The gym, its members, its trainers, its classes and its records all stay — they just stay without you.\n\n` +
      `${queueLine()}\n\n${ownersLine()}`,
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () => {
            Alert.alert(
              'This does not close your gym',
              `${gym ?? 'Your gym'} and everything recorded against it stays after your account is gone. If you meant to close the gym, or to hand it to someone else, do that first — deleting your account will not do it, and afterwards there may be no owner left who can.\n\n` +
              'Request permanent erasure of your own account now?',
              [
                { text: 'Keep my account', style: 'cancel' },
                { text: 'Request deletion', style: 'destructive', onPress: () => { void run(); } },
              ],
            );
          },
        },
      ],
    );
  };

  const withdraw = () => {
    Alert.alert(
      'Withdraw your deletion request?',
      'Your owner account and everything in it will be kept. You can ask to be deleted again at any time.',
      [
        { text: 'Leave it pending', style: 'cancel' },
        { text: 'Withdraw request', onPress: async () => {
          if (withdrawing) return;
          setWithdrawing(true);
          try {
            const ok = await withdrawAccountDeletion();
            if (!ok) {
              reportError('ownerSettings.withdraw', new Error('withdraw_account_deletion did not clear the request'));
              Alert.alert('Not withdrawn', 'Your deletion request is still in place — nothing has changed. Check your connection and try again, or email support@repplefitness.com from the address on your account.');
              return;
            }
            await load();
            Alert.alert('Request withdrawn', 'Your account will be kept and nothing has been deleted.');
          } finally { setWithdrawing(false); }
        } },
      ],
    );
  };

  const requestLine = !facts
    ? 'Checking whether you already have a deletion request open…'
    : !facts.selfRead
      ? 'Whether you already have a deletion request open could not be checked. That is a read failure, not an all-clear.'
      : facts.requestedAt
        ? `You asked to be deleted on ${day(facts.requestedAt)}. It sits in Deletion requests until an owner actions it. Only you can take it back — nobody can withdraw it on your behalf.`
        : 'You have no deletion request open.';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>Account</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Settings</Text>
          </View>
        </View>
        <Text style={{ ...ty.label, color: t.ink3, marginTop: sp.sm }}>Who you are signed in as, your data & this build</Text>

        <Rule />

        <Section>
          <SectionHead title="Signed in as" />
          <Line t={t} first label="Name" value={auth.loading ? 'Checking…' : fig(auth.user?.name)} />
          <Line t={t} label="Email" value={auth.loading ? 'Checking…' : fig(auth.user?.email)} />
          <Line t={t} label="Role" value={auth.loading ? 'Checking…' : fig(auth.user ? ROLE_LABEL[auth.user.role] ?? auth.user.role : null)} />
          <Line t={t} label="Gym" value={tenantLoading ? 'Checking…' : fig(gym)} />
          <View style={{ flexDirection: 'row', marginTop: sp.md }}>
            <Ghost label="Sign out" onPress={signOut} />
          </View>
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Your data" />
          <ListRow icon="share" title={exporting ? 'Preparing export…' : 'Export my data'}
            note="Everything Repple stores about you, as a JSON file you can keep"
            onPress={exportData} />
          {facts?.requestedAt ? (
            <ListRow icon="back" title={withdrawing ? 'Withdrawing…' : 'Withdraw my deletion request'}
              note="Keep your account. You can withdraw right up until the deletion is carried out."
              onPress={withdraw} />
          ) : (
            <ListRow icon="minus" tone={t.crit} title={deleting ? 'Requesting…' : 'Delete my account'}
              note="Ask for your account and your data to be erased permanently"
              onPress={deleteAccount} />
          )}
          <Text style={{ ...ty.caption, color: facts && !facts.selfRead ? t.crit : t.ink3, marginTop: sp.md }}>{requestLine}</Text>
        </Section>

        <Rule />

        {/* The owner-only consequence, on the screen and not only in the dialog:
            this queue is actionable by an owner and by nobody else. */}
        <Section>
          <SectionHead title="Before you delete yourself" />
          <Text style={{ ...ty.label, color: facts && facts.waiting == null ? t.crit : t.ink2 }}>{queueLine()}</Text>
          <Text style={{ ...ty.label, color: t.ink2, marginTop: sp.sm }}>{ownersLine()}</Text>
          <ListRow icon="clock" title="Deletion requests" note="The queue, and the 30-day clock running on it"
            onPress={() => router.push('/(owner)/deletions')} />
        </Section>

        <Rule />

        {/* Build — the diagnostic for whether an OTA actually landed on this phone. */}
        <Section>
          <SectionHead title="Build" />
          <BuildInfo />
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Which bundle this phone is running. If a fix was published but isn't here, compare Channel and Update against the EAS dashboard before assuming it's a code bug.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
