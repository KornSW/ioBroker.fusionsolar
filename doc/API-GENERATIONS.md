# FusionSolar API account generations and platform changes

Huawei changed the northbound API several times. Depending on **when the API account was created** and **which version the
FusionSolar platform runs**, the same adapter setting can work for one user and fail for another. This document collects
all known changes, how to recognize them and how the adapter deals with them.

Status: 2026-10-02. Rate limits are covered in detail in [RATE-LIMITS.md](RATE-LIMITS.md).

## Terminology

The adapter setting _API generation_ (`apiVersion`) historically uses the values `gen-1` and `gen-2`. In this documentation:

| Term | Meaning | Adapter setting |
| --- | --- | --- |
| **Legacy account** | northbound API account created **on or before 2022-06-30** | `gen-1` |
| **Current account** | northbound API account created **after 2022-06-30** | `gen-2` |
| **OAuth app** | access via an OAuth 2.0 client that the plant **owner** authorizes (since SmartPVMS 24.2.0) | not supported (yet) |

> The adapter UI and older README versions said "08/2022" - the official date is **30.06.2022**.

## Timeline

| # | When | Platform version | Change | Who is affected | Symptom |
| --- | --- | --- | --- | --- | --- |
| 1 | 2022-06-30 | iMaster NetEco V600R022C00 (reference Issue 01, 2022-06-16) | **New traffic limiting policy** based on the number of plants/devices of the API user. Legacy accounts keep the _original_ policy ("the allowed invoking frequency cannot be increased"). New accounts **cannot invoke interfaces declared "end of lifecycle"**. | all accounts created after 2022-06-30 | different limits; errors on legacy interfaces |
| 2 | 2022 / 2023-06-30 | V600R022C00CP1202 | New `getDevHistoryKpi` (5-minute history) replaces `getDevFiveMinutes` (offline date 2023-06-30). New restricted interface `cs/getInventerRealKpi`. | users of 5-minute history data | (not used by the adapter) |
| 3 | 2023-01 | V600R023C00SPC210 (released 2023-01-14, reference of 2023-01-19) | **Plant list:** `getStationList` is declared "about to go offline", replaced by the paged `stations` interface with different field names (`plantCode`, `plantName`, `plantAddress`, capacity in **kWp** instead of MW). | current accounts get **failCode 401** on `getStationList` (first reports 2023-02, au5) | "no permission to use this interface (failCode 401)" |
| 4 | 2024 | SmartPVMS 24.2.0 (versioning changed from `V600R0xx` to `24.x`/`25.x`) | **OAuth Connect:** third-party apps can register an OAuth 2.0 client at Huawei; the **plant owner** logs in and authorizes it (authorization code flow, access + refresh token, calls with `Authorization: Bearer <token>`). API permissions are grouped into **basic**, **control** and **restricted** APIs (northbound account setting). | new integrations; installers configuring accounts | 401 if the needed API group is not enabled for the account |
| 5 | 2025-09 (around 2025-09-15) | platform update (bug fix release) | **Owner authorization enforced:** data of plants that were not created by the company of the API account must be released by the **plant owner** ("API Access" permission in the FusionSolar app). After the update owners had to **re-approve** existing releases. | accounts of installers / third parties for plants of other owners - including **legacy accounts** on eu5 | **failCode 20056** "Resources that are not authorized by the owner exist" on the plant list |

Not every region / server is updated at the same time - a change can appear on `au5` months before `eu5`.

## How to find out which account you have

- Ask the person who created the API account when it was created, or look at _System > Company Management > Northbound
  Management_ in the FusionSolar web portal (company administrators only).
- Or simply use the adapter's **automatic detection** (default) - the log shows `API generation detected: gen-1` or `gen-2`.

## What the adapter does (v2)

- **Automatic detection** (setting _automatic detection_ = `default`): the adapter tries the legacy plant list
  (`getStationList`) first and falls back to `stations` if the API answers with failCode 401 or another API error. The
  Home Assistant integration uses the same order. The legacy interface is tried first to keep the object structure
  (`stationCode`, `stationName`, ...) of existing installations.
- With an explicit setting (`gen-1` / `gen-2`) no detection takes place.
- The object tree is identical for both generations (the station folder is named after `stationCode` resp. `plantCode`);
  only the station info states differ (`stationName` vs. `plantName`, ...). `capacity` has no unit because it is MW for
  legacy and kWp for current accounts.
- All other interfaces (`getStationRealKpi`, `getDevList`, `getDevRealKpi`) are the same for both generations.
- Limits are **not** generation specific in the adapter - it always follows the (stricter) current policy, which is also
  safe for legacy accounts.

## Troubleshooting by symptom

| Symptom | Probable cause | Solution |
| --- | --- | --- |
| failCode **401** on `getStationList` | current account (created after 2022-06-30) | use _automatic detection_ or `gen-2` |
| failCode **401** on other interfaces | the interface is not enabled for the API account (basic/control/restricted API groups) | ask the company administrator to enable the APIs in _Northbound Management_ |
| failCode **20056** | the plant owner has not (re-)authorized API access | the **plant owner** must enable/confirm "API Access" for the plant in the FusionSolar app |
| failCode **20003** | the validity date of the API account has expired | extend the account in _Northbound Management_ |
| failCode **20400** | wrong user name or password (or the app/portal account is used instead of the API account) | check credentials - after 5 wrong attempts within 10 minutes the account is locked for 30 minutes |
| failCode **407** | call limit exceeded | see [RATE-LIMITS.md](RATE-LIMITS.md) |

## Open points / planned changes

- The adapter internally still treats the generations with simple `if` branches. A clean separation into strategies
  (legacy account, current account, possibly OAuth app) is planned - see the developer notes.
- failCode 20056 is currently reported as a generic API error; a dedicated message is planned.
- OAuth Connect would allow owners to connect without an installer-created API account, but requires a registered OAuth
  client (Huawei approval, redirect URL) - to be evaluated.

## Sources

- Official reference _iMaster NetEco V600R022C00 Northbound Interface Reference-V6 (SmartPVMS)_, Issue 01, 2022-06-16
  (chapter 1.3 "Traffic Limiting Policy", 1.4, 2-5, 6.4) - copy in the
  [Home Assistant integration repository](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/tree/master/docs)
- [Huawei SmartPVMS 25.1.0 Northbound API Reference - OAuth Connect](https://support.huawei.cn/enterprise/en/doc/EDOC1100465337/95c18db0/oauth-connect),
  [24.2.0 - Integrating OAuth 2.0 to third-party apps](https://support.huawei.com/enterprise/en/doc/EDOC1100358266/872e9abc/integrating-oauth-20-to-third-party-apps),
  [25.2.0 - Why does the northbound API return error code 401?](https://support.huawei.com/enterprise/en/doc/EDOC1100492747/41019745/why-does-the-northbound-api-return-error-code-401)
- [HomeAssistant-FusionSolar issue #68](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/68) (getStationList deprecated, 2023-02),
  [issue #265](https://github.com/tijsverkoyen/HomeAssistant-FusionSolar/issues/265) (failCode 20056, 2025-09)
- [ioBroker forum thread](https://forum.iobroker.net/topic/59422/new-adapter-huawei-fusionsolar-api) (20056 report and owner re-approval, 2025-09-22)
- [sunreport: Huawei FusionSolar](https://docs.sunreport.com/connecting-devices/huawei/) (owner "API Access" permission)
