# Open findings / TODO

Status: **2026-10-02**, branch `modernize-2026` (uncommitted). Tick items off (`[x]`) when fixed and keep the list current.

Work is organized in three levels (agreed with the maintainer):
- **L1 – repository fit, deployment, debuggability:** builds, tests, CI, release/deploy pipeline, local debugging (dev-server), documentation base.
- **L2 – functional work:** API handling, new features, dynamization, data model improvements.
- **L3 – compliance:** everything required by the repochecker / review for the official enrollment (latest -> stable).

## L1 – repository fit, deployment, debuggability

- [x] Dependencies, tooling (eslint 9 / prettier / tsc / @iobroker/testing 6), jsonConfig admin UI, unit tests, README/doc rework, project skill.
- [x] Dedicated docs: `doc/RATE-LIMITS.md` (leading doc for limits/throttling), `doc/API-GENERATIONS.md` (5 platform turnovers), linked from both READMEs.
- [x] Workflow `test-and-release.yml`: check@v2, `needs`, node 22/24/26, single workflow with KVU HOOK (`versioning` +
      own `deploy` with trusted publishing); `.releaseconfig.json` and release-script removed; KVU in `.kvu/` with unit tests.
- [ ] npm **trusted publishing** for `iobroker.fusionsolar` (npm settings -> trusted publisher: GitHub `KornSW/ioBroker.fusionsolar`,
      workflow `test-and-release.yml`) -> signed provenance (E2008). **Must be set up before the first push that releases.**
- [ ] Repository secret `KVU_DEPLOY_KEY` (SSH deploy key with write access) -> tag-triggered release runs (repochecker W3032 for new adapters).
- [x] Decided (2026-10-02): release on every push; other branches create pre-releases `x.y.z-<branch>.<n>` (dist-tag `next`).
- [ ] KVU: `io-package.json` `common.news` for the new version incl. translations (E1036/E1045/E1144) - ioBroker specific
      extension (e.g. hook that runs `translate-adapter` after KVU) - needed before the enrollment.
- [ ] ~~KVU: rotate old README changelog entries into `CHANGELOG_OLD.md`~~ - deliberately ignored for now (maintainer decision 2026-10-02; only a warning).
- [ ] Original WP KVU: also reads/writes with `read_text()`/`write_text()` (CRLF lost on Windows) - fixed in the generic edition only.
- [ ] Local debugging: set up `@iobroker/dev-server` (`npx @iobroker/dev-server setup`, then `watch`), document a VS Code
      launch configuration; old `.dev-server` folder from 2024 can be deleted.
- [ ] Local Node 22.15.1 is too old for the integration test with js-controller dev (needs >= 22.19) -> update Node locally.
- [x] `.gitignore`: add `.commitinfo` (E9006) and `dist/` (KVU output).
- [ ] dependabot: `cooldown: { default: 7 }` (E8915), ignore major `@types/node` (E8917); optional: random cron, limit 15, automerge workflow.
- [ ] Clean up old `iobroker.fusionsolar-*.tgz` files in the repo root (ignored, local only).
- [ ] 67 ESLint JSDoc warnings (missing param descriptions) - cosmetic.

## L2 – functional work (API handling, features)

### Account generation strategies (refactoring) - high priority

The account generations caused a lot of confusion in the community (see `doc/API-GENERATIONS.md`: 5 turnovers 2022-2025).
Today the switch `apiVersion` (`default`/`gen-1`/`gen-2`) only selects the plant list interface via `if` branches in
`lib/fusionSolarApi.js` (`getStations`, `getStationsGen1`, `getStationsGen2`) and `main.js` (`stationCode ?? plantCode`).

- [ ] Separate the generation specific behaviour into **strategy classes in separate files**, e.g.
      `lib/accounts/legacyAccount.js` (created <= 2022-06-30: `getStationList`, original limits),
      `lib/accounts/currentAccount.js` (created > 2022-06-30: paged `stations`, resource based limits),
      later optionally `lib/accounts/oauthApp.js` (OAuth Connect: bearer token + refresh, owner authorization).
      Common interface (sketch): `authenticate()`, `getStations()` -> normalized station model
      `{ code, name, address, capacityKwp, raw }`, `getRateLimitPolicy()` (limits per interface, used by the throttling),
      `describe()` (log/UI text). A small `detectAccountStrategy()` replaces today's auto detection.
- [ ] Keep the shared HTTP/session/error handling in one transport class (`FusionSolarApi` today) - strategies only contain
      what differs (avoid duplicating retry/throttle code).
- [ ] Normalization must keep the existing state ids of both generations (`stationName` vs. `plantName`, ...), i.e. the
      strategy delivers the raw fields for the info states plus the normalized model for the adapter logic.
- [ ] Rename the setting values in the UI to "legacy account (created until 30.06.2022)" / "current account (created after
      30.06.2022)" while keeping the stored values `gen-1`/`gen-2`; fix the "08/2022" labels in `admin/jsonConfig.json` +
      `admin/i18n/*.json` (re-run `npm run translate`).
- [ ] Log the detected strategy once on start in plain words (incl. a link to `doc/API-GENERATIONS.md`).
- [ ] Unit tests per strategy (fake http client) incl. detection order and 401/20056 handling.
- [ ] **failCode 20056** (owner authorization missing, since 2025-09): dedicated error with a clear hint ("the plant owner
      must enable API Access in the FusionSolar app"); must not trigger the generation fallback endlessly.
- [ ] Evaluate **OAuth Connect** (needs a registered OAuth client at Huawei + redirect URL, e.g. via ioBroker cloud) -
      would let owners connect without an installer-created API account.

API robustness (sources: official reference + HA analysis):
- [ ] **407 retry redesign:** quick retries (seconds) inside the 5-min window are useless and burn quota. Options: no retry on 407,
      skip the current cycle and continue in the next window; keep retries only for HTTP 403 gateway quota / 20200 "system busy".
      The config option `apiRetry` must be re-thought (maybe remove or redefine).
- [ ] **Whitelist for `getDevRealKpi`:** only types 1, 10, 17, 38, 39, 41, 47, 23070. Today optimizers (46) and unknown types are
      requested when the user enables them -> failCode 20013 -> **the whole cycle fails**. Also isolate errors per device type
      (one failing type must not stop the others).
- [ ] Handle **306/307** like 305 (re-login).
- [ ] Classify failCodes precisely: 20400/20403/20001-20003/30029 = auth (20003: "API account expired" hint),
      20200/20004 = temporary (retry next cycle), 20618 = daily quota (long backoff), 20007/20008 = resource not authorized.
- [ ] Consider spreading device-type calls over the 5-min window (HA: one type per tick) instead of a burst per cycle.
- [ ] Warn in the log / UI if the poll interval is below 300 s (official policy allows 1 call per 5 min).
- [ ] Forum report (2025-05, PinkElektroTechnik): "active power is not shown below 1 kW" - verify (rounding of kW values? API delivers kW with decimals).
- [ ] Keep `doc/RATE-LIMITS.md` ("Known weaknesses") in sync when fixing these items.
- [ ] Session: single online session per account -> README hint "one API account per system"; detect token invalidation
      (305 right after login) and log a clear warning ("account is used by another system").

Data model (keep existing ids!):
- [ ] Type dependent units: grid meter (17) and EMMA `active_power` in **kW**, power sensor (47) in **W** -> separate
      definitions per type instead of one meter definition.
- [ ] `battery_soh`: remove the `%` unit (official: no unit).
- [ ] `openTime`/`closeTime`: ms timestamps (or `"N/A"`) -> number state with role `date`/`value.time`, skip `"N/A"`.
- [ ] `common.states` for `inverter_state` (Table 6-1) and `ch_discharge_model` (0-12), `real_health_state` already done.
- [ ] Station `latitude`/`longitude` (gen-2) as number.
- [ ] "Midnight glitch" for lifetime counters (`totalPower`, `totalCap`): ignore implausible drops / only update while producing (HA approach).
- [ ] New device definitions: 10 EMI, 17 grid meter, 41 ESS, 23070 EMMA (fields + units in the API reference).
- [ ] Generic fields for unknown types: role `text` for strings instead of `state`.

Features / ideas:
- [ ] **Kiosk mode** (public kiosk URL, no API account) as alternative data source - see HA insights.
- [ ] Year yield (`getKpiStationYear`, hourly).
- [ ] #17 optimizers: the realtime interface does not support type 46 -> only possible via other interfaces (check `getDevHistoryKpi` / not supported) - answer the issue accordingly.
- [ ] #18 wallbox: unknown devTypeId, needs sample data from a user.
- [x] README/doc: generation boundary is **30.06.2022** (not "08/2022") - UI labels: see strategy refactoring above.

## L3 – compliance (repochecker / review)

Repochecker local run (5.22.9, `npx -y @iobroker/repochecker https://github.com/KornSW/ioBroker.fusionsolar --local --noinfo`):
- [ ] **E1057** admin `>=7.4.10` -> **`>=7.6.17`** in `io-package.json` (+ README/doc requirements).
- [ ] **E4050 / E4051** copyright line in README and LICENSE needs an email (`Copyright (c) 2022-2026 KornSW <...>`) - ask the maintainer for the address.
- [ ] **E6013** remove the install-from-GitHub `<details>` block from README.md.
- [x] E3012 / E3014 / E3025 / W3028 / E9006 fixed (repochecker local run after the KVU workflow: gone).
- [ ] E2008 (provenance, after the first trusted publishing release), E8915 / E8917 (dependabot) -> see L1.
- [ ] Accepted warnings: W3017 (own deploy steps instead of `ioBroker/testing-action-deploy`), W0062 (no release-script).
- [ ] W3039 (no workflow runs), W4001 (not in latest) resolve themselves; W6020 `CHANGELOG_OLD.md` optional; S4038 `.vscode/settings.json` schemas optional.

Found by research / manual review (not reported by the local check):
- [ ] Roles vs. types: `openTime`/`closeTime` role `value` with type `mixed`; station `latitude`/`longitude` type string with role `value.gps.*` (see L2).
- [ ] jsonConfig **E5507**: `_headerAccount`, `_accountHint`, `_headerPolling`, `_headerDevices` need `xs..xl` sizes.
- [ ] **E6015 risk:** README "Deutsche Anleitung" -> "German documentation".

## Functional backlog (GitHub issues)

- [ ] #23 add adapter to repositories (= enrollment, L3).
- [ ] #21 / #19 "Cannot read properties of null (reading '0')" - fixed in v2 (verify with real account, then close).
- [ ] #16 battery power unit - fixed in v2 (W), verify and close.
- [ ] #14 missing data points - likely fixed by devTypeId 38 support, verify.
- [ ] #13 "Undefined [KornSW]" in GitHub install dialog - obsolete after enrollment.
- [ ] #17 optimizers, #18 wallbox - see L2.

## Release / enrollment steps (after L1-L3)

1. All tests + repochecker (local) -> 0 errors.
2. Test with real API accounts (dev-server), ideally old (<= 30.06.2022) and new accounts.
3. Commit, PR `modernize-2026` -> `master`, CI green on all OS / node versions.
4. Trusted publishing, `npm run release major` -> 2.0.0 (tag triggers deploy).
5. Forum: announce beta / ask for testers.
6. iobroker.dev -> ADD TO LATEST (or PR to ioBroker.repositories via `npm run addToLatest`), answer review.
7. After feedback: add to stable.
