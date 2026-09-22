# Which RepDB licence governs which asset in this repo

Two RepDB licences are in force here at once, and they are not the same
licence. Written down because the difference is invisible from the files: a
WebP from the free archive and a WebP from the Standard archive look identical
and are governed by different terms.

| What we ship | Came from | Governed by |
| --- | --- | --- |
| `data/repdb-exercises.json`, `data/exercise-catalogue.json` and the `exercises` table (608 rows) | Standard-tier archive, `exercises.json` | `repdb-LICENSE-standard-v1.2.md` |
| `assets/muscle-heatmap/` — 76 overlays, built by `scripts/build-muscle-heatmap.mjs` | Standard-tier archive, `images/muscles/` | `repdb-LICENSE-standard-v1.2.md` |
| Exercise stills and animations served to the apps | Standard-tier archive, `images/` | `repdb-LICENSE-standard-v1.2.md` |
| Anything still carried from the original free archive | Free-tier archive | `repdb-LICENSE.md` (Free Tier v1.0) |

`repdb-LICENSE.md` is kept rather than replaced: it is the licence the
catalogue arrived under, and term 2 there makes the visible credit a
CONDITION. Standard v1.2 downgrades attribution to a request. We render the
credit either way — see `src/ui/Attribution.tsx` — so nothing about the apps
changes, but the reason differs, and a future engineer deleting the credit
under the impression that Standard permits it would be right about the
Standard-tier assets and wrong about anything left from the free archive.

## The clause that is not settled

Standard v1.2, **Tier scope**:

> A product is "your own" when it is owned or controlled and operated by the
> licensee and offered under the licensee's brand. A multi-tenant service you
> operate under your own brand counts as your own product regardless of the
> number of customers. White-label builds, client projects, and deliveries
> under a third party's brand are not covered — contact us about Enterprise.

Repple's second axis is exactly that. `src/lib/brands.ts` says so in its own
words: "A gym chain buying Repple gets THEIR app, under THEIR name, in the
store — their own listing, their own bundle id, their own icon, their own
domain. Not a theme toggle inside one binary."

So the three Repple-branded apps are covered — a multi-tenant service under our
own brand is named as covered — and a gym-chain-branded build that ships the
catalogue or the artwork is not. Free Tier v1.0 has no equivalent carve-out; it
permits commercial use inside applications full stop, so the free archive was
in fact broader on this one point than the paid tier is.

Nothing in the apps is blocked by this today: no brand other than Repple has
shipped. It becomes a purchase decision the first time one does, and the
licence names the route — Enterprise, via support@repdb.co.

## Identification

Standard v1.2 asks the licensee to state the public Lemon Squeezy order number
on RepDB's reasonable request. That number is not in this repo and must not be:
the licence is explicit that the order UUID from the download link is a private
download credential.
