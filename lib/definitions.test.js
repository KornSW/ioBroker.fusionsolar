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
