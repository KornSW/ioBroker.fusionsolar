# ioBroker quality requirements and enrollment – condensed snapshot

Snapshot date: **2026-10-02** (repochecker 5.22.9). Sources: see [sources.md](sources.md).
The **repochecker is the authoritative, executable form** of the rules - when in doubt, run it (see SKILL.md).
Where the prose README of `ioBroker.repositories` contradicts the repochecker (e.g. `common.title`), follow the repochecker.

## Enrollment process

### 1. `latest` (beta) repository
Requirements (ioBroker.repositories README, condensed):
1. GitHub repo `ioBroker.<name>` (capital B), npm package `iobroker.<name>` (lowercase); repo has **topics** and a description.
2. Title without "ioBroker"/"Adapter"; `common.titleLang` with translations (`common.title` is deprecated by the repochecker).
3. `README.md` in English: description/manufacturer link, details, `## Changelog`, `## License`.
4. Predefined license (MIT here) - `LICENSE` file and README license section.
5. No unused `www`, `widgets`, `docs` dirs, no `admin/tab_m.html`/`custom_m.html` (our `doc/` is fine - it is linked).
6. GitHub Actions with at least package + integration tests (`test-and-release.yml`).
7. `common.type` from the official type list (here `energy`); `connectionType` (`cloud`) and `dataSource` (`poll`).
8. All states use **valid roles** (no generic roles where a specific one exists).
9. `authors` in io-package, `author` in package.json.
10. Published on **npm**; **`bluefox` must be npm owner** (`npm owner add bluefox iobroker.fusionsolar`) - already done.
11. Admin config dialog (jsonConfig).
12. Port settings must be named `port` (not applicable).

How to add (two ways):
- Web: https://www.iobroker.dev -> login with GitHub -> adapter -> _manage_ -> **ADD TO LATEST**.
- CLI: fork `ioBroker/ioBroker.repositories`, `npm i`, `npm run addToLatest -- --name fusionsolar --type energy`,
  commit `sources-dist.json`, open PR. A reviewer (currently mostly mcm1957) reviews along the REVIEW_CHECKLIST.
- Run https://adapter-check.iobroker.in/ (= repochecker) before - **0 errors** expected.

### 2. `stable` repository
- Adapter must be in `latest` first.
- Create a **test thread in the ioBroker forum** ("Tester gesucht"), collect feedback (existing thread:
  https://forum.iobroker.net/topic/59422/new-adapter-huawei-fusionsolar-api).
- Then `npm run addToStable -- --name fusionsolar --version <x.y.z>` in ioBroker.repositories (PR), or via iobroker.dev.

## Review checklist (REVIEW_CHECKLIST.md, condensed)

- Re-run the check; GitHub Actions enabled; package tests and **integration tests green** (reviewers scroll through logs).
- README: English description, changelog, license; Sentry note on top if Sentry is used (not used here).
- package.json: `adapter-core` dependency vs. `js-controller` dependency; minimum Node version mentioned in README.
- io-package.json: js-controller dependency; news/names translated; no unused `materializeTab`/`supportsCustoms`;
  native fields match the admin UI; **password fields in `protectedNative` and `encryptedNative`**.
- Directories: `admin` content matches io-package; `docs` content linked.
- Adapter logic: **all timeouts/intervals cleared in unload** (also in lib files); no `schedule` mode for cloud polling
  without randomization; only needed event handlers; no unjustified `strictObjectChecks: false`; **check roles**;
  avoid `setObject`; `onStateChange` must check `ack`; parallelism of object/state creation; error handling;
  `info.connection` object defined in io-package or code.

## Repochecker – key rules and current minimums (5.22.9)

**package.json** (M0000): engines.node required, min **22**; `@iobroker/adapter-core` >= 3.2.3 (recommended 3.4.3);
`@iobroker/testing` >= 6.2.1; `@iobroker/eslint-config` (>= 2.0.0) with `eslint.config.mjs` + `prettier.config.mjs`;
release-script >= 5.2.0 requires plugins `iobroker`, `license`, `manual-review` (also listed in `.releaseconfig.json`);
forbidden in dependencies: `@iobroker/testing`, `@iobroker/types`, `@types/*`, eslint config, release script;
forbidden scripts: `preinstall`, `install`, `postinstall`, `prepare`; `@types/node` major must not exceed engines min
(W0066); `@tsconfig/nodeXX` must match engines (W0086); keywords must contain adapter specific terms, not only
"iobroker"/"smart home".

**io-package.json** (M1000): js-controller **>= 6.0.11**; admin (globalDependencies) **>= 7.6.17** (recommended 7.6.20);
required: `titleLang`, `desc` (multi-language), `licenseInformation` (`{type: "free", license: "MIT"}`), `tier` (1-3),
`connectionType`, `dataSource`, `news` (max 20 entries, entry for current version), `adminUI.config` (`json`);
deprecated/forbidden: `common.title`, `common.main`, `common.materialize`, `common.license`, `common.subscribe`,
`$schema`; `encryptedNative` must be a subset of `protectedNative`; `dependencies` use `>=`; titleLang must not contain
"ioBroker"; keywords must not contain "iobroker"/"adapter"/"smart home"; extIcon square 32..512 px.

**npm** (M2000): `bluefox` owner (E2001); every `news` version must exist on npm (E2004); npm `latest` needs a news entry;
**E2008: latest npm version must be signed with provenance -> use trusted publishing** (GitHub Actions deploy job).

**Tests / workflow** (M3000 + config): file `.github/workflows/test-and-release.yml`, name "Test and Release";
push trigger on default branch + tags `v[0-9]+.[0-9]+.[0-9]+` and `v[0-9]+.[0-9]+.[0-9]+-**`; `pull_request: {}`;
concurrency; jobs `check-and-lint` (**`ioBroker/testing-action-check@v2`**, `lint: true`, node >= 22),
`adapter-tests` (`testing-action-adapter@v1`, **`needs: check-and-lint`**, matrix **node 22, 24, 26** on
**ubuntu, windows, macos**), `deploy` (`testing-action-deploy@v1`, node **24**, `needs` both jobs,
permissions `contents: write` + `id-token: write`, **no `npm-token`** = trusted publishing); no `continue-on-error`,
no `always()`; last workflow run must be green; npm releases must be tagged on GitHub.

**Code** (M5000): no `process.env` / `process.exit` (compact mode); clear timers; prefer `this.setTimeout`, `this.delay`;
no `setObject`; no deprecated `createState/createChannel/...`; no example keys `option1/option2`; legacy admin files
must be gone when jsonConfig is used; jsonConfig password fields in protected/encrypted native; every imported package
in dependencies and every dependency imported; built-in node modules with `node:` prefix (S5043).

**jsonConfig** (M5500): root type `panel`/`tabs`; valid component types/attributes (schema from admin master);
responsive sizes `xs, sm, md, lg, xl` required (E5507), `xs` should be 12, sizes must not increase from xs to xl,
values 1..12. **i18n** (M5600): short format `admin/i18n/<lang>.json`; required languages present; all keys of en.json
in all languages; jsonConfig texts must exist in en.json.

**README** (M6000): exactly one `#` heading; `## Changelog` with `###` version headings (`x.y.z` or
`**WORK IN PROGRESS**`); entry for npm latest version; `## License` as last section with
**"Copyright (c) YYYY[-YYYY] name <email>"** (E4050/E4051 require a valid email in README and LICENSE; year = current
year or last commit year); no `npm install`/GitHub/custom-URL install instructions (E6013); **>= 3 German words ->
error (E6015)**; > 30 changelog entries -> move older ones to `CHANGELOG_OLD.md`.

**GitHub / dependabot / ignore** (M8000, M8900, M9000): repo description + topics, not archived; GitHub release tag
should match npm version; issues titled `[iobroker-bot]`/`URGENT:`/`IMPORTANT:` must be handled; dependabot npm entry
needs **`cooldown: { default: 7 }`** and must ignore major updates of `@types/node`; suggested: random `cron` schedule,
`open-pull-requests-limit` >= 15, `automerge-dependabot.yml`; `.gitignore` must contain `.commitinfo`.

## Changelog and release pipeline – what is fixed and what is free (verified in repochecker source, 2026-10-02)

Verified in `lib/M6000_Readme.js`, `lib/M3000_Testing.js`, `lib/M1000_IOPackageJson.js`, `lib/M2000_Npm.js` and
`lib/postprocessing.js` (severity remapping when `isNewAdapter` = adapter not yet in the latest repository).

**Changelog**
- `## Changelog` in README.md is **mandatory** (E6003) with `###` version headers `x.y.z[-pre.N][ anything]` (W6028;
  allowed non-version headers: `WORK IN PROGRESS`, `CHANGELOG_OLD.md`, `Older versions/changelog/entries`) and bullets
  `- text` / `* text` (W6027). The **npm latest version must have an entry** (E6029), the io-package version should (W6030).
- A separate root `CHANGELOG.md` -> W6017 (only `js-controller`/`admin` are exempt); a fixed link from the README changelog
  to a `CHANGELOG.md` -> W6032. The only supported split is **`CHANGELOG_OLD.md` in the repo root** for older entries
  (linked from README; missing link is an error for new adapters, S6022 -> E). A `doc/changelog.md` is not checked, but the
  README must still contain the current entries.
- `io-package.json` `common.news`: entry for the current version (E1036), max. 20 (E1031, builder truncates at 7), all
  required languages (E1045) and really translated (E1144 for the newest release).

**Workflow `test-and-release.yml`**
- Fixed: file name (E3002), name "Test and Release" (W3004), push trigger on default branch (E3006/E3007/E3037) + tags
  `v[0-9]+.[0-9]+.[0-9]+` and `v[0-9]+.[0-9]+.[0-9]+-**` (E3008/E3040), concurrency (W3009 -> E for new), jobs
  `check-and-lint` (E3010) and `adapter-tests` (E3011) with `needs: check-and-lint` (S3014 -> E for new), node matrix 22/24/26
  (E3025), OS ubuntu/windows/macos (E3027), no `continue-on-error`, no `always()`, last run on default branch green (E3031).
  The ioBroker actions `testing-action-check@v2` / `testing-action-adapter@v1` are expected (only warnings if replaced).
- `deploy` job: **required for new adapters** (S3012 -> E), must `needs` both test jobs (E3016), node >= 24 (E3022).
  Using own steps instead of `ioBroker/testing-action-deploy@v1` is only a **warning** (W3017).
- npm latest must be published **with provenance** (S2008 -> E for new) = trusted publishing from GitHub Actions
  (`id-token: write`). A workflow run triggered by the release tag must exist (S3032/W3032 -> E for new); npm releases
  must be tagged on GitHub (E3034/E3036).
- `ioBroker/testing-action-deploy` does **not** compute versions: on a pushed tag `vX.Y.Z` it builds, runs `npm publish`
  and creates the GitHub release (body from the tag/commit). Version calculation is traditionally done locally by
  `@alcalzone/release-script` (optional devDependency; if used, `.releaseconfig.json` + plugins are required).
- Consequence: the **test half is fixed**, the **version calculation is free** - any tool may compute the version, update
  `package.json`/`io-package.json` (version + translated news)/README changelog, commit and push the tag; the tag push then
  runs `test-and-release.yml` incl. `deploy`. Tags pushed with the default `GITHUB_TOKEN` do **not** trigger other
  workflows -> a PAT / GitHub App token is needed for that push.

## State roles (repochecker `config_StateRoles.js`) – roles used by this adapter

| Role | Allowed type | read/write |
| --- | --- | --- |
| `value`, `value.power`, `value.power.reactive`, `value.energy`, `value.energy.consumed`, `value.energy.produced`, `value.voltage`, `value.current`, `value.frequency`, `value.temperature`, `value.battery`, `value.time`, `value.gps.latitude`, `value.gps.longitude` | **number** | read, not write |
| `info.name` | string | read (write optional) |
| `info.address`, `info.serial`, `info.model` | string | read |
| `info.firmware` | string or number | read |
| `text` | string | - |
| `state` | any (no constraints) | - |
| `level` | number | read **and write** |
| `indicator`, `indicator.connected` | boolean | read |
| `date` | string or number | read only |

Full role list: https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md
