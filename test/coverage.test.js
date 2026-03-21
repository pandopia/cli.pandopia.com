const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const packageJson = require('../package.json');
const {
  parseArguments,
  runCli,
  createRuntimeDependencies,
} = require('../dist/cli.js');
const {
  PandopiaApiClient,
  ApiError,
  AuthRequiredError,
} = require('../dist/api.js');
const {
  FileConfigStore,
  getDefaultConfigPath,
} = require('../dist/config.js');
const {
  renderTable,
  renderRootHelp,
  renderCommandUsage,
  renderTypes,
  renderParams,
  renderPagination,
  renderHistory,
  renderWhoIAm,
  renderPrettyJson,
  renderJsonLines,
  writeLine,
} = require('../dist/format.js');
const { TerminalPrompt } = require('../dist/prompt.js');
const { MacKeychainStore } = require('../dist/secrets.js');
const {
  DEFAULT_SERVER,
  normalizeServerInput,
  getCatalogBaseUrl,
  getAuthBaseUrl,
  getServerAlias,
} = require('../dist/servers.js');
const { SessionStore } = require('../dist/session.js');
const { getCliVersion } = require('../dist/version.js');

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
    this.operations = [];
  }

  key(server, name) {
    return `${server}::${name}`;
  }

  async get(server, name) {
    return this.values.get(this.key(server, name)) ?? null;
  }

  async set(server, name, value) {
    this.operations.push({ type: 'set', server, name, value });
    this.values.set(this.key(server, name), value);
  }

  async delete(server, name) {
    this.operations.push({ type: 'delete', server, name });
    this.values.delete(this.key(server, name));
  }
}

class MockPrompt {
  constructor({ answers = [], hiddenAnswers = [], choices = [] } = {}) {
    this.answers = [...answers];
    this.hiddenAnswers = [...hiddenAnswers];
    this.choices = [...choices];
    this.lastQuestion = null;
    this.lastOptions = null;
  }

  async ask() {
    return this.answers.shift() ?? '';
  }

  async askHidden() {
    return this.hiddenAnswers.shift() ?? '';
  }

  async choose(question, options) {
    this.lastQuestion = question;
    this.lastOptions = options;
    const selected = this.choices.shift();
    if (selected === undefined) {
      return options[0];
    }
    return options.find((option) => option.value === selected) || { value: selected };
  }
}

function createResponse(status, body, rawText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      if (rawText !== undefined) {
        return rawText;
      }
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

function createRuntime(overrides = {}) {
  const config = new MemoryConfigStore();
  const secrets = new MemorySecretStore();
  const sessionStore = new SessionStore(config, secrets);
  const writers = createWriters();
  const prompt = overrides.prompt || new MockPrompt();
  const apiClient =
    overrides.apiClient ||
    new PandopiaApiClient(
      overrides.fetchImpl ||
        (async (url) => {
          throw new Error(`Unexpected fetch: ${url}`);
        }),
      sessionStore
    );

  return {
    config,
    secrets,
    sessionStore,
    apiClient,
    prompt,
    ...writers,
  };
}

test('les helpers serveur couvrent alias, bases et validations', () => {
  assert.equal(normalizeServerInput(), DEFAULT_SERVER);
  assert.equal(normalizeServerInput(' test '), 'https://test.pandopia.com');
  assert.equal(
    normalizeServerInput('https://example.com/api/catalog/'),
    'https://example.com'
  );
  assert.equal(
    normalizeServerInput('https://example.com/api'),
    'https://example.com'
  );
  assert.equal(getCatalogBaseUrl('local'), 'http://pandopia.test/api/catalog');
  assert.equal(getAuthBaseUrl('app'), 'https://app.pandopia.com/api/auth');
  assert.equal(getServerAlias('test'), 'test');
  assert.equal(getServerAlias('https://example.com'), null);
  assert.throws(
    () => normalizeServerInput('pandopia'),
    /Invalid server value/
  );
  assert.throws(
    () => normalizeServerInput('https://example.com/custom-path'),
    /Server URL must be an origin or end with \/api\/catalog\./
  );
});

test('FileConfigStore couvre le fallback HOME et les erreurs de lecture invalides', async () => {
  const previous = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;

  try {
    assert.equal(
      getDefaultConfigPath(),
      path.join(os.homedir(), '.config', 'pandopia', 'config.json')
    );
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previous;
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pandopia-invalid-config-'));
  const configPath = path.join(tempDir, 'config.json');
  await fs.writeFile(configPath, '{invalid json');

  const store = new FileConfigStore(configPath);
  await assert.rejects(() => store.getActiveServer(), /Unexpected token|Expected property name/);
});

test('les helpers de format couvrent les variantes de rendu', () => {
  assert.equal(renderTable([], ['id']), 'No results.');
  assert.match(
    renderTable([{ list: [1, { ok: true }], meta: { a: 1 } }], ['list', 'meta']),
    /1, \{"ok":true\}/
  );
  assert.match(
    renderRootHelp({
      server: DEFAULT_SERVER,
      alias: 'app',
      loggedIn: true,
    }),
    /logged in as authenticated user/
  );
  assert.match(renderCommandUsage('list'), /pandopia list <catalogType>/);
  assert.match(renderCommandUsage('find'), /pandopia find <catalogType> <text>/);
  assert.match(renderCommandUsage('get'), /pandopia get <catalogType> <objectId>/);
  assert.match(renderCommandUsage('history'), /pandopia history <catalogType> <objectId> <paramCode>/);
  assert.match(renderCommandUsage('params'), /pandopia params <catalogType>/);
  assert.match(
    renderTypes([{ type: 'diag', objectName: 'Diagnostic' }]),
    /Diagnostic/
  );
  assert.equal(
    renderParams({ filters: [], params: [] }),
    'Filters:\nNo filters.\n\nParams:\nNo params.'
  );
  assert.match(
    renderParams({
      filters: ['status'],
      params: [
        {
          code: 'status',
          name: 'Statut',
          type: 'list',
          description: 'Description',
          default: 'draft',
          values: ['draft', 'done'],
        },
      ],
    }),
    /draft, done/
  );
  assert.equal(
    renderPagination({ page: 2, perPage: 5, nbPages: 6, totalNb: 27 }),
    'Page 2 / 6 | perPage 5 | total 27'
  );
  assert.equal(renderHistory([]), 'No history.');
  assert.match(
    renderHistory([
      {
        changedAtTimestamp: 1,
        changedAt: '2024-03-19',
        mode: 'm',
        modeName: 'manuel',
        value: 'ok',
      },
    ]),
    /manuel/
  );
  assert.equal(
    renderWhoIAm({ connected: false, server: DEFAULT_SERVER }),
    `Connected: no\nServer: ${DEFAULT_SERVER}\nEmail: unknown\nOrganisation: unknown\nAPI key id: unknown`
  );
  assert.equal(renderPrettyJson({ ok: true }), '{\n  "ok": true\n}');
  assert.equal(renderJsonLines([]), 'No results.');
  assert.equal(renderJsonLines([{ id: 1 }, { id: 2 }]), '{"id":1}\n{"id":2}');

  let buffer = '';
  writeLine(
    {
      write(chunk) {
        buffer += chunk;
      },
    },
    'bonjour'
  );
  assert.equal(buffer, 'bonjour\n');
});

test('TerminalPrompt gère Ctrl+C et refuse une liste vide', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const rawModes = [];
  input.setRawMode = (value) => {
    rawModes.push(value);
    input.isRaw = value;
  };
  input.resume = () => {};

  let output = '';
  const prompt = new TerminalPrompt(input, {
    write(chunk) {
      output += String(chunk);
    },
  });

  const answerPromise = prompt.askHidden('Password: ');
  input.emit('keypress', '', {
    sequence: '\u0003',
    name: 'c',
    ctrl: true,
    meta: false,
  });

  await assert.rejects(answerPromise, /Canceled\./);
  assert.deepEqual(rawModes, [true, false]);
  assert.match(output, /^Password: \n$/);

  await assert.rejects(
    () => prompt.choose('Choose:', []),
    /No options available\./
  );
});

test('MacKeychainStore propage les erreurs non liées aux secrets manquants', async () => {
  const failure = new Error('permission denied');
  const store = new MacKeychainStore(async () => {
    throw failure;
  }, 'darwin');

  await assert.rejects(() => store.get('app', 'access_token'), /permission denied/);
  await assert.rejects(() => store.delete('app', 'access_token'), /permission denied/);

  const missingByExitCode = new MacKeychainStore(async () => {
    throw new Error('returned non-zero exit status 44');
  }, 'darwin');
  assert.equal(await missingByExitCode.get('app', 'access_token'), null);
});

test('SessionStore couvre les branches de sauvegarde, mise à jour et profil', async () => {
  const config = new MemoryConfigStore();
  const secrets = new MemorySecretStore();
  const store = new SessionStore(config, secrets);

  assert.equal(await store.setActiveServer('test'), 'https://test.pandopia.com');
  assert.equal(await store.getActiveServer(), 'https://test.pandopia.com');

  await store.saveLogin('test', {
    email: 'admin@pandopia.com',
    userName: 'Admin',
    organismeRef: 'pandopia',
    accessToken: 'access-1',
    clientId: 'client-1',
    clientSecret: 'secret-1',
  });
  assert.equal(
    await secrets.get('https://test.pandopia.com', 'refresh_token'),
    null
  );
  assert.deepEqual(
    secrets.operations.filter((operation) => operation.type === 'delete'),
    [
      {
        type: 'delete',
        server: 'https://test.pandopia.com',
        name: 'refresh_token',
      },
    ]
  );

  await store.updateTokens('test', {
    accessToken: 'access-2',
    refreshToken: '',
  });
  assert.equal(
    await secrets.get('https://test.pandopia.com', 'access_token'),
    'access-2'
  );
  assert.equal(
    await secrets.get('https://test.pandopia.com', 'refresh_token'),
    null
  );

  await store.setProfile('test', { organismeRef: 'francehabitation' });
  assert.deepEqual(await store.getStatus('test'), {
    server: 'https://test.pandopia.com',
    alias: 'test',
    email: 'admin@pandopia.com',
    userName: 'Admin',
    organismeRef: 'francehabitation',
    loggedIn: true,
  });
  assert.deepEqual(await store.getAuthState('test'), {
    server: 'https://test.pandopia.com',
    email: 'admin@pandopia.com',
    userName: 'Admin',
    organismeRef: 'francehabitation',
    accessToken: 'access-2',
    refreshToken: null,
    clientId: 'client-1',
    clientSecret: 'secret-1',
  });
});

test('PandopiaApiClient requestJson et promptForUser couvrent les branches annexes', async () => {
  const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
  const client = new PandopiaApiClient(async () => createResponse(200, undefined), sessionStore);

  const emptyPayload = await client.requestJson('https://example.com', { method: 'GET' });
  assert.deepEqual(emptyPayload.payload, {});

  client.fetchFn = async () => createResponse(200, undefined, 'plain text');
  const textPayload = await client.requestJson('https://example.com', { method: 'GET' });
  assert.deepEqual(textPayload.payload, { message: 'plain text' });

  assert.throws(
    () =>
      client.assertLoginEnsureOk({
        response: { ok: false, status: 400 },
        payload: 'bad payload',
      }),
    /Authentication failed\./
  );
  assert.throws(
    () =>
      client.assertLoginEnsureOk({
        response: { ok: false, status: 400 },
        payload: { error: 'invalid credentials' },
      }),
    /invalid credentials/
  );
  assert.throws(
    () =>
      client.assertLoginEnsureOk({
        response: { ok: false, status: 400 },
        payload: { status: 'KO' },
      }),
    /Authentication failed\./
  );

  const nestedPrompt = new MockPrompt({ choices: ['2'] });
  const selected = await client.promptForUser(
    {
      data: {
        users: [
          { id: '1', name: 'Compte A', email: 'a@example.com' },
          { id: '2', email: 'b@example.com' },
        ],
      },
    },
    nestedPrompt
  );
  assert.equal(selected.id, '2');
  assert.deepEqual(
    nestedPrompt.lastOptions.map((option) => option.label),
    ['Compte A | id=1', 'b@example.com | id=2']
  );

  await assert.rejects(
    () =>
      client.promptForUser(
        { error: { message: 'Multiple accounts' } },
        new MockPrompt()
      ),
    /Multiple accounts/
  );

  await assert.rejects(
    () => client.promptForUser('invalid payload', new MockPrompt()),
    /Multiple accounts were detected, but no account list was returned\./
  );

  await assert.rejects(
    () =>
      client.promptForUser(
        { users: [{ id: '1', name: 'Compte A' }] },
        new MockPrompt({ choices: ['999'] })
      ),
    /selected account has no userId/
  );
});

test('PandopiaApiClient login couvre les réponses incomplètes et la persistance ratée', async () => {
  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    const responses = [
      createResponse(200, {
        status: 'OK',
        data: {},
      }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);

    await assert.rejects(
      () => client.login('app', 'admin@pandopia.com', 'secret', new MockPrompt()),
      /Missing client credentials in login response\./
    );
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    const responses = [
      createResponse(200, {
        status: 'OK',
        data: {
          client_id: 'client-id',
          client_secret: 'client-secret',
        },
      }),
      createResponse(400, {
        error_description: 'token failed',
      }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);

    await assert.rejects(
      () => client.login('app', 'admin@pandopia.com', 'secret', new MockPrompt()),
      /token failed/
    );
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    const responses = [
      createResponse(200, {
        status: 'OK',
        data: {
          client_id: 'client-id',
          client_secret: 'client-secret',
        },
      }),
      createResponse(200, {
        refresh_token: 'refresh-only',
      }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);

    await assert.rejects(
      () => client.login('app', 'admin@pandopia.com', 'secret', new MockPrompt()),
      /No access token received from Pandopia\./
    );
  }

  {
    const sessionStore = {
      async saveLogin() {},
      async getAuthState(server) {
        return {
          server: normalizeServerInput(server),
          accessToken: null,
        };
      },
    };
    const responses = [
      createResponse(200, {
        status: 'OK',
        data: {
          client_id: 'client-id',
          client_secret: 'client-secret',
          user: { organismeRef: 'pandopia' },
        },
      }),
      createResponse(200, {
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        },
      }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);

    await assert.rejects(
      () => client.login('app', 'admin@pandopia.com', 'secret', new MockPrompt()),
      /failed to persist the local session/
    );
  }
});

test('PandopiaApiClient requestLoginEnsureClient et requestAccessToken encodent les formulaires', async () => {
  const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
  const bodies = [];
  const client = new PandopiaApiClient(async (_url, init) => {
    bodies.push(init.body);
    return createResponse(200, { status: 'OK' });
  }, sessionStore);

  await client.requestLoginEnsureClient({
    authBase: 'https://app.pandopia.com/api/auth',
    email: 'admin@pandopia.com',
    password: 'secret',
  });
  await client.requestAccessToken({
    authBase: 'https://app.pandopia.com/api/auth',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    email: 'admin@pandopia.com',
    password: 'secret',
    userId: '',
  });

  assert.match(bodies[0], /^email=admin%40pandopia\.com&password=secret$/);
  assert.match(
    bodies[1],
    /^grant_type=password&client_id=client-id&client_secret=client-secret&username=admin%40pandopia\.com&password=secret$/
  );
});

test('PandopiaApiClient requestCatalog couvre refresh, fallback dispatch et erreurs', async () => {
  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    const client = new PandopiaApiClient(async () => createResponse(200, {}), sessionStore);
    await assert.rejects(() => client.listTypes('app'), AuthRequiredError);
    assert.equal(await client.refreshToken('app'), null);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(400, { error: 'refresh failed' }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);
    await assert.rejects(() => client.listTypes('app'), AuthRequiredError);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(200, { refresh_token: 'still-no-access' }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);
    await assert.rejects(() => client.listTypes('app'), AuthRequiredError);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const urls = [];
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(200, {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
      }),
      createResponse(400, {
        message: 'Invalid controller specified (catalog)',
      }),
      createResponse(200, {
        status: 'ok',
        data: [{ type: 'diag', objectName: 'Diagnostic' }],
      }),
    ];
    const client = new PandopiaApiClient(async (url, init) => {
      urls.push({ url, init });
      return responses.shift();
    }, sessionStore);

    const payload = await client.listTypes('app');
    assert.deepEqual(payload.data, [{ type: 'diag', objectName: 'Diagnostic' }]);
    assert.equal(urls[2].init.headers.Authorization, 'Bearer new-access');
    assert.match(urls[3].url, /\/api\/catalog\/dispatch\/types$/);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(200, {
        access_token: 'new-access',
      }),
      createResponse(401, { error: 'still expired' }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);
    await assert.rejects(() => client.listTypes('app'), AuthRequiredError);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const client = new PandopiaApiClient(
      async () =>
        createResponse(400, {
          error: { message: 'catalog failed' },
        }),
      sessionStore
    );
    await assert.rejects(() => client.listTypes('app'), /catalog failed/);
  }
});

test('PandopiaApiClient requestAuth couvre refresh, erreurs et succès', async () => {
  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    const client = new PandopiaApiClient(async () => createResponse(200, {}), sessionStore);
    await assert.rejects(() => client.getWhoIAm('app'), AuthRequiredError);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(200, {
        access_token: 'new-access',
      }),
      createResponse(200, {
        status: 'ok',
        data: {
          mail: 'admin@pandopia.com',
          organizationRef: 'francehabitation',
          api_key_id: 42,
        },
      }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);
    const payload = await client.getWhoIAm('app');
    assert.equal(payload.data.mail, 'admin@pandopia.com');
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const responses = [
      createResponse(401, { error: 'expired' }),
      createResponse(200, {
        access_token: 'new-access',
      }),
      createResponse(401, { error: 'still expired' }),
    ];
    const client = new PandopiaApiClient(async () => responses.shift(), sessionStore);
    await assert.rejects(() => client.getWhoIAm('app'), AuthRequiredError);
  }

  {
    const sessionStore = new SessionStore(new MemoryConfigStore(), new MemorySecretStore());
    await sessionStore.saveLogin('app', {
      email: 'admin@pandopia.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const client = new PandopiaApiClient(
      async () => createResponse(400, { message: 'whoiam failed' }),
      sessionStore
    );
    await assert.rejects(() => client.getWhoIAm('app'), /whoiam failed/);
  }
});

test('parseArguments, version et runCli couvrent les branches CLI restantes', async () => {
  assert.deepEqual(parseArguments(['types']), {
    positionals: ['types'],
    reserved: {},
    passthrough: {},
  });
  assert.deepEqual(
    parseArguments([
      'list',
      'diag',
      '--json',
      '--server',
      'test',
      '--per-page=5',
      '--Flag',
      'Value',
      '--enabled',
    ]),
    {
      positionals: ['list', 'diag'],
      reserved: {
        json: true,
        server: 'test',
        'per-page': '5',
      },
      passthrough: {
        Flag: ['Value'],
        enabled: ['true'],
      },
    }
  );

  assert.equal(await getCliVersion(), packageJson.version);

  {
    const runtime = createRuntime();
    const exitCode = await runCli(['--server', 'test'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /Active server: https:\/\/test\.pandopia\.com/);
  }

  {
    const runtime = createRuntime({
      prompt: new MockPrompt({
        answers: ['admin@pandopia.com'],
        hiddenAnswers: ['wrong', 'right'],
      }),
      apiClient: {
        async login(_server, email, password) {
          assert.equal(email, 'admin@pandopia.com');
          if (password === 'wrong') {
            throw new ApiError('Bad credentials', 400);
          }
          return {
            server: DEFAULT_SERVER,
            userName: 'Admin',
          };
        },
      },
    });
    const exitCode = await runCli(['login'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStderr(), /Bad credentials\. Re-enter password/);
    assert.match(runtime.readStdout(), /Logged in on https:\/\/app\.pandopia\.com as Admin\./);
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listTypes() {
          throw new Error('boom');
        },
      },
    });
    const exitCode = await runCli(['types'], runtime);
    assert.equal(exitCode, 1);
    assert.equal(runtime.readStderr(), 'boom\n');
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listTypes() {
          throw 'plain boom';
        },
      },
    });
    const exitCode = await runCli(['types'], runtime);
    assert.equal(exitCode, 1);
    assert.equal(runtime.readStderr(), 'plain boom\n');
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async getWhoIAm() {
          throw new AuthRequiredError();
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      organismeRef: 'saved-org',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['whoiam', '--json'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /"connected": false/);
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listTypes() {
          return {
            status: 'ok',
            data: [{ type: 'diag', objectName: 'Diagnostic' }],
          };
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['types', '--json'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /"objectName": "Diagnostic"/);
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listObjects() {
          return {
            status: 'ok',
            pagination: { page: 1, perPage: 1, nbPages: 1, totalNb: 1 },
            data: [{ id: 1 }],
          };
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['list', 'diag', '--json'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /"pagination":/);
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listObjects(server) {
          assert.equal(server, 'https://test.pandopia.com');
          return {
            status: 'ok',
            pagination: { page: 1, perPage: 1, nbPages: 1, totalNb: 1 },
            data: [{ id: 1 }],
          };
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['list', 'diag', '--server', 'test'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /Page 1 \/ 1/);
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async getObject() {
          return {
            status: 'ok',
            data: { id: 1, label: 'Diagnostic' },
          };
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['get', 'diag', '1'], runtime);
    assert.equal(exitCode, 0);
    assert.equal(runtime.readStdout(), '{\n  "id": 1,\n  "label": "Diagnostic"\n}\n');
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async listTypes() {
          throw new ApiError('api boom', 400);
        },
      },
    });
    const exitCode = await runCli(['types'], runtime);
    assert.equal(exitCode, 1);
    assert.equal(runtime.readStderr(), 'api boom\n');
  }

  {
    const runtime = createRuntime();
    const exitCode = await runCli(['unknown-command'], runtime);
    assert.equal(exitCode, 1);
    assert.match(runtime.readStderr(), /Unknown command: unknown-command/);
    assert.match(runtime.readStderr(), /Pandopia Catalog CLI/);
  }

  {
    const runtime = createRuntime({
      prompt: new MockPrompt({
        answers: ['admin@pandopia.com'],
        hiddenAnswers: ['secret'],
      }),
      apiClient: {
        async login() {
          throw new Error('fatal login');
        },
      },
    });
    const exitCode = await runCli(['login'], runtime);
    assert.equal(exitCode, 1);
    assert.equal(runtime.readStderr(), 'fatal login\n');
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async getWhoIAm() {
          throw new Error('fatal whoiam');
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      organismeRef: 'saved-org',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['whoiam'], runtime);
    assert.equal(exitCode, 1);
    assert.equal(runtime.readStderr(), 'fatal whoiam\n');
  }

  {
    const runtime = createRuntime({
      apiClient: {
        async getWhoIAm() {
          return {
            status: 'ok',
            data: {
              mail: 'api@example.com',
              nested: { unused: true },
            },
          };
        },
      },
    });
    await runtime.sessionStore.saveLogin('app', {
      email: 'saved@example.com',
      organismeRef: 'saved-org',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
    const exitCode = await runCli(['whoiam'], runtime);
    assert.equal(exitCode, 0);
    assert.match(runtime.readStdout(), /Email: api@example\.com/);
    assert.match(runtime.readStdout(), /Organisation: saved-org/);
    assert.match(runtime.readStdout(), /API key id: client-id/);
  }
});

test('createRuntimeDependencies utilise fetch par défaut', async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async (input, init) => {
      assert.equal(input, `${DEFAULT_SERVER}/api/catalog/types`);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer runtime-access');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: 'ok',
            data: [{ type: 'diag', objectName: 'Diagnostic' }],
          });
        },
      };
    };

    const runtime = createRuntimeDependencies();
    runtime.sessionStore.getAuthState = async () => ({
      server: DEFAULT_SERVER,
      accessToken: 'runtime-access',
      refreshToken: null,
      clientId: null,
      clientSecret: null,
    });

    const payload = await runtime.apiClient.listTypes(DEFAULT_SERVER);
    assert.deepEqual(payload.data, [{ type: 'diag', objectName: 'Diagnostic' }]);
  } finally {
    global.fetch = originalFetch;
  }
});
