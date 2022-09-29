'use strict';

const utils = require('@iobroker/adapter-core');
//const { request } = require('https');

const axios = require('axios').default;
const objEnum = require('./lib/enum.js');

const apiUrl = 'https://eu5.fusionsolar.huawei.com/thirdData';
const adapterIntervals = {}; //halten von allen Intervallen

const maxSubseqErrorsUntilSuspend = 10;

let stationList = [];
let accessToken = '';
let polltime = 60;
let loggedIn = false;

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

        //dummy call
        objEnum.getValue();
    }

    async onReady() {

        await this.setStateAsync('info.connection', false, true);

        if (this.config.polltime < 1) {
            this.log.error('Interval in seconds is to short -> go to default 60');
        } else {
            polltime = this.config.polltime;
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
                    throw 'login failed!';
                }
            }

            if(isFirsttimeInit){
                this.log.debug('initially loading StationList from the API...');
                await this.getStationList().then((result) => stationList = result);
            }

            stationList.forEach(stationInfo => {
                this.log.debug('loading StationRealKpi from the API...');
                this.getStationRealKpi(stationInfo.stationCode).then((stationRealtimeKpiData) => {
                    this.log.debug('writing station related channel values...');
                    this.writeStationDataToIoBrokerStates(stationInfo, stationRealtimeKpiData, isFirsttimeInit);
                });
            });

            this.log.debug('update completed');
            await this.setStateAsync('lastUpdate', new Date().toLocaleTimeString(), true);

            errorCounter = 0;
        } catch (error) {
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
                this.log.info('ADAPTER IS NOW AUTOMATICALLY SUSPENDING ANY API QUERY FOR 24H!!!');
                nextPoll = 86400000; //1D
            }
            else {
                //SEC: 0,5 / 4 / 13,5 / 32 / 62 / ...
                nextPoll = 500 * errorCounter * errorCounter * errorCounter;
            }
        }

        adapterIntervals.readAllStates = setTimeout(this.readAllStates.bind(this, false, errorCounter), nextPoll);
    }

    async writeChannelDataToIoBroker(channelParentPath, channelName, value, channelType, channelRole, createObjectInitally) {
        if(channelParentPath != null){
            channelParentPath = channelParentPath + '.';
        }
        if(createObjectInitally){
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

        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'stationCode', stationInfo.stationCode, 'string', 'info.name',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'stationName', stationInfo.stationName, 'string', 'info.name',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'stationAddr', stationInfo.stationAddr, 'string', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'stationLinkman', stationInfo.stationLinkman, 'string', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'linkmanPho', stationInfo.linkmanPho, 'string', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'capacity', stationInfo.capacity, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, 'aidType', stationInfo.aidType, 'string', 'indicator',  createObjectsInitally);

        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.totalIncome', stationRealtimeKpiData.total_income, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.totalPower', stationRealtimeKpiData.total_power, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.monthPower', stationRealtimeKpiData.month_power, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.dayPower', stationRealtimeKpiData.day_power, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.dayIncome', stationRealtimeKpiData.day_income, 'number', 'indicator',  createObjectsInitally);
        await this.writeChannelDataToIoBroker(stationInfo.stationCode, '.kpi.realtime.realHealthState', stationRealtimeKpiData.real_health_state, 'number', 'indicator',  createObjectsInitally);

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
            const cookieHeaders = response.headers['Set-Cookie'];
            if(!cookieHeaders){
                throw 'no XSRF-TOKEN cookie provided';
            }
            const firstCookie = cookieHeaders.split(';')[0];
            if(firstCookie.contains('XSRF-TOKEN=')){
                accessToken = firstCookie.substring(11);
                this.log.debug('TOKEN:' + accessToken);
            }
            else{
                throw 'no XSRF-TOKEN cookie provided';
            }

            this.log.debug(JSON.stringify(response.data));

            if(response.data != undefined){
                if(response.data.failcode == undefined){
                    throw 'response contains no valid body';
                }
                if(response.data.failcode > 0){
                    throw `response contains 'failCode' ${response.data.failcode} ${response.data.message}`;
                }

                this.log.info('FusionSolar Api Login successful');
                await this.setStateAsync('info.connection', true, true);
                return true;
            }
            else {
                throw 'response contains no valid body';
            }
        } catch (error) {
            this.log.error('Api login error - check Username and password');
            if (typeof error === 'string') {
                this.log.error(error);
            } else if (error instanceof Error) {
                this.log.error(error.message);
            }
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

    async getStationList(){
        const requestBody =`{

        }`;
        return await axios.post(apiUrl + '/getStationList',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug('loading StationList');
            this.log.debug(JSON.stringify(response.data));

            if(response.data.failCode == 305){
                this.log.info('API requires re-logon!');
                loggedIn = false;
                return {};
            }

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
        }).catch((error) => {
            this.log.error(error);
        });
    }

    async getStationRealKpi(stationCode){
        const requestBody =`{
            "stationCodes": "${stationCode}"
        }`;
        return await axios.post(apiUrl + '/getStationRealKpi',
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
            return response.data.data;
        }).catch((error) => {
            this.log.error(error);
        });
    }

    async getDevList(stationCode){
        const requestBody =`{
            "stationCodes": "${stationCode}"
        }`;
        return await axios.post(apiUrl + '/getDevList',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug(`loading DevList for station ${stationCode}`);
            this.log.debug(JSON.stringify(response.data));
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
            this.log.error(error);
        });
    }

    async getDevRealKpi(deviceId, deviceTypeId){
        const requestBody =`{
            "devIds": "${deviceId}",
            "devTypeId": "${deviceTypeId}"
        }`;
        return await axios.post(apiUrl + '/getDevRealKpi',
            requestBody,
            { headers: {'XSRF-TOKEN' : `${accessToken}`}
            }).then(response => {
            this.log.debug(`loading DevRealKpi for device ${deviceId} (type ${deviceTypeId})`);
            this.log.debug(JSON.stringify(response.data));
            /*
            *** für Dongle (devTypeId=62)
              [t.b.d.]
            *** für Inverter (devTypeId=1)
              [t.b.d.]
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
            return response.data.data;
        }).catch((error) => {
            this.log.error(error);
        });
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
