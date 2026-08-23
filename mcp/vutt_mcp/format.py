"""Vastus → agendile loetav tekst. Puhas moodul: ei HTTP-d, ei päringuloogikat.

Vorming on tahtlikult tihe: pikk agentne jooks teeb kümneid päringuid ja
JSON-i korduvad võtmenimed sööksid konteksti enne, kui töö algab.
"""

# Lehekülje seisundeid on VIIS (src/types.ts PageStatus). Kolmene
# Toores/Töös/Valmis on `WorkStatus` — teose koondstaatus, eri asi.
# `test_meili_contract.py` valvab, et see legend types.ts-ist maha ei jääks.
STATUS_LEGEND = (
    "Seisund (lehekülje transkriptsiooni usaldusväärsus): "
    "Toores = puutumata masinlugemine, võib sisaldada OCR-vigu; "
    "Töös = parandamisel; "
    "Parandatud = tekst inimese poolt üle käidud; "
    "Annoteeritud = parandatud ja märgendatud; "
    "Valmis = inimese kinnitatud lõplik transkriptsioon."
)

# Pealkiri otsingutulemuses: varauusaegse teose kirje on sageli terve
# tiitellehe tekst (500+ märki). Loendis piisab algusest; get_work näitab kogu.
TITLE_SNIPPET_CHARS = 140

# Kanooniline rollijärjestus (src/types.ts CreatorRole). Järjestus on tähenduslik:
# disputatsiooni juures on praeses ja respondens põhiosalised, ülejäänud lisandid.
CREATOR_ROLE_ORDER = [
    "auctor",
    "praeses",
    "respondens",
    "aui",
    "dedicator",
    "gratulator",
    "editor",
]

CREATOR_ROLE_LEGEND = (
    "Rollid: auctor = autor; praeses = eesistuja (disputatsiooni juhataja, "
    "sageli tegelik autor); respondens = kaitsja; aui = eessõna või järelsõna "
    "autor; dedicator = pühendaja; gratulator = õnnitleja (gratulatsiooniluuletuse "
    "autor); editor = toimetaja."
)


def work_url(work_id: str, page: int | None = None, *, base_url: str) -> str:
    """Töölaua link. Skaneeringu pildi URL-i EI väljastata (vt spekk)."""
    if page is None:
        return f"{base_url}/work/{work_id}"
    return f"{base_url}/work/{work_id}/{page}"


def person_url(person_id: str, *, base_url: str) -> str:
    return f"{base_url}/persons/{person_id}"


def _first(value) -> str:
    """Massiivist esimene väärtus, skalaarist tema ise, tühjast tühi string."""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value) if value not in (None, "") else ""


def format_creators(creators: list[dict]) -> str:
    """Loojad rollide kaupa, kanoonilises järjestuses.

    Sama rolli isikud lähevad ühele reale (gratulante võib olla kümneid).
    person_id käib kaasa, et agent saaks get_person'i juurde edasi minna.
    """
    if not creators:
        return ""

    grouped: dict[str, list[str]] = {}
    for creator in creators:
        role = creator.get("role") or "?"
        name = creator.get("name") or ""
        person_id = creator.get("id")
        entry = f"{name} [{person_id}]" if person_id else name
        grouped.setdefault(role, [])
        if entry not in grouped[role]:
            grouped[role].append(entry)

    # Tundmatud rollid ei tohi vaikselt kaduda — need lähevad lõppu.
    known = [r for r in CREATOR_ROLE_ORDER if r in grouped]
    unknown = sorted(r for r in grouped if r not in CREATOR_ROLE_ORDER)
    return "\n".join(
        f"  {role}: {', '.join(grouped[role])}" for role in known + unknown
    )


def _primary_creators(creators: list[dict]) -> str:
    """Otsingutulemuse päisele: peamine looja rolliga + respondens, kui on.

    Vaid kaks nime — pikk gratulantide nimekiri ei kuulu tulemuste loendisse.
    """
    if not creators:
        return ""
    by_role: dict[str, str] = {}
    for creator in creators:
        role = creator.get("role") or "?"
        if role not in by_role and creator.get("name"):
            by_role[role] = creator["name"]

    parts = []
    for role in ("auctor", "praeses"):
        if role in by_role:
            parts.append(f"{by_role[role]} ({role})")
            break
    if "respondens" in by_role:
        parts.append(f"{by_role['respondens']} (respondens)")
    return " · ".join(parts)


def _short_title(title: str) -> str:
    """Kärbib pika bibliograafilise kirje sõnapiirilt."""
    title = " ".join((title or "").split())
    if len(title) <= TITLE_SNIPPET_CHARS:
        return title
    cut = title[:TITLE_SNIPPET_CHARS]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut + "…"


def _snippet(hit: dict) -> str:
    """Katke: eelista põhiteksti, kui seal vastet pole, siis marginaaliat."""
    formatted = hit.get("_formatted") or {}
    for field in ("lehekylje_tekst", "marginaalia_tekst"):
        text = (formatted.get(field) or "").strip()
        if text:
            prefix = "marginaalia: " if field == "marginaalia_tekst" else ""
            return prefix + " ".join(text.split())
    return ""


def format_search_hits(hits: list[dict], total: int, *, base_url: str) -> str:
    if not hits:
        return (
            "Vasteid ei leitud.\n"
            "Otsing on vaikimisi range (kõik päringu sõnad peavad esinema). "
            "Proovi relax_matching=true või vähem sõnu.\n"
            "Kontrolli ka päringu KEELT: korpus on ladina-, saksa-, rootsi- ja "
            "kreekakeelne, eestikeelset teksti on ainult ~440 lk. Eestikeelne "
            "termin jääb tühjaks ka siis, kui teemat on rohkelt käsitletud — "
            "otsi ladina või saksa tüve ja arvesta kõikuvat ortograafiat "
            "(u/v, i/j, ß/ss)."
        )

    blocks = [f"Vasteid kokku: {total} (kuvatud {len(hits)})", STATUS_LEGEND, ""]
    for i, hit in enumerate(hits, start=1):
        work_id = hit.get("work_id", "")
        page = hit.get("lehekylje_number")
        # Eelista rolliga märgitud loojaid: „autor" on tuletatud väli, mis
        # disputatsiooni puhul on tegelikult praeses — märgistamata eksitav.
        author = _primary_creators(hit.get("creators") or []) or hit.get("autor") or ""
        year = hit.get("aasta") or hit.get("year_display") or ""
        place = hit.get("location") or ""
        title = f'"{_short_title(hit.get("title", ""))}"'
        # Ilma loojata teosel ei tohi jääda rippuvat eraldajat („[2]  · ...").
        head = f"[{i}] " + (f"{author} · {title}" if author else title)
        if year or place:
            head += f" ({', '.join(str(x) for x in (year, place) if x)})"

        meta = [f"work_id={work_id}"]
        if page is not None:
            meta.append(f"lk {page}/{hit.get('teose_lehekylgede_arv', '?')}")
        if hit.get("status"):
            meta.append(f"seisund={hit['status']}")
        collection = _first(hit.get("collections"))
        if collection:
            meta.append(f"kollektsioon={collection}")

        block = [head, "    " + " · ".join(meta)]
        snippet = _snippet(hit)
        if snippet:
            block.append(f"    {snippet}")
        block.append("    vaata: " + work_url(work_id, page, base_url=base_url))
        blocks.append("\n".join(block))
    return "\n".join(blocks)


def format_fields(pairs: list[tuple[str, object]]) -> str:
    """Sildistatud väljad. Tühjad väärtused jäetakse välja — müra maksab tokeneid."""
    lines = []
    for label, value in pairs:
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value)
        lines.append(f"{label}: {value}")
    return "\n".join(lines)


def format_pages(pages: list[dict], *, base_url: str, work_id: str) -> str:
    if not pages:
        return "Selles vahemikus lehekülgi ei ole."

    blocks = [STATUS_LEGEND, ""]
    for page in pages:
        num = page.get("lehekylje_number")
        blocks.append(
            f"── lk {num} · seisund={page.get('status', '?')} · "
            + work_url(work_id, num, base_url=base_url)
        )
        blocks.append((page.get("lehekylje_tekst") or "").strip())
        marginalia = (page.get("marginaalia_tekst") or "").strip()
        if marginalia:
            # Marginaalia on füüsiliselt eraldi tekstikiht, mitte põhiteksti osa.
            blocks.append(f"[marginaalia] {marginalia}")
        blocks.append("")
    return "\n".join(blocks)
