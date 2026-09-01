// Client · Notification preferences. Which kinds of notification this app
// sends, and the hours it will not send them in.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One row on the settings screen — "Push Notifications" — covering session
// reminders, class reminders, coach messages, notices and invoices together.
// So the only way to stop a 6am class reminder was to stop hearing from your
// coach, and the only way to sleep through a 3am hydration nudge was to turn
// everything off and lose the session reminders with it.
//
// ── The one thing this screen must not do ─────────────────────────────────
//
// Offer a switch it cannot honour. Everything listed here as a switch is
// scheduled BY THIS PHONE and is gated inside src/ui/pushNotifications.ts,
// where a caller cannot skip it. The coach-and-gym category is sent from the
// server, which has never heard of these preferences — so it is shown as a row
// that says so rather than as a switch that would read "off" while the banners
// went on arriving. That is the failure src/lib/pushConsent.ts exists for,
// pointing the other way.
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/ui/components';
import { Rule, Section, SectionHead, Notice, Ghost, Field } from '../../src/ui/kit';
import { sp, layout, radius, hairline, type as ty, numeric } from '../../src/theme/scale';
import { useNotifyPrefs } from '../../src/ui/notifyPrefs';
import { CATEGORIES, allows, quietLabel } from '../../src/lib/notifyPrefs';
import { pushAvailable } from '../../src/ui/pushNotifications';

export default function NotificationPrefs() {
  const t = useTheme();
  const router = useRouter();
  const { prefs, loaded, setCategory, setQuiet, setQuietHours } = useNotifyPrefs();

  const switches = CATEGORIES.filter((c) => c.local);
  const remote = CATEGORIES.filter((c) => !c.local);
  const G = layout.gutter;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: G, paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingTop: sp.md }}>
          <Ghost icon="back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...ty.micro, color: t.ink3 }}>What reaches you, and when</Text>
            <Text style={{ ...ty.title, color: t.ink, marginTop: 3 }}>Notifications</Text>
          </View>
        </View>

        {/* Said before any switch, because a switch on a build that cannot
            schedule anything is a control with no effect, and the member has
            no other way to find that out. */}
        {!pushAvailable() ? (
          <Section>
            <Notice
              tone={t.warn}
              kicker="Not sending yet"
              title="This build cannot schedule notifications"
              note="Your choices here are kept and will be honoured, but nothing is being sent on this version of the app at all."
            />
          </Section>
        ) : null}

        <Rule />

        <Section>
          <SectionHead title="What This App Sends" />
          {switches.map((c, i) => {
            const on = allows(c.key, prefs);
            return (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: t.ring }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>{c.title}</Text>
                  <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.note}</Text>
                </View>
                {/* A switch, announced as one, and 48 x 28 with hit slop to
                    clear the 44pt minimum. The pattern from the reminders
                    screen, which had to fix exactly this. */}
                <Pressable onPress={() => setCategory(c.key, !on)}
                  accessibilityRole="switch"
                  accessibilityLabel={c.title}
                  accessibilityState={{ checked: on }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                  style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: on ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
                  <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
                </Pressable>
              </View>
            );
          })}
          {/* Until the store answers, these switches show the defaults rather
              than the member's own answers, and they may differ. Said out loud
              for the fraction of a second it lasts, because a switch showing
              somebody else's answer is exactly the thing this screen is for. */}
          {!loaded ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.sm }}>Reading your choices…</Text>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Quiet Hours" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink }}>Hold Reminders Overnight</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>
                {prefs.quiet
                  ? `Reminders and streak nudges due between ${quietLabel(prefs)} arrive at ${quietLabel(prefs).split(' to ')[1]} instead.`
                  : 'Reminders and streak nudges arrive whenever they are due.'}
              </Text>
            </View>
            <Pressable onPress={() => setQuiet(!prefs.quiet)}
              accessibilityRole="switch"
              accessibilityLabel="Hold reminders overnight"
              accessibilityState={{ checked: prefs.quiet }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
              style={{ width: 48, height: 28, borderRadius: radius.pill, backgroundColor: prefs.quiet ? t.brand : t.surface3, justifyContent: 'center', paddingHorizontal: 3 }}>
              <View style={{ width: 22, height: 22, borderRadius: radius.pill, backgroundColor: '#fff', alignSelf: prefs.quiet ? 'flex-end' : 'flex-start' }} />
            </Pressable>
          </View>

          {prefs.quiet ? (
            <View style={{ marginTop: sp.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: sp.sm }}>
                <Field label="From" hint="24h" style={{ flex: 0 }} a11y="Quiet hours start, on a 24-hour clock">
                  <TextInput
                    value={String(prefs.quietFromHour)}
                    onChangeText={(x) => setQuietHours(parseInt(x, 10) || 0, prefs.quietToHour)}
                    keyboardType="number-pad"
                    style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' }} />
                </Field>
                <Text style={{ ...ty.label, color: t.ink3, paddingBottom: 13 }}>to</Text>
                <Field label="To" hint="24h" style={{ flex: 0 }} a11y="Quiet hours end, on a 24-hour clock">
                  <TextInput
                    value={String(prefs.quietToHour)}
                    onChangeText={(x) => setQuietHours(prefs.quietFromHour, parseInt(x, 10) || 0)}
                    keyboardType="number-pad"
                    style={{ ...ty.body, ...numeric, color: t.ink, backgroundColor: t.surface2, borderColor: t.ring, borderWidth: hairline, borderRadius: radius.sm, paddingHorizontal: sp.md, paddingVertical: 11, width: 54, textAlign: 'center' }} />
                </Field>
                {/* The same 24-hour boxes as the reminders screen, with the
                    same echo beside them. Somebody who wants quiet from nine in
                    the evening types 9 and gets nine in the morning otherwise. */}
                <Text style={{ ...ty.caption, ...numeric, color: t.ink3, flex: 1, paddingBottom: 13 }}>{quietLabel(prefs)}</Text>
              </View>
              {prefs.quietFromHour === prefs.quietToHour ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.sm }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.warn }} />
                  <Text style={{ ...ty.caption, color: t.ink2 }}>Nothing is being held — the two hours are the same, so the window is empty.</Text>
                </View>
              ) : null}
              {/* The rule that stops "quiet hours" meaning "lost notifications",
                  said where it is decided rather than only in the code. */}
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.md }}>
                Nothing is thrown away. A reminder due inside these hours is held and arrives when they end. Session and class reminders are never held, because you chose those times yourself and the warning has to reach you before the session does.
              </Text>
            </View>
          ) : null}
        </Section>

        <Rule />

        <Section>
          <SectionHead title="Sent By Your Coach" />
          {remote.map((c) => (
            <View key={c.key} style={{ paddingVertical: sp.md }}>
              <Text style={{ ...ty.body, fontWeight: '500', color: t.ink2 }}>{c.title}</Text>
              <Text style={{ ...ty.caption, color: t.ink3, marginTop: 2 }}>{c.note}</Text>
            </View>
          ))}
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            There is no switch here for these because a switch here could not stop them: they are sent from the server, which does not read the choices on this screen. Turning off Push Notifications in Settings stops all of them together, and that is the only control that works today.
          </Text>
        </Section>

        <Rule />

        <Section>
          <Text style={{ ...ty.caption, color: t.ink3 }}>
            These choices are kept on this phone. If you use the app on a second phone, that one has its own answers.
          </Text>
        </Section>

      </ScrollView>
    </SafeAreaView>
  );
}
