"""Vastus → agendile loetav tekst. Puhas moodul: ei HTTP-d, ei päringuloogikat.

Vorming on tahtlikult tihe: pikk agentne jooks teeb kümneid päringuid ja
JSON-i korduvad võtmenimed sööksid konteksti enne, kui töö algab.
"""

STATUS_LEGEND = (
    "Seisund: Toores = puutumata masinlugemine (võib sisaldada vigu); "
    "Töös = osaliselt üle vaadatud; Valmis = inimese kinnitatud transkriptsioon."
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
            "Proovi relax_matching=true või vähem sõnu."
        )

    blocks = [f"Vasteid kokku: {total} (kuvatud {len(hits)})", STATUS_LEGEND, ""]
    for i, hit in enumerate(hits, start=1):
        work_id = hit.get("work_id", "")
        page = hit.get("lehekylje_number")
        author = hit.get("autor") or ""
        year = hit.get("aasta") or hit.get("year_display") or ""
        place = hit.get("location") or ""
        head = f'[{i}] {author} · "{hit.get("title", "")}"'
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
