"""Leheküljekaardistus: PDF-i lehe indeks → trükise leheküljenumber.

Tõeallikas on IGA LEHE silt, mitte globaalne nihe: köide algab rooma
eessõnaga, vahel on nummerdamata tahvel, ja seos katkeb. Silt on TEKST
(xviii, A3, 225a) või None. None tähendab „teadmata" — ja teadmata numbrit
EI OLETATA.
"""
import json
import re
from dataclasses import dataclass
from pathlib import Path

MIN_JADA = 5  # nii mitu järjestikust lehte peab nihe kehtima, et teda uskuda
ROOMA = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"),
         (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
         (5, "v"), (4, "iv"), (1, "i")]


class SidecarError(Exception):
    """Käsitsi kirjutatud sidecar on vigane — vaikselt ignoreerida ei tohi."""


@dataclass(frozen=True)
class PageMapping:
    labels: list          # list[str | None], pikkus == lehtede arv
    source: str           # pagelabels | detected | sidecar | none
    confidence: float
    summary: str


def _rooma(n: int) -> str:
    tulem = []
    for vaartus, tahis in ROOMA:
        while n >= vaartus:
            tulem.append(tahis)
            n -= vaartus
    return "".join(tulem)


def _taht(n: int) -> str:
    return chr(ord("A") + (n - 1) % 26) * (1 + (n - 1) // 26)


def _kokkuvote(labels: list) -> str:
    """Inimloetav kokkuvõte, nt 'i–ii, siis 1–4; 1 nummerdamata'."""
    tukid, teadmata = [], sum(1 for x in labels if x is None)
    algus = None
    for i, silt in enumerate(labels + [None]):
        if silt is not None and algus is None:
            algus = i
        elif silt is None and algus is not None:
            tukid.append(f"{labels[algus]}–{labels[i - 1]}"
                         if i - 1 > algus else f"{labels[algus]}")
            algus = None
    osad = [", ".join(tukid)] if tukid else []
    if teadmata:
        osad.append(f"{teadmata} lk nummerdamata")
    return "; ".join(osad) or "numeratsioon teadmata"


def from_pdf_labels(pdf_path: Path, page_count: int) -> PageMapping | None:
    """PDF-i enda /PageLabels — kui olemas, autoritatiivne."""
    try:
        from pypdf import PdfReader

        lugeja = PdfReader(str(pdf_path))
        if "/PageLabels" not in lugeja.trailer["/Root"]:
            return None
        sildid = [str(x) for x in lugeja.page_labels][:page_count]
    except Exception:
        return None
    if not sildid or not _usutavad_sildid(sildid):
        return None
    return PageMapping(sildid, "pagelabels", 1.0, _kokkuvote(sildid))


def _usutavad_sildid(sildid: list) -> bool:
    """Null või negatiivne araabia silt tähendab katkist /PageLabels-puud.

    pypdf ekstrapoleerib puuduva 0-kirje korral tagasi (−4, −3, −2…) ja need
    jõuaksid muidu viitesse kujul „lk -4". Terve puu on parem tagasi lükata
    kui poolikut usaldada: tuvastus ja „teadmata" on mõlemad ausamad.
    """
    for silt in sildid:
        puhas = silt.strip()
        if re.fullmatch(r"-?\d+", puhas) and int(puhas) < 1:
            return False
    return True


def detect_from_text(pages: list) -> PageMapping | None:
    """Otsib pea- ja jalusridadelt numbrit ning püsivat seost trükitud = pdf + k.

    Nihet usutakse ainult MIN_JADA järjestikuse lehe korral — üksik juhuslik
    number lehe servas ei tohi tervet köidet valesti nummerdada.
    """
    kandidaadid = {}
    for idx, tekst in enumerate(pages):
        read = [r.strip() for r in tekst.splitlines() if r.strip()]
        for rida in read[:2] + read[-2:]:
            leid = re.fullmatch(r"(\d{1,4})", rida)
            if leid:
                kandidaadid[idx] = int(leid.group(1))
                break

    jadad, praegu = [], []
    for idx in sorted(kandidaadid):
        nihe = kandidaadid[idx] - idx
        if praegu and praegu[-1][1] == nihe and idx == praegu[-1][0] + 1:
            praegu.append((idx, nihe))
        else:
            if len(praegu) >= MIN_JADA:
                jadad.append(praegu)
            praegu = [(idx, nihe)]
    if len(praegu) >= MIN_JADA:
        jadad.append(praegu)
    if not jadad:
        return None

    sildid = [None] * len(pages)
    kaetud = 0
    for jada in jadad:
        nihe = jada[0][1]
        for idx, _ in jada:
            sildid[idx] = str(idx + nihe)
            kaetud += 1
    return PageMapping(sildid, "detected", kaetud / len(pages), _kokkuvote(sildid))


def from_sidecar(sidecar_path: Path, page_count: int) -> PageMapping | None:
    """Käsitsi ülekirjutus. Kirjeldab VAHEMIKKE, mitte üht nihet."""
    sidecar_path = Path(sidecar_path)
    if not sidecar_path.exists():
        return None
    try:
        andmed = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise SidecarError(f"{sidecar_path} ei ole loetav JSON: {e}") from e
    sildid = [None] * page_count
    for vahemik in andmed.get("ranges", []):
        try:
            algus, lopp = int(vahemik["pdf_from"]), int(vahemik["pdf_to"])
        except (KeyError, TypeError, ValueError) as e:
            raise SidecarError(
                f"{sidecar_path}: vahemikus puudub või on vigane "
                f"pdf_from/pdf_to ({vahemik!r})") from e
        if "printed" in vahemik and vahemik["printed"] is None:
            continue  # nummerdamata
        stiil = vahemik.get("style", "arabic")
        if "printed_from" not in vahemik:
            raise SidecarError(
                f"{sidecar_path}: vahemikul puudub printed_from "
                f"(nummerdamata vahemik kirjuta kujul \"printed\": null) "
                f"({vahemik!r})")
        esimene = str(vahemik["printed_from"])
        try:
            n = _rooma_arvuks(esimene) if stiil == "roman" else int(esimene)
        except (KeyError, ValueError) as e:
            raise SidecarError(
                f"{sidecar_path}: printed_from {esimene!r} ei sobi "
                f"stiiliga {stiil!r}") from e
        for offset, pdf in enumerate(range(algus, lopp + 1)):
            if 1 <= pdf <= page_count:
                vaartus = n + offset
                sildid[pdf - 1] = (
                    _rooma(vaartus) if stiil == "roman"
                    else _taht(vaartus) if stiil == "letter"
                    else str(vaartus)
                )
    return PageMapping(sildid, "sidecar", 1.0, _kokkuvote(sildid))


def _rooma_arvuks(s: str) -> int:
    vaartused = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    s, tulem, eelmine = s.lower(), 0, 0
    for taht in reversed(s):
        v = vaartused[taht]
        tulem += -v if v < eelmine else v
        eelmine = max(eelmine, v)
    return tulem


def resolve_mapping(pdf_path: Path, pages: list,
                    sidecar_path: Path | None) -> PageMapping:
    """Prioriteet: sidecar > PageLabels > tuvastus > teadmata."""
    n = len(pages)
    if sidecar_path is not None:
        m = from_sidecar(sidecar_path, n)
        if m is not None:
            return m
    m = from_pdf_labels(pdf_path, n)
    if m is not None:
        return m
    m = detect_from_text(pages)
    if m is not None:
        return m
    return PageMapping([None] * n, "none", 0.0, "numeratsioon teadmata")
