"""Prepress-plaani puhas loogika: poolituse geomeetria ja plaani tõlgendus.

Siin EI ole failioperatsioone ega renderdust — kõik funktsioonid on puhtad ja
testitavad ilma PDF-ita. Renderdus elab prepress.py-s, pikslite hankimine
page_source.py-s.

Plaani kuju (state.json → "prepress"):

    {
      "enabled": False,
      "default_split_x": 0.5,
      "preview_status": "idle",     # idle | rendering | ready | error
      "preview_done": 0,
      "pages": [
        {"n": 1, "mode": "default", "split_x": None, "excluded": False}
      ]
    }

mode: "default" = kasuta globaalset joont, "custom" = oma joon,
"nosplit" = ära poolita.
"""
from typing import List, Optional, Tuple


def default_plan(page_count: int) -> dict:
    """Uue uploadi vaikeplaan. enabled=False — poolitamine on destruktiivne
    teisendus ja seda ei tohi saada kogemata 'Edasi' vajutusega."""
    return {
        "enabled": False,
        "default_split_x": 0.5,
        "preview_status": "idle",
        "preview_done": 0,
        "pages": [
            {"n": n, "mode": "default", "split_x": None, "excluded": False}
            for n in range(1, page_count + 1)
        ],
    }


def _page_entry(plan: Optional[dict], n: int) -> Optional[dict]:
    if not plan:
        return None
    for entry in plan.get("pages", []):
        if entry.get("n") == n:
            return entry
    return None


def effective_split_x(plan: Optional[dict], n: int) -> Optional[float]:
    """Kas ja kus leht n poolitatakse. None = ei poolitata.

    enabled=False → alati None, sõltumata mode väärtusest. custom väärtused
    jäävad plaani alles inertsena, et lüliti välja-sisse lülitamine ei
    kustutaks admini tehtud tööd.
    """
    if not plan or not plan.get("enabled"):
        return None
    entry = _page_entry(plan, n)
    if entry is None:
        return None
    mode = entry.get("mode", "default")
    if mode == "nosplit":
        return None
    if mode == "custom":
        x = entry.get("split_x")
        return float(x) if x is not None else None
    return float(plan.get("default_split_x", 0.5))


def is_excluded(plan: Optional[dict], n: int) -> bool:
    """Kas leht on OCR-ist välja jäetud."""
    entry = _page_entry(plan, n)
    return bool(entry and entry.get("excluded"))


def is_trivial_plan(plan: Optional[dict]) -> bool:
    """Kas plaan taandub tänasele PDF-teele (ükski leht ei poolitu).

    Väljajätmised EI mõjuta triviaalsust: ainult-väljajätmise plaan on
    triviaalne ja originaalfail saadetakse muutmata edasi. Põhjus mõõdetud
    spetsis — PDF-i ümberehitus maksab ~36 s ja ~800 MB, kallim kui eelvaade.
    """
    if not plan or not plan.get("enabled"):
        return True
    return all(
        effective_split_x(plan, entry.get("n")) is None
        for entry in plan.get("pages", [])
    )


def page_cuts(plan: Optional[dict], n: int, width: int) -> List[Tuple[int, int]]:
    """Ühe lähtelehe väljundlõiked [(x0, x1), ...] järjekorras vasak → parem.

    Invariandid:
      - cut_px = round(width * split_x)
      - vasak [0, cut_px), parem [cut_px, width)
      - ükski piksliveerg ei kao ega dubleeru: summa == width
      - mõlemad pooled jäävad vähemalt 1 px laiuseks
      - väljajäetud leht annab tühja listi

    `width` on RENDERDATUD lehe laius, mitte PDF-i MediaBox. pdftoppm on
    /Rotate ja CropBox juba rakendanud; x_frac käib renderdatud
    orientatsioonile. Iga leht arvutab oma cut_px oma laiusest — skaneeringute
    laius kõigub päriselt.
    """
    if is_excluded(plan, n):
        return []
    x = effective_split_x(plan, n)
    if x is None:
        return [(0, width)]
    cut = int(round(width * x))
    cut = max(1, min(width - 1, cut))
    return [(0, cut), (cut, width)]


def plan_to_sequence(plan: Optional[dict], page_widths: List[int]) -> List[dict]:
    """Kogu väljundjärjend. page_widths[i] = lehe (i+1) renderdatud laius.

    Tagastab kirjed {"src_page", "x0", "x1", "out_index"}, kus out_index on
    1-põhine lõplik lehenumber. apply_and_transfer voogedastab lehthaaval ja
    kasutab page_cuts'i otse; see funktsioon on tervikvaate ja testide jaoks.
    """
    out: List[dict] = []
    for src_page, width in enumerate(page_widths, start=1):
        for (x0, x1) in page_cuts(plan, src_page, width):
            out.append({
                "src_page": src_page,
                "x0": x0,
                "x1": x1,
                "out_index": len(out) + 1,
            })
    return out


def output_page_count(plan: Optional[dict], page_count: int) -> int:
    """Mitu lehte OCR-i läheb. Ei sõltu laiustest — UI kokkuvõtte jaoks."""
    total = 0
    for n in range(1, page_count + 1):
        if is_excluded(plan, n):
            continue
        total += 2 if effective_split_x(plan, n) is not None else 1
    return total
