'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const rewire = require('rewire');
const sinon = require('sinon');
const yaml = require('js-yaml');
const _ = require('lodash');
const index = rewire('../index.js');

sinon.assert.expose(assert, { prefix: '' });

const DEFAULT_BUILD_TIMEOUT = 90;
const MAX_BUILD_TIMEOUT = 120;
const TEST_TIM_YAML = `
metadata:
  cpu: {{cpu}}
  memory: {{memory}}
  name: {{build_id_with_prefix}}
  container: {{container}}
  launchVersion: {{launcher_version}}
command:
- "/opt/sd/launch {{api_uri}} {{store_uri}} {{token}} {{build_timeout}} {{build_id}}"
spec:
  affinity:
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
          labelSelector:
            matchExpressions:
            - key: app
              operator: In
              values:
              - test
`;
const MAXATTEMPTS = 5;
const RETRYDELAY = 3000;

describe('index', () => {
    let Executor;
    let requestRetryMock;
    let fsMock;
    let executor;
    const testBuildId = 15;
    const testToken = 'abcdefg';
    const testApiUri = 'http://api:8080';
    const testStoreUri = 'http://store:8080';
    const testContainer = 'node:4';
    const testLaunchVersion = 'stable';
    const podsUrl = 'https://kubernetes.default/api/v1/namespaces/default/pods';
    const testSpec = {
        tolerations: [{
            key: 'key',
            value: 'value',
            effect: 'NoSchedule',
            operator: 'Equal'
        }],
        affinity: {
            nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms: [{
                        matchExpressions: [{
                            key: 'key',
                            operator: 'In',
                            values: ['value']
                        }]
                    }]
                }
            }
        }
    };
    const testPreferredSpec = {
        affinity: {
            nodeAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                    {
                        weight: 100,
                        preference: {
                            matchExpressions: [
                                {
                                    key: 'key',
                                    operator: 'In',
                                    values: ['value']
                                },
                                {
                                    key: 'foo',
                                    operator: 'In',
                                    values: ['bar']
                                }
                            ]
                        }
                    }
                ]
            }
        }
    };
    const testPodSpec = {
        affinity: {
            podAntiAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                    {
                        weight: 100,
                        podAffinityTerm: {
                            topologyKey: 'kubernetes.io/hostname',
                            labelSelector: {
                                matchExpressions: [
                                    {
                                        key: 'app',
                                        operator: 'In',
                                        values: ['test']
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        }
    };

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        requestRetryMock = sinon.stub();

        fsMock = {
            readFileSync: sinon.stub(),
            existsSync: sinon.stub()
        };

        fsMock.readFileSync.withArgs('/var/run/secrets/kubernetes.io/serviceaccount/token')
            .returns('api_key');
        fsMock.readFileSync.withArgs(sinon.match(/config\/pod.yaml.tim/))
            .returns(TEST_TIM_YAML);
        fsMock.existsSync.returns(true);

        mockery.registerMock('fs', fsMock);
        mockery.registerMock('requestretry', requestRetryMock);

        /* eslint-disable global-require */
        Executor = require('../index');
        /* eslint-enable global-require */

        executor = new Executor({
            ecosystem: {
                api: testApiUri,
                store: testStoreUri
            },
            kubernetes: {
                nodeSelectors: {},
                preferredNodeSelectors: {}
            },
            fusebox: { retry: { minTimeout: 1 } },
            prefix: 'beta_'
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('supports specifying a specific version', () => {
        assert.equal(executor.launchVersion, 'stable');
        assert.equal(executor.token, 'api_key');
        assert.equal(executor.host, 'kubernetes.default');
        executor = new Executor({
            kubernetes: {
                buildTimeout: 30,
                maxBuildTimeout: 300,
                nodeSelectors: {},
                token: 'api_key2',
                host: 'kubernetes2',
                jobsNamespace: 'baz',
                baseImage: 'hyperctl',
                resources: {
                    cpu: {
                        high: 8,
                        low: 2,
                        micro: 1
                    },
                    memory: {
                        high: 5,
                        low: 2,
                        micro: 1
                    }
                }
            },
            prefix: 'beta_',
            launchVersion: 'v1.2.3'
        });
        assert.equal(executor.buildTimeout, 30);
        assert.equal(executor.maxBuildTimeout, 300);
        assert.equal(executor.baseImage, 'hyperctl');
        assert.equal(executor.prefix, 'beta_');
        assert.equal(executor.token, 'api_key2');
        assert.equal(executor.host, 'kubernetes2');
        assert.equal(executor.launchVersion, 'v1.2.3');
        assert.equal(executor.jobsNamespace, 'baz');
        assert.equal(executor.highCpu, 8);
        assert.equal(executor.lowCpu, 2);
        assert.equal(executor.microCpu, 1);
        assert.equal(executor.highMemory, 5);
        assert.equal(executor.lowMemory, 2);
        assert.equal(executor.microMemory, 1);
    });

    it('allow empty options', () => {
        fsMock.existsSync.returns(false);
        executor = new Executor();
        assert.equal(executor.buildTimeout, DEFAULT_BUILD_TIMEOUT);
        assert.equal(executor.maxBuildTimeout, MAX_BUILD_TIMEOUT);
        assert.equal(executor.launchVersion, 'stable');
        assert.equal(executor.host, 'kubernetes.default');
        assert.equal(executor.launchVersion, 'stable');
        assert.equal(executor.prefix, '');
        assert.equal(executor.token, '');
        assert.equal(executor.highCpu, 6);
        assert.equal(executor.lowCpu, 2);
        assert.equal(executor.microCpu, 1);
        assert.equal(executor.highMemory, 12);
        assert.equal(executor.lowMemory, 2);
        assert.equal(executor.microMemory, 1);
    });

    it('extends base class', () => {
        assert.isFunction(executor.stop);
        assert.isFunction(executor.start);
    });

    describe('stats', () => {
        it('returns the correct stats', () => {
            assert.deepEqual(executor.stats(), {
                requests: {
                    total: 0,
                    timeouts: 0,
                    success: 0,
                    failure: 0,
                    concurrent: 0,
                    averageTime: 0
                },
                breaker: {
                    isClosed: true
                }
            });
        });
    });

    describe('stop', () => {
        const fakeStopResponse = {
            statusCode: 200,
            body: {
                success: 'true'
            }
        };
        const deleteConfig = {
            uri: podsUrl,
            method: 'DELETE',
            qs: {
                labelSelector: `sdbuild=beta_${testBuildId}`
            },
            headers: {
                Authorization: 'Bearer api_key'
            },
            strictSSL: false
        };

        beforeEach(() => {
            requestRetryMock.yieldsAsync(null, fakeStopResponse, fakeStopResponse.body);
        });

        it('calls breaker with correct config', () => (
            executor.stop({
                buildId: testBuildId
            }).then(() => {
                assert.calledWith(requestRetryMock, deleteConfig);
                assert.calledOnce(requestRetryMock);
            })
        ));

        it('returns error when breaker does', () => {
            const error = new Error('error');

            requestRetryMock.yieldsAsync(error);

            return executor.stop({
                buildId: testBuildId
            }).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.deepEqual(err, error);
                assert.equal(requestRetryMock.callCount, 5);
            });
        });

        it('returns error when response is non 200', () => {
            const fakeStopErrorResponse = {
                statusCode: 500,
                body: {
                    error: 'foo'
                }
            };

            const returnMessage = 'Failed to delete pod: '
                  + `${JSON.stringify(fakeStopErrorResponse.body)}`;

            requestRetryMock.yieldsAsync(null, fakeStopErrorResponse, fakeStopErrorResponse.body);

            return executor.stop({
                buildId: testBuildId
            }).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.equal(err.message, returnMessage);
            });
        });
    });

    describe('start', () => {
        let postConfig;
        let getConfig;
        let fakeStartConfig;

        const fakeStartResponse = {
            statusCode: 201,
            body: {
                metadata: {
                    name: 'testpod'
                },
                success: true
            }
        };
        const fakeGetResponse = {
            statusCode: 200,
            body: {
                status: {
                    phase: 'running'
                }
            }
        };

        beforeEach(() => {
            postConfig = {
                uri: podsUrl,
                method: 'POST',
                body: {
                    metadata: {
                        cpu: 2,
                        memory: 2048,
                        name: 'beta_15',
                        container: testContainer,
                        launchVersion: testLaunchVersion
                    },
                    spec: testPodSpec,
                    command: [
                        '/opt/sd/launch http://api:8080 http://store:8080 abcdefg '
                        + `${DEFAULT_BUILD_TIMEOUT} 15`
                    ]
                },
                headers: {
                    Authorization: 'Bearer api_key'
                },
                strictSSL: false,
                json: true
            };

            getConfig = {
                uri: `${podsUrl}/testpod/status`,
                method: 'GET',
                headers: {
                    Authorization: 'Bearer api_key'
                },
                strictSSL: false,
                maxAttempts: MAXATTEMPTS,
                retryDelay: RETRYDELAY,
                // eslint-disable-next-line
                retryStrategy: executor.podRetryStrategy
            };

            fakeStartConfig = {
                annotations: {},
                buildId: testBuildId,
                container: testContainer,
                token: testToken,
                apiUri: testApiUri
            };

            requestRetryMock.withArgs(sinon.match({ method: 'POST' })).yieldsAsync(
                null, fakeStartResponse, fakeStartResponse.body);
            requestRetryMock.withArgs(sinon.match({ method: 'GET' })).yieldsAsync(
                null, fakeGetResponse, fakeGetResponse.body);
        });

        it('successfully calls start', () =>
            executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            })
        );

        it('sets the memory appropriately when ram is set to HIGH', () => {
            postConfig.body.metadata.memory = 12288;
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/ram': 'HIGH' };

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets the memory appropriately when ram is set to MICRO', () => {
            postConfig.body.metadata.memory = 1024;
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/ram': 'MICRO' };

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets the CPU appropriately when cpu is set to HIGH', () => {
            postConfig.body.metadata.cpu = 6;
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/cpu': 'HIGH' };

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets the CPU appropriately when cpu is set to MICRO', () => {
            postConfig.body.metadata.cpu = 1;
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/cpu': 'MICRO' };

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets tolerations and node affinity with appropriate node config', () => {
            const spec = _.merge({}, testSpec, testPodSpec);

            postConfig.body.spec = spec;

            executor = new Executor({
                ecosystem: {
                    api: testApiUri,
                    store: testStoreUri
                },
                fusebox: { retry: { minTimeout: 1 } },
                kubernetes: {
                    nodeSelectors: { key: 'value' },
                    token: 'api_key',
                    host: 'kubernetes.default',
                    baseImage: 'hyperctl'
                },
                prefix: 'beta_'
            });

            getConfig.retryStrategy = executor.podRetryStrategy;

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets preferred node affinity with appropriate node config', () => {
            const spec = _.merge({}, testPreferredSpec, testPodSpec);

            postConfig.body.spec = spec;

            executor = new Executor({
                ecosystem: {
                    api: testApiUri,
                    store: testStoreUri
                },
                fusebox: { retry: { minTimeout: 1 } },
                prefix: 'beta_',
                kubernetes: {
                    preferredNodeSelectors: { key: 'value', foo: 'bar' }
                }
            });

            getConfig.retryStrategy = executor.podRetryStrategy;

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('sets node affinity and preferred node affinity', () => {
            const spec = _.merge({}, testSpec, testPreferredSpec, testPodSpec);

            postConfig.body.spec = spec;

            executor = new Executor({
                ecosystem: {
                    api: testApiUri,
                    store: testStoreUri
                },
                fusebox: { retry: { minTimeout: 1 } },
                prefix: 'beta_',
                kubernetes: {
                    nodeSelectors: { key: 'value' },
                    preferredNodeSelectors: { key: 'value', foo: 'bar' }
                }
            });

            getConfig.retryStrategy = executor.podRetryStrategy;

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall,
                    sinon.match(getConfig));
            });
        });

        it('returns error when request responds with error', () => {
            const error = new Error('lol');

            requestRetryMock.withArgs(postConfig).yieldsAsync(error);

            return executor.start(fakeStartConfig).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.deepEqual(err, error);
            });
        });

        it('returns error when not able to get pod status', () => {
            const returnResponse = {
                statusCode: 500,
                body: {
                    statusCode: 500,
                    message: 'cannot get pod status'
                }
            };
            const returnMessage = `Failed to get pod status:
                        ${JSON.stringify(returnResponse.body, null, 2)}`;

            requestRetryMock.withArgs(getConfig).yieldsAsync(
                null, returnResponse, returnResponse.body);

            return executor.start(fakeStartConfig).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.equal(err.message, returnMessage);
            });
        });

        it('returns error when pod status is failed', () => {
            const returnResponse = {
                statusCode: 200,
                body: {
                    status: {
                        phase: 'failed'
                    }
                }
            };
            const returnMessage = `Failed to create pod. Pod status is:
                        ${JSON.stringify(returnResponse.body.status, null, 2)}`;

            requestRetryMock.withArgs(getConfig).yieldsAsync(
                null, returnResponse, returnResponse.body);

            return executor.start(fakeStartConfig).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.equal(err.message, returnMessage);
            });
        });

        it('returns body when request responds with error in response', () => {
            const returnResponse = {
                statusCode: 500,
                body: {
                    statusCode: 500,
                    message: 'lol'
                }
            };
            const returnMessage = `Failed to create pod: ${JSON.stringify(returnResponse.body)}`;

            requestRetryMock.withArgs(postConfig).yieldsAsync(
                null, returnResponse, returnResponse.body);

            return executor.start(fakeStartConfig).then(() => {
                throw new Error('did not fail');
            }, (err) => {
                assert.equal(err.message, returnMessage);
            });
        });

        it('sets the build timeout to default build timeout if not configured by user', () => {
            postConfig.body.command = [
                '/opt/sd/launch http://api:8080 http://store:8080 abcdefg '
                + `${DEFAULT_BUILD_TIMEOUT} 15`
            ];

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall, sinon.match(getConfig));
            });
        });

        it('sets the build timeout if configured by user', () => {
            const userTimeout = 45;

            postConfig.body.command = [
                `/opt/sd/launch http://api:8080 http://store:8080 abcdefg ${userTimeout} 15`
            ];
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/timeout': userTimeout };

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall, sinon.match(getConfig));
            });
        });

        it('sets the timeout to maxBuildTimeout if user specified a higher timeout', () => {
            fakeStartConfig.annotations = { 'beta.screwdriver.cd/timeout': 220 };
            postConfig.body.command = [
                '/opt/sd/launch http://api:8080 http://store:8080 abcdefg '
                + `${MAX_BUILD_TIMEOUT} 15`
            ];

            return executor.start(fakeStartConfig).then(() => {
                assert.calledWith(requestRetryMock.firstCall, postConfig);
                assert.calledWith(requestRetryMock.secondCall, sinon.match(getConfig));
            });
        });
    });

    describe('setNodeSelector', () => {
        // eslint-disable-next-line no-underscore-dangle
        const setNodeSelector = index.__get__('setNodeSelector');

        let nodeSelectors;
        let fakeConfig;

        beforeEach(() => {
            nodeSelectors = null;
            fakeConfig = yaml.safeLoad(TEST_TIM_YAML);
        });

        it('does nothing if nodeSelector is not set', () => {
            const updatedConfig = JSON.parse(JSON.stringify(fakeConfig));

            setNodeSelector(fakeConfig, nodeSelectors);
            assert.deepEqual(fakeConfig, updatedConfig);
        });

        it('updates config with tolerations', () => {
            const updatedConfig = JSON.parse(JSON.stringify(fakeConfig));
            const spec = _.merge({}, testSpec, testPodSpec);

            updatedConfig.spec = spec;
            nodeSelectors = { key: 'value' };

            setNodeSelector(fakeConfig, nodeSelectors);
            assert.deepEqual(fakeConfig, updatedConfig);
        });
    });

    describe('setPreferredNodeSelector', () => {
        // eslint-disable-next-line no-underscore-dangle
        const setPreferredNodeSelector = index.__get__('setPreferredNodeSelector');

        let nodeSelectors;
        let fakeConfig;

        beforeEach(() => {
            nodeSelectors = null;
            fakeConfig = yaml.safeLoad(TEST_TIM_YAML);
        });

        it('does nothing if preferredNodeSelector is not set', () => {
            const updatedConfig = JSON.parse(JSON.stringify(fakeConfig));

            setPreferredNodeSelector(fakeConfig, nodeSelectors);
            assert.deepEqual(fakeConfig, updatedConfig);
        });

        it('updates config with preferred node settings', () => {
            const updatedConfig = JSON.parse(JSON.stringify(fakeConfig));
            const spec = _.merge({}, testPreferredSpec, testPodSpec);

            updatedConfig.spec = spec;
            nodeSelectors = { key: 'value', foo: 'bar' };

            setPreferredNodeSelector(fakeConfig, nodeSelectors);
            assert.deepEqual(fakeConfig, updatedConfig);
        });
    });
});
