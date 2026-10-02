# Development

## Project structure

| File | Purpose |
| --- | --- |
| `main.js` | the adapter: configuration, poll loop, error handling / backoff, creation of objects and states |
| `lib/fusionSolarApi.js` | client for the FusionSolar northbound API: login / re-login, throttling, retries, batching, error classification (`FusionSolarApiError.kind`) |
| `lib/definitions.js` | data driven definitions of all states (API field -> state id, type, role, unit) and of the known device types |
| `lib/*.test.js` | unit tests (mocha / chai), run with `npm run test:js` |
| `admin/jsonConfig.json` | admin user interface (jsonConfig), texts in `admin/i18n/*.json` |
| `io-package.json` | adapter metadata and default configuration (`native`) |

## Rules

- **The state ids are a public interface.** Users reference them in scripts and visualizations.
  Never rename an `id` in `lib/definitions.js` - add new fields instead.
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
- `.agents/skills/iobroker-fusionsolar/` - project knowledge base for AI agents (API reference snapshot, ioBroker
  requirements, open findings, sources).

## Adding a device type

1. Add the field definitions (`*_KPI_FIELDS`) to `lib/definitions.js` - take the field names from the API documentation.
2. Register the type in `DEVICE_TYPES` with its `devTypeId`.
3. Add a test to `lib/definitions.test.js` and document the type in both READMEs.

Until a type is defined, users can get all of its values by disabling _Skip devices of unknown type_ (generic states).

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

For manual tests with a real ioBroker installation use [dev-server](https://github.com/ioBroker/dev-server)
(`npx @iobroker/dev-server setup` once, then `npx @iobroker/dev-server watch`).

## Releasing

Releases are created with the [release-script](https://github.com/AlCalzone/release-script):

1. Document the changes in `README.md` below `### **WORK IN PROGRESS**`
2. Run `npm run release major|minor|patch` (it updates the versions, translates the news, commits and tags)
3. The GitHub workflow `test-and-release.yml` runs the tests. To publish to npm automatically,
   set up [trusted publishing](https://docs.npmjs.com/trusted-publishers) and enable the `deploy` job in the workflow.

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
