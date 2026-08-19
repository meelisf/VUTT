"""MCP-tööriistad. Registreeritakse AINULT siis, kui indeksifail on olemas."""
from . import format as fmt
from .config import LibrarySettings, library_available
from .query import (
    PageRefError,
    fetch_pages,
    list_documents,
    resolve_page_range,
    search,
)
from .schema import connect

MAX_PAGES = 20
MAX_CHARS = 60000


def _ava(settings: LibrarySettings):
    """Ühendus tööriistakutse kohta — pikaajaline hoiaks pärast indeksi
    ümberehitust vana inode'i elus ja serveeriks vaikselt aegunud andmeid."""
    return connect(settings.db_path, read_only=True)


def _parent_keys(conn, doc_ids):
    if not doc_ids:
        return {}
    kohataited = ",".join("?" * len(doc_ids))
    return {
        r["doc_id"]: r["parent_key"]
        for r in conn.execute(
            f"SELECT doc_id, parent_key FROM documents WHERE doc_id IN ({kohataited})",
            list(doc_ids))
    }


def register_library_tools(mcp, settings: LibrarySettings) -> bool:
    if not library_available(settings):
        return False

    @mcp.tool(structured_output=False)
    async def list_literature() -> str:
        """Loetleb lokaalse sekundaarkirjanduse kogu sisu: teatmeteosed,
        matriklid ja monograafiad 17. sajandi Tartu kohta. Kasuta SEDA ENNE
        otsingut, et teada, mida kogu üldse sisaldab — tühi otsingutulemus ei
        tähenda, et teemat pole käsitletud, kui õiget teost kogus polegi.
        Tagastab iga teose doc_id, viite ja lehekülgede arvu."""
        conn = _ava(settings)
        try:
            return fmt.format_list(list_documents(conn))
        finally:
            conn.close()

    @mcp.tool(structured_output=False)
    async def search_literature(
        query: str,
        doc_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
    ) -> str:
        """Otsib lokaalsest sekundaarkirjanduse kogust ja tagastab katked koos
        TSITEERITAVA viitega (autor, aasta, pealkiri, trükise leheküljenumber).

        Vaikimisi peavad KÕIK päringu sõnad esinema; relax_matching=true
        lõdvendab. `doc_id` piirab otsingu ühele teosele (vt list_literature).

        Tekst pärineb skaneeringute OCR-ist ja on kohati lagunenud — täpne
        fraasiotsing võib vahele jääda."""
        conn = _ava(settings)
        try:
            hits = search(conn, query, doc_id=doc_id, relax=relax_matching,
                          limit=limit)
            return fmt.format_hits(hits, _parent_keys(conn, {h.doc_id for h in hits}))
        except ValueError as e:
            return f"Vigane päring: {e}"
        finally:
            conn.close()

    @mcp.tool(structured_output=False)
    async def get_literature_pages(
        doc_id: str,
        from_page: str,
        to_page: str,
        page_ref: str,
    ) -> str:
        """Tagastab teose lehekülgede täisteksti.

        `page_ref` on KOHUSTUSLIK ja ütleb, kumba numeratsiooni from_page/to_page
        tähendavad:
          - "printed" — trükise leheküljenumber (võib olla rooma: 'xviii')
          - "pdf"     — PDF-faili lehe järjekorranumber

        Need kaks EI OLE samad: köite eessõna ja tahvlid nihutavad neid.
        Kui trükitud numeratsioon on teadmata (vt list_literature), kasuta "pdf".
        Korraga kuni 20 lehekülge ja piiratud märgimaht; kärpimisest teatatakse."""
        conn = _ava(settings)
        try:
            read = conn.execute(
                "SELECT * FROM documents WHERE doc_id = ?", (doc_id,)).fetchone()
            if read is None:
                return (f"Tundmatu doc_id {doc_id!r}. "
                        "Vaata list_literature väljundit.")
            from .query import _doc_row

            doc = _doc_row(read)
            pdf_from, pdf_to = resolve_page_range(
                conn, doc_id, from_page, to_page, page_ref)
            rows, truncated = fetch_pages(
                conn, doc_id, pdf_from, pdf_to,
                max_pages=MAX_PAGES, max_chars=MAX_CHARS)
            return fmt.format_pages(doc, rows, truncated, read["parent_key"])
        except PageRefError as e:
            return f"Lehevahemikku ei saa lahendada: {e}"
        finally:
            conn.close()

    return True
