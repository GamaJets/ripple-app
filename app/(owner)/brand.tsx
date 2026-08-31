// Owner · White-label Studio. The gym's name and its accent colour.
//
// ── What changed, and why it had to ────────────────────────────────────────
//
// This screen used to write nothing to the gym. The name went into AsyncStorage
// via src/ui/brand.tsx and the colour was the theme accent, also AsyncStorage —
// both of them per-device. So two owners of the same gym, on two phones, each
// had a private branding of it and neither could see the other's; a reinstall
// lost it; and `tenants.name` and `tenants.brand_color`, the two columns that
// exist to hold exactly this, sat holding the provisioning placeholder ("Tim's
// space") and a colour nobody had picked.
//
// Both now go to `tenants`, through `updateTenant()` — one row, one answer, and
// every device any owner signs in on reads it back. The theme accent still
// follows locally so the change is visible immediately; it is a REFLECTION of
// the gym's record now, not the record.
//
// ── Two things this deliberately does not do ───────────────────────────────
//
// The name field does not save as you type. `tenants.name` is what the gym is
// called; a keystroke is not a decision, and a write per character would put a
// row of half-names through the database and leave whichever one the network
// lost as the gym's name.
//
// "Reset to Default Branding" is gone. It set the name to 'Repple' — not even
// this build's own label, and renaming somebody's gym to the vendor's name is
// not a reset, it is a rename — and it set the palette to teal, which part 118
// establishes is a colour nobody chose rather than a colour to return to. What
// replaces it CLEARS the gym's colour, which is a state the column can actually
// hold and the honest opposite of having picked one.
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { DEFAULT_PALETTE } from '../../src/theme/tokens';
import { useBrand } from '../../src/ui/brand';
import { useTenant } from '../../src/ui/tenant';
import { brandColorOf, parseGymName } from '../../src/lib/gymSettings';
import { Icon } from '../../src/ui/Icon';

export default function OwnerBrand() {
  const t = useTheme();
  const { palette, setPalette, palettes, setAccent } = useThemeControls();
  const { appName, adoptGymName } = useBrand();
  const { tenant, status, updateTenant } = useTenant();

  // Under 'error' a null tenant means we could not find out, not that this
  // account has no gym — so nothing below may be offered as the gym's answer
  // and nothing may be saved over it.
  const known = status === 'ready' && !!tenant;
  const gymColor = brandColorOf(tenant?.brandColor);

  // Null means the owner has not touched the field, so it mirrors the gym as
  // that read lands. Seeding useState from `tenant` would seed from null — the
  // provider is still in flight when this mounts — and never catch up.
  const [draft, setDraft] = useState<string | null>(null);
  const nameField = draft ?? (tenant?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);

  // The gym's colour, applied. `gymColor` is null for a gym that has not chosen
  // one — part 118 cleared the schema default precisely so that this cannot
  // repaint every Studio app teal on the authority of a value nobody picked —
  // and in that case the app keeps its own accent and the section says so.
  //
  // Keyed on the GYM's colour changing, not on the accent differing from it.
  // The second version of this fought the user: tapping a swatch sets the
  // accent immediately, the tenant row does not catch up until the write
  // returns, and an effect comparing the two snapped the colour back to the old
  // one between the tap and the response.
  const applied = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!known || applied.current === gymColor) return;
    applied.current = gymColor;
    if (gymColor) setAccent(gymColor);
  }, [known, gymColor, setAccent]);

  // The signed-out screens (welcome, sign-in, forgot-password) cannot read the
  // tenant, so they read a cached copy. This is what puts the gym's real name
  // in that cache; it ignores null, so a failed read never overwrites it.
  useEffect(() => { if (known) adoptGymName(tenant?.name); }, [known, tenant?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = async () => {
    const parsed = parseGymName(nameField);
    if (parsed.kind === 'bad') { setMsg({ bad: true, text: parsed.reason }); return; }
    setBusy(true); setMsg(null);
    // updateTenant checks the row COUNT: a refused UPDATE under RLS raises
    // nothing at all and touches nothing, so an error check alone would report
    // a save that did not happen.
    const saved = await updateTenant({ name: parsed.name });
    setBusy(false);
    if (!saved) { setMsg({ bad: true, text: 'Not saved. Your gym is still called what it was called.' }); return; }
    setDraft(null);
    adoptGymName(parsed.name);
    setMsg({ bad: false, text: `Saved. Every owner of this gym sees it as ${parsed.name}.` });
  };

  const pickColor = async (key: string, color: string) => {
    // Locally first, so the tap is answered at once — then told the truth about
    // it if the write does not land.
    setPalette(key);
    setAccent(color);
    if (!known) return;
    const saved = await updateTenant({ brandColor: color });
    if (!saved) {
      Alert.alert('Colour not saved',
        'The colour changed on this device only — your gym still has the colour it had, and other owners will not see this one.');
    }
  };

  // Clearing is not the same as choosing the default palette, and the button
  // used to do the second while being labelled the first. NULL is "this gym has
  // not chosen a colour" — the state part 118 restored every existing gym to —
  // and it leaves the app drawn in its own accent rather than in a teal
  // somebody would later find in their gym's record and assume was picked.
  const clearColor = async () => {
    setPalette(DEFAULT_PALETTE);
    setAccent(null);
    if (!known) return;
    const saved = await updateTenant({ brandColor: null });
    if (!saved) {
      Alert.alert('Colour not cleared',
        'This device is back to the app’s own colour, but your gym still holds the one it had.');
    }
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Owner</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>White-label Studio</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your gym's name and colour — saved to the gym, not to this phone</Text>
        </View>

        {/* ── the gym's name ─────────────────────────────────────────────── */}
        <Section>
          <SectionHead title="Gym Name" />
          {status === 'loading' ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>Reading your gym…</Text>
          ) : status === 'error' ? (
            // An empty field under a failed read is not an unnamed gym, and
            // saving over it would write a name derived from a failure.
            <Flag tone={t.warn}>
              Your gym could not be read, so its name is not known — this is not a gym without one.
              Nothing here can be changed until it can be read.
            </Flag>
          ) : !tenant ? (
            <Text style={{ ...ty.label, color: t.ink3 }}>This account is not attached to a gym, so there is no name to set.</Text>
          ) : (<>
            <TextInput value={nameField} onChangeText={(v) => { setDraft(v); if (msg) setMsg(null); }}
              placeholder="What the gym is called" placeholderTextColor={t.ink3}
              accessibilityLabel="Gym name" style={inp} />
            {msg && msg.bad ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{msg.text}</Flag>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {msg ? msg.text : 'Saved to the gym, so every owner and every device you sign in on sees the same name.'}
              </Text>
            )}
            <View style={{ marginTop: sp.lg }}>
              <Cta wide label={busy ? 'Saving…' : 'Save Gym Name'} disabled={busy} onPress={() => { void saveName(); }} />
            </View>
          </>)}
        </Section>

        <Rule />

        {/* ── the colours are the content, not decoration ────────────────── */}
        <Section>
          <SectionHead title="Primary Palette" note={palettes.find((p) => p.key === palette)?.name} />
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            {status === 'error'
              ? 'Your gym could not be read, so a colour picked here would change this device and nothing else.'
              : known && !gymColor
                ? 'Your gym has not chosen a colour yet, so the app is drawn in its own. Tap one and it becomes the gym’s.'
                : 'Tap a colour — the whole app rethemes instantly, and the gym keeps it.'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
            {palettes.map((p) => {
              const on = p.key === palette;
              return (
                <Pressable key={p.key} onPress={() => { void pickColor(p.key, p.theme.brand); }} accessibilityRole="button" accessibilityLabel={p.name}
                  style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.theme.bg, borderWidth: on ? 2 : hairline, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: p.theme.brand }} />
                  {on ? <View style={{ position: 'absolute', bottom: 3, right: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Rule />

        {/* ── live preview: chrome and the primary action, no invented data ─ */}
        <Section>
          <SectionHead title="Live Preview" />
          <View style={{ backgroundColor: t.surface, borderRadius: radius.md, overflow: 'hidden', ...elevation.e1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg, backgroundColor: t.surface2 }}>
              <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: t.brand }} />
              {/* The gym's name where it is known, and this app's own label
                  otherwise — never a placeholder standing in for a real one. */}
              <Text style={{ ...ty.head, color: t.ink }}>{known && tenant?.name ? tenant.name : appName}</Text>
            </View>
            <View style={{ padding: sp.lg }}>
              <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>Body copy, headings and the primary action, in your colours.</Text>
              <View style={{ backgroundColor: t.brand, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
                <Text style={{ ...ty.label, fontWeight: '600', color: t.brandInk }}>Start today's workout</Text>
              </View>
            </View>
          </View>
        </Section>

        <Rule />

        <Section>
          <View style={{ alignSelf: 'flex-start' }}>
            <Ghost label="Clear the Gym's Colour" onPress={() => { void clearColor(); }} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Puts the gym back to having chosen no colour, and the app back to its own. Not the same as picking teal.
          </Text>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            On Studio plans each trainer gets this panel for their own client app — their logo, colours, and domain. You keep the platform fee.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
