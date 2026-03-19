import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

const threshold = Number(packageJson.coverageThreshold?.lines ?? 80);
if (!Number.isFinite(threshold)) {
  console.error('Invalid coverage threshold configuration.');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', '--experimental-test-coverage'], {
  cwd: new URL('..', import.meta.url),
  stdio: ['inherit', 'pipe', 'pipe'],
});

let combinedOutput = '';

child.stdout.on('data', (chunk) => {
  const text = String(chunk);
  combinedOutput += text;
  process.stdout.write(text);
});

child.stderr.on('data', (chunk) => {
  const text = String(chunk);
  combinedOutput += text;
  process.stderr.write(text);
});

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

if (exitCode !== 0) {
  process.exit(exitCode ?? 1);
}

const match = combinedOutput.match(/# all files\s+\|\s+([\d.]+)\s+\|/);
if (!match) {
  console.error('Could not parse the coverage report.');
  process.exit(1);
}

const lineCoverage = Number.parseFloat(match[1]);
if (!Number.isFinite(lineCoverage)) {
  console.error('Could not read the global line coverage value.');
  process.exit(1);
}

if (lineCoverage < threshold) {
  console.error(
    `Coverage check failed: global line coverage ${lineCoverage.toFixed(2)}% is below ${threshold}%.`
  );
  process.exit(1);
}

console.log(
  `Coverage check passed: global line coverage ${lineCoverage.toFixed(2)}% meets the ${threshold}% threshold.`
);
