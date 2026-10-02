'use strict';

/*
 * Adapter specific constants which are not part of the data model.
 * The data model (device types, fields, units) lives in lib/model.json and lib/model.js.
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

module.exports = {
    FREQUENCIES_PER_PRIORITY,
    UPDATE_PRIORITY_STATES,
    DEFAULT_UPDATE_PRIORITY,
    isDueForUpdate,
};
