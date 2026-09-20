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
import { Rule, Section, ScreenHeader, Ghost, Cta, Flag, IconPlate, TonedChip, Expandable, type Tone } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty, value, font } from '../../src/theme/scale';
import { DEFAULT_PALETTE } from '../../src/theme/tokens';
import { useBrand } from '../../src/ui/brand';
import { useTenant } from '../../src/ui/tenant';
import { Fetched } from '../../src/ui/fetched';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';
import { brandColorOf, parseGymName } from '../../src/lib/gymSettings';
import { Icon } from '../../src/ui/Icon';
// The two measurements the preview states in words. `brandInkFor` (src/theme/
// tokens.ts) already CHOOSES the more readable of black and white for the
// button label; what it cannot do is make a mid-toned colour clear 4.5:1 with
// either, and an owner is the only person who can pick a different one.
import { contrastRatio, meetsText, meetsMark } from '../../src/lib/a11y';
import { num1 } from '../../src/lib/format';

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
      Alert.alert('Changed on This Phone Only',
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
        Alert.alert('Colour Not Saved',
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
      Alert.alert('Changed on This Phone Only',
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
        Alert.alert('Colour Not Cleared',
          'This device is back to the app’s own colour, but your gym still holds the one it had.');
      }
    } finally { setColorBusy(false); }
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;
  const G = layout.gutter;

  /** A step's head: its number on a toned plate, its name in Sora, and whether
   *  it is done as a chip that carries the word — green "Set", amber "Not set
   *  yet" — so the state is never the colour alone. A plain function called in
   *  place, not a component declared in the render body (which would remount
   *  the name field under the caret on every keystroke). */
  const stepHead = (n: number, title: string, tone: Exclude<Tone, 'brand' | 'neutral'>, state?: { label: string; done: boolean }) => (
    <View accessible accessibilityRole="header" accessibilityLabel={`Step ${n}, ${title}${state ? `, ${state.label}` : ''}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.data[`${tone}Soft`], alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...value(18), color: t.data[`${tone}Ink`] }}>{n}</Text>
      </View>
      <Text style={{ ...ty.section, color: t.ink, flex: 1, minWidth: 120 }}>{title}</Text>
      {state ? <TonedChip label={state.label} tone={state.done ? 'brand' : 'amber'} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

        {/* The board's tab-root opening: a quiet eyebrow, the title, and the
            one sentence that says where the settings live — the kit's
            ScreenHeader rather than the same lines by hand. */}
        <ScreenHeader eyebrow="Your Gym" title="Brand" subtitle="Saved to the gym, not to this phone" />

        <Fetched at={fetchedAt} onRefresh={() => { refresh(); }} busy={status === 'loading'} />

        {/* ── one flow, three steps ─────────────────────────────────────────
            Name, colour, then look at what the two of them did. They were three
            unrelated cards and a fourth holding a lone "clear" button; the
            heads now number them, each head says in words whether its step is
            done, and clearing the colour lives with the colour it clears. The
            order is the order of consequence: the name reaches every member's
            app, the colour reaches this app and the console, and the preview
            is where both are checked before an owner walks away. */}
        {/* ── step 1: the gym's name ─────────────────────────────────────── */}
        <Section>
          {stepHead(1, 'Gym Name', 'blue', !known ? undefined : tenant?.name?.trim() ? { label: 'Set', done: true } : { label: 'Not Set Yet', done: false })}
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
              accessibilityLabel="Gym Name" style={inp} />
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
          {/* The note names the palette only when the GYM holds a colour. It
              read the device's palette key unconditionally, so a gym that had
              chosen nothing was headed with the name of whichever swatch this
              phone happened to be drawn in — a choice nobody made, stated as
              the gym's. */}
          {stepHead(2, 'Colour', 'purple', !known ? undefined : gymColor ? { label: palettes.find((p) => p.key === palette)?.name ?? 'Chosen', done: true } : { label: 'Not Chosen Yet', done: false })}
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
          {/* Clearing, beside the swatches it undoes. It was a card of its own
              at the foot of the screen, under the preview, where it read as a
              reset for the whole page. */}
          <View style={{ marginTop: sp.xl }}>
            <Rule />
          </View>
          <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
            {/* Off while a swatch write is in flight — this button and those
                swatches write the same column of the same row. */}
            <Ghost label="Clear the Gym's Colour" disabled={colorBusy} onPress={() => { void clearColor(); }} />
          </View>
          <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
            Puts the gym back to having chosen no colour, and the app back to its own. Not the same as picking teal.
          </Text>
        </Section>


        {/* ── step 3: the preview — controls, labels and status, no invented data ─
            The preview was a header strip and one button, which shows a colour
            and not what the colour DOES. An accent is drawn on four kinds of
            thing in this app — the primary action, a selected control, an icon
            in a row, and the "fine" end of a status scale — and a colour that
            looks right as a swatch can fail on any of them. Each is drawn here
            from the live theme, so it is the app's own rendering rather than a
            mock of it. The words are the names of the controls; nothing here is
            a figure, a member or a session. */}
        <Section>
          {stepHead(3, 'Check the Preview', 'teal')}
          {/* The approved look's own parts, in the live theme: the night hero
              with its bright action first, because that is what every tab now
              opens on and it is where an accent is drawn BRIGHT on near-black
              rather than as itself on white — a second pairing a swatch cannot
              show. A picture of a hero, not a hero: said as an image. */}
          <View accessible accessibilityRole="image" accessibilityLabel="Sample: the night hero card with its bright button in your colour"
            style={{ backgroundColor: t.night, borderRadius: radius.xl, padding: 20, ...elevation.hero }}>
            <Text style={{ ...ty.eyebrow, color: t.nightInk3 }}>YOUR GYM</Text>
            {/* The gym's name where it is known, and this app's own label
                otherwise — never a placeholder standing in for a real one. */}
            <Text style={{ ...ty.display, color: t.nightInk, marginTop: 6 }}>{known && tenant?.name ? tenant.name : appName}</Text>
            <View style={{ marginTop: sp.lg, minHeight: 52, borderRadius: radius.md, backgroundColor: t.brandBright, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ ...ty.button, color: t.brandDeep }}>Hero Action</Text>
            </View>
          </View>
          <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, overflow: 'hidden', marginTop: sp.md, ...elevation.card }}>
            <View style={{ padding: sp.lg }}>

              {/* A selected chip beside an unselected one: the board's "chosen"
                  state is the brand fill, and this is where an accent too close
                  to the card's own grey stops reading as chosen. Said as
                  images — they are pictures of controls, not controls. */}
              <View accessible accessibilityRole="image" accessibilityLabel="Sample: a selected chip in your colour beside an unselected one"
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginBottom: sp.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.brand, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
                  <Icon name="check" size={13} color={t.brandInk} />
                  <Text style={{ ...ty.label, ...font('600'), color: t.brandInk }}>Selected</Text>
                </View>
                <View style={{ backgroundColor: t.surface2, borderRadius: radius.pill, paddingHorizontal: sp.lg, paddingVertical: sp.sm }}>
                  <Text style={{ ...ty.label, ...font('500'), color: t.ink2 }}>Not Selected</Text>
                </View>
              </View>

              {/* A list row as the kit draws one: the accent as an ICON on the
                  row's grey circle, which is the 3:1 "mark" case below. */}
              <View accessible accessibilityRole="image" accessibilityLabel="Sample: a list row with its icon in your colour"
                style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg }}>
                {/* The kit's own plate: your colour as TEXT-weight ink on its
                    pale mix, which is how every row in the app now draws it. */}
                <IconPlate icon="calendar" tone="brand" />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.head, color: t.ink }}>A Row Title</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>The line under it, which never takes your colour</Text>
                </View>
              </View>

              {/* Status. Only the first of the three follows the accent — the
                  warning and critical colours are the theme's own and do not
                  move — and each carries its word, because the colour is never
                  the only channel. An accent near amber or red is the case
                  this row exists to show. */}
              <View accessible accessibilityRole="image" accessibilityLabel="Sample: three status marks. Fine takes your colour; warning and critical keep their own."
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.lg, marginBottom: sp.lg }}>
                {([['Fine', 'brand'], ['Warning', 'amber'], ['Critical', 'red']] as const).map(([l, c]) => (
                  <TonedChip key={l} label={l} tone={c} icon={c === 'brand' ? 'check' : 'info'} />
                ))}
              </View>

              <View accessible accessibilityRole="image" accessibilityLabel="Sample: the primary button in your colour"
                style={{ backgroundColor: t.brand, borderRadius: radius.md, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...ty.button, color: t.brandInk }}>Primary Action</Text>
              </View>
            </View>
          </View>

          {/* ── is it readable: measured, and said in words ─────────────────
              The label on the button is already the better of black and white
              for this colour — `brandInkFor` measures both. About one colour in
              twenty-five is too mid-toned for EITHER to clear 4.5:1, and the
              app cannot fix that by choosing; only a different colour does. So
              the ratio is stated with its verdict, and a failing one says what
              to do. Null is a colour that could not be parsed, which is said as
              that rather than as a pass. */}
          {(() => {
            const onBrand = contrastRatio(t.brandInk, t.brand);
            const asMark = contrastRatio(t.brand, t.surface2);
            const textOk = meetsText(t.brandInk, t.brand, ty.button.fontSize, '700');
            const markOk = meetsMark(t.brand, t.surface2);
            // The hero's pairing, measured like the other two: the accent drawn
            // bright on night, under its own deep ink.
            const onBright = contrastRatio(t.brandDeep, t.brandBright);
            const brightOk = meetsText(t.brandDeep, t.brandBright, ty.button.fontSize, '700');
            return (
              <View style={{ marginTop: sp.lg }}>
                <Text style={{ ...ty.micro, color: t.ink3, marginBottom: sp.sm }}>Readability</Text>
                {/* A mark and words, never the warning colour as ink: a status
                    colour is a 3:1 mark in this theme and is not measured as
                    text — which is the very thing this readout is about. */}
                {([
                  [textOk, onBrand == null
                    ? 'Button text on your colour could not be measured, so nothing here says it is readable.'
                    : `Button text on your colour · ${num1(onBrand)} to 1 · ${textOk ? 'reads clearly' : 'hard to read — the app already uses the better of black and white, so a lighter or darker colour is the fix'}`],
                  [markOk, asMark == null
                    ? 'Your colour as an icon could not be measured.'
                    : `Your colour as an icon on a row · ${num1(asMark)} to 1 · ${markOk ? 'stands out' : 'faint against the row — icons and selected states will be hard to find'}`],
                  [brightOk, onBright == null
                    ? 'The hero button could not be measured.'
                    : `Hero button text on your bright colour · ${num1(onBright)} to 1 · ${brightOk ? 'reads clearly' : 'hard to read on the night hero'}`],
                ] as const).map(([ok, line], ix) => (
                  <View key={ix} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginTop: ix === 0 ? 0 : sp.sm }}>
                    <IconPlate icon={ok ? 'check' : 'info'} tone={ok ? 'brand' : 'amber'} size={28} />
                    <Text style={{ ...ty.caption, color: t.ink2, flex: 1 }}>{line}</Text>
                  </View>
                ))}
              </View>
            );
          })()}
        </Section>


        {/* ── where the two of them reach ────────────────────────────────── */}
        <Expandable title="Where Your Brand Shows" note="Name everywhere · colour here and on the console">
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
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            The name and the colour are the whole of the branding today, and they do not reach the same places. The name is the gym’s everywhere — every owner’s device, and what your members and coaches see their app called. The colour is drawn by this app and by the web console only; a member’s app and a coach’s app keep their own accent.
          </Text>
        </Expandable>
      </ScrollView>
    </SafeAreaView>
  );
}
