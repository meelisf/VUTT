import os
import json
import html
from typing import Optional
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
</head>
<body>
    {body_content}
    {f'<span class="Z3988" title="{coins_str}"></span>' if coins_str else ''}
</body>
</html>"""


def build_persons_meta_html() -> str:
    """Genereerib robotitele lihtsa HTML-i prosopograafia avalehe jaoks."""
    persons_url = f"{SITE_URL}/persons"
    title = "Isikud – VUTT prosopograafia"
    description = "VUTT prosopograafia: varauusaegsete akadeemiliste tekstidega seotud isikud."
    safe_title = _escape(title)
    safe_desc = _escape(description)
    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <link rel="canonical" href="{persons_url}">
    <meta name="description" content="{safe_desc}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{persons_url}">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
</head>
<body>
    <h1>{safe_title}</h1>
    <p>{safe_desc}</p>
    <p><a href="{persons_url}">{persons_url}</a></p>
</body>
</html>"""


def build_person_meta_html(person_id: str) -> Optional[str]:
    """Genereerib Google'ile ja sotsiaalmeedia robotitele isikukaardi HTML-i."""
    from .prosopography.ops import get_person_with_works

    person = get_person_with_works(person_id)
    if not person or person.get("record_status") == "tombstone" or person.get("merged_into"):
        return None

    name = person.get("name") or {}
    title = name.get("label") or person.get("id") or "Isik"
    aliases = name.get("aliases") or []
    biography = _strip_html_tags(person.get("biography") or person.get("notes") or "")
    description_parts = []
    if aliases:
        description_parts.append("; ".join(str(a) for a in aliases[:5]))
    if biography:
        description_parts.append(biography[:180])
    description = " — ".join(description_parts) or "VUTT prosopograafia isikukaart."

    person_url = f"{SITE_URL}/persons/{_escape(person_id)}"
    safe_title = _escape(title)
    safe_desc = _escape(description)

    dc_tags = f'    <meta name="DC.title" content="{safe_title}">\n'
    updated = person.get("updated_at")
    if updated:
        dc_tags += f'    <meta name="DC.date" content="{_escape(str(updated))}">\n'

    body_lines = [f"<h1>{safe_title}</h1>"]
    if aliases:
        body_lines.append(f"<p>{_escape('; '.join(str(a) for a in aliases))}</p>")

    birth = (person.get("birth") or {}).get("date")
    death = (person.get("death") or {}).get("date")
    if birth or death:
        body_lines.append(f"<p>{_escape(birth or '')}–{_escape(death or '')}</p>")

    occupations = person.get("occupations") or []
    occ_labels = [o.get("label") or o.get("occupation") for o in occupations if isinstance(o, dict) and (o.get("label") or o.get("occupation"))]
    if occ_labels:
        body_lines.append(f"<p>{_escape(', '.join(occ_labels))}</p>")
    if biography:
        body_lines.append(f"<p>{_escape(biography)}</p>")
    body_lines.append(f'<p><a href="{person_url}">{person_url}</a></p>')
    body_content = "\n".join(body_lines)

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <link rel="canonical" href="{person_url}">
    <meta name="description" content="{safe_desc}">

{dc_tags}    <meta property="og:type" content="profile">
    <meta property="og:url" content="{person_url}">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
</head>
<body>
    {body_content}
</body>
</html>"""


def _strip_html_tags(text: str) -> str:
    """Eemaldab lihtsad XML/HTML märgendid meta-kirjelduse jaoks."""
    import re
    return re.sub(r"<[^>]+>", "", str(text or "")).strip()


def _sitemap_lastmod(value) -> Optional[str]:
    """Teisendab ISO või timestamp väärtuse sitemap lastmod kuupäevaks."""
    import datetime
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).strftime("%Y-%m-%d")
    text = str(value).strip()
    if len(text) >= 10 and text[:4].isdigit():
        return text[:10]
    return None


def build_sitemap_xml(
    work_id_cache: dict,
    is_work_public_fn,
    load_meta_fn,
    person_entries: Optional[list] = None,
) -> str:
    """
    Genereerib sitemap.xml avalike teoste ja prosopograafia jaoks.

    work_id_cache: {work_id: (path, mtime)} või {work_id: path}
    is_work_public_fn: callable(meta) -> bool
    load_meta_fn: callable(work_id) -> dict | None
    person_entries: prosopography_index.json entries või None
    """

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

        lastmod = _sitemap_lastmod(mtime)
        loc = f"{SITE_URL}/work/{html.escape(work_id)}"
        lastmod_xml = f"\n    <lastmod>{lastmod}</lastmod>" if lastmod else ""
        urls.append(f"  <url>\n    <loc>{loc}</loc>{lastmod_xml}\n  </url>")

    urls.append(f"  <url>\n    <loc>{SITE_URL}/persons</loc>\n  </url>")

    for person in person_entries or []:
        if person.get("record_status") == "tombstone":
            continue
        person_id = person.get("id")
        if not person_id:
            continue
        loc = f"{SITE_URL}/persons/{html.escape(str(person_id))}"
        lastmod = _sitemap_lastmod(person.get("updated_at"))
        lastmod_xml = f"\n    <lastmod>{lastmod}</lastmod>" if lastmod else ""
        urls.append(f"  <url>\n    <loc>{loc}</loc>{lastmod_xml}\n  </url>")

    body = "\n".join(urls)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>"
    )
