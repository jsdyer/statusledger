# Status Ledger

A standalone CoolCode browser application that retains official GitHub and DigitalOcean incident and maintenance statements, and compares dated collections. [Open Status Ledger](https://coolcode.ca/statusledger/).

<!-- coolcode:guide -->
Choose a provider, component, incident or maintenance state, or event date range, then inspect a report’s original update timeline. The two provider cards show the different feed windows; their incident counts are not a reliability ranking. Choose two retained captures to find newly observed records, changed text and records no longer present. The first capture establishes a baseline: earlier dates in an incident timeline are provider-supplied history, not earlier CoolCode captures. Download a filtered CSV or the complete selected capture JSON. Daily collection keeps the latest 90 successful captures; disappearance from a feed never implies resolution.
<!-- /coolcode:guide -->

## Sources and interpretation

Public, unauthenticated APIs documented by [GitHub Status](https://www.githubstatus.com/api) and [DigitalOcean Status](https://status.digitalocean.com/api):

- `/api/v2/summary.json`: aggregate status, current components, unresolved incidents and upcoming/in-progress maintenance.
- `/api/v2/incidents.json`: the provider’s recent incident window (GitHub currently returns 50 records).
- `/api/v2/scheduled-maintenances.json`: maintenance window, including completed records when supplied.

The initial DigitalOcean capture used its first-party Statuspage host, `w4cz49tckxhp.statuspage.io`, because the build environment could not access its custom domain. The page ID and publisher are the same; each stored source URL records the actual retrieval location. Scheduled collection uses `status.digitalocean.com`.

No independent probes run. Incident counts are **not uptime measurements or a ranking**. Products, regions, component hierarchies, source windows and reporting practices differ. A quiet feed cannot prove uninterrupted service. `resolved` and `completed` are closed only when explicitly reported; an event absent from a later feed is labelled **not present later**, not resolved.

Each capture includes normalized event text, provider statuses and components; per-endpoint retrieval time, byte count and SHA-256 of the original response. The checksum identifies the original response bytes; it is not the checksum of the normalized download. Unneeded provider delivery and internal metadata are omitted. Provider-supplied narratives are rendered as text, not executable markup. Common provider HTML line breaks, paragraph tags and character entities are converted to readable display text; the original narrative string remains unchanged in retained captures and JSON exports.

### Dates and history

- **Collection time:** after all six API responses were retrieved. They are not an instantaneous measurement; endpoint retrieval times are retained separately.
- **Event date:** incident `started_at`, falling back to `created_at`; maintenance `scheduled_for`, falling back to creation.
- **Provider updated:** source `updated_at`; update timeline uses `display_at`, falling back to update creation.
- **Capture comparisons:** provider + record kind + record ID, with update IDs used to count new/edited/missing narratives. Earlier and later text can be inspected. Component state changes are also shown.
- All displayed times are UTC. The earliest retained capture begins our observation history. Old incident dates do not establish a past snapshot.
- Retention is **90 successful captures**, normally about 90 days. Manual captures count toward the limit. Download a capture if you need it longer. Source feed limits can prevent observation of short-lived reports between captures; this is not a complete provider archive.

## Privacy and operation

No key or registration is required. The browser fetches bundled JSON from this site; filters stay in memory and are not retained. It does not query the providers on each visitor search. Following an official report link visits that provider. CoolCode’s standard visit counter loads on the hosted tool. JSON/CSV exports are created locally and contain public provider statements.

The scheduled GitHub Actions workflow collects once per day at 13:17 UTC. A manual **Run workflow** can refresh immediately. Schedules may be delayed by GitHub; collection freshness is displayed and captures older than two days are flagged. There is no visitor-triggered scanning or personal alert email service.

The collector validates all six responses and both provider records before staging a new capture and index. A failed fetch or invalid response leaves the last good deployment and data unchanged. Tests, offline build and browser smoke run before a successful refresh is committed and published. Captures are committed to this repository; deployment artifacts alone are not the archive.

## Development

Python 3.12+ and Node.js 24; application has no third-party runtime dependencies.

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

The default build is offline. To explicitly collect real source data:

```sh
python3 scripts/collect.py
```

CI browser checks use `tests/browser-requirements.txt` and run `python3 tests/browser_smoke.py`. They exercise the app under a repository subpath, filters, report details, export and mobile layout. Keep application code in `web/`, pure transformations in `web/model.mjs`, collection/build code in `scripts/`, and do not commit `dist/`.

<!-- schedule-reliability -->
## Schedule reliability

Public GitHub repositories can have scheduled workflows disabled after 60 days of inactivity. A separate weekly [schedule guard](.github/workflows/schedule-guard.yml) calls GitHub's enable-workflow API for an explicit list of refresh workflows and itself. It can restore workflows disabled for inactivity, preserves manually disabled workflows, and runs independently of collection failures.

This is an interim mitigation, not a scheduling guarantee: GitHub does not document active-workflow renewal as a permanent exemption, and scheduled runs can be delayed or dropped. A scheduler on our own Linux server is the planned independent trigger. The guard does not collect data, create dummy commits, or change source/check timestamps; successful collection and published data freshness still need monitoring.
<!-- /schedule-reliability -->
