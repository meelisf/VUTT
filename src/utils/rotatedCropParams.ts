// Pööratud crop-kasti → serveri (angle, telg-joondatud crop) teisendus.
//
// Põhimõte: kasti θ võrra (CSS, + = päripäeva) pööramine püstise pildi peal on
// matemaatiliselt sama, mis pilti -θ pöörata ja võtta telg-joondatud kärbe. Nii
// taaskasutab see OLEMASOLEVAT serveri lepingut transform_page_image(angle, crop) —
// backend ei muutu. Reprodutseerib täpselt CSS-pööratud eelvaate kärpe-koordinaadid.

import { degToRad, expandedBoundingBox } from './imageTransformGeometry';

export interface RotatedCropBox {
  cx: number;   // kasti kese, püstise pildi display-pikslites
  cy: number;
  w: number;    // kasti mõõtmed display-pikslites (kasti lokaal)
  h: number;
  angleDeg: number;  // kasti kalle (CSS, + = päripäeva)
}

export interface ServerCropParams {
  angle: number;  // CSS-kraadid serverile (server teeb img.rotate(-angle, expand))
  crop: { x: number; y: number; w: number; h: number };  // normaliseeritud pööratud-pildi raamis
}

/** Teisendab pööratud crop-kasti serveri parameetriteks. displayW/H = püstise pildi
 *  kuvatud mõõtmed (display-pikslid); tulemus on resolutsioonist sõltumatu (normaliseeritud). */
export function rotatedCropToServerParams(
  box: RotatedCropBox,
  displayW: number,
  displayH: number,
): ServerCropParams {
  // Et kast muutuks telg-joondatuks, tuleb pilti (ja kasti) pöörata -angleDeg võrra.
  const sendAngle = -box.angleDeg;
  const exp = expandedBoundingBox(displayW, displayH, sendAngle);

  // Kasti kese nihe pildi keskpunktist (püstine raam)
  const ox = box.cx - displayW / 2;
  const oy = box.cy - displayH / 2;

  // CSS päripäeva pööre R_cw(sendAngle) (ekraani y-alla): [cos -sin; sin cos]
  const r = degToRad(sendAngle);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const px = exp.width / 2 + (cos * ox - sin * oy);
  const py = exp.height / 2 + (sin * ox + cos * oy);

  return {
    angle: sendAngle,
    crop: {
      x: (px - box.w / 2) / exp.width,
      y: (py - box.h / 2) / exp.height,
      w: box.w / exp.width,
      h: box.h / exp.height,
    },
  };
}

/**
 * Pöördteisendus: serveri (angle, telg-joondatud crop) → pööratud kast display-pikslites.
 * Ootel kärbe taastatakse lehele tagasi tulles MUUDETAVA kastina (ADR 0085: ekraanil
 * olev kast = ootel kärbe). `angle` on serveri nurk (CSS-kraadid, võib olla [0, 360)).
 */
export function serverParamsToRotatedCrop(
  params: ServerCropParams,
  displayW: number,
  displayH: number,
): RotatedCropBox {
  // Kasti kalle on serveri nurga vastand; normaliseeri vahemikku (-180, 180].
  const norm = ((params.angle % 360) + 360) % 360;
  const sendAngle = norm > 180 ? norm - 360 : norm;
  const exp = expandedBoundingBox(displayW, displayH, sendAngle);
  const w = params.crop.w * exp.width;
  const h = params.crop.h * exp.height;
  const dx = params.crop.x * exp.width + w / 2 - exp.width / 2;
  const dy = params.crop.y * exp.height + h / 2 - exp.height / 2;
  // Pöördpööre R_cw(sendAngle)^-1 = R_cw(-sendAngle).
  const r = degToRad(sendAngle);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    cx: displayW / 2 + (cos * dx + sin * dy),
    cy: displayH / 2 + (-sin * dx + cos * dy),
    w,
    h,
    angleDeg: sendAngle === 0 ? 0 : -sendAngle,
  };
}
