'use strict';

const { expect } = require('chai');
const { FusionSolarApi, FusionSolarApiError, extractToken, normalizeHost } = require('./fusionSolarApi');

const noopLog = { debug() {}, info() {}, warn() {}, error() {}, silly() {}, level: 'info' };

/**
 * Creates a fake http client which answers with the given responses (in this order).
 * A response can be an object ({ data, headers }) or an Error (thrown).
 *
 * @param {any[]} responses
 */
function fakeHttp(responses) {
    const calls = [];
    return {
        calls,
        async post(url, data, config) {
            calls.push({ url, data, config });
            if (!responses.length) {
                throw new Error(`unexpected call of ${url}`);
            }
            const response = responses.shift();
            if (response instanceof Error) {
                throw response;
            }
            return response;
        },
    };
}

/**
 * @param {number} status
 */
function httpError(status) {
    return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
}

const LOGIN_OK = { data: { failCode: 0 }, headers: { 'xsrf-token': 'token-1' } };

/**
 * @param {any} httpClient
 * @param {Partial<import('./fusionSolarApi').FusionSolarApiOptions>} [options]
 */
function createApi(httpClient, options = {}) {
    return new FusionSolarApi({
        host: 'eu5.fusionsolar.huawei.com',
        userName: 'user',
        systemCode: 'secret',
        apiVersion: 'auto',
        callIntervalMs: 0,
        retryOnQuotaError: true,
        log: /** @type {any} */ (noopLog),
        delay: async () => {},
        httpClient,
        ...options,
    });
}

describe('fusionSolarApi => extractToken', () => {
    it('reads the xsrf-token header (case insensitive)', () => {
        expect(extractToken({ 'XSRF-TOKEN': 'abc' })).to.equal('abc');
        expect(extractToken({ 'xsrf-token': 'abc' })).to.equal('abc');
    });

    it('reads the token from a set-cookie array', () => {
        expect(extractToken({ 'set-cookie': ['foo=bar; Path=/', 'XSRF-TOKEN=xyz;Path=/;Secure'] })).to.equal('xyz');
    });

    it('returns null if there is no token', () => {
        expect(extractToken({ 'set-cookie': ['foo=bar'] })).to.equal(null);
        expect(extractToken(undefined)).to.equal(null);
    });
});

describe('fusionSolarApi => normalizeHost', () => {
    it('strips protocol and path', () => {
        expect(normalizeHost('https://eu5.fusionsolar.huawei.com/pvmswebsite/')).to.equal('eu5.fusionsolar.huawei.com');
        expect(normalizeHost(' intl.fusionsolar.huawei.com ')).to.equal('intl.fusionsolar.huawei.com');
    });
});

describe('fusionSolarApi => login', () => {
    it('fails with kind "auth" on an empty response (wrong credentials)', async () => {
        const api = createApi(fakeHttp([{ data: '', headers: {} }]));
        const error = await api.login().catch(e => e);
        expect(error).to.be.instanceOf(FusionSolarApiError);
        expect(error.kind).to.equal('auth');
    });

    it('fails with kind "auth" on a failCode', async () => {
        const api = createApi(fakeHttp([{ data: { failCode: 20001, message: 'bad' }, headers: {} }]));
        const error = await api.login().catch(e => e);
        expect(error.kind).to.equal('auth');
        expect(error.failCode).to.equal(20001);
    });

    it('does not crash on network errors without response', async () => {
        const api = createApi(fakeHttp([new Error('ECONNRESET')]));
        const error = await api.login().catch(e => e);
        expect(error.kind).to.equal('network');
    });
});

describe('fusionSolarApi => call', () => {
    it('logs in automatically and sends the token', async () => {
        const http = fakeHttp([LOGIN_OK, { data: { failCode: 0, data: [] } }]);
        const api = createApi(http);
        await api.call('/getDevList', {});
        expect(http.calls[1].config.headers['XSRF-TOKEN']).to.equal('token-1');
    });

    it('re-logs in once on failCode 305', async () => {
        const http = fakeHttp([
            LOGIN_OK,
            { data: { failCode: 305, message: 'USER_MUST_RELOGIN' } },
            { data: { failCode: 0 }, headers: { 'xsrf-token': 'token-2' } },
            { data: { failCode: 0, data: [] } },
        ]);
        const api = createApi(http);
        await api.call('/getDevList', {});
        expect(http.calls.map(c => c.url.split('/').pop())).to.deep.equal(['login', 'getDevList', 'login', 'getDevList']);
        expect(http.calls[3].config.headers['XSRF-TOKEN']).to.equal('token-2');
    });

    it('limits the retries on failCode 407', async () => {
        const quota = { data: { failCode: 407 } };
        const http = fakeHttp([LOGIN_OK, quota, quota, quota]);
        const api = createApi(http, { maxRetries: 2 });
        const error = await api.call('/getDevList', {}).catch(e => e);
        expect(error.kind).to.equal('quota');
        expect(http.calls).to.have.length(4);
    });

    it('does not retry on failCode 407 if retries are disabled', async () => {
        const http = fakeHttp([LOGIN_OK, { data: { failCode: 407 } }]);
        const api = createApi(http, { retryOnQuotaError: false });
        const error = await api.call('/getDevList', {}).catch(e => e);
        expect(error.kind).to.equal('quota');
    });

    it('retries on HTTP 403 and succeeds', async () => {
        const http = fakeHttp([LOGIN_OK, httpError(403), { data: { failCode: 0, data: [] } }]);
        const api = createApi(http);
        const body = await api.call('/getDevList', {});
        expect(body.failCode).to.equal(0);
    });

    it('waits between API calls', async () => {
        const waits = [];
        const http = fakeHttp([LOGIN_OK, { data: { failCode: 0 } }]);
        const api = createApi(http, { callIntervalMs: 3000, delay: async ms => void waits.push(ms) });
        await api.call('/getDevList', {});
        expect(waits).to.have.length.greaterThan(0);
        waits.forEach(ms => expect(ms).to.be.at.most(3000));
    });
});

describe('fusionSolarApi => data access', () => {
    it('returns an empty map if "data" is null (issue #21)', async () => {
        const http = fakeHttp([LOGIN_OK, { data: { failCode: 0, data: null } }]);
        const api = createApi(http);
        const result = await api.getStationRealKpi(['NE=1']);
        expect(result.size).to.equal(0);
    });

    it('maps the realtime KPIs of several devices of one batched call', async () => {
        const http = fakeHttp([
            LOGIN_OK,
            {
                data: {
                    failCode: 0,
                    data: [
                        { devId: 1000000035436846, dataItemMap: { active_power: 1.5 } },
                        { devId: 1000000035436849, dataItemMap: { active_power: 2.5 } },
                    ],
                },
            },
        ]);
        const api = createApi(http);
        const result = await api.getDevRealKpi(['1000000035436846', '1000000035436849'], 1);
        expect(http.calls[1].data).to.deep.equal({ devIds: '1000000035436846,1000000035436849', devTypeId: 1 });
        expect(result.get('1000000035436849')).to.deep.equal({ active_power: 2.5 });
    });

    it('falls back to the gen-2 station list (auto detection)', async () => {
        const http = fakeHttp([
            LOGIN_OK,
            { data: { failCode: 401 } },
            { data: { failCode: 0, data: { list: [{ plantCode: 'NE=2' }], pageCount: 1 } } },
        ]);
        const api = createApi(http);
        const stations = await api.getStations();
        expect(stations).to.deep.equal([{ plantCode: 'NE=2' }]);
        expect(api.apiVersion).to.equal('gen-2');
    });

    it('loads all pages of the gen-2 station list', async () => {
        const http = fakeHttp([
            LOGIN_OK,
            { data: { failCode: 0, data: { list: [{ plantCode: 'NE=1' }], pageCount: 2 } } },
            { data: { failCode: 0, data: { list: [{ plantCode: 'NE=2' }], pageCount: 2 } } },
        ]);
        const api = createApi(http, { apiVersion: 'gen-2' });
        const stations = await api.getStations();
        expect(stations).to.have.length(2);
    });
});
