// Client · Notifications. The inbox behind the bell in the dashboard header.
//
// That bell has always routed to '/(client)/messages', because there was
// nowhere else for it to go: `notifications` had a writer and no reader. This
// is the reader. The list, the unread state and the read-status discipline all
// live in src/ui/notifications.tsx — this file is the framing, and the framing
// is the only part that is different in the client app.
//
// Registering this route needs a line in app/(client)/_layout.tsx, which this
// work does not own:
//   <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
// Without it expo-router gives the screen a TAB BUTTON next to Home and Train —
// the failure scripts/check-tabs.mjs exists to catch, and which it will report
// against this file until that line is added.
import { NotificationInbox } from '../../src/ui/notifications';

export default function ClientNotifications() {
  return (
    <NotificationInbox
      group="client"
      kicker="Your inbox"
      title="Notifications"
      blurb="Bookings, cancellations and anything your coach or gym has sent you."
      emptyTitle="Nothing to catch up on"
      // Says what the inbox does NOT carry, because the bell used to open the
      // message thread and people will arrive here looking for a conversation.
      emptyNote="Session changes and offers land here. Messages from your coach stay in your chat."
    />
  );
}
