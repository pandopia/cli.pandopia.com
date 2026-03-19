import type { CatalogParamDefinition, CatalogTypeParamsData, CatalogType, Pagination, WriterLike } from './types';
import type { SessionStatus } from './session';

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyCell(item)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function renderTable(
  rows: Array<Record<string, unknown>>,
  columns: string[]
): string {
  if (rows.length === 0) {
    return 'No results.';
  }

  const widths = columns.map((column) => column.length);
  const renderedRows = rows.map((row) =>
    columns.map((column, index) => {
      const value = stringifyCell(row[column]);
      widths[index] = Math.max(widths[index], value.length);
      return value;
    })
  );

  const header = columns
    .map((column, index) => column.padEnd(widths[index]))
    .join('  ');
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = renderedRows.map((row) =>
    row.map((value, index) => value.padEnd(widths[index])).join('  ')
  );

  return [header, separator, ...body].join('\n');
}

function renderStatus(status: SessionStatus): string {
  if (status.loggedIn) {
    const label = status.userName || status.email || 'authenticated user';
    return `logged in as ${label}`;
  }
  return 'not logged in';
}

export function renderRootHelp(status: SessionStatus): string {
  return [
    'Pandopia Catalog CLI',
    '',
    `Active server: ${status.server}`,
    `Login status: ${renderStatus(status)}`,
    '',
    'Usage:',
    '  pandopia <command> [options]',
    '',
    'Commands:',
    '  pandopia login [email]                      Authenticate and store credentials',
    '  pandopia logout                             Clear credentials for the active server',
    '  pandopia types                              List exposed catalog types',
    '  pandopia params <catalogType>               Show filters and params for a catalog type',
    '  pandopia list <catalogType> [flags]         List catalog objects',
    '  pandopia get <catalogType> <objectId>       Get one catalog object',
    '',
    'Examples:',
    '  pandopia login cyril.bele@gmail.com',
    '  pandopia types',
    '  pandopia params diag_dpereglementaire',
    '  pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6',
    '  pandopia get diag_dpereglementaire 1235',
  ].join('\n');
}

export function renderCommandUsage(command: 'list' | 'get' | 'params'): string {
  if (command === 'list') {
    return [
      'Usage:',
      '  pandopia list <catalogType> [--page N] [--per-page N] [--search TEXT] [--params A,B] [filters...]',
      '',
      'Example:',
      '  pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6',
      '',
      'Hint:',
      '  Run pandopia types to discover available catalog types.',
    ].join('\n');
  }

  if (command === 'get') {
    return [
      'Usage:',
      '  pandopia get <catalogType> <objectId> [--params A,B]',
      '',
      'Example:',
      '  pandopia get diag_dpereglementaire 1235',
      '',
      'Hint:',
      '  Run pandopia types to discover available catalog types.',
    ].join('\n');
  }

  return [
    'Usage:',
    '  pandopia params <catalogType>',
    '',
    'Example:',
    '  pandopia params diag_dpereglementaire',
    '',
    'Hint:',
    '  Run pandopia types to discover available catalog types.',
  ].join('\n');
}

export function renderTypes(types: CatalogType[]): string {
  return renderTable(
    types.map((item) => ({
      type: item.type,
      objectName: item.objectName,
    })),
    ['type', 'objectName']
  );
}

function getParamColumns(params: CatalogParamDefinition[]): string[] {
  const preferred = [
    'code',
    'name',
    'type',
    'required',
    'description',
    'default',
    'values',
  ];
  return preferred.filter((column) =>
    params.some((param) => param[column] !== undefined)
  );
}

export function renderParams(data: CatalogTypeParamsData): string {
  const filters = data.filters.length
    ? data.filters.map((filter) => `- ${filter}`).join('\n')
    : 'No filters.';
  const columns = getParamColumns(data.params);
  const params =
    data.params.length === 0
      ? 'No params.'
      : renderTable(
          data.params.map((param) => {
            const row: Record<string, unknown> = {};
            for (const column of columns) {
              row[column] = param[column];
            }
            return row;
          }),
          columns
        );

  return ['Filters:', filters, '', 'Params:', params].join('\n');
}

export function renderPagination(pagination: Pagination): string {
  return `Page ${pagination.page} / ${pagination.nbPages} | perPage ${pagination.perPage} | total ${pagination.totalNb}`;
}

export function renderPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderJsonLines(
  rows: Array<Record<string, unknown>>
): string {
  if (rows.length === 0) {
    return 'No results.';
  }

  return rows.map((row) => JSON.stringify(row)).join('\n');
}

export function writeLine(writer: WriterLike, message = ''): void {
  writer.write(`${message}\n`);
}
