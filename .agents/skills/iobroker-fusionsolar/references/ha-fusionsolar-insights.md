# Insights from the Home Assistant FusionSolar integration

Analysed 2026-10-02. Purpose: learn from the most widely used open source FusionSolar client - **not** to copy it.

## Source locations

- Repository: https://github.com/tijsverkoyen/HomeAssistant-FusionSolar (MIT, ~240 stars, actively maintained,
  integration version 3.6.1, analysed at commit `2235c79289bd1571c0cd388041583a66139f5bf7`, default branch `master`)
- Key files (paths relative to the repo root):
  - `custom_components/fusion_solar/fusion_solar/openapi/openapi_api.py` - northbound API client (login, `_do_call`, failCode handling)
  - `custom_components/fusion_solar/device_real_kpi_coordinator.py` - rate limiting strategy for `getDevRealKpi`
  - `custom_components/fusion_solar/sensor.py` - per device type: which `dataItemMap` keys become which sensor (unit/class), update intervals
  - `custom_components/fusion_solar/fusion_solar/realtime_device_data_sensor.py` - value conversion (`N/A`, ×1000, ×100, timestamps)
  - `custom_components/fusion_solar/fusion_solar/energy_sensor.py` - "midnight glitch" workaround
  - `custom_components/fusion_solar/fusion_solar/openapi/device.py` - full devTypeId -> name mapping (incl. 23070 EMMA)
  - `custom_components/fusion_solar/fusion_solar/const.py` - API field names, supported type ids
  - `custom_components/fusion_solar/fusion_solar/kiosk/kiosk_api.py` - kiosk (public dashboard) mode
  - `custom_components/fusion_solar/translations/en.json` - **enum texts** for `inverter_state`, `battery_status`, `ch_discharge_model`, `meter_status`
  - `docs/imaster-neteco-v600r022c00-northbound-interface-reference-v6.pdf` - **official Huawei reference** (primary source, see API reference)
  - `docs/postman_collection.json` - request examples for all interfaces
  - `CLAUDE.md` - architecture summary by the maintainer
- Raw file URL pattern: `https://raw.githubusercontent.com/tijsverkoyen/HomeAssistant-FusionSolar/master/<path>`

## How HA uses the API

| Aspect | HA implementation | Our adapter (v2 rework) | Takeaway |
| --- | --- | --- | --- |
| Plant list | `getStationList` first, on failCode 401 fall back to `/stations` (`pageNo: 1` only, no paging) | same order (`auto`), but with paging | our approach confirmed; keep paging |
| Login | token only from header `xsrf-token`; any exception -> "could not login" | header **or** cookie, failCodes classified | ok |
| failCode 305 | `self._token = None` and **recursive retry without limit** | one re-login per call | ours is safer (HA could loop) |
| failCode 407 | raises; coordinator then **skips ~1 min** (`counter_limit = ceil(60/63)+1` ticks) | up to 3 quick retries, then exponential backoff | **quick retries on 407 are useless** (5-min window) -> drop/redesign retry |
| Device KPIs | **one device type per tick, round robin**, tick = 63 s -> each type every `63 s × number of types` | all types every cycle (300 s), one call per type | both stay within `Σ types per 5 min`; HA spreads the calls - consider spreading to avoid bursts |
| Supported types for `getDevRealKpi` | whitelist 1, 10, 17, 38, 39, 41, 47, 23070 | definitions for 1, 38, 39, 47; generic for others (incl. 46!) | **whitelist the types the API supports**; 46/62/others must never be requested |
| Station KPIs | `getStationRealKpi` every **600 s** | every poll (300 s) | 300 s is allowed (1 per 5 min) |
| Year KPIs | `getKpiStationYear` every **1 h** with `collectTime` = Jan 1st of next year (ms) | not used | idea for step 2 (year yield) |
| Device list | loaded once at setup | once a day | ok |
| Disabled devices | user can disable devices/stations in HA -> excluded from calls | `updatePriority` 0 | similar idea |
| > 100 stations | error log "not a good idea" | chunking | ok |
| Debugging | logs complete JSON of every response at debug level | same | ok |

## Data pitfalls handled by HA (and how we handle them)

1. **`"N/A"` and `null` values** for numeric fields (e.g. `close_time`, missing strings at night) -> HA maps them to "unknown".
   Ours: `convertValue` skips non-numeric strings for number states; `openTime`/`closeTime` are `mixed` (to be fixed, see open findings).
2. **Timestamps** `open_time`/`close_time` are **ms epoch** -> HA converts to datetime. Ours: raw number (role should be `date`/`value.time`).
3. **`reactive_power` multiplied by 1000** (API kvar -> var) for inverter/grid meter. For the power sensor (47) HA also uses
   the ×1000 class although the API already delivers var (probably a HA bug) -> **units are type dependent**, verify with real data.
4. **`power_factor` multiplied by 100** (shown as %). Ours: raw value (-1..1) with no unit - fine, document it.
5. **Power units differ per type:** HA uses kW for `active_power` of string/residential inverter, grid meter (17) and EMMA, but
   **W for power sensor (47)** (incl. `active_power_a/b/c`) and for battery/ESS `ch_discharge_power`, `max_*_power`.
6. **"Midnight glitch":** "Huawei returns invalid data for the cumulative energy just before midnight" -> HA updates lifetime
   energy only while the system produces power (`active_power != 0`), otherwise keeps the previous value. Applies to
   `total_power` / `total_cap`-like counters. Consider for our `totalPower`/`totalCap` (users feed them into history/statistics).
7. **Energy counters:** `day_cap`, `total_cap`, `charge_cap`, `discharge_cap` are `TOTAL_INCREASING` (may reset daily),
   `mppt_*_cap`, meter caps are `TOTAL`.
8. **Enums with texts:** `inverter_state`, `battery_status`, `ch_discharge_model`, `meter_status` (tables in the API reference)
   -> we should provide `common.states` for them (currently only `battery_status`, `meter_status`, `run_state`).
9. **`run_state`** is exposed as connectivity binary sensor (0/1).
10. Empty `data` (`None`) from `getDevRealKpi` -> HA warns "Check if you have sufficient permissions" (missing interface
    permission of the API account gives empty data rather than an error in some cases).

## Features worth considering (step 2)

- **Kiosk mode** (no API account needed): public kiosk URL of the plant
  (`https://<host>/rest/pvms/web/kiosk/v1/station-kiosk-file?kk=<kioskId>`, GET, response `data` is an **HTML-escaped JSON
  string** -> `html.unescape` + `JSON.parse`, fields under `realKpi`: `realTimePower` (kW), `dailyEnergy`, `monthEnergy`,
  `yearEnergy`, `cumulativeEnergy` (kWh)). HA polls it every **10 min** (data is cached by Huawei). Many users cannot get a
  northbound account - kiosk mode would serve them.
- Year yield via `getKpiStationYear` (1 call per hour is far below the daily limit of `Roundup(plants/100)+24`).
- Additional device types with definitions from the official reference: 10 EMI, 17 grid meter, 41 ESS, 23070 EMMA.
- Human readable names for devices: `"<devName> (<esnCode>)"` unless both are equal.

## Things HA does that we should NOT copy

- Unlimited recursive re-login on 305 (can loop when credentials are revoked).
- No unit tests (validation only in a running HA instance).
- No paging of `/stations`.
- One fixed host default `https://eu5.fusionsolar.huawei.com` with protocol in the setting (ours: host only, normalized).
