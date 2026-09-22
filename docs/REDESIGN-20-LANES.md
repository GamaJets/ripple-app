# Repple Redesign — 20-Lane Work Plan

Branch: `repple-redesign`

This plan is scoped to **Repple Fitness only**: Client, Coach, and repplefitness.com. PassionJet and Washateria are explicitly out of scope.

## Working rule

This is a redesign and simplification effort, not a rewrite. Existing routes, real data, role boundaries, offline behaviour, accessibility, white-label behaviour, and release checks remain authoritative unless a deliberate product decision changes them.

## Lane map

### Client app — lanes 1–8

1. **Client Home / Daily Briefing**
   - Audit `dashboard.tsx`, first-run states, readiness, next workout, coach/gym notices, offline/outbox states.
   - Goal: one obvious next action, one primary metric, no dashboard clutter.

2. **Training / Workout Execution**
   - Audit `workouts.tsx`, exercise detail, library, progression, records, lifting tools.
   - Goal: make starting, performing, editing and finishing a workout frictionless.

3. **Nutrition / Food Logging**
   - Audit `nutrition.tsx`, `foodlog.tsx`, restaurant/eating-out flows and coach nutrition guidance.
   - Goal: faster logging, clearer targets, better distinction between target, actual and coach instruction.

4. **Progress / Body / Recovery**
   - Audit `scans.tsx`, measurements, body trends, compare, recovery, glucose, wearables.
   - Goal: combine fragmented body data into a readable progress story without false precision.

5. **Coach Relationship / Messaging / Check-ins**
   - Audit `my-coach.tsx`, messages, weekly check-in, feedback, invitations and trainer discovery.
   - Goal: make the coaching relationship feel central rather than like a set of disconnected utilities.

6. **Schedule / Classes / PT / Attendance**
   - Audit calendar, bookings, classes, PT sessions, standing appointments, attendance and credits.
   - Goal: one scheduling mental model with clear status and cancellation/reschedule behaviour.

7. **Engagement / Habits / Challenges / Achievements**
   - Audit habits, consistency, streaks, achievements, milestone cards, challenges, referrals and social/share.
   - Goal: motivation without cheap gamification or noisy badges.

8. **Client Account / Onboarding / Settings**
   - Audit onboarding, getting-started, intake, account/security, appearance, devices, notifications, paperwork, memberships and receipts.
   - Goal: reduce setup burden and hide administration until needed.

### Coach app — lanes 9–16

9. **Coach Client Roster / Attention Queue**
   - Audit `dashboard.tsx`, client risk/drift, invitations, tags, bulk actions, first-run setup.
   - Goal: answer “who needs me today?” before showing business metrics.

10. **Client Detail / Coaching Record**
    - Audit client, client-body, client-training, client-week, client-goals, photos, attendance, intake and reports.
    - Goal: one client record with progressive disclosure instead of many disconnected detail screens.

11. **Program Builder / Templates / Exercise Library**
    - Audit `builder.tsx`, templates, exercise, library and assignment flows.
    - Goal: reduce builder complexity; make reusable blocks and assignment state obvious.

12. **Coach Schedule / Sessions / Classes**
    - Audit `calendar.tsx`, sessions, log-session, classes, class check-in and register.
    - Goal: schedule should behave like an operating surface, not a calendar plus separate admin screens.

13. **Coach Messaging / Broadcast / Nudges**
    - Audit messages, chat, saved messages, broadcasts, broadcast session, nudges and notifications.
    - Goal: one communication centre with clear audience and delivery state.

14. **Coach Analytics / Retention / Referrals / Leads**
    - Audit analytics, leaderboard, referrals, leads, ad spend and acquisition attribution.
    - Goal: prioritize client outcomes, retention and capacity before vanity metrics.

15. **Coach Money / Billing / Payments / Costs**
    - Audit money, billing, invoices, receipts, payments, costs and statements.
    - Goal: one financial picture with clear distinction between coach revenue, platform fees and client payments.

16. **Coach Profile / Brand / Credentials / Settings**
    - Audit profile, credentials, brand, share kit, documents, settings, getting-started and assistant.
    - Goal: professional identity and setup should be coherent, not spread across utility screens.

### Website — lanes 17–20

17. **Website Information Architecture / Homepage**
    - Audit `web/index.html`, navigation and positioning.
    - Goal: explain the three-product ecosystem in under 10 seconds and route each audience immediately.

18. **Client / Coach / Gym Conversion Pages**
    - Audit client, trainer and studio pages plus download/join flows.
    - Goal: each audience gets a distinct value proposition, proof, product preview and primary CTA.

19. **Signup / Auth / Support / Trust**
    - Audit signup, join, password reset, account deletion, support, privacy, terms and Stripe return pages.
    - Goal: consistent product quality through every non-marketing flow.

20. **Website Design System / Performance / SEO**
    - Audit `styles.css`, media, accessibility, metadata, structured content and deployment model.
    - Goal: reusable static components/tokens without adding framework complexity unless the current static architecture becomes the bottleneck.

## Findings already confirmed

- Client navigation has five primary tabs: **Home, Train, Meals, Progress, Me**, with a large set of secondary routes. The redesign should preserve this simple primary navigation while reducing secondary-screen sprawl.
- Coach navigation has six primary tabs: **Clients, Programs, Schedule, Videos, Analytics, Profile**. Secondary functionality is extensive and should be grouped into clearer task flows rather than exposed as equal-weight destinations.
- The existing shared design system already enforces typography, spacing, accessibility scaling, restrained card use and honest empty/error states. Reuse and extend it rather than replacing it.
- Several large Coach screens (`builder.tsx`, `calendar.tsx`, `analytics.tsx`) are large enough that the redesign should include component decomposition and workflow simplification, not only cosmetic changes.
- The current website already distinguishes Members, Coaches and Gyms and has the correct basic product story. The redesign should improve positioning, visual proof and conversion hierarchy rather than throw away that structure.

## First implementation order

1. Client Home
2. Coach Clients / Attention Queue
3. Client Training
4. Coach Client Detail
5. Coach Program Builder
6. Client Progress
7. Coach Schedule
8. Website Homepage
9. Website Client / Coach / Gym pages
10. Shared QA pass across remaining routes

## Acceptance standard for every redesigned screen

- Existing route remains reachable.
- No fabricated data.
- Loading, partial-read, offline and failure states remain truthful.
- Dynamic type / larger text remains usable.
- Light and dark modes remain coherent.
- White-label accent and locale/currency behaviour remain intact.
- Primary action is visually obvious.
- Secondary actions do not compete with the primary action.
- No new modal is used merely to announce success.
- Typecheck and relevant checks pass before merge.
