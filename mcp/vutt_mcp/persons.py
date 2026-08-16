"""Prosopograafia päringud + mahuvalve.

Kontekstikulu on siin arhitektuuriline: produktiivse professori kaardil võib
olla 178 seotud teost (kontrollitud tootmises: Lorenz Luden). Piiramata väljund
oleks sama suur probleem kui piiramata get_pages.

Vastuste kujud on kontrollitud päris API vastu — vt mcp/tests/test_persons.py
mooduli docstring.
"""
from . import format as fmt
from .errors import VuttNotFound

MAX_RELATED_WORKS = 50
MAX_RELATIONS = 50
LIST_PATH = "/prosopography"


def search(client, base_url: str, **filters) -> str:
    """Isikuotsing. Tühjad filtrid jäetakse päringust välja."""
    params = {k: v for k, v in filters.items() if v not in (None, "")}
    data = client.api_get(LIST_PATH, params=params)
    results = data.get("results", [])
    if not results:
        return "Isikuid ei leitud. Proovi lühemat nime või vähem filtreid."

    blocks = [
        f"Isikuid kokku: {data.get('total', len(results))} (kuvatud {len(results)})",
        "",
    ]
    for i, person in enumerate(results, start=1):
        years = "–".join(
            str(y) for y in (person.get("birth_year"), person.get("death_year")) if y
        )
        head = f"[{i}] {person.get('label', '')}"
        if years:
            head += f" ({years})"

        meta = [f"person_id={person.get('id', '')}"]
        if person.get("work_count") is not None:
            meta.append(f"teoseid={person['work_count']}")
        # NB: listingu `occupations` on LinkedEntity-objektide massiiv
        # ({id, label, labels{}}), mitte stringide oma — _labels() käsitleb mõlemat.
        occupations = _labels(person.get("occupations"))[:3]
        if occupations:
            meta.append("amet=" + ", ".join(occupations))
        if person.get("origin_place"):
            meta.append(f"päritolu={person['origin_place']}")

        block = [head, "    " + " · ".join(meta)]
        snippet = (person.get("biography_snippet") or "").strip()
        if snippet:
            block.append(f"    {snippet}")
        block.append(
            "    vaata: " + fmt.person_url(person.get("id", ""), base_url=base_url)
        )
        blocks.append("\n".join(block))
    return "\n".join(blocks)


def detail(client, base_url: str, person_id: str, include_relations: bool) -> str:
    """Isikukaardi täisandmed. Seotud teoste ja seoste arv on lae all."""
    try:
        person = client.api_get(f"{LIST_PATH}/{person_id}")
    except VuttNotFound as exc:
        raise VuttNotFound(
            f"Isikut person_id={person_id} ei leitud. Otsi õige ID üles "
            f"search_persons tööriistaga."
        ) from exc

    name = (person.get("name") or {}).get("label") or person.get("id", "")
    sections = [fmt.format_fields([
        ("nimi", name),
        ("person_id", person.get("id")),
        ("sugu", person.get("gender")),
        ("sünd", _date_label(person.get("birth"))),
        ("surm", _date_label(person.get("death"))),
        ("päritolu", _place_label(person.get("origin"))),
        ("ametid", _labels(person.get("occupations"))),
        ("haridus", _labels(person.get("education"))),
        ("staatused", _labels(person.get("statuses"))),
        ("konfessioonid", _labels(person.get("confessions"))),
        ("sildid", person.get("tags")),
        ("elulugu", (person.get("biography") or "").strip() or None),
        ("märkmed", (person.get("notes") or "").strip() or None),
        ("vaata", fmt.person_url(person.get("id", ""), base_url=base_url)),
    ])]

    sections.append(_works_section(client, base_url, person))
    if include_relations:
        sections.append(_relations_section(client, person_id))
    return "\n\n".join(s for s in sections if s)


def _works_section(client, base_url: str, person) -> str:
    works = person.get("works") or []
    total = len(works)
    if total == 0:
        return "seotud_teoseid: 0"

    shown = works[:MAX_RELATED_WORKS]
    try:
        response = client.api_post(
            f"{LIST_PATH}/work-titles",
            {"work_ids": [w.get("work_id") for w in shown]},
        )
        titles = (response or {}).get("titles") or {}
    except Exception:  # pealkirjad on ilustus, mitte eeldus
        titles = {}

    lines = [f"seotud_teoseid: {total}"]
    for work in shown:
        wid = work.get("work_id", "")
        entry = titles.get(wid) or {}
        if isinstance(entry, dict):
            title = entry.get("title")
            restricted = bool(entry.get("restricted"))
        else:
            title = entry
            restricted = False
        line = (
            f"  {title or '(pealkiri teadmata)'} · work_id={wid} · "
            f"role={work.get('role', '?')}"
        )
        # Kaitstud kollektsiooni teosele linki ei anta — pealkiri pole salajane,
        # aga skaneering on.
        line += (
            " · kaitstud kollektsioon"
            if restricted
            else " · " + fmt.work_url(wid, base_url=base_url)
        )
        lines.append(line)

    if total > MAX_RELATED_WORKS:
        lines.append(
            f"  … {total - MAX_RELATED_WORKS} teost jäeti välja. "
            f"Kõigi nägemiseks kasuta search_works koos creator_ids filtriga."
        )
    return "\n".join(lines)


def _relations_section(client, person_id: str) -> str:
    """Teostest tuletatud isiku-isiku seosed.

    Endpoint tagastab MASSIIVI kirjetest {person_id, person_name,
    shared_works_count, shared_works}. `shared_works` sisaldab täispealkirju —
    neid EI väljastata, ainult arv.
    """
    try:
        items = client.api_get(
            f"{LIST_PATH}/work-relations/{person_id}",
            params={"limit": MAX_RELATIONS},
        )
    except Exception:
        return ""
    if not isinstance(items, list) or not items:
        return "isikuseosed: 0"

    lines = [f"isikuseosed: {len(items)}"]
    for rel in items[:MAX_RELATIONS]:
        lines.append(
            f"  {rel.get('person_name') or rel.get('person_id', '?')} · "
            f"person_id={rel.get('person_id', '')} · "
            f"ühiseid teoseid={rel.get('shared_works_count', '?')}"
        )
    if len(items) > MAX_RELATIONS:
        lines.append(f"  … ülejäänud jäeti välja (lagi {MAX_RELATIONS}).")
    return "\n".join(lines)


def _date_label(node) -> str:
    if not isinstance(node, dict):
        return ""
    date = node.get("date") or node.get("year") or ""
    place = _place_label(node)
    return " ".join(str(x) for x in (date, place) if x)


def _place_label(node) -> str:
    if not isinstance(node, dict):
        return ""
    place = node.get("place")
    if isinstance(place, dict):
        return place.get("label") or ""
    return node.get("label") or ""


def _labels(items) -> list:
    """Massiiv objekte või stringe → sildistringide loend."""
    out = []
    for item in items or []:
        if isinstance(item, dict):
            label = item.get("label") or (item.get("labels") or {}).get("et")
            if label:
                out.append(str(label))
        elif item:
            out.append(str(item))
    return out
