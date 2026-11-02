#!/usr/bin/env python3
"""Jaansoni bibliograafia leidumus → eksemplaride plaan (KOHALIK samm; ADR 0076 §9).

Jaanson, E. jt 2000. *Tartu Ülikooli trükikoda 1632–1710.* Kirje lõpus on vasakul
leidumus (hoidjate lühendid), paremal TÜR-i kohaviit (lk 166). `R Acad. Dorp. …` on
TÜR-i paberkoopiate kollektsioon; muu kohaviit on TÜR-i originaal.

Tekst on ainult kohalikus kirjandusindeksis (`~/.local/share/vutt-library/library.db`),
seepärast käib see samm lokaalselt tootmise `_metadata.json`-ide koopia vastu ja kirjutab
plaanifaili. Serveris rakendab plaani `scripts/jaanson_apply.py`.

  ssh vutt 'cd ~/VUTT/data && tar cf - */_metadata.json config/archives.json' | tar xf - -C /koopia
  .venv/bin/python scripts/jaanson_plan.py --data-dir /koopia --out jaanson_plan.json

Plaanis on ainult KINDLAD sobitused. Mitmetähenduslik, vasteta ja kõik leidumuse kujud,
mida ei looda, lähevad plaani `review` loendisse (ja `--review-tsv` faili).
"""
from __future__ import annotations

import argparse
import collections
import difflib
import json
import os
import re
import sqlite3
import sys
import unicodedata
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DOC_ID = "U9GJPKM8"
BIB_PDF_PAGES = (173, 426)          # bibliograafia kirjed 1–1389 (PDF-i lehed)
SURE_SCORE = 0.85
SURE_MARGIN = 0.05
MIN_SCORE = 0.5
TUR = "Tartu TÜR"
COPY_PREFIX = "R Acad. Dorp."

# ── Parser ───────────────────────────────────────────────────────────────────

_CITIES = ("Aurich|Berlin|Dresden|Göteborg|Goteborg|Gotha|Göttingen|Góttingen|Gottingen|Greifswald|Halle|"
           "Helsinki|Jena|Kalmar|Karlstad|København|Kobenhavn|Kebenhavn|Kgbenhavn|Kpbenhavn|Kõbenhavn|"
           "Kübenhavn|Linköping|Linkóping|Linkoping|London|Lund|Östersund|Ostersund|Petersburg|Peterburi|"
           "Riga|Rostock|Skara|Stockholm|Tallinn|Tallınn|Tartu|Uppsala|Vilnius|Västerås|Västeräs|Vásterás|"
           "Vasteras|Växjö|Váxjó|Vàxjó|Vaxjo|Weimar|Wien|Wolfenbüttel|Wolfenbuttel")
# Leidumuse rida: linn + lühend (`Stockholm KB`, `Halle/Saale FSt`) või linn + sulud.
# „Riga, wie auch …" (pealkirja jätk) EI ole leidumus.
HOLD_START = re.compile(rf"^\s{{0,3}}(\d\. Aufl\.:\s*)?({_CITIES})\s?"
                        r"(([A-ZÜÄÖ][A-Za-zÜÄÖ/]{0,5}|[A-Z]{2,6})\b|\s*\()")
ENTRY = re.compile(r"^\s{0,6}(\d{1,4}\]?)[\.,]\s+(\*?)\s*(.*\S)\s*$")
FIELD = re.compile(r"^\s+(Ded\.|Grat\.|Typogr\.|Lit\.|Inhalt|Abdr\.|Abschr\.|Neudr\.|Vorw\.|Enc\.|Par\.|"
                   r"Handschr\.)")
# Parem veerg: TÜR-i kohaviit; OCR kaotab mõnikord „R " ees („Acad. Dorp. 1639:29").
SHELF = re.compile(r"\s{3,}((?:R\s?[A-Z]|Acad\.\s?Dorp).*?)\s*$")
_PERSON_HEAD = re.compile(r"\[(P|R|A)|^\*?\[?[\w()\-]+(?: \([^)]*\))?, [A-Z]")


def load_text(db_path: str, doc_id: str = DOC_ID) -> list[tuple[int, str]]:
    db = sqlite3.connect(db_path)
    try:
        return db.execute("SELECT pdf_page, text FROM pages WHERE doc_id=? ORDER BY pdf_page",
                          (doc_id,)).fetchall()
    finally:
        db.close()


def parse_entries(pages: list[tuple[int, str]], first: int = 1) -> list[dict]:
    """OCR-lehed → kirjed. Kirje number peab kasvama (last+1…last+3): nii ei loe pealkirja
    sees olev „6. Novembris" uue kirje algusena. `first` = oodatav esimene number."""
    out, cur, last = [], None, first - 1
    lo, hi = BIB_PDF_PAGES
    for pdf, text in pages:
        if not lo <= pdf <= hi:
            continue
        for raw in (text or "").splitlines():
            if "BIBLIOGRAAFIA" in raw or re.fullmatch(r"\s*\d{1,3}\s*", raw):
                continue
            m = ENTRY.match(raw)
            if m and not FIELD.match(raw):
                n = last + 1 if m.group(1).endswith("]") else int(m.group(1))   # OCR: „4]." = 41
                if last < n <= last + 3:
                    if cur:
                        out.append(cur)
                    last = n
                    cur = {"nr": n, "indirect": bool(m.group(2)), "head": m.group(3), "body": [],
                           "holdings_raw": [], "shelfmark": None, "pdf": pdf, "_fields": False}
                    continue
            if cur is None:
                continue
            s = SHELF.search(raw)
            if HOLD_START.match(raw) or (s and not FIELD.match(raw) and cur["body"]):
                left = raw[:s.start()] if s else raw
                if s and not cur["shelfmark"]:
                    cur["shelfmark"] = norm_shelfmark(s.group(1))
                if left.strip():
                    cur["holdings_raw"].append(left.strip())
                continue
            if FIELD.match(raw) or (cur["_fields"] and raw.startswith("      ")):
                cur["_fields"] = True
                continue
            if raw.strip() and not cur["_fields"] and not cur["holdings_raw"]:
                cur["body"].append(raw.strip())
    if cur:
        out.append(cur)
    for e in out:
        body = " ".join(e.pop("body"))
        e.pop("_fields")
        # Isikupäisega kirjel on pealkiri kehas; pealkirjakirjel algab pealkiri päisest.
        e["title"] = body if _PERSON_HEAD.search(e["head"]) else f"{e['head']} {body}"
        years = re.findall(r"\b(1[67]\d\d)\s*:", body) or re.findall(r"\b(1[67]\d\d)\b", body)
        e["year"] = int(years[-1]) if years else None
        e["holdings"] = [h for raw in e["holdings_raw"] for h in split_holdings(raw)]
    return out


def norm_shelfmark(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return re.sub(r"^(?:R\s?)?Acad\.\s?Dorp\.\s?", COPY_PREFIX + " ", s)


def split_holdings(raw: str) -> list[dict]:
    """„Helsinki YK; Stockholm KB (def.)" → [{raw, qualifier}]. Eraldaja on `;`, OCR-is ka
    `:` või koma linna ees; „Stockholm KB, RA" = Stockholm KB + Stockholm RA."""
    raw = re.sub(r"^\d\. Aufl\.:\s*", "", raw)
    out = []
    for part in re.split(r"[;:]\s*(?=[A-ZÖÄÜ])|,\s*(?=[A-ZÖÄÜ][^\W\d_]+\s+[A-Z])", raw):
        part = part.strip(" ;,.")
        m = re.match(r"^(\w+) (\w+), ([A-Z]{2,4})$", part)
        subparts = [f"{m.group(1)} {m.group(2)}", f"{m.group(1)} {m.group(3)}"] if m else [part]
        for p in subparts:
            q = re.search(r"\(([^)]*)\)\s*(.*)$", p)
            name = p[:q.start()].strip() if q else p
            qual = " ".join(x for x in (q.group(1).strip(), q.group(2).strip()) if x) if q else None
            if name:
                out.append({"raw": name, "qualifier": qual})
    return out


# ── Hoidjad ──────────────────────────────────────────────────────────────────

def _letters(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


class HolderResolver:
    """Registri kuju → võti: `resolve_holder`, siis OCR-vigade jaoks diakriitikata
    tähekuju (täpne, siis lähim ≥ 0.82). Lahendamata kuju = None (nimekirja)."""

    def __init__(self, archives: dict):
        from server.archives_registry import resolve_holder
        self._exact = lambda s: resolve_holder(archives, s)
        self.forms = {}
        for key, entry in archives.items():
            for f in (key, *((entry or {}).get("aliases") or [])):
                self.forms.setdefault(_letters(f), key)

    def __call__(self, raw: str):
        archive_ref = None
        m = re.match(r"^(Tartu (?:EAA|ÜR|UR))\s*,\s*(.+)$", raw)     # „Tartu EAA, Best. 957, …"
        if m:
            raw, archive_ref = m.group(1), m.group(2).strip()
        key = self._exact(raw) or self.forms.get(_letters(raw))
        if not key:
            close = difflib.get_close_matches(_letters(raw), self.forms, n=1, cutoff=0.82)
            key = self.forms[close[0]] if close else None
        return key, archive_ref


def qualifier_policy(q):
    """Leidumuse sulgudes märge → (loo?, väljad | põhjus). Otsustatud 2026-11-02."""
    if not q:
        return True, {}
    ql = q.casefold()
    if "verschollen" in ql:
        return False, "kadunud eksemplar (verschollen)"
    if "früher" in ql:
        return False, f"praegune asukoht teadmata ({q})"
    if "abschr" in ql or "handschr" in ql:
        return False, f"käsikirjaline ärakiri ({q})"
    if "nur " in ql:                            # „nur def. Titelbl." — ulatus, mitte seisund
        return True, {"notes": q}
    fields = {}
    if re.search(r"\bdef\.", ql):
        fields["condition"] = "defektne" + ("?" if "def.?" in ql else "")
    if "kopie" in ql:
        # Koopia liik on struktureeritud väli (ADR 0076 §11); päritolu jääb märkuseks.
        fields["reproduction"] = {"kind": "fotokoopia" if "foto" in ql else "koopia"}
        src = re.search(r"aus (\w+)", q)
        if src:
            fields["notes"] = f"{src.group(1)}st"
    rest = re.sub(r"(?<!\w)(def\.\??|Fotokopie|Kopie(?: aus \w+)?)(?!\w)", "", q)
    rest = re.sub(r"\s*,\s*", ", ", rest).strip(" ,")
    if rest:
        fields["notes"] = f"{fields['notes']}; {rest}" if fields.get("notes") else rest
    return True, fields


def entry_exemplars(e: dict, resolve) -> tuple[list[dict], list[str]]:
    """Kirje leidumus → kavandatud eksemplarid (ilma id/allikata) + nimekirja märked."""
    planned, review, seen = [], [], set()
    shelf = e.get("shelfmark")
    tur_original = bool(shelf) and not shelf.startswith(COPY_PREFIX)
    for h in e["holdings"]:
        key, archive_ref = resolve(h["raw"])
        if not key:
            review.append(f"hoidja lahendamata: {h['raw']!r}" + (f" ({h['qualifier']})" if h["qualifier"] else ""))
            continue
        ok, fields = qualifier_policy(h["qualifier"])
        if not ok:
            review.append(f"{key}: ei looda — {fields}")
            continue
        x = {"holder": key, **fields}
        if archive_ref:
            x["shelfmark"] = archive_ref
        if key == TUR and tur_original:
            x["shelfmark"] = shelf                      # vasak „Tartu ÜR" + parem kohaviit = üks original
        sig = (x["holder"], x.get("shelfmark"))
        if sig in seen:
            continue
        seen.add(sig)
        planned.append(x)
    if shelf and shelf.startswith(COPY_PREFIX):
        if any(x["holder"] == TUR for x in planned):
            review.append("Tartu ÜR vasakul JA paberkoopia paremal — originaali kohaviit teadmata")
        planned.append({"holder": TUR, "shelfmark": shelf, "reproduction": {"kind": "paberkoopia"}})
    elif tur_original and not any(x["holder"] == TUR for x in planned):
        planned.append({"holder": TUR, "shelfmark": shelf})
    return planned, review


# ── Teoste sobitus ───────────────────────────────────────────────────────────

_ORDINALS = {"prima", "primus", "primum", "secunda", "secundus", "secundum", "tertia", "tertius",
             "quarta", "quartus", "quinta", "quintus", "sexta", "sextus", "septima", "septimus",
             "octava", "octavus", "nona", "nonus", "decima", "decimus", "undecima", "duodecima",
             "posterior", "prior", "altera", "alter"}
_ROMAN = re.compile(r"^(x{0,3})(ix|iv|v?i{0,3})$")       # I–XXXIX: sarja number, mitte aastaarv


def series_markers(s: str) -> set:
    """Sarja tunnused pealkirjas (järgarv või rooma number ≤ XXXIX) — „disputatio tertia" ja
    „disputatio quinta" on eri teosed, kuigi pealkirjad on peaaegu samad. Nurksulgudes on
    Jaansoni lisatud kuupäev ja araabia numbrid on enamasti kuupäevad — neid ei arvestata."""
    s = re.sub(r"\[[^\]]*\]", " ", (s or "").casefold())
    toks = re.findall(r"[^\W\d_]+", s)
    return {t for t in toks if t in _ORDINALS or (_ROMAN.match(t) and t not in ("", "i"))}


def norm_title(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("v", "u").replace("j", "i").replace("w", "uu")
    s = re.sub(r"\[[^\]]*\]", " ", s)
    return " ".join(re.findall(r"[a-z]{2,}", s))[:450]


def _year(meta: dict):
    y = str(meta.get("year") or "")[:4]
    return int(y) if y.isdigit() else None


def match(entries: list[dict], works: list[dict]) -> dict:
    # NB: kindel ainult siis, kui sarja tunnused kattuvad (vt series_markers).
    """Pealkirja sarnasus sama aasta (±1) piires, siis ahne üks-ühele jaotus.

    Tagastab {nr: {"work_id", "score", "second", "status"}}; status ∈ kindel |
    mitmetähenduslik | vasteta.
    """
    titles = {w["id"]: w.get("title") or "" for w in works}
    by_year = collections.defaultdict(list)
    for w in works:
        if _year(w):
            by_year[_year(w)].append((w["id"], norm_title(w.get("title"))))
    cands = {}
    for e in entries:
        t = norm_title(e["title"])
        row = []
        for y in ([e["year"], e["year"] - 1, e["year"] + 1] if e["year"] else []):
            for wid, wt in by_year.get(y, []):
                sm = difflib.SequenceMatcher(None, t, wt, autojunk=False)
                if sm.real_quick_ratio() < 0.35 or sm.quick_ratio() < 0.35:
                    continue
                row.append((sm.ratio(), wid))
        cands[e["nr"]] = sorted(row, reverse=True)
    pairs = sorted(((s, nr, wid) for nr, row in cands.items() for s, wid in row if s >= MIN_SCORE),
                   reverse=True)
    taken_nr, taken_w, out = set(), set(), {}
    for s, nr, wid in pairs:
        if nr in taken_nr or wid in taken_w:
            continue
        taken_nr.add(nr)
        taken_w.add(wid)
        # Teine kandidaat, mida ei võtnud keegi parema tulemusega — see teeb kahtlaseks.
        second = max((s2 for s2, w2 in cands[nr] if w2 != wid), default=0.0)
        e_title = next(e["title"] for e in entries if e["nr"] == nr)
        sure = (s >= SURE_SCORE and s - second >= SURE_MARGIN
                and series_markers(e_title) == series_markers(titles[wid]))
        out[nr] = {"work_id": wid, "score": round(s, 3), "second": round(second, 3),
                   "status": "kindel" if sure else "mitmetähenduslik"}
    for nr in cands:
        out.setdefault(nr, {"work_id": None, "score": round(cands[nr][0][0], 3) if cands[nr] else 0.0,
                            "second": 0.0, "status": "vasteta"})
    return out


# ── Põhiprogramm ─────────────────────────────────────────────────────────────

def load_registry(data_dir: str) -> dict:
    from server.archives_registry import read_archives
    archives = read_archives(os.path.join(data_dir, "config", "archives.json"))
    if TUR not in archives:
        # Ümbernimetamine (PR #725) pole koopias veel tehtud — kasuta selle tulemust.
        from scripts.rename_archive_keys import build_registry
        archives = build_registry(archives)[0]
    return archives


def build_plan(entries, works, archives) -> dict:
    by_id = {w["id"]: w for w in works}
    resolve = HolderResolver(archives)
    matches = match(entries, works)
    plan_works, review = [], []
    for e in entries:
        mt = matches[e["nr"]]
        planned, notes = entry_exemplars(e, resolve)
        if mt["status"] != "kindel":
            if planned or mt["work_id"]:
                w = by_id.get(mt["work_id"]) or {}
                review.append({"kind": mt["status"], "nr": e["nr"], "work_id": mt["work_id"],
                               "score": mt["score"], "second": mt["second"],
                               "jaanson": e["title"][:200], "vutt": (w.get("title") or "")[:200]})
            continue
        for n in notes:
            review.append({"kind": "leidumus", "nr": e["nr"], "work_id": mt["work_id"], "detail": n})
        plan_works.append({"work_id": mt["work_id"], "nr": e["nr"], "score": mt["score"],
                           "exemplars": planned})
    return {"generated": date.today().isoformat(), "source": f"Jaanson 2000 (library {DOC_ID})",
            "works": plan_works, "review": review}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library-db", default=os.path.expanduser("~/.local/share/vutt-library/library.db"))
    ap.add_argument("--data-dir", required=True, help="tootmise _metadata.json-ide koopia")
    ap.add_argument("--out", required=True, help="plaanifail (JSON)")
    ap.add_argument("--review-tsv", help="ülevaatusnimekiri tabelina")
    args = ap.parse_args()

    entries = parse_entries(load_text(args.library_db))
    works = []
    for d in sorted(os.scandir(args.data_dir), key=lambda d: d.name):
        p = os.path.join(d.path, "_metadata.json")
        if d.is_dir() and os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                works.append(json.load(f))
    plan = build_plan(entries, works, load_registry(args.data_dir))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    if args.review_tsv:
        cols = ("kind", "nr", "work_id", "score", "second", "detail", "jaanson", "vutt")
        with open(args.review_tsv, "w", encoding="utf-8") as f:
            f.write("\t".join(cols) + "\n")
            for r in plan["review"]:
                f.write("\t".join(str(r.get(c, "")).replace("\t", " ") for c in cols) + "\n")
    kinds = collections.Counter(r["kind"] for r in plan["review"])
    print(f"Kirjeid: {len(entries)}; kindlaid sobitusi: {len(plan['works'])}; "
          f"kavandatud eksemplare: {sum(len(w['exemplars']) for w in plan['works'])}")
    print(f"Nimekirja: {dict(kinds)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
