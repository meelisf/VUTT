"""Skaneeringu tagastamine MCP pildisisuna OCR-i kontrollimiseks."""
import base64

from mcp.types import ImageContent, TextContent

from . import queries
from .errors import VuttError, VuttNotFound


def register_image_tools(mcp, client, base_url: str) -> None:
    @mcp.tool(structured_output=False)
    async def get_page_image(work_id: str, page: int) -> list[TextContent | ImageContent]:
        """Näitab VUTT-i lehekülje skaneeringut OCR-i visuaalseks kontrolliks.

        work_id saad search_pages/search_works tulemusest. page on 1-põhine
        skaneeringu järjekorranumber nagu get_pages'is, MITTE trükitud number
        ega foliatsioon. Tagastab ühe täisresolutsiooniga pildi; võrdlusteksti
        küsi get_pages(work_id, page, page). Pilt vajab pildisisu toetavat klienti.
        """
        if page < 1:
            raise VuttError("page peab olema vähemalt 1 (skaneeringu järjekorranumber).")
        body = queries.build_work_pages_body(work_id, page, page)
        body["attributesToRetrieve"] = ["lehekylje_pilt"]
        hits = client.meili_search(body).get("hits", [])
        if not hits:
            raise VuttNotFound(f"Teose {work_id} lehekülge {page} ei leitud. Kontrolli get_work abil.")
        path = hits[0].get("lehekylje_pilt")
        if not path:
            raise VuttNotFound("Leheküljel puudub indeksis pilditee.")
        data, mime = client.image_get(path)
        return [
            TextContent(type="text", text=f"Teos {work_id}, skaneering {page}.\n{base_url}/work/{work_id}/{page}"),
            ImageContent(type="image", data=base64.b64encode(data).decode("ascii"), mime_type=mime),
        ]
