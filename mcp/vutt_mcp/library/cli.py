"""`vutt-library` — kirjanduskogu indekseerimine.

Indekseerimine on KIRJUTAV ja käib omaniku käsul; MCP-pool jääb read-only.
"""
import argparse
import sys

from .config import library_available, load_library_settings
from .indexer import IndexLocked, run_index
from .query import list_documents
from .schema import connect
from .zotero import ZoteroError


def _teata(aruanne) -> None:
    print(f"Allikas: Zotero Local API ({aruanne.source})")
    print(f"Kollektsioonid: {', '.join(aruanne.subcollections)}")
    print(f"Tulemus: {aruanne.added} uus, {aruanne.updated} uuendatud, "
          f"{aruanne.skipped} muutumatut, {aruanne.removed} eemaldatud")
    if aruanne.broken_links:
        print(f"\nKATKISED LINGID ({len(aruanne.broken_links)}) — "
              "fail puudub, indekseeritud tekst säilib:")
        for doc_id in aruanne.broken_links:
            print(f"  {doc_id}")
    if aruanne.no_text:
        print(f"\nTEKSTIKIHITA ({len(aruanne.no_text)}) — vaja OCR-i:")
        for doc_id in aruanne.no_text:
            print(f"  {doc_id}")
    if aruanne.no_mapping:
        print(f"\nTRÜKITUD NUMERATSIOON TUVASTAMATA ({len(aruanne.no_mapping)}) — "
              "lisa sidecar, kui tahad täpset viitamist:")
        for doc_id in aruanne.no_mapping:
            print(f"  {doc_id}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="vutt-library")
    alam = parser.add_subparsers(dest="kask", required=True)
    alam.add_parser("index", help="indekseeri Zotero kollektsioon")
    alam.add_parser("status", help="näita kogu seisu")
    args = parser.parse_args(argv)

    settings = load_library_settings()

    if args.kask == "status":
        if not library_available(settings):
            print(f"Indeksit ei ole: {settings.db_path}\n"
                  "Jooksuta `vutt-library index`.")
            return 1
        conn = connect(settings.db_path, read_only=True)
        docs = list_documents(conn)
        print(f"Indeks: {settings.db_path}")
        print(f"Kollektsioon: {settings.collection}")
        print(f"Kogus {len(docs)} teost, "
              f"{sum(d.page_count for d in docs)} lehekülge")
        conn.close()
        return 0

    try:
        aruanne = run_index(settings)
    except (ZoteroError, IndexLocked) as e:
        print(str(e), file=sys.stderr)
        return 1
    _teata(aruanne)
    return 0
