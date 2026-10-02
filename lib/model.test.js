'use strict';

const { expect } = require('chai');
const { DataModel, loadModel, inferField, proposeId } = require('./model');
const legacy = require('../test/fixtures/legacy-state-ids.json');

const toId = key => key.replace(/[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu, '_');

/**
 * @param {{ key: string, id: string }[]} legacyFields fields of the old adapter version
 * @param {{ key: string, id: string }[]} modelFields fields of the current model
 */
function expectLegacyIdsKept(legacyFields, modelFields) {
    const pairs = new Set(modelFields.map(f => `${f.key} -> ${f.id}`));
    const missing = legacyFields.filter(f => !pairs.has(`${f.key} -> ${f.id}`)).map(f => `${f.key} -> ${f.id}`);
    expect(missing, 'state ids of v1.x / v2.0 must never change').to.deep.equal([]);
}

describe('model => model.json', () => {
    const model = loadModel();

    it('loads and validates the shipped model', () => {
        expect(model.schemaVersion).to.equal(1);
        expect(model.deviceTypes.size).to.be.greaterThan(10);
    });

    it('keeps every state id of the previous adapter versions (public interface!)', () => {
        expectLegacyIdsKept(legacy.station.info, model.station.info);
        expectLegacyIdsKept(legacy.station.realtime, model.station.realtime);
        expectLegacyIdsKept(legacy.device.info, model.device.info);
        for (const [id, type] of Object.entries(legacy.deviceTypes)) {
            const current = model.deviceTypes.get(Number(id));
            expect(current, `device type ${id}`).to.not.equal(undefined);
            expect(current.desc, `devTypeDesc of ${id}`).to.equal(type.desc);
            expectLegacyIdsKept(type.fields, current.fields || []);
        }
    });

    it('expands the templates (strings, MPPTs, tariffs)', () => {
        const inverter = model.deviceTypes.get(1).fields;
        expect(inverter.find(f => f.key === 'pv24_i')).to.include({ id: 'PV.pv24i', unit: 'A' });
        expect(inverter.find(f => f.key === 'mppt_10_cap')).to.include({ id: 'MPPT.mppt10Cap', unit: 'kWh' });
        const meter = model.deviceTypes.get(47).fields;
        expect(meter.find(f => f.key === 'positive_active_valley')).to.include({ unit: 'kWh' });
        expect(meter.find(f => f.key === 'reverse_reactive_peak')).to.include({ unit: 'kvarh' });
    });

    it('uses the official units (type dependent!)', () => {
        const unit = (typeId, key) => model.deviceTypes.get(typeId).fields.find(f => f.key === key).unit;
        expect(unit(1, 'active_power')).to.equal('kW');
        expect(unit(1, 'reactive_power')).to.equal('kvar');
        expect(unit(17, 'active_power')).to.equal('kW'); // grid meter
        expect(unit(47, 'active_power')).to.equal('W'); // power sensor
        expect(unit(39, 'ch_discharge_power')).to.equal('W');
        expect(unit(39, 'battery_soh')).to.equal(undefined);
        expect(unit(10, 'radiant_line')).to.equal('W/m²');
    });

    it('marks the types without realtime support (no getDevRealKpi call)', () => {
        expect(model.deviceTypes.get(62).realtime).to.equal(false); // dongle
        expect(model.deviceTypes.get(46).realtime).to.equal(false); // optimizer (failCode 20013)
        expect(model.deviceTypes.get(38).realtime).to.equal(true);
    });

    it('has enum texts for the status codes', () => {
        const state = model.deviceTypes.get(1).fields.find(f => f.key === 'inverter_state');
        expect(state.states['512']).to.equal('grid-connected');
        const mode = model.deviceTypes.get(39).fields.find(f => f.key === 'ch_discharge_model');
        expect(mode.states['10']).to.equal('AI energy control');
    });

    it('rejects broken models', () => {
        expect(() => loadModel({ schemaVersion: 2 })).to.throw(/schemaVersion/);
        const base = { schemaVersion: 1, station: { info: [], realtime: [] }, device: { info: [] } };
        expect(() => loadModel({ ...base, deviceTypes: { 1: { fieldSet: 'x' } } })).to.throw(/unknown fieldSet/);
        expect(() =>
            loadModel({
                ...base,
                fieldSets: { a: [{ key: 'a', id: 'x', type: 'number', role: 'value' }, { key: 'b', id: 'x', type: 'number', role: 'value' }] },
            }),
        ).to.throw(/duplicate state id/);
    });
});

describe('model => dynamic fields', () => {
    it('writes known fields with model metadata and unknown fields generically', () => {
        const dm = new DataModel();
        const fields = dm.deviceRealtimeFields(1, { active_power: 1.2, brand_new_u: 230, mystery: 'x' }, toId);
        expect(fields.find(f => f.key === 'active_power')).to.include({ id: 'activePower', unit: 'kW' });
        expect(fields.find(f => f.key === 'brand_new_u')).to.include({ id: 'brand_new_u', unit: 'V', inferred: true });
        expect(fields.find(f => f.key === 'mystery')).to.include({ type: 'string', role: 'text' });
    });

    it('writes all fields of unknown device types generically', () => {
        const dm = new DataModel();
        expect(dm.getDeviceType(4711)).to.include({ known: false, desc: 'Unknown', realtime: true });
        const fields = dm.deviceRealtimeFields(4711, { some_power: 5 }, toId);
        expect(fields).to.have.length(1);
        expect(fields[0]).to.include({ id: 'some_power', type: 'number', role: 'value' });
        expect(fields[0].unit).to.equal(undefined); // power units are never guessed (W or kW)
    });

    it('also maps one API field to legacy duplicate states', () => {
        const dm = new DataModel();
        const fields = dm.deviceRealtimeFields(47, { reverse_active_cap: 12 }, toId);
        expect(fields.map(f => f.id)).to.have.members(['reverseActiveCap', 'reverse_active_cap']);
    });

    it('infers units only for unambiguous field names', () => {
        expect(inferField('pv30_u', 1)).to.include({ unit: 'V' });
        expect(inferField('x_i', 1)).to.include({ unit: 'A' });
        expect(inferField('ex_reactive_cap', 1)).to.include({ unit: 'kvarh' });
        expect(inferField('new_temperature', 1)).to.include({ unit: '°C' });
        expect(inferField('active_power_x', 1).unit).to.equal(undefined);
        expect(proposeId('ex_active_power')).to.equal('exActivePower');
    });
});

describe('model => learning and diagnostic export', () => {
    it('remembers device types without realtime support', () => {
        const dm = new DataModel();
        expect(dm.isRealtimeSupported(4711)).to.equal(true);
        dm.markRealtimeUnsupported(4711, 'failCode 20013');
        expect(dm.isRealtimeSupported(4711)).to.equal(false);
        // survives a restart (learned model is persisted as JSON)
        const restored = new DataModel(undefined, JSON.parse(JSON.stringify(dm.learned)));
        expect(restored.isRealtimeSupported(4711)).to.equal(false);
    });

    it('creates an anonymized export with model candidates', () => {
        const dm = new DataModel();
        dm.observeDeviceList([
            { id: 1000000035436846, devTypeId: 1, devName: 'Inverter-1', esnCode: 'HV2240468303', invType: 'SUN2000-10KTL-M1', softwareVersion: 'V100R001C00SPC141', latitude: 49.9, longitude: 8.2, stationCode: 'NE=35436844' },
            { id: 1000000035436899, devTypeId: 23999, devName: 'Mystery', esnCode: 'XX123', stationCode: 'NE=35436844' },
        ]);
        dm.observeDeviceRealtime(1, { active_power: 0.18, new_field_u: 230.1 });
        dm.observeDeviceRealtime(23999, { secret_text: 'Owner Max Mustermann', some_power: 3.5 });
        dm.recordError({ kind: 'quota', failCode: 407, message: '/getDevRealKpi: access frequency is too high' });

        const exp = dm.createDiagnosticExport({ adapterVersion: '2.0.0' });
        const text = JSON.stringify(exp);
        for (const secret of ['HV2240468303', 'XX123', 'NE=35436844', '1000000035436846', 'Inverter-1', 'Mystery', 'Mustermann', '49.9']) {
            expect(text, `export must not contain ${secret}`).to.not.include(secret);
        }
        expect(exp.deviceTypes['1'].invTypes).to.deep.equal(['SUN2000-10KTL-M1']);
        expect(exp.deviceTypes['1'].fields.active_power).to.include({ inModel: true, id: 'activePower', unit: 'kW', example: 0.18 });
        expect(exp.deviceTypes['1'].modelCandidates).to.deep.include({ key: 'new_field_u', id: 'newFieldU', type: 'number', role: 'value.voltage', unit: 'V', source: 'diagnostic export' });
        expect(exp.deviceTypes['23999']).to.include({ inModel: false, devices: 1, realtime: 'supported' });
        expect(exp.deviceTypes['23999'].fields.secret_text.example).to.equal('<text, 20 chars>');
        expect(exp.recentErrors[0]).to.include({ kind: 'quota', failCode: 407 });
    });

    it('marks the model dirty only when something new was learned', () => {
        const dm = new DataModel();
        dm.observeDeviceRealtime(1, { active_power: 1 });
        dm.dirty = false;
        dm.observeDeviceRealtime(1, { active_power: 2 });
        expect(dm.dirty).to.equal(false);
        dm.observeDeviceRealtime(1, { active_power: 2, another_u: 1 });
        expect(dm.dirty).to.equal(true);
    });
});
