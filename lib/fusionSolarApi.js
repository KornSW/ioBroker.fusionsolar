'use strict';

const axios = require('axios').default;

/*
 * Client for the Huawei FusionSolar northbound API ("thirdData" / "SmartPVMS NBI").
 *
 * Known behaviour of the API:
 *   - login:     POST /thirdData/login  { userName, systemCode }
 *                success:   failCode 0 and the token in the 'xsrf-token' header (+ XSRF-TOKEN cookie)
 *                bad creds: HTTP 200 with an empty body or a failCode != 0
 *   - all other calls need the token in the 'XSRF-TOKEN' request header
 *   - failCode 305: session expired -> re-login required
 *   - failCode 401: no permission for this interface (e.g. wrong API generation for the account)
 *   - failCode 407: access frequency too high (quota exceeded)
 *   - HTTP 403:     request rejected by the quota control of the API gateway
 */

const FAIL_CODE_OK = 0;
const FAIL_CODE_RELOGIN = 305;
const FAIL_CODE_NO_PERMISSION = 401;
const FAIL_CODE_FREQUENCY_TOO_HIGH = 407;

/** the API accepts up to 100 station codes / device ids per call */
const MAX_ITEMS_PER_CALL = 100;
const STATIONS_PAGE_SIZE = 100;

/**
 * @typedef {'auth' | 'quota' | 'permission' | 'api' | 'network' | 'invalidResponse'} ApiErrorKind
 */

/**
 * Error of the FusionSolar API - the 'kind' tells the adapter how to react.
 */
class FusionSolarApiError extends Error {
    /**
     * @param {string} message the error message
     * @param {ApiErrorKind} kind the kind of the error
     * @param {{ failCode?: number, httpStatus?: number }} [details] failCode / HTTP status
     */
    constructor(message, kind, details = {}) {
        super(message);
        this.name = 'FusionSolarApiError';
        this.kind = kind;
        this.failCode = details.failCode;
        this.httpStatus = details.httpStatus;
    }
}

/**
 * @typedef {object} FusionSolarApiOptions
 * @property {string} host - e.g. 'eu5.fusionsolar.huawei.com'
 * @property {string} userName - user name of the northbound API account
 * @property {string} systemCode - password of the northbound API account
 * @property {'auto' | 'gen-1' | 'gen-2'} apiVersion - API generation ('auto' = detect)
 * @property {number} callIntervalMs - minimum time between two API calls
 * @property {boolean} retryOnQuotaError - retry a call if the API reports a quota problem (407 / HTTP 403)
 * @property {number} [maxRetries] - max. number of retries per call (default: 3)
 * @property {ioBroker.Logger} log - logger
 * @property {(ms: number) => Promise<void>} delay - cancelable delay (provided by the adapter)
 * @property {{ post: (url: string, data?: any, config?: any) => Promise<any> }} [httpClient] - for tests
 */

/**
 * Client for the FusionSolar northbound API.
 */
class FusionSolarApi {
    /**
     * @param {FusionSolarApiOptions} options the options
     */
    constructor(options) {
        this.baseUrl = `https://${normalizeHost(options.host)}/thirdData`;
        this.userName = options.userName;
        this.systemCode = options.systemCode;
        this.apiVersion = options.apiVersion;
        this.callIntervalMs = options.callIntervalMs;
        this.retryOnQuotaError = options.retryOnQuotaError;
        this.maxRetries = options.maxRetries ?? 3;
        this.log = options.log;
        this.delay = options.delay;
        this.http = options.httpClient || axios.create({ timeout: 30000 });

        /** @type {string | null} */
        this.token = null;
        this.lastCallAt = 0;
    }

    /**
     * Waits until the configured time slot between two API calls has passed.
     * On retries the wait time is multiplied, to give the quota control of the API some time to recover.
     *
     * @param {number} attempt 0 for the first attempt, 1 for the first retry, ...
     */
    async throttle(attempt = 0) {
        const waitMs = this.callIntervalMs * (attempt + 1) - (Date.now() - this.lastCallAt);
        if (waitMs > 0) {
            await this.delay(waitMs);
        }
        this.lastCallAt = Date.now();
    }

    async login() {
        this.token = null;
        await this.throttle();
        this.log.debug(`logging in at ${this.baseUrl} ...`);

        let response;
        try {
            response = await this.http.post(`${this.baseUrl}/login`, {
                userName: this.userName,
                systemCode: this.systemCode,
            });
        } catch (error) {
            throw toApiError(error, 'login');
        }

        const body = response.data;
        if (!body || typeof body !== 'object') {
            throw new FusionSolarApiError(
                'Login failed: the API returned an empty response - please check user name and password of your API account',
                'auth',
            );
        }
        if (body.failCode === FAIL_CODE_FREQUENCY_TOO_HIGH) {
            throw new FusionSolarApiError('Login failed: access frequency is too high (failCode 407)', 'quota', {
                failCode: body.failCode,
            });
        }
        if (body.failCode !== FAIL_CODE_OK) {
            throw new FusionSolarApiError(
                `Login failed with failCode ${body.failCode}${body.message ? ` (${body.message})` : ''} - please check user name and password of your API account`,
                'auth',
                { failCode: body.failCode },
            );
        }

        const token = extractToken(response.headers);
        if (!token) {
            throw new FusionSolarApiError('Login failed: the API did not provide an XSRF-TOKEN', 'invalidResponse');
        }
        this.token = token;
        this.log.debug('login successful');
    }

    /**
     * Performs an API call incl. (re-)login and retries.
     *
     * @param {string} endpoint e.g. '/getStationRealKpi'
     * @param {Record<string, any>} requestBody
     * @returns {Promise<any>} the response body
     */
    async call(endpoint, requestBody) {
        let reloginDone = false;
        for (let attempt = 0; ; attempt++) {
            if (!this.token) {
                await this.login();
            }
            await this.throttle(attempt);
            this.log.debug(`calling ${endpoint} with ${JSON.stringify(requestBody)}`);

            let response;
            try {
                response = await this.http.post(`${this.baseUrl}${endpoint}`, requestBody, {
                    headers: { 'XSRF-TOKEN': this.token },
                });
            } catch (error) {
                const apiError = toApiError(error, endpoint);
                if (apiError.kind === 'auth' && !reloginDone) {
                    reloginDone = true;
                    this.token = null;
                    continue;
                }
                if (apiError.kind === 'quota' && this.canRetry(attempt)) {
                    this.log.info(`${apiError.message} - retrying (${attempt + 1}/${this.maxRetries})...`);
                    continue;
                }
                throw apiError;
            }

            const body = response.data;
            this.log.debug(`response of ${endpoint}: ${JSON.stringify(body)}`);
            if (!body || typeof body !== 'object') {
                throw new FusionSolarApiError(
                    `${endpoint}: the API returned an empty or invalid response`,
                    'invalidResponse',
                );
            }

            const failCode = body.failCode;
            if (failCode === FAIL_CODE_RELOGIN || body.message === 'USER_MUST_RELOGIN') {
                this.token = null;
                if (!reloginDone) {
                    reloginDone = true;
                    this.log.debug('the API requires a re-login');
                    continue;
                }
                throw new FusionSolarApiError(`${endpoint}: the API requires a re-login (failCode 305)`, 'auth', {
                    failCode,
                });
            }
            if (failCode === FAIL_CODE_FREQUENCY_TOO_HIGH) {
                if (this.canRetry(attempt)) {
                    this.log.info(
                        `${endpoint}: access frequency is too high (failCode 407) - retrying (${attempt + 1}/${this.maxRetries})...`,
                    );
                    continue;
                }
                throw new FusionSolarApiError(`${endpoint}: access frequency is too high (failCode 407)`, 'quota', {
                    failCode,
                });
            }
            if (failCode === FAIL_CODE_NO_PERMISSION) {
                throw new FusionSolarApiError(
                    `${endpoint}: no permission to use this interface (failCode 401)`,
                    'permission',
                    { failCode },
                );
            }
            if (failCode !== undefined && failCode !== null && failCode !== FAIL_CODE_OK) {
                throw new FusionSolarApiError(
                    `${endpoint}: the API returned failCode ${failCode}${body.message ? ` (${body.message})` : ''}`,
                    'api',
                    { failCode },
                );
            }
            return body;
        }
    }

    /**
     * @param {number} attempt
     */
    canRetry(attempt) {
        return this.retryOnQuotaError && attempt < this.maxRetries;
    }

    /**
     * Loads the list of stations (plants).
     * For the API generation 'auto', the 'gen-1' interface is tried first (to keep the
     * object structure of existing installations) and 'gen-2' is used as a fallback.
     *
     * @returns {Promise<Record<string, any>[]>}
     */
    async getStations() {
        if (this.apiVersion === 'gen-2') {
            return this.getStationsGen2();
        }
        if (this.apiVersion === 'gen-1') {
            return this.getStationsGen1();
        }
        try {
            const stations = await this.getStationsGen1();
            this.apiVersion = 'gen-1';
            this.log.info('API generation detected: gen-1');
            return stations;
        } catch (error) {
            if (!(error instanceof FusionSolarApiError) || (error.kind !== 'permission' && error.kind !== 'api')) {
                throw error;
            }
            this.log.debug(`gen-1 station list not available (${error.message}) - trying gen-2...`);
        }
        const stations = await this.getStationsGen2();
        this.apiVersion = 'gen-2';
        this.log.info('API generation detected: gen-2');
        return stations;
    }

    async getStationsGen1() {
        const body = await this.call('/getStationList', {});
        return asArray(body.data);
    }

    async getStationsGen2() {
        const stations = [];
        for (let pageNo = 1; ; pageNo++) {
            const body = await this.call('/stations', { pageNo, pageSize: STATIONS_PAGE_SIZE });
            const data = body.data || {};
            stations.push(...asArray(data.list));
            const pageCount = Number(data.pageCount) || 1;
            if (pageNo >= pageCount) {
                return stations;
            }
        }
    }

    /**
     * @param {string[]} stationCodes
     * @returns {Promise<Map<string, Record<string, any>>>} dataItemMap per station code
     */
    async getStationRealKpi(stationCodes) {
        const result = new Map();
        for (const codes of chunk(stationCodes, MAX_ITEMS_PER_CALL)) {
            const body = await this.call('/getStationRealKpi', { stationCodes: codes.join(',') });
            for (const item of asArray(body.data)) {
                if (item && item.stationCode !== undefined && item.dataItemMap) {
                    result.set(String(item.stationCode), item.dataItemMap);
                }
            }
        }
        return result;
    }

    /**
     * @param {string[]} stationCodes
     * @returns {Promise<Record<string, any>[]>}
     */
    async getDevList(stationCodes) {
        const devices = [];
        for (const codes of chunk(stationCodes, MAX_ITEMS_PER_CALL)) {
            const body = await this.call('/getDevList', { stationCodes: codes.join(',') });
            devices.push(...asArray(body.data).filter(dev => dev && dev.id !== undefined && dev.id !== null));
        }
        return devices;
    }

    /**
     * @param {(string | number)[]} devIds all devices must be of the same type
     * @param {number} devTypeId
     * @returns {Promise<Map<string, Record<string, any>>>} dataItemMap per device id
     */
    async getDevRealKpi(devIds, devTypeId) {
        const result = new Map();
        for (const ids of chunk(devIds, MAX_ITEMS_PER_CALL)) {
            const body = await this.call('/getDevRealKpi', { devIds: ids.join(','), devTypeId });
            for (const item of asArray(body.data)) {
                if (item && item.devId !== undefined && item.dataItemMap) {
                    result.set(String(item.devId), item.dataItemMap);
                }
            }
        }
        return result;
    }
}

/**
 * Converts an error thrown by the http client into a FusionSolarApiError.
 *
 * @param {any} error
 * @param {string} endpoint
 * @returns {FusionSolarApiError}
 */
function toApiError(error, endpoint) {
    if (error instanceof FusionSolarApiError) {
        return error;
    }
    const httpStatus = error && error.response ? error.response.status : undefined;
    if (httpStatus === 403) {
        return new FusionSolarApiError(
            `${endpoint}: request rejected by the quota control of the API (HTTP 403)`,
            'quota',
            {
                httpStatus,
            },
        );
    }
    if (httpStatus === 401) {
        return new FusionSolarApiError(`${endpoint}: not authorized (HTTP 401)`, 'auth', { httpStatus });
    }
    if (httpStatus) {
        return new FusionSolarApiError(`${endpoint}: HTTP ${httpStatus}`, 'api', { httpStatus });
    }
    const message = error && error.message ? error.message : String(error);
    return new FusionSolarApiError(`${endpoint}: ${message}`, 'network');
}

/**
 * Extracts the XSRF token from the login response headers (header 'xsrf-token' or cookie 'XSRF-TOKEN').
 *
 * @param {any} headers
 * @returns {string | null}
 */
function extractToken(headers) {
    if (!headers) {
        return null;
    }
    const plainHeaders = typeof headers.toJSON === 'function' ? headers.toJSON() : headers;
    let cookies = [];
    for (const name of Object.keys(plainHeaders)) {
        const lowerName = name.toLowerCase();
        const value = plainHeaders[name];
        if (lowerName === 'xsrf-token' && value) {
            return String(value);
        }
        if (lowerName === 'set-cookie' && value) {
            cookies = Array.isArray(value) ? value : [value];
        }
    }
    for (const cookie of cookies) {
        const match = /(?:^|;\s*)XSRF-TOKEN=([^;]+)/i.exec(String(cookie));
        if (match) {
            return match[1];
        }
    }
    return null;
}

/**
 * @param {string} host
 */
function normalizeHost(host) {
    return String(host || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '');
}

/**
 * @param {any} value
 * @returns {any[]}
 */
function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

module.exports = {
    FusionSolarApi,
    FusionSolarApiError,
    extractToken,
    normalizeHost,
};
