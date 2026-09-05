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
//   · no domain. There is no domain column anywhere in this schema.
//   · no store listing, no app name, no icon. Those are the BUILD-time brand
//     axis in src/lib/brands.ts — a bundle id is permanent and belongs to
//     whoever publishes the app. A coach brands their coaching; the app is
//     Repple's. `parseCoachBrandName` refuses this build's own names outright
//     so that boundary is enforced rather than merely described.
//   · no claim about fees, plans or what anybody keeps.
//
// ── The logo, and why it is here now ──────────────────────────────────────
//
// A logo upload was on that list, and the reason it was on it was NOT that a
// coach may not have a logo. It was that "a second image column with no
// uploader behind it is precisely the promise that had to be walked back". The
// refusal was about a column with nothing behind it, so the answer is to build
// the thing behind it rather than to keep refusing:
//
//   · supabase/parts/330 — the column, a private bucket, own-folder policies;
//   · src/ui/coachLogo.ts — the picker, the downscale, the upload, the clean-up;
//   · src/lib/coachInvoice.ts, src/lib/coachClientReport.ts and
//     src/lib/shareAsset.ts — the three artefacts that actually draw it.
//
// It is a NARROWER promise than the colour beside it, and this screen says so
// rather than letting a coach assume otherwise. The name and the colour reach
// clients INSIDE the app, through `my_coach_brand()`. The logo goes on
// artefacts this coach's own device builds and hands over: an invoice, a client
// report, a share card. The read policy is own-folder, so a client's app never
// fetches it, and `LOGO_SCOPE_NOTE` is that sentence in the coach's language.
//
// The coach's own photograph is a separate thing and is still set on Profile —
// it reaches their clients through `my_coach()` and always did.
import { useCallback, useEffect, useState } from 'react';
// React Native's own <Image> rather than expo-image's. It is in every binary
// ever built, it renders a data URI, and nothing here needs an animated format
// — so this is one screen that does not have to branch on HAS_NATIVE_IMAGE.
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert } from 'react-native';
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
import { useAuth } from '../../src/ui/auth';
import { clearMyLogo, pickLogo, uploadMyLogo, useMyCoachLogo } from '../../src/ui/coachLogo';
import { LOGO_SCOPE_NOTE, LOGO_UNREADABLE_NOTE } from '../../src/lib/coachLogo';
import type { LoadStatus } from '../../src/ui/loadStatus';
import { usePullToRefresh } from '../../src/ui/pullToRefresh';

export default function CoachBrand() {
  const t = useTheme();
  const { palettes } = useThemeControls();
  const { name: coachName, reload: reloadProfile } = useMyTrainerProfile();
  const { user: authUser } = useAuth();
  const coachId = authUser?.id ?? null;
  const logo = useMyCoachLogo();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ bad: boolean; text: string } | null>(null);

  /** Choose one, prepare it, store it, and only then say it is set. Every step
   *  that can fail says which one it was — "not saved" with no reason is what
   *  sends a coach back to export the same file again. */
  const chooseLogo = async () => {
    if (!coachId) { setLogoMsg({ bad: true, text: 'Your logo was not saved, because there is nobody signed in to save it for.' }); return; }
    setLogoMsg(null);
    const { picked, error } = await pickLogo();
    // A cancel is not a failure and must not raise anything at the coach.
    if (!picked) { if (error) setLogoMsg({ bad: true, text: error }); return; }
    setLogoBusy(true);
    const res = await uploadMyLogo(coachId, picked, logo.path);
    setLogoBusy(false);
    if (res.error) { setLogoMsg({ bad: true, text: res.error }); return; }
    setLogoMsg({ bad: false, text: 'Saved. It goes on the invoices, reports and cards you make from now on.' });
    logo.reload();
  };

  const removeLogo = () => {
    if (!coachId) return;
    Alert.alert('Remove Your Logo', 'Anything you make from now on is prepared without it, exactly as it was before you added one. Documents you have already sent are unchanged.', [
      { text: 'Keep It', style: 'cancel' },
      { text: 'Remove It', style: 'destructive', onPress: async () => {
        setLogoBusy(true);
        const failed = await clearMyLogo(coachId, logo.path);
        setLogoBusy(false);
        setLogoMsg(failed ? { bad: true, text: failed } : { bad: false, text: 'Removed. Your invoices and cards carry no logo now.' });
        logo.reload();
      } },
    ]);
  };

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

  // Three reads sit behind this screen: the brand row, the logo, and the coach's
  // own name that the preview falls back to. A failed brand read shows "could
  // not be read" with no way back except leaving the screen.
  const pull = usePullToRefresh(useCallback(
    () => Promise.all([load(), Promise.resolve(logo.reload()), reloadProfile()]),
    [load, logo, reloadProfile],
  ));

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets refreshControl={pull}>

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

          {/* ── the logo ───────────────────────────────────────────────────── */}
          <Section>
            <SectionHead title="Your Logo" />
            <Text style={{ ...ty.label, color: t.ink3, marginBottom: sp.lg }}>{LOGO_SCOPE_NOTE}</Text>

            {/* Three states and never two. A read that failed is not a coach
                who has set no logo, and telling them it was would have them set
                one over the top of whatever is really there. */}
            {logo.status === 'error' ? (
              <Flag tone={t.warn}>{LOGO_UNREADABLE_NOTE}</Flag>
            ) : logo.status === 'loading' ? (
              <Text style={{ ...ty.label, color: t.ink3 }}>Reading your logo…</Text>
            ) : logo.path ? (
              <View style={{ backgroundColor: t.surface2, borderRadius: radius.md, padding: sp.lg, alignItems: 'flex-start' }}>
                {logo.dataUri ? (
                  <Image source={{ uri: logo.dataUri }} resizeMode="contain" accessibilityLabel="Your logo"
                    style={{ width: 160, height: 56 }} />
                ) : logo.pictureStatus === 'loading' ? (
                  // ── the third state, which this branch was reporting as the
                  // second ──────────────────────────────────────────────────
                  // `logo.status` is about the RECORD; the picture is a second
                  // step that runs after it and has its own status
                  // (src/ui/coachLogo.ts :301). A null `dataUri` under a 'ready'
                  // record is therefore two different things — the download is
                  // in flight, or the download failed — and this said the
                  // second about both. Every launch showed a coach a failure
                  // notice for the second or two their own logo was on its way,
                  // over an empty box, on the screen whose whole job is telling
                  // them their branding is in order. app/(trainer)/share-kit.tsx
                  // :870 already reads `pictureStatus` rather than the null.
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    Your logo is set and the picture of it is still coming down.
                  </Text>
                ) : (
                  // The record says there is one and the picture did not
                  // arrive. Those are two different failures and this is the
                  // second, so the sentence is about the download rather than
                  // about the account.
                  <Text style={{ ...ty.caption, color: t.ink3 }}>
                    Your logo is set, and the picture of it could not be fetched just now. Anything you make in the meantime is prepared without it.
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ ...ty.caption, color: t.ink3 }}>
                You have not added a logo, so your invoices and cards carry your name and your colour, as they do today.
              </Text>
            )}

            {logoMsg ? (
              logoMsg.bad
                ? <Flag tone={t.warn} style={{ marginTop: sp.md }}>{logoMsg.text}</Flag>
                : <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>{logoMsg.text}</Text>
            ) : null}

            <View style={{ marginTop: sp.lg }}>
              <Cta wide label={logoBusy ? 'Saving…' : logo.path ? 'Choose a Different Logo' : 'Choose a Logo'}
                disabled={logoBusy || logo.status !== 'ready'} onPress={() => { void chooseLogo(); }} />
            </View>
            {logo.path ? (
              <View style={{ alignSelf: 'flex-start', marginTop: sp.md }}>
                <Ghost label="Remove Your Logo" onPress={removeLogo} />
              </View>
            ) : null}
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              A PNG or a JPEG, up to 2 MB. A PNG keeps a transparent background, which is what makes a mark sit properly on a dark card.
            </Text>
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
                    {on ? <View style={{ position: 'absolute', bottom: 3, end: 3 }}><Icon name="check" size={13} color={t.brand} /></View> : null}
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
              The name and the colour are what your clients see inside the app. They reach the clients you are actively coaching, and they stop when the coaching does.
            </Text>
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
              Your logo is not part of that. It goes on the documents and cards you make and hand over yourself, which is why the preview above does not show it.
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
