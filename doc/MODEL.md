# Data model (dynamic) and diagnostic export

Huawei keeps adding device types (EMMA, SmartGuard, ...) and data fields. The adapter therefore uses a **dynamic data
model**: a maintained, shipped model of the well-known data points plus everything it learns at runtime.

## How it works

| Part | Where | Purpose |
| --- | --- | --- |
| **Well-known model** | [`lib/model.json`](../lib/model.json) (shipped with the adapter) | device types, fields, state ids, roles, **units**, enum texts - maintained by the developers |
| **Model logic** | [`lib/model.js`](../lib/model.js) | loads/validates `model.json`, resolves the fields of every API response, infers unknown fields, learns, creates the export |
| **Learned model** | file storage of the instance: `fusionsolar.<n>/model/learned-model.json` | what this installation has seen: device types, fields, value types, example values, device types without realtime support |
| **Diagnostic export** | file storage of the instance: `fusionsolar.<n>/model/diagnostic-export.json` | anonymized summary for support and for extending `model.json` |

For every realtime response of the API:

1. **Well-known fields** (part of `model.json`) are written with their fixed state id, role, unit and enum texts.
2. **Unknown fields** are written generically: state id = field name of the API, type from the value, role `value`
   (`text` / `indicator` for strings / booleans). A unit is only inferred where the field name is unambiguous
   (`*_u` V, `*_i` A, `*_cap` kWh/kvarh, `*temperature*` °C, `*freq*` Hz, `*soc` %). **Power units are never guessed**
   because the API uses W and kW depending on the device type.
3. **Unknown device types** (not in `model.json`) are requested by default (unless _Skip devices of unknown type_ is enabled).
   If Huawei answers that the realtime interface does not support the type (failCode 20013 / 20006), this is remembered
   and the type is not requested again - the other device types are not affected.
4. Device types which the realtime interface does not support (`"realtime": false`, e.g. dongles and optimizers) are
   never requested.

## Diagnostic export (for users)

_Instance settings > Data model and diagnostics > **Create and download diagnostic export**_ creates the export and
opens it in a new browser tab (save it with Ctrl+S). It is also available in the admin tab _Files_ under
`fusionsolar.<n>/model/` and via `http://<admin>/files/fusionsolar.<n>/model/diagnostic-export.json`.

**Contents:** adapter / model version, API generation, poll interval, number of plants, per device type: number of
devices, device models (e.g. `SUN2000-10KTL-M1`), firmware versions, all data fields with value type and an example
value, whether the field is part of the model, proposals for new model entries (`modelCandidates`), the last errors of
the API (kind, failCode, endpoint).

**Not contained:** plant codes, plant / device names, addresses, contact data, device ids, serial numbers, coordinates,
credentials, tokens. Free texts of unknown fields are replaced by `<text, n chars>`.

Please attach the export to a [GitHub issue](https://github.com/KornSW/ioBroker.fusionsolar/issues) if your system has
devices or values that are not (well) supported yet.

## `model.json` format (for maintainers)

```jsonc
{
    "schemaVersion": 1,             // format version (lib/model.js rejects other versions)
    "modelVersion": "2026-10-02",   // content version - update it with every change
    "enums": { "runState": { "0": "disconnected", "1": "connected" } },   // reusable common.states
    "station": { "info": [ ... ], "realtime": [ ... ] },                 // plant list / getStationRealKpi
    "device": { "info": [ ... ] },                                        // getDevList
    "deviceTypes": {
        "38": { "name": "Residential inverter", "desc": "Inverter", "realtime": true, "fieldSet": "inverter" },
        "62": { "name": "Dongle", "desc": "Dongle", "realtime": false }
    },
    "fieldSets": { "inverter": [ ... ] }
}
```

A field:

```jsonc
{ "key": "active_power",   // field name in the API response
  "id": "activePower",     // state id - PUBLIC INTERFACE, never rename an existing one
  "type": "number",        // number | string | boolean | mixed
  "role": "value.power",   // ioBroker role (must fit the type, see the role list)
  "unit": "kW",            // optional - only the unit the API really delivers
  "states": "runState",    // optional - name of an enum
  "desc": "...",           // optional - written to common.desc
  "source": "observed"     // optional - if not taken from the official reference
}
```

Templates: `"repeat": { "from": 1, "to": 24 }` with the placeholders `{n}` / `{nn}` (two digits), e.g.
`pv{n}_u` -> `PV.pv{nn}u`; `"tariffs": true` with `{dir}` (positive/reverse) and `{period}` (peak/top/valley/power).
One API field may be mapped to several states (backward compatible duplicates).

`deviceTypes.*.desc` is written to the state `devTypeDesc` (keep the existing values).

### Adding a field / device type from a diagnostic export

1. Take the entries of `modelCandidates` (or `fields` with `"inModel": false`) of the export.
2. Verify name, unit and role with the official reference ([RATE-LIMITS.md](RATE-LIMITS.md) lists the sources) or with
   the example values (e.g. `0.18` for a 10 kW inverter at dusk = kW, `1537` for a meter = W).
3. Add them to the matching `fieldSets` entry (new device type: new `deviceTypes` entry + `fieldSet`).
   **Important:** an unknown field was so far written with its API name as state id (e.g. `ex_active_power`). If the
   model entry uses a different id (e.g. `exActivePower`), users get a new state and the generic one stays - choose
   the id consciously and mention it in the changelog.
4. Update `modelVersion`, run `npm run test:js` (validates the model and checks that no existing id was lost against
   `test/fixtures/legacy-state-ids.json`) and document the change in the README changelog.
5. Never remove or rename existing ids. To change a unit or role, just change it - the adapter updates existing objects
   and removes units / enum texts which the model no longer defines (custom settings like history are kept).
