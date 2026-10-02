# Rate limits and throttling

This is the **leading document** about the call limits of the Huawei FusionSolar northbound API and how the adapter
throttles its requests. Most problems reported for this adapter (failCode **407**, HTTP **403**, "no data", gaps in
the history) are caused by these limits.

Status: 2026-10-02. Account generations: see [API-GENERATIONS.md](API-GENERATIONS.md).

## TL;DR

- Huawei refreshes the realtime data **only every 5 minutes** - polling faster gives no newer data, only errors.
- Use a **poll interval of 300 seconds** (default for new instances).
- Use **one API account per system** (ioBroker, Home Assistant, data logger, ...) - limits are counted per account and
  a new login invalidates the session of the other system.
- Avoid frequent adapter restarts - every start loads the plant and device list again (daily limits!).
- If you see failCode 407: increase the poll interval, don't decrease it.

## Official limits

Source: _iMaster NetEco V600R022C00 Northbound Interface Reference-V6 (SmartPVMS)_, Issue 01 (2022-06-16), "Access
Restrictions" of each interface. Limits are counted **per northbound user (API account)**. Exceeding a limit returns
**failCode 407** ("The interface access frequency is too high"). Huawei: "The traffic limiting mechanism may be
modified without notice."

| Interface | Used by the adapter | Limit | Additional rule |
| --- | --- | --- | --- |
| `login` | on start, after session expiry | **5 per 10 minutes** | 5 wrong passwords within 10 min -> account **locked for 30 min** |
| `logout` | no | 5 per 10 minutes | "invoke only when necessary" |
| plant list (`getStationList` / `stations`) | on start + every 24 h | **24 per day** | only one concurrent request per minute |
| `getDevList` | on start + every 24 h | **Roundup(plants / 100) + 24 per day** | only one concurrent request per minute |
| `getStationRealKpi` | every poll cycle | **Roundup(plants / 100) per 5 minutes** | only one concurrent request per minute |
| `getDevRealKpi` | every poll cycle, **one call per device type** | **Σ over device types Roundup(devices of the type / 100) per 5 minutes** | max. 100 devices of **one** type per call |
| `getKpiStation{Hour,Day,Month,Year}` | no | Roundup(plants / 100) + 24 per day | one concurrent request per minute |
| `getDevHistoryKpi` | no | Σ Roundup(devices of type / 10) + 24 per day | one concurrent request per minute |
| `getDevKpi{Day,Month,Year}` | no | Σ Roundup(devices of type / 100) + 24 per day | one concurrent request per minute |

Examples from the reference: 20 plants -> `getStationRealKpi` 1 call per 5 min, `getDevList` 25 calls per day;
20 inverters + 20 meters -> `getDevRealKpi` 2 calls per 5 min (one per type).

### Legacy vs. current accounts

The formulas above are the **new, resource-based policy** for API accounts created **after 2022-06-30**. Accounts created
on or before that date keep the "original traffic limiting policy" (not documented in detail; the allowed frequency
"cannot be increased"). The adapter always follows the current policy, which is safe for both.

### Other limits and quotas

- **HTTP 403** with `errorCode 49401021002` ("Request is rejected by api quotaControl") - quota of the API gateway,
  independent of the failCodes. Usually temporary.
- failCode **20200** "The system is busy. Try again later." - temporary server overload.
- failCode **20618** - maximum number of calls per user and day reached (reported by other clients).
- **One online session per account** - a new login invalidates the token of the previous session. Two systems using the
  same account log each other out continuously, every re-login costs one of the 5 logins per 10 minutes.
- The session token (`XSRF-TOKEN`) is valid for **30 minutes**; afterwards the API answers with failCode 305 and the
  adapter logs in again.

## Budget of a typical installation

Home system: 1 plant, 1 inverter, 1 battery, 1 power meter (+ 1 dongle). Poll interval 300 s.

| Interface | Calls by the adapter | Allowed | OK? |
| --- | --- | --- | --- |
| `getStationRealKpi` | 1 per 5 min | 1 per 5 min | yes (no headroom!) |
| `getDevRealKpi` (inverter, battery, meter) | 3 per 5 min (1 per type; the dongle is not requested) | 3 per 5 min | yes (no headroom!) |
| plant list | 1 per day (+1 per adapter restart) | 24 per day | yes |
| `getDevList` | 1 per day (+1 per adapter restart) | 25 per day | yes |
| `login` | about every 30 min (+1 per restart) | 5 per 10 min | yes |

With a poll interval of **60 seconds** the adapter would call `getStationRealKpi` 5 times in 5 minutes -> 4 of them fail
with 407. There is **no headroom** for a second system using the same account.

## How the adapter throttles

| Mechanism | Setting / constant | Behaviour |
| --- | --- | --- |
| Poll interval | _Poll interval in seconds_ (`polltime`), default **300**, minimum 60 | one update cycle per interval: plant realtime KPIs + device realtime KPIs |
| Plant and device list | fixed: 24 h | loaded on start and then once a day (not in every cycle) |
| Batching | fixed | all plants in one `getStationRealKpi` call, all devices **of the same type** in one `getDevRealKpi` call (chunks of 100) |
| Skipped devices | settings | optimizers are skipped by default (_Skip devices of type optimizer_); unknown device types are loaded by default since v2 (_Skip devices of unknown type_ = off, costs one call per new type and cycle) |
| Realtime support per device type | `lib/model.json` + learned model | types without realtime support are never requested; unknown types are tried once and remembered if the API rejects them (failCode 20013 / 20006); errors of one type do not stop the others |
| Wait time between calls | _Wait time between API calls_ (`timeslotlength`), default 3 s | minimum time between two API calls; spreads the calls of a cycle |
| Loading frequency per device | state `<device>.updatePriority` (0-6) | loads a device only every 1st/2nd/4th/.../32nd cycle (0 = only once after start). Saves calls only if **all devices of a type** are reduced |
| Retries on quota errors | _Retry API calls on call limit errors_ (`apiRetry`), max. 3 retries | on failCode 407 / HTTP 403 the call is repeated after `wait time × (attempt + 1)` |
| Re-login | fixed | on failCode 305 one re-login per call |
| Error backoff | fixed | after a failed cycle the next attempt waits `poll interval × 2^(errors - 1)`, max. **1 hour** |
| Login errors | fixed | after a failed login the adapter waits **1 hour** (protects against the 30-minute lockout) |

## Recommended settings

| Situation | Poll interval | Wait time | Retry on limit errors |
| --- | --- | --- | --- |
| Home system, one API account only for ioBroker | **300 s** | 3 s | off (see known weaknesses) |
| Same account also used elsewhere | **don't** - create a second API account | | |
| Many plants / devices (> 100 of a type) | 300 s | 5-10 s | off |

Set `updatePriority` of devices you don't need often (e.g. a second inverter) to a higher level - remember that the call
is only saved if all devices of that type are reduced.

## Known weaknesses (planned improvements)

1. **Retrying a 407 is useless inside the same 5-minute window.** The retry option waits only a few seconds and therefore
   burns further calls. Planned: no immediate retry on 407, continue in the next window; retries only for temporary
   errors (HTTP 403 gateway quota, failCode 20200).
2. **Calls are made as a burst** at the start of each cycle. The Home Assistant integration spreads the device types over
   the 5-minute window (one type per minute). Planned: evaluate spreading.
3. ~~Unsupported device types are requested via `getDevRealKpi` and break the cycle~~ - **fixed**: types without realtime
   support (`"realtime": false` in `lib/model.json`, e.g. dongles, optimizers) are never requested; unknown types are
   tried once and remembered as unsupported on failCode 20013 / 20006; errors of one device type no longer stop the
   other types (see [MODEL.md](MODEL.md)).
4. The minimum poll interval of 60 s is too low for the current policy. Planned: warn if the interval is below 300 s.
5. A daily-quota error (20618) is handled like a normal quota error. Planned: long backoff until the next day.

## FAQ

**Why are my values only updated every 5 minutes?** Huawei aggregates the realtime data in 5-minute steps; the limits are
designed for exactly this interval. For second-by-second values use a local Modbus connection (e.g. adapter `sun2000`).

**I get 407 although my interval is 300 s.** Another system uses the same API account, the adapter was restarted often,
or the calls of a cycle collide with the "one concurrent request per minute" rule. Use a dedicated account and increase the
wait time between calls.

**Does the API account generation change the limits?** Yes - see "Legacy vs. current accounts" above and
[API-GENERATIONS.md](API-GENERATIONS.md).
