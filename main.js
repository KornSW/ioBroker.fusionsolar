'use strict';

const utils = require('@iobroker/adapter-core');
const { FusionSolarApi, FusionSolarApiError } = require('./lib/fusionSolarApi');
const definitions = require('./lib/definitions');
const { DataModel, loadModel } = require('./lib/model');
const ioPackage = require('./io-package.json');

/** files in the file storage of the instance (meta object "fusionsolar.<n>") */
const LEARNED_MODEL_FILE = 'model/learned-model.json';
const DIAGNOSTIC_EXPORT_FILE = 'model/diagnostic-export.json';
/** failCodes meaning "this interface does not support the device type" */
const UNSUPPORTED_DEVICE_TYPE_FAIL_CODES = [20006, 20013];

const DEFAULT_API_HOST = 'eu5.fusionsolar.huawei.com';
const MIN_POLL_INTERVAL_SEC = 60;
const DEFAULT_POLL_INTERVAL_SEC = 300;
const MIN_TIMESLOT_SEC = 1;
const DEFAULT_TIMESLOT_SEC = 3;

/** station and device lists are reloaded once a day (the API allows only a few calls per day) */
const STRUCTURE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** upper limit for the wait time after subsequent errors */
const MAX_ERROR_BACKOFF_MS = 60 * 60 * 1000;
/** wait time after a failed login (to avoid that the API account gets locked) */
const AUTH_ERROR_BACKOFF_MS = 60 * 60 * 1000;

/**
 * @typedef {object} StationEntry
 * @property {string} code - stationCode (gen-1) or plantCode (gen-2)
 * @property {string} folder - object id of the station folder
 * @property {Record<string, any>} info - station info as delivered by the API
 */

/**
 * @typedef {object} DeviceEntry
 * @property {string} id - device id as string
 * @property {number} devTypeId - device type id of the API
 * @property {string} folder - object id of the device folder
 * @property {import('./lib/model').DeviceType} type - definition of the device type
 * @property {Record<string, any>} info - device info as delivered by the API
 */

/**
 * @typedef {'auto' | 'gen-1' | 'gen-2'} ApiVersion
 */

/**
 * ioBroker adapter for the Huawei FusionSolar northbound API.
 */
class FusionSolarConnector extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] adapter options
     */
    constructor(options = {}) {
        super({
            ...options,
            name: 'fusionsolar',
        });

        /** @type {FusionSolarApi | null} */
        this.api = null;
        /** @type {StationEntry[]} */
        this.stations = [];
        /** @type {DeviceEntry[]} */
        this.devices = [];
        this.structureLoadedAt = 0;
        this.iteration = 0;
        this.consecutiveErrors = 0;
        this.pollIntervalMs = DEFAULT_POLL_INTERVAL_SEC * 1000;
        /** @type {ioBroker.Timeout | undefined} */
        this.pollTimer = undefined;
        this.unloading = false;
        /** object ids which were already created / updated during this adapter run */
        this.ensuredObjects = new Set();
        /** effective data model (lib/model.json + learned at runtime) */
        this.model = new DataModel();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setState('info.connection', false, true);
        await this.initModel();

        const config = this.readConfig();
        if (!config) {
            return;
        }
        this.pollIntervalMs = config.pollIntervalSec * 1000;

        this.api = new FusionSolarApi({
            host: config.apiHost,
            userName: config.username,
            systemCode: config.password,
            apiVersion: config.apiVersion,
            callIntervalMs: config.timeslotSec * 1000,
            retryOnQuotaError: config.apiRetry,
            log: this.log,
            delay: ms => this.delay(ms),
        });

        await this.ensureObject('lastUpdate', {
            type: 'state',
            common: {
                name: 'Time of the last successful update',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });

        this.subscribeStates('*.updatePriority');

        await this.poll();
    }

    /**
     * Validates the adapter configuration.
     *
     * @returns {{ username: string, password: string, apiHost: string, apiVersion: ApiVersion, pollIntervalSec: number, timeslotSec: number, apiRetry: boolean } | null} the validated config or null if invalid
     */
    readConfig() {
        const username = String(this.config.username || '').trim();
        const password = String(this.config.client_secret || '');
        if (!username || !password) {
            this.log.error(
                'Please enter user name and password of your FusionSolar northbound API account in the adapter settings!',
            );
            return null;
        }

        let pollIntervalSec = Number(this.config.polltime);
        if (!Number.isFinite(pollIntervalSec) || pollIntervalSec < MIN_POLL_INTERVAL_SEC) {
            this.log.warn(
                `Poll interval "${this.config.polltime}" is too short (${MIN_POLL_INTERVAL_SEC} seconds is the minimum) -> using ${DEFAULT_POLL_INTERVAL_SEC} seconds`,
            );
            pollIntervalSec = DEFAULT_POLL_INTERVAL_SEC;
        }

        let timeslotSec = Number(this.config.timeslotlength);
        if (!Number.isFinite(timeslotSec) || timeslotSec < MIN_TIMESLOT_SEC) {
            this.log.warn(
                `Wait time between API calls "${this.config.timeslotlength}" is too short (${MIN_TIMESLOT_SEC} second is the minimum) -> using ${DEFAULT_TIMESLOT_SEC} seconds`,
            );
            timeslotSec = DEFAULT_TIMESLOT_SEC;
        }

        /** @type {ApiVersion} */
        let apiVersion = 'auto';
        const configuredVersion = String(this.config.apiVersion || 'default');
        if (configuredVersion === 'gen-1' || configuredVersion === 'gen-2') {
            apiVersion = configuredVersion;
            this.log.info(`Using the explicitly configured API generation "${apiVersion}"`);
        } else if (configuredVersion !== 'default') {
            this.log.warn(`Unknown API generation "${configuredVersion}" -> detecting it automatically`);
        }

        return {
            username,
            password,
            apiHost: String(this.config.apiHost || '').trim() || DEFAULT_API_HOST,
            apiVersion,
            pollIntervalSec,
            timeslotSec,
            apiRetry: this.config.apiRetry !== false,
        };
    }

    /**
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.unloading = true;
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = undefined;
            }
            void this.setState('info.connection', false, true);
            callback();
        } catch {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (!state || state.ack || !id.endsWith('.updatePriority')) {
            return;
        }
        const priority = Number(state.val);
        if (!Number.isInteger(priority) || !(priority in definitions.UPDATE_PRIORITY_STATES)) {
            this.log.warn(`Invalid update priority "${state.val}" for ${id} (allowed: 0..6) -> ignored`);
            return;
        }
        // confirm the new value
        await this.setState(id, priority, true);
    }

    /**
     * Messages from the admin UI (jsonConfig "sendTo" button).
     *
     * @param {ioBroker.Message} obj the message
     */
    async onMessage(obj) {
        if (!obj || obj.command !== 'diagnosticExport') {
            return;
        }
        let response;
        try {
            await this.saveModelFiles(true);
            // "openUrl": the admin (jsonConfig sendTo) opens the file in a new browser tab
            const url = `/files/${this.namespace}/${DIAGNOSTIC_EXPORT_FILE}`;
            response = { result: `Diagnostic export created: ${url}`, openUrl: url, window: '_blank' };
        } catch (error) {
            response = { error: `Diagnostic export failed: ${error && error.message ? error.message : error}` };
        }
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, response, obj.callback);
        }
    }

    /*************************************************************************
     * DATA MODEL (lib/model.json + learned at runtime, see doc/MODEL.md)
     **************************************************************************/

    /**
     * Creates the file storage of the instance and loads the learned model.
     */
    async initModel() {
        try {
            await this.setObjectNotExistsAsync(this.namespace, {
                type: 'meta',
                common: { name: 'FusionSolar data model and diagnostics', type: 'meta.user' },
                native: {},
            });
            let learned = null;
            try {
                const file = await this.readFileAsync(this.namespace, LEARNED_MODEL_FILE);
                learned = JSON.parse(String(file.file));
            } catch {
                // first start - nothing learned yet
            }
            this.model = new DataModel(loadModel(), learned);
            await this.saveModelFiles(true);
        } catch (error) {
            this.log.warn(
                `Could not initialize the learned data model: ${error && error.message ? error.message : error}`,
            );
        }
    }

    /**
     * Saves the learned model and the diagnostic export to the file storage of the instance.
     *
     * @param {boolean} [force] save even if nothing changed
     */
    async saveModelFiles(force = false) {
        if (!force && !this.model.dirty) {
            return;
        }
        const learnedJson = JSON.stringify(this.model.learned, null, 2);
        await this.writeFileAsync(this.namespace, LEARNED_MODEL_FILE, learnedJson);
        const exportJson = JSON.stringify(
            this.model.createDiagnosticExport({
                adapterVersion: ioPackage.common.version,
                nodeVersion: process.version,
                apiGeneration: this.api ? this.api.apiVersion : 'not configured',
                apiHost: this.config.apiHost || '',
                pollIntervalSec: Math.round(this.pollIntervalMs / 1000),
                stations: this.stations.length,
            }),
            null,
            2,
        );
        await this.writeFileAsync(this.namespace, DIAGNOSTIC_EXPORT_FILE, exportJson);
        this.model.dirty = false;
    }

    /*************************************************************************
     * POLLING
     **************************************************************************/

    async poll() {
        this.pollTimer = undefined;
        let nextPollMs = this.pollIntervalMs;
        try {
            await this.updateAll();
            this.consecutiveErrors = 0;
            await this.setState('info.connection', true, true);
        } catch (error) {
            if (this.unloading) {
                return;
            }
            this.consecutiveErrors++;
            this.model.recordError(error);
            this.model.dirty = true;
            nextPollMs = this.handlePollError(error);
            await this.setState('info.connection', false, true);
        }
        try {
            await this.saveModelFiles();
        } catch (error) {
            this.log.debug(`Could not save the learned data model: ${error && error.message ? error.message : error}`);
        }
        if (!this.unloading) {
            this.pollTimer = this.setTimeout(() => this.poll(), nextPollMs);
        }
    }

    /**
     * Logs the error of a failed update cycle and returns the time to wait until the next attempt.
     *
     * @param {any} error
     * @returns {number} milliseconds
     */
    handlePollError(error) {
        const backoffMs = Math.min(this.pollIntervalMs * 2 ** (this.consecutiveErrors - 1), MAX_ERROR_BACKOFF_MS);
        const nextAttempt = `next attempt in ${Math.round(backoffMs / 60000)} minute(s)`;

        if (!(error instanceof FusionSolarApiError)) {
            this.log.error(`Update failed: ${error && error.stack ? error.stack : error} - ${nextAttempt}`);
            return backoffMs;
        }
        switch (error.kind) {
            case 'auth':
                this.log.error(`${error.message} - next attempt in ${AUTH_ERROR_BACKOFF_MS / 60000} minutes`);
                return AUTH_ERROR_BACKOFF_MS;
            case 'permission':
                this.log.error(
                    `${error.message} - please check the setting "API generation" and the permissions of your API account - ${nextAttempt}`,
                );
                return backoffMs;
            case 'quota':
                this.log.warn(
                    `${error.message} - the API limits the number of calls, please consider to increase the poll interval - ${nextAttempt}`,
                );
                return backoffMs;
            default:
                this.log.error(`${error.message} - ${nextAttempt}`);
                return backoffMs;
        }
    }

    async updateAll() {
        if (!this.api) {
            return;
        }
        this.iteration++;

        if (!this.stations.length || Date.now() - this.structureLoadedAt > STRUCTURE_REFRESH_INTERVAL_MS) {
            await this.loadStructure();
        }
        await this.updateStationKpis();
        await this.updateDeviceKpis(this.iteration);

        await this.setState('lastUpdate', new Date().toLocaleTimeString(), true);
        this.log.debug(`update cycle #${this.iteration} completed`);
    }

    /**
     * Loads stations and devices from the API and creates their objects.
     */
    async loadStructure() {
        if (!this.api) {
            return;
        }
        const stationInfos = await this.api.getStations();
        if (!stationInfos.length) {
            throw new Error('The API did not return any station (plant) for this account');
        }

        this.stations = [];
        for (const info of stationInfos) {
            const code = info.stationCode ?? info.plantCode;
            if (code === undefined || code === null || code === '') {
                this.log.warn(`Ignoring a station without code: ${JSON.stringify(info)}`);
                continue;
            }
            const station = { code: String(code), folder: this.toObjectId(code), info };
            this.stations.push(station);
            await this.writeStationInfo(station);
        }

        const deviceInfos = await this.api.getDevList(this.stations.map(station => station.code));
        this.model.observeDeviceList(deviceInfos);
        this.devices = [];
        for (const info of deviceInfos) {
            const devTypeId = Number(info.devTypeId);
            const type = this.model.getDeviceType(devTypeId);
            if (type.optimizer && this.config.skipOptimizers) {
                this.log.debug(`skipping optimizer ${info.id} (see adapter settings)`);
                continue;
            }
            if (!type.known && this.config.skipUnknownDevices) {
                this.log.debug(`skipping device ${info.id} of unknown type ${devTypeId} (see adapter settings)`);
                continue;
            }
            const device = {
                id: String(info.id),
                devTypeId,
                folder: `${this.getStationFolder(info)}.${this.toObjectId(info.id)}`,
                type,
                info,
            };
            this.devices.push(device);
            await this.writeDeviceInfo(device);
        }

        this.structureLoadedAt = Date.now();
        this.log.info(
            `Loaded ${this.stations.length} station(s) with ${deviceInfos.length} device(s) - ${this.devices.length} device(s) will be updated`,
        );
    }

    /**
     * @param {Record<string, any>} deviceInfo
     */
    getStationFolder(deviceInfo) {
        const code = deviceInfo.stationCode ?? deviceInfo.plantCode;
        if (code !== undefined && code !== null && code !== '') {
            return this.toObjectId(code);
        }
        if (this.stations.length === 1) {
            return this.stations[0].folder;
        }
        return '(unknown-station)';
    }

    async updateStationKpis() {
        if (!this.api || !this.stations.length) {
            return;
        }
        const kpis = await this.api.getStationRealKpi(this.stations.map(station => station.code));
        for (const station of this.stations) {
            const kpi = kpis.get(station.code);
            if (!kpi) {
                this.log.debug(`no realtime KPIs returned for station ${station.code}`);
                continue;
            }
            this.model.observeStationRealtime(kpi);
            const kpiFolder = `${station.folder}.kpi.realtime`;
            await this.ensureFolder(`${station.folder}.kpi`, 'KPIs', 'folder');
            await this.ensureFolder(kpiFolder, 'Realtime KPIs', 'channel');
            await this.writeFields(
                kpiFolder,
                this.model.stationRealtimeFields(kpi, key => this.toObjectId(key)),
                kpi,
            );
            await this.writeLastUpdate(kpiFolder);
            await this.writeLastUpdate(station.folder);
        }
    }

    /**
     * @param {number} iteration
     */
    async updateDeviceKpis(iteration) {
        if (!this.api) {
            return;
        }

        const dueDevicesByType = new Map();
        for (const device of this.devices) {
            if (!this.model.isRealtimeSupported(device.devTypeId)) {
                // getDevRealKpi does not support this type (e.g. dongles, optimizers) -> save the API call
                continue;
            }
            const priority = await this.getUpdatePriority(device);
            if (!definitions.isDueForUpdate(priority, iteration)) {
                this.log.debug(`skipping device ${device.id} in this cycle (update priority ${priority})`);
                continue;
            }
            const list = dueDevicesByType.get(device.devTypeId) || [];
            list.push(device);
            dueDevicesByType.set(device.devTypeId, list);
        }

        for (const [devTypeId, devices] of dueDevicesByType) {
            let kpis;
            try {
                kpis = await this.api.getDevRealKpi(
                    devices.map(device => device.id),
                    devTypeId,
                );
            } catch (error) {
                // errors of a single device type must not stop the update of the other types - except errors which
                // affect the whole account (quota, login, network): they are handled by the poll cycle
                if (!(error instanceof FusionSolarApiError) || error.kind !== 'api') {
                    throw error;
                }
                this.model.recordError(error);
                if (error.failCode !== undefined && UNSUPPORTED_DEVICE_TYPE_FAIL_CODES.includes(error.failCode)) {
                    this.model.markRealtimeUnsupported(devTypeId, `failCode ${error.failCode}`);
                    this.log.info(
                        `The API does not deliver realtime data for device type ${devTypeId} (${this.model.getDeviceType(devTypeId).name}) - it will no longer be requested`,
                    );
                } else {
                    this.log.warn(`Realtime data of device type ${devTypeId} could not be loaded: ${error.message}`);
                }
                continue;
            }
            for (const device of devices) {
                const kpi = kpis.get(device.id);
                if (!kpi) {
                    this.log.debug(`no realtime KPIs returned for device ${device.id}`);
                    continue;
                }
                await this.writeDeviceKpis(device, kpi);
            }
        }
    }

    /**
     * @param {DeviceEntry} device
     * @returns {Promise<number>}
     */
    async getUpdatePriority(device) {
        const state = await this.getStateAsync(`${device.folder}.updatePriority`);
        const priority = state ? Number(state.val) : NaN;
        return Number.isInteger(priority) ? priority : definitions.DEFAULT_UPDATE_PRIORITY;
    }

    /*************************************************************************
     * OBJECTS & STATES
     **************************************************************************/

    /**
     * @param {StationEntry} station
     */
    async writeStationInfo(station) {
        const name = station.info.stationName || station.info.plantName || station.code;
        await this.ensureFolder(station.folder, String(name), 'folder');
        const fields = this.model.resolveFields(this.model.model.station.info, station.info, key =>
            this.toObjectId(key),
        );
        await this.writeFields(station.folder, fields, station.info);
    }

    /**
     * @param {DeviceEntry} device
     */
    async writeDeviceInfo(device) {
        await this.ensureFolder(device.folder, String(device.info.devName || device.id), 'device');
        const fields = this.model.resolveFields(this.model.model.device.info, device.info, key => this.toObjectId(key));
        await this.writeFields(device.folder, fields, device.info);
        await this.writeFields(
            device.folder,
            [{ key: 'devTypeDesc', id: 'devTypeDesc', type: 'string', role: 'text' }],
            { devTypeDesc: device.type.desc },
        );

        const priorityId = `${device.folder}.updatePriority`;
        await this.ensureObject(priorityId, {
            type: 'state',
            common: {
                name: 'Loading frequency of this device',
                type: 'number',
                role: 'level',
                states: definitions.UPDATE_PRIORITY_STATES,
                min: 0,
                max: definitions.FREQUENCIES_PER_PRIORITY.length - 1,
                def: definitions.DEFAULT_UPDATE_PRIORITY,
                read: true,
                write: true,
            },
            native: {},
        });
        const priorityState = await this.getStateAsync(priorityId);
        if (!priorityState || priorityState.val === null || priorityState.val === undefined) {
            await this.setState(priorityId, definitions.DEFAULT_UPDATE_PRIORITY, true);
        }
    }

    /**
     * @param {DeviceEntry} device
     * @param {Record<string, any>} kpi
     */
    async writeDeviceKpis(device, kpi) {
        this.model.observeDeviceRealtime(device.devTypeId, kpi);
        const kpiFolder = `${device.folder}.kpi.realtime`;
        const fields = this.model.deviceRealtimeFields(device.devTypeId, kpi, key => this.toObjectId(key));

        await this.ensureFolder(`${device.folder}.kpi`, 'KPIs', 'folder');
        await this.ensureFolder(kpiFolder, 'Realtime KPIs', 'channel');
        await this.writeFields(kpiFolder, fields, kpi);
        await this.writeLastUpdate(kpiFolder);
        await this.writeLastUpdate(device.folder);
    }

    /**
     * @param {string} folder
     */
    async writeLastUpdate(folder) {
        await this.writeFields(folder, [{ key: 'lastUpdate', id: 'lastUpdate', type: 'string', role: 'text' }], {
            lastUpdate: new Date().toLocaleTimeString(),
        });
    }

    /**
     * Writes all fields which are contained in the data object (null / undefined values are skipped).
     *
     * @param {string} parentId
     * @param {import('./lib/model').FieldDefinition[]} fields
     * @param {Record<string, any>} data
     */
    async writeFields(parentId, fields, data) {
        for (const field of fields) {
            const value = convertValue(data[field.key], field.type);
            if (value === undefined) {
                continue;
            }
            const id = `${parentId}.${field.id}`;

            const subFolders = field.id.split('.').slice(0, -1);
            for (let i = 1; i <= subFolders.length; i++) {
                const subFolder = subFolders.slice(0, i).join('.');
                await this.ensureFolder(`${parentId}.${subFolder}`, subFolder, 'channel');
            }

            const common = {
                name: field.id.split('.').pop() || field.id,
                type: field.type,
                role: field.role,
                read: true,
                write: false,
            };
            if (field.unit) {
                common.unit = field.unit;
            }
            if (field.states) {
                common.states = field.states;
            }
            if (field.desc) {
                common.desc = field.desc;
            }
            // unit / states which the model no longer defines (e.g. a wrong unit of an older version) are removed
            const obsolete = ['unit', 'states'].filter(key => !(key in common));
            await this.ensureObject(id, { type: 'state', common, native: {} }, obsolete);
            await this.setState(id, value, true);
        }
    }

    /**
     * @param {string} id
     * @param {string} name
     * @param {'folder' | 'device' | 'channel'} type
     */
    async ensureFolder(id, name, type) {
        await this.ensureObject(id, { type, common: { name }, native: {} });
    }

    /**
     * Creates the object or updates its definition (once per adapter run).
     * Using extendObject also updates roles / units of objects created by older adapter versions.
     *
     * @param {string} id the object id
     * @param {any} obj the (partial) object
     * @param {string[]} [obsoleteCommonKeys] common properties to remove if the existing object still has them
     */
    async ensureObject(id, obj, obsoleteCommonKeys = []) {
        if (this.ensuredObjects.has(id)) {
            return;
        }
        if (obsoleteCommonKeys.length) {
            const existing = await this.getObjectAsync(id);
            const toRemove = obsoleteCommonKeys.filter(key => existing && existing.common && key in existing.common);
            if (existing && toRemove.length) {
                // extendObject cannot delete properties -> write the merged object (keeps custom settings like history)
                const merged = { ...existing, common: { ...existing.common, ...obj.common } };
                for (const key of toRemove) {
                    delete merged.common[key];
                }
                await this.setObjectAsync(id, merged);
                this.ensuredObjects.add(id);
                return;
            }
        }
        await this.extendObject(id, obj);
        this.ensuredObjects.add(id);
    }

    /**
     * @param {string | number} value
     */
    toObjectId(value) {
        return String(value).replace(this.FORBIDDEN_CHARS, '_');
    }
}

/**
 * Converts a value of the API to the type of the state.
 *
 * @param {any} value
 * @param {ioBroker.CommonType} type
 * @returns {ioBroker.StateValue | undefined} undefined if the value cannot be written
 */
function convertValue(value, type) {
    if (value === undefined || value === null) {
        return undefined;
    }
    switch (type) {
        case 'number': {
            if (typeof value === 'number') {
                return Number.isFinite(value) ? value : undefined;
            }
            if (typeof value === 'string' && value.trim() !== '') {
                const num = Number(value);
                return Number.isFinite(num) ? num : undefined;
            }
            return undefined;
        }
        case 'string':
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
        case 'boolean':
            return Boolean(value);
        default:
            return typeof value === 'object' ? JSON.stringify(value) : value;
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new FusionSolarConnector(options);
} else {
    // otherwise start the instance directly
    new FusionSolarConnector();
}
