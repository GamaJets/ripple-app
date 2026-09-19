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
import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { DEFAULT_PALETTE } from '../../src/theme/tokens';
import { useBrand } from '../../src/ui/brand';
import { useTenant } from '../../src/ui/tenant';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { brandColorOf, parseGymName } from '../../src/lib/gymSettings';
import { Icon } from '../../src/ui/Icon';

export default function OwnerBrand() {
  const t = useTheme();
  const { palette, setPalette, palettes, setAccent } = useThemeControls();
  const { appName, adoptGymName } = useBrand();
  const { tenant, status, updateTenant, refresh } = useTenant();

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
  /** A colour write is in flight. Separate from `busy` above, which is the name
   *  field's — the two controls write different columns and neither should
   *  disable the other. See `pickColor` for what two concurrent writes to
   *  `tenants.brand_color` actually do. */
  const [colorBusy, setColorBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  // The gym row is what this screen shows and writes back to: its name and its
  // brand colour. An owner who changed either in another session, or whose
  // first read failed, had no way to ask for it again. The name field is not
  // disturbed — `draft` is what the owner typed and `nameField` prefers it.
  const pull = usePullToRefresh(useCallback(() => { refresh(); }, [refresh]));

  /* When the gym row was last read.
   *
   * This screen and app/(owner)/exercise.tsx were the only two of the owner
   * app's eighteen reading screens with a pull-to-refresh and no stamp — a
   * gesture that may or may not have re-read, with nothing on screen to say
   * which. Brand is where an owner sets the gym's name and colour and then
   * checks it took, so "did that pull do anything" is the exact question.
   *
   * `useTenant` carries no stamp of its own, so the screen keeps one — the same
   * shape app/(owner)/library.tsx uses. 'error' deliberately does NOT move it:
   * the name on screen is still the earlier read's. */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  useEffect(() => { if (status === 'ready') setFetchedAt(Date.now()); }, [status]);

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
    // Two taps must not become two UPDATEs. Both writes below set the SAME
    // column of the SAME row, so a second tap while the first is in flight is
    // a race: whichever response the network happens to deliver last wins the
    // row, and the accent set optimistically here is the LAST TAP. Lose the
    // race and the device is drawn in the colour you chose while the gym holds
    // the one you chose before it — both writes having reported success, so
    // nothing says a word about it. The colour is per-gym and every owner's
    // device reads it back, which is the whole point of the screen.
    //
    // `colorBusy` rather than `busy`: the name field's guard is its own, and
    // sharing one would grey the palette out while a rename is saving.
    if (colorBusy) return;
    // Locally first, so the tap is answered at once — then told the truth about
    // it if the write does not land.
    setPalette(key);
    setAccent(color);
    // `known` is `status === 'ready' && !!tenant`, so this is the loading read,
    // the failed read AND the account with no gym. It used to return in
    // silence, under a line promising "the gym keeps it" — the app rethemed,
    // nothing was written, and the owner had no way to tell the difference
    // from a save. The note under the swatches now states each of those four
    // states for itself; this says so again at the moment of the tap, because
    // the note is above the fold and the tap is what the owner remembers.
    if (!known) {
      Alert.alert('Changed on this phone only',
        status === 'error'
          ? 'Your gym could not be read, so the colour was not saved to it. This phone is drawn in the new colour; the gym still holds whatever it held.'
          : status === 'loading'
            ? 'Your gym is still being read, so the colour was not saved to it. Pull down to re-read, then pick again.'
            : 'This account is not attached to a gym, so there is no gym record to save a colour to. This phone is drawn in the new colour and nothing else is.');
      return;
    }
    setColorBusy(true);
    try {
      const saved = await updateTenant({ brandColor: color });
      if (!saved) {
        Alert.alert('Colour not saved',
          'The colour changed on this device only — your gym still has the colour it had, and other owners will not see this one.');
      }
    } finally { setColorBusy(false); }
  };

  // Clearing is not the same as choosing the default palette, and the button
  // used to do the second while being labelled the first. NULL is "this gym has
  // not chosen a colour" — the state part 118 restored every existing gym to —
  // and it leaves the app drawn in its own accent rather than in a teal
  // somebody would later find in their gym's record and assume was picked.
  const clearColor = async () => {
    // Same row, same column, same race — and this one is the worse half of it,
    // because "clear" losing to a swatch tap leaves the gym holding a colour
    // the owner has just asked it to stop holding. One guard covers both.
    if (colorBusy) return;
    setPalette(DEFAULT_PALETTE);
    setAccent(null);
    if (!known) {
      Alert.alert('Changed on this phone only',
        status === 'error'
          ? 'Your gym could not be read, so its colour was not cleared. This phone is back to the app’s own colour; the gym still holds whatever it held.'
          : status === 'loading'
            ? 'Your gym is still being read, so its colour was not cleared. Pull down to re-read, then try again.'
            : 'This account is not attached to a gym, so there is no gym colour to clear. This phone is back to the app’s own colour.');
      return;
    }
    setColorBusy(true);
    try {
      const saved = await updateTenant({ brandColor: null });
      if (!saved) {
        Alert.alert('Colour not cleared',
          'This device is back to the app’s own colour, but your gym still holds the one it had.');
      }
    } finally { setColorBusy(false); }
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Owner</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>White-label Studio</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>Your gym's name and colour — saved to the gym, not to this phone</Text>
        </View>

        <Fetched at={fetchedAt} onRefresh={() => { refresh(); }} busy={status === 'loading'} />

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


        {/* ── the colours are the content, not decoration ────────────────── */}
        <Section>
          <SectionHead title="Primary Palette" note={palettes.find((p) => p.key === palette)?.name} />
          {/* Four states, four sentences — the Gym Name section above has
              handled all four since it was written, and this one had two.
              `status === 'error'` was stated; everything else fell through to
              "the gym keeps it", which is true of exactly one of the remaining
              three. A still-loading read and an account attached to no gym
              both take the `!known` early return in `pickColor`: the app
              rethemes, NOTHING is written, and this line had just promised the
              gym would keep it. A sentence that claims a save the code does
              not attempt is worse than no sentence. */}
          <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
            {status === 'error'
              ? 'Your gym could not be read, so a colour picked here would change this device and nothing else.'
              : status === 'loading'
                ? 'Your gym is still being read. A colour picked before it lands changes this device only.'
                : !tenant
                  ? 'This account is not attached to a gym, so there is no gym record to hold a colour. A colour picked here changes this device only.'
                  : !gymColor
                    ? 'Your gym has not chosen a colour yet, so the app is drawn in its own. Tap one and it becomes the gym’s.'
                    : 'Tap a colour — the whole app rethemes instantly, and the gym keeps it.'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
            {palettes.map((p) => {
              const on = p.key === palette;
              return (
                <Pressable key={p.key} onPress={() => { void pickColor(p.key, p.theme.brand); }} accessibilityRole="button" accessibilityLabel={p.name}
                  // The guard in `pickColor` makes a second tap a no-op; without
                  // this it is a SILENT no-op, and a swatch that answers nothing
                  // reads as a broken control rather than as a busy one.
                  disabled={colorBusy}
                  accessibilityState={{ selected: on, disabled: colorBusy, busy: colorBusy }}
                  style={{ opacity: colorBusy && !on ? 0.5 : 1, width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.theme.bg, borderWidth: on ? 2 : hairline, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: p.theme.brand }} />
                  {on ? <View style={{ position: 'absolute', bottom: 3, end: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
                </Pressable>
              );
            })}
          </View>
        </Section>


        {/* ── live preview: chrome and the primary action, no invented data ─ */}
        <Section>
          <SectionHead title="Live Preview" />
          <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: hairline, borderColor: t.ring, overflow: 'hidden', ...elevation.e1 }}>
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


        <Section>
          <View style={{ alignSelf: 'flex-start' }}>
            {/* Off while a swatch write is in flight — this button and those
                swatches write the same column of the same row. */}
            <Ghost label="Clear the Gym's Colour" disabled={colorBusy} onPress={() => { void clearColor(); }} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Puts the gym back to having chosen no colour, and the app back to its own. Not the same as picking teal.
          </Text>
          {/* ── A paragraph selling four things that do not exist ───────────
              It read: "On Studio plans each trainer gets this panel for their
              own client app — their logo, colours, and domain. You keep the
              platform fee."

              None of it is true of this product. There are no per-trainer
              plans — `tenants.plan` is one value for the whole gym and every
              gym in the live database is on 'starter'; a trainer does not get a
              branding panel of their own anywhere in the three apps; there is
              no logo upload on this screen (the `tenants.logo` column has no
              writer); there is no domain column at all; and there is no
              platform fee any owner keeps a share of. It is a survivor of the
              subscription console this app used to be, and the header of
              src/ui/trainers.tsx already rules that what a trainer pays Repple
              is not a gym owner's business.

              Left standing it is worse than a missing feature: it is a
              commercial promise in the owner's own settings, phrased as a
              statement of fact, that support would have to walk back. What this
              screen actually does is the two controls above it. */}
          {/* The name and the colour do NOT travel the same distance, and this
              sentence used to say they did — "in the apps your members and
              coaches use", of both of them.

              The name does travel: `my_gym_name()` (supabase/parts/962) is
              called by <BrandProvider> in src/ui/brand.tsx, which is mounted in
              every variant, so a member and a coach both see their app called
              by this gym's name.

              The colour does not. `setAccent` has exactly two callers in the
              whole repo and both are on THIS screen (lines 98 and 125). No
              client screen and no trainer screen calls it, and nothing outside
              app/(owner) reads `tenants.brand_color` at all — a coach's app
              draws `trainers.brand_color`, which is the coach's own, and a
              member's app draws the build's accent. The web console reads it
              (studio-web/app/Console.tsx writes it into `--brand`), so the true
              list is this app and that console.

              Saying otherwise is not a small overstatement: it is the entire
              reason an owner picks a colour. One who reads this, picks their
              green, and then opens the member app expecting to see it has been
              told a false thing by the screen that sold them the feature. */}
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
            The name and the colour are the whole of the branding today, and they do not reach the same places. The name is the gym’s everywhere — every owner’s device, and what your members and coaches see their app called. The colour is drawn by this app and by the web console only; a member’s app and a coach’s app keep their own accent.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
