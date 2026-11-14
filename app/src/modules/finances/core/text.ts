/** Minuscules, sans accents, ponctuation remplacée par des espaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase());
}
