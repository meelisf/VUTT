import os
import json
import html
from server import BASE_DIR, find_directory_by_id

def _escape(text):
    """Escapib teksti HTML atribuutides kasutamiseks."""
    return html.escape(text, quote=True)

def handle_metadata_request(handler, work_id):
    """
    Genereerib sotsiaalmeedia robotitele HTML-i koos metaandmetega.
    """
    found_path = find_directory_by_id(work_id)

    title = "VUTT - Varauusaegsete tekstide töölaud"
    description = "Vaata ja toimeta Tartu Ülikooli varauusaegseid akadeemilisi tekste."
    image_url = "https://vutt.utlib.ut.ee/vutt-og.png"

    if found_path:
        metadata_path = os.path.join(found_path, "_metadata.json")
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                    title = meta.get('title', title)
                    # Võtame kirjelduseks autorid ja aasta
                    creators = ", ".join([c.get('name', '') for c in meta.get('creators', [])])
                    year = meta.get('year', '')
                    if creators:
                        description = f"Autor(id): {creators}. {year}"
            except:
                pass

        # Kasutame spetsiaalset thumbnaili otspunkti, mis genereerib väikese pildi
        image_url = f"https://vutt.utlib.ut.ee/api/images/{work_id}/_thumb"

    # Escapime metaandmed HTML-i jaoks
    safe_title = _escape(title)
    safe_desc = _escape(description)

    # Genereerime minimaliseeritud HTML-i
    page_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <meta name="description" content="{safe_desc}">

    <meta property="og:type" content="website">
    <meta property="og:url" content="https://vutt.utlib.ut.ee/work/{work_id}">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
    <meta property="og:image" content="{image_url}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="400">
    <meta property="og:image:height" content="600">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{safe_title}">
    <meta name="twitter:description" content="{safe_desc}">
    <meta name="twitter:image" content="{image_url}">

    <meta http-equiv="refresh" content="0; url=https://vutt.utlib.ut.ee/work/{work_id}">
</head>
<body>
    Ümbersuunamine teosele... <a href="https://vutt.utlib.ut.ee/work/{work_id}">{safe_title}</a>
</body>
</html>"""

    handler.send_response(200)
    handler.send_header('Content-Type', 'text/html; charset=utf-8')
    handler.end_headers()
    handler.wfile.write(page_html.encode('utf-8'))
