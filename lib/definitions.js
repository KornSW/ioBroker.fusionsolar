'use strict';

/*
 * Data driven state definitions for the FusionSolar northbound API ("thirdData").
 *
 * IMPORTANT: the `id` of every definition is part of the public interface of this adapter
 * (users reference these states in scripts and visualizations) - do not rename them!
 */

/**
 * @typedef {object} FieldDefinition
 * @property {string} key - field name in the API response
 * @property {string} id - state id (relative to the parent folder, may contain sub folders like 'AC.aI')
 * @property {ioBroker.CommonType} type - ioBroker common.type
 * @property {string} role - ioBroker common.role
 * @property {string} [unit] - ioBroker common.unit
 * @property {Record<string, string>} [states] - ioBroker common.states
 */

/**
 * Semantic of the array values: the device participates in every {x}-th update cycle.
 * The array index is the priority level (0 = only on the first cycle after adapter start).
 */
const FREQUENCIES_PER_PRIORITY = [0, 1, 2, 4, 8, 16, 32];

const UPDATE_PRIORITY_STATES = {
    0: "don't update",
    1: 'Level 1 (every time)',
    2: 'Level 2 (every 2nd time)',
    3: 'Level 3 (every 4th time)',
    4: 'Level 4 (every 8th time)',
    5: 'Level 5 (every 16th time)',
    6: 'Level 6 (every 32th time)',
};

const DEFAULT_UPDATE_PRIORITY = 1;

/** @type {FieldDefinition[]} */
const STATION_INFO_FIELDS = [
    // API-Version 'gen-1' (/getStationList)
    { key: 'stationCode', id: 'stationCode', type: 'string', role: 'info.name' },
    { key: 'stationName', id: 'stationName', type: 'string', role: 'info.name' },
    { key: 'stationAddr', id: 'stationAddr', type: 'string', role: 'info.address' },
    { key: 'stationLinkman', id: 'stationLinkman', type: 'string', role: 'text' },
    { key: 'linkmanPho', id: 'linkmanPho', type: 'string', role: 'text' },
    { key: 'aidType', id: 'aidType', type: 'number', role: 'value' },
    // API-Version 'gen-2' (/stations)
    { key: 'plantCode', id: 'plantCode', type: 'string', role: 'info.name' },
    { key: 'plantName', id: 'plantName', type: 'string', role: 'info.name' },
    { key: 'plantAddress', id: 'plantAddress', type: 'string', role: 'info.address' },
    { key: 'contactMethod', id: 'contactMethod', type: 'string', role: 'text' },
    { key: 'contactPerson', id: 'contactPerson', type: 'string', role: 'text' },
    { key: 'latitude', id: 'latitude', type: 'string', role: 'value.gps.latitude' },
    { key: 'longitude', id: 'longitude', type: 'string', role: 'value.gps.longitude' },
    { key: 'gridConnectionDate', id: 'gridConnectionDate', type: 'string', role: 'text' },
    // both (no unit: 'gen-1' delivers MW, 'gen-2' delivers kWp)
    { key: 'capacity', id: 'capacity', type: 'number', role: 'value' },
];

/** @type {FieldDefinition[]} */
const STATION_REALTIME_KPI_FIELDS = [
    { key: 'total_income', id: 'totalIncome', type: 'number', role: 'value' },
    { key: 'total_power', id: 'totalPower', type: 'number', role: 'value.energy', unit: 'kWh' },
    { key: 'month_power', id: 'monthPower', type: 'number', role: 'value.energy', unit: 'kWh' },
    { key: 'day_power', id: 'dayPower', type: 'number', role: 'value.energy', unit: 'kWh' },
    { key: 'day_income', id: 'dayIncome', type: 'number', role: 'value' },
    {
        key: 'real_health_state',
        id: 'realHealthState',
        type: 'number',
        role: 'value',
        states: { 1: 'disconnected', 2: 'faulty', 3: 'healthy' },
    },
];

/** @type {FieldDefinition[]} */
const DEVICE_INFO_FIELDS = [
    { key: 'id', id: 'id', type: 'number', role: 'value' },
    { key: 'devName', id: 'devName', type: 'string', role: 'info.name' },
    { key: 'devTypeId', id: 'devTypeId', type: 'number', role: 'value' },
    { key: 'esnCode', id: 'esnCode', type: 'string', role: 'info.serial' },
    { key: 'invType', id: 'invType', type: 'string', role: 'info.model' },
    { key: 'latitude', id: 'latitude', type: 'number', role: 'value.gps.latitude' },
    { key: 'longitude', id: 'longitude', type: 'number', role: 'value.gps.longitude' },
    { key: 'optimizerNumber', id: 'optimizerNumber', type: 'number', role: 'value' },
    { key: 'softwareVersion', id: 'softwareVersion', type: 'string', role: 'info.firmware' },
];

const RUN_STATES = { 0: 'disconnected', 1: 'connected' };

/** @type {FieldDefinition[]} */
const INVERTER_KPI_FIELDS = [
    { key: 'open_time', id: 'openTime', type: 'mixed', role: 'value' },
    { key: 'close_time', id: 'closeTime', type: 'mixed', role: 'value' },
    { key: 'active_power', id: 'activePower', type: 'number', role: 'value.power', unit: 'kW' },
    { key: 'reactive_power', id: 'reactivePower', type: 'number', role: 'value.power.reactive', unit: 'kvar' },
    { key: 'power_factor', id: 'powerFactor', type: 'number', role: 'value' },
    { key: 'run_state', id: 'runState', type: 'number', role: 'value', states: RUN_STATES },
    { key: 'inverter_state', id: 'inverterState', type: 'number', role: 'value' },
    { key: 'efficiency', id: 'efficiency', type: 'number', role: 'value', unit: '%' },
    { key: 'temperature', id: 'temperature', type: 'number', role: 'value.temperature', unit: '°C' },
    { key: 'elec_freq', id: 'elecFreq', type: 'number', role: 'value.frequency', unit: 'Hz' },
    { key: 'day_cap', id: 'dayCap', type: 'number', role: 'value.energy', unit: 'kWh' },
    { key: 'total_cap', id: 'totalCap', type: 'number', role: 'value.energy', unit: 'kWh' },

    // current per phase
    { key: 'a_i', id: 'AC.aI', type: 'number', role: 'value.current', unit: 'A' },
    { key: 'b_i', id: 'AC.bI', type: 'number', role: 'value.current', unit: 'A' },
    { key: 'c_i', id: 'AC.cI', type: 'number', role: 'value.current', unit: 'A' },
    // voltage per phase
    { key: 'a_u', id: 'AC.aU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'b_u', id: 'AC.bU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'c_u', id: 'AC.cU', type: 'number', role: 'value.voltage', unit: 'V' },
    // voltage between phases
    { key: 'ab_u', id: 'AC.abU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'bc_u', id: 'AC.bcU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'ca_u', id: 'AC.caU', type: 'number', role: 'value.voltage', unit: 'V' },

    // power and yield per MPPT
    { key: 'mppt_power', id: 'MPPT.mpptPower', type: 'number', role: 'value.power', unit: 'kW' },
    { key: 'mppt_total_cap', id: 'MPPT.mpptTotalCap', type: 'number', role: 'value.energy', unit: 'kWh' },
    ...range(1, 10).map(n => numberField(`mppt_${n}_cap`, `MPPT.mppt${pad(n)}Cap`, 'value.energy', 'kWh')),

    // voltage and current per string
    ...range(1, 24).flatMap(n => [
        numberField(`pv${n}_u`, `PV.pv${pad(n)}u`, 'value.voltage', 'V'),
        numberField(`pv${n}_i`, `PV.pv${pad(n)}i`, 'value.current', 'A'),
    ]),
];

/** @type {FieldDefinition[]} */
const METER_KPI_FIELDS = [
    { key: 'meter_status', id: 'meterStatus', type: 'number', role: 'value', states: { 0: 'offline', 1: 'normal' } },
    { key: 'active_power', id: 'activePower', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'active_power_a', id: 'activePowerA', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'active_power_b', id: 'activePowerB', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'active_power_c', id: 'activePowerC', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'reactive_power', id: 'reactivePower', type: 'number', role: 'value.power.reactive', unit: 'var' },
    { key: 'reactive_power_a', id: 'reactivePowerA', type: 'number', role: 'value.power.reactive', unit: 'var' },
    { key: 'reactive_power_b', id: 'reactivePowerB', type: 'number', role: 'value.power.reactive', unit: 'var' },
    { key: 'reactive_power_c', id: 'reactivePowerC', type: 'number', role: 'value.power.reactive', unit: 'var' },
    { key: 'power_factor', id: 'powerFactor', type: 'number', role: 'value' },
    { key: 'active_cap', id: 'activeCap', type: 'number', role: 'value.energy.consumed', unit: 'kWh' },
    { key: 'reverse_active_cap', id: 'reverseActiveCap', type: 'number', role: 'value.energy.produced', unit: 'kWh' },
    { key: 'meter_u', id: 'meterU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'meter_i', id: 'meterI', type: 'number', role: 'value.current', unit: 'A' },
    { key: 'b_u', id: 'bU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'b_i', id: 'bI', type: 'number', role: 'value.current', unit: 'A' },
    { key: 'c_u', id: 'cU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'c_i', id: 'cI', type: 'number', role: 'value.current', unit: 'A' },
    { key: 'ab_u', id: 'abU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'bc_u', id: 'bcU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'ca_u', id: 'caU', type: 'number', role: 'value.voltage', unit: 'V' },
    { key: 'grid_frequency', id: 'gridFrequency', type: 'number', role: 'value.frequency', unit: 'Hz' },
    { key: 'run_state', id: 'runState', type: 'number', role: 'value', states: RUN_STATES },
    // the following ids are kept in snake_case for backward compatibility
    ...[
        'reverse_reactive_valley',
        'reverse_reactive_peak',
        'reverse_active_peak',
        'reverse_active_cap',
        'reverse_reactive_power',
        'reverse_reactive_top',
        'reverse_active_valley',
        'positive_reactive_peak',
        'positive_reactive_top',
        'positive_reactive_valley',
        'positive_reactive_power',
        'positive_active_peak',
        'positive_active_top',
        'positive_active_valley',
        'positive_active_power',
    ].map(key => numberField(key, key, 'value.energy', key.includes('reactive') ? 'kvarh' : 'kWh')),
    { key: 'total_apparent_power', id: 'total_apparent_power', type: 'number', role: 'value.power', unit: 'kVA' },
];

/** @type {FieldDefinition[]} */
const BATTERY_KPI_FIELDS = [
    { key: 'run_state', id: 'runState', type: 'number', role: 'value', states: RUN_STATES },
    {
        key: 'battery_status',
        id: 'batteryStatus',
        type: 'number',
        role: 'value',
        states: { 0: 'offline', 1: 'standby', 2: 'running', 3: 'faulty', 4: 'hibernating' },
    },
    { key: 'battery_soh', id: 'batterySoh', type: 'number', role: 'value', unit: '%' },
    { key: 'battery_soc', id: 'batterySoc', type: 'number', role: 'value.battery', unit: '%' },
    { key: 'max_charge_power', id: 'maxChargePower', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'max_discharge_power', id: 'maxDischargePower', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'charge_cap', id: 'chargeCap', type: 'number', role: 'value.energy', unit: 'kWh' },
    { key: 'discharge_cap', id: 'dischargeCap', type: 'number', role: 'value.energy', unit: 'kWh' },
    // positive = charging, negative = discharging (the API delivers W, not kW!)
    { key: 'ch_discharge_power', id: 'chDischargePower', type: 'number', role: 'value.power', unit: 'W' },
    { key: 'ch_discharge_model', id: 'chDischargeModel', type: 'number', role: 'value' },
    { key: 'busbar_u', id: 'busbarU', type: 'number', role: 'value.voltage', unit: 'V' },
];

/**
 * @typedef {object} DeviceType
 * @property {string} desc - written to the 'devTypeDesc' state
 * @property {boolean} known - false: is treated as 'unknown' (see config 'skipUnknownDevices')
 * @property {boolean} [optimizer] - true: is controlled by config 'skipOptimizers'
 * @property {FieldDefinition[]} [kpiFields] - undefined: all fields of the response are written generically
 */

/** @type {Record<number, DeviceType>} */
const DEVICE_TYPES = {
    1: { desc: 'Inverter', known: true, kpiFields: INVERTER_KPI_FIELDS },
    38: { desc: 'Inverter', known: true, kpiFields: INVERTER_KPI_FIELDS }, // residential inverter (e.g. SUN2000-xKTL-L1/M1)
    39: { desc: 'Battery', known: true, kpiFields: BATTERY_KPI_FIELDS },
    46: { desc: 'Optimizer', known: true, optimizer: true },
    47: { desc: 'Meter', known: true, kpiFields: METER_KPI_FIELDS },
    62: { desc: 'Dongle', known: true, kpiFields: [] },
};

/**
 * @param {number} devTypeId the device type id of the API
 * @returns {DeviceType} the definition (or 'Unknown')
 */
function getDeviceType(devTypeId) {
    return DEVICE_TYPES[devTypeId] || { desc: 'Unknown', known: false };
}

/**
 * Builds a field definition for a field that is not explicitly known (used for unknown devices or optimizers).
 *
 * @param {string} key the field name in the API response
 * @param {unknown} value an example value (used to determine the type)
 * @param {string} [id] the state id (default: the key)
 * @returns {FieldDefinition} the definition
 */
function buildGenericField(key, value, id = key) {
    /** @type {ioBroker.CommonType} */
    let type = 'mixed';
    if (typeof value === 'number') {
        type = 'number';
    } else if (typeof value === 'string') {
        type = 'string';
    } else if (typeof value === 'boolean') {
        type = 'boolean';
    }
    return { key, id, type, role: type === 'number' ? 'value' : 'state' };
}

/**
 * Returns true if a device with the given priority level should be loaded in the given update cycle.
 *
 * @param {number | null | undefined} priority the configured update priority (0..6)
 * @param {number} iteration the number of the update cycle (1 = first cycle after adapter start)
 * @returns {boolean} true if due
 */
function isDueForUpdate(priority, iteration) {
    if (iteration <= 1) {
        return true;
    }
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0) {
        priority = DEFAULT_UPDATE_PRIORITY;
    }
    if (priority >= FREQUENCIES_PER_PRIORITY.length) {
        priority = FREQUENCIES_PER_PRIORITY.length - 1;
    }
    const frequency = FREQUENCIES_PER_PRIORITY[priority];
    if (frequency <= 0) {
        return false;
    }
    return (iteration - 1) % frequency === 0;
}

/**
 * @param {string} key field name in the API response
 * @param {string} id state id
 * @param {string} role ioBroker role
 * @param {string} unit ioBroker unit
 * @returns {FieldDefinition} the definition
 */
function numberField(key, id, role, unit) {
    return { key, id, type: 'number', role, unit };
}

/**
 * @param {number} from first number
 * @param {number} to last number (inclusive)
 * @returns {number[]} the numbers
 */
function range(from, to) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * @param {number} n the number
 * @returns {string} the number with a leading zero
 */
function pad(n) {
    return String(n).padStart(2, '0');
}

module.exports = {
    FREQUENCIES_PER_PRIORITY,
    UPDATE_PRIORITY_STATES,
    DEFAULT_UPDATE_PRIORITY,
    STATION_INFO_FIELDS,
    STATION_REALTIME_KPI_FIELDS,
    DEVICE_INFO_FIELDS,
    INVERTER_KPI_FIELDS,
    METER_KPI_FIELDS,
    BATTERY_KPI_FIELDS,
    DEVICE_TYPES,
    getDeviceType,
    buildGenericField,
    isDueForUpdate,
};
