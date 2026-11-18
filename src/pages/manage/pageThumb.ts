import type React from 'react';
import { IMAGE_BASE_URL } from '../../config';
import { workPagePreviewUrl } from '../../services/workApi';
import type { ImageToken } from '../../utils/imageTokenUrl';
import { needsServerPreview, type PendingPageOp } from './pageOpsPlan';

/**
 * Teose halduse lehe pisipilt koos ootel toimingutega — ÜKS allikas ruudustiku
 * kaardile (`PageCard`) ja pildiredaktori pisipiltide ribale (`PageFilmstrip`),
 * et mõlemad näitaksid sama pilti.
 */

/** Ootel pöörde eelvaade CSS-iga. 90°/270° juures skaleeritakse 3:4 kasti
 *  sisse (pööratud kast oleks 4:3 ja lõikuks servadest). */
export function rotateStyle(deg: number): React.CSSProperties | undefined {
  if (!deg) return undefined;
  const scale = deg === 90 || deg === 270 ? ' scale(0.75)' : '';
  return { transform: `rotate(${deg}deg)${scale}` };
}

interface ThumbArgs {
  workId: string;
  /** Pildifaili nimi (`_thumbs/_thumb_<nimi>`). */
  imageName: string;
  /** Ootel plaani võti (lehe failinimi) — serveri eelvaate URL-is. */
  filename: string;
  op: PendingPageOp | undefined;
  /** Admini pilet (`work:<id>`) serveri eelvaatele; `null` = veel teel. */
  ticket: ImageToken | null;
  /** Pildiserveri allkiri tavalisele pisipildile. */
  imageToken: { exp: number; sig: string } | null;
  cacheBust: number;
}

/**
 * Kärbet/kallet CSS ei näita → server renderdab pisipildist eelvaate (pööre sees).
 * Muidu tavaline pisipilt ja pööre CSS-iga (`imgStyle`).
 * Pilet veel teel → tavaline pisipilt, kuni eelvaate URL-i saab allkirjastada.
 */
export function manageThumb(a: ThumbArgs): { src: string; imgStyle: React.CSSProperties | undefined; serverPreview: boolean } {
  const serverPreview = needsServerPreview(a.op);
  if (serverPreview && a.ticket) {
    return {
      src: workPagePreviewUrl(a.workId, a.filename, a.ticket, a.op!.rotate, a.op!.adjust ?? null, 'thumb', a.cacheBust),
      imgStyle: undefined,
      serverPreview: true,
    };
  }
  const tokenQuery = a.imageToken ? `&exp=${a.imageToken.exp}&sig=${a.imageToken.sig}` : '';
  return {
    src: `${IMAGE_BASE_URL}/${a.workId}/_thumbs/_thumb_${a.imageName}?v=${a.cacheBust}${tokenQuery}`,
    // Serveri eelvaade pileti ootel → pööre CSS-iga, nagu varem.
    imgStyle: serverPreview ? undefined : rotateStyle(a.op?.rotate ?? 0),
    serverPreview,
  };
}
