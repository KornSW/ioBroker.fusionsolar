# Knowledge sources

Collected 2026-10-02. Reliability: **A** = official / executable rule set, **B** = well maintained community code or guide,
**C** = single community statement / issue. Add new sources here (with date) whenever you use one.

## Huawei FusionSolar northbound API

| Source | Content | Rel. |
| --- | --- | --- |
| **iMaster NetEco V600R022C00 Northbound Interface Reference-V6 (SmartPVMS), Issue 01, 2022-06-16** – PDF in the HA repo: [docs/imaster-neteco-v600r022c00-northbound-interface-reference-v6.pdf](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/blob/master/docs/imaster-neteco-v600r022c00-northbound-interface-reference-v6.pdf) | **primary source** (read completely for login, limits, interfaces, device types, units, error codes); extract with `pdftotext` | A |
| [HomeAssistant-FusionSolar](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar) (commit `2235c79`) – files listed in [ha-fusionsolar-insights.md](ha-fusionsolar-insights.md) | most used open source client: rate limiting strategy, units per type, value conversions, enum texts (`translations/en.json`), kiosk mode, Postman collection (`docs/postman_collection.json`) | B |
| [SmartPVMS 25.1.0 Northbound API Reference](https://support.huawei.com/enterprise/en/doc/EDOC1100465337) | official reference (JS-rendered, not readable via fetch; use a browser) | A |
| [SmartPVMS 25.3.0 Northbound API Reference](https://support.huawei.com/enterprise/jp/doc/EDOC1100520173) | newer edition of the official reference | A |
| [SmartPVMS V600R024C10 Northbound Interface Reference-V6 – 5-minute device data](https://support.huawei.com/enterprise/en/doc/EDOC1100316813/38c7a954/5-minute-device-data-interface) | official V6 reference (chapter pages per interface; limits formulas came from excerpts of this document) | A |
| [Why does the northbound API login fail? (25.1.0)](https://support.huawei.cn/enterprise/en/doc/EDOC1100465337/c0b431c1/why-does-the-northbound-api-login-fail) | official FAQ: login limit, lockout, token validity | A |
| [Scribd copy of SmartPVMS V600R024C00 Northbound Interface Reference V6](https://www.scribd.com/document/759650085/SmartPVMS-V600R024C00-Northbound-Interface-Reference-V6-FusionSolar-SmartPVMS) | full PDF copy (login wall) | A |
| [pyhfs (Python client)](https://github.com/guillaumeblanc/pyhfs) – [session.py](https://github.com/guillaumeblanc/pyhfs/blob/main/pyhfs/session.py), [exception.py](https://github.com/guillaumeblanc/pyhfs/blob/main/pyhfs/exception.py), [client.py](https://github.com/guillaumeblanc/pyhfs/blob/main/pyhfs/client.py) | failCode list with meanings, re-login on 305, paging of `stations`, 100 items per call, test data JSON files | B |
| [EnergieID FusionSolar client](https://github.com/EnergieID/FusionSolar/blob/master/fusionsolar/client.py) | endpoint list, 305/306/307 = re-login, 407 backoff | B |
| [Thospaak: FusionSolar northbound API guide (Thai)](https://thospaak.com/huawei-fusionsolar-northbound-api/) | account creation menu path, permissions, login 5/10 min, 30 min token, **single session per account**, rate formulas, failCodes | B |
| [Solytic: set up API access](https://solytic.com/knowledge/set-up-api-access-huawei-fusionsolar-api/) | step-by-step account creation (company admin, Basic APIs toggle, validity, plant authorization), one account per system | B |
| [meteocontrol VCOM: Huawei FusionSolar API](https://help-center.meteocontrol.com/en/vcom-cloud/latest/huawei-fusionsolar-api-1) | account setup, limits per user, 5-min data | B |
| HomeAssistant-FusionSolar issues [#89](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/89), [#29](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/29), [#150](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/150), [#262](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/262) | real-world 407 problems, single login session limit | C |
| [HA issue #68 "getStationList deprecated?"](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/68) | 2023-02: Huawei reference of 2023-01-19 declares `getStationList` "about to go offline", replacement `stations`; failCode 401 for new accounts (au5) | B |
| [HA issue #265 "Northbound error 20056"](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/265) | 2025-09: failCode 20056 on `getStationList` (eu5) although login works | C |
| [HA community: Fusion Solar App integration](https://community.home-assistant.io/t/fusion-solar-app-integration/852116) | 20056 reports since 2025-09-06 | C |
| [Huawei 24.2.0: Integrating OAuth 2.0 to third-party apps](https://support.huawei.com/enterprise/en/doc/EDOC1100358266/872e9abc/integrating-oauth-20-to-third-party-apps), [25.1.0: OAuth Connect](https://support.huawei.cn/enterprise/en/doc/EDOC1100465337/95c18db0/oauth-connect), [25.3.0: Calling open APIs by third-party apps](https://support.huawei.cn/enterprise/en/doc/EDOC1100520173/fa693885/calling-open-apis-by-third-party-apps), [25.4.0: Introduction to northbound open APIs](https://support.huawei.cn/enterprise/en/doc/EDOC1100544235/3b606afb/introduction-to-northbound-open-apis) | OAuth Connect (owner authorization, authorization code, Bearer token) - JS rendered, content via search excerpts | A |
| [Huawei 25.2.0: Why does the northbound API return error code 401?](https://support.huawei.com/enterprise/en/doc/EDOC1100492747/41019745/why-does-the-northbound-api-return-error-code-401), [error code list 25.2.0](https://support.huawei.com/enterprise/en/doc/EDOC1100492747/97234b41/error-code-list) | 401 = API group not enabled (basic/control/restricted); newer error codes (e.g. 20056) | A |
| [Huawei 25.4.0 installer manual: Managing a northbound API account](https://support.huawei.cn/enterprise/en/doc/EDOC1100541798/76091675/managing-a-northbound-api-account) | current account management in the portal | A |
| [sunreport: Huawei FusionSolar](https://docs.sunreport.com/connecting-devices/huawei/), [novasense: Huawei API](https://docs.novasense.ch/docs/Data%20Sources/huawei_api/) | owner "API Access" permission for plants of other companies; account setup | B |
| [Scribd: SmartPVMS 24.5.0 Northbound API Reference](https://www.scribd.com/document/794636396/SmartPVMS-24-5-0-Northbound-API-Reference) | newer full reference (login wall) - candidate for verifying turnovers 3-5 | A |
| [com.huawei.fusionsolar issue #25 (EMMA)](https://github.com/andiwirz/com.huawei.fusionsolar/issues/25) | devTypeId 23070 EMMA, 23071 SmartGuard, EMMA data items | C |
| [ioBroker.sun2000](https://github.com/bolliy/ioBroker.sun2000) | alternative local Modbus adapter (recommend for realtime needs) | B |
| Old adapter code (git history of `main.js`, v1.x) | real response samples (station list, devList, KPIs of inverter/meter/battery/dongle), HTTP 403 quota body | B |

## ioBroker

| Source | Content | Rel. |
| --- | --- | --- |
| [ioBroker.repositories README](https://github.com/ioBroker/ioBroker.repositories#readme) | requirements + process for latest/stable | A |
| [REVIEW_CHECKLIST.md](https://github.com/ioBroker/ioBroker.repositories/blob/master/REVIEW_CHECKLIST.md) | what reviewers check | A |
| [ioBroker.repochecker](https://github.com/ioBroker/ioBroker.repochecker) – rules in `lib/M*.js`, versions in [`lib/config.js`](https://github.com/ioBroker/ioBroker.repochecker/blob/master/lib/config.js), roles in `lib/config_StateRoles.js`, all messages in `doc/issues_en.md` | **executable rule set** (run it!) | A |
| [adapter-check.iobroker.in](https://adapter-check.iobroker.in/) | online repochecker | A |
| [iobroker.dev](https://www.iobroker.dev) | developer portal: ADD TO LATEST / stable (named in the repositories README; was **not reachable** from the dev machine on 2026-10-02 - fallback: PR via `npm run addToLatest`) | A |
| [ioBroker.example (JavaScript template)](https://github.com/ioBroker/ioBroker.example/tree/master/JavaScript) | current template: package.json, tsconfig, eslint/prettier config, workflow | A |
| [create-adapter](https://github.com/ioBroker/create-adapter) | adapter generator | A |
| [State roles](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md) | official role list | A |
| [Objects schema](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/objectsschema.md) | object structure (device/channel/state) | A |
| [jsonConfig documentation](https://github.com/ioBroker/ioBroker.admin/blob/master/packages/jsonConfig/README.md) | admin UI components and attributes | A |
| [io-package.json schema (js-controller)](https://github.com/ioBroker/ioBroker.js-controller/blob/master/schemas/io-package.json) | schema used by the repochecker | A |
| [@iobroker/testing](https://github.com/ioBroker/testing) | package/integration tests, `controllerVersion` option | A |
| [release-script](https://github.com/AlCalzone/release-script) | release flow, changelog placeholder | A |
| [dev-server](https://github.com/ioBroker/dev-server) | local test instance | A |
| [npm trusted publishers](https://docs.npmjs.com/trusted-publishers) | provenance for E2008 | A |
| [Adapter types list](https://download.iobroker.net/list.html#sortCol=type&sortDir=0) | valid `common.type` values | A |
| [Forum thread of this adapter](https://forum.iobroker.net/topic/59422/new-adapter-huawei-fusionsolar-api) | user feedback, test thread for stable; 2025-09-22 report of failCode 20056 + owner re-approval (la_saxe); 2025-05 "active power not shown below 1 kW" | C |
| [krobipd/iobroker-adapter-checks](https://github.com/krobipd/iobroker-adapter-checks) | offline variant of repository checks as unit test (not evaluated yet) | C |
