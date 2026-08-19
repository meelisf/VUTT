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


def build_match(query: str, relax: bool) -> str:
    """Kontrollitud FTS5-avaldis. Iga token tsiteeritakse — nii ei saa kasutaja
    sisend kunagi süntaksiks muutuda."""
    tokenid = tokenize(query)
    if not tokenid:
        raise ValueError("päring on tühi")
    tsiteeritud = ['"' + t.replace('"', '""') + '"' for t in tokenid]
    return (" OR " if relax else " AND ").join(tsiteeritud)


def _doc_row(rida: sqlite3.Row) -> DocRow:
    return DocRow(
        doc_id=rida["doc_id"], title=rida["title"],
        creators=json.loads(rida["creators_json"] or "[]"),
        year=rida["year"], page_count=rida["page_count"] or 0,
        page_mapping_source=rida["page_mapping_source"],
        file_missing=bool(rida["file_missing"]),
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


def search(conn: sqlite3.Connection, query: str, *, doc_id: str | None = None,
           relax: bool = False, limit: int = 10) -> list:
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
