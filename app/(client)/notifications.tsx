// Client · Notifications. The inbox behind the bell in the dashboard header.
//
// That bell has always routed to '/(client)/messages', because there was
// nowhere else for it to go: `notifications` had a writer and no reader. This
// is the reader. The list, the unread state and the read-status discipline all
// live in src/ui/notifications.tsx — this file is the framing, and the framing
// is the only part that is different in the client app.
//
// Registering this route needs a line in app/(client)/_layout.tsx, and that
// line is now there — app/(client)/_layout.tsx:147:
//   <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
// It is named here rather than deleted because without it expo-router gives the
// screen a TAB BUTTON next to Home and Train, which is the failure
// scripts/check-tabs.mjs exists to catch. This note read "until that line is
// added" long after it had been: an instruction to add something that is
// already present is an invitation to add it twice.
//
// `href: null` is also why nothing on this screen may read a clock at mount —
// a route registered that way is mounted once and never torn down. The framing
// below holds no clock; the list in src/ui/notifications.tsx owns that.
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
