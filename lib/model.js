'use strict';

/*
 * Dynamic data model: the shipped well-known model (lib/model.json) plus everything the adapter learns at runtime
 * (fields and device types the API delivers but the shipped model does not know yet).
 *
 * - Known fields get the ids, roles and units of model.json (ids are a public interface - never rename them).
 * - Unknown fields are written generically (id = field name) with an inferred type and - only for unambiguous
 *   field names - an inferred unit.
 * - Device types whose realtime data is not supported by the API are remembered, so they are not requested again.
 * - The learned model is persisted per instance and can be exported (anonymized) for diagnostics, so that new
 *   fields / device types can be added to model.json.
 * See doc/MODEL.md.
 */

const SHIPPED_MODEL = require('./model.json');

const SUPPORTED_SCHEMA_VERSION = 1;
const FIELD_TYPES = ['number', 'string', 'boolean', 'mixed'];
const TARIFF_DIRECTIONS = ['positive', 'reverse'];
const TARIFF_PERIODS = ['peak', 'top', 'valley', 'power'];
const MAX_LIST_ENTRIES = 20;
const MAX_RECENT_ERRORS = 20;

/**
 * @typedef {object} FieldDefinition
 * @property {string} key - field name in the API response
 * @property {string} id - state id (relative to the parent folder, may contain sub folders like 'AC.aI')
 * @property {ioBroker.CommonType} type - ioBroker common.type
 * @property {string} role - ioBroker common.role
 * @property {string} [unit] - ioBroker common.unit
 * @property {Record<string, string>} [states] - ioBroker common.states
 * @property {string} [desc] - description (used as common.desc)
 * @property {string} [source] - where the definition comes from, if not from the official reference
 * @property {boolean} [inferred] - true: generated at runtime for a field that is not part of model.json
 */

/**
 * @typedef {object} DeviceType
 * @property {number} id - devTypeId of the API
 * @property {string} name - human readable name
 * @property {string} desc - written to the 'devTypeDesc' state
 * @property {boolean} known - false: not part of model.json
 * @property {boolean} realtime - false: getDevRealKpi does not support this type (never requested)
 * @property {boolean} [optimizer] - true: is controlled by config 'skipOptimizers'
 * @property {FieldDefinition[] | null} fields - well-known realtime fields (null: only generic fields)
 * @property {string} [source] - where the definition comes from, if not from the official reference
 */

/**
 * @typedef {object} LoadedModel
 * @property {number} schemaVersion - format version of model.json
 * @property {string} modelVersion - content version (date) of model.json
 * @property {{ info: FieldDefinition[], realtime: FieldDefinition[] }} station - station fields
 * @property {{ info: FieldDefinition[] }} device - device info fields (device list)
 * @property {Map<number, DeviceType>} deviceTypes - well-known device types
 */

/**
 * Expands the templates of model.json ("repeat", "tariffs") and resolves the enum references.
 *
 * @param {any[]} rawFields fields as written in model.json
 * @param {Record<string, Record<string, string>>} enums named enumerations of model.json
 * @param {string} context name of the field list (for error messages)
 * @returns {FieldDefinition[]} the expanded field definitions
 */
function expandFields(rawFields, enums, context) {
    /** @type {FieldDefinition[]} */
    const result = [];
    for (const raw of rawFields) {
        /** @type {Record<string, string>[]} */
        let variants = [{}];
        if (raw.repeat) {
            variants = [];
            for (let n = raw.repeat.from; n <= raw.repeat.to; n++) {
                variants.push({ n: String(n), nn: String(n).padStart(2, '0') });
            }
        } else if (raw.tariffs) {
            variants = [];
            for (const dir of TARIFF_DIRECTIONS) {
                for (const period of TARIFF_PERIODS) {
                    variants.push({ dir, period });
                }
            }
        }
        for (const variant of variants) {
            const fill = (/** @type {string} */ text) =>
                text.replace(/\{(\w+)\}/g, (_, name) => variant[name] ?? `{${name}}`);
            /** @type {FieldDefinition} */
            const field = { key: fill(raw.key), id: fill(raw.id), type: raw.type, role: raw.role };
            if (raw.unit) {
                field.unit = raw.unit;
            }
            if (raw.states) {
                if (!enums[raw.states]) {
                    throw new Error(`model.json: unknown enum "${raw.states}" in ${context}`);
                }
                field.states = enums[raw.states];
            }
            if (raw.desc) {
                field.desc = raw.desc;
            }
            if (raw.source) {
                field.source = raw.source;
            }
            if (!field.key || !field.id || /[{}]/.test(field.key + field.id)) {
                throw new Error(`model.json: invalid key/id "${field.key}"/"${field.id}" in ${context}`);
            }
            if (!FIELD_TYPES.includes(field.type) || !field.role) {
                throw new Error(`model.json: invalid type/role of "${field.key}" in ${context}`);
            }
            result.push(field);
        }
    }
    const ids = result.map(f => f.id);
    const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
    if (duplicate) {
        throw new Error(`model.json: duplicate state id "${duplicate}" in ${context}`);
    }
    return result;
}

/**
 * Loads and validates a model in the format of model.json.
 *
 * @param {any} json the parsed model (default: the shipped lib/model.json)
 * @returns {LoadedModel} the expanded model
 */
function loadModel(json = SHIPPED_MODEL) {
    if (!json || json.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        throw new Error(`model.json: unsupported schemaVersion ${json && json.schemaVersion}`);
    }
    const enums = json.enums || {};
    /** @type {Record<string, FieldDefinition[]>} */
    const fieldSets = {};
    for (const [name, list] of Object.entries(json.fieldSets || {})) {
        fieldSets[name] = expandFields(/** @type {any[]} */ (list), enums, `fieldSets.${name}`);
    }

    /** @type {Map<number, DeviceType>} */
    const deviceTypes = new Map();
    for (const [idText, raw] of Object.entries(json.deviceTypes || {})) {
        const id = Number(idText);
        if (!Number.isInteger(id)) {
            throw new Error(`model.json: invalid device type id "${idText}"`);
        }
        if (raw.fieldSet && !fieldSets[raw.fieldSet]) {
            throw new Error(`model.json: device type ${id} references unknown fieldSet "${raw.fieldSet}"`);
        }
        deviceTypes.set(id, {
            id,
            name: raw.name || `Device type ${id}`,
            desc: raw.desc || raw.name || 'Unknown',
            known: true,
            realtime: raw.realtime !== false,
            optimizer: !!raw.optimizer,
            fields: raw.fieldSet ? fieldSets[raw.fieldSet] : null,
            source: raw.source,
        });
    }

    return {
        schemaVersion: json.schemaVersion,
        modelVersion: json.modelVersion || 'unknown',
        station: {
            info: expandFields(json.station.info, enums, 'station.info'),
            realtime: expandFields(json.station.realtime, enums, 'station.realtime'),
        },
        device: { info: expandFields(json.device.info, enums, 'device.info') },
        deviceTypes,
    };
}

/**
 * Builds a field definition for a field that is not part of the model. The unit is only inferred for field names
 * which are unambiguous in the FusionSolar API (power fields are NOT inferred: W and kW are both used).
 *
 * @param {string} key the field name in the API response
 * @param {unknown} value an example value
 * @param {string} [id] the state id (default: the key)
 * @returns {FieldDefinition} the definition
 */
function inferField(key, value, id = key) {
    /** @type {ioBroker.CommonType} */
    let type = 'mixed';
    if (typeof value === 'number') {
        type = 'number';
    } else if (typeof value === 'string') {
        type = 'string';
    } else if (typeof value === 'boolean') {
        type = 'boolean';
    }
    /** @type {FieldDefinition} */
    const field = {
        key,
        id,
        type,
        role: type === 'number' ? 'value' : type === 'boolean' ? 'indicator' : 'text',
        inferred: true,
    };
    if (type !== 'number') {
        return field;
    }
    const name = key.toLowerCase();
    if (/(^|_)u$/.test(name)) {
        Object.assign(field, { role: 'value.voltage', unit: 'V' });
    } else if (/(^|_)i$/.test(name)) {
        Object.assign(field, { role: 'value.current', unit: 'A' });
    } else if (/_cap$/.test(name)) {
        Object.assign(field, { role: 'value.energy', unit: name.includes('reactive') ? 'kvarh' : 'kWh' });
    } else if (/temperature/.test(name)) {
        Object.assign(field, { role: 'value.temperature', unit: '°C' });
    } else if (/(^|_)(freq|frequency)$/.test(name)) {
        Object.assign(field, { role: 'value.frequency', unit: 'Hz' });
    } else if (/(^|_)soc$/.test(name)) {
        Object.assign(field, { role: 'value.battery', unit: '%' });
    } else if (/(^|_)time$/.test(name) && typeof value === 'number' && value > 946684800000) {
        Object.assign(field, { role: 'value.time' });
    }
    return field;
}

/**
 * Converts a snake_case field name into a camelCase id proposal (for new model.json entries).
 *
 * @param {string} key field name
 * @returns {string} id proposal
 */
function proposeId(key) {
    return key.replace(/_([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

/**
 * Example values of the export: numbers and booleans are kept (they help to identify units, e.g. W vs. kW),
 * free texts are redacted (they could contain serial numbers or names).
 *
 * @param {unknown} value the example value
 * @returns {unknown} the value for the export
 */
function sanitizeExample(value) {
    if (typeof value === 'string' && !/^(-?\d+(\.\d+)?|N\/A)$/.test(value.trim())) {
        return `<text, ${value.length} chars>`;
    }
    if (value !== null && typeof value === 'object') {
        return '<object>';
    }
    return value;
}

/**
 * @returns {any} an empty learned model
 */
function emptyLearned() {
    return { schemaVersion: 1, deviceTypes: {}, stationRealtime: { fields: {} } };
}

/**
 * The effective data model of one adapter instance.
 */
class DataModel {
    /**
     * @param {LoadedModel} [model] the well-known model (default: lib/model.json)
     * @param {any} [learned] persisted learned model of this instance
     */
    constructor(model = loadModel(), learned = null) {
        this.model = model;
        this.learned = learned && learned.schemaVersion === 1 ? learned : emptyLearned();
        this.learned.deviceTypes = this.learned.deviceTypes || {};
        this.learned.stationRealtime = this.learned.stationRealtime || { fields: {} };
        /** true if the learned model changed since the last save */
        this.dirty = false;
        /** @type {{ time: string, kind: string, failCode?: number, httpStatus?: number, message: string }[]} */
        this.recentErrors = [];
    }

    /**
     * @param {number} devTypeId device type id of the API
     * @returns {DeviceType} the definition (known or generic)
     */
    getDeviceType(devTypeId) {
        const known = this.model.deviceTypes.get(devTypeId);
        if (known) {
            return known;
        }
        const learned = this.learned.deviceTypes[devTypeId];
        return {
            id: devTypeId,
            name: `Unknown device type ${devTypeId}`,
            desc: 'Unknown',
            known: false,
            realtime: !(learned && learned.realtime === 'unsupported'),
            fields: null,
        };
    }

    /**
     * @param {number} devTypeId device type id of the API
     * @returns {boolean} true if realtime data may be requested for this device type
     */
    isRealtimeSupported(devTypeId) {
        const learned = this.learned.deviceTypes[devTypeId];
        if (learned && learned.realtime === 'unsupported') {
            return false;
        }
        return this.getDeviceType(devTypeId).realtime;
    }

    /**
     * Resolves the fields to write for a realtime data item map: well-known fields first, all other fields of the
     * response generically. A key may be mapped to several well-known states (legacy duplicates).
     *
     * @param {FieldDefinition[] | null} knownFields well-known fields of the device type / station
     * @param {Record<string, any>} data the dataItemMap of the API
     * @param {(key: string) => string} toId converts a field name into a valid state id
     * @returns {FieldDefinition[]} the fields to write
     */
    resolveFields(knownFields, data, toId) {
        const fields = (knownFields || []).filter(field => field.key in data);
        const knownKeys = new Set((knownFields || []).map(field => field.key));
        const usedIds = new Set(fields.map(field => field.id));
        for (const key of Object.keys(data)) {
            if (knownKeys.has(key)) {
                continue;
            }
            const id = toId(key);
            if (usedIds.has(id)) {
                continue; // never overwrite a well-known state with a generic one
            }
            usedIds.add(id);
            fields.push(inferField(key, data[key], id));
        }
        return fields;
    }

    /**
     * @param {number} devTypeId device type id of the API
     * @param {Record<string, any>} data the dataItemMap of the API
     * @param {(key: string) => string} toId converts a field name into a valid state id
     * @returns {FieldDefinition[]} the fields to write
     */
    deviceRealtimeFields(devTypeId, data, toId) {
        return this.resolveFields(this.getDeviceType(devTypeId).fields, data, toId);
    }

    /**
     * @param {Record<string, any>} data the dataItemMap of the API
     * @param {(key: string) => string} toId converts a field name into a valid state id
     * @returns {FieldDefinition[]} the fields to write
     */
    stationRealtimeFields(data, toId) {
        return this.resolveFields(this.model.station.realtime, data, toId);
    }

    /**
     * @param {number} devTypeId device type id of the API
     * @returns {any} the learned entry of the device type (created if missing)
     */
    learnedType(devTypeId) {
        let entry = this.learned.deviceTypes[devTypeId];
        if (!entry) {
            const now = new Date().toISOString();
            entry = {
                realtime: 'unknown',
                devices: 0,
                invTypes: [],
                softwareVersions: [],
                fields: {},
                firstSeen: now,
                lastSeen: now,
            };
            this.learned.deviceTypes[devTypeId] = entry;
            this.dirty = true;
        }
        return entry;
    }

    /**
     * Records the devices of the device list (count, models and firmware versions - no ids, no serial numbers).
     *
     * @param {Record<string, any>[]} deviceInfos devices as delivered by getDevList
     */
    observeDeviceList(deviceInfos) {
        /** @type {Map<number, Record<string, any>[]>} */
        const byType = new Map();
        for (const info of deviceInfos) {
            const devTypeId = Number(info.devTypeId);
            byType.set(devTypeId, [...(byType.get(devTypeId) || []), info]);
        }
        for (const [devTypeId, infos] of byType) {
            const entry = this.learnedType(devTypeId);
            if (entry.devices !== infos.length) {
                entry.devices = infos.length;
                this.dirty = true;
            }
            for (const info of infos) {
                this.addToList(entry.invTypes, info.invType);
                this.addToList(entry.softwareVersions, info.softwareVersion);
            }
            entry.lastSeen = new Date().toISOString();
        }
    }

    /**
     * @param {string[]} list list to extend
     * @param {any} value value to add (ignored if empty or already contained)
     */
    addToList(list, value) {
        if (value === undefined || value === null || value === '' || list.includes(String(value))) {
            return;
        }
        if (list.length < MAX_LIST_ENTRIES) {
            list.push(String(value));
            this.dirty = true;
        }
    }

    /**
     * Records the fields of a realtime response.
     *
     * @param {Record<string, any>} bucket learned fields ({ [key]: { type, example, inModel } })
     * @param {FieldDefinition[] | null} knownFields well-known fields
     * @param {Record<string, any>} data the dataItemMap of the API
     */
    observeFields(bucket, knownFields, data) {
        const knownKeys = new Set((knownFields || []).map(field => field.key));
        for (const [key, value] of Object.entries(data)) {
            const type = value === null || value === undefined ? 'null' : typeof value;
            const entry = bucket[key];
            if (!entry) {
                bucket[key] = { type, example: value, inModel: knownKeys.has(key) };
                this.dirty = true;
            } else {
                if (entry.type === 'null' && type !== 'null') {
                    entry.type = type;
                    this.dirty = true;
                }
                if (value !== null && value !== undefined && value !== 'N/A') {
                    entry.example = value;
                }
                entry.inModel = knownKeys.has(key);
            }
        }
    }

    /**
     * @param {number} devTypeId device type id of the API
     * @param {Record<string, any>} data the dataItemMap of the API
     */
    observeDeviceRealtime(devTypeId, data) {
        const entry = this.learnedType(devTypeId);
        if (entry.realtime !== 'supported') {
            entry.realtime = 'supported';
            delete entry.reason;
            this.dirty = true;
        }
        this.observeFields(entry.fields, this.getDeviceType(devTypeId).fields, data);
        entry.lastSeen = new Date().toISOString();
    }

    /**
     * @param {Record<string, any>} data the dataItemMap of getStationRealKpi
     */
    observeStationRealtime(data) {
        this.observeFields(this.learned.stationRealtime.fields, this.model.station.realtime, data);
    }

    /**
     * Remembers that the realtime interface does not support a device type (it will not be requested again).
     *
     * @param {number} devTypeId device type id of the API
     * @param {string} reason e.g. the failCode of the API
     */
    markRealtimeUnsupported(devTypeId, reason) {
        const entry = this.learnedType(devTypeId);
        entry.realtime = 'unsupported';
        entry.reason = reason;
        this.dirty = true;
    }

    /**
     * Keeps the last errors for the diagnostic export (no credentials / tokens are part of the error messages).
     *
     * @param {{ kind?: string, failCode?: number, httpStatus?: number, message?: string }} error the error
     */
    recordError(error) {
        this.recentErrors.unshift({
            time: new Date().toISOString(),
            kind: error.kind || 'unknown',
            failCode: error.failCode,
            httpStatus: error.httpStatus,
            message: String(error.message || error).slice(0, 300),
        });
        this.recentErrors.length = Math.min(this.recentErrors.length, MAX_RECENT_ERRORS);
    }

    /**
     * Creates the anonymized diagnostic export: device types, field names, value types and example measurement
     * values - but no plant codes, names, addresses, device ids, serial numbers, coordinates or credentials.
     *
     * @param {Record<string, any>} meta additional information (adapter version, API generation, ...)
     * @returns {any} the export
     */
    createDiagnosticExport(meta = {}) {
        /** @type {Record<string, any>} */
        const deviceTypes = {};
        const ids = new Set([...Object.keys(this.learned.deviceTypes).map(Number)]);
        for (const devTypeId of [...ids].sort((a, b) => a - b)) {
            const type = this.getDeviceType(devTypeId);
            const learned = this.learned.deviceTypes[devTypeId] || {};
            const knownByKey = new Map((type.fields || []).map(field => [field.key, field]));
            /** @type {Record<string, any>} */
            const fields = {};
            const candidates = [];
            for (const [key, observed] of Object.entries(learned.fields || {})) {
                const known = knownByKey.get(key);
                const example = sanitizeExample(observed.example);
                fields[key] = known
                    ? { inModel: true, id: known.id, unit: known.unit || null, type: observed.type, example }
                    : { inModel: false, type: observed.type, example };
                if (!known) {
                    const inferred = inferField(key, observed.example, proposeId(key));
                    candidates.push({
                        key,
                        id: inferred.id,
                        type: inferred.type,
                        role: inferred.role,
                        unit: inferred.unit,
                        source: 'diagnostic export',
                    });
                }
            }
            deviceTypes[devTypeId] = {
                name: type.name,
                inModel: type.known,
                realtime: learned.realtime || 'unknown',
                realtimeUnsupportedReason: learned.reason,
                devices: learned.devices || 0,
                invTypes: learned.invTypes || [],
                softwareVersions: learned.softwareVersions || [],
                fields,
                modelCandidates: candidates,
            };
        }
        /** @type {Record<string, any>} */
        const stationFields = {};
        const stationKnown = new Map(this.model.station.realtime.map(field => [field.key, field]));
        for (const [key, observed] of Object.entries(this.learned.stationRealtime.fields || {})) {
            const known = stationKnown.get(key);
            const example = sanitizeExample(observed.example);
            stationFields[key] = known
                ? { inModel: true, id: known.id, unit: known.unit || null, type: observed.type, example }
                : { inModel: false, type: observed.type, example };
        }
        return {
            exportFormat: 'iobroker.fusionsolar/model-diagnostics',
            exportVersion: 1,
            createdAt: new Date().toISOString(),
            modelVersion: this.model.modelVersion,
            ...meta,
            deviceTypes,
            stationRealtime: { fields: stationFields },
            recentErrors: this.recentErrors,
            note: 'Anonymized: contains no plant codes, names, addresses, device ids, serial numbers, coordinates or credentials. Please attach this file to a GitHub issue to get new fields / device types into the model.',
        };
    }
}

module.exports = { DataModel, loadModel, inferField, proposeId, expandFields };
