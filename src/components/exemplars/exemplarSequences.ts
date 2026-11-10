/**
 * Eksemplari lehe puhas loogika: pildijadad, lehe päritolu, paari kehtivus ja
 * kõrvutuse lukus samm. Leheloend tuleb `GET /works/{id}/exemplars` vastusest
 * (`page_numbers` + `page_files`, kettalt) — MITTE Meilist, mille sünk on
 * asünkroonne (ADR 0013). Paar, mille tüve loendis ei ole, on paari puudumine
 * (ADR 0079 p 3 täiendus).
 */
import type { WorkExemplarsResponse } from '../../services/workApi';
import type { ExemplarImage } from '../../services/exemplarImagesService';
import {
  getExemplarImageUrl, getExemplarThumbUrl, getFullImageUrl, getPageThumbUrl,
} from '../../services/workImageService';
import { orderExemplars } from './exemplarCardUtils';

/** Rea „Teose lehed" ja kõrvutuse jada võti. */
export const PAGES_KEY = 'pages';

export interface SeqItem {
  key: string;
  label: string;
  url: string;
  thumb: string;
  /** Teose lehe tüvi (ainult jadas PAGES_KEY). */
  stem?: string;
  /** Pildi KEHTIV paar (rippuv = undefined). */
  pairStem?: string;
  /** Hoidja võti või 'unknown', kui leht ei ole aluse oma. */
  ownerNote?: string;
}

export interface Sequence {
  key: string;
  kind: 'pages' | 'images';
  exemplarId?: string;
  items: SeqItem[];
}

const stemOf = (file: string) => file.replace(/\.[^.]+$/, '');

export function hasWitness(data: WorkExemplarsResponse): boolean {
  return data.exemplars.some(x => x.text_witness);
}

/** Tüvi → eksemplari id | 'unknown' | null (ADR 0076 p 4 lahendusjärjekord). */
export function pageOwners(data: WorkExemplarsResponse): Map<string, string | 'unknown' | null> {
  const byPage = new Map<string, string>();
  for (const x of data.exemplars) for (const s of x.pages ?? []) byPage.set(s, x.id);
  const unknown = new Set(data.unknown_pages);
  const witness = data.exemplars.find(x => x.text_witness)?.id ?? null;
  const out = new Map<string, string | 'unknown' | null>();
  for (const stem of Object.keys(data.page_numbers)) {
    out.set(stem, byPage.get(stem) ?? (unknown.has(stem) ? 'unknown' : witness));
  }
  return out;
}

/** Rippuv või tühi → undefined. */
export function validPairStem(image: ExemplarImage, pageNumbers: Record<string, number>): string | undefined {
  const p = image.page;
  return p && Object.prototype.hasOwnProperty.call(pageNumbers, p) ? p : undefined;
}

function pageItem(workId: string, file: string, n: number, ownerNote?: string): SeqItem {
  const stem = stemOf(file);
  return {
    key: stem, label: String(n), stem, ownerNote,
    url: getFullImageUrl(`${workId}/${file}`),
    thumb: getPageThumbUrl(workId, file),
  };
}

/** Teose lehed teose järjekorras koos omanikuga. */
function pagesWithOwners(workId: string, data: WorkExemplarsResponse): { item: SeqItem; owner: string | null }[] {
  const owners = pageOwners(data);
  const witness = data.exemplars.find(x => x.text_witness)?.id ?? null;
  const holder = new Map(data.exemplars.map(x => [x.id, x.holder]));
  return (data.page_files ?? []).map((file, i) => {
    const owner = owners.get(stemOf(file)) ?? null;
    const note = owner === 'unknown' ? 'unknown'
      : owner && owner !== witness ? holder.get(owner) : undefined;
    return { item: pageItem(workId, file, i + 1, note), owner };
  });
}

/** Kõik teose lehed teose järjekorras (page_files), ownerNote erand- ja teadmata lehtedel. */
export function pagesSequence(workId: string, data: WorkExemplarsResponse): Sequence {
  return { key: PAGES_KEY, kind: 'pages', items: pagesWithOwners(workId, data).map(p => p.item) };
}

export function imagesSequence(workId: string, exemplarId: string, images: ExemplarImage[],
  pageNumbers: Record<string, number>): Sequence {
  return {
    key: exemplarId, kind: 'images', exemplarId,
    items: images.map((im, i) => ({
      key: im.id,
      label: im.label || String(i + 1),
      url: getExemplarImageUrl(workId, exemplarId, im.id),
      thumb: getExemplarThumbUrl(workId, exemplarId, im.id),
      pairStem: validPairStem(im, pageNumbers),
    })),
  };
}

/** Eksemplari lehe jaotis: tema teose lehed (alus: kõik peale erand- ja teadmata lehtede). */
export function ownPages(workId: string, data: WorkExemplarsResponse, exemplarId: string): SeqItem[] {
  return pagesWithOwners(workId, data).filter(p => p.owner === exemplarId).map(p => p.item);
}

/** Rea „Teose lehed" sisu (alus märkimata): kõik lehed peale erandlehtede. */
export function unassignedPages(workId: string, data: WorkExemplarsResponse): SeqItem[] {
  return pagesWithOwners(workId, data)
    .filter(p => p.owner === null || p.owner === 'unknown')
    .map(p => p.item);
}

/** Vaikimisi valik: esimene piltidega eksemplar → alus → PAGES_KEY (kui lehti on) → esimene eksemplar → null. */
export function defaultSelection(data: WorkExemplarsResponse): string | null {
  const ordered = orderExemplars(data.exemplars);
  const withImages = ordered.find(x => (data.images?.[x.id]?.count ?? 0) > 0);
  if (withImages) return withImages.id;
  const witness = ordered.find(x => x.text_witness);
  if (witness) return witness.id;
  if (data.page_count > 0) return PAGES_KEY;
  return ordered[0]?.id ?? null;
}

/** Lukus samm: mõlemad +delta; kui kumbki läheks piirist välja, ei liigu kumbki. */
export function stepLocked(l: number, r: number, delta: 1 | -1, lenL: number, lenR: number): [number, number] {
  const nl = l + delta;
  const nr = r + delta;
  if (nl < 0 || nr < 0 || nl >= lenL || nr >= lenR) return [l, r];
  return [nl, nr];
}

const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)dspace\.ut\.ee$/, 'ADA'],
  [/(^|\.)ester\.ee$/, 'ESTER'],
  [/(^|\.)alvin-portal\.org$/, 'Alvin'],
  [/(^|\.)digar\.ee$/, 'DIGAR'],
  [/(^|\.)libris\.kb\.se$/, 'Libris'],
];

/** ADA (hdl.handle.net/10062/, dspace.ut.ee) | ESTER | Alvin | DIGAR | Libris | host; vigane URL → 'link'. */
export function externalLinkLabel(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'link';
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'hdl.handle.net' && u.pathname.startsWith('/10062/')) return 'ADA';
  for (const [re, label] of KNOWN_HOSTS) if (re.test(host)) return label;
  return host || 'link';
}

const CITATION_SOURCES = new Set(['ester', 'jaanson', 'ada']);

/** Avalikule lugejale nähtav allikas: ester | jaanson | ada. */
export function isCitationSource(kind?: string): boolean {
  return !!kind && CITATION_SOURCES.has(kind);
}

/** Valitud võtme pildimaterjal: teose lehed (vaatamiseks) ja eksemplari oma pildid. */
export interface MaterialParts { pages: Sequence; images: Sequence | null }

/** Eksemplari lehe jaotis (spets „Pildimaterjal: üks reegel"):
 *  PAGES_KEY → kõik lehed peale erandlehtede; eksemplar → tema teose lehed + oma pildid. */
export function materialParts(workId: string, data: WorkExemplarsResponse, selected: string,
  images: ExemplarImage[] | null): MaterialParts {
  const items = selected === PAGES_KEY ? unassignedPages(workId, data) : ownPages(workId, data, selected);
  return {
    pages: { key: PAGES_KEY, kind: 'pages', items },
    images: selected !== PAGES_KEY && images ? imagesSequence(workId, selected, images, data.page_numbers) : null,
  };
}
