// One vocabulary for the question every provider in this folder was unable to
// answer: can the thing it is showing you actually be trusted?
//
// All of these providers degrade when the server cannot be reached — to an empty
// list, to an in-memory map, to a cached copy — and that degrading is correct.
// The app is used in gyms with no signal and has to keep working there. The bug
// that kept recurring is not the fallback, it is that the fallback was
// indistinguishable from the real answer: `log: []` was returned identically for
// "you have never logged a workout" and "the row-level-security policy refused
// the read", and every screen downstream stated the first as a fact about the
// user's own history.
//
// So each provider now says which one it is:
//
//   'loading' — the first read is still in flight. Nothing is known yet.
//   'ready'   — the server answered. An empty list under 'ready' is genuinely
//               empty, and a screen may say so.
//   'error'   — the server did not answer, or refused. An empty list under
//               'error' means UNKNOWN, and a non-empty one is whatever we had
//               before the failure (cached, optimistic, or seeded) and is not
//               confirmed current.
//
// 'ready' is a claim about the server, not about the data. When the backend is
// switched off entirely (USE_SUPABASE false) the local store IS the source of
// truth, so that case is 'ready' too — there is no absent server to misreport.
//
// Screens may ignore this and nothing breaks: the data itself is unchanged and
// every existing call signature still means what it meant. But a screen about to
// render "No workouts yet", "Your coach hasn't sent anything", or "0 clients"
// should check first, because under 'error' it is asserting something it does
// not know.
export type LoadStatus = 'loading' | 'ready' | 'error';
