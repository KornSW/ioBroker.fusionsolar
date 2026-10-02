---
name: iobroker-fusionsolar
description: Project knowledge for the ioBroker.fusionsolar adapter (Huawei FusionSolar northbound cloud API -> ioBroker states). Use for ANY work in this repository - code changes, bug fixes, new device types, API rate limit / quota questions, documentation, releases, and the enrollment into the official ioBroker repository (latest/stable, repochecker, review checklist). Contains condensed snapshots of the Huawei northbound API documentation and of the ioBroker quality requirements, plus the list of all knowledge sources.
license: MIT
metadata:
  author: KornSW
  last-reviewed: "2026-10-02"
---

# ioBroker.fusionsolar – project skill

This skill is the **maintained knowledge base** of this repository. Read it completely before changing anything,
and read the referenced files when the task touches their topic.

| Topic | File |
| --- | --- |
| Huawei FusionSolar northbound API (auth, session, rate limits, failCodes, device types, fields/units, account setup) - based on the official reference PDF | [references/huawei-northbound-api.md](references/huawei-northbound-api.md) |
| **Rate limits and throttling** (leading document, user + developer facing) | [doc/RATE-LIMITS.md](../../../doc/RATE-LIMITS.md) |
| **Dynamic data model**, `lib/model.json` format, learned model, diagnostic export, how the model grows | [doc/MODEL.md](../../../doc/MODEL.md) |
| **API account generations and Huawei platform changes** (5 turnovers 2022-2025, symptoms, adapter behaviour) | [doc/API-GENERATIONS.md](../../../doc/API-GENERATIONS.md) |
| Lessons learned from the Home Assistant integration (pitfalls, value conversions, rate limiting strategy, kiosk mode, source locations) | [references/ha-fusionsolar-insights.md](references/ha-fusionsolar-insights.md) |
| ioBroker quality requirements, repochecker rules, review checklist, enrollment process (latest -> stable) | [references/iobroker-requirements.md](references/iobroker-requirements.md) |
| Open findings / TODO list incl. the last repochecker result | [references/open-findings.md](references/open-findings.md) |
| All knowledge sources (URLs, what they contain, how reliable they are) | [references/sources.md](references/sources.md) |

## Goals and working agreements

- **Goal:** release the reworked adapter as **v2.0.0** and finally run the **official enrollment** into the ioBroker
  repository (first `latest`, after community testing `stable`). This is overdue for years - users already use the adapter
  (installed from npm / GitHub).
- The work is organized in **three levels** (tag every finding in `references/open-findings.md` with its level):
  1. **L1 – repository fit, deployment, debuggability** (tooling, tests, CI, release pipeline, local debugging, documentation base)
  2. **L2 – functional work** (API handling, features, dynamization, data model)
  3. **L3 – compliance** (repochecker / review rules for the enrollment)
- Work **step by step** along the user's TODO list. **Do not commit or push** until the user explicitly asks for it.
- The maintainer (KornSW) communicates in German. Answer in German; code, code comments, README and commit messages are English
  (exception: [doc/de/README.md](../../../doc/de/README.md) is the German user guide).
- Branch for the rework: `modernize-2026` (base `master`).

## Architecture

| File | Responsibility |
| --- | --- |
| `main.js` | adapter class `FusionSolarConnector`: config validation (`readConfig`), poll loop (`poll` -> `updateAll`), error backoff (`handlePollError`), object/state creation (`writeFields`, `ensureObject`) |
| `lib/fusionSolarApi.js` | `FusionSolarApi`: login/re-login, throttling (`throttle`), retries, batching (max 100 ids per call), error classification `FusionSolarApiError.kind` = `auth`/`quota`/`permission`/`api`/`network`/`invalidResponse` |
| `lib/model.json` | **well-known data model** (device types, fields, ids, roles, units, enums) - maintained, shipped, grows via diagnostic exports |
| `lib/model.js` | `DataModel`: resolves fields per response (known + inferred), learns per instance (`model/learned-model.json` in the instance file storage), remembers types without realtime support, anonymized diagnostic export (`model/diagnostic-export.json`, admin button via `sendTo` "diagnosticExport") |
| `lib/definitions.js` | non-model constants: update priority levels, `isDueForUpdate` |
| `lib/*.test.js` | mocha/chai unit tests with a fake http client (no network) |
| `admin/jsonConfig.json`, `admin/i18n/*.json` | admin UI (jsonConfig), 11 languages |
| `io-package.json` / `package.json` | metadata; `native` = default config |
| `README.md` (EN, required), `doc/de/README.md` (DE), `doc/DEVELOPMENT.md` | documentation |

Poll cycle: (re)load station + device list on start and every 24 h -> `getStationRealKpi` (all stations, 1 call)
-> `getDevRealKpi` once **per device type** (all due devices of that type in one call). Dongles (62) are never requested
(API returns no KPIs). Backoff after errors: `pollInterval * 2^(n-1)`, max 1 h; auth errors: 1 h.

## Hard rules

1. **State ids are a public API.** Users reference them in scripts/VIS. Never rename an `id` in `lib/model.json`
   (guarded by `lib/model.test.js` against `test/fixtures/legacy-state-ids.json` - extend the fixture when ids are added);
   the structure `<stationCode>.<deviceId>.kpi.realtime.<id>` must stay. Snake_case meter ids are kept on purpose.
2. **API call budget is the #1 stability factor** (official limits): `getDevRealKpi` and `getStationRealKpi` only
   `Roundup(n/100)` calls per 5 min (per device type / for all plants), plant list 24 per day, `getDevList`
   `Roundup(plants/100)+24` per day, login 5 per 10 min. Every new call in the poll cycle must be batched and justified.
   Default poll interval 300 s (minimum 60). Retrying a 407 inside the same 5-min window is useless.
   `getDevRealKpi` only accepts types 1, 10, 17, 38, 39, 41, 47 (+ 23070) - never request other types.
   **`doc/RATE-LIMITS.md` is the leading document** - whenever throttling, retries, backoff, batching or the poll cycle
   change, update its tables ("How the adapter throttles", "Known weaknesses") in the same change.
   Likewise update `doc/API-GENERATIONS.md` when account generation handling changes or Huawei changes the platform again.
3. **Only one login session per API account** - a new login invalidates the previous token. Never log in "just in case";
   re-login only on failCode 305 (and the related session codes, see open findings).
4. **No module-level mutable state** - the adapter runs in compact mode (several instances per process).
5. Timers only via `this.setTimeout`/`this.clearTimeout`/`this.delay` (cleared on unload, repochecker S5005/S5051).
6. Objects are written with `extendObject` once per run (`ensureObject`) so roles/units of old installations get fixed.
   Avoid `setObject` (S5054). Only fields present in the API response are created.
7. Roles must match the official role list **including the type** (e.g. `value.*` needs `type: number`, `value.gps.*`
   needs number, `indicator` needs boolean, `text` needs string, `level` must be writable). See requirements reference.
8. Plain JS with JSDoc types, type-checked by `npm run check`. ESLint uses `@iobroker/eslint-config`; the rule
   `jsdoc/check-tag-names` is set to `typed: false` in `eslint.config.mjs` - **never remove that**, otherwise
   `eslint --fix` deletes all `@typedef`/`@property`/`@type` annotations.
9. Never log the password or the XSRF token. Debug log may contain request bodies and responses.
10. Translations: edit `admin/i18n/en.json` (+ `de.json` by hand), then `npm run translate` for the other languages.
    io-package `news` are translated by the release script.
11. README rules (repochecker): exactly one `#` heading, `## Changelog` with `### **WORK IN PROGRESS**`, `## License` last,
    no install-from-GitHub/npm instructions, no German words in README.md.

## Commands

```bash
npm run test:js            # unit tests (lib/*.test.js)
npm run test:package       # package/io-package validation (@iobroker/testing)
npm run test:integration   # real js-controller in temp dir - needs local Node >= 22.19 (js-controller dev requires it)
npm run lint               # 0 errors required; JSDoc description warnings are tolerated
npm run check              # tsc type check
npm run translate          # i18n + io-package translations (Google translate via @iobroker/adapter-dev)
npm run test:kvu           # KVU self tests (needs Python 3.12; locally a portable "embeddable" Python works)
npx -y @iobroker/repochecker https://github.com/KornSW/ioBroker.fusionsolar --local --noinfo   # checks the LOCAL files
```

**Debugging:** VS Code launch configuration "ioBroker: Debug adapter (dev-server)" (F5) - pre-launch task starts
`dev-server watch --noStart` (js-controller + admin on http://127.0.0.1:8081), then `main.js` is started from the
workspace with `--debug 0`, cwd `.dev-server/default` and `NODE_PATH=.dev-server/default/node_modules` (adapter-core
resolves the js-controller relative to its own location - without NODE_PATH it is not found). One-time setup:
`npx dev-server setup --symlinks --adminPort 8081`. Details: doc/DEVELOPMENT.md "Debugging".

If local Node is < 22.19, run the integration test against the stable controller with a scratch mocha file:
`tests.integration(<repoPath>, { controllerVersion: 'latest' })`.

## Decision log (why things are as they are)

- **API generation `default` = auto**: tries gen-1 `getStationList` first (keeps the object structure of old installations),
  falls back to gen-2 `/stations` on failCode 401 / api error. Explicit `gen-1`/`gen-2` still possible. The Home Assistant
  integration uses exactly the same order. Official boundary: API users created **after 2022-06-30** cannot use legacy interfaces.
- **devTypeId 38** (residential inverter) uses the inverter definition - before v2 it was treated as unknown and skipped
  by default (likely cause of issue #14).
- **Battery `ch_discharge_power` unit = W** (was labelled kW before; likely issue #16).
- **Default poll interval 300 s** for new instances (Huawei refreshes realtime data every 5 min; the old 180 s default
  plus one call per device caused permanent 407 errors).
- `updatePriority` 0 = loaded once on the first cycle after start, then never (matches the old documentation).
- Station `capacity` has no unit (gen-1 delivers MW, gen-2 kWp).
- `skipUnknownDevices` default **false** since v2 (decided 2026-10-02): with the dynamic model unknown types are safe to
  load (one call per new type, unsupported types are detected and not requested again). Existing instances keep their
  stored value.
- Version **2.0.0** (breaking: Node >= 22, js-controller >= 6.0.11, admin >= 7.6.17, new admin UI).
- **Releases via KVU** (Korn Versioning Utility, `.kvu/`, generic edition of the maintainer's `WP-*` release.py) instead
  of `@alcalzone/release-script`: **one** workflow `test-and-release.yml` = standard ioBroker test half + "KVU HOOK"
  (`versioning` job: version from README `### **WORK IN PROGRESS**` / commit subjects "Breaking Change" / "New Feature" /
  "**MVP**", materialized into package.json, package-lock.json, io-package.json, README; commit `-> VERSIONING`; annotated
  tag; atomic push) + own `deploy` job (npm trusted publishing with provenance, GitHub release). Optional secret
  `KVU_DEPLOY_KEY` makes the tag push trigger a tag run (required by the repochecker for new adapters), otherwise the
  release is published inline. Accepted repochecker warnings: W3017 (own deploy steps), W0062 (no release-script).
  Every push creates a release: stable `x.y.z` on `master` ("mainBranch" in `.kvu/kvu.json`), **pre-release
  `x.y.z-<branch>.<n>`** on every other branch (npm dist-tag `next`, GitHub pre-release, README changelog untouched;
  `dependabot/*` excluded). Only stable tags are the boundary for the commit fallback.
  Changelog stays in README (mandatory, see requirements reference); `CHANGELOG_OLD.md` is deliberately ignored for now.
  Write change entries with the KVU keywords, e.g. `- (KornSW) **New Feature:** ...`.

## Maintaining this skill

- Update this skill whenever you learn something non-obvious about the API, ioBroker requirements or the project.
- Put new facts into the matching reference file with **source and date**; mark the reliability
  (`[official]`, `[community]`, `[ha]`, `[observed]`, `[assumption]`). Add every new source to `references/sources.md`.
- The official Huawei reference is not stored in this repo (copyright); its location is documented in
  `references/sources.md`. Re-read it (`pdftotext`) instead of guessing when an API detail is unclear.
- When comparing with the Home Assistant integration, record the analysed commit hash and update
  `references/ha-fusionsolar-insights.md`.
- After running the repochecker, replace the result in `references/open-findings.md` and tick off fixed items.
- Keep `SKILL.md` short (< 500 lines); details belong into `references/`.
