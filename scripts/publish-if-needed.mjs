import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function readPackageMetadata() {
  const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw);

  if (!pkg.name || !pkg.version) {
    throw new Error('Le package.json doit définir un nom et une version.');
  }

  return {
    name: String(pkg.name),
    version: String(pkg.version),
  };
}

async function isVersionPublished(name, version) {
  try {
    const { stdout } = await execFileAsync('npm', [
      'view',
      `${name}@${version}`,
      'version',
      '--json',
    ]);
    return stdout.trim() !== '';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('E404') || message.includes('404')) {
      return false;
    }
    throw error;
  }
}

async function main() {
  const { name, version } = await readPackageMetadata();

  if (await isVersionPublished(name, version)) {
    console.log(`La version ${version} de ${name} est déjà publiée sur npm. Publication ignorée.`);
    return;
  }

  console.log(`Publication de ${name}@${version} sur npm...`);
  const { stdout, stderr } = await execFileAsync('npm', ['run', 'publish:npm'], {
    shell: process.platform === 'win32',
  });
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
