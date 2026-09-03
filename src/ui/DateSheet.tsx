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
// ── The field stays editable. That is not a compromise ────────────────────
//
// The sheet is an ADDITIONAL way in. Coaches paste dates out of messages and out
// of their own notes, and a picker that took the keyboard away would be a
// regression for the ones already doing that. So the caller keeps its
// `TextInput`, keeps its own validation, and opens this on a tap.
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
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';

import { useTheme } from './components';
import { Icon } from './Icon';
import { Ghost } from './kit';
import { BACK_ICON, FORWARD_ICON } from './direction';
// `value` is the type scale's numeral face and is aliased, because this
// component has a prop called `value` and a shadowed import is a runtime error
// waiting for whoever adds the next line.
import { sp, radius, hairline, elevation, type as ty, value as numeral } from '../theme/scale';
import { MIN_TARGET, hitSlopFor } from '../lib/a11y';
import { monthGrid, gridRows, stepMonth, isoFromParts, todayParts, openMonth, weekdayOf } from '../lib/monthGrid';
import { monthNamesLong, weekdayNamesNarrow } from '../lib/calendarNames';
import { fmtFullDay, weekdayName } from '../lib/format';

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
  visible, value, onCancel, onPick, heading = 'Pick a day', note,
}: {
  visible: boolean;
  /** The field's current contents. '' or null when it is empty. */
  value: string | null | undefined;
  /** Dismissed without choosing. The field is left exactly as it was. */
  onCancel: () => void;
  /** A day was tapped. Always a `YYYY-MM-DD` built from parts. */
  onPick: (iso: string) => void;
  /** What the sheet is asking for, in the caller's own words — this is used on
   *  more than one field and "Pick a day" is not what every one of them means. */
  heading?: string;
  /** One line under the heading, when the caller has something the coach needs
   *  to know before they choose. */
  note?: string;
}) {
  const t = useTheme();

  // The month on screen. Seeded on every OPEN rather than once on mount: a
  // sheet that remembered last time's month would show September to a coach who
  // has since typed a March date into the field and reopened it to check.
  const [view, setView] = useState(() => openMonth(value));
  useEffect(() => { if (visible) setView(openMonth(value)); }, [visible, value]);

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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1 }}>
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
              hitSlop={hitSlopFor(STEP_SIZE)}
              accessibilityRole="button"
              accessibilityLabel={`Previous month, ${months[prev.month]} ${prev.year}`}
              style={{ width: STEP_SIZE, height: STEP_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm }}
            >
              <Icon name={BACK_ICON} size={18} color={t.ink2} />
            </Pressable>
            <Text
              accessibilityRole="header"
              style={{ ...ty.head, color: t.ink, textAlign: 'center', flex: 1 }}
            >
              {months[grid.month]} {grid.year}
            </Text>
            <Pressable
              onPress={() => step(1)}
              hitSlop={hitSlopFor(STEP_SIZE)}
              accessibilityRole="button"
              accessibilityLabel={`Next month, ${months[next.month]} ${next.year}`}
              style={{ width: STEP_SIZE, height: STEP_SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm }}
            >
              <Icon name={FORWARD_ICON} size={18} color={t.ink2} />
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
                  return (
                    <Pressable
                      key={i}
                      onPress={() => onPick(iso)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSel }}
                      accessibilityLabel={spoken}
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
                        <Text style={{ ...numeral(15), color: isSel ? t.brandInk : t.ink }}>{d}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <View style={{ marginTop: sp.md, alignItems: 'center' }}>
            <Ghost label="Cancel" a11yLabel="Close without choosing a day" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
