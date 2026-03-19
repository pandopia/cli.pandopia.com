const test = require('node:test');
const assert = require('node:assert/strict');

const { runCli } = require('../dist/cli.js');
const { SessionStore } = require('../dist/session.js');
const { PandopiaApiClient } = require('../dist/api.js');
const { DEFAULT_SERVER } = require('../dist/servers.js');

class MemoryConfigStore {
  constructor(initialServer = DEFAULT_SERVER) {
    this.activeServer = initialServer;
    this.profiles = {};
  }

  async getActiveServer() {
    return this.activeServer;
  }

  async setActiveServer(server) {
    this.activeServer = server;
  }

  async getProfile(server) {
    return this.profiles[server];
  }

  async upsertProfile(server, patch) {
    this.profiles[server] = {
      ...(this.profiles[server] || {}),
      ...patch,
    };
  }

  async clearProfile(server) {
    delete this.profiles[server];
  }
}

class MemorySecretStore {
  constructor() {
    this.values = new Map();
  }

  key(server, name) {
    return `${server}::${name}`;
  }

  async get(server, name) {
    return this.values.get(this.key(server, name)) ?? null;
  }

  async set(server, name, value) {
    this.values.set(this.key(server, name), value);
  }

  async delete(server, name) {
    this.values.delete(this.key(server, name));
  }
}

class MockPrompt {
  constructor({ answers = [], hiddenAnswers = [], choices = [] } = {}) {
    this.answers = [...answers];
    this.hiddenAnswers = [...hiddenAnswers];
    this.choices = [...choices];
  }

  async ask() {
    return this.answers.shift() ?? '';
  }

  async askHidden() {
    return this.hiddenAnswers.shift() ?? '';
  }

  async choose(_question, options) {
    const selected = this.choices.shift();
    if (selected === undefined) {
      return options[0];
    }
    const match = options.find((option) => option.value === selected);
    return match || options[0];
  }
}

function createResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  };
}

function createWriters() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: {
      write(chunk) {
        stdout += String(chunk);
      },
    },
    stderr: {
      write(chunk) {
        stderr += String(chunk);
      },
    },
    readStdout() {
      return stdout;
    },
    readStderr() {
      return stderr;
    },
  };
}

function createRuntime({ fetchImpl, prompt } = {}) {
  const config = new MemoryConfigStore();
  const secrets = new MemorySecretStore();
  const sessionStore = new SessionStore(config, secrets);
  const calls = [];
  const fetchFn =
    fetchImpl ||
    (async (url, init) => {
      calls.push({ url, init });
      throw new Error(`Unexpected fetch: ${url}`);
    });
  const apiClient = new PandopiaApiClient(
    async (url, init) => {
      calls.push({ url, init });
      return fetchFn(url, init, calls.length - 1);
    },
    sessionStore
  );
  const writers = createWriters();
  return {
    config,
    secrets,
    sessionStore,
    apiClient,
    prompt: prompt || new MockPrompt(),
    calls,
    ...writers,
  };
}

test('pandopia with no args shows help and status', async () => {
  const runtime = createRuntime();
  const exitCode = await runCli([], runtime);

  assert.equal(exitCode, 0);
  assert.match(runtime.readStdout(), /Pandopia Catalog CLI/);
  assert.match(runtime.readStdout(), /Active server: https:\/\/app\.pandopia\.com/);
  assert.match(runtime.readStdout(), /Login status: not logged in/);
});

test('missing args show usage for list, get, and params', async () => {
  {
    const runtime = createRuntime();
    const exitCode = await runCli(['list'], runtime);
    assert.equal(exitCode, 1);
    assert.match(runtime.readStderr(), /pandopia list <catalogType>/);
  }

  {
    const runtime = createRuntime();
    const exitCode = await runCli(['get', 'diag_dpereglementaire'], runtime);
    assert.equal(exitCode, 1);
    assert.match(runtime.readStderr(), /pandopia get <catalogType> <objectId>/);
  }

  {
    const runtime = createRuntime();
    const exitCode = await runCli(['params'], runtime);
    assert.equal(exitCode, 1);
    assert.match(runtime.readStderr(), /pandopia params <catalogType>/);
  }
});

test('unauthenticated catalog command returns a clean error instead of a stack trace', async () => {
  const runtime = createRuntime();
  const exitCode = await runCli(['types'], runtime);

  assert.equal(exitCode, 1);
  assert.equal(runtime.readStdout(), '');
  assert.equal(runtime.readStderr(), 'Run pandopia login <email>\n');
});

test('login stores credentials after loginensureclient and accesstoken', async () => {
  const runtime = createRuntime({
    prompt: new MockPrompt({ hiddenAnswers: ['secret-password'] }),
    fetchImpl: async (url) => {
      if (url.endsWith('/api/auth/loginensureclient')) {
        return createResponse(200, {
          status: 'OK',
          data: {
            client_id: 'client-id',
            client_secret: 'client-secret',
            user: { name: 'Cyril Bele' },
          },
        });
      }

      if (url.endsWith('/api/auth/accesstoken')) {
        return createResponse(200, {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const exitCode = await runCli(['login', 'cyril.bele@gmail.com'], runtime);

  assert.equal(exitCode, 0);
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'access_token'),
    'access-token'
  );
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'refresh_token'),
    'refresh-token'
  );
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'client_id'),
    'client-id'
  );
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'client_secret'),
    'client-secret'
  );
  assert.equal(runtime.config.profiles[DEFAULT_SERVER].email, 'cyril.bele@gmail.com');
  assert.match(runtime.readStdout(), /Logged in on https:\/\/app\.pandopia\.com as Cyril Bele/);
});

test('login retries with selected userId on multiple accounts', async () => {
  const runtime = createRuntime({
    prompt: new MockPrompt({
      hiddenAnswers: ['secret-password'],
      choices: ['42'],
    }),
    fetchImpl: async (url, init, callIndex) => {
      if (url.endsWith('/api/auth/loginensureclient')) {
        return createResponse(200, {
          status: 'OK',
          data: {
            client_id: 'client-id',
            client_secret: 'client-secret',
          },
        });
      }

      if (url.endsWith('/api/auth/accesstoken') && callIndex === 1) {
        return createResponse(300, {
          users: [
            { id: '41', name: 'Account A', email: 'a@example.com' },
            { id: '42', name: 'Account B', email: 'b@example.com' },
          ],
        });
      }

      if (url.endsWith('/api/auth/loginensureclient') && callIndex === 2) {
        assert.match(init.body, /userId=42/);
        return createResponse(200, {
          status: 'OK',
          data: {
            client_id: 'client-id',
            client_secret: 'client-secret',
          },
        });
      }

      if (url.endsWith('/api/auth/accesstoken') && callIndex === 3) {
        assert.match(init.body, /userId=42/);
        return createResponse(200, {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const exitCode = await runCli(['login', 'cyril.bele@gmail.com'], runtime);

  assert.equal(exitCode, 0);
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'access_token'),
    'access-token'
  );
});

test('login retries loginensureclient with selected userId on multiple accounts', async () => {
  const runtime = createRuntime({
    prompt: new MockPrompt({
      hiddenAnswers: ['secret-password'],
      choices: ['42'],
    }),
    fetchImpl: async (url, init, callIndex) => {
      if (url.endsWith('/api/auth/loginensureclient') && callIndex === 0) {
        return createResponse(300, {
          status: 'KO',
          error: { code: 300, message: 'MultipleAccounts' },
          users: [
            { id: '41', name: 'Account A', email: 'a@example.com' },
            { id: '42', name: 'Account B', email: 'b@example.com' },
          ],
        });
      }

      if (url.endsWith('/api/auth/loginensureclient') && callIndex === 1) {
        assert.match(init.body, /userId=42/);
        return createResponse(200, {
          status: 'OK',
          data: {
            client_id: 'client-id',
            client_secret: 'client-secret',
            user: { name: 'Account B' },
          },
        });
      }

      if (url.endsWith('/api/auth/accesstoken') && callIndex === 2) {
        assert.match(init.body, /userId=42/);
        return createResponse(200, {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  const exitCode = await runCli(['login', 'admin@pandopia.com'], runtime);

  assert.equal(exitCode, 0);
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'access_token'),
    'access-token'
  );
  assert.match(runtime.readStdout(), /Logged in on https:\/\/app\.pandopia\.com as Account B/);
});

test('401 on catalog request refreshes token once and retries', async () => {
  const runtime = createRuntime({
    fetchImpl: async (url, init, callIndex) => {
      if (url.endsWith('/api/catalog/types') && callIndex === 0) {
        assert.equal(init.headers.Authorization, 'Bearer old-access');
        return createResponse(401, {
          status: 'ko',
          error: { message: 'not authenticated' },
        });
      }

      if (url.endsWith('/api/auth/refreshtoken')) {
        return createResponse(200, {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
        });
      }

      if (url.endsWith('/api/catalog/types') && callIndex === 2) {
        assert.equal(init.headers.Authorization, 'Bearer new-access');
        return createResponse(200, {
          status: 'ok',
          data: [{ type: 'diag_dpereglementaire', objectName: 'Diagnostic DPE' }],
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    },
  });

  await runtime.sessionStore.saveLogin(DEFAULT_SERVER, {
    email: 'cyril.bele@gmail.com',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  });

  const exitCode = await runCli(['types'], runtime);

  assert.equal(exitCode, 0);
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'access_token'),
    'new-access'
  );
  assert.equal(
    await runtime.secrets.get(DEFAULT_SERVER, 'refresh_token'),
    'new-refresh'
  );
  assert.match(runtime.readStdout(), /diag_dpereglementaire/);
});

test('logout clears only the active server profile', async () => {
  const runtime = createRuntime();
  await runtime.sessionStore.saveLogin(DEFAULT_SERVER, {
    email: 'app@example.com',
    accessToken: 'app-token',
    refreshToken: 'app-refresh',
    clientId: 'app-client',
    clientSecret: 'app-secret',
  });
  await runtime.sessionStore.saveLogin('https://test.pandopia.com', {
    email: 'test@example.com',
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    clientId: 'test-client',
    clientSecret: 'test-secret',
  });
  await runtime.sessionStore.setActiveServer(DEFAULT_SERVER);

  const exitCode = await runCli(['logout'], runtime);

  assert.equal(exitCode, 0);
  assert.equal(await runtime.secrets.get(DEFAULT_SERVER, 'access_token'), null);
  assert.equal(
    await runtime.secrets.get('https://test.pandopia.com', 'access_token'),
    'test-token'
  );
  assert.equal(runtime.config.profiles[DEFAULT_SERVER], undefined);
  assert.equal(runtime.config.profiles['https://test.pandopia.com'].email, 'test@example.com');
});

test('list forwards reserved and passthrough query params with preserved casing', async () => {
  const runtime = createRuntime({
    fetchImpl: async (url) => {
      assert.match(
        url,
        /\/api\/catalog\/diag_dpereglementaire\?DIAG_STATUS=valide&organismeRef=lmh_6&page=2&perPage=5&search=logement&paramsList=DIAG_STATUS%2CDIAG_DPE_ETIQUETTEDPE/
      );
      return createResponse(200, {
        status: 'ok',
        pagination: { page: 2, perPage: 5, nbPages: 3, totalNb: 12 },
        data: [{ id: 1235, DIAG_STATUS: 'valide', organismeRef: 'lmh_6' }],
      });
    },
  });

  await runtime.sessionStore.saveLogin(DEFAULT_SERVER, {
    email: 'cyril.bele@gmail.com',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  });

  const exitCode = await runCli(
    [
      'list',
      'diag_dpereglementaire',
      '--DIAG_STATUS=valide',
      '--organismeRef',
      'lmh_6',
      '--page',
      '2',
      '--per-page',
      '5',
      '--search',
      'logement',
      '--params',
      'DIAG_STATUS,DIAG_DPE_ETIQUETTEDPE',
    ],
    runtime
  );

  assert.equal(exitCode, 0);
  assert.match(runtime.readStdout(), /Page 2 \/ 3 \| perPage 5 \| total 12/);
  assert.match(runtime.readStdout(), /"DIAG_STATUS": "valide"/);
});

test('params and get support readable output and json output', async () => {
  {
    const runtime = createRuntime({
      fetchImpl: async (url) => {
        if (url.endsWith('/api/catalog/diag_dpereglementaire/params')) {
          return createResponse(200, {
            status: 'ok',
            data: {
              filters: ['DIAG_STATUS', 'organismeRef'],
              params: [
                { code: 'DIAG_STATUS', name: 'Statut', type: 'list', required: false },
              ],
            },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    await runtime.sessionStore.saveLogin(DEFAULT_SERVER, {
      email: 'cyril.bele@gmail.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const exitCode = await runCli(['params', 'diag_dpereglementaire'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /Filters:/);
    assert.match(runtime.readStdout(), /DIAG_STATUS/);
    assert.match(runtime.readStdout(), /Statut/);
  }

  {
    const runtime = createRuntime({
      fetchImpl: async (url) => {
        if (url.endsWith('/api/catalog/diag_dpereglementaire/1235?paramsList=DIAG_STATUS')) {
          return createResponse(200, {
            status: 'ok',
            data: { id: 1235, DIAG_STATUS: 'valide' },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    await runtime.sessionStore.saveLogin(DEFAULT_SERVER, {
      email: 'cyril.bele@gmail.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    const exitCode = await runCli(
      ['get', 'diag_dpereglementaire', '1235', '--params', 'DIAG_STATUS', '--json'],
      runtime
    );
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /"status": "ok"/);
    assert.match(runtime.readStdout(), /"DIAG_STATUS": "valide"/);
  }
});
