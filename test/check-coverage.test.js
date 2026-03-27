const test = require('node:test');
const assert = require('node:assert/strict');

test('extractCoverageFiles analyse le format inline avec préfixe #', async () => {
  const { extractCoverageFiles } = await import('../scripts/coverage-parser.mjs');

  const output = [
    '# start of coverage report',
    '# ------------------------------------------------------------------',
    '# file              | line % | branch % | funcs % | uncovered lines',
    '# ------------------------------------------------------------------',
    '# dist/api.js       | 100.00 |    99.26 |  100.00 | ',
    '# dist/cli.js       | 100.00 |    97.39 |  100.00 | ',
    '# test/cli.test.js  |  95.88 |    82.79 |   97.06 | ',
    '# all files         | 100.00 |    97.20 |  100.00 | ',
    '# ------------------------------------------------------------------',
  ].join('\n');

  assert.deepEqual(extractCoverageFiles(output), [
    { file: 'dist/api.js', lineCoverage: 100 },
    { file: 'dist/cli.js', lineCoverage: 100 },
  ]);
});

test('extractCoverageFiles analyse le format groupé du CI', async () => {
  const { extractCoverageFiles } = await import('../scripts/coverage-parser.mjs');

  const output = [
    'ℹ start of coverage report',
    'ℹ ------------------------------------------------------------------',
    'ℹ file              | line % | branch % | funcs % | uncovered lines',
    'ℹ ------------------------------------------------------------------',
    'ℹ dist              |        |          |         | ',
    'ℹ  api.js           | 100.00 |    99.26 |  100.00 | ',
    'ℹ  cli.js           | 100.00 |    97.39 |  100.00 | ',
    'ℹ test              |        |          |         | ',
    'ℹ  cli.test.js      |  95.88 |    82.79 |   97.06 | ',
    'ℹ all files         | 100.00 |    97.20 |  100.00 | ',
    'ℹ ------------------------------------------------------------------',
  ].join('\n');

  assert.deepEqual(extractCoverageFiles(output), [
    { file: 'dist/api.js', lineCoverage: 100 },
    { file: 'dist/cli.js', lineCoverage: 100 },
  ]);
});
