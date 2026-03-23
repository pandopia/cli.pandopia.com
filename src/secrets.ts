import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDefaultConfigPath } from './config';
import { normalizeServerInput } from './servers';

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = 'pandopia-cli';

export type SecretKey =
  | 'access_token'
  | 'refresh_token'
  | 'client_id'
  | 'client_secret';

export interface SecretStore {
  get(server: string, key: SecretKey): Promise<string | null>;
  set(server: string, key: SecretKey, value: string): Promise<void>;
  delete(server: string, key: SecretKey): Promise<void>;
}

interface ExecFileResult {
  stdout: string;
  stderr?: string;
}

type ExecFileRunner = (
  file: string,
  args: string[]
) => Promise<ExecFileResult>;

type FileSecretData = Record<string, Partial<Record<SecretKey, string>>>;

export function getDefaultSecretsPath(): string {
  return join(dirname(getDefaultConfigPath()), 'secrets.json');
}

function accountName(server: string, key: SecretKey): string {
  return `${normalizeServerInput(server)}::${key}`;
}

function isMissingSecret(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error || '');
  return (
    message.includes('could not be found') ||
    message.includes('The specified item could not be found') ||
    message.includes('returned non-zero exit status 44')
  );
}

export class MacKeychainStore implements SecretStore {
  constructor(
    private readonly execFileRunner: ExecFileRunner = execFileAsync,
    platform = process.platform
  ) {
    if (platform !== 'darwin') {
      throw new Error('Pandopia CLI keychain storage is only supported on macOS.');
    }
  }

  async get(server: string, key: SecretKey): Promise<string | null> {
    try {
      const result = await this.execFileRunner('/usr/bin/security', [
        'find-generic-password',
        '-a',
        accountName(server, key),
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ]);
      return result.stdout.trim();
    } catch (error) {
      if (isMissingSecret(error)) {
        return null;
      }
      throw error;
    }
  }

  async set(server: string, key: SecretKey, value: string): Promise<void> {
    await this.execFileRunner('/usr/bin/security', [
      'add-generic-password',
      '-a',
      accountName(server, key),
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
      value,
      '-U',
    ]);
  }

  async delete(server: string, key: SecretKey): Promise<void> {
    try {
      await this.execFileRunner('/usr/bin/security', [
        'delete-generic-password',
        '-a',
        accountName(server, key),
        '-s',
        KEYCHAIN_SERVICE,
      ]);
    } catch (error) {
      if (!isMissingSecret(error)) {
        throw error;
      }
    }
  }
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly secretsPath = getDefaultSecretsPath()) {}

  async get(server: string, key: SecretKey): Promise<string | null> {
    const secrets = await this.readSecrets();
    return secrets[normalizeServerInput(server)]?.[key] ?? null;
  }

  async set(server: string, key: SecretKey, value: string): Promise<void> {
    const normalized = normalizeServerInput(server);
    const secrets = await this.readSecrets();
    secrets[normalized] = {
      ...(secrets[normalized] || {}),
      [key]: value,
    };
    await this.writeSecrets(secrets);
  }

  async delete(server: string, key: SecretKey): Promise<void> {
    const normalized = normalizeServerInput(server);
    const secrets = await this.readSecrets();
    const current = {
      ...(secrets[normalized] || {}),
    };
    delete current[key];

    if (Object.keys(current).length > 0) {
      secrets[normalized] = current;
    } else {
      delete secrets[normalized];
    }

    await this.writeSecrets(secrets);
  }

  private async readSecrets(): Promise<FileSecretData> {
    try {
      return JSON.parse(await fs.readFile(this.secretsPath, 'utf8')) as FileSecretData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  private async writeSecrets(secrets: FileSecretData): Promise<void> {
    await fs.mkdir(dirname(this.secretsPath), { recursive: true });
    await fs.writeFile(this.secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, {
      mode: 0o600,
    });
  }
}

export function createSecretStore(
  platform = process.platform,
  secretsPath = getDefaultSecretsPath()
): SecretStore {
  if (platform === 'darwin') {
    return new MacKeychainStore(execFileAsync, platform);
  }

  return new FileSecretStore(secretsPath);
}
