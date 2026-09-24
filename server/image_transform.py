"""Lehepildi teisendus: kalle, kärbe, perspektiiv. Puhas — ei tea failidest.

Üks tee kahele kutsujale (#431):
  - teose haldus (`admin_page_ops.transform_page_image`) — kohe, pildifailile;
  - upload'i prepress (`prepress_apply` + eelvaade) — plaani `adjust` väljast.

Mõlemad annavad sama parameetrite komplekti `{angle, crop, quad}`, mille
klient arvutab `rotatedCropToServerParams`-iga. Koordinaadid on normaliseeritud
(0..1), seega 100 DPI eelvaade ja 300 DPI väljund annavad sama lõike.
"""
import math
from typing import Optional

ANGLE_EPS = 1e-4   # alla selle nurka käsitleme nullina (float-müra slidersist)
MIN_CROP_PX = 8    # minimaalne kärpe-mõõde pärast klampimist
QUAD_MIN_EDGE = 0.02   # minimaalne quad serva pikkus (normaliseeritud)
QUAD_MIN_OUT_PX = 8    # minimaalne perspektiivi väljundmõõt pikslites
MAX_ANGLE = 360.0      # kalle on vabas vahemikus, aga mitte suvaline arv


def dist(a, b) -> float:
    """Eukleidiline kaugus kahe (x,y) punkti vahel."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def validate_quad(quad):
    """Valideerib perspektiivi nelinurga ja tagastab 4 (x,y) tuple'it [0..1].

    Nõuded: täpselt 4 punkti; lõplikud arvud; [0,1]; iga serv ≥ QUAD_MIN_EDGE;
    kumer (mitte bow-tie/concave). Raise ValueError igal rikkumisel.
    """
    if not isinstance(quad, (list, tuple)) or len(quad) != 4:
        raise ValueError("quad peab olema täpselt 4 punkti")
    pts = []
    for p in quad:
        if isinstance(p, dict):
            x, y = p.get("x"), p.get("y")
        elif isinstance(p, (list, tuple)) and len(p) == 2:
            x, y = p
        else:
            raise ValueError("quad punkt peab olema {x,y} või [x,y]")
        x, y = float(x), float(y)
        if not (math.isfinite(x) and math.isfinite(y)):
            raise ValueError("quad punkt peab olema lõplik arv")
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise ValueError("quad punkt peab olema vahemikus [0,1]")
        pts.append((x, y))
    # Serva pikkused
    for i in range(4):
        if dist(pts[i], pts[(i + 1) % 4]) < QUAD_MIN_EDGE:
            raise ValueError("quad serv on liiga lühike")
    # Kumerus: kõigi ristkorrutiste märk peab olema järjepidev
    sign = 0
    for i in range(4):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % 4]
        cx, cy = pts[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        if abs(cross) < 1e-9:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            raise ValueError("quad peab olema kumer (mitte bow-tie)")
    return pts


def compute_crop_box(crop, w: int, h: int):
    """Teisendab normaliseeritud kärpe (0–1) klampitud pikslikastiks (left,top,right,bottom).

    Tagastab None kui crop puudub. Raise ValueError kui pärast klampimist liiga väike.
    """
    if crop is None:
        return None
    for k in ("x", "y", "w", "h"):
        if k not in crop:
            raise ValueError(f"crop väli '{k}' puudub")
        if not (0.0 <= float(crop[k]) <= 1.0):
            raise ValueError(f"crop '{k}' peab olema vahemikus [0,1]")
    if float(crop["w"]) <= 0 or float(crop["h"]) <= 0:
        raise ValueError("crop w,h peavad olema > 0")

    left = max(0, min(w, int(round(float(crop["x"]) * w))))
    top = max(0, min(h, int(round(float(crop["y"]) * h))))
    right = max(0, min(w, int(round((float(crop["x"]) + float(crop["w"])) * w))))
    bottom = max(0, min(h, int(round((float(crop["y"]) + float(crop["h"])) * h))))

    if (right - left) < MIN_CROP_PX or (bottom - top) < MIN_CROP_PX:
        raise ValueError("kärbe on pärast klampimist liiga väike")
    return (left, top, right, bottom)


def apply_transform(img, angle: float = 0.0, crop=None, quad_pts=None):
    """Rakendab PIL-pildile kalde, siis kärpe VÕI perspektiivi. Tagastab uue pildi.

    `angle` on CSS-i suunas (+ = päripäeva); PIL pöörab vastupäeva → `-angle`.
    `quad_pts` on juba valideeritud (`validate_quad`) ja pööratud raamis.
    Täide on valge — tühjad nurgad ei tohi OCR-ile musta prahti anda.
    """
    from PIL import Image as PILImage

    fill = (255, 255, 255) if img.mode == 'RGB' else 255
    if abs(angle) >= ANGLE_EPS:
        img = img.rotate(-angle, expand=True, fillcolor=fill)
    if quad_pts is not None:
        # Perspektiivi sirgestus: quad ([0..1] rotated-raamis) → ristkülik
        W, H = img.width, img.height
        pxs = [(x * W, y * H) for (x, y) in quad_pts]
        TL, TR, BR, BL = pxs
        out_w = round((dist(TL, TR) + dist(BL, BR)) / 2)
        out_h = round((dist(TL, BL) + dist(TR, BR)) / 2)
        if out_w < QUAD_MIN_OUT_PX or out_h < QUAD_MIN_OUT_PX:
            raise ValueError("quad väljund on liiga väike")
        # Image.QUAD data: UL, LL, LR, UR (Pillow konventsioon)
        data = [TL[0], TL[1], BL[0], BL[1], BR[0], BR[1], TR[0], TR[1]]
        img = img.transform((out_w, out_h), PILImage.QUAD, data,
                            resample=PILImage.BICUBIC, fillcolor=fill)
    else:
        box = compute_crop_box(crop, img.width, img.height)
        if box is not None:
            img = img.crop(box)
    return img


def normalize_adjust(adjust) -> Optional[dict]:
    """Valideerib ja normaliseerib upload'i plaani `adjust` välja.

    Kuju: {"angle": float, "crop": {x,y,w,h} | None, "quad": [[x,y]×4] | None}.
    Tagastab None, kui teisendust ei ole (tühi / nullnurk ilma kärpeta) —
    plaan ei tohi kanda tühja kesta, mis teeks lehe baitkoopia võimatuks.
    Raise ValueError vigase sisendi korral.
    """
    if adjust is None:
        return None
    if not isinstance(adjust, dict):
        raise ValueError("adjust peab olema objekt")
    try:
        angle = float(adjust.get("angle", 0.0) or 0.0)
    except (TypeError, ValueError):
        raise ValueError("adjust.angle peab olema arv")
    if not math.isfinite(angle) or abs(angle) > MAX_ANGLE:
        raise ValueError("adjust.angle on väljaspool lubatud vahemikku")

    crop = adjust.get("crop")
    quad = adjust.get("quad")
    if crop is not None and quad is not None:
        raise ValueError("quad ja crop ei saa olla korraga")

    clean_crop = None
    if crop is not None:
        if not isinstance(crop, dict):
            raise ValueError("adjust.crop peab olema objekt")
        clean_crop = {}
        for k in ("x", "y", "w", "h"):
            try:
                v = float(crop[k])
            except (KeyError, TypeError, ValueError):
                raise ValueError(f"adjust.crop.{k} puudub või pole arv")
            if not (math.isfinite(v) and 0.0 <= v <= 1.0):
                raise ValueError(f"adjust.crop.{k} peab olema vahemikus [0,1]")
            clean_crop[k] = v
        if clean_crop["w"] <= 0 or clean_crop["h"] <= 0:
            raise ValueError("adjust.crop w,h peavad olema > 0")

    clean_quad = None
    if quad is not None:
        clean_quad = [[x, y] for (x, y) in validate_quad(quad)]

    if abs(angle) < ANGLE_EPS and clean_crop is None and clean_quad is None:
        return None
    return {"angle": angle, "crop": clean_crop, "quad": clean_quad}


def rgb_or_gray(img):
    """JPEG-iks sobiv režiim: hall jääb halliks (väiksem fail), muu → RGB."""
    return img if img.mode in ("RGB", "L") else img.convert("RGB")


def apply_adjust(img, adjust: Optional[dict]):
    """`normalize_adjust`-i kujuga teisendus PIL-pildile. None → sama pilt."""
    if not adjust:
        return img
    quad = adjust.get("quad")
    return apply_transform(
        img,
        angle=float(adjust.get("angle") or 0.0),
        crop=adjust.get("crop"),
        quad_pts=[tuple(p) for p in quad] if quad else None,
    )
