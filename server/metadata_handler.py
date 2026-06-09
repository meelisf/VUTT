import os
import json
import html
from urllib.parse import urlencode
from .config import BASE_DIR
from .utils import find_directory_by_id

SITE_URL = "https://vutt.utlib.ut.ee"

_ROLE_LABELS = {
    "praeses": "Praeses",
    "auctor": "Autor",
    "respondens": "Respondens",
    "dedicatee": "Pühendatu",
    "translator": "Tõlkija",
}


def _escape(text):
    return html.escape(str(text), quote=True)


def _label(entity) -> str:
    """Eraldab LinkedEntity label või tagastab stringi sellisena."""
    if isinstance(entity, dict):
        return entity.get("label") or ""
    return str(entity) if entity else ""


def _build_coins(meta: dict) -> str:
    """Genereerib COinS (Z39.88-2004) query-stringi _metadata.json põhjal."""
    params = [
        ("ctx_ver", "Z39.88-2004"),
        ("rft_val_fmt", "info:ofi/fmt:kev:mtx:book"),
        ("rft.genre", "book"),
    ]
    title = meta.get("title", "")
    if title:
        params.append(("rft.btitle", title))

    creators = meta.get("creators") or []
    for c in creators:
        role = c.get("role", "")
        name = c.get("name", "")
        if not name:
            continue
        if role in ("praeses", "auctor"):
            params.append(("rft.au", name))
        elif role == "respondens":
            params.append(("rft.contributor", name))

    year = meta.get("year")
    if year:
        params.append(("rft.date", str(year)))

    place = _label(meta.get("location"))
    if place:
        params.append(("rft.place", place))

    publisher = _label(meta.get("publisher"))
    if publisher:
        params.append(("rft.pub", publisher))

    languages = meta.get("languages") or []
    if languages:
        params.append(("rft.language", ", ".join(languages)))

    ext_url = meta.get("external_url") or ""
    if ext_url.startswith("https://") or ext_url.startswith("http://"):
        params.append(("rft_id", ext_url))

    return urlencode(params)


def build_meta_html(work_id: str) -> str:
    """Genereerib Google'ile ja sotsiaalmeedia robotitele HTML-i koos metaandmetega."""
    found_path = find_directory_by_id(work_id)

    title = "VUTT - Varauusaegsete tekstide töölaud"
    description = "Vaata ja toimeta Tartu Ülikooli varauusaegseid akadeemilisi tekste."
    image_url = f"{SITE_URL}/vutt-og.png"
    meta = {}

    if found_path:
        metadata_path = os.path.join(found_path, "_metadata.json")
        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                title = meta.get("title", title)
                creators = meta.get("creators") or []
                creator_names = ", ".join(c.get("name", "") for c in creators if c.get("name"))
                year = meta.get("year", "")
                if creator_names:
                    description = f"{creator_names}. {year}" if year else creator_names
            except Exception:
                pass
        image_url = f"{SITE_URL}/api/images/{_escape(work_id)}/_thumb"

    safe_work_id = _escape(work_id)
    work_url = f"{SITE_URL}/work/{safe_work_id}"
    safe_title = _escape(title)
    safe_desc = _escape(description)
    coins_str = _escape(_build_coins(meta)) if meta else ""

    # Dublin Core meta tagid
    dc_tags = f'    <meta name="DC.title" content="{safe_title}">\n'
    creators = meta.get("creators") or []
    for c in creators:
        name = c.get("name", "")
        if name:
            dc_tags += f'    <meta name="DC.creator" content="{_escape(name)}">\n'
    year = meta.get("year")
    if year:
        dc_tags += f'    <meta name="DC.date" content="{_escape(str(year))}">\n'
    publisher = _label(meta.get("publisher"))
    if publisher:
        dc_tags += f'    <meta name="DC.publisher" content="{_escape(publisher)}">\n'
    languages = meta.get("languages") or []
    for lang in languages:
        dc_tags += f'    <meta name="DC.language" content="{_escape(lang)}">\n'

    # Body sisu
    body_lines = [f"<h1>{_escape(title)}</h1>"]

    if creators:
        body_lines.append("<dl>")
        for c in creators:
            role_label = _ROLE_LABELS.get(c.get("role", ""), c.get("role", ""))
            name = c.get("name", "")
            if name:
                body_lines.append(f"  <dt>{_escape(role_label)}</dt><dd>{_escape(name)}</dd>")
        body_lines.append("</dl>")

    if year:
        body_lines.append(f"<p>{_escape(str(year))}</p>")

    place = _label(meta.get("location"))
    publisher_name = _label(meta.get("publisher"))
    if place or publisher_name:
        body_lines.append(f"<p>{_escape(place)}{': ' + _escape(publisher_name) if publisher_name else ''}</p>")

    archive_refs = meta.get("archive_refs") or []
    for ref in archive_refs:
        archive_id = ref.get("archive_id", "")
        reference = ref.get("reference", "")
        body_lines.append(f"<p>{_escape(archive_id)}{' ' + _escape(reference) if reference else ''}</p>")

    body_lines.append(f'<p><a href="{work_url}">{work_url}</a></p>')
    body_content = "\n".join(body_lines)

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <link rel="canonical" href="{work_url}">
    <meta name="description" content="{safe_desc}">

    {dc_tags}
    <meta property="og:type" content="website">
    <meta property="og:url" content="{work_url}">
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

    <meta http-equiv="refresh" content="0; url={work_url}">
</head>
<body>
    {body_content}
    {f'<span class="Z3988" title="{coins_str}"></span>' if coins_str else ''}
</body>
</html>"""


def build_sitemap_xml(
    work_id_cache: dict,
    is_work_public_fn,
    load_meta_fn,
) -> str:
    """
    Genereerib sitemap.xml kõigi avalike teoste jaoks.

    work_id_cache: {work_id: (path, mtime)} või {work_id: path}
    is_work_public_fn: callable(meta) -> bool
    load_meta_fn: callable(work_id) -> dict | None
    """
    import datetime

    urls = []
    for work_id, value in work_id_cache.items():
        if isinstance(value, tuple):
            path, mtime = value
        else:
            path = value
            try:
                meta_path = os.path.join(path, "_metadata.json")
                mtime = os.path.getmtime(meta_path) if os.path.exists(meta_path) else 0.0
            except Exception:
                mtime = 0.0

        meta = load_meta_fn(work_id)
        if meta is None:
            continue
        if not is_work_public_fn(meta):
            continue

        lastmod = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc).strftime("%Y-%m-%d")
        loc = f"{SITE_URL}/work/{html.escape(work_id)}"
        urls.append(f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n  </url>")

    body = "\n".join(urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>"
    )
