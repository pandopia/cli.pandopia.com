import type {
  AccessTokenResponse,
  CatalogListResponse,
  CatalogObjectResponse,
  CatalogParamsResponse,
  CatalogTypesResponse,
  LoginEnsureClientResponse,
  MultipleAccountUser,
} from './types';
import type { Prompt } from './prompt';
import { getAuthBaseUrl, getCatalogBaseUrl, normalizeServerInput } from './servers';
import { SessionStore } from './session';

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<HttpResponseLike>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly payload?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Run pandopia login <email>') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function encodeForm(data: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== '') {
      params.append(key, value);
    }
  }
  return params.toString();
}

function extractMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const asRecord = payload as Record<string, unknown>;
  const errorValue = asRecord.error;
  if (typeof asRecord.message === 'string') {
    return asRecord.message;
  }
  if (typeof asRecord.error_description === 'string') {
    return asRecord.error_description;
  }
  if (typeof errorValue === 'string') {
    return errorValue;
  }
  if (errorValue && typeof errorValue === 'object') {
    const nested = errorValue as Record<string, unknown>;
    if (typeof nested.message === 'string') {
      return nested.message;
    }
  }
  return fallback;
}

function extractUsers(payload: unknown): MultipleAccountUser[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const direct = root.users;
  const nestedError =
    root.error && typeof root.error === 'object'
      ? (root.error as Record<string, unknown>).users
      : undefined;
  const nestedData =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>).users
      : undefined;
  const candidate = direct || nestedError || nestedData;
  return Array.isArray(candidate) ? (candidate as MultipleAccountUser[]) : [];
}

function extractAccessToken(payload: AccessTokenResponse): string | undefined {
  return payload.access_token || payload.data?.access_token;
}

function extractRefreshToken(payload: AccessTokenResponse): string | undefined {
  return payload.refresh_token || payload.data?.refresh_token;
}

function formatUserChoice(user: MultipleAccountUser): string {
  const parts = [user.name, user.email, user.organismeRef]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map((value) => String(value));

  if (user.id !== undefined) {
    parts.push(`id=${user.id}`);
  }

  return parts.length > 0 ? parts.join(' | ') : JSON.stringify(user);
}

export class PandopiaApiClient {
  constructor(
    private readonly fetchFn: FetchLike,
    private readonly sessionStore: SessionStore
  ) {}

  async login(
    server: string,
    email: string,
    password: string,
    prompt: Prompt
  ): Promise<{ server: string; email: string; userName?: string }> {
    const normalized = normalizeServerInput(server);
    const authBase = getAuthBaseUrl(normalized);
    let selectedUserId: string | undefined;
    let loginEnsure = await this.requestLoginEnsureClient({
      authBase,
      email,
      password,
    });

    if (loginEnsure.response.status === 300) {
      selectedUserId = await this.promptForUserId(loginEnsure.payload, prompt);
      loginEnsure = await this.requestLoginEnsureClient({
        authBase,
        email,
        password,
        userId: selectedUserId,
      });
    }

    this.assertLoginEnsureOk(loginEnsure);

    let clientId = loginEnsure.payload?.data?.client_id;
    let clientSecret = loginEnsure.payload?.data?.client_secret;
    let userName = loginEnsure.payload?.data?.user?.name;

    if (!clientId || !clientSecret) {
      throw new ApiError(
        'Missing client credentials in login response.',
        loginEnsure.response.status,
        loginEnsure.payload
      );
    }

    let tokenPayload = await this.requestAccessToken({
      authBase,
      clientId,
      clientSecret,
      email,
      password,
      userId: selectedUserId,
    });

    if (tokenPayload.response.status === 300) {
      selectedUserId = await this.promptForUserId(tokenPayload.payload, prompt);
      loginEnsure = await this.requestLoginEnsureClient({
        authBase,
        email,
        password,
        userId: selectedUserId,
      });
      this.assertLoginEnsureOk(loginEnsure);

      clientId = loginEnsure.payload?.data?.client_id;
      clientSecret = loginEnsure.payload?.data?.client_secret;
      userName = loginEnsure.payload?.data?.user?.name;

      if (!clientId || !clientSecret) {
        throw new ApiError(
          'Missing client credentials in login response.',
          loginEnsure.response.status,
          loginEnsure.payload
        );
      }

      tokenPayload = await this.requestAccessToken({
        authBase,
        clientId,
        clientSecret,
        email,
        password,
        userId: selectedUserId,
      });
    }

    if (!tokenPayload.response.ok) {
      throw new ApiError(
        extractMessage(tokenPayload.payload, 'Token request failed.'),
        tokenPayload.response.status,
        tokenPayload.payload
      );
    }

    const accessToken = extractAccessToken(tokenPayload.payload);
    const refreshToken = extractRefreshToken(tokenPayload.payload);

    if (!accessToken) {
      throw new ApiError(
        'No access token received from Pandopia.',
        tokenPayload.response.status,
        tokenPayload.payload
      );
    }

    await this.sessionStore.saveLogin(normalized, {
      email,
      userName,
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
    });

    const persisted = await this.sessionStore.getAuthState(normalized);
    if (!persisted.accessToken) {
      throw new ApiError(
        'Authenticated with Pandopia, but failed to persist the local session.',
        undefined,
        {
          server: normalized,
          email,
        }
      );
    }

    return {
      server: normalized,
      email,
      userName,
    };
  }

  async listTypes(server: string): Promise<CatalogTypesResponse> {
    return this.requestCatalog<CatalogTypesResponse>(server, '/types');
  }

  async getParams(server: string, catalogType: string): Promise<CatalogParamsResponse> {
    return this.requestCatalog<CatalogParamsResponse>(
      server,
      `/${encodeURIComponent(catalogType)}/params`
    );
  }

  async listObjects(
    server: string,
    catalogType: string,
    query: Record<string, string[]>
  ): Promise<CatalogListResponse> {
    return this.requestCatalog<CatalogListResponse>(
      server,
      `/${encodeURIComponent(catalogType)}`,
      query
    );
  }

  async getObject(
    server: string,
    catalogType: string,
    objectId: string,
    query: Record<string, string[]>
  ): Promise<CatalogObjectResponse> {
    return this.requestCatalog<CatalogObjectResponse>(
      server,
      `/${encodeURIComponent(catalogType)}/${encodeURIComponent(objectId)}`,
      query
    );
  }

  async logout(server: string): Promise<void> {
    await this.sessionStore.clearServer(server);
  }

  private async requestLoginEnsureClient(input: {
    authBase: string;
    email: string;
    password: string;
    userId?: string;
  }): Promise<{ response: HttpResponseLike; payload: LoginEnsureClientResponse }> {
    return this.requestJson<LoginEnsureClientResponse>(
      `${input.authBase}/loginensureclient`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeForm({
          email: input.email,
          password: input.password,
          userId: input.userId,
        }),
      }
    );
  }

  private async requestAccessToken(input: {
    authBase: string;
    clientId: string;
    clientSecret: string;
    email: string;
    password: string;
    userId?: string;
  }): Promise<{ response: HttpResponseLike; payload: AccessTokenResponse }> {
    return this.requestJson<AccessTokenResponse>(`${input.authBase}/accesstoken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: encodeForm({
        grant_type: 'password',
        client_id: input.clientId,
        client_secret: input.clientSecret,
        username: input.email,
        password: input.password,
        userId: input.userId,
      }),
    });
  }

  private assertLoginEnsureOk(input: {
    response: HttpResponseLike;
    payload: LoginEnsureClientResponse;
  }): void {
    const loginStatus = (input.payload?.status || '').toString().toUpperCase();
    if (!input.response.ok || loginStatus !== 'OK') {
      throw new ApiError(
        extractMessage(input.payload, 'Authentication failed.'),
        input.response.status,
        input.payload
      );
    }
  }

  private async promptForUserId(
    payload: unknown,
    prompt: Prompt
  ): Promise<string> {
    const users = extractUsers(payload);
    if (users.length === 0) {
      throw new ApiError(
        extractMessage(payload, 'Multiple accounts were detected, but no account list was returned.'),
        300,
        payload
      );
    }

    const choice = await prompt.choose(
      'Multiple Pandopia accounts found. Select the account to use:',
      users
        .filter((user) => user.id !== undefined && user.id !== null)
        .map((user) => ({
          label: formatUserChoice(user),
          value: String(user.id),
        }))
    );

    if (!choice.value) {
      throw new ApiError(
        'Pandopia returned multiple accounts, but the selected account has no userId.',
        300,
        payload
      );
    }

    return String(choice.value);
  }

  private async refreshToken(server: string): Promise<string | null> {
    const authState = await this.sessionStore.getAuthState(server);
    if (!authState.refreshToken || !authState.clientId || !authState.clientSecret) {
      return null;
    }

    const authBase = getAuthBaseUrl(authState.server);
    const result = await this.requestJson<AccessTokenResponse>(
      `${authBase}/refreshtoken`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeForm({
          grant_type: 'refresh_token',
          refresh_token: authState.refreshToken,
          client_id: authState.clientId,
          client_secret: authState.clientSecret,
        }),
      }
    );

    if (!result.response.ok) {
      return null;
    }

    const accessToken = extractAccessToken(result.payload);
    if (!accessToken) {
      return null;
    }

    await this.sessionStore.updateTokens(authState.server, {
      accessToken,
      refreshToken: extractRefreshToken(result.payload) || authState.refreshToken,
    });

    return accessToken;
  }

  private async requestCatalog<T>(
    server: string,
    path: string,
    query?: Record<string, string[]>
  ): Promise<T> {
    const authState = await this.sessionStore.getAuthState(server);
    if (!authState.accessToken) {
      throw new AuthRequiredError();
    }

    const url = new URL(`${getCatalogBaseUrl(authState.server)}${path}`);
    for (const [key, values] of Object.entries(query || {})) {
      for (const value of values) {
        url.searchParams.append(key, value);
      }
    }

    let token = authState.accessToken;
    let result = await this.requestJson<T>(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (result.response.status === 401) {
      const refreshed = await this.refreshToken(authState.server);
      if (!refreshed) {
        throw new AuthRequiredError();
      }

      token = refreshed;
      result = await this.requestJson<T>(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!result.response.ok) {
      if (result.response.status === 401) {
        throw new AuthRequiredError();
      }
      throw new ApiError(
        extractMessage(result.payload, 'Pandopia API request failed.'),
        result.response.status,
        result.payload
      );
    }

    return result.payload;
  }

  private async requestJson<T>(
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
    }
  ): Promise<{ response: HttpResponseLike; payload: T }> {
    const response = await this.fetchFn(url, init);
    const text = await response.text();
    let payload: T;

    if (text.trim() === '') {
      payload = {} as T;
    } else {
      try {
        payload = JSON.parse(text) as T;
      } catch {
        payload = { message: text } as T;
      }
    }

    return { response, payload };
  }
}
