"""Päringud library.db vastu.

Kaks reeglit, mis on kergesti valesti tehtavad:
1. Kasutaja päring EI LÄHE kunagi toorelt FTS5 MATCH-i — jutumärgid, sulud,
   koolonid ja * on FTS-süntaks.
2. Katke ehitatakse TOORESEST `pages.text`-ist, mitte normaliseeritud
   otsingutekstist — kasutaja peab nägema seda, mis raamatus tegelikult on.
"""
import json
import re
import sqlite3
from dataclasses import dataclass

FRAAS = re.compile(r'"([^"]+)"')
TOKEN = re.compile(r"[\wÀ-ɏ]+", re.UNICODE)


@dataclass(frozen=True)
class DocRow:
    doc_id: str
    title: str
    creators: list
    year: str | None
    page_count: int
    page_mapping_source: str | None
    file_missing: bool
    page_mapping_confidence: float = 0.0


@dataclass(frozen=True)
class Hit:
    doc_id: str
    pdf_page: int
    printed_page: str | None
    excerpt: str
    doc: DocRow


def tokenize(query: str) -> list[str]:
    """Fraasid jutumärkides jäävad terveks, ülejäänu tükeldatakse sõnadeks."""
    tokenid, jaak = [], query
    for fraas in FRAAS.findall(query):
        if fraas.strip():
            tokenid.append(fraas.strip())
        jaak = jaak.replace(f'"{fraas}"', " ")
    tokenid.extend(TOKEN.findall(jaak))
    return [t for t in tokenid if t]


# Prefiksotsing viib selle tööriista semantika kokku lubadusega, mille serveri
# instruktsioon mudelile juba annab („orati" leiab „orationem"). Ilma selleta
# jäi saksa käänatud vorm („Morgensterns") oma tüvest mööda.
MIN_PREFIX = 3


def _fts_token(token: str) -> str:
    """Tsiteeritud token, lõpus prefiksitäht. Kaks erandit jäävad täpseks:
    lühike sõna („de*" sobiks pea kõigega ja upuks bm25 järjestuse ära) ja
    jutumärkides fraas — see on kasutaja ainus viis täpsust nõuda."""
    tsiteeritud = '"' + token.replace('"', '""') + '"'
    if " " in token or len(token) < MIN_PREFIX:
        return tsiteeritud
    return tsiteeritud + "*"


def build_match(query: str, relax: bool) -> str:
    """Kontrollitud FTS5-avaldis. Iga token tsiteeritakse — nii ei saa kasutaja
    sisend kunagi süntaksiks muutuda."""
    tokenid = tokenize(query)
    if not tokenid:
        raise ValueError("päring on tühi")
    return (" OR " if relax else " AND ").join(_fts_token(t) for t in tokenid)


def _doc_row(rida: sqlite3.Row) -> DocRow:
    return DocRow(
        doc_id=rida["doc_id"], title=rida["title"],
        creators=json.loads(rida["creators_json"] or "[]"),
        year=rida["year"], page_count=rida["page_count"] or 0,
        page_mapping_source=rida["page_mapping_source"],
        file_missing=bool(rida["file_missing"]),
        page_mapping_confidence=rida["page_mapping_confidence"] or 0.0,
    )


def list_documents(conn: sqlite3.Connection) -> list:
    return [_doc_row(r) for r in conn.execute(
        "SELECT * FROM documents ORDER BY year, title")]


def make_excerpt(text: str, tokens: list, width: int = 240) -> str:
    """Katke toorest tekstist. Otsib tokenit tolerantselt, et reavahetusega
    poolitatud sõna („disputa-\\ntio") ka originaalist üles leitaks."""
    for token in tokens:
        muster = r"[-­]?\s*".join(re.escape(t) for t in token)
        leid = re.search(muster, text, re.IGNORECASE)
        if leid:
            algus = max(0, leid.start() - width // 2)
            lopp = min(len(text), leid.end() + width // 2)
            katke = text[algus:lopp].strip()
            return ("…" if algus > 0 else "") + katke + ("…" if lopp < len(text) else "")
    return text[:width].strip() + ("…" if len(text) > width else "")


VAIKE_LIMIT = 10
MAX_LIMIT = 50


def search(conn: sqlite3.Connection, query: str, *, doc_id: str | None = None,
           relax: bool = False, limit: int = 10) -> list:
    # `limit` tuleb mudelilt: negatiivne tähendaks SQLite'is „piiranguta"
    # (terve korpus vastusesse), 0 aga „ei leidnud ühtki vastet" — vale vastus,
    # mitte tühi. Mõttetu väärtus taandub VAIKEväärtusele, mitte ühele reale:
    # ka „1 vaste" oleks alaraporteerimine. Klammerdus on siin, et kõik
    # kutsujad oleksid kaetud.
    limit = int(limit)
    limit = VAIKE_LIMIT if limit < 1 else min(limit, MAX_LIMIT)
    match = build_match(query, relax)
    tokenid = tokenize(query)
    parameetrid = [match]
    filter_sql = ""
    if doc_id:
        filter_sql = " AND f.doc_id = ?"
        parameetrid.append(doc_id)
    parameetrid.append(limit)

    read = conn.execute(
        f"""SELECT f.doc_id, f.pdf_page, p.printed_page, p.text, d.*
              FROM pages_fts f
              JOIN pages p ON p.doc_id = f.doc_id AND p.pdf_page = f.pdf_page
              JOIN documents d ON d.doc_id = f.doc_id
             WHERE pages_fts MATCH ?{filter_sql}
             ORDER BY bm25(pages_fts)
             LIMIT ?""",
        parameetrid,
    ).fetchall()

    return [
        Hit(doc_id=r["doc_id"], pdf_page=r["pdf_page"],
            printed_page=r["printed_page"],
            excerpt=make_excerpt(r["text"], tokenid), doc=_doc_row(r))
        for r in read
    ]


class PageRefError(Exception):
    """Lehevahemikku ei saa üheselt lahendada."""


@dataclass(frozen=True)
class PageRow:
    pdf_page: int
    printed_page: str | None
    text: str


def _sildid(conn: sqlite3.Connection, doc_id: str) -> list:
    return [r["printed_page"] for r in conn.execute(
        "SELECT printed_page FROM pages WHERE doc_id = ? ORDER BY pdf_page",
        (doc_id,))]


def resolve_page_range(conn: sqlite3.Connection, doc_id: str, from_page: str,
                       to_page: str, page_ref: str) -> tuple:
    """Sisendvahemik → (pdf_from, pdf_to).

    `printed` on TEKST-silt, seega vahemikku EI SAA võtta võrdlusoperaatoriga:
    algusest võetakse väikseim ja lõpust suurim vastav pdf_page. Tundmatu silt
    KUKUB — lähimat lehte ei valita vaikselt.
    """
    if page_ref not in ("printed", "pdf"):
        raise PageRefError("page_ref peab olema 'printed' või 'pdf'")

    if page_ref == "pdf":
        try:
            algus, lopp = int(from_page), int(to_page)
        except ValueError as e:
            raise PageRefError("PDF-numeratsioonis peab sisend olema täisarv") from e
        olemas = conn.execute(
            "SELECT MIN(pdf_page), MAX(pdf_page) FROM pages WHERE doc_id = ?",
            (doc_id,)).fetchone()
        if olemas[0] is None:
            raise PageRefError(f"dokumendil {doc_id} ei ole indekseeritud lehti")
        if algus < olemas[0] or lopp > olemas[1]:
            raise PageRefError(
                f"PDF-vahemik {algus}–{lopp} on väljaspool dokumenti "
                f"(olemas {olemas[0]}–{olemas[1]})")
        if algus > lopp:
            raise PageRefError(
                f"vahemiku algus {algus} on lõpust {lopp} tagapool")
        return algus, lopp

    def leia(silt: str, funktsioon: str) -> int | None:
        rida = conn.execute(
            f"SELECT {funktsioon}(pdf_page) FROM pages "
            "WHERE doc_id = ? AND printed_page = ?", (doc_id, str(silt))).fetchone()
        return rida[0]

    algus, lopp = leia(from_page, "MIN"), leia(to_page, "MAX")
    puuduvad = [s for s, v in ((from_page, algus), (to_page, lopp)) if v is None]
    if puuduvad:
        koik = [s for s in _sildid(conn, doc_id) if s]
        naide = ", ".join(koik[:5] + (["…"] if len(koik) > 5 else []))
        raise PageRefError(
            f"trükitud lehekülge {', '.join(map(str, puuduvad))} ei ole "
            f"dokumendis {doc_id}. Olemasolevad sildid algavad: {naide or '(puuduvad)'}. "
            "Kasuta page_ref='pdf', kui trükitud numeratsioon on teadmata."
        )
    if algus > lopp:
        raise PageRefError(f"vahemiku algus {from_page} on lõpust {to_page} tagapool")
    return algus, lopp


def fetch_pages(conn: sqlite3.Connection, doc_id: str, pdf_from: int, pdf_to: int,
                *, max_pages: int = 20, max_chars: int = 60000) -> tuple:
    """Leheküljed vahemikus. Kaks lage: lehtede arv JA märgimaht."""
    read = conn.execute(
        "SELECT pdf_page, printed_page, text FROM pages "
        "WHERE doc_id = ? AND pdf_page BETWEEN ? AND ? ORDER BY pdf_page",
        (doc_id, pdf_from, pdf_to)).fetchall()

    tulem, margid, karbitud = [], 0, False
    for r in read:
        if len(tulem) >= max_pages:
            karbitud = True
            break
        if tulem and margid + len(r["text"]) > max_chars:
            karbitud = True
            break
        tulem.append(PageRow(r["pdf_page"], r["printed_page"], r["text"]))
        margid += len(r["text"])
    if len(read) > len(tulem):
        karbitud = True
    return tulem, karbitud


# ─── Tühja tulemuse diagnostika ──────────────────────────────────────────────
# Staatiline nõuanne („proovi relax_matching=true") ei aita mudelit, kes selle
# juba rakendas. Mõõdetud fakt aitab: kus sõna esineb ja millisel kujul.

# Fraktuuri pikk ſ loetakse OCR-is f-iks („Abschrift" → „Abfchrift"). Sõna
# lõpus on ümar s — seda ei puutu.
_SISEMINE_S = re.compile(r"s(?=[^\W\d_])", re.UNICODE)

MAX_DIAG_TOKENS = 4      # diagnostika ei tohi ise päringut kalliks teha
MAX_LYHEND = 3           # mitu tähte lõpust maha võib võtta
# Lühendatud tüvi peab jääma sõnaks: „quux" → „quu" leiaks „quum" ja saadaks
# mudeli valele jäljele. Variandid (Fraktur, ß) on sama pikad, neile ei kehti.
MIN_LYHEND_PIKKUS = 5


@dataclass(frozen=True)
class TokenDiag:
    token: str
    in_doc: int | None       # None = doc_id filtrit ei olnud
    in_corpus: int
    soovitus: str | None = None      # mõõdetud alternatiiv, mitte oletus
    soovitus_vasteid: int = 0
    soovitus_pohjus: str = ""        # "fraktur" | "ss" | "lyhend"


def _kandidaadid(token: str) -> list:
    """(sõna, põhjus) paarid, mida tasub MÕÕTA. Järjekord = usaldusväärsus."""
    read, nahtud = [], {token.lower()}

    def lisa(sona: str, pohjus: str) -> None:
        if sona and sona.lower() not in nahtud and len(sona) >= MIN_PREFIX:
            nahtud.add(sona.lower())
            read.append((sona, pohjus))

    fraktur = _SISEMINE_S.sub("f", token)
    lisa(fraktur, "fraktur")
    if "ß" in token:
        lisa(token.replace("ß", "ss"), "ss")
    if "ss" in token.lower():
        lisa(re.sub("ss", "ß", token, flags=re.IGNORECASE), "ss")
    # Käänatud vorm ei ole oma tüve prefiks („Morgensterns" ↛ „Morgenstern"),
    # seega prefiksotsing üksi ei päästa — lühenda tüve poole.
    for alus in (token, fraktur):
        for pikkus in range(1, MAX_LYHEND + 1):
            kandidaat = alus[:-pikkus]
            if len(kandidaat) >= MIN_LYHEND_PIKKUS:
                lisa(kandidaat, "lyhend")
    return read


def _loenda(conn: sqlite3.Connection, sona: str, doc_id) -> int:
    sql = "SELECT count(*) FROM pages_fts WHERE pages_fts MATCH ?"
    parameetrid = [_fts_token(sona)]
    if doc_id:
        sql += " AND doc_id = ?"
        parameetrid.append(doc_id)
    try:
        return conn.execute(sql, parameetrid).fetchone()[0]
    except sqlite3.OperationalError:
        return 0


def diagnose(conn: sqlite3.Connection, query: str, *, doc_id=None) -> list:
    """Tühja tulemuse põhjus tokenite kaupa. Kutsutakse AINULT siis, kui
    otsing ei andnud midagi — muidu maksaks iga otsing lisapäringuid."""
    read = []
    for token in tokenize(query)[:MAX_DIAG_TOKENS]:
        korpuses = _loenda(conn, token, None)
        dokumendis = _loenda(conn, token, doc_id) if doc_id else None
        ulatuses = dokumendis if doc_id else korpuses
        soovitus = pohjus = None
        vasteid = 0
        if not ulatuses:
            for kandidaat, kandidaadi_pohjus in _kandidaadid(token):
                n = _loenda(conn, kandidaat, doc_id)
                if n:
                    soovitus, vasteid, pohjus = kandidaat, n, kandidaadi_pohjus
                    break
        read.append(TokenDiag(
            token=token, in_doc=dokumendis, in_corpus=korpuses,
            soovitus=soovitus, soovitus_vasteid=vasteid,
            soovitus_pohjus=pohjus or ""))
    return read
