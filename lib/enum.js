
const fieldIds = {
    //config
    31: '.config.isEnabled',
    36: '.config.wiFiSSID',
    38: '.config.phaseMode',
    40: '.config.ledStripBrightness',
    44: '.config.smartButtonEnabled',

    48: '.config.dynamicChargerCurrent',
    111: '.config.dynamicCircuitCurrentP1',
    112: '.config.dynamicCircuitCurrentP2',
    113: '.config.dynamicCircuitCurrentP3',

    //Status
    46: '.status.ledMode',
    68: '.status.wiFiAPEnabled',
    82: '.status.chargerFirmware',
    96: '.status.reasonForNoCurrent',
    102: '.status.smartCharging',
    103: '.status.cableLocked',
    109: '.status.chargerOpMode',
    110: '.status.outputCurrent',
    120: '.status.totalPower',
    122: '.status.energyPerHour',
    124: '.status.lifetimeEnergy',
    132: '.status.wiFiRSSI',
    150: '.status.TempMax',
    182: '.status.inCurrentT2',
    183: '.status.inCurrentT3',
    184: '.status.inCurrentT4',
    185: '.status.inCurrentT5',
    190: '.status.inVoltageT1T2',
    191: '.status.inVoltageT1T3',
    192: '.status.inVoltageT1T4',
    193: '.status.inVoltageT1T5',
    194: '.status.inVoltageT2T3',
    195: '.status.inVoltageT2T4',
    196: '.status.inVoltageT2T5',
    197: '.status.inVoltageT3T4',
    198: '.status.inVoltageT3T5',
    199: '.status.inVoltageT4T5',
};
Object.freeze(fieldIds);


module.exports = {
    getNameByEnum: function(id) {
        return fieldIds[id];
        //return "Not Found"
    },

    getValue: function () {
        // whatever
    }
};

