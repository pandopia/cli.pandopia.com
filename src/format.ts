import type {
  CatalogParamDefinition,
  CatalogParamHistoryEntry,
  CatalogTypeParamsData,
  CatalogType,
  Pagination,
  WhoIAmSummary,
  WriterLike,
} from './types';
import type { SessionStatus } from './session';

function escapeMarkdownCell(value: unknown): string {
  return stringifyCell(value).replace(/\|/g, '\\|').replace(/\n/g, '<br />');
}

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

function collectColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  return columns;
}

export function renderMarkdownTable(
  rows: Array<Record<string, unknown>>,
  columns: string[]
): string {
  if (rows.length === 0) {
    return 'Aucun résultat.';
  }

  const header = `| ${columns.join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(
    (row) =>
      `| ${columns.map((column) => escapeMarkdownCell(row[column])).join(' | ')} |`
  );

  return [header, separator, ...body].join('\n');
}

export function renderTable(
  rows: Array<Record<string, unknown>>,
  columns: string[]
): string {
  return renderMarkdownTable(rows, columns);
}

function renderStatus(status: SessionStatus): string {
  if (status.loggedIn) {
    const label = status.userName || status.email || 'utilisateur authentifié';
    return `connecté en tant que ${label}`;
  }
  return 'non connecté';
}

export function renderRootHelp(status: SessionStatus): string {
  return [
    'CLI catalogue Pandopia',
    '',
    `Serveur actif : ${status.server}`,
    `Statut de connexion : ${renderStatus(status)}`,
    `Format par défaut : ${status.defaultFormat}`,
    '',
    'Usage :',
    '  pandopia <command> [options]',
    '',
    'Commandes :',
    '  pandopia setServer <serveur>                Définit le serveur actif',
    '  pandopia setFormat <format>                Définit le format de sortie par défaut',
    '  pandopia login [email]                      Authentifie et stocke les identifiants',
    '  pandopia logout                             Supprime les identifiants du serveur actif',
    '  pandopia whoiam                             Affiche l’utilisateur authentifié et la clé API',
    '  pandopia status                             Alias de whoiam',
    '  pandopia types [--json|--jsonl|--md]        Liste les types de catalogue exposés',
    '  pandopia params <catalogType> [flags]       Affiche les filtres et paramètres d’un type',
    '  pandopia list <catalogType> [flags]         Liste les objets du catalogue',
    '  pandopia find <catalogType> <text> [flags]  Alias de list --search',
    '  pandopia get <catalogType> <objectId> [flags]  Récupère un objet du catalogue',
    '  pandopia history <catalogType> <objectId> <paramCode> [flags]  Affiche un historique',
    '',
    'Exemples :',
    '  pandopia --version',
    '  pandopia setServer test',
    '  pandopia setFormat jsonl',
    '  pandopia login cyril.bele@gmail.com',
    '  pandopia status',
    '  pandopia types',
    '  pandopia params diag_dpereglementaire',
    '  pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6',
    '  pandopia find diag_dpereglementaire "lmh"',
    '  pandopia get diag_dpereglementaire 1235',
    '  pandopia history diag_dpereglementaire 1235 DIAG_STATUS',
  ].join('\n');
}

export function renderCommandUsage(
  command: 'list' | 'find' | 'get' | 'params' | 'history' | 'setServer' | 'setFormat'
): string {
  if (command === 'setServer') {
    return [
      'Usage :',
      '  pandopia setServer <serveur>',
      '',
      'Exemples :',
      '  pandopia setServer test',
      '  pandopia setServer local',
      '  pandopia setServer https://app.pandopia.com/api/catalog',
      '',
      'Valeurs acceptées :',
      '  app, test, local, une origine brute, ou une URL complète en /api/catalog.',
    ].join('\n');
  }

  if (command === 'setFormat') {
    return [
      'Usage :',
      '  pandopia setFormat <json|jsonl|md>',
      '',
      'Exemples :',
      '  pandopia setFormat md',
      '  pandopia setFormat json',
      '  pandopia setFormat jsonl',
    ].join('\n');
  }

  if (command === 'list') {
    return [
      'Usage :',
      '  pandopia list <catalogType> [--page N] [--per-page N] [--search TEXT] [--params A,B] [--json|--jsonl|--md] [filters...]',
      '',
      'Exemple :',
      '  pandopia list diag_dpereglementaire --DIAG_STATUS=valide --organismeRef=lmh_6',
      '',
      'Astuce :',
      '  Utilisez pandopia types pour découvrir les types de catalogue disponibles.',
    ].join('\n');
  }

  if (command === 'find') {
    return [
      'Usage :',
      '  pandopia find <catalogType> <text> [--page N] [--per-page N] [--params A,B] [--json|--jsonl|--md] [filters...]',
      '',
      'Exemple :',
      '  pandopia find diag_dpereglementaire "lmh"',
      '',
      'Astuce :',
      '  Utilisez pandopia types pour découvrir les types de catalogue disponibles.',
    ].join('\n');
  }

  if (command === 'get') {
    return [
      'Usage :',
      '  pandopia get <catalogType> <objectId> [--params A,B] [--json|--jsonl|--md]',
      '',
      'Exemple :',
      '  pandopia get diag_dpereglementaire 1235',
      '',
      'Astuce :',
      '  Utilisez pandopia types pour découvrir les types de catalogue disponibles.',
    ].join('\n');
  }

  if (command === 'history') {
    return [
      'Usage :',
      '  pandopia history <catalogType> <objectId> <paramCode> [--json|--jsonl|--md]',
      '',
      'Exemple :',
      '  pandopia history diag_dpereglementaire 1235 DIAG_STATUS',
      '',
      'Astuce :',
      '  Utilisez pandopia params <catalogType> pour découvrir les paramètres disponibles.',
    ].join('\n');
  }

  return [
    'Usage :',
    '  pandopia params <catalogType> [--json|--jsonl|--md]',
    '',
    'Exemple :',
    '  pandopia params diag_dpereglementaire',
    '',
    'Astuce :',
    '  Utilisez pandopia types pour découvrir les types de catalogue disponibles.',
  ].join('\n');
}

export function renderTypes(types: CatalogType[]): string {
  return renderMarkdownTable(
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
    ? data.filters.map((filter) => `- \`${filter}\``).join('\n')
    : 'Aucun filtre.';
  const columns = getParamColumns(data.params);
  const params =
    data.params.length === 0
      ? 'Aucun paramètre.'
      : renderMarkdownTable(
          data.params.map((param) => {
            const row: Record<string, unknown> = {};
            for (const column of columns) {
              row[column] = param[column];
            }
            return row;
          }),
          columns
        );

  return ['## Filtres', '', filters, '', '## Paramètres', '', params].join('\n');
}

export function renderPagination(pagination: Pagination): string {
  return `Page ${pagination.page} / ${pagination.nbPages} | par page ${pagination.perPage} | total ${pagination.totalNb}`;
}

export function renderRecord(record: Record<string, unknown>): string {
  const entries = Object.entries(record).map(([field, value]) => ({
    champ: field,
    valeur: value,
  }));

  return renderMarkdownTable(entries, ['champ', 'valeur']);
}

export function renderRecords(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return 'Aucun résultat.';
  }

  return renderMarkdownTable(rows, collectColumns(rows));
}

export function renderHistory(entries: CatalogParamHistoryEntry[]): string {
  if (entries.length === 0) {
    return 'Aucun historique.';
  }

  return renderMarkdownTable(
    entries.map((entry) => ({
      changedAt: entry.changedAt,
      mode: entry.mode,
      modeName: entry.modeName,
      value: entry.value,
      userId: entry.userId,
      clientId: entry.clientId,
      workId: entry.workId,
      projectId: entry.projectId,
      ticketId: entry.ticketId,
    })),
    ['changedAt', 'mode', 'modeName', 'value', 'userId', 'clientId', 'workId', 'projectId', 'ticketId']
  );
}

export function renderWhoIAm(summary: WhoIAmSummary): string {
  return [
    '## Statut',
    '',
    `- Connecté : ${summary.connected ? 'oui' : 'non'}`,
    `- Serveur : ${summary.server}`,
    `- Format par défaut : ${summary.defaultFormat}`,
    `- Email : ${summary.email || 'inconnu'}`,
    `- Organisation : ${summary.organismeRef || 'inconnue'}`,
    `- Identifiant de clé API : ${summary.apiKeyId || 'inconnu'}`,
  ].join('\n');
}

export function renderPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderJsonLines(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((row) => JSON.stringify(row)).join('\n');
  }

  if (value === undefined) {
    return '';
  }

  return JSON.stringify(value);
}

export function writeLine(writer: WriterLike, message = ''): void {
  writer.write(`${message}\n`);
}
