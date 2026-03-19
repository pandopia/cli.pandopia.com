const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const { FileConfigStore, getDefaultConfigPath } = require('../dist/config.js');
const { TerminalPrompt } = require('../dist/prompt.js');
const { MacKeychainStore } = require('../dist/secrets.js');
const { DEFAULT_SERVER } = require('../dist/servers.js');

test('getDefaultConfigPath prefers XDG_CONFIG_HOME when available', () => {
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = '/tmp/pandopia-xdg';

  try {
    assert.equal(
      getDefaultConfigPath(),
      '/tmp/pandopia-xdg/pandopia/config.json'
    );
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previous;
    }
  }
});

test('FileConfigStore reads defaults and persists normalized profiles', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pandopia-config-'));
  const configPath = path.join(tempDir, 'config.json');
  const store = new FileConfigStore(configPath);

  assert.equal(await store.getActiveServer(), DEFAULT_SERVER);
  assert.equal(await store.getProfile(DEFAULT_SERVER), undefined);

  await store.setActiveServer('test');
  await store.upsertProfile('test', {
    email: 'admin@pandopia.com',
    userName: 'Admin',
  });

  const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(raw.activeServer, 'https://test.pandopia.com');
  assert.equal(
    raw.profiles['https://test.pandopia.com'].email,
    'admin@pandopia.com'
  );
  assert.ok(raw.profiles['https://test.pandopia.com'].updatedAt);
  assert.deepEqual(await store.getProfile('test'), {
    email: 'admin@pandopia.com',
    userName: 'Admin',
    updatedAt: raw.profiles['https://test.pandopia.com'].updatedAt,
  });

  await store.clearProfile('test');
  assert.equal(await store.getProfile('test'), undefined);
});

test('TerminalPrompt ask trims values read from stdin', async () => {
  const input = new PassThrough();
  let output = '';
  const prompt = new TerminalPrompt(input, {
    write(chunk) {
      output += String(chunk);
    },
  });

  const answerPromise = prompt.ask('Email: ');
  input.write('  admin@pandopia.com  \n');

  assert.equal(await answerPromise, 'admin@pandopia.com');
  assert.match(output, /Email: /);
});

test('TerminalPrompt askHidden falls back to ask when stdin is not a TTY', async () => {
  const input = new PassThrough();
  input.isTTY = false;
  const prompt = new TerminalPrompt(input, {
    write() {},
  });

  let receivedQuestion = null;
  prompt.ask = async (question) => {
    receivedQuestion = question;
    return 'secret-password';
  };

  assert.equal(await prompt.askHidden('Password: '), 'secret-password');
  assert.equal(receivedQuestion, 'Password: ');
});

test('TerminalPrompt askHidden captures masked input on TTY streams', async () => {
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
  input.emit('keypress', 's', { sequence: 's', name: 's', ctrl: false, meta: false });
  input.emit('keypress', 'e', { sequence: 'e', name: 'e', ctrl: false, meta: false });
  input.emit('keypress', 'x', { sequence: 'x', name: 'x', ctrl: false, meta: false });
  input.emit('keypress', '', { sequence: '\b', name: 'backspace', ctrl: false, meta: false });
  input.emit('keypress', 't', { sequence: 't', name: 't', ctrl: false, meta: false });
  input.emit('keypress', '\r', { sequence: '\r', name: 'return', ctrl: false, meta: false });

  assert.equal(await answerPromise, 'set');
  assert.deepEqual(rawModes, [true, false]);
  assert.match(output, /^Password: \n$/);
});

test('TerminalPrompt choose loops until a valid option number is entered', async () => {
  const input = new PassThrough();
  let output = '';
  const prompt = new TerminalPrompt(input, {
    write(chunk) {
      output += String(chunk);
    },
  });

  const answers = ['x', '3', '2'];
  prompt.ask = async () => answers.shift() || '';

  const choice = await prompt.choose('Choose an account:', [
    { label: 'pandopia | id=1', value: '1' },
    { label: 'francehabitation | id=23', value: '23' },
  ]);

  assert.equal(choice.value, '23');
  assert.match(output, /Choose an account:/);
  assert.match(output, /Please enter a valid number\./);
});

test('MacKeychainStore uses the macOS security tool for get, set, and delete', async () => {
  const calls = [];
  const store = new MacKeychainStore(async (file, args) => {
    calls.push([file, args]);
    return { stdout: ' secret-value \n' };
  }, 'darwin');

  assert.equal(await store.get('test', 'access_token'), 'secret-value');
  await store.set('test', 'refresh_token', 'refresh-value');
  await store.delete('test', 'client_id');

  assert.deepEqual(calls[0], [
    '/usr/bin/security',
    [
      'find-generic-password',
      '-a',
      'https://test.pandopia.com::access_token',
      '-s',
      'pandopia-cli',
      '-w',
    ],
  ]);
  assert.deepEqual(calls[1], [
    '/usr/bin/security',
    [
      'add-generic-password',
      '-a',
      'https://test.pandopia.com::refresh_token',
      '-s',
      'pandopia-cli',
      '-w',
      'refresh-value',
      '-U',
    ],
  ]);
  assert.deepEqual(calls[2], [
    '/usr/bin/security',
    [
      'delete-generic-password',
      '-a',
      'https://test.pandopia.com::client_id',
      '-s',
      'pandopia-cli',
    ],
  ]);
});

test('MacKeychainStore handles missing secrets and rejects unsupported platforms', async () => {
  const missingError = new Error('The specified item could not be found in the keychain.');
  const store = new MacKeychainStore(async () => {
    throw missingError;
  }, 'darwin');

  assert.equal(await store.get('app', 'access_token'), null);
  await assert.doesNotReject(store.delete('app', 'access_token'));
  assert.throws(
    () => new MacKeychainStore(async () => ({ stdout: '' }), 'linux'),
    /only supported on macOS/
  );
});
