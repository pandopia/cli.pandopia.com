export const SERVER_ALIASES: Record<string, string> = {
  app: 'https://app.pandopia.com',
  test: 'https://test.pandopia.com',
  local: 'http://pandopia.test',
};

export const DEFAULT_SERVER = SERVER_ALIASES.app;

export function normalizeServerInput(input?: string): string {
  if (!input || input.trim() === '') {
    return DEFAULT_SERVER;
  }

  const trimmed = input.trim();
  const alias = SERVER_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    return alias;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      'Invalid server value. Use app, test, local, or a full URL.'
    );
  }

  const url = new URL(trimmed);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (pathname === '' || pathname === '/') {
    url.pathname = '';
  } else if (pathname === '/api' || pathname === '/api/catalog') {
    url.pathname = '';
  } else {
    throw new Error(
      'Server URL must be an origin or end with /api/catalog.'
    );
  }

  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function getCatalogBaseUrl(server: string): string {
  return `${normalizeServerInput(server)}/api/catalog`;
}

export function getAuthBaseUrl(server: string): string {
  return `${normalizeServerInput(server)}/api/auth`;
}

export function getServerAlias(server: string): string | null {
  const normalized = normalizeServerInput(server);
  for (const [alias, value] of Object.entries(SERVER_ALIASES)) {
    if (value === normalized) {
      return alias;
    }
  }
  return null;
}
