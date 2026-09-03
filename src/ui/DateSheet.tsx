// A month you can tap, over a field you can still type into.
//
// ── What was reported ─────────────────────────────────────────────────────
//
// A coach on Android, on the programme builder's assign panel: "Is there a way
// that when you click on the space of the date the whole calendar option pops
// up for selection?" The Starts on field was a bare `TextInput` with a
// `YYYY-MM-DD` placeholder, and they had typed a date by hand and then could not
// proceed — so they assumed the date was the blocker. It was not; the button was
// held because the programme had no exercises in it. The request stands anyway:
// nobody should have to type `2026-09-07` on a phone keyboard to say "the
// Monday after next".
//
// ── Why this is pure JS and not a native picker ───────────────────────────
//
// `@react-native-community/datetimepicker` is a native module. A native module
// is a new binary, and this has to reach coaches over the air on the build they
// are already running. So the grid is drawn here, out of `src/lib/monthGrid.ts`,
// which is integer arithmetic with no Date in it at all.
//
// ── Typing did not go away. It moved IN HERE ──────────────────────────────
//
// The same coach reported the other half a day later: "when you tap the date the
// keyboard pops up and blocks what you are typing". Both fields were anchored to
// the bottom of a sheet, which is exactly where the soft keyboard arrives, so the
// gesture for filling the field in was the gesture that hid it.
//
// The obvious fix — make the field a button and drop the keyboard — would be a
// regression for every coach who pastes a date out of a client's message or off
// their own notes, and there are enough of them that the first draft of this file
// argued for keeping the `TextInput` at the call site. That argument was right
// about the need and wrong about the place. Two controls for one value is what
// produced the bug: a box that raises a keyboard, and a 44pt calendar button
// beside it that nobody taps because the field's own space is where a finger
// goes.
//
// So there is ONE control on the screen — a box that opens this sheet — and both
// routes live in here. The default gesture raises no keyboard at all; typing is
// behind an explicit "Type a Date", and it is HIDDEN until asked for, so nothing
// about the ordinary path changed. It is not offered per call site, and that is
// deliberate: every field this sheet stands over used to be typeable, so a call
// site that switched typing off would be re-imposing the loss this paragraph
// exists to avoid — on whichever screen its author happened not to think about.
// One sheet, one shape, both ways in.
//
// A typed date is validated by `isStartDate` and by the sheet's own range before
// anything is written, and an unreadable one refuses IN PLACE and writes nothing:
// this app never stores a date it cannot read back, because a stored unparseable
// value puts every screen reading it into "unreadable" for ever.
//
// ── Days a field will not take are drawn as days it will not take ─────────
//
// `range` greys them out. The invoice settle field refuses a day before the
// invoice was written and a day after today; drawing all thirty-one and then
// refusing eleven of them on the tap is the text box with extra steps. The
// arithmetic is `src/lib/dayRange.ts` and the caller's own blocker still guards
// the write — see that file's header for why an unreadable bound blocks nothing.
//
// ── Dismissing is a cancel ────────────────────────────────────────────────
//
// The scrim, the back button and the Cancel control all call `onCancel`, and
// none of them writes a date. A picker that "helpfully" commits whatever cell
// was under the highlight when it closed is how a coach ends up with a start
// date they never chose on a plan they printed — the same failure
// `isStartDate`'s own header describes for a value that will not parse.
//
// ── Whose language, and whose week ────────────────────────────────────────
//
// The words come from `src/lib/calendarNames.ts` and `src/lib/format.ts`,
// including their no-ICU fallbacks; there is no English array in this file. The
// ORDER of the columns comes from `WEEK_STARTS_ON` in src/lib/weekStart.ts by
// way of `monthGrid`, so it is Sunday-first because the product says so and not
// because a locale does.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';

import { useTheme } from './components';
import { Icon } from './Icon';
import { Ghost, Cta, Flag } from './kit';
import { BACK_ICON, FORWARD_ICON } from './direction';
// `value` is the type scale's numeral face and is aliased, because this
// component has a prop called `value` and a shadowed import is a runtime error
// waiting for whoever adds the next line.
import { sp, radius, hairline, elevation, type as ty, value as numeral } from '../theme/scale';
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { monthGrid, gridRows, stepMonth, isoFromParts, todayParts, openMonth, weekdayOf } from '../lib/monthGrid';
import { monthNamesLong, weekdayNamesNarrow } from '../lib/calendarNames';
import { fmtFullDay, weekdayName } from '../lib/format';
import { isStartDate } from '../lib/programStart';
import { dayAllowed, monthHasAllowedDay, dayRefusal, type DayRange } from '../lib/dayRange';

/** The month-step chevrons are drawn at 36pt because a 44pt round button either
 *  side of the month name crowds it on the narrowest phone. Slop, not padding,
 *  brings the target back to `MIN_TARGET` without moving the drawing — the
 *  argument `hitSlopFor` itself makes. */
const STEP_SIZE = 36;

/**
 * A month grid in a sheet, over a `YYYY-MM-DD` field.
 *
 * `value` is whatever is currently in the field, and it decides two things: the
 * month the sheet opens on, and which cell is drawn as chosen. A value that
 * cannot be read — half-typed, or a date this app would refuse — opens the
 * reader's own month and selects nothing, because the sheet is how the coach
 * fixes exactly that and must stay reachable from it.
 */
export function DateSheet({
  visible, value, onCancel, onPick, heading = 'Pick a day', note, range, fallback,
}: {
  visible: boolean;
  /** The field's current contents. '' or null when it is empty. */
  value: string | null | undefined;
  /** Dismissed without choosing. The field is left exactly as it was. */
  onCancel: () => void;
  /** A day was chosen — tapped, or typed and read. Always a `YYYY-MM-DD` built
   *  from parts, and never a day this sheet's own `range` refuses. */
  onPick: (iso: string) => void;
  /** What the sheet is asking for, in the caller's own words — this is used on
   *  more than one field and "Pick a day" is not what every one of them means. */
  heading?: string;
  /** One line under the heading, when the caller has something the coach needs
   *  to know before they choose. */
  note?: string;
  /** The days this field will take. Anything outside it is drawn unreachable
   *  and cannot be tapped or typed. Omit where a field takes any day — a start
   *  date has no bound at either end, and inventing one would refuse a coach
   *  recording that a block began last Monday. */
  range?: DayRange | null;
  /** Which month to open on when `value` is empty or unreadable — the OTHER end
   *  of a period, on the two screens that pick both. A coach who has just set a
   *  statement to run from April 2025 is choosing its end in April 2025, not in
   *  whatever month the handset is in today. */
  fallback?: string | null;
}) {
  const t = useTheme();

  // The month on screen. Seeded on every OPEN rather than once on mount: a
  // sheet that remembered last time's month would show September to a coach who
  // has since typed a March date into the field and reopened it to check.
  const seed = isStartDate(value) ? String(value).trim() : String(fallback ?? '');
  const [view, setView] = useState(() => openMonth(seed));
  // The typed route, hidden until asked for. Reset on every open, so a coach
  // who typed a refused date, backed out and came back is not met by their own
  // mistake and a refusal about it — they are met by the calendar, which is the
  // gesture that was asked for.
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setView(openMonth(seed));
    setTyping(false);
    setDraft('');
    setRefused(null);
  }, [visible, seed]);

  const grid = monthGrid(view.year, view.month);
  const rows = gridRows(grid);
  const months = monthNamesLong();
  const heads = weekdayNamesNarrow();

  // Today is read once per render, from the LOCAL getters, because "today" on a
  // calendar means today where the reader is standing.
  const [nowY, nowM, nowD] = todayParts();
  const todayIso = isoFromParts(nowY, nowM, nowD);

  const selected = String(value ?? '').trim();
  const prev = stepMonth(view.year, view.month, -1);
  const next = stepMonth(view.year, view.month, 1);

  const step = (delta: number) => setView(stepMonth(view.year, view.month, delta));

  // A month with nothing reachable in it is a month there is no point stepping
  // to, so the chevron that goes there is disabled rather than leading to a
  // grid of grey. With no range both are always live, which is every call site
  // that does not pass one.
  const canPrev = monthHasAllowedDay(prev.year, prev.month, range);
  const canNext = monthHasAllowedDay(next.year, next.month, range);

  /**
   * A typed date, read or refused. Nothing is written on a refusal.
   *
   * Two gates and they are the same two the tapped route passes: `isStartDate`
   * says it is a day this app can read back, and the sheet's own `range` says
   * it is a day this field will take. Both live in `dayRefusal`, so the typed
   * route cannot drift from the greyed cells beside it.
   */
  const commitTyped = () => {
    const typed = draft.trim();
    const why = dayRefusal(typed, range, fmtFullDay);
    if (why) { setRefused(why); return; }
    onPick(typed);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      {/* The keyboard arrives at the bottom of the window and this sheet is
          anchored to the bottom of the window, which is the whole of the
          reported bug. `padding` has something to compress here because the
          scrim below is a flex:1 sibling ABOVE the sheet — the condition
          scripts/check-keyboard.mjs spells out, and the reason a bare
          KeyboardAvoidingView around a lone scroller does nothing. Android
          resizes the window itself, so it needs no behavior. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Tapping away is a cancel and writes nothing. See the header.

            Hidden from a screen reader rather than labelled: a full-screen
            touchable announced as a button is the first thing VoiceOver lands
            on, above the sheet's own heading, and it reads as though the whole
            month were one control. The Cancel below and the hardware back
            button are the accessible ways out, and both do the same nothing. */}
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
          onPress={onCancel}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={{
          backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: 20, paddingBottom: 30, maxHeight: '86%', ...elevation.e2,
        }}>
          <Text style={{ ...ty.title, color: t.ink }}>{heading}</Text>
          {note ? (
            <Text style={{ ...ty.caption, color: t.ink3, marginTop: sp.xs }}>{note}</Text>
          ) : null}

          {/* ── the month, and the two ways out of it ──────────────────────
              Both controls name the month they will land on. "Previous month"
              on its own tells a screen reader nothing about where it is going,
              and this sheet's whole job is stopping a coach committing a date
              they did not mean. */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            marginTop: sp.lg, marginBottom: sp.md,
          }}>
            <Pressable
              onPress={() => step(-1)}
              disabled={!canPrev}
              hitSlop={hitSlopFor(STEP_SIZE)}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canPrev }}
              accessibilityLabel={canPrev
                ? `Previous month, ${months[prev.month]} ${prev.year}`
                : `Previous month, ${months[prev.month]} ${prev.year}, which holds no day this field will take`}
              style={{ width: STEP_SIZE, height: STEP_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm }}
            >
              <Icon name={BACK_ICON} size={18} color={canPrev ? t.ink2 : t.ink3} />
            </Pressable>
            <Text
              accessibilityRole="header"
              style={{ ...ty.head, color: t.ink, textAlign: 'center', flex: 1 }}
            >
              {months[grid.month]} {grid.year}
            </Text>
            <Pressable
              onPress={() => step(1)}
              disabled={!canNext}
              hitSlop={hitSlopFor(STEP_SIZE)}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canNext }}
              accessibilityLabel={canNext
                ? `Next month, ${months[next.month]} ${next.year}`
                : `Next month, ${months[next.month]} ${next.year}, which holds no day this field will take`}
              style={{ width: STEP_SIZE, height: STEP_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm }}
            >
              <Icon name={FORWARD_ICON} size={18} color={canNext ? t.ink2 : t.ink3} />
            </Pressable>
          </View>

          {/* The narrow names are decoration for a screen reader: "S M T W T F S"
              collides twice in English and says nothing a cell's own label does
              not say better, so it is hidden from the reader that has the
              labels. Keyed by index, because narrow names are not unique. */}
          <View style={{ flexDirection: 'row', marginBottom: sp.xs }} importantForAccessibility="no-hide-descendants">
            {heads.map((d, i) => (
              <Text key={i} style={{ ...ty.micro, flex: 1, textAlign: 'center', color: t.ink3 }}>{d}</Text>
            ))}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {rows.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row' }}>
                {row.map((d, i) => {
                  // A blank is a blank. It is not the neighbouring month's 30th
                  // dressed as one, so there is nothing here to tap by mistake.
                  if (d == null) return <View key={i} style={{ flex: 1, minHeight: MIN_TARGET }} />;
                  const iso = isoFromParts(grid.year, grid.month, d);
                  const isSel = iso === selected;
                  const isToday = iso === todayIso;
                  // The whole date, spoken: weekday, day, month and year, in the
                  // reader's own language and their own order. A cell that only
                  // said "14" would be read out of a grid whose heading the
                  // reader may never have reached.
                  const spoken = `${weekdayName(weekdayOf(grid.year, grid.month, d))}, ${fmtFullDay(iso)}`
                    + (isToday ? ', today' : '');
                  // A day outside the caller's range. Drawn dimmed and not
                  // pressable, and SAID as unavailable rather than only shown
                  // that way — dimming is a colour, and colour is exactly what
                  // a screen reader does not have.
                  const open = dayAllowed(iso, range);
                  return (
                    <Pressable
                      key={i}
                      onPress={() => onPick(iso)}
                      disabled={!open}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSel, disabled: !open }}
                      accessibilityLabel={open ? spoken : `${spoken}, not one this field will take`}
                      style={{ flex: 1, minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <View style={{
                        width: 36, height: 36, borderRadius: radius.sm,
                        alignItems: 'center', justifyContent: 'center',
                        backgroundColor: isSel ? t.brand : 'transparent',
                        // Today is a ring, the choice is a fill: two different
                        // shapes rather than two colours, so they survive a
                        // glance and a colour-blind reader.
                        borderWidth: isToday && !isSel ? hairline * 2 : 0, borderColor: t.brand,
                      }}>
                        <Text style={{ ...numeral(15), color: isSel ? t.brandInk : open ? t.ink : t.ink3 }}>{d}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          {/* ── the typed route ────────────────────────────────────────────
              Outside the ScrollView on purpose: the field a coach is typing
              into must not be able to scroll out from under them while the
              month does. It is also why this is not inside the grid's
              scroller for check:keyboard's purposes — it has no enclosing
              scroller at all, and the KeyboardAvoidingView above lifts the
              whole sheet clear.

              keyboard-ok: this field sits below the month's own scroller with
              nothing between it and the bottom of the sheet, and the sheet is
              lifted whole by the KeyboardAvoidingView wrapping the scrim. */}
          {typing ? (
            <View style={{ marginTop: sp.md }}>
              <TextInput
                value={draft}
                onChangeText={(v) => { setDraft(v); setRefused(null); }}
                onSubmitEditing={commitTyped}
                returnKeyType="done"
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={t.ink3}
                accessibilityLabel="The day, as year, month and day. Paste one here, or tap it on the calendar above."
                style={{
                  ...ty.body, color: t.ink, backgroundColor: t.surface2,
                  borderRadius: radius.sm, paddingHorizontal: 12,
                  minHeight: MIN_TARGET, paddingVertical: 10,
                }}
              />
              {/* Refused in place, and nothing is written. A date this app
                  cannot read is never stored: a stored unparseable value puts
                  every screen reading it into "unreadable" for ever. */}
              {refused ? <Flag tone={t.warn} style={{ marginTop: sp.sm }}>{refused}</Flag> : null}
              <View style={{ marginTop: sp.md }}>
                <Cta label="Use This Date" wide a11yLabel={`Use the day typed above, ${draft.trim() || 'nothing yet'}`} onPress={commitTyped} />
              </View>
            </View>
          ) : null}

          <View style={{
            marginTop: sp.md, flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between', gap: sp.md,
          }}>
            <Ghost label="Cancel" a11yLabel="Close without choosing a day" onPress={onCancel} />
            {/* The whole reason the field outside this sheet no longer raises a
                keyboard: typing is here, and it is behind a deliberate tap so
                the default gesture stays keyboard-free. */}
            {typing ? (
              <Ghost label="Use the Calendar" a11yLabel="Put the keyboard away and pick the day off the calendar" onPress={() => { setTyping(false); setRefused(null); }} />
            ) : (
              <Ghost label="Type a Date" a11yLabel="Type or paste the day instead of tapping it" onPress={() => { setTyping(true); setDraft(selected); setRefused(null); }} />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
