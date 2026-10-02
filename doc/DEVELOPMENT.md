# Development

## Project structure

| File | Purpose |
| --- | --- |
| `main.js` | the adapter: configuration, poll loop, error handling / backoff, creation of objects and states |
| `lib/fusionSolarApi.js` | client for the FusionSolar northbound API: login / re-login, throttling, retries, batching, error classification (`FusionSolarApiError.kind`) |
| `lib/model.json` | **the well-known data model**: device types, fields, state ids, roles, units, enum texts (see [MODEL.md](MODEL.md)) |
| `lib/model.js` | dynamic model: loads `model.json`, resolves / infers fields, learns at runtime, diagnostic export |
| `lib/definitions.js` | adapter constants that are not part of the model (update priority levels) |
| `lib/*.test.js` | unit tests (mocha / chai), run with `npm run test:js` |
| `test/fixtures/legacy-state-ids.json` | all state ids of the previous versions - `lib/model.test.js` fails if one gets lost |
| `admin/jsonConfig.json` | admin user interface (jsonConfig), texts in `admin/i18n/*.json` |
| `io-package.json` | adapter metadata and default configuration (`native`) |

## Rules

- **The state ids are a public interface.** Users reference them in scripts and visualizations.
  Never rename an `id` in `lib/model.json` - add new fields instead (guarded by `lib/model.test.js`).
- Objects are written with `extendObject` once per adapter run (see `ensureObject`), so changed roles / units
  are applied to existing installations automatically.
- Only fields contained in the API response are created as states (`null` / `undefined` values are skipped).
- Keep the number of API calls as low as possible - the API is strictly rate limited
  (see the API documentation below). Never add a call to the poll cycle without batching.
- All instance state lives in the adapter instance (no module level variables), because the adapter supports the compact mode.

## Related documents

- [RATE-LIMITS.md](RATE-LIMITS.md) - **leading document** for API limits and the adapter's throttling. Update it together
  with any change of the poll cycle, batching, retries or backoff.
- [API-GENERATIONS.md](API-GENERATIONS.md) - API account generations and Huawei platform changes (2022-2025).
- [MODEL.md](MODEL.md) - **leading document** for the dynamic data model, `model.json` and the diagnostic export.
- `.agents/skills/iobroker-fusionsolar/` - project knowledge base for AI agents (API reference snapshot, ioBroker
  requirements, open findings, sources).

## Adding a device type

See [MODEL.md](MODEL.md) "Adding a field / device type from a diagnostic export": add a `deviceTypes` entry and a
`fieldSets` entry to `lib/model.json`, update `modelVersion`, run `npm run test:js`, document the type in both READMEs.

Until a type is defined, users get all of its values generically by disabling _Skip devices of unknown type_.

## Commands

```bash
npm install
npm run test:js         # unit tests
npm run test:package    # validates package.json / io-package.json
npm run test:integration # starts the adapter in a temporary ioBroker installation
npm run lint            # eslint + prettier (@iobroker/eslint-config)
npm run check           # type checking via tsc (JSDoc types)
npm run translate       # translates io-package.json news/desc and admin/i18n/en.json into all languages
```

> [!NOTE]
> `test:integration` installs the `dev` version of the js-controller, which needs a recent Node.js 22 (>= 22.19).

## Debugging (VS Code + ioBroker dev-server)

The repository contains a ready-to-use VS Code configuration (`.vscode/launch.json`, `.vscode/tasks.json`) based on
[@iobroker/dev-server](https://github.com/ioBroker/dev-server) (devDependency).

1. **Once:** run the task _dev-server: setup (once)_ (Terminal > Run Task) or `npx dev-server setup --symlinks --adminPort 8081`.
   It installs js-controller + admin into `.dev-server/default` (git-ignored) and links this repository as adapter
   `fusionsolar` (symlinks, no packing needed after code changes).
2. **Debug:** select **"ioBroker: Debug adapter (dev-server)"** in _Run and Debug_ and press **F5**.
   - The task _dev-server: start (without adapter)_ starts js-controller + admin in the background
     (admin: http://127.0.0.1:8081, the admin folder is served with live reload by Browsersync).
     VS Code waits until the dev-server is ready (problem matcher in `.vscode/tasks.json`), then the default browser
     opens the configuration page of `fusionsolar.0` (task _ioBroker: open admin in browser_).
   - The debugger then starts the instance `fusionsolar.0` **directly from the workspace sources** - breakpoints in
     `main.js` and `lib/*.js` work. `NODE_PATH` points to `.dev-server/default/node_modules` so that
     `@iobroker/adapter-core` finds the js-controller.
   - Configure the instance (API credentials) in the admin UI, then restart the debug session.
   - The message "adapter disabled" is expected: the instance stays disabled in the dev-server so that the
     js-controller does not start a second copy; the debugger starts it with `--debug`.
3. Stopping the debug session stops only the adapter; the dev-server keeps running (stop it via _Terminate Task_).

Alternatives:
- Task _dev-server: watch (adapter auto-restart)_: dev-server starts the adapter itself and restarts it on code changes (no debugger).
- `npx dev-server debug --wait` + launch configuration **"ioBroker: Attach to adapter (port 9229)"**.

Notes: the dev-server data (objects, states, instance config) lives in `.dev-server/default/iobroker-data`. On Windows 11
the js-controller logs "Cannot read disk size ... wmic" - harmless.

## Releasing

Releases are created **automatically on every push** by KVU - stable versions on `master`, pre-releases
`x.y.z-<branch>.<n>` (npm dist-tag `next`) on all other branches - (Korn Versioning Utility, see
[.kvu/README.md](../.kvu/README.md)) - there is no manual release step and no `release-script`.

1. Document the changes in `README.md` below `### **WORK IN PROGRESS**` (or write meaningful commit subjects).
   Use `Breaking Change` / `New Feature` in an entry to get a major / minor version, otherwise a patch version is created.
2. Push to `master`. The workflow `test-and-release.yml` runs the tests, then KVU calculates the version, writes it to
   `package.json`, `package-lock.json`, `io-package.json` and the README changelog, commits `<subject> -> VERSIONING`,
   tags `vX.Y.Z` and the `deploy` job publishes to npm (trusted publishing with provenance) and creates the GitHub release.

One-time setup:
- npm: configure a [trusted publisher](https://docs.npmjs.com/trusted-publishers) for `iobroker.fusionsolar`
  (GitHub repository `KornSW/ioBroker.fusionsolar`, workflow `test-and-release.yml`).
- GitHub (recommended): an SSH **deploy key with write access** stored as repository secret `KVU_DEPLOY_KEY`, so that the
  tag push triggers its own workflow run (required by the ioBroker repository checker for new adapters).
- Branch protection on `master` must allow the push of the `VERSIONING` commit (deploy key / GitHub Actions).

## API documentation

The adapter uses the "basic" interfaces of the northbound API (`/thirdData/...`):

| Interface | Used for |
| --- | --- |
| `login` | login, returns the `XSRF-TOKEN` (header and cookie) |
| `getStationList` (gen-1) / `stations` (gen-2, paged) | station (plant) list |
| `getDevList` | devices of the stations (comma separated `stationCodes`) |
| `getStationRealKpi` | realtime KPIs of the stations (comma separated `stationCodes`) |
| `getDevRealKpi` | realtime KPIs of devices of **one** type (comma separated `devIds`, `devTypeId`) |

Important `failCode` values: `305` re-login required, `401` no permission for the interface, `407` access frequency too high.
HTTP 403 means that the request was rejected by the quota control of the API gateway.

The official documentation ("SmartPVMS / FusionSolar Northbound Interface Reference") is available in the
Huawei support portal.
