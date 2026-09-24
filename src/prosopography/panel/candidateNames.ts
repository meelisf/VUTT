/**
 * Kaardi nime valik isikupaneelis (spekk §5.2).
 *
 * Sobivus = sõna-eesliide: iga otsitud sõna peab olema täisnime MÕNE sõna
 * algus („Luden" sobib „Ludenius"-ega, „denius" mitte). Sama loogika mis
 * Meili prefiksotsingul.
 */
import type { CandidateName } from './types';

const KEELEJÄRJESTUS = ['la', 'mul', 'de', 'en', 'et'];

function normaliseeri(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase('et').replace(/ß/g, 'ss');
}

function sõnad(s: string): string[] {
  return normaliseeri(s).split(/[\s.,;:()\-–—'"„“]+/u).filter(Boolean);
}

export function nameMatches(query: string, text: string): boolean {
  const otsitud = sõnad(query);
  if (otsitud.length === 0) return false;
  const nimeSõnad = sõnad(text);
  return otsitud.every(o => nimeSõnad.some(n => n.startsWith(o)));
}

function keeleJärk(lang: string | null): number {
  const i = lang ? KEELEJÄRJESTUS.indexOf(lang) : -1;
  return i === -1 ? KEELEJÄRJESTUS.length : i;
}

export function chooseCardName(query: string, names: CandidateName[], fallback: string) {
  const unikaalsed: CandidateName[] = [];
  const nähtud = new Set<string>();
  for (const n of names) {
    const k = normaliseeri(n.text);
    if (!n.text.trim() || nähtud.has(k)) continue;
    nähtud.add(k);
    unikaalsed.push(n);
  }
  const sobivad = unikaalsed
    .filter(n => nameMatches(query, n.text))
    .sort((a, b) => keeleJärk(a.lang) - keeleJärk(b.lang));
  const chosen = sobivad[0]?.text ?? fallback;
  const valitud = normaliseeri(chosen);
  return {
    chosen,
    matched: sobivad.map(n => n.text),
    others: unikaalsed.map(n => n.text).filter(t => normaliseeri(t) !== valitud),
  };
}
