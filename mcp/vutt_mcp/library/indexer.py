"""Indekseerija: Zotero Local API → library.db.

Sõrmejälg katab VIIS osa — fail, bibliokirje, sidecar, ekstraktori ja skeemi
versioon. Ainult faili jälgimine jätaks Zoteros parandatud autori või muudetud
sidecar'i vaikselt vanaks.
"""
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .config import EXTRACTOR_VERSION, INDEXER_SCHEMA_VERSION, LibrarySettings
from .extract import ExtractError, extract_pages, normalize_for_search
from .pages import SidecarError, resolve_mapping
from .schema import connect, create_schema
from .zotero import (
    ZoteroDoc,
    ZoteroError,
    check_api,
    collection_tree,
    iter_documents,
    resolve_collection,
)


class IndexLocked(Exception):
    """Teine vutt-library index juba jookseb."""


class IndexLock:
    """Failipõhine lukk — kaks indekseerijat ei tohi korraga kirjutada."""

    def __init__(self, db_path: Path):
        self.tee = Path(str(db_path) + ".lock")

    def __enter__(self):
        self.tee.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(self.tee, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError as e:
            raise IndexLocked(
                f"indekseerimine juba käib (lukk: {self.tee}). "
                "Kui see on jäänuk, kustuta fail käsitsi."
            ) from e
        os.write(self.fd, str(os.getpid()).encode())
        return self

    def __exit__(self, *exc):
        os.close(self.fd)
        self.tee.unlink(missing_ok=True)
        return False


@dataclass
class IndexReport:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    removed: int = 0
    broken_links: list = field(default_factory=list)
    no_mapping: list = field(default_factory=list)
    no_text: list = field(default_factory=list)
    bad_sidecar: list = field(default_factory=list)
    subcollections: list = field(default_factory=list)
    source: str = ""


def _sidecar_tee(settings: LibrarySettings, doc_id: str) -> Path:
    return settings.db_path.parent / "sidecar" / f"{doc_id}.override.json"


def _hash(*osad: str) -> str:
    h = hashlib.sha256()
    for osa in osad:
        h.update(osa.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def fingerprint(doc: ZoteroDoc, sidecar_hash: str | None) -> str:
    """Viis osa: fail + bibliokirje + sidecar + ekstraktor + skeem."""
    if doc.path is not None and doc.path.exists():
        st = doc.path.stat()
        faili_osa = f"{doc.path}|{st.st_mtime_ns}|{st.st_size}"
    else:
        faili_osa = f"{doc.path}|PUUDUB"
    bib_osa = json.dumps(
        {
            "creators": doc.bib.creators, "title": doc.bib.title,
            "year": doc.bib.year, "place": doc.bib.place,
            "publisher": doc.bib.publisher, "publication": doc.bib.publication,
            "volume": doc.bib.volume, "issue": doc.bib.issue,
            "pages": doc.bib.pages, "series": doc.bib.series,
            "edition": doc.bib.edition, "isbn": doc.bib.isbn, "doi": doc.bib.doi,
        },
        sort_keys=True, ensure_ascii=False,
    )
    return _hash(faili_osa, bib_osa, sidecar_hash or "-",
                 str(EXTRACTOR_VERSION), str(INDEXER_SCHEMA_VERSION))


def _kirjuta_dokument(conn, doc: ZoteroDoc, coll_key: str, mapping, lehed,
                      fp: str) -> None:
    """Dokument + leheküljed ÜHE transaktsiooni sees (kutsuja hoiab tehingut)."""
    conn.execute("DELETE FROM pages WHERE doc_id = ?", (doc.doc_id,))
    conn.execute("DELETE FROM pages_fts WHERE doc_id = ?", (doc.doc_id,))
    conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc.doc_id,))
    conn.execute(
        """INSERT INTO documents (doc_id, parent_key, collection_key, title,
             creators_json, year, place, publisher, publication, volume, issue,
             pages, series, edition, isbn, doi, file_path, link_mode,
             file_missing, page_count, page_mapping_source,
             page_mapping_confidence, page_mapping_summary, fingerprint, indexed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (doc.doc_id, doc.parent_key, coll_key, doc.bib.title,
         json.dumps(doc.bib.creators, ensure_ascii=False), doc.bib.year,
         doc.bib.place, doc.bib.publisher, doc.bib.publication, doc.bib.volume,
         doc.bib.issue, doc.bib.pages, doc.bib.series, doc.bib.edition,
         doc.bib.isbn, doc.bib.doi, str(doc.path), doc.link_mode,
         int(doc.file_missing), len(lehed), mapping.source, mapping.confidence,
         mapping.summary, fp, datetime.now(timezone.utc).isoformat()),
    )
    for nr, tekst in enumerate(lehed, start=1):
        conn.execute(
            "INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
            "VALUES (?,?,?,?)",
            (doc.doc_id, nr, mapping.labels[nr - 1], tekst),
        )
        conn.execute(
            "INSERT INTO pages_fts (doc_id, pdf_page, search_text) VALUES (?,?,?)",
            (doc.doc_id, nr, normalize_for_search(tekst)),
        )


def run_index(settings: LibrarySettings, *, full: bool = False) -> IndexReport:
    aruanne = IndexReport(source=settings.api_base)
    with IndexLock(settings.db_path):
        check_api(settings.api_base)
        storage = settings.zotero_dir / "storage"
        if not storage.is_dir():
            # Ilma selle kontrollita „õnnestuks" jooks 100% katkiste linkidega.
            raise ZoteroError(
                f"Zotero storage-kausta ei ole: {storage}. Sea "
                "VUTT_LIBRARY_ZOTERO_DIR andmekataloogile, mille all on "
                "storage/ (Zotero → Settings → Advanced → Files and Folders)."
            )
        coll_key, _ = resolve_collection(settings.api_base, settings.collection)
        puu = collection_tree(settings.api_base, coll_key)
        aruanne.subcollections = [nimi for _, nimi in puu]
        dokumendid = iter_documents(
            settings.api_base, storage, [key for key, _ in puu])

        conn = connect(settings.db_path)
        create_schema(conn)
        if full:
            conn.executescript(
                "DELETE FROM pages; DELETE FROM pages_fts; DELETE FROM documents;")
            conn.commit()

        olemas = {
            r["doc_id"]: r["fingerprint"]
            for r in conn.execute("SELECT doc_id, fingerprint FROM documents")
        }

        for doc in dokumendid:
            sc = _sidecar_tee(settings, doc.doc_id)
            sc_hash = (
                hashlib.sha256(sc.read_bytes()).hexdigest() if sc.exists() else None
            )
            fp = fingerprint(doc, sc_hash)
            if doc.doc_id in olemas and olemas[doc.doc_id] == fp:
                if doc.file_missing:
                    # Sõrmejälg on sama, aga katkine link peab JÄÄMA nähtavaks.
                    aruanne.broken_links.append(doc.doc_id)
                aruanne.skipped += 1
                continue

            if doc.file_missing:
                aruanne.broken_links.append(doc.doc_id)
                if doc.doc_id in olemas:
                    # Fail kadus, kirje jääb kogusse: tekst SÄILIB. Sõrmejälg
                    # tuleb kaasa uuendada, muidu loeb iga järgmine jooks sama
                    # dokumendi uuesti „uuendatuks".
                    conn.execute(
                        "UPDATE documents SET file_missing = 1, fingerprint = ? "
                        "WHERE doc_id = ?", (fp, doc.doc_id))
                    conn.commit()
                    aruanne.updated += 1
                continue

            try:
                lehed = extract_pages(doc.path)
            except ExtractError:
                aruanne.no_text.append(doc.doc_id)
                continue
            if not any(l.strip() for l in lehed):
                aruanne.no_text.append(doc.doc_id)
                continue

            try:
                mapping = resolve_mapping(doc.path, lehed,
                                          sc if sc.exists() else None)
            except SidecarError as e:
                # Käsitsi kirjutatud fail ei tohi tervet jooksu maha võtta,
                # aga vale numeratsiooniga indekseerimine oleks vaikne vale.
                aruanne.bad_sidecar.append(f"{doc.doc_id}: {e}")
                continue
            if mapping.source == "none":
                aruanne.no_mapping.append(doc.doc_id)

            # ÜKS transaktsioon dokumendi kohta: MCP ei näe poolikut seisu.
            with conn:
                _kirjuta_dokument(conn, doc, coll_key, mapping, lehed, fp)
            if doc.doc_id in olemas:
                aruanne.updated += 1
            else:
                aruanne.added += 1

        # Kogust eemaldatud või prügikasti läinud → indeksist välja.
        praegused = {d.doc_id for d in dokumendid}
        for doc_id in olemas:
            if doc_id not in praegused:
                with conn:
                    conn.execute("DELETE FROM pages WHERE doc_id = ?", (doc_id,))
                    conn.execute("DELETE FROM pages_fts WHERE doc_id = ?", (doc_id,))
                    conn.execute("DELETE FROM documents WHERE doc_id = ?", (doc_id,))
                aruanne.removed += 1
        conn.close()
    return aruanne
