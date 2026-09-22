# State matrix — the manual pass

Phase 6 of `docs/claude-handoff/CLAUDE-CODE-DATA-LAYOUT-AND-FLOW-REVIEW.md`. The
gates catch what source text can show (`scripts/check-states.mjs`,
`scripts/check-a11y.mjs`, `scripts/check-contrast.mjs`, `scripts/check-fit.mjs`,
`scripts/check-keyboard.mjs`). This is the rest: run it on the simulator before
screenshots go for approval, and after any change to a screen listed here.

Mark each cell ✓, ✗ (with a note), or — (the state cannot occur on that screen).

## How to put the simulator in each state

| state | how |
| --- | --- |
| loading | Network Link Conditioner (Additional Tools for Xcode) → "Very Bad Network", then open the screen cold. Skeleton or quiet placeholder; never a zero. |
| empty | A fresh account from the join flow: no program, no meals, no clients. The empty state says what to do next. |
| partial read | Open the screen, then switch the Mac's Wi-Fi off while it is still loading. What arrived shows; what did not says "could not be read", never 0 or "none". |
| error | Wi-Fi off, then pull to refresh on a screen that already painted. The sentence is in ink (not `t.crit`) with a retry. |
| offline | Wi-Fi off before launch (the simulator uses the Mac's network). Cached data shows with its age. |
| queued | Offline, then log a set, a meal, a check-in or a message. It shows as waiting and is counted (`src/lib/offlineQueue.ts`, `src/lib/outbox.ts`); relaunch and it is still there; Wi-Fi on and it lands once. |
| refused | Queue a write offline, then make the server refuse it before reconnecting — e.g. the coach removes the client, or the booking is cancelled from the other account. The member is told, and the words are not lost (`src/lib/refusedIntents.ts`, `src/lib/refusedMessages.ts`). |
| largest text | `xcrun simctl ui booted content_size accessibility-extra-extra-extra-large`, relaunch. Nothing clipped, overlapped or truncated to "…" in a title; rows grow. Reset with `large`. |
| dark mode | `xcrun simctl ui booted appearance dark` with the app's Appearance set to Match System (`app/(client)/appearance.tsx`). No white slabs, no invisible ink. |
| tenant colour | Pick a non-default palette on the Appearance screen, and set a custom accent on the coach Brand screen (`app/(trainer)/brand.tsx`). Buttons, rings and selected tabs follow it; text on it stays readable. |
| VoiceOver order | Xcode → Open Developer Tool → Accessibility Inspector, target the simulator, step through with Auto-navigate. Order matches reading order, every control is named, sheets announce first. |

## Client — `EXPO_PUBLIC_APP_VARIANT=client`

| screen | load | empty | partial | error | offline | queued | refused | text | dark | tenant | VO |
| --- | - | - | - | - | - | - | - | - | - | - | - |
| Home `app/(client)/dashboard.tsx` | | | | | | — | — | | | | |
| Active workout `app/(client)/workouts.tsx` | | | | | | | | | | | |
| Meals `app/(client)/nutrition.tsx` | | | | | | | | | | | |
| Food log `app/(client)/foodlog.tsx` | | | | | | | | | | | |
| Progress `app/(client)/trends.tsx` | | | | | | — | — | | | | |
| Check-in `app/(client)/checkin.tsx` | | | | | | | | | | | |
| My Coach `app/(client)/my-coach.tsx` | | | | | | | | | | | |
| Messages `app/(client)/messages.tsx` | | | | | | | | | | | |
| Bookings `app/(client)/bookings.tsx` | | | | | | | | | | | |
| Access pass `app/(client)/access.tsx` | | — | | | | — | — | | fixed black, by design | — | |

## Coach — `EXPO_PUBLIC_APP_VARIANT=trainer`

| screen | load | empty | partial | error | offline | queued | refused | text | dark | tenant | VO |
| --- | - | - | - | - | - | - | - | - | - | - | - |
| Attention `app/(trainer)/dashboard.tsx` | | | | | | — | — | | | | |
| Client detail `app/(trainer)/client.tsx` | | | | | | | | | | | |
| Program builder `app/(trainer)/builder.tsx` | | | | | | | | | | | |
| Schedule `app/(trainer)/calendar.tsx` | | | | | | | | | | | |
| Log session `app/(trainer)/log-session.tsx` | | | | | | | | | | | |
| Chat `app/(trainer)/chat.tsx` | | | | | | | | | | | |
| Payments `app/(trainer)/payments.tsx` | | | | | | | | | | | |
| Brand `app/(trainer)/brand.tsx` | | — | | | | | | | | | |

## Studio — `EXPO_PUBLIC_APP_VARIANT=owner`

| screen | load | empty | partial | error | offline | queued | refused | text | dark | tenant | VO |
| --- | - | - | - | - | - | - | - | - | - | - | - |
| Overview `app/(owner)/dashboard.tsx` | | | | | | — | — | | | | |
| Members `app/(owner)/members.tsx` | | | | | | | | | | | |
| Trainers `app/(owner)/trainers.tsx` | | | | | | | | | | | |
| Rota `app/(owner)/rota.tsx` | | | | | | | | | | | |
| Revenue `app/(owner)/revenue.tsx` | | | | | | — | — | | | | |
| Brand `app/(owner)/brand.tsx` | | — | | | | | | | | | |

The operator console (`studio-web/app/page.tsx`) is a browser surface: check
it at 200% browser zoom and with the OS in dark mode; offline, queued and
refused do not apply.

## What fails the pass

- A number where the read failed. Unknown is never zero.
- A title ending in "…" at the largest text size, or a row whose second line is cut off.
- Text or a card drawn in a colour that did not change with dark mode or the tenant palette.
- A queued write that vanishes on relaunch, or a refused one nobody is told about.
- VoiceOver reaching an unnamed control, or reading a row's name without its warning.
