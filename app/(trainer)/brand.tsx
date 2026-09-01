// Coach · Your Branding. What a coach's clients see, and where that stops.
//
// ── Why this is not the owner's Brand screen with the word "gym" swapped ───
//
// The obvious build was to point the coach app at `app/(owner)/brand.tsx` and
// let a coach edit their own tenant. Three measurements against the live
// database killed it, and they are written up in supabase/parts/153:
//
//   · a solo coach DOES have a tenant — `provision_profile()` gives every
//     profile one, and all seven live coaches sit alone in theirs;
//   · they cannot write it. `is_owner_of()` wants `role = 'owner'` and a coach
//     is a 'trainer', so `tenants_owner_rw` matches nothing. Proved by running
//     it: a coach updating their own tenant touches 0 rows and raises nothing;
//   · and no client is ever IN it. A coached client keeps their own personal
//     tenant; only a gym's member invite moves anybody. Branding that tenant
//     would have branded a room with one person in it.
//
// So a coach's brand hangs off the row a coach actually owns — `trainers` —
// and reaches their clients through `my_coach_brand()`, over the same active-
// coaching gate that already carries the coach's name and face there.
//
// ── What this screen deliberately does NOT offer ──────────────────────────
//
// app/(owner)/brand.tsx was corrected an hour before this was written, because
// it sold four things that do not exist. Nothing here re-sells them:
//
//   · no logo upload. The coach's photo already reaches their clients through
//     `my_coach()`, and it is set on Profile. A second image column with no
//     uploader behind it is precisely the promise that had to be walked back.
//   · no domain. There is no domain column anywhere in this schema.
//   · no store listing, no app name, no icon. Those are the BUILD-time brand
//     axis in src/lib/brands.ts — a bundle id is permanent and belongs to
//     whoever publishes the app. A coach brands their coaching; the app is
//     Repple's. `parseCoachBrandName` refuses this build's own names outright
//     so that boundary is enforced rather than merely described.
//   · no claim about fees, plans or what anybody keeps.
//
// The trading name and the colour are the whole of it, which is exactly what
// the owner's screen now says about a gym.
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, useThemeControls } from '../../src/ui/components';
import { Rule, Section, SectionHead, Ghost, Cta, Flag } from '../../src/ui/kit';
import { sp, layout, radius, hairline, elevation, type as ty } from '../../src/theme/scale';
import { brandInkFor } from '../../src/theme/tokens';
import { Icon } from '../../src/ui/Icon';
import { useMyTrainerProfile } from '../../src/ui/coachProfile';
import { fetchMyCoachBrand, saveMyCoachBrand } from '../../src/ui/coachBrand';
import {
  MAX_BRAND_NAME, coachBrandColorOf, parseCoachBrandColor, parseCoachBrandName,
} from '../../src/lib/coachBrand';
import { reportError } from '../../src/lib/reportError';
import type { LoadStatus } from '../../src/ui/loadStatus';

export default function CoachBrand() {
  const t = useTheme();
  const { palettes } = useThemeControls();
  const { name: coachName } = useMyTrainerProfile();

  const [status, setStatus] = useState<LoadStatus>('loading');
  // Null means "not loaded / not set" and is never rendered as a value. The
  // stored colour is held AS STORED rather than filtered, so a coach can see
  // and clear a colour the app is refusing to apply.
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savedColor, setSavedColor] = useState<string | null>(null);

  // Null means the coach has not touched the field, so it mirrors the record as
  // that read lands. Seeding useState from `savedName` would seed from null.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [colorMsg, setColorMsg] = useState<{ bad: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const b = await fetchMyCoachBrand();
      setSavedName(b.brandName);
      setSavedColor(b.brandColor);
      setStatus('ready');
    } catch (e) {
      // A failed read is not "you have set no branding". A coach told that would
      // set it again, over the top of whatever is really there.
      reportError('coachBrand.load', e);
      setStatus('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const nameField = nameDraft ?? savedName ?? '';
  const colorField = colorDraft ?? savedColor ?? '';
  // What the app would actually apply, which is not always what is stored.
  const applied = coachBrandColorOf(savedColor);
  const preview = coachBrandColorOf(colorDraft ?? savedColor) ?? t.brand;
  const previewName = (nameDraft ?? savedName ?? '').trim() || coachName;

  const saveName = async () => {
    const parsed = parseCoachBrandName(nameField);
    if (parsed.kind === 'bad') { setNameMsg({ bad: true, text: parsed.reason }); return; }
    setBusy(true); setNameMsg(null);
    const next = parsed.kind === 'clear' ? null : parsed.name;
    const failed = await saveMyCoachBrand({ brandName: next });
    setBusy(false);
    if (failed) { setNameMsg({ bad: true, text: failed }); return; }
    setSavedName(next); setNameDraft(null);
    setNameMsg({
      bad: false,
      text: next
        ? `Saved. Your clients see ${next} where they see your coaching.`
        : 'Cleared. Your clients see your own name, as they did before.',
    });
  };

  const saveColor = async (typed: string) => {
    const parsed = parseCoachBrandColor(typed);
    if (parsed.kind === 'bad') { setColorMsg({ bad: true, text: parsed.reason }); return; }
    setBusy(true); setColorMsg(null);
    const next = parsed.kind === 'clear' ? null : parsed.color;
    const failed = await saveMyCoachBrand({ brandColor: next });
    setBusy(false);
    if (failed) { setColorMsg({ bad: true, text: failed }); return; }
    setSavedColor(next); setColorDraft(null);
    setColorMsg({
      bad: false,
      text: next ? 'Saved. Your clients see this colour.' : 'Cleared. Your clients see the app’s own colour.',
    });
  };

  const inp = { ...ty.body, color: t.ink, backgroundColor: t.surface2, borderRadius: radius.sm, paddingHorizontal: sp.lg, paddingVertical: sp.md } as const;
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets>

        <View style={{ paddingTop: sp.md }}>
          <Text style={{ ...ty.micro, color: t.ink3 }}>Coach</Text>
          <Text style={{ ...ty.title, color: t.ink, marginTop: 5 }}>Your Branding</Text>
          <Text style={{ ...ty.label, color: t.ink3, marginTop: 3 }}>What your clients see around your coaching — saved to your account, not to this phone</Text>
        </View>

        {status === 'error' ? (
          <Section>
            <Flag tone={t.warn}>
              Your branding could not be read, so what is set is not known — this is not a coach who has set none.
              Nothing here can be changed until it can be read.
            </Flag>
            <View style={{ alignSelf: 'flex-start', marginTop: sp.lg }}>
              <Ghost label="Try Again" onPress={() => { void load(); }} />
            </View>
          </Section>
        ) : status === 'loading' ? (
          <Section><Text style={{ ...ty.label, color: t.ink3 }}>Reading your branding…</Text></Section>
        ) : (<>

          {/* ── the trading name ───────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Trading Name" />
            <TextInput value={nameField} onChangeText={(v) => { setNameDraft(v); if (nameMsg) setNameMsg(null); }}
              placeholder="What you coach under" placeholderTextColor={t.ink3}
              maxLength={MAX_BRAND_NAME} accessibilityLabel="Trading name" style={inp} />
            {nameMsg && nameMsg.bad ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{nameMsg.text}</Flag>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {nameMsg ? nameMsg.text : 'Leave it empty to coach under your own name. An empty field clears it — it does not mean you have no name.'}
              </Text>
            )}
            <View style={{ marginTop: sp.lg }}>
              <Cta wide label={busy ? 'Saving…' : 'Save Trading Name'} disabled={busy} onPress={() => { void saveName(); }} />
            </View>
          </Section>

          <Rule />

          {/* ── the colour, with the measurement in front of the coach ─────── */}
          <Section>
            <SectionHead title="Your Colour" />
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>
              {applied
                ? 'Tap a colour or type a hex code. Your clients see it wherever your coaching appears.'
                : 'You have not chosen a colour, so your clients see the app’s own. Tap one or type a hex code.'}
            </Text>

            {/* The ten palette accents, offered as a starting point rather than
                as the answer. Every one of them clears the readability test
                below, so a coach who never touches the hex field cannot produce
                an unreadable button. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
              {palettes.map((p) => {
                const on = coachBrandColorOf(p.theme.brand) === (colorDraft ? coachBrandColorOf(colorDraft) : applied);
                return (
                  <Pressable key={p.key} onPress={() => { setColorDraft(p.theme.brand); void saveColor(p.theme.brand); }}
                    accessibilityRole="button" accessibilityLabel={p.name}
                    style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: p.theme.bg, borderWidth: on ? 2 : hairline, borderColor: on ? t.brand : t.ring, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: p.theme.brand }} />
                    {on ? <View style={{ position: 'absolute', bottom: 3, right: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: sp.lg }}>
              <TextInput value={colorField} onChangeText={(v) => { setColorDraft(v); if (colorMsg) setColorMsg(null); }}
                placeholder="#1f6feb" placeholderTextColor={t.ink3} autoCapitalize="none" autoCorrect={false}
                maxLength={9} accessibilityLabel="Brand colour, as a hex code" style={inp} />
            </View>
            {colorMsg && colorMsg.bad ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{colorMsg.text}</Flag>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
                {colorMsg ? colorMsg.text : 'A colour your clients could not read a button label on is refused, and the reason says by how much.'}
              </Text>
            )}
            {/* Stated only when it is true. A colour sitting in the record that
                the app will not apply is the one state a coach could otherwise
                never account for — the swatch looks set and their clients see
                nothing. */}
            {savedColor && !applied ? (
              <Flag tone={t.warn} style={{ marginTop: sp.sm }}>
                The colour on your record cannot carry a readable label, so your clients are seeing the app’s own colour instead. Choose another and it will apply.
              </Flag>
            ) : null}
            <View style={{ marginTop: sp.lg }}>
              <Cta wide label={busy ? 'Saving…' : 'Save Colour'} disabled={busy} onPress={() => { void saveColor(colorField); }} />
            </View>
          </Section>

          <Rule />

          {/* ── live preview: exactly what a client of theirs sees ─────────── */}
          <Section>
            <SectionHead title="Live Preview" />
            <View style={{ backgroundColor: t.surface, borderRadius: radius.md, overflow: 'hidden', ...elevation.e1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: sp.lg, backgroundColor: t.surface2 }}>
                <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: preview }} />
                {/* Their trading name where they have one, their own name
                    otherwise — never a placeholder standing in for a real one. */}
                <Text style={{ ...ty.head, color: t.ink }}>{previewName}</Text>
              </View>
              <View style={{ padding: sp.lg }}>
                <Text style={{ ...ty.body, color: t.ink2, marginBottom: sp.lg }}>How your coaching looks to a client who trains with you and with nobody else.</Text>
                <View style={{ backgroundColor: preview, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center' }}>
                  {/* brandInkFor MEASURES rather than guessing, which is why a
                      bright green here gets black and not white at 1.59:1. */}
                  <Text style={{ ...ty.label, fontWeight: '600', color: brandInkFor(preview) }}>Start today's workout</Text>
                </View>
              </View>
            </View>
          </Section>

          <Rule />

          <Section>
            <View style={{ alignSelf: 'flex-start' }}>
              <Ghost label="Clear Your Colour" onPress={() => { setColorDraft(''); void saveColor(''); }} />
            </View>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>
              Puts you back to having chosen no colour, and your clients back to the app’s own.
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.lg }}>
              The name and the colour are the whole of your branding. They reach the clients you are actively coaching, and they stop when the coaching does.
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              A client who trains at a gym sees that gym's branding instead of yours. Membership is what the gym holds about them; you are their coach, not their club.
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              This does not change the app itself — its name in the store, its icon, or who published it. Repple makes the app; the coaching inside it is yours.
            </Text>
          </Section>
        </>)}
      </ScrollView>
    </SafeAreaView>
  );
}
