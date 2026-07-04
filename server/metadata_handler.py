import os
import json
import html
import logging
from typing import Optional
from urllib.parse import urlencode
from .config import BASE_DIR
from .utils import find_directory_by_id
from .text_reading import read_work_page_texts, _clean_search_text, work_latest_mtime

SITE_URL = "https://vutt.utlib.ut.ee"
logger = logging.getLogger(__name__)

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




# Googlebot indekseerib esimesed ~2MB HTML-i. Hoiame teksti alla selle;
# piiri ületamisel lõikame ja lisame "täistekst rakenduses" viite.
PRERENDER_TEXT_MAX_BYTES = 1_600_000
PRERENDER_TEXT_WARN_BYTES = 1_500_000


def _append_work_text(body_lines, found_path, work_url, work_id):
    """Lisab lehekülgede kaupa puhastatud põhiteksti + marginaalia body_lines-i."""
    parts = []
    total = 0
    truncated = False
    for page_num, raw in read_work_page_texts(found_path):
        main_clean, marg_clean = _clean_search_text(raw)
        if not main_clean and not marg_clean:
            continue
        seg = f'<section data-page="{page_num}">'
        if main_clean:
            seg += f'<p>{_escape(main_clean)}</p>'
        if marg_clean:
            seg += f'<p class="marginalia"><em>Ääremärkused:</em> {_escape(marg_clean)}</p>'
        seg += '</section>'
        seg_bytes = len(seg.encode('utf-8'))
        if total + seg_bytes > PRERENDER_TEXT_MAX_BYTES:
            truncated = True
            break
        parts.append(seg)
        total += seg_bytes

    if parts or truncated:
        body_lines.append('<div class="work-text">')
        body_lines.extend(parts)
        if truncated:
            body_lines.append(f'<p><a href="{work_url}">Täistekst rakenduses</a></p>')
        body_lines.append('</div>')
    # Hoiata ka siis kui KÄRBITI (üksik esimene leht võib ületada MAX-i enne
    # kui total jõuab WARN-piirini → muidu jääks halvim juht signaalita).
    if total >= PRERENDER_TEXT_WARN_BYTES or truncated:
        logger.warning(
            "Prerender HTML suur: work_id=%s text_bytes=%s truncated=%s",
            work_id, total, truncated,
        )


def cached_work_meta_html(work_id, work_path, build_fn):
    """Tagastab bot-HTML-i cache'ist, kui teose max-mtime pole muutunud."""
    from .cache_invalidation import _work_meta_cache
    key = work_latest_mtime(work_path)
    cached = _work_meta_cache.get(work_id)
    if cached is not None and cached[0] == key:
        return cached[1]
    html = build_fn()
    _work_meta_cache[work_id] = (key, html)
    return html

def build_meta_html(work_id: str, creator_persons=None, include_text: bool = True) -> str:
    """Genereerib Google'ile ja sotsiaalmeedia robotitele HTML-i koos metaandmetega.

    creator_persons: eel-resolvitud [{id, label}] loojate isikukaardid (route filtreerib)
    — lingitakse ristviidetena. Tagasi-lingid kodu/isikud lisatakse alati (linkgraaf).
    """
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

    # Ristviited loojate isikukaartidele (linkgraaf teos↔isik)
    for person in creator_persons or []:
        pid = person.get("id")
        plabel = person.get("label") or pid
        if pid:
            person_url = f"{SITE_URL}/persons/{_escape(pid)}"
            body_lines.append(f'<p><a href="{person_url}">{_escape(plabel)}</a></p>')

    # Täistekst botidele (sama avalik transkriptsioon, mida kasutaja SPA-s näeb —
    # EI ole SEO-only peidetud teksti → ei ole cloaking). Lehekülgede kaupa.
    # include_text=False, kui ligipääsu ei õnnestunud hinnata (meta laadimata) —
    # nii ei leki piiratud teose tekst veateel (vt work_meta endpoint fallback).
    if found_path and include_text:
        _append_work_text(body_lines, found_path, work_url, work_id)

    body_lines.append(f'<p><a href="{work_url}">{work_url}</a></p>')
    # Tagasi-lingid hub-lehtedele (alati — jaotab crawl-graafi)
    body_lines.append(
        f'<nav><a href="{SITE_URL}/">VUTT</a> · <a href="{SITE_URL}/persons">Isikud</a></nav>'
    )
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


def build_persons_meta_html(person_entries=None) -> str:
    """Genereerib robotitele prosopograafia avalehe (isikute-hub).

    person_entries: prosopography_index entries [{id, label, record_status?, merged_into?}].
    Lingitakse kõik mitte-tombstone/merged isikud (iga isik 1 hüppe kaugusel /persons-st).
    None → ainult self-link (tahaühilduv).
    """
    persons_url = f"{SITE_URL}/persons"
    title = "Isikud – VUTT prosopograafia"
    description = "VUTT prosopograafia: varauusaegsete akadeemiliste tekstidega seotud isikud."
    safe_title = _escape(title)
    safe_desc = _escape(description)

    body_lines = [f"<h1>{safe_title}</h1>", f"<p>{safe_desc}</p>"]
    link_items = []
    for entry in person_entries or []:
        if entry.get("record_status") == "tombstone" or entry.get("merged_into"):
            continue
        pid = entry.get("id")
        if not pid:
            continue
        label = entry.get("label") or entry.get("name") or pid
        url = f"{persons_url}/{_escape(pid)}"
        link_items.append(f'  <li><a href="{url}">{_escape(label)}</a></li>')
    if link_items:
        body_lines.append("<ul>\n" + "\n".join(link_items) + "\n</ul>")
    body_lines.append(f'<p><a href="{persons_url}">{persons_url}</a></p>')
    body_lines.append(f'<nav><a href="{SITE_URL}/">VUTT</a></nav>')
    body_content = "\n".join(body_lines)

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
    {body_content}
</body>
</html>"""


def build_home_meta_html(work_id_cache, is_work_public_fn, load_meta_fn, work_collections, collections) -> str:
    """Genereerib bottidele crawl'itava bot-kodulehe (linkgraafi peamine jaotuspunkt).

    Iteerib teosed (nagu sitemap), filtreerib avalikud, grupeerib `<h2>` alla
    kollektsiooni et-label järgi; ilma kollektsioonita teosed "Muu" alla.
    Iga teos `<a href=/work/{id}>` — iga avalik teos 1 hüppe kaugusel /-st.

    work_id_cache: {work_id: (path, mtime)} või {work_id: path}
    work_collections: {work_id: [collection_id]} (work_collections_index.json)
    collections: {collection_id: {"name": {"et":..}, ...}} (collections.json)
    """
    title = "VUTT – Varauusaegsete tekstide töölaud"
    description = "Tartu Ülikooli varauusaegsete akadeemiliste tekstide register: teosed ja isikud."
    safe_title = _escape(title)
    safe_desc = _escape(description)
    home_url = f"{SITE_URL}/"

    MUU = "￿"  # sorteerub viimaseks
    # Grupeeri avalikud teosed kollektsiooni kaupa
    groups = {}  # group_key (et-label) -> [(title, year, work_id)]
    for work_id in work_id_cache:
        meta = load_meta_fn(work_id)
        if meta is None or not is_work_public_fn(meta):
            continue
        w_title = meta.get("title") or work_id
        w_year = meta.get("year")
        col_ids = work_collections.get(work_id) or []
        # Esimene tuntud kollektsioon määrab grupi; muidu "Muu"
        group_label = MUU
        for cid in col_ids:
            cfg = collections.get(cid)
            if cfg:
                name = cfg.get("name") or {}
                group_label = name.get("et") or name.get("en") or cid
                break
        groups.setdefault(group_label, []).append((w_title, w_year, work_id))

    body_lines = [f"<h1>{safe_title}</h1>", f"<p>{safe_desc}</p>"]

    def _sort_key(k):
        return (1, "") if k == MUU else (0, k.casefold())

    for group_label in sorted(groups, key=_sort_key):
        heading = "Muu" if group_label == MUU else group_label
        body_lines.append(f"<h2>{_escape(heading)}</h2>")
        body_lines.append("<ul>")
        for w_title, w_year, work_id in sorted(groups[group_label], key=lambda t: str(t[0]).casefold()):
            url = f"{SITE_URL}/work/{_escape(work_id)}"
            year_str = f" {_escape(str(w_year))}" if w_year else ""
            body_lines.append(f'  <li><a href="{url}">{_escape(w_title)}</a>{year_str}</li>')
        body_lines.append("</ul>")

    body_lines.append(f'<p><a href="{SITE_URL}/persons">Isikud →</a></p>')
    body_content = "\n".join(body_lines)

    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{safe_title}</title>
    <link rel="canonical" href="{home_url}">
    <meta name="description" content="{safe_desc}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{home_url}">
    <meta property="og:title" content="{safe_title}">
    <meta property="og:description" content="{safe_desc}">
</head>
<body>
    {body_content}
</body>
</html>"""


def build_person_meta_html(person_id: str, work_links=None) -> Optional[str]:
    """Genereerib Google'ile ja sotsiaalmeedia robotitele isikukaardi HTML-i.

    work_links: eel-resolvitud [{work_id, title}] isiku AVALIKUD teosed (route filtreerib)
    — lingitakse ristviidetena. Tagasi-lingid isikud/kodu lisatakse alati (linkgraaf).
    """
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

    # Ristviited isiku avalikele teostele (linkgraaf isik↔teos)
    if work_links:
        body_lines.append("<h2>Teosed</h2>")
        body_lines.append("<ul>")
        for w in work_links:
            wid = w.get("work_id")
            if not wid:
                continue
            wtitle = w.get("title") or wid
            url = f"{SITE_URL}/work/{_escape(wid)}"
            body_lines.append(f'  <li><a href="{url}">{_escape(wtitle)}</a></li>')
        body_lines.append("</ul>")

    body_lines.append(f'<p><a href="{person_url}">{person_url}</a></p>')
    # Tagasi-lingid hub-lehtedele (alati)
    body_lines.append(
        f'<nav><a href="{SITE_URL}/persons">Isikud</a> · <a href="{SITE_URL}/">VUTT</a></nav>'
    )
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

        # lastmod = max(_metadata.json, lehtede .txt/.json) → tekstimuudatus värskendab
        latest = work_latest_mtime(path) or mtime
        lastmod = _sitemap_lastmod(latest)
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
