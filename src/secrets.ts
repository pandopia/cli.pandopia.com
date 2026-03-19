import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
