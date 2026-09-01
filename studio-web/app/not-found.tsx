// A URL that is not a screen.
//
// Reachable by a stale bookmark, a mistyped path, or — the case worth writing
// for — a link somewhere in this console that points at a route that was
// renamed. Next's default is an unstyled black-on-white page that looks like a
// different product, which is exactly the wrong impression at the moment
// somebody is already unsure whether they are signed in.
//
// It does NOT say "you do not have access". Every page here refuses a role with
// its own words, and a 404 that hints at permission would send an owner looking
// for a setting that does not exist.
export default function NotFound() {
  return (
    <div style={{ padding: 40, maxWidth: '62ch' }}>
      <h1>No such screen</h1>
      <p style={{ color: 'var(--ink2)', marginTop: 10 }}>
        That address is not part of this console. It may have been renamed since the link was made.
        Nothing is wrong with your account or your gym — the screens your role can reach are in the
        menu on the <a href="/" style={{ color: 'var(--brand)' }}>Overview</a>.
      </p>
    </div>
  );
}
