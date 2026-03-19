export interface CatalogType {
  type: string;
  objectName: string;
}

export interface Pagination {
  page: number;
  perPage: number;
  nbPages: number;
  totalNb: number;
}

export interface CatalogParamDefinition {
  [key: string]: unknown;
}

export interface CatalogTypeParamsData {
  filters: string[];
  params: CatalogParamDefinition[];
}

export interface CatalogListResponse {
  status: string;
  pagination: Pagination;
  data: Array<Record<string, unknown>>;
}

export interface CatalogObjectResponse {
  status: string;
  data: Record<string, unknown>;
}

export interface CatalogTypesResponse {
  status: string;
  data: CatalogType[];
}

export interface CatalogParamsResponse {
  status: string;
  data: CatalogTypeParamsData;
}

export interface LoginEnsureClientResponse {
  status?: string;
  error?: { message?: string };
  data?: {
    client_id?: string;
    client_secret?: string;
    user?: { name?: string };
  };
}

export interface AccessTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };
}

export interface MultipleAccountUser {
  id?: string | number;
  name?: string;
  email?: string;
  organismeRef?: string;
  [key: string]: unknown;
}

export interface WriterLike {
  write(chunk: string): void;
}
