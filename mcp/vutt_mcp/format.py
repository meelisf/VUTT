"""Vastus → agendile loetav tekst. Puhas moodul: ei HTTP-d, ei päringuloogikat.

Vorming on tahtlikult tihe: pikk agentne jooks teeb kümneid päringuid ja
JSON-i korduvad võtmenimed sööksid konteksti enne, kui töö algab.
"""

# Seisundite seletust vastuses EI OLE: see elab `instructions.py`-s, mille
# klient süstib konteksti üks kord seansi kohta. Igas vastuses kordamine
# maksis ~100 tokenit päringu kohta ja agent tegi neid kümneid.
# `test_meili_contract.py` valvab, et juhend kõiki `src/types.ts` PageStatus'i
# väärtusi nimetaks. (Kolmene Toores/Töös/Valmis on `WorkStatus` — eri asi.)

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


def needs_role_legend(creators: list[dict]) -> bool:
    """Kas rollilegend väärib vastuses ruumi?

    „auctor" seletab end ise; enamikul teostest ongi ainult tema. Legendi
    hind on ~90 tokenit, seega väljasta ta ainult siis, kui vastuses on
    mõni läbipaistmatum roll (praeses, aui, gratulator …).
    """
    return any((c.get("role") or "auctor") != "auctor" for c in creators)


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


# Mudeli silmus OCR-is: leheküljel kordub sama plokk kümneid kuni tuhandeid
# kordi. Mõõdetud 2026-08-25: 494 lehte (2,0 %) 127 teoses, unikaalset teksti
# mediaanina 27 %, maht 846 sõna vs tavalise lehe 255. Re-OCR ei aita — silmus
# on mudelis. Kärbe on NÄHTAV: agent näeb, mis ja mitu korda kordus, ning saab
# originaali lehe lingilt.
COLLAPSE_MIN_KORDUSI = 4      # vähem = ehtne retoorika, mitte silmus
COLLAPSE_MIN_SONU = 12        # kokkusurutav jooks peab olema sisuline
COLLAPSE_MAX_PERIOOD = 30     # pikem plokk ei ole enam silmus, vaid tekst


def collapse_repeats(text: str) -> str:
    """Surub järjestikused korduvad plokid kokku, jättes nähtava märgendi.

    EI muuda teksti vaikselt: märgend ütleb ploki, korduste arvu ja selle, et
    midagi jäi välja. Agent, kes tahab originaali, läheb lehe lingile.
    """
    sonad = (text or "").split()
    if len(sonad) < COLLAPSE_MIN_SONU:
        return text

    valjund: list[str] = []
    i = 0
    muudetud = False
    while i < len(sonad):
        parim = None
        for periood in range(1, COLLAPSE_MAX_PERIOOD + 1):
            if i + periood * COLLAPSE_MIN_KORDUSI > len(sonad):
                break
            plokk = sonad[i:i + periood]
            kordusi = 1
            j = i + periood
            while sonad[j:j + periood] == plokk:
                kordusi += 1
                j += periood
            if kordusi >= COLLAPSE_MIN_KORDUSI and periood * kordusi >= COLLAPSE_MIN_SONU:
                # Lühim periood võidab: „S. S." on kaks korda „S.", mitte üks plokk.
                parim = (periood, kordusi, j)
                break
        if parim:
            periood, kordusi, jargmine = parim
            valjund.append(" ".join(sonad[i:i + periood]))
            valjund.append(
                f"[sama {periood}-sõnaline lõik kordub veel {kordusi - 1}× "
                f"— välja jäetud]"
            )
            i = jargmine
            muudetud = True
        else:
            valjund.append(sonad[i])
            i += 1
    return " ".join(valjund) if muudetud else text


def format_search_hits(hits: list[dict], total: int, *, base_url: str,
                       compact: bool = False,
                       unit: str = "pages",
                       next_offset: int | None = None) -> str:
    if not hits:
        return (
            "Vasteid ei leitud.\n"
            "Otsing on vaikimisi range (kõik päringu sõnad peavad esinema). "
            "Proovi relax_matching=true või vähem sõnu.\n"
            "Proovi ka SÕNAOSA: „orati\" leiab „orationem\", käändelõpuga "
            "täissõna leiab vähem. Mitmesõnalises päringus tohib ainult "
            "VIIMANE sõna olla poolik — pane tüvi lõppu.\n"
            "Kontrolli ka päringu KEELT: korpus on valdavalt ladina- ja "
            "saksakeelne, eestikeelset teksti on väga vähe. Eestikeelne "
            "termin jääb tühjaks ka siis, kui teemat on rohkelt käsitletud — "
            "otsi ladina või saksa tüve ja arvesta kõikuvat ortograafiat "
            "(u/v, i/j, ß/ss)."
        )

    # Rühmitamine teose kaupa: mõõdetuna oli 26 % vastuse mahust märk-märgilt
    # korduv päis (10 vastet tulid tihti ühest teosest). Sama loogika nagu
    # töölaua otsingul — teos on rühm, leheküljed selle sees.
    ruhmad: dict[str, list[dict]] = {}
    for hit in hits:
        ruhmad.setdefault(hit.get("work_id", ""), []).append(hit)

    # Loenduri ühik peab olema välja öeldud: „Vasteid kokku" üksi luges üks
    # agent teoste arvuks ja teine lehekülgedeks. distinct=work_id puhul ONGI
    # totalHits teoste arv (kontrollitud: oratio 571 = 571 eri teost).
    if unit == "works":
        pais = f"Teoseid kokku: {total} (kuvatud {len(ruhmad)})"
    else:
        pais = (f"Vasteid kokku: {total} lehekülge "
                f"(kuvatud {len(hits)} lk {len(ruhmad)} teosest)")
    blocks = [pais, ""]
    for i, (work_id, lehed) in enumerate(ruhmad.items(), start=1):
        esimene = lehed[0]
        # Eelista rolliga märgitud loojaid: „autor" on tuletatud väli, mis
        # disputatsiooni puhul on tegelikult praeses — märgistamata eksitav.
        author = (
            _primary_creators(esimene.get("creators") or [])
            or esimene.get("autor")
            or ""
        )
        year = esimene.get("aasta") or esimene.get("year_display") or ""
        place = esimene.get("location") or ""
        title = f'"{_short_title(esimene.get("title", ""))}"'
        # Ilma loojata teosel ei tohi jääda rippuvat eraldajat („[2]  · ...").
        head = f"[{i}] " + (f"{author} · {title}" if author else title)
        if year or place:
            head += f" ({', '.join(str(x) for x in (year, place) if x)})"

        meta = [f"work_id={work_id}"]
        lehti = esimene.get("teose_lehekylgede_arv")
        if lehti:
            meta.append(f"{lehti} lk")
        collection = _first(esimene.get("collections"))
        if collection:
            meta.append(f"kollektsioon={collection}")

        block = [head, "    " + " · ".join(meta)]
        if compact:
            # Avastusrežiim: lehed ühele reale, link mustrina üks kord.
            # Katked on mahult ~2/3 vastusest (limit=50 → 17,5 kB).
            osad = []
            for hit in lehed:
                page = hit.get("lehekylje_number")
                seisund = hit.get("status")
                osad.append(f"lk {page}" + (f" ({seisund})" if seisund else ""))
            block.append("    " + " · ".join(osad))
            block.append("    lehe link: "
                         + work_url(work_id, base_url=base_url) + "/{lk}")
        else:
            for hit in lehed:
                page = hit.get("lehekylje_number")
                rida = f"    lk {page} ·" if page is not None else "    lk ? ·"
                if hit.get("status"):
                    rida += f" seisund={hit['status']} ·"
                block.append(rida + " " + work_url(work_id, page, base_url=base_url))
                snippet = _snippet(hit)
                if snippet:
                    block.append(f"      {snippet}")
        blocks.append("\n".join(block))
    if next_offset is not None:
        blocks.append(f"\nJärgmine leht: offset={next_offset}")
    return "\n".join(blocks)


def format_facet_value(value: str, labels: dict) -> str:
    """Q-koodile sildid juurde. Kood JÄÄB — filter vajab teda, mitte silti.

    Paljas „Q609697" paneb mudeli oletama („Q1813927 might be…"), sest
    Wikidata identifikaator ei kanna tähendust. Eelistus et → en; kui
    registris koodi ei ole, jääb kood paljaks.
    """
    sildid = labels.get(value) or {}
    nimed: list[str] = []
    for keel in ("et", "en"):
        nimi = sildid.get(keel)
        if nimi and nimi.lower() not in {n.lower() for n in nimed}:
            nimed.append(nimi)
    return f"{value} ({' / '.join(nimed)})" if nimed else value


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

    blocks = []
    for page in pages:
        num = page.get("lehekylje_number")
        blocks.append(
            f"── lk {num} · seisund={page.get('status', '?')} · "
            + work_url(work_id, num, base_url=base_url)
        )
        blocks.append(collapse_repeats((page.get("lehekylje_tekst") or "").strip()))
        marginalia = (page.get("marginaalia_tekst") or "").strip()
        if marginalia:
            # Marginaalia on füüsiliselt eraldi tekstikiht, mitte põhiteksti osa.
            blocks.append(f"[marginaalia] {marginalia}")
        blocks.append("")
    return "\n".join(blocks)


def format_page_index(pages: list[dict], *, base_url: str, work_id: str) -> str:
    """Lehekülgede ülevaade vahemikena, mitte rida iga lehe kohta.

    Korpuses (mõõdetud 2026-08-25) on mediaanteoses 9 lehte ja 89 % teostest
    kannab kõigil lehtedel sama seisundit. Rida lehe kohta kordas seetõttu
    URL-i mustrit ja sama sõna kümneid kordi: 706-leheküljeline teos maksis
    ~18 000 tokenit, vahemikena ~33. Kogu korpuse peale −93 %.

    Kodeering käib TEGELIKE lehenumbrite peale (praegu on kõik teosed
    katkematud 1..N, aga see ei ole kuskil jõustatud) — auk numbrites annab
    eraldi vahemiku, ei kao vaikselt ära.
    """
    if not pages:
        return "Lehekülgi ei ole."

    paarid = [(p.get("lehekylje_number"), p.get("status") or "?") for p in pages]
    numbriga = sorted(
        ((n, s) for n, s in paarid if isinstance(n, int)), key=lambda x: x[0]
    )
    numbrita = len(paarid) - len(numbriga)

    # Seisundi-jooksud: kõrvutine number JA sama seisund.
    jooksud: list[list] = []
    for n, s in numbriga:
        if jooksud and jooksud[-1][2] == s and jooksud[-1][1] + 1 == n:
            jooksud[-1][1] = n
        else:
            jooksud.append([n, n, s])

    # Numbrivahemikud seisundist sõltumata — need näitavad auke.
    vahemikud: list[list] = []
    for n, _ in numbriga:
        if vahemikud and vahemikud[-1][1] + 1 == n:
            vahemikud[-1][1] = n
        else:
            vahemikud.append([n, n])

    def _vahemik(algus: int, lopp: int) -> str:
        return str(algus) if algus == lopp else f"{algus}–{lopp}"

    pais = "Leheküljed: " + " · ".join(_vahemik(a, b) for a, b in vahemikud)
    seisundid = {s for _, _, s in jooksud}
    if len(seisundid) == 1:
        pais += f" · kõik seisund={jooksud[0][2]}"
    if numbrita:
        pais += f" · lisaks {numbrita} lehenumbrita kirjet"

    read = [pais]
    if len(seisundid) > 1:
        read.append("  seisund: " + " · ".join(
            f"lk {_vahemik(a, b)} {s}" for a, b, s in jooksud
        ))
    read.append("  lehe link: " + work_url(work_id, base_url=base_url) + "/{lk}")
    return "\n".join(read)
