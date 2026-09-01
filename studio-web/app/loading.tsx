// What is on screen while a route's code is still arriving.
//
// Every page in this console already draws its own "Loading…" while its QUERIES
// are in flight. This covers the moment before that: the route's JavaScript is
// still downloading and the component that would say "Loading…" does not exist
// yet. Without this file Next shows the previous page frozen, or nothing.
//
// Deliberately the same two words and the same colour the pages use, so a slow
// network and a slow query look like one thing to the reader rather than two.
export default function Loading() {
  return <div style={{ padding: 40, color: 'var(--ink3)' }}>Loading…</div>;
}
