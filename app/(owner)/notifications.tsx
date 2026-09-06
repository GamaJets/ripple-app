// Owner · Notifications.
//
// The owner app is the quiet one here, and the empty state says so honestly
// rather than implying something is broken. Nothing in the product currently
// addresses a notification TO a gym owner: the owner's own screens are the
// place operational facts appear, and the one push an owner sends — a
// promotion, from app/(owner)/promotions.tsx — goes out to members, not to
// themselves. What an owner does get is anything a coach in their gym sends
// them, which notify_users() permits through the `is_owner_of(profiles.tenant_id)`
// branch, and anything future work addresses to them.
//
// It ships anyway, and not as a placeholder. An owner who signs in on a shared
// device, or who is also a coach elsewhere, has an inbox; and an owner opening
// an empty one and being told plainly that nothing has been sent is a better
// answer than a screen that does not exist.
//
// Registered in app/(owner)/_layout.tsx as an href: null tab — reachable by
// route, absent from the bar. This comment used to ask for that line as work
// somebody else owned; the line is there and the ask outlived it.
import { NotificationInbox } from '../../src/ui/notifications';

export default function OwnerNotifications() {
  return (
    <NotificationInbox
      group="owner"
      kicker="Your inbox"
      title="Notifications"
      blurb="Anything sent to you directly. Your gym's numbers live on the dashboard."
      emptyTitle="Nothing has been sent to you"
      emptyNote="Offers you push go to your members, not here. This is where anything addressed to you personally arrives."
    />
  );
}
