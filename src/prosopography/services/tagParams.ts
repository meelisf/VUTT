/**
 * Märksõna-parameetrite serialiseerimine URL-i.
 *
 * Korduv `tag` võti on ainus koht teenusekihis, kus kasutatakse `append`-i
 * `set`-i asemel — `set` kirjutaks eelmise väärtuse üle ja mitmikvalik murduks.
 */
export function appendTagParams(params: URLSearchParams, tag?: string | string[]): void {
  if (!tag) return;
  const values = Array.isArray(tag) ? tag : [tag];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    params.append('tag', cleaned);
  }
}
