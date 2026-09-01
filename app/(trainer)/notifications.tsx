// Trainer · Notifications. The coach's side of the same inbox.
//
// A coach receives fewer kinds than a client does and they matter more. It
// began as two — a client booking a slot and a client cancelling one, the
// events that change what the coach's day looks like — plus a client's message.
// Those three were, for a long time, everything a coach was ever told; the rest
// of what their clients did reached them only if they went looking at the right
// screen.
//
// supabase/parts/158 adds the three the roadmap named, as database triggers
// rather than pushes, because none of them can be sent from a screen: a
// coaching request has no coach/client relationship for notify_users() to
// authorise yet, one of its two writers is `join_by_code()` on the server, and
// `client_subscriptions` is written by a Stripe webhook the app never sees. See
// SERVER_WRITTEN in src/lib/notifyInbox.ts for what each one draws and where it
// goes.
//
// Registering this route needs a line in app/(trainer)/_layout.tsx, which this
// work does not own:
//   <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
import { NotificationInbox } from '../../src/ui/notifications';

export default function TrainerNotifications() {
  return (
    <NotificationInbox
      group="trainer"
      kicker="Your inbox"
      title="Notifications"
      blurb="Coaching requests, bookings, subscriptions and anything your clients or your gym have sent you."
      emptyTitle="Nothing needs you"
      // Not "you have no notifications" — that reads as a fault. This says what
      // the empty list means: nobody has changed anything on you.
      emptyNote="Someone asking to be coached, a booking, a cancellation, a subscription changing or paperwork accepted — they all appear here. Client messages stay in your threads."
    />
  );
}
