# Sentry

Crash and error reporting for the three apps (client, coach, owner).

- Org `repple-jo`, EU region. API base: `https://de.sentry.io/api/0/organizations/repple-jo/`.
- Environments are the EAS channels (`production`, `coach-production`, `owner-production`, previews); the `app_variant` tag says which app.
- Client setup: `src/lib/sentry.ts` (`initSentry`, `captureToSentry`). `src/lib/reportError.ts` sends every reported error there, with the context string as the `context` tag (the grouping key).
- Filtered before send: `AuthRetryableFetchError` with a network-shaped message (`isTransientAuthFetch`). Real auth failures are still sent.
- Non-Error values (PostgrestError and similar) are described by `describeThrown` as message, code, details and hint.
- `extra.level: 'warning'` on a `reportError` call files it as a warning.

## API tokens

- **Issue read/write token** (look up, read events, resolve issues): `~/.config/repple/sentry_issues_token` on the shared agent box, chmod 600. Send it as `Authorization: Bearer $(cat ~/.config/repple/sentry_issues_token)`. Never print it or commit it.
- `SENTRY_AUTH_TOKEN` in the box environment does not have org or issue scope (403 on every org endpoint). It is for source-map upload only.

Example (resolve an issue):

```sh
curl -s -X PUT -H "Authorization: Bearer $(cat ~/.config/repple/sentry_issues_token)" \
  -H 'Content-Type: application/json' -d '{"status":"resolved"}' \
  https://de.sentry.io/api/0/organizations/repple-jo/issues/<id>/
```
