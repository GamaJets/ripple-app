# Over-the-air updates (EAS Update)

One EAS project (`@repple/repple`) serves all three apps. **Each build profile has its own channel**, and each channel points at the branch with the same name. An update published for one app never reaches another app's binary.

| Build profile | App | Channel → branch |
|---|---|---|
| `production` | Repple (client) | `production` |
| `production-coach` | Repple Coach | `coach-production` |
| `production-owner` | Repple Studio | `owner-production` |
| `preview` | Repple (client) | `preview` |
| `preview-coach` | Repple Coach | `coach-preview` |
| `preview-owner` | Repple Studio | `owner-preview` |
| `development` | Repple (client) | `development` |
| `development-coach` | Repple Coach | `coach-development` |
| `development-owner` | Repple Studio | `owner-development` |
| `sim-coach` | Repple Coach (simulator) | `coach-production` (deliberate: a simulator build that tracks the live coach app) |
| `production-example*` | white-label example brand | `example-*` |

Until 16 Oct 2026 `development-coach` and `development-owner` shared `development` with the client. That meant a client update published to `development` would load in a Coach or Studio dev build. Each now has its own channel. EAS creates the channel the first time a build uses it; if it doesn't, create it with `eas channel:create coach-development` (or `owner-development`).

## Runtime version

`app.json` → `"runtimeVersion": { "policy": "appVersion" }`. An update reaches only binaries whose app `version` matches. **Any native change (a new native module, a config plugin, a permission) needs a version bump and a new build**, never an OTA. That rule is enforced, not just documented:
- `check:native` refuses a native dependency the shipped binaries don't contain.
- `check:version-bump` refuses an update over a runtime whose native fingerprint has moved.
- `check:runtime-reach` refuses to publish to a channel that has no installed binary on that runtime.

`appVersion` was chosen over `fingerprint` because the store version and the runtime then stay the same number, and the three gates above cover the case `fingerprint` exists for.

## Publishing

Always use `scripts/publish.sh "message" [channel ...]`, never a bare `eas update`. It refuses a dirty tree (EAS bundles the working tree, not HEAD), runs `check:all`, and publishes to the six store channels by default, or only to the channels named.

## Rolling back

Republish the previous update group to the branch with `eas update:republish --group <id>`, or point the channel back with `eas channel:edit <channel> --branch <branch>`. Both are server-side and take effect on each app's next launch.
