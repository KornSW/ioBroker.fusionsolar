'use strict';

const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;

//const { constants } = require('crypto');
//const { request } = require('https');
//const objEnum = require('./lib/enum.js');

const apiUrl = 'https://eu5.fusionsolar.huawei.com/thirdData';
const adapterIntervals = {}; //halten von allen Intervallen

const maxSubseqErrorsUntilSuspend = 10;

let stationList = [];
let deviceList = [];
let accessToken = '';
let loggedIn = false;

// ### FROM SETTINGS ######################
let polltime = 180;
let timeslotlength = 3;
let skipOptimizers = true;
let skipUnknownDevices = true;
let apiVersion = 'default';
let apiRetry = true;
let frequencys = [1,2,4,8,16,32]; // every x count it will crawl
let counter = 0;
let frequency = 0;
let skip = false;
// ########################################

class FusionSolarConnector extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {

        super({
            ...options,
            name: 'fusionsolar',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        //objEnum.getValue();
    }

    async onReady() {

        await this.setStateAsync('info.connection', false, true);

        // LOAD SETTINGS
        if (this.config.polltime < 60) {
            this.log.error('Interval in seconds is to short (60 is minimum) -> using 180 now');
            polltime = 180;
        } else {
            polltime = this.config.polltime;
        }
        if (this.config.timeslotlength < 1) {
            this.log.error('Timeslot legth in seconds is to short (1 is minimum) -> using 3 now');
            timeslotlength = 3;
        } else {
            timeslotlength = this.config.timeslotlength;
        }
        skipOptimizers = this.config.skipOptimizers;
        skipUnknownDevices = this.config.skipUnknownDevices;
        apiRetry = this.config.apiRetry;

        apiVersion = this.config.apiVersion;
        if (apiVersion == 'default') {
            this.log.info('Using the default API-Version as configured...');
        } else if (apiVersion == 'gen-1') {
            this.log.info('Using the expl. configured API-Version "' + apiVersion + '".');
        } else if (apiVersion == 'gen-2') {
            this.log.info('Using the expl. configured API-Version "' + apiVersion + '".');
        } else {
            this.log.error('The configured API-Version "' + apiVersion + '" is not known by this adapter (within the config dialog you can use just one of the following: "default" | "gen-1" | "gen-2") >> now using the default...');
            apiVersion = 'default';
        }
        if (apiVersion == 'default') {
            apiVersion = 'gen-1';
            this.log.info('...the default API-Version is "' + apiVersion + '".');
        }
        loggedIn = false;

        await this.setObjectNotExistsAsync('lastUpdate', {
            type: 'state',
            common: {
                name: 'lastUpdate',
                type: 'string',
                role: 'indicator',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.readAllStates(true, maxSubseqErrorsUntilSuspend - 3);

    }

    onUnload(callback) {
        try {
            clearTimeout(adapterIntervals.readAllStates);
            clearTimeout(adapterIntervals.updateDynamicCircuitCurrent);
            this.log.info('Adaptor fusionsolar cleaned up everything...');
            this.setStateAsync('info.connection', false, true);
            loggedIn = false;
            callback();
        } catch (e) {
            callback();
        }
    }

    async readAllStates(isFirsttimeInit, errorCounter) {
        let nextPoll = polltime * 1000;
        let firstTimeInitError = false;



        try {

            if(!loggedIn){
                if (this.config.username == '') {
                    errorCounter = maxSubseqErrorsUntilSuspend;
                    throw 'No username set';
                } else if (this.config.client_secret == '') {
                    errorCounter = maxSubseqErrorsUntilSuspend;
                    throw 'No password set';
                }
                const loginSuccess = await this.login(this.config.username, this.config.client_secret);
                if (loginSuccess) {
                    loggedIn = true;
                }
                else{
                    throw 'FusionSolar Api Login failed!';
                }
            }

            if(isFirsttimeInit || !stationList) {
                this.log.debug('initially loading StationList from the API...');
                await this.getStationList().then((result) => stationList = result);
            }

            if(stationList){

                for(const stationInfo of stationList) {

                    if (apiVersion == 'default') {
                        this.log.debug('loading StationRealKpi for ' + stationInfo.stationCode + ' from the API...');
                        await this.getStationRealKpi(stationInfo.stationCode).then((stationRealtimeKpiData) => {
                            this.log.debug('writing station related channel values...');
                            this.writeStationDataToIoBrokerStates(stationInfo, stationRealtimeKpiData, (isFirsttimeInit || errorCounter > 0));
                        });

                        if(isFirsttimeInit) {
                            this.log.debug('initially loading DeviceList for ' + stationInfo.stationCode + ' from the API...');
                            await this.getDevList(stationInfo.stationCode).then((result) => deviceList = result);
                        }
                    } else if (apiVersion == 'gen-2') {
                        this.log.debug('loading StationRealKpi for ' + stationInfo.plantCode + ' from the API...');
                        await this.getStationRealKpi(stationInfo.plantCode).then((stationRealtimeKpiData) => {
                            this.log.debug('writing station related channel values...');
                            this.writeStationDataToIoBrokerStates(stationInfo, stationRealtimeKpiData, (isFirsttimeInit || errorCounter > 0));
                        });

                        if(isFirsttimeInit) {
                            this.log.debug('initially loading DeviceList for ' + stationInfo.plantCode + ' from the API...');
                            await this.getDevList(stationInfo.plantCode).then((result) => deviceList = result);
                        }
                    }

                    if(deviceList){
                        for(const deviceInfo of deviceList) {
                            skip = false;
                            if(deviceInfo.devTypeId == 1){
                                //INVERTER
                                frequency = 0;
                            }
                            else if(deviceInfo.devTypeId == 62){
                                //DONGLE
                                frequency = 6;
                            }
                            else if(deviceInfo.devTypeId == 46){
                                //OPTIMIZER
                                if(skipOptimizers) continue;
                            }
                            else if(deviceInfo.devTypeId == 47){
                                //METER
                                frequency = 0;
                            }
                            else if(deviceInfo.devTypeId == 39){
                                //BATTERY
                                frequency = 3;
                            }
                            else {
                                //UNKNOWN
                                if(skipUnknownDevices) continue;
                            }
                            
                            // Here should be the value from deviceInfo.frequency in frequency
                            
                            if (counter == 0)
                            {
                                this.log.debug('Read all devices because it`s the first start! - '  + deviceInfo.id);
                            } else {
                                if (Number.isInteger(counter / frequencys[frequency]) == false)
                                {

                                    skip = true;
                                }   
                            }
                            if (skip == true)
                            {
                                this.log.debug('SKIPPING because of frequency - ' + deviceInfo.id);
                                continue;
                            }


                            this.log.debug('loading DevRealKpi for ' + deviceInfo.id + ' from the API...');
                            await this.getDevRealKpi(deviceInfo.id, deviceInfo.devTypeId).then((deviceRealtimeKpiData) => {
                                this.log.debug('writing device related channel values for ' + deviceInfo.id + '...');
                                this.writeDeviceDataToIoBrokerStates(deviceInfo, deviceRealtimeKpiData, (isFirsttimeInit || errorCounter > 0));
                            });

                        }
                    }
                    else{
                        await this.apiQuotaProtector(0);
                        throw 'DeviceList was not loaded properly';
                    }

                }

            }
            else{
                await this.apiQuotaProtector(0);
                throw 'StationList was not loaded properly';
            }

            this.log.debug('update completed');
            await this.setStateAsync('lastUpdate', new Date().toLocaleTimeString(), true);

            errorCounter = 0;
        } catch (error) {

            firstTimeInitError = isFirsttimeInit;

            if (typeof error === 'string') {
                if(error == 'API required re-login'){
                    this.log.info(error);
                    loggedIn = false;
                }
                else{
                    this.log.error(error);
                }
            } else if (error instanceof Error) {
                this.log.error(error.message);
            }

            errorCounter += 1;
            if (errorCounter >= maxSubseqErrorsUntilSuspend) {
                this.log.warn('ADAPTER IS NOW AUTOMATICALLY SUSPENDING ANY API QUERY FOR 24H!!!');
                nextPoll = 86400000; //1D
            }
            else {
                await this.apiQuotaProtector(errorCounter);
                //SEC: 0,5 / 4 / 13,5 / 32 / 62 / ...
                nextPoll = 500 * errorCounter * errorCounter * errorCounter;
            }

        }
        
        counter += 1;
        
        adapterIntervals.readAllStates = setTimeout(this.readAllStates.bind(this, firstTimeInitError, errorCounter), nextPoll);
    }

    async apiQuotaProtector(retryCounter) {
        const secondsToWait = (retryCounter + 1) * timeslotlength;
        //ITS A PITA!!! THE API RESPONDS 403 DUE QUOTA-RESTRICTIONS
        return new Promise(resolve => setTimeout(resolve, (secondsToWait * 1000)));
    }

    async writeChannelDataToIoBroker(channelParentPath, channelName, value, channelType, channelRole, createObjectInitally, createObjectInitallyUnit, createObjectInitallyStates) {
        if(channelParentPath != null){
            channelParentPath = channelParentPath + '.';
        }
        if(createObjectInitally && createObjectInitallyUnit){
            await this.setObjectNotExistsAsync(channelParentPath + channelName, {
                type: 'state',
                common: {
                    name: channelName,
                    type: channelType,
                    role: channelRole,
                    unit: createObjectInitallyUnit,
                    read: true,
                    write: false,
                },
                native: {},
            });
        } else if(createObjectInitally && createObjectInitallyStates){
            //createObjectInitallyStates =  {"2": "Entladen", "1": "BLA"}
            await this.setObjectNotExistsAsync(channelParentPath + channelName, {
                type: 'state',
                common: {
                    name: channelName,
                    type: channelType,
                    role: channelRole,
                    states: createObjectInitallyStates,
                    read: true,
                    write: false,
                },
                native: {},
            });
        } else if(createObjectInitally){
            await this.setObjectNotExistsAsync(channelParentPath + channelName, {
                type: 'state',
                common: {
                    name: channelName,
                    type: channelType,
                    role: channelRole,
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        if(value != undefined){
            await this.setStateAsync(channelParentPath + channelName, value, true);
        }
    }

    async writeStationDataToIoBrokerStates(stationInfo, stationRealtimeKpiData, createObjectsInitally) {
        if(stationInfo){

            let stationFolder = stationInfo.stationCode;
            if(apiVersion == 'gen-2'){
                if(stationFolder == null || stationFolder == undefined) {
                    stationFolder = stationInfo.plantCode;
                }
            }
            if(stationFolder == null || stationFolder == undefined) {
                stationFolder = '(unknown-station)';
            }
            //since API-Version 'gen-1':
            if(apiVersion == 'default'){
                await this.writeChannelDataToIoBroker(stationFolder, 'stationCode', stationInfo.stationCode, 'string', 'info.name',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'stationName', stationInfo.stationName, 'string', 'info.name',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'stationAddr', stationInfo.stationAddr, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'stationLinkman', stationInfo.stationLinkman, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'linkmanPho', stationInfo.linkmanPho, 'string', 'indicator',  createObjectsInitally);
            }
            else if(apiVersion == 'gen-2'){
                await this.writeChannelDataToIoBroker(stationFolder, 'plantCode', stationInfo.plantCode, 'string', 'info.name',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'plantName', stationInfo.plantName, 'string', 'info.name',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'plantAddress', stationInfo.plantAddress, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'contactMethod', stationInfo.contactMethod, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'contactPerson', stationInfo.contactPerson, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'latitude', stationInfo.latitude, 'string', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationFolder, 'longitude', stationInfo.longitude, 'string', 'indicator',  createObjectsInitally);
            }
            //always:
            await this.writeChannelDataToIoBroker(stationFolder, 'capacity', stationInfo.capacity, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(stationFolder, 'aidType', stationInfo.aidType, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(stationFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);            

            if(stationRealtimeKpiData) {
                const stationRealtimeKpiFolder = stationFolder + '.kpi.realtime';
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'totalIncome', stationRealtimeKpiData.total_income, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'totalPower', stationRealtimeKpiData.total_power, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'monthPower', stationRealtimeKpiData.month_power, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'dayPower', stationRealtimeKpiData.day_power, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'dayIncome', stationRealtimeKpiData.day_income, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'realHealthState', stationRealtimeKpiData.real_health_state, 'number', 'indicator',  createObjectsInitally);
                await this.writeChannelDataToIoBroker(stationRealtimeKpiFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);
            }

        }

    }

    async writeDeviceDataToIoBrokerStates(deviceInfo, deviceRealtimeKpiData, createObjectsInitally) {
        if(deviceInfo){

            let stationFolder = deviceInfo.stationCode;
            if(apiVersion == 'gen-2'){
                if(stationFolder == null || stationFolder == undefined) {
                    stationFolder = deviceInfo.plantCode;
                }
            }
            if(stationFolder == null || stationFolder == undefined) {
                stationFolder = '(unknown-station)';
            }

            const deviceFolder = stationFolder + '.' + deviceInfo.id;

            await this.writeChannelDataToIoBroker(deviceFolder, 'id', deviceInfo.id, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'devName', deviceInfo.devName, 'string', 'info.name',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeId', deviceInfo.devTypeId, 'number', 'info.name',  createObjectsInitally);
            if(createObjectsInitally){
                if(deviceInfo.devTypeId == 1){
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Inverter', 'string', 'info.name',  createObjectsInitally);
                }
                else if(deviceInfo.devTypeId == 62){
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Dongle', 'string', 'info.name',  createObjectsInitally);
                }
                else if(deviceInfo.devTypeId == 46){
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Optimizer', 'string', 'info.name',  createObjectsInitally);
                }
                else if(deviceInfo.devTypeId == 47){
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Meter', 'string', 'info.name',  createObjectsInitally);
                }
                else if(deviceInfo.devTypeId == 39){
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Battery', 'string', 'info.name',  createObjectsInitally);
                }
                else {
                    await this.writeChannelDataToIoBroker(deviceFolder, 'devTypeDesc', 'Unknown', 'string', 'info.name',  createObjectsInitally);
                }
            }
            
            // Update Frequency, example pollTime is 60 sec, Level = all 60s, Level 2 = all 180s, Level 3 = all 320s,....
            let selection = 
            {
                0:"Level 1 (every time)",
                1:"Level 2 (every 2nd time)",
                2:"Level 3 (every 4th time)",
                3:"Level 4 (every 8th time)",
                4:"Level 5 (every 16th time)",
                5:"Level 6 (every 32th time)",

            };
            
            await this.writeChannelDataToIoBroker(deviceFolder, 'frequency', 1, 'number', 'indicator',  createObjectsInitally,null,selection);
            
            await this.writeChannelDataToIoBroker(deviceFolder, 'esnCode', deviceInfo.esnCode, 'string', 'info.name',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'invType', deviceInfo.invType, 'string', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'latitude', deviceInfo.latitude, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'longitude', deviceInfo.longitude, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'optimizerNumber', deviceInfo.optimizerNumber, 'number', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'softwareVersion', deviceInfo.softwareVersion, 'string', 'indicator',  createObjectsInitally);
            //await this.writeChannelDataToIoBroker(deviceFolder, 'stationCode', deviceInfo.stationCode, 'string', 'indicator',  createObjectsInitally);
            await this.writeChannelDataToIoBroker(deviceFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);

            if(deviceRealtimeKpiData) {

                const deviceRealtimeKpiFolder = deviceFolder + '.kpi.realtime';
                if(deviceInfo.devTypeId == 1){
                    //Inverter

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'openTime', deviceRealtimeKpiData.open_time, 'mixed', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'closeTime', deviceRealtimeKpiData.close_time, 'mixed', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'activePower', deviceRealtimeKpiData.active_power, 'number', 'indicator',  createObjectsInitally,"kW");
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'reactivePower', deviceRealtimeKpiData.reactive_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'powerFactor', deviceRealtimeKpiData.power_factor, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'runState', deviceRealtimeKpiData.run_state, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'inverterState', deviceRealtimeKpiData.inverter_state, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'efficiency', deviceRealtimeKpiData.efficiency, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'temperature', deviceRealtimeKpiData.temperature, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'elecFreq', deviceRealtimeKpiData.elec_freq, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'dayCap', deviceRealtimeKpiData.day_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'totalCap', deviceRealtimeKpiData.total_cap, 'number', 'indicator',  createObjectsInitally);

                    //STROM PRO PHASE
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'aI', deviceRealtimeKpiData.a_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'bI', deviceRealtimeKpiData.b_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'cI', deviceRealtimeKpiData.c_i, 'number', 'indicator',  createObjectsInitally);

                    //SPANNUNG PRO PHASE
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'aU', deviceRealtimeKpiData.a_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'bU', deviceRealtimeKpiData.b_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'cU', deviceRealtimeKpiData.c_u, 'number', 'indicator',  createObjectsInitally);

                    //SPANNUNG ZWISCHEN PHASEN
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'abU', deviceRealtimeKpiData.ab_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'bcU', deviceRealtimeKpiData.bc_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.AC', 'caU', deviceRealtimeKpiData.ca_u, 'number', 'indicator',  createObjectsInitally);

                    //CAPTURE-LEISTUNG PRO MPPT
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mpptPower', deviceRealtimeKpiData.mppt_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mpptTotalCap', deviceRealtimeKpiData.mppt_total_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt01Cap', deviceRealtimeKpiData.mppt_1_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt02Cap', deviceRealtimeKpiData.mppt_2_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt03Cap', deviceRealtimeKpiData.mppt_3_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt04Cap', deviceRealtimeKpiData.mppt_4_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt05Cap', deviceRealtimeKpiData.mppt_5_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt06Cap', deviceRealtimeKpiData.mppt_6_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt07Cap', deviceRealtimeKpiData.mppt_7_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt08Cap', deviceRealtimeKpiData.mppt_8_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt09Cap', deviceRealtimeKpiData.mppt_9_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.MPPT', 'mppt10Cap', deviceRealtimeKpiData.mppt_10_cap, 'number', 'indicator',  createObjectsInitally);

                    //SPANNUNG UND STROM PRO STRING
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv01u', deviceRealtimeKpiData.pv1_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv01i', deviceRealtimeKpiData.pv1_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv02u', deviceRealtimeKpiData.pv2_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv02i', deviceRealtimeKpiData.pv2_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv03u', deviceRealtimeKpiData.pv3_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv03i', deviceRealtimeKpiData.pv3_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv04u', deviceRealtimeKpiData.pv4_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv04i', deviceRealtimeKpiData.pv4_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv05u', deviceRealtimeKpiData.pv5_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv05i', deviceRealtimeKpiData.pv5_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv06u', deviceRealtimeKpiData.pv6_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv06i', deviceRealtimeKpiData.pv6_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv07u', deviceRealtimeKpiData.pv7_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv07i', deviceRealtimeKpiData.pv7_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv08u', deviceRealtimeKpiData.pv8_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv08i', deviceRealtimeKpiData.pv8_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv09u', deviceRealtimeKpiData.pv9_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv09i', deviceRealtimeKpiData.pv9_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv10u', deviceRealtimeKpiData.pv10_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv10i', deviceRealtimeKpiData.pv10_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv11u', deviceRealtimeKpiData.pv11_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv11i', deviceRealtimeKpiData.pv11_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv12u', deviceRealtimeKpiData.pv12_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv12i', deviceRealtimeKpiData.pv12_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv13u', deviceRealtimeKpiData.pv13_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv13i', deviceRealtimeKpiData.pv13_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv14u', deviceRealtimeKpiData.pv14_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv14i', deviceRealtimeKpiData.pv14_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv15u', deviceRealtimeKpiData.pv15_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv15i', deviceRealtimeKpiData.pv15_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv16u', deviceRealtimeKpiData.pv16_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv16i', deviceRealtimeKpiData.pv16_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv17u', deviceRealtimeKpiData.pv17_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv17i', deviceRealtimeKpiData.pv17_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv18u', deviceRealtimeKpiData.pv18_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv18i', deviceRealtimeKpiData.pv18_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv19u', deviceRealtimeKpiData.pv19_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv19i', deviceRealtimeKpiData.pv19_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv20u', deviceRealtimeKpiData.pv20_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv20i', deviceRealtimeKpiData.pv20_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv21u', deviceRealtimeKpiData.pv21_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv21i', deviceRealtimeKpiData.pv21_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv22u', deviceRealtimeKpiData.pv22_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv22i', deviceRealtimeKpiData.pv22_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv23u', deviceRealtimeKpiData.pv23_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv23i', deviceRealtimeKpiData.pv23_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv24u', deviceRealtimeKpiData.pv24_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder + '.PV', 'pv24i', deviceRealtimeKpiData.pv24_i, 'number', 'indicator',  createObjectsInitally);

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);

                }
                else if(deviceInfo.devTypeId == 62){
                    //Dongle
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);
                }
                else if(deviceInfo.devTypeId == 47){
                    //Meter

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'runState', deviceRealtimeKpiData.run_state, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'meterStatus', deviceRealtimeKpiData.meter_status, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'meterU', deviceRealtimeKpiData.meter_u, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'meterI', deviceRealtimeKpiData.meter_i, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'activeCap', deviceRealtimeKpiData.active_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'reverseActiveCap', deviceRealtimeKpiData.reverse_active_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'powerFactor', deviceRealtimeKpiData.power_factor, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'activePower', deviceRealtimeKpiData.active_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'reactivePower', deviceRealtimeKpiData.reactive_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'gridFrequency', deviceRealtimeKpiData.grid_frequency, 'number', 'indicator',  createObjectsInitally);

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);

                }
                else if(deviceInfo.devTypeId == 39){
                    //Battery

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'runState', deviceRealtimeKpiData.run_state, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'batteryStatus', deviceRealtimeKpiData.battery_status, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'batterySoh', deviceRealtimeKpiData.battery_soh, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'batterySoc', deviceRealtimeKpiData.battery_soc, 'number', 'indicator',  createObjectsInitally,"%");
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'maxChargePower', deviceRealtimeKpiData.max_charge_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'maxDischargePower', deviceRealtimeKpiData.max_discharge_power, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'chargeCap', deviceRealtimeKpiData.charge_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'dischargeCap', deviceRealtimeKpiData.discharge_cap, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'chDischargePower', deviceRealtimeKpiData.ch_discharge_power, 'number', 'indicator',  createObjectsInitally,"kW");
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'chDischargeModel', deviceRealtimeKpiData.ch_discharge_model, 'number', 'indicator',  createObjectsInitally);
                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'busbarU', deviceRealtimeKpiData.busbar_u, 'number', 'indicator',  createObjectsInitally);

                    await this.writeChannelDataToIoBroker(deviceRealtimeKpiFolder, 'lastUpdate', new Date().toLocaleTimeString(), 'string', 'indicator',  createObjectsInitally);

                }
                    


            }

        }

    }

    /**
     * Is called if a subscribed state changes (initiated by io broker)
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            this.log.info(`state ${id} deleted`);
        }
    }

    /*************************************************************************
     * HTTP API CALLS
     **************************************************************************/

    /*
        Erfolgsfall:
            - im response body ist  "failCode": 0,
            - im response header kommt der token via set-cookie: XSRF-TOKEN=xxxxxx...xxxxxx;Path=/;Secure
        Fehlerfälle:
            1) falsche credentials: HTTP-200 mit leerem body
            2) überlasteter server: HTTP-403 FORBIDDEN mit body { "errorCode":"49401021002", "exceptionInfo":"Request is rejected by api quotaControl. api:ies_PVMSNbiService_thirdData_1.0.78, key:/getStationList_POST"}
            3) BL-Fehler: { "failCode": 305 "immediately": true, "message": "USER_MUST_RELOGIN"}
        }
    */
    async login(username, password) {
        try {
            const response = await axios.post(apiUrl + '/login', {
                userName: username,
                systemCode: password
            });

            const xsrfTokenHeader = response.headers['xsrf-token'];
            if(xsrfTokenHeader){
                accessToken = xsrfTokenHeader;
            }
            else{

                const cookieHeaders = response.headers['Set-Cookie'];
                if(!cookieHeaders){
                    this.log.debug(JSON.stringify(response.headers));
                    throw 'no XSRF-TOKEN cookie provided';
                }
                const firstCookie = cookieHeaders.split(';')[0];
                if(firstCookie.contains('xsrf-token=')){
                    accessToken = firstCookie.substring(11);
                    this.log.debug('TOKEN:' + accessToken);
                }
                else{
                    this.log.debug(JSON.stringify(response.headers));
                    throw 'no XSRF-TOKEN cookie provided';
                }

            }
            this.log.debug('got token: ' + accessToken);

            if(response.data.failCode == 0){

                this.log.info('FusionSolar Api Login successful');
                await this.setStateAsync('info.connection', true, true);

                return true;
            }
            else {
                if(response.data.failCode > 0){
                    throw 'FusionSolar Api Login returned failCode #' + response.data.failCode;
                }
                else{
                    this.log.debug(JSON.stringify(response.data));
                    throw 'response contains an invalid body';
                }
            }
        } catch (error) {
            if (typeof error === 'string') {
                this.log.error(error);
            } else if (error instanceof Error) {
                if(error['response'].status > 0 ){
                    const httpStatus = error['response'].status;
                    this.log.error('HTTP ' + httpStatus);
                    if(httpStatus == 403){
                        this.log.info('Note: 403-errors from FusionSolar API can occour by server quota problems - please retry in this case!');
                    }
                }
                this.log.error(error.message);
            }

            this.log.error('Api login error - check Username and password');

            await this.setStateAsync('info.connection', false, true);
            return false;
        }
    }

    /*
        {
          "failCode": 305,
          "immediately": true,
          "message": "USER_MUST_RELOGIN"
        }
    */

    async getStationList(retry=0){
        await this.apiQuotaProtector(retry);
        let requestBody =`{

        }`;
        let callUrl = apiUrl + '/getStationList';
        if(apiVersion == 'gen-2') {
            callUrl = apiUrl + '/stations';
            requestBody ={
                "pageNo":1,
                "pageSize":100
            };
        }
        const result = await axios.post(callUrl,
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug('loading StationList');
            this.log.debug(JSON.stringify(response.data));

            if(response.data.failCode == 305){
                this.log.info('API requires re-logon!');
                loggedIn = false;
                return null;
            }
            else if(response.data.failCode == 407){
                this.log.error('API returned failCode #407 (access frequency is too high) - giving up now :-(');
                return null;
            }
            else if(response.data.failCode == 401){
                this.log.error('API returned failCode #401 (invalid access to current interface) - MAY BE A MISSMATCH OF THE API-VERSION!');
                return null;
            }
            else if(response.data.failCode > 0){
                this.log.error('API returned failCode #' + response.data.failCode);
                this.log.debug('Request was: ' + JSON.stringify(requestBody));
                return null;
            }

            if(apiVersion == 'gen-2' && response.data.data.list) {
                return response.data.data.list;
                /*
                {
                    "data": {
                        "list": [
                            {
                                "capacity": 18,
                                "contactMethod": null,
                                "contactPerson": null,
                                "gridConnectionDate": "2023-03-31T09:56:55+01:00",
                                "latitude": "",
                                "longitude": "",
                                "plantAddress": "",
                                "plantCode": "",
                                "plantName": ""
                            }
                        ],
                        "pageCount": 1,
                        "pageNo": 1,
                        "pageSize": 100,
                        "total": 1
                    },
                    "failCode": 0,
                    "message": "get plant list success",
                    "success": true
                }
                */

            }
            else{
                return response.data.data;
                /*
                {
                  "data":[{
                      "aidType":1,
                      "buildState":null,
                      "capacity":0.009,
                      "combineType":null,
                      "linkmanPho":"xxxx@xxxxxxxxxx.xx",
                      "stationAddr":"xxxxxxxxxx, 00000 xxxxxxxxxxxxx",
                      "stationCode":"xxxxxxxxxxxx",
                      "stationLinkman":"xxxxxx xxxxx",
                      "stationName":"xx xxxx"
                    }],
                   "failCode":0,
                   "message":null,
                   "params":{"currentTime":1663861121280},
                   "success":true
                }
                */
            }
        }).catch((error) => {
            if(this.shouldRetryAfterQuotaError(error, retry)){
                return retry;
            }
            else{
                return null;
            }
        });

        //if a number is returned, then it is the retry-counter
        //with the sematic, that anoter retry should be done
        if (result != null && Number.isInteger(result)) {
            const nextTry = (result + 1);
            return await this.getStationList(nextTry);
        }

        return result;
    }

    async getStationRealKpi(stationCode, retry=0){
        await this.apiQuotaProtector(retry);
        /*const requestBody =`{
            "stationCodes": "${stationCode}"
        }`;*/
        const requestBody = {
            stationCodes: stationCode
        };

        const result = await axios.post(apiUrl + '/getStationRealKpi',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug(`loading StationRealKpi for station ${stationCode}`);
            this.log.debug(JSON.stringify(response.data));

            if(response.data.failCode == 305){
                this.log.info('API requires re-logon!');
                loggedIn = false;
                return {};
            }
            else if(response.data.failCode == 407){
                this.log.error('API returned failCode #407 (access frequency is too high) - giving up now :-(');
                return {};
            }
            else if(response.data.failCode > 0){
                this.log.error('API returned failCode #' + response.data.failCode);
                this.log.debug('Request was: ' + JSON.stringify(requestBody));
                return {};
            }

            /*
            {
                "data":[{
                    "stationCode":"NE=35436844",
                    "dataItemMap":{
                        "total_income":535.794,
                        "total_power":1007.27,
                        "day_power":31.81,
                        "day_income":3.827,
                        "real_health_state":3,
                        "month_power":531.8
                    }
                }],
                "failCode":0,
                "message":null,
                "params":{"currentTime":1663861220278,"stationCodes":"NE=35436844"},
                "success":true
            }
            */

            return response.data.data[0].dataItemMap;
        }).catch((error) => {
            if(this.shouldRetryAfterQuotaError(error, retry)){
                return retry;
            }
            else{
                return null;
            }
        });

        //if a number is returned, then it is the retry-counter
        //with the sematic, that anoter retry should be done
        if (result != null && Number.isInteger(result)) {
            const nextTry = (result + 1);
            return await this.getStationRealKpi(stationCode, nextTry);
        }

        return result;
    }

    async getDevList(stationCode, retry=0){
        await this.apiQuotaProtector(retry);

        const requestBody = {
            stationCodes: stationCode
        };
        const result = await axios.post(apiUrl + '/getDevList',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug(`loading DevList for station ${stationCode}`);
            this.log.debug(JSON.stringify(response.data));

            if(response.data.failCode == 305){
                this.log.info('API requires re-logon!');
                loggedIn = false;
                return null;
            }
            else if(response.data.failCode == 407){
                this.log.error('API returned failCode #407 (access frequency is too high) - giving up now :-(');
                return null;
            }
            else if(response.data.failCode > 0){
                this.log.error('API returned failCode #' + response.data.failCode);
                this.log.debug('Request was: ' + requestBody);
                return null;
            }

            /*
            {
                "data":[
                    {
                        "devName":"Dongle-1",
                        "devTypeId":62,
                        "esnCode":"HV2240085917",
                        "id":1000000035436845,
                        "invType":null,
                        "latitude":49.945273,
                        "longitude":8.222305,
                        "optimizerNumber":null,
                        "softwareVersion":"V100R001C00SPC125",
                        "stationCode":"NE=35436844"
                    },
                    {
                        "devName":"Inverter-1",
                        "devTypeId":1,
                        "esnCode":"HV2240468303",
                        "id":1000000035436846,
                        "invType":"SUN2000-10KTL-M1",
                        "latitude":49.945273,
                        "longitude":8.222305,
                        "optimizerNumber":0,
                        "softwareVersion":"V100R001C00SPC141",
                        "stationCode":"NE=35436844"
                    },
                    {
                        "devName":"Battery-1",
                        "devTypeId":39,
                        "esnCode":null,
                        "id":1000000035436848,
                        "invType":null,
                        "latitude":49.945273,
                        "longitude":8.222305,
                        "optimizerNumber":null,
                        "softwareVersion":null,
                        "stationCode":"NE=35436844"
                    },
                    {
                        "devName":"Meter-1",
                        "devTypeId":47,
                        "esnCode":null,
                        "id":1000000035436847,
                        "invType":null,
                        "latitude":49.945273,
                        "longitude":8.222305,
                        "optimizerNumber":null,
                        "softwareVersion":null,
                        "stationCode":"NE=35436844"
                    }
                ],
                "failCode":0,
                "message":null,
                "params":{"currentTime":1663862283173,"stationCodes":"NE=35436844"},
                "success":true
            }
            */
            return response.data.data;
        }).catch((error) => {
            if(this.shouldRetryAfterQuotaError(error, retry)){
                return retry;
            }
            else{
                return null;
            }
        });

        //if a number is returned, then it is the retry-counter
        //with the sematic, that anoter retry should be done
        if (result != null && Number.isInteger(result)) {
            const nextTry = (result + 1);
            return await this.getDevList(stationCode, nextTry);
        }

        return result;
    }

    async getDevRealKpi(deviceId, deviceTypeId, retry=0){
        await this.apiQuotaProtector(retry);

        const requestBody = {
            devIds: deviceId,
            devTypeId: deviceTypeId
        };
        const result = await axios.post(apiUrl + '/getDevRealKpi',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug(`loading DevRealKpi for device ${deviceId} (type ${deviceTypeId})`);
            this.log.debug(JSON.stringify(response.data));

            if(response.data.failCode == 305){
                this.log.info('API requires re-logon!');
                loggedIn = false;
                return {};
            }
            else if(response.data.failCode == 407){
                if (apiRetry)
                {
                    this.log.debug('API returned failCode #407 (access frequency is too high) - I will give their API another chance!');
                    return retry;
                } else {
                    this.log.error('API returned failCode #407 (access frequency is too high) - giving up now :-(');
                    return {};
                }
                
            }
            else if(response.data.failCode > 0){
                this.log.error('API returned failCode #' + response.data.failCode);
                this.log.debug('Request was: ' + requestBody);
                return {};
            }

            /*
            *** für Dongle (devTypeId=62)
            {
              "data": [
                {
                  "devId": 1000000035436845,
                  "dataItemMap": {}
                }
              ],
              "failCode": 0,
              "message": null,
              "params": {
                "currentTime": 1665646265924,
                "devIds": "1000000035436845",
                "devTypeId": 62
              },
              "success": true
            }
            *** für Inverter (devTypeId=1)
            {
              "data": [
                {
                  "devId": 1000000035436846,
                  "dataItemMap": {
                    "pv2_u": 350.4,
                    "pv4_u": 0.0,
                    "pv22_i": 0.0,
                    "pv6_u": 0.0,
                    "power_factor": 1.0,
                    "mppt_total_cap": 1501.37,
                    "pv24_i": 0.0,
                    "pv8_u": 0.0,
                    "open_time": 1665642954000,
                    "pv22_u": 0.0,
                    "a_i": 0.307,
                    "pv24_u": 0.0,
                    "mppt_9_cap": 0.0,
                    "c_i": 0.3,
                    "pv20_u": 0.0,
                    "pv19_u": 0.0,
                    "pv15_u": 0.0,
                    "pv17_u": 0.0,
                    "reactive_power": 0.0,
                    "a_u": 227.8,
                    "c_u": 229.4,
                    "mppt_8_cap": 0.0,
                    "pv20_i": 0.0,
                    "pv15_i": 0.0,
                    "pv17_i": 0.0,
                    "efficiency": 100.0,
                    "pv11_i": 0.0,
                    "pv13_i": 0.0,
                    "pv11_u": 0.0,
                    "pv13_u": 0.0,
                    "mppt_power": 0.18,
                    "run_state": 1,
                    "close_time": "N/A",
                    "pv19_i": 0.0,
                    "mppt_7_cap": 0.0,
                    "mppt_5_cap": 0.0,
                    "pv2_i": 0.26,
                    "pv4_i": 0.0,
                    "active_power": 0.18,
                    "pv6_i": 0.0,
                    "pv8_i": 0.0,
                    "mppt_6_cap": 0.0,
                    "pv1_u": 429.2,
                    "pv3_u": 0.0,
                    "pv23_i": 0.0,
                    "pv5_u": 0.0,
                    "pv7_u": 0.0,
                    "pv23_u": 0.0,
                    "pv9_u": 0.0,
                    "inverter_state": 512.0,
                    "total_cap": 1380.5,
                    "mppt_3_cap": 0.0,
                    "b_i": 0.308,
                    "pv21_u": 0.0,
                    "mppt_10_cap": 0.0,
                    "pv16_u": 0.0,
                    "pv18_u": 0.0,
                    "temperature": 45.0,
                    "b_u": 227.4,
                    "bc_u": 395.7,
                    "pv21_i": 0.0,
                    "elec_freq": 50.01,
                    "mppt_4_cap": 0.0,
                    "pv16_i": 0.0,
                    "pv18_i": 0.0,
                    "day_cap": 1.48,
                    "pv12_i": 0.0,
                    "pv14_i": 0.0,
                    "pv12_u": 0.0,
                    "mppt_1_cap": 897.77,
                    "pv14_u": 0.0,
                    "pv10_u": 0.0,
                    "pv1_i": 0.3,
                    "pv3_i": 0.0,
                    "mppt_2_cap": 603.6,
                    "pv5_i": 0.0,
                    "ca_u": 395.8,
                    "ab_u": 394.2,
                    "pv7_i": 0.0,
                    "pv10_i": 0.0,
                    "pv9_i": 0.0
                  }
                }
              ],
              "failCode": 0,
              "message": null,
              "params": {
                "currentTime": 1665646198532,
                "devIds": "1000000035436846",
                "devTypeId": 1
              },
              "success": true
            }
            *** für Messgerät (devTypeId=47)
            {
                "data":[{
                    "devId": 1000000035436847,
                    "dataItemMap": {
                        "meter_status": 1,
                        "active_cap": 322.32,
                        "meter_i": 2.21,
                        "reverse_active_cap": 583.08,
                        "reactive_power": 380,
                        "power_factor": -0.916,
                        "active_power": 1537,
                        "run_state": 1,
                        "meter_u": 226.8,
                        "grid_frequency": 49.99
                    }
                }],
                "failCode": 0,
                "message": null,
                "params": {"currentTime": 1663862791439, "devIds": "1000000035436847", "devTypeId": 47},
                "success": true
            }
            *** für Battarie (devTypeId=39)
            {
                "data":[{
                    "devId":1000000035436848,
                    "dataItemMap":{
                        "max_discharge_power":5000,
                        "max_charge_power":5000,
                        "battery_soh":0,
                        "busbar_u":782.7,
                        "discharge_cap":2.23,
                        "ch_discharge_power":0,
                        "run_state":1,
                        "battery_soc":100,
                        "ch_discharge_model":4,
                        "charge_cap":10.81,
                        "battery_status":2
                    }
                }],
                "failCode":0,
                "message":null,
                "params":{"currentTime":1663862845954,"devIds":"1000000035436848","devTypeId":39},
                "success":true
            }
            */
            return response.data.data[0].dataItemMap;
        }).catch((error) => {
            if(this.shouldRetryAfterQuotaError(error, retry)){
                return retry;
            }
            else{
                return null;
            }
        });

        //if a number is returned, then it is the retry-counter
        //with the sematic, that anoter retry should be done
        if (result != null && Number.isInteger(result)) {
            const nextTry = (result + 1);
            return await this.getDevRealKpi(deviceId, deviceTypeId, nextTry);
        }

        return result;
    }

    shouldRetryAfterQuotaError(error, retry){
        let errorMsg = error;
        if (error instanceof Error) {
            errorMsg = error.message;
        }
        if(errorMsg.indexOf('403') > 0){
            if(retry > 3){
                this.log.error('API returned httpCode #403 (quota issue on huawei side) - giving up now :-(');
                return false;
            }
            this.log.warn('API returned httpCode #403 (quota issue on huawei side) - doing retry...');
            return true;
        }
        else{
            //throw error;
            this.log.error(errorMsg);
        }
        return false;
    }

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new FusionSolarConnector(options);
} else {
    // otherwise start the instance directly
    new FusionSolarConnector();
}
