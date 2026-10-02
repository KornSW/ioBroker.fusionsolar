'use strict';

const { expect } = require('chai');
const definitions = require('./definitions');

describe('definitions => isDueForUpdate', () => {
    it('loads every device in the first cycle (even priority 0)', () => {
        expect(definitions.isDueForUpdate(0, 1)).to.equal(true);
        expect(definitions.isDueForUpdate(6, 1)).to.equal(true);
    });

    it('never reloads devices with priority 0', () => {
        for (let i = 2; i < 100; i++) {
            expect(definitions.isDueForUpdate(0, i)).to.equal(false);
        }
    });

    it('loads devices with priority 3 every 4th cycle', () => {
        const due = [];
        for (let i = 1; i <= 12; i++) {
            if (definitions.isDueForUpdate(3, i)) {
                due.push(i);
            }
        }
        expect(due).to.deep.equal([1, 5, 9]);
    });

    it('treats an unset priority as the default (every cycle)', () => {
        expect(definitions.isDueForUpdate(null, 7)).to.equal(true);
        expect(definitions.isDueForUpdate(undefined, 8)).to.equal(true);
    });
});

describe('definitions => device types', () => {
    it('treats residential inverters (38) like string inverters (1)', () => {
        expect(definitions.getDeviceType(38).kpiFields).to.equal(definitions.getDeviceType(1).kpiFields);
        expect(definitions.getDeviceType(38).known).to.equal(true);
    });

    it('returns "Unknown" for unknown types', () => {
        expect(definitions.getDeviceType(4711)).to.deep.include({ desc: 'Unknown', known: false });
    });

    it('delivers the battery power in W (issue #16)', () => {
        const field = definitions.BATTERY_KPI_FIELDS.find(f => f.key === 'ch_discharge_power');
        expect(field && field.unit).to.equal('W');
    });

    it('keeps the state ids of older adapter versions', () => {
        const ids = definitions.INVERTER_KPI_FIELDS.map(f => f.id);
        expect(ids).to.include.members(['activePower', 'AC.aI', 'MPPT.mppt01Cap', 'MPPT.mppt10Cap', 'PV.pv01u', 'PV.pv24i']);
    });

    it('has unique state ids per definition list', () => {
        for (const list of [
            definitions.STATION_INFO_FIELDS,
            definitions.STATION_REALTIME_KPI_FIELDS,
            definitions.DEVICE_INFO_FIELDS,
            definitions.INVERTER_KPI_FIELDS,
            definitions.METER_KPI_FIELDS,
            definitions.BATTERY_KPI_FIELDS,
        ]) {
            const ids = list.map(f => f.id);
            expect(new Set(ids).size).to.equal(ids.length);
        }
    });
});
