// What is on screen while a route's code is still arriving.
//
// Every page in this console already draws its own "Loading…" while its QUERIES
// are in flight. This covers the moment before that: the route's JavaScript is
// still downloading and the component that would say "Loading…" does not exist
// yet. Without this file Next shows the previous page frozen, or nothing.
//
// Deliberately the same two words and the same colour the pages use, so a slow
// network and a slow query look like one thing to the reader rather than two.
//
// ── why there is no live region on it ──────────────────────────────────────
//
// Every other "Loading…" in this console carries role="status"/aria-live, and
// this one was audited on the assumption that it had simply been missed. It
// had not. A live region announces a CHANGE to a region a screen reader has
// already registered, and this file is never a change: there is no `next/link`
// and no `useRouter` anywhere in the console — the rail is plain `<a href>`, so
// every navigation is a document load and this markup arrives in the initial
// HTML, read as ordinary page content. Marking it as a live region would
// announce nothing to anybody.
//
// What IS unannounced is the other end: when the segment streams in and
// replaces this, nothing tells a reader the screen arrived. That cannot be
// fixed from here — the region being announced would be the one going away —
// and it belongs to the arriving screen, which is where each page's own
// role="status" already sits.
export default function Loading() {
  return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
}
