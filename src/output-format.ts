export type OutputFormat = 'md' | 'json' | 'jsonl';

export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'md';

export function isOutputFormat(value: unknown): value is OutputFormat {
  return value === 'md' || value === 'json' || value === 'jsonl';
}

export function normalizeOutputFormat(value: unknown): OutputFormat {
  return isOutputFormat(value) ? value : DEFAULT_OUTPUT_FORMAT;
}
