import type { ConfigStore, ProfileConfig } from './config';
import type { SecretKey, SecretStore } from './secrets';
import { getServerAlias, normalizeServerInput } from './servers';

const SECRET_KEYS: SecretKey[] = [
  'access_token',
  'refresh_token',
  'client_id',
  'client_secret',
];

export interface SessionAuthState {
  server: string;
  email?: string;
  userName?: string;
  organismeRef?: string;
  accessToken: string | null;
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

export interface SessionStatus {
  server: string;
  alias: string | null;
  email?: string;
  userName?: string;
  organismeRef?: string;
  loggedIn: boolean;
}

export class SessionStore {
  constructor(
    private readonly configStore: ConfigStore,
    private readonly secretStore: SecretStore
  ) {}

  async getActiveServer(): Promise<string> {
    return this.configStore.getActiveServer();
  }

  async setActiveServer(server: string): Promise<string> {
    const normalized = normalizeServerInput(server);
    await this.configStore.setActiveServer(normalized);
    return normalized;
  }

  async getStatus(server?: string): Promise<SessionStatus> {
    const normalized = normalizeServerInput(
      server || (await this.configStore.getActiveServer())
    );
    const profile = await this.configStore.getProfile(normalized);
    const accessToken = await this.secretStore.get(normalized, 'access_token');
    return {
      server: normalized,
      alias: getServerAlias(normalized),
      email: profile?.email,
      userName: profile?.userName,
      organismeRef: profile?.organismeRef,
      loggedIn: !!accessToken,
    };
  }

  async getAuthState(server?: string): Promise<SessionAuthState> {
    const normalized = normalizeServerInput(
      server || (await this.configStore.getActiveServer())
    );
    const profile = await this.configStore.getProfile(normalized);
    const values = await Promise.all(
      SECRET_KEYS.map((key) => this.secretStore.get(normalized, key))
    );

    return {
      server: normalized,
      email: profile?.email,
      userName: profile?.userName,
      organismeRef: profile?.organismeRef,
      accessToken: values[0],
      refreshToken: values[1],
      clientId: values[2],
      clientSecret: values[3],
    };
  }

  async saveLogin(
    server: string,
    data: {
      email: string;
      userName?: string;
      organismeRef?: string;
      accessToken: string;
      refreshToken?: string;
      clientId: string;
      clientSecret: string;
    }
  ): Promise<void> {
    const normalized = normalizeServerInput(server);
    await this.configStore.setActiveServer(normalized);
    await this.configStore.upsertProfile(normalized, {
      email: data.email,
      userName: data.userName,
      organismeRef: data.organismeRef,
    });
    await this.secretStore.set(normalized, 'access_token', data.accessToken);
    await this.secretStore.set(normalized, 'client_id', data.clientId);
    await this.secretStore.set(normalized, 'client_secret', data.clientSecret);
    if (data.refreshToken) {
      await this.secretStore.set(normalized, 'refresh_token', data.refreshToken);
    } else {
      await this.secretStore.delete(normalized, 'refresh_token');
    }
  }

  async updateTokens(
    server: string,
    data: { accessToken: string; refreshToken?: string | null }
  ): Promise<void> {
    const normalized = normalizeServerInput(server);
    await this.secretStore.set(normalized, 'access_token', data.accessToken);
    if (typeof data.refreshToken === 'string' && data.refreshToken !== '') {
      await this.secretStore.set(normalized, 'refresh_token', data.refreshToken);
    }
  }

  async clearServer(server: string): Promise<void> {
    const normalized = normalizeServerInput(server);
    await Promise.all(
      SECRET_KEYS.map((key) => this.secretStore.delete(normalized, key))
    );
    await this.configStore.clearProfile(normalized);
  }

  async setProfile(server: string, patch: ProfileConfig): Promise<void> {
    await this.configStore.upsertProfile(normalizeServerInput(server), patch);
  }
}
