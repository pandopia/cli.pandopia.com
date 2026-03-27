import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extractCoverageFiles } from './coverage-parser.mjs';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

const threshold = Number(packageJson.coverageThreshold?.lines ?? 80);
if (!Number.isFinite(threshold)) {
  console.error('Configuration de seuil de couverture invalide.');
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

const files = extractCoverageFiles(combinedOutput);

if (files.length === 0) {
  console.error("Impossible d'analyser le rapport de couverture.");
  process.exit(1);
}

const failedFiles = files.filter(({ lineCoverage }) => lineCoverage < threshold);
if (failedFiles.length > 0) {
  console.error(
    `Échec de la couverture: ${failedFiles.length} fichier(s) de production sont sous ${threshold}%.`
  );
  for (const { file, lineCoverage } of failedFiles) {
    console.error(`- ${file}: ${lineCoverage.toFixed(2)}%`);
  }
  process.exit(1);
}

console.log(
  `Couverture validée: ${files.length} fichier(s) de production atteignent le seuil de ${threshold}%.`
);
