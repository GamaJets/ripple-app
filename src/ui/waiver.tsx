// The release of liability a client agrees to before they can use the app.
//
// Gated here rather than on the sign-up form because there are three ways into
// an account — email and password, a texted code, and Apple/Google — and a
// checkbox bolted to one of them is a waiver two thirds of new clients never
// see. This asks whoever is signed in, however they got here, and it asks
// existing accounts too. The answer is recorded server-side in
// `liability_waivers`; the screen is driven by that record, not by anything
// this device remembers, so clearing the app does not clear the agreement and
// a fresh install does not ask twice.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './components';
import { Icon } from './Icon';
import { Cta } from './kit';
import { sp, layout, radius, type as ty } from '../theme/scale';
import { supabase } from '../lib/supabase';
import { USE_SUPABASE } from '../lib/config';
import { useAuthRevision } from './authRevision';
import {
  WAIVER_CLAUSES, WAIVER_VERSION, bothGiven, waiverState,
  type WaiverRead, type WaiverState,
} from '../lib/waiver';

export function useWaiver() {
  const authRev = useAuthRevision();
  const [read, setRead] = useState<WaiverRead | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  // Whether this gate has anybody to ask. Nobody signed in means the auth guard
  // elsewhere has the floor, not this screen.
  const [applies, setApplies] = useState(false);

  const load = useCallback(async () => {
    if (!USE_SUPABASE) { setApplies(false); return; }
    setRead(null);
    try {
      // getUser() rejects when nobody is signed in — a true answer, not a
      // failed read, and the reason this asks for the session first.
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) { setApplies(false); setUid(null); return; }
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      const id = auth?.user?.id ?? null;
      if (authErr || !id) { setApplies(false); setUid(null); return; }
      setUid(id);
      setApplies(true);
      const { data, error } = await supabase
        .from('liability_waivers').select('version').eq('user_id', id);
      // An unreadable record is not an unsigned one. `ok: false` keeps it
      // distinguishable all the way to the screen.
      if (error) { setRead({ ok: false, versions: [] }); return; }
      setRead({ ok: true, versions: (data ?? []).map((r: any) => String(r.version)) });
    } catch {
      setRead({ ok: false, versions: [] });
    }
  }, []);

  useEffect(() => { load(); }, [authRev, load]);

  const accept = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!uid) return { ok: false, error: 'You are not signed in.' };
    try {
      const { error } = await supabase.from('liability_waivers').insert({
        user_id: uid, version: WAIVER_VERSION, released_liability: true, physician_ack: true,
      });
      // Already on file (they agreed on another device, or tapped twice) is the
      // outcome we wanted, not a failure.
      if (error && (error as any).code !== '23505') return { ok: false, error: error.message };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Could not reach the server.' };
    }
    // Only after the server has it. An agreement that exists on this phone
    // alone is not a record of anything.
    setRead((p) => ({ ok: true, versions: [...(p?.versions ?? []), WAIVER_VERSION] }));
    return { ok: true };
  }, [uid]);

  const state: WaiverState = waiverState(read);
  return { state, applies, accept, reload: load };
}

function Tick({ on, label, detail, onPress }: {
  on: boolean; label: string; detail: string; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', gap: sp.md, paddingVertical: sp.md }}>
      <View style={{
        width: 24, height: 24, borderRadius: radius.sm, marginTop: 2,
        borderWidth: on ? 0 : 1.5, borderColor: t.ring,
        backgroundColor: on ? t.brand : 'transparent',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {on ? <Icon name="check" size={16} color={t.brandInk} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...ty.body, color: t.ink, fontWeight: '500' }}>{label}</Text>
        <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function WaiverScreen({ state, accept, reload }: {
  state: WaiverState;
  accept: () => Promise<{ ok: boolean; error?: string }>;
  reload: () => void;
}) {
  const t = useTheme();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = bothGiven(ticked);

  const submit = async () => {
    setBusy(true); setErr(null);
    const r = await accept();
    setBusy(false);
    // The screen stays put on failure. Letting somebody through on a release
    // that was never recorded is the one outcome this whole gate exists to
    // prevent.
    if (!r.ok) setErr(r.error || 'That did not save. Check your connection and try again.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingBottom: 40 }}>
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.lg }}>Before you start</Text>
        <Text style={{ ...ty.title, color: t.ink, marginTop: sp.xs }}>
          Read this and agree to carry on
        </Text>
        <Text style={{ ...ty.body, color: t.ink2, marginTop: sp.md }}>
          Repple gives you training and nutrition suggestions. It is not medical advice, and
          nobody here — your coach included — is your doctor. Please read both points and tick
          them only if you agree.
        </Text>

        {state === 'unknown' ? (
          <View style={{ marginTop: sp.lg, padding: sp.md, borderRadius: radius.sm, backgroundColor: t.surface2 }}>
            <Text style={{ ...ty.label, color: t.ink, fontWeight: '600' }}>We couldn’t check your record</Text>
            <Text style={{ ...ty.caption, color: t.ink2, marginTop: sp.xs }}>
              You may have agreed to this already — we just couldn’t read it. Try again, or agree
              below and we’ll record it.
            </Text>
            <View style={{ marginTop: sp.md, alignSelf: 'flex-start' }}>
              <Cta label="Try Again" onPress={reload} />
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: sp.lg }}>
          {WAIVER_CLAUSES.map((c) => (
            <Tick key={c.key} on={ticked[c.key] === true} label={c.label} detail={c.detail}
              onPress={() => setTicked((p) => ({ ...p, [c.key]: !p[c.key] }))} />
          ))}
        </View>

        {err ? (
          <Text style={{ ...ty.caption, color: t.warn, marginTop: sp.md }}>{err}</Text>
        ) : null}

        <View style={{ marginTop: sp.lg }}>
          <Cta wide disabled={!ready || busy}
            label={busy ? 'Saving…' : ready ? 'I Agree — Continue' : 'Tick Both to Continue'}
            onPress={submit} />
        </View>
        <Text style={{ ...ty.micro, color: t.ink3, marginTop: sp.md }}>
          Your agreement is recorded against your account with the date. Version {WAIVER_VERSION}.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Wraps the client portal. Children always render — the release goes over the
 *  top as a modal — so the navigator underneath still mounts and the route the
 *  reader was heading for is waiting when they agree. */
export function WaiverGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const { state, applies, accept, reload } = useWaiver();
  // 'loading' does not block and does not pass: the app is already behind a
  // splash at this point, and the read is one query.
  const blocked = applies && (state === 'needed' || state === 'unknown');
  const waiting = applies && state === 'loading';
  return (
    <>
      {children}
      <Modal visible={blocked || waiting} animationType="fade" onRequestClose={() => {}}>
        {waiting ? (
          <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.brand} />
          </View>
        ) : (
          <WaiverScreen state={state} accept={accept} reload={reload} />
        )}
      </Modal>
    </>
  );
}
