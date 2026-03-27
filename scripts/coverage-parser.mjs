const COVERAGE_ROW_PATTERN =
  /^(.+?)\s+\|\s*([^|]*)\s+\|\s*([^|]*)\s+\|\s*([^|]*)\s+\|?\s*$/;

function stripAnsi(value) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ''
  );
}

function parseLineCoverage(value) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractCoverageFiles(output) {
  const files = [];
  let currentSection = '';

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const normalizedLine = rawLine.replace(/^(?:#|ℹ)\s?/, '');
    const match = normalizedLine.match(COVERAGE_ROW_PATTERN);
    if (!match) {
      continue;
    }

    const [, rawName, rawLineCoverage, rawBranchCoverage, rawFuncCoverage] = match;
    const name = rawName.trim();
    const lineCoverage = parseLineCoverage(rawLineCoverage);
    const branchCoverage = parseLineCoverage(rawBranchCoverage);
    const funcCoverage = parseLineCoverage(rawFuncCoverage);

    if (name === '' || name === 'file' || name === 'all files') {
      currentSection = '';
      continue;
    }

    if (lineCoverage === null && branchCoverage === null && funcCoverage === null) {
      currentSection = name;
      continue;
    }

    const nestedName =
      currentSection !== '' && !name.includes('/') && /^\s/.test(rawName)
        ? `${currentSection}/${name}`
        : name;

    files.push({
      file: nestedName,
      lineCoverage,
    });
  }

  return files.filter(
    ({ file, lineCoverage }) =>
      !file.startsWith('test/') && Number.isFinite(lineCoverage)
  );
}
