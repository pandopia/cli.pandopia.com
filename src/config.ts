import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_SERVER, normalizeServerInput } from './servers';

export interface ProfileConfig {
  email?: string;
  userName?: string;
  organismeRef?: string;
  updatedAt?: string;
}

export interface AppConfig {
  activeServer: string;
  profiles: Record<string, ProfileConfig>;
}

export interface ConfigStore {
  getActiveServer(): Promise<string>;
  setActiveServer(server: string): Promise<void>;
  getProfile(server: string): Promise<ProfileConfig | undefined>;
  upsertProfile(server: string, patch: ProfileConfig): Promise<void>;
  clearProfile(server: string): Promise<void>;
}

export function getDefaultConfigPath(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'pandopia', 'config.json');
}

function getDefaultConfig(): AppConfig {
  return {
    activeServer: DEFAULT_SERVER,
    profiles: {},
  };
}

export class FileConfigStore implements ConfigStore {
  constructor(private readonly configPath = getDefaultConfigPath()) {}

  async getActiveServer(): Promise<string> {
    const config = await this.readConfig();
    return normalizeServerInput(config.activeServer);
  }

  async setActiveServer(server: string): Promise<void> {
    const config = await this.readConfig();
    config.activeServer = normalizeServerInput(server);
    await this.writeConfig(config);
  }

  async getProfile(server: string): Promise<ProfileConfig | undefined> {
    const config = await this.readConfig();
    return config.profiles[normalizeServerInput(server)];
  }

  async upsertProfile(server: string, patch: ProfileConfig): Promise<void> {
    const config = await this.readConfig();
    const normalized = normalizeServerInput(server);
    const current = config.profiles[normalized] || {};
    config.profiles[normalized] = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.writeConfig(config);
  }

  async clearProfile(server: string): Promise<void> {
    const config = await this.readConfig();
    delete config.profiles[normalizeServerInput(server)];
    await this.writeConfig(config);
  }

  private async readConfig(): Promise<AppConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        activeServer: normalizeServerInput(parsed.activeServer || DEFAULT_SERVER),
        profiles: parsed.profiles || {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return getDefaultConfig();
      }
      throw error;
    }
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    await fs.mkdir(dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
}
