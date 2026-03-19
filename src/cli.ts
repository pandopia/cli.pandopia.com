import type { WhoIAmResponse, WhoIAmSummary, WriterLike } from './types';
import { FileConfigStore } from './config';
import { MacKeychainStore } from './secrets';
import { SessionStore, type SessionAuthState } from './session';
import { TerminalPrompt, type Prompt } from './prompt';
import { PandopiaApiClient, ApiError, AuthRequiredError, type FetchLike } from './api';
import { normalizeServerInput } from './servers';
import {
  renderCommandUsage,
  renderHistory,
  renderJsonLines,
  renderPagination,
  renderParams,
  renderPrettyJson,
  renderRootHelp,
  renderTypes,
  renderWhoIAm,
  writeLine,
} from './format';
import { getCliVersion } from './version';

interface ParsedArguments {
  positionals: string[];
  reserved: Record<string, string | boolean>;
  passthrough: Record<string, string[]>;
}

export interface CliDependencies {
  stdout: WriterLike;
  stderr: WriterLike;
  prompt: Prompt;
  sessionStore: SessionStore;
  apiClient: PandopiaApiClient;
}

function isReservedFlag(name: string): boolean {
  return ['json', 'server', 'page', 'per-page', 'search', 'params', 'version'].includes(
    name.toLowerCase()
  );
}

function addQueryValue(
  target: Record<string, string[]>,
  key: string,
  value: string
): void {
  if (!target[key]) {
    target[key] = [];
  }
  target[key].push(value);
}

export function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = [];
  const reserved: Record<string, string | boolean> = {};
  const passthrough: Record<string, string[]> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    const rawKey =
      equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
    const inlineValue =
      equalsIndex >= 0 ? withoutPrefix.slice(equalsIndex + 1) : undefined;

    let value = inlineValue;
    if (value === undefined && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      value = argv[index + 1];
      index += 1;
    }

    if (isReservedFlag(rawKey)) {
      reserved[rawKey.toLowerCase()] = value === undefined ? true : value;
      continue;
    }

    addQueryValue(passthrough, rawKey, value === undefined ? 'true' : value);
  }

  return {
    positionals,
    reserved,
    passthrough,
  };
}

function buildListQuery(parsed: ParsedArguments): Record<string, string[]> {
  const query: Record<string, string[]> = { ...parsed.passthrough };
  if (typeof parsed.reserved.page === 'string') {
    addQueryValue(query, 'page', parsed.reserved.page);
  }
  if (typeof parsed.reserved['per-page'] === 'string') {
    addQueryValue(query, 'perPage', parsed.reserved['per-page']);
  }
  if (typeof parsed.reserved.search === 'string') {
    addQueryValue(query, 'search', parsed.reserved.search);
  }
  if (typeof parsed.reserved.params === 'string') {
    addQueryValue(query, 'paramsList', parsed.reserved.params);
  }
  return query;
}

function buildGetQuery(parsed: ParsedArguments): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  if (typeof parsed.reserved.params === 'string') {
    addQueryValue(query, 'paramsList', parsed.reserved.params);
  }
  return query;
}

async function resolveServer(
  parsed: ParsedArguments,
  sessionStore: SessionStore
): Promise<string> {
  if (typeof parsed.reserved.server === 'string') {
    return sessionStore.setActiveServer(parsed.reserved.server);
  }
  return sessionStore.getActiveServer();
}

function shouldRenderJson(parsed: ParsedArguments): boolean {
  return parsed.reserved.json === true || parsed.reserved.json === 'true';
}

function createDefaultFetch(): FetchLike {
  return async (input, init) => {
    const response = await fetch(input, init);
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
    };
  };
}

export function createRuntimeDependencies(): CliDependencies {
  const sessionStore = new SessionStore(
    new FileConfigStore(),
    new MacKeychainStore()
  );
  const prompt = new TerminalPrompt();
  const apiClient = new PandopiaApiClient(createDefaultFetch(), sessionStore);

  return {
    stdout: process.stdout,
    stderr: process.stderr,
    prompt,
    sessionStore,
    apiClient,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function findFirstScalar(
  value: unknown,
  keys: string[],
  depth = 0,
  seen = new Set<unknown>()
): string | undefined {
  const record = asRecord(value);
  if (!record || depth > 4 || seen.has(record)) {
    return undefined;
  }

  seen.add(record);

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  for (const nested of Object.values(record)) {
    const found = findFirstScalar(nested, keys, depth + 1, seen);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function buildWhoIAmSummary(input: {
  connected: boolean;
  server: string;
  authState: SessionAuthState;
  payload?: WhoIAmResponse;
}): WhoIAmSummary {
  return {
    connected: input.connected,
    server: normalizeServerInput(input.server),
    email:
      findFirstScalar(input.payload, ['email', 'mail']) || input.authState.email,
    organismeRef:
      findFirstScalar(input.payload, [
        'organismeRef',
        'organisationRef',
        'organizationRef',
        'orgaRef',
      ]) || input.authState.organismeRef,
    apiKeyId:
      findFirstScalar(input.payload, [
        'clientId',
        'client_id',
        'apiKeyId',
        'api_key_id',
      ]) || input.authState.clientId || undefined,
  };
}

function isInvalidLoginError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (error.status === 401) {
    return true;
  }

  return [
    'incorrect',
    'invalid credentials',
    'invalid password',
    'invalid username',
    'email or password',
    'email/password',
    'wrong password',
    'bad credentials',
    'mot de passe',
    'identifiant',
    'adresse email',
    'username or password',
  ].some((snippet) => message.includes(snippet));
}

function isMissingWhoIAmRouteError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('action "whoiam" does not exist') ||
    message.includes('does not exist and was not trapped in __call()')
  );
}

async function runLogin(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const server = await resolveServer(parsed, deps.sessionStore);
  const providedEmail = parsed.positionals[1];
  const email =
    providedEmail || (await deps.prompt.ask('Email: '));

  while (true) {
    const password = await deps.prompt.askHidden('Password: ');

    try {
      const result = await deps.apiClient.login(server, email, password, deps.prompt);
      writeLine(
        deps.stdout,
        `Logged in on ${result.server}${result.userName ? ` as ${result.userName}` : ''}.`
      );
      return 0;
    } catch (error) {
      if (isInvalidLoginError(error)) {
        writeLine(deps.stderr, `${(error as ApiError).message}. Re-enter password or press Ctrl+C to cancel.`);
        continue;
      }
      throw error;
    }
  }
}

async function runTypes(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const server = await resolveServer(parsed, deps.sessionStore);
  const payload = await deps.apiClient.listTypes(server);
  writeLine(
    deps.stdout,
    shouldRenderJson(parsed) ? renderPrettyJson(payload) : renderTypes(payload.data)
  );
  return 0;
}

async function runWhoIAm(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const server = await resolveServer(parsed, deps.sessionStore);
  const authState = await deps.sessionStore.getAuthState(server);
  let connected = !!authState.accessToken;
  let payload: WhoIAmResponse | undefined;

  if (connected) {
    try {
      payload = await deps.apiClient.getWhoIAm(server);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        connected = false;
      } else if (isMissingWhoIAmRouteError(error)) {
        payload = undefined;
      } else {
        throw error;
      }
    }
  }

  const summary = buildWhoIAmSummary({
    connected,
    server,
    authState,
    payload,
  });
  writeLine(
    deps.stdout,
    shouldRenderJson(parsed) ? renderPrettyJson(payload || summary) : renderWhoIAm(summary)
  );
  return 0;
}

async function runParams(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const catalogType = parsed.positionals[1];
  if (!catalogType) {
    writeLine(deps.stderr, renderCommandUsage('params'));
    return 1;
  }

  const server = await resolveServer(parsed, deps.sessionStore);
  const payload = await deps.apiClient.getParams(server, catalogType);
  writeLine(
    deps.stdout,
    shouldRenderJson(parsed) ? renderPrettyJson(payload) : renderParams(payload.data)
  );
  return 0;
}

async function runList(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const catalogType = parsed.positionals[1];
  if (!catalogType) {
    writeLine(deps.stderr, renderCommandUsage('list'));
    return 1;
  }

  const server = await resolveServer(parsed, deps.sessionStore);
  const payload = await deps.apiClient.listObjects(
    server,
    catalogType,
    buildListQuery(parsed)
  );

  if (shouldRenderJson(parsed)) {
    writeLine(deps.stdout, renderPrettyJson(payload));
    return 0;
  }

  writeLine(deps.stdout, renderPagination(payload.pagination));
  writeLine(deps.stdout);
  writeLine(deps.stdout, renderJsonLines(payload.data));
  return 0;
}

async function runFind(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const catalogType = parsed.positionals[1];
  const searchText = parsed.positionals[2];
  if (!catalogType || !searchText) {
    writeLine(deps.stderr, renderCommandUsage('find'));
    return 1;
  }

  return runList(
    {
      ...parsed,
      reserved: {
        ...parsed.reserved,
        search: searchText,
      },
    },
    deps
  );
}

async function runGet(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const catalogType = parsed.positionals[1];
  const objectId = parsed.positionals[2];
  if (!catalogType || !objectId) {
    writeLine(deps.stderr, renderCommandUsage('get'));
    return 1;
  }

  const server = await resolveServer(parsed, deps.sessionStore);
  const payload = await deps.apiClient.getObject(
    server,
    catalogType,
    objectId,
    buildGetQuery(parsed)
  );
  writeLine(
    deps.stdout,
    shouldRenderJson(parsed) ? renderPrettyJson(payload) : renderPrettyJson(payload.data)
  );
  return 0;
}

async function runHistory(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const catalogType = parsed.positionals[1];
  const objectId = parsed.positionals[2];
  const paramCode = parsed.positionals[3];
  if (!catalogType || !objectId || !paramCode) {
    writeLine(deps.stderr, renderCommandUsage('history'));
    return 1;
  }

  const server = await resolveServer(parsed, deps.sessionStore);
  const payload = await deps.apiClient.getHistory(
    server,
    catalogType,
    objectId,
    paramCode
  );
  writeLine(
    deps.stdout,
    shouldRenderJson(parsed) ? renderPrettyJson(payload) : renderHistory(payload.data)
  );
  return 0;
}

async function runLogout(
  parsed: ParsedArguments,
  deps: CliDependencies
): Promise<number> {
  const server = await resolveServer(parsed, deps.sessionStore);
  await deps.apiClient.logout(server);
  writeLine(deps.stdout, `Cleared credentials for ${normalizeServerInput(server)}.`);
  return 0;
}

export async function runCli(
  argv: string[],
  providedDeps?: Partial<CliDependencies>
): Promise<number> {
  const runtime =
    providedDeps &&
    providedDeps.stdout &&
    providedDeps.stderr &&
    providedDeps.prompt &&
    providedDeps.sessionStore &&
    providedDeps.apiClient
      ? null
      : createRuntimeDependencies();
  const deps: CliDependencies = {
    ...(runtime || {}),
    ...providedDeps,
  } as CliDependencies;

  const parsed = parseArguments(argv);
  const command = parsed.positionals[0];

  try {
    if (parsed.reserved.version === true || parsed.reserved.version === 'true') {
      writeLine(deps.stdout, await getCliVersion());
      return 0;
    }

    if (!command) {
      const status = await deps.sessionStore.getStatus(
        typeof parsed.reserved.server === 'string'
          ? await deps.sessionStore.setActiveServer(parsed.reserved.server)
          : undefined
      );
      writeLine(deps.stdout, renderRootHelp(status));
      return 0;
    }

        switch (command) {
            case 'login':
                return await runLogin(parsed, deps);
            case 'logout':
                return await runLogout(parsed, deps);
            case 'whoiam':
            case 'whoami':
            case 'status':
                return await runWhoIAm(parsed, deps);
            case 'types':
                return await runTypes(parsed, deps);
            case 'params':
                return await runParams(parsed, deps);
            case 'list':
                return await runList(parsed, deps);
            case 'find':
                return await runFind(parsed, deps);
            case 'get':
                return await runGet(parsed, deps);
            case 'history':
                return await runHistory(parsed, deps);
            case 'version':
                writeLine(deps.stdout, await getCliVersion());
                return 0;
            default:
                writeLine(deps.stderr, `Unknown command: ${command}`);
                writeLine(deps.stderr);
        writeLine(deps.stderr, renderRootHelp(await deps.sessionStore.getStatus()));
        return 1;
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      writeLine(deps.stderr, error.message);
      return 1;
    }

    if (error instanceof ApiError) {
      writeLine(deps.stderr, error.message);
      return 1;
    }

    if (error instanceof Error) {
      writeLine(deps.stderr, error.message);
      return 1;
    }

    writeLine(deps.stderr, String(error));
    return 1;
  }
}
