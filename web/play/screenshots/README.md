# Play store screenshots — coach app

Captured 2026-09-04 from the iOS Simulator (iPhone 17 Pro), coach app signed in
as a trainer. **iOS captures used for a Play listing**: the UI is the same React
Native code on both platforms and Play does not check which OS a screenshot came
from. Said here so nobody later mistakes them for Android captures.

`*-9x16.png` are the files to upload. Play requires 16:9 or 9:16; the raw
captures are 1206x2622 (1:2.17) and would be rejected, so each is padded to
1475x2622 with `#f4f6fb` — `light = clinical` in src/theme/tokens.ts, the app's
own background, so the padding does not show.

    sips -p <height> <height*9/16> --padColor F4F6FB in.png --out out.png

## What is here, and what is not

  coach-2-exercise-library   608 movements, search, muscle filters. The one
                             screen that photographs full, because its content
                             is the catalogue rather than the coach's data.
  coach-3-schedule           Calendar, availability dots, booked/open/blocked.
  coach-1-programme-builder  Shows the roster chip "Tamer" — a real person's
                             first name. NOT UPLOADED. Tim can consent for
                             himself, not for a client appearing in marketing.

Analytics and Videos were captured and discarded: the account holds 1 client,
1 session, 0 clips and no targets, so both are empty states. An empty dashboard
on a store listing is worse than one fewer screenshot.

The real fix for a listing that sells the app is a populated demo coach account.
Then every screen photographs well and none of them is anybody's real data.
