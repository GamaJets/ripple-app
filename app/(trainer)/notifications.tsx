// Trainer · Notifications. The coach's side of the same inbox.
//
// A coach receives fewer kinds than a client does and they matter more: a
// client booking a slot, and a client cancelling one — the two events that
// change what the coach's day looks like and that, until now, existed only as a
// push notification on a build that cannot receive push notifications.
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
      blurb="Bookings, cancellations and anything your clients or your gym have sent you."
      emptyTitle="Nothing needs you"
      // Not "you have no notifications" — that reads as a fault. This says what
      // the empty list means: nobody has changed anything on you.
      emptyNote="When a client books or cancels, it appears here. Client messages stay in your threads."
    />
  );
}
