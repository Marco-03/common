# QA Hub retests

The Hub is an internal Node service behind the existing authenticated portal.
It persists the shared retest list and submission history in `hub_data`.
The browser never receives Jenkins credentials or downloads a payload.

Production submissions use the existing Jenkins administrator secret and CSRF
crumb/session to enqueue `livelabs-qa-engine`. The service reloads each selected
item from its saved report; client-supplied command paths are not trusted.
`RETEST_SELECTION` selects only those saved test names and files. Retests write
to `/var/qa-reports/retest`, separately from full and sample regression runs.
New builds queue instead of aborting an existing engine build.

## Local preview

From `qa-automation`:

```powershell
npm run preview:report
node scripts/hub-server.mjs --preview
```

Open `http://127.0.0.1:4175/`. The shared list persists locally, but submissions
are explicitly simulated and never contact Jenkins. Example labs are local
fixtures, not claims about current public workshops. Browser verification:

```powershell
node scripts/verify-hub-preview.mjs
```

## Deployment gate

No deployment is performed by preview commands. After owner approval, deploy
the reviewed repository revision with the usual VM start script (it rebuilds
the Hub, portal, and Jenkins configuration). Do not mix an old Jenkinsfile with
the new Hub; it must accept `RETEST_SELECTION` and publish the `retest` channel.

Before opening retests to operators, submit one small selected-item retest and
verify its Jenkins queue/build ID, selected test count, saved report, and
separation from full-run history. This live acceptance check is still required;
local tests cover the Jenkins request contract with a simulated server.

The Hub does not mark issues resolved, compare runs, or change schedules.
Rollback uses the previously deployed source revision and container rebuild;
keep the report and `hub_data` volumes, which contain operator history.
