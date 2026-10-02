# Huawei FusionSolar northbound API – condensed snapshot

Snapshot date: **2026-10-02**.

**Primary source:** _iMaster NetEco V600R022C00 Northbound Interface Reference-V6 (SmartPVMS)_, Issue 01, 2022-06-16
(PDF, 146 pages). A copy is kept in the Home Assistant integration repository:
`docs/imaster-neteco-v600r022c00-northbound-interface-reference-v6.pdf` in
https://github.com/tijsverkoyen/HomeAssistant-FusionSolar (commit `2235c79`). Re-extract with
`pdftotext -layout <pdf> out.txt`; use `-raw -f <page> -l <page>` for tables (the error code table is garbled in layout mode).
Page offset: document page = PDF page - 6. Newer editions (SmartPVMS 25.x, see [sources.md](sources.md)) describe `/stations`.

Reliability tags: `[official]` = read in the primary source, `[official-25.x]` = excerpt of a newer official edition,
`[community]` = open source clients / guides, `[ha]` = Home Assistant integration (see [ha-fusionsolar-insights.md](ha-fusionsolar-insights.md)),
`[observed]` = seen in real responses, `[assumption]` = not verified.

## Basics

- URL: `https://<host>/thirdData/<interface>`, always **POST**, JSON body, HTTPS only. `[official]`
- `<host>` = host of the FusionSolar web portal of the account's region (`eu5.fusionsolar.huawei.com`, `region01eu5`..`region04eu5`,
  `intl`, `sg5`, `la5`, `au5`, ...). `[community]`
- Response envelope: `{ success, failCode, params: { currentTime, <request params> }, message, data }`. **HTTP 200 also for
  errors** - success only if `failCode === 0` / `success === true`. `[official]`
- On errors `data` may be **a number or null** (official example: `"success": false, "data": 20007, "failCode": 20003`). Never
  index into `data` without type checks. `[official]`
- Values that are not available are returned as **`"N/A"`** (string) or `null`, even for numeric fields (e.g. `close_time`). `[ha]` `[observed]`

## Account generations and platform turnovers (important!)

Full documentation (leading): [doc/API-GENERATIONS.md](../../../../doc/API-GENERATIONS.md). Condensed:

1. **2022-06-30** - new resource-based traffic policy for API users created after this date; legacy users keep the original
   policy; new users cannot call interfaces declared end-of-life. `[official]`
2. **2022/2023-06-30** - `getDevHistoryKpi` replaces `getDevFiveMinutes`. `[official]`
3. **2023-01 (V600R023C00SPC210)** - `getStationList` "about to go offline", replaced by paged `stations` (`plantCode`,
   `plantName`, capacity kWp); new users get failCode 401 on `getStationList`. `[official-excerpt]` `[ha #68]`
4. **2024 (SmartPVMS 24.2.0)** - **OAuth Connect**: owner-authorized OAuth 2.0 clients of third-party apps (authorization
   code flow, access + refresh token, `Authorization: Bearer`); API permission groups basic / control / restricted. `[official-25.x]`
5. **2025-09 (~09-15)** - owner authorization enforced: **failCode 20056** "Resources that are not authorized by the owner
   exist" (also for legacy accounts on eu5); the plant owner must (re-)approve "API Access" in the FusionSolar app.
   `[ha #265]` `[iobroker forum 2025-09-22]`

Platform versions are rolled out per region at different times (au5 before eu5). In the adapter the generation switch
(`apiVersion`: `default`=auto / `gen-1` / `gen-2`) only selects the plant list interface - see open findings (strategy refactoring).

## Login and session

- `POST /thirdData/login` `{ "userName", "systemCode" }` -> token in **response header `xsrf-token`** (also as cookie
  `XSRF-TOKEN`). Send it as request header `XSRF-TOKEN` with every call. `[official]`
- **Token validity 30 min**; reuse it while valid, log in again when expired (-> failCode 305). `[official]`
- Login limit: **5 per 10 min** per northbound user (-> 407). Logout (`/thirdData/logout`, body `{ "xsrfToken" }`) has the
  same limit; "invoke only when necessary". `[official]`
- **5 wrong passwords within 10 min -> user locked for 30 min.** `[official]`
- **Only one online session per account** - a new login invalidates the previous token. Never share one API account between
  several systems. `[community]` (two independent sources; not stated in the 2022 reference)
- A successful login response has `failCode 0`, `data: null`. Wrong credentials: failCode **20400**, or (older systems)
  HTTP 200 with an empty body `[observed]`.

## Traffic limits (official formulas)

Leading, more detailed document incl. the adapter's throttling: [doc/RATE-LIMITS.md](../../../../doc/RATE-LIMITS.md).

General: limits are counted **per northbound user**; exceeding -> **failCode 407**. "The traffic limiting mechanism may be
modified without notice." `[official]`

| Interface | Limit `[official]` | Concurrency |
| --- | --- | --- |
| `login`, `logout` | 5 per 10 min | |
| Plant list (`getStationList` / `stations`) | **24 per day** | 1 concurrent request per minute |
| `getStationRealKpi` | **Roundup(plants/100) per 5 min** | 1 per minute |
| `getKpiStationHour/Day/Month/Year` | Roundup(plants/100) + 24 per day | 1 per minute |
| `getDevList` | **Roundup(plants/100) + 24 per day** | 1 per minute |
| `getDevRealKpi` | **Σ over device types Roundup(devices of type/100) per 5 min** | - |
| `getDevHistoryKpi` (5-min history) | Σ Roundup(devices of type/10) + 24 per day | 1 per minute |
| `getDevKpiDay/Month/Year` | Σ Roundup(devices of type/100) + 24 per day | 1 per minute |

Consequences for the adapter:
- A typical home system (1 plant; inverter + battery + meter) may call `getStationRealKpi` **once** and `getDevRealKpi`
  **once per device type** every 5 minutes -> poll interval **>= 300 s**, all devices of a type in one call (batching).
- **Retrying a 407 within the same 5-minute window is useless** - it only burns quota. Wait for the next window.
- Station list and device list: at most a few times per day (adapter: start + every 24 h).
- Realtime data is refreshed by Huawei every 5 min anyway. `[community]`

## Interfaces

| Interface | Request body | Response `data` |
| --- | --- | --- |
| `getStationList` (legacy, old users only) | `{}` | array of `{ stationCode, stationName, stationAddr, capacity (MW, double), buildState ("0" not constructed / "1" under construction / "2" grid-connected), combineType ("1" utility / "2" C&I / "3" residential), aidType (0 poverty alleviation / 1 not), stationLinkman, linkmanPho }` `[official]` |
| `stations` (new plant list) | `{ pageNo, pageSize }` - pageSize **must be one of 10, 20, 30, 50, 100** (failCode 30006) | `{ list: [{ plantCode, plantName, plantAddress, capacity (kWp), gridConnectionDate, latitude, longitude (strings, may be empty), contactPerson, contactMethod }], pageNo, pageSize, pageCount, total }` `[official-25.x]` `[observed]` |
| `getStationRealKpi` | `{ stationCodes: "a,b,..." }` (max 100) | `[{ stationCode, dataItemMap }]` |
| `getDevList` | `{ stationCodes }` (max 100 plants) | `[{ id (Long), devName, stationCode, esnCode, devTypeId, softwareVersion, invType (inverters only), longitude, latitude, optimizerNumber }]` |
| `getDevRealKpi` | `{ devIds: "1,2,...", devTypeId }` (max 100 devices, **one type per call**) | `[{ devId, dataItemMap }]` |
| `getKpiStationYear` | `{ stationCodes, collectTime }` (ms; HA uses Jan 1st of next year to get the current year) | `[{ collectTime, stationCode, dataItemMap }]` `[ha]` |

Other interfaces (not used): `getKpiStationHour/Day/Month`, `getDevHistoryKpi` (replaces `getDevFiveMinutes`, offline since
2023-06-30), `getDevKpiDay/Month/Year`, `getAlarmList`, `cs/getInventerRealKpi` (restricted), battery control and
device control/upgrade interfaces.

## Device types (`devTypeId`)

Device list (`getDevList`) can return `[official]`: 1 string inverter, 2 SmartLogger, 8 STS, 10 EMI, 13 protocol converter,
16 general device, 17 grid meter, 22 PID, 37 Pinnet SmartLogger, 38 residential inverter, 39 battery, 40 backup box,
41 ESS, 45 PLC, 46 optimizer, 47 power sensor, 62 Dongle, 63 distributed SmartLogger, 70 safety box.
Newer systems additionally: **23070 EMMA**, 23071 SmartGuard `[ha]` `[community]`.

**`getDevRealKpi` supports only: 1, 10, 17, 38, 39, 41, 47** `[official]` (+ 23070 EMMA in practice `[ha]`).
Any other type (46 optimizer, 62 dongle, 2 SmartLogger, ...) -> error (**failCode 20013** "device type is incorrect" / 20006
"some devices do not match the device type"). Never send unsupported types - and never let one failing type break the cycle.

## Realtime data items (`dataItemMap`) and units `[official]` unless noted

- **Plant** (`getStationRealKpi`): `day_power`, `month_power`, `total_power` (kWh), `day_income`, `total_income` (currency
  of the system), `real_health_state` (1 disconnected, 2 faulty, 3 healthy).
- **String inverter (1)**: `inverter_state` (code, Table 6-1 below), `ab_u`, `bc_u`, `ca_u`, `a_u`, `b_u`, `c_u` (V), `a_i`,
  `b_i`, `c_i` (A), `efficiency` (%), `temperature` (°C), `power_factor` (none, -1..1), `elec_freq` (Hz), `active_power` (kW),
  `reactive_power` (kvar), `day_cap`, `total_cap` (kWh), `mppt_power` (kW), `pv1_u..pv24_u` (V), `pv1_i..pv24_i` (A),
  `mppt_total_cap`, `mppt_1_cap..mppt_10_cap` (kWh), `open_time`, `close_time` (**ms timestamps**, `"N/A"` if not set),
  `run_state` (0 disconnected, 1 connected).
- **Residential inverter (38)**: same keys, but only `pv1..pv8` and `mppt_1..mppt_4`.
- **EMI (10)**: `temperature`, `pv_temperature` (°C), `wind_speed` (m/s), `wind_direction` (degree), `radiant_total`,
  `horiz_radiant_total` (MJ/m²), `radiant_line`, `horiz_radiant_line` (W/m²), `run_state`.
- **Grid meter (17)**: voltages (V), currents (A), **`active_power` (kW)**, `active_power_a/b/c` (kW), `reactive_power(_a/_b/_c)`
  (kvar), `power_factor`, `active_cap` (kWh, positive = import), `reverse_active_cap` (kWh, export), `forward_reactive_cap`,
  `reverse_reactive_cap`, `total_apparent_power` (kVA), `grid_frequency` (Hz), tariff counters
  `positive_/reverse_` `active_/reactive_` `peak/power(shoulder)/valley(off-peak)/top(sharp)` (kWh / kvarh).
- **Power sensor (47)** - officially only: `meter_status` (0 offline, 1 normal), `meter_u` (V), `meter_i` (A),
  **`active_power` (W)**, `reactive_power` (var), `power_factor`, `grid_frequency` (Hz), `active_cap`, `reverse_active_cap`
  (kWh), `run_state`. In practice three-phase sensors (DTSU666) also return `a_u..c_u`, `ab_u..ca_u`, `a_i..c_i`,
  `active_power_a/b/c` (**W**), `reactive_power_a/b/c`, `total_apparent_power` and the tariff counters `[ha]` `[observed]`.
  -> **power units differ between type 17 (kW) and 47 (W)!**
- **Battery (39)**: `battery_status` (0 offline, 1 standby, 2 running, 3 faulty, 4 hibernating), `max_charge_power`,
  `max_discharge_power`, **`ch_discharge_power` (W, + charging / - discharging)**, `busbar_u` (V), `battery_soc` (%),
  `battery_soh` (**no unit** officially), `ch_discharge_model`, `charge_cap`, `discharge_cap` (kWh), `run_state`.
- **ESS (41)**: `ch_discharge_power` (W), `battery_soc` (%), `battery_soh`, `charge_cap`, `discharge_cap` (kWh), `run_state`.
- **EMMA (23070)** `[ha]`: `ab_u`, `bc_u`, `ca_u` (V), `a_i..c_i` (A), `active_power`, `active_power_a/b/c` (kW per HA),
  `reactive_power`, `power_factor`, `active_cap`, `reverse_active_cap` (kWh), `ex_active_power` (external meter power),
  `ex_active_cap`, `ex_reverse_active_cap`, `run_state`.

### Enumerations

`inverter_state` (Table 6-1) `[official]`: 0 standby: initializing, 1 standby: insulation resistance detecting,
2 standby: irradiation detecting, 3 standby: grid detecting, 256 start, **512 grid-connected**, 513 grid-connected: power
limited, 514 grid-connected: self-derating, 768 shutdown: on fault, 769 shutdown: on command, 770 shutdown: OVGR,
771 shutdown: communication interrupted, 772 shutdown: power limited, 773 shutdown: manual startup required,
774 shutdown: DC switch disconnected, 1025 grid scheduling: cosφ-P curve, 1026 grid scheduling: Q-U curve,
1280 ready for terminal test, 1281 terminal testing, 1536 inspection in progress, 1792 AFCI self-check, 2048 I-V scanning,
2304 DC input detection, **40960 standby: no irradiation**, 45056 communication interrupted (written by SmartLogger),
49152 loading (written by SmartLogger).

`ch_discharge_model`: official 0 none, 1 forced charge/discharge, 2 time-of-use price, 3 fixed charge/discharge,
4 automatic charge/discharge (= max. self-consumption); newer values `[ha]`: 5 fully fed to grid, 6 TOU, 7 remote
scheduling - max. self-consumption, 8 remote scheduling - fully fed to grid, 9 remote scheduling - TOU, 10 AI energy
control, 11 remote control - AI energy control, 12 third-party dispatch.

## failCodes `[official]` (chapter 8, relevant subset)

| failCode | Meaning | Adapter reaction |
| --- | --- | --- |
| 0 | success | |
| 305 | not logged in, log in again | re-login once, repeat |
| 306, 307 | treated as "re-login" by some clients `[community]` (not in the 2022 reference) | handle like 305 |
| 401 | no permission for this data interface (also: legacy interface for new users) | `permission` |
| 407 | access frequency too high | `quota` - wait for next window |
| 20001 | third-party system ID does not exist | `auth` |
| 20002 | third-party system is forbidden | `auth` |
| 20003 | **third-party system has expired** (account validity date passed) | `auth` + clear hint |
| 20004 | server is abnormal | retry later |
| 20006 | some devices do not match the device type | bug in batching |
| 20007 | system does not have the desired plant resources | plant not authorized |
| 20008 | system does not have the desired device resources | device not authorized |
| 20009 | queried KPIs are not configured in the system | |
| 20013 | **device type incorrect / not supported by this interface** | never request that type |
| 20014-20017 | max. 100 plants / devices per call | chunking |
| 20200 | **system is busy, try again later** | retry later |
| 20400 | **user name or password of the third-party system is incorrect** | `auth` (1 h backoff, lockout risk) |
| 20403 | login of the third-party system user is restricted | `auth` |
| 30006 | pageSize out of range ({10,20,30,50,100}) | |
| 30029 | authentication failed | `auth` |
| 20618 | max. calls per user per day `[community]` | `quota` (long backoff) |
| 20056 | resources that are not authorized by the owner exist (since 2025-09) `[ha]` `[observed]` | `auth`-like, clear hint: owner must approve "API Access" |

HTTP **403** with `{"errorCode":"49401021002","exceptionInfo":"Request is rejected by api quotaControl ..."}` = gateway
quota, independent of failCode 407. `[observed]`

## Creating the northbound API account

Official steps (2022 reference): _System > Business Configuration > Northbound Management_ > **Add** -> system name,
**deadline** (validity), user name, password -> select the **Plant list interface** and bind the plants -> optionally the
**Device list interface** and bind the devices -> select further interfaces (real-time plant data, real-time device data, ...)
-> OK. `[official]`

Current portal (guides 2024+): _System > Company Management > Northbound Management_ > Add; must be done by a **company
administrator** (installer account) - plant owners ask their installer or Huawei support (`eu_inverter_support@huawei.com`);
user name must differ from the FusionSolar account; password 8-32 chars; switch on **Basic APIs**; validity far in the
future (expired -> 20003); authorize the company (all current and future plants) or selected plants; **one API account per
consuming system**. `[community]`
