import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function getCliVersion(): Promise<string> {
  const raw = await readFile(join(__dirname, '..', 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version || '0.0.0';
}
