import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Toutes les parties servies sur l'origine de MyLife partagent le même stockage, donc la clé d'API Anthropic de
 * l'appareil : une seule partie sans politique stricte suffirait à l'exposer. Chacune doit déclarer une CSP qui
 * n'exécute que ses propres scripts et ne parle qu'à elle-même et à l'API d'Anthropic.
 */
const PARTS = {
  accueil: { file: 'vercel.json', page: '/argent' },
  finances: { file: 'apps/finances/vercel.json', page: '/finances/' },
  perf: { file: 'apps/perf/web/vercel.json', page: '/perf/' },
  raveloc: { file: 'apps/raveloc/vercel.json', page: '/raveloc/' },
};

function cspFor(file: string, page: string): Map<string, string[]> | null {
  const conf = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as { headers?: { source: string; headers: { key: string; value: string }[] }[] };
  for (const h of conf.headers ?? []) {
    if (!new RegExp(`^${h.source.replace(/:path\*/g, '.*')}$`).test(page)) continue;
    const csp = h.headers.find((x) => x.key.toLowerCase() === 'content-security-policy');
    if (csp) return new Map(csp.value.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...v]) => [name!, v]));
  }
  return null;
}

describe('CSP de chaque partie de MyLife (même origine, même clé d’API)', () => {
  for (const [part, { file, page }] of Object.entries(PARTS)) {
    it(`${part} : scripts du site seulement, connexions au site et à Anthropic seulement, pas d’intégration ailleurs`, () => {
      const csp = cspFor(file, page);
      expect(csp, `${file} : aucune CSP pour ${page}`).not.toBeNull();
      const scripts = csp!.get('script-src') ?? csp!.get('default-src')!;
      expect(scripts).toContain("'self'");
      expect(scripts.filter((s) => s !== "'self'" && s !== "'wasm-unsafe-eval'")).toEqual([]);
      expect(csp!.get('default-src')).toEqual(["'self'"]);
      expect((csp!.get('connect-src') ?? []).filter((s) => s !== "'self'" && s !== 'https://api.anthropic.com')).toEqual([]);
      expect(csp!.get('frame-ancestors')).toEqual(["'none'"]);
      expect(csp!.get('base-uri')).toEqual(["'self'"]);
      expect(csp!.get('form-action')).toEqual(["'self'"]);
    });
  }
});
